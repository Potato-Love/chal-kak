// Photo Guide - One Cue Controller v4.6
// Smoother speech: ordinary coaching never cuts off another sentence.
// Only capture-critical cues may interrupt; normal cues keep only the latest pending message.

const DEFAULTS = {
    holdBeforeShootMs: 1000,
    matchLossGraceMs: 450,
    cueRepeatMs: 6500,
    normalCueMinGapMs: 2200,
    autoCaptureCooldownMs: 8000,
    captureDelayMs: 2000,
    motionBlockSpeed: 0.34
};

let state = createState();
let cachedKoreanVoice = null;
let activeUtterance = null;
let pendingSpeech = null;
let restartTimer = null;

function createState() {
    return {
        matchStartedAt: null,
        lastMatchedAt: null,
        holdAnnounced: false,
        shotScheduledForThisMatch: false,
        lastCueKey: null,
        lastCueAt: 0,
        lastSpokenAt: -Infinity,
        lastAutoCaptureAt: -Infinity,
        lastActor: null,
        lastPhase: null
    };
}

function cueResult(key, text, now, config, extra = {}) {
    const changed = key !== state.lastCueKey;
    const repeatDue = now - state.lastCueAt >= config.cueRepeatMs;
    const action = extra.action ?? null;
    const actorChanged = Boolean(action?.actor && action.actor !== state.lastActor);
    const phaseChanged = Boolean(action?.phase && action.phase !== state.lastPhase);

    const isCaptureCue = key === "HOLD" || key === "SHOOT" || key === "STOP_MOVING";
    const normalGapReady = now - state.lastSpokenAt >= config.normalCueMinGapMs;

    const shouldSpeak = Boolean(text) &&
        (changed || repeatDue || actorChanged || phaseChanged) &&
        (isCaptureCue || normalGapReady || actorChanged || phaseChanged);

    if (shouldSpeak) {
        state.lastCueKey = key;
        state.lastCueAt = now;
        state.lastSpokenAt = now;
        state.lastActor = action?.actor ?? state.lastActor;
        state.lastPhase = action?.phase ?? state.lastPhase;
    }

    return {
        cueKey: key,
        cueText: text,
        shouldSpeak,
        // Do not cut ordinary guidance. Capture cues are time-critical.
        interruptSpeech: shouldSpeak && isCaptureCue,
        shouldAutoCapture: false,
        cancelAutoCapture: false,
        captureDelayMs: 0,
        ...extra
    };
}

function resetMatchSequence() {
    state.matchStartedAt = null;
    state.lastMatchedAt = null;
    state.holdAnnounced = false;
    state.shotScheduledForThisMatch = false;
}

export function updateOneCue({
    guidance,
    comparison,
    compositionMatched,
    poseMatched = false,
    overallMatched = false,
    now = performance.now(),
    config: configOverride = {}
}) {
    const config = { ...DEFAULTS, ...configOverride };
    const motionSpeed = guidance?.motion?.speed ?? 0;
    const movingTooMuch = motionSpeed > config.motionBlockSpeed;

    if (overallMatched === true) {
        state.lastMatchedAt = now;

        if (movingTooMuch) {
            resetMatchSequence();
            return cueResult(
                "STOP_MOVING",
                "좋아요. 잠깐만 멈춰주세요.",
                now,
                config,
                { motionSpeed, cancelAutoCapture: true }
            );
        }

        if (state.matchStartedAt === null) state.matchStartedAt = now;

        if (!state.holdAnnounced) {
            state.holdAnnounced = true;
            return cueResult(
                "HOLD",
                "좋아요, 그대로요.",
                now,
                config,
                { matchedForMs: 0, motionSpeed }
            );
        }

        const matchedForMs = now - state.matchStartedAt;

        if (
            matchedForMs >= config.holdBeforeShootMs &&
            !state.shotScheduledForThisMatch
        ) {
            const cooldownPassed =
                now - state.lastAutoCaptureAt >= config.autoCaptureCooldownMs;

            if (cooldownPassed) {
                state.shotScheduledForThisMatch = true;
                state.lastAutoCaptureAt = now;
                return cueResult(
                    "SHOOT",
                    "찍을게요.",
                    now,
                    config,
                    {
                        shouldAutoCapture: true,
                        captureDelayMs: config.captureDelayMs,
                        matchedForMs,
                        motionSpeed
                    }
                );
            }
        }

        return cueResult("HOLDING", null, now, config, { matchedForMs, motionSpeed });
    }

    if (
        state.holdAnnounced &&
        state.lastMatchedAt !== null &&
        now - state.lastMatchedAt <= config.matchLossGraceMs
    ) {
        return cueResult("HOLDING", null, now, config, { motionSpeed });
    }

    if (state.holdAnnounced) {
        const hadScheduledShot = state.shotScheduledForThisMatch;
        resetMatchSequence();
        if (hadScheduledShot) {
            return cueResult(
                "MATCH_LOST",
                null,
                now,
                config,
                { cancelAutoCapture: true, motionSpeed }
            );
        }
    }

    const action = guidance?.action;
    if (action) {
        return cueResult(
            action.key,
            action.text,
            now,
            config,
            { action, motionSpeed }
        );
    }

    if (guidance?.subject?.detected === false) {
        return cueResult(
            "WAIT_FOR_PERSON",
            "화면 안으로 들어와 주세요.",
            now,
            config,
            { motionSpeed }
        );
    }

    if (!compositionMatched) {
        return cueResult(
            "PHOTOGRAPHER_CHECK_FRAMING",
            "카메라 구도를 조금만 더 맞춰주세요.",
            now,
            config,
            {
                action: { actor: "PHOTOGRAPHER", phase: "PHOTOGRAPHER_FRAMING" },
                motionSpeed
            }
        );
    }

    if (!poseMatched) {
        return cueResult(
            "MODEL_FINE_TUNE",
            "자세를 조금만 더 맞춰주세요.",
            now,
            config,
            {
                action: { actor: "MODEL", phase: "MODEL_POSE" },
                motionSpeed
            }
        );
    }

    return cueResult("WAIT_MATCH", null, now, config, { motionSpeed });
}

function voiceScore(voice) {
    const name = (voice?.name ?? "").toLowerCase();
    const lang = (voice?.lang ?? "").toLowerCase();
    if (!lang.startsWith("ko")) return -9999;

    let score = 0;
    if (name.includes("natural") || name.includes("online")) score += 100;
    if (name.includes("google")) score += 75;
    if (name.includes("sunhi") || name.includes("yuna")) score += 60;
    if (name.includes("heami")) score += 35;
    if (voice.localService) score += 10;
    return score;
}

function selectKoreanVoice() {
    if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
    ) {
        return null;
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return cachedKoreanVoice;

    cachedKoreanVoice = voices
        .filter(v => (v.lang ?? "").toLowerCase().startsWith("ko"))
        .sort((a, b) => voiceScore(b) - voiceScore(a))[0] ?? null;

    return cachedKoreanVoice;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.addEventListener?.("voiceschanged", () => {
        cachedKoreanVoice = null;
        selectKoreanVoice();
    });
}

function createUtterance(
    text,
    { lang = "ko-KR", rate = 1.08, pitch = 1.04, volume = 1.0 } = {}
) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    const voice = selectKoreanVoice();
    if (voice) utterance.voice = voice;

    return utterance;
}

function playSpeech(text, options = {}) {
    if (!text) return false;
    const synth = window.speechSynthesis;
    const utterance = createUtterance(text, options);
    activeUtterance = utterance;

    utterance.onend = () => {
        if (activeUtterance === utterance) activeUtterance = null;
        if (!pendingSpeech) return;

        const next = pendingSpeech;
        pendingSpeech = null;
        restartTimer = setTimeout(() => {
            restartTimer = null;
            if (!synth.speaking && !synth.pending) {
                playSpeech(next.text, next.options);
            } else {
                pendingSpeech = next;
            }
        }, 90);
    };

    utterance.onerror = () => {
        if (activeUtterance === utterance) activeUtterance = null;
    };

    synth.speak(utterance);
    return true;
}

export function speakOneCue(
    text,
    {
        lang = "ko-KR",
        rate = 1.08,
        pitch = 1.04,
        volume = 1.0,
        interrupt = false
    } = {}
) {
    if (!text) return false;

    if (
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
    ) {
        console.warn("[One Cue v4] speechSynthesis not supported");
        return false;
    }

    const synth = window.speechSynthesis;
    const options = { lang, rate, pitch, volume };

    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    if (interrupt) {
        pendingSpeech = null;
        synth.cancel();
        restartTimer = setTimeout(() => {
            restartTimer = null;
            playSpeech(text, options);
        }, 70);
        return true;
    }

    if (synth.speaking || synth.pending || activeUtterance) {
        // Never stack old directions. Keep only the newest next instruction.
        pendingSpeech = { text, options };
        return true;
    }

    pendingSpeech = null;
    return playSpeech(text, options);
}

export function resetOneCueController() {
    state = createState();
    pendingSpeech = null;
    activeUtterance = null;

    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    if (
        typeof window !== "undefined" &&
        "speechSynthesis" in window
    ) {
        window.speechSynthesis.cancel();
    }
}
