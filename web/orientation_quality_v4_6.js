// PhotoGuide Orientation & Quality v4.6
// Adds conservative torso/head orientation, eye-open gating, gaze diagnostics,
// and a post-capture sharpness estimate. Face analysis is confidence-gated:
// if the face is too small or FaceLandmarker is unavailable, capture falls back
// to the existing body matcher instead of inventing a face instruction.

const ACTION_STABILITY_MS = 420;
const ACTION_CLEAR_GRACE_MS = 360;

let referenceFaceAnalysis = null;
let state = createState();

function createState() {
    return {
        pendingKey: null,
        pendingSince: 0,
        pendingAction: null,
        activeAction: null,
        activeLastSeenAt: 0
    };
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function normalizeAngle180(angle) {
    let value = ((angle + 180) % 360 + 360) % 360 - 180;
    if (value === -180) value = 180;
    return value;
}

function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 };
}

function lineAngle(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function point(source, index) {
    if (!source) return null;
    const p = source[index] ?? source[String(index)];
    if (!p) return null;
    const x = Number(p.x);
    const y = Number(p.y);
    const z = Number(p.z ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, z };
}

function categoryMap(faceResult) {
    const first = faceResult?.faceBlendshapes?.[0];
    const categories = Array.isArray(first)
        ? first
        : first?.categories ?? [];
    const map = {};
    for (const c of categories) {
        const key = c.categoryName ?? c.displayName ?? c.label ?? c.name;
        const score = Number(c.score);
        if (key && Number.isFinite(score)) map[key] = score;
    }
    return map;
}

function matrixEuler(faceResult) {
    const matrix = faceResult?.facialTransformationMatrixes?.[0];
    const data = matrix?.data ?? (Array.isArray(matrix) ? matrix : null);
    if (!data || data.length < 16) return null;

    // MediaPipe returns a 4x4 facial transform. We only use these values as
    // relative reference-vs-live rotation, not as calibrated camera angles.
    const r00 = Number(data[0]), r01 = Number(data[1]), r02 = Number(data[2]);
    const r10 = Number(data[4]), r11 = Number(data[5]), r12 = Number(data[6]);
    const r20 = Number(data[8]), r21 = Number(data[9]), r22 = Number(data[10]);
    if (![r00,r01,r02,r10,r11,r12,r20,r21,r22].every(Number.isFinite)) return null;

    const sy = Math.sqrt(r00 * r00 + r10 * r10);
    const singular = sy < 1e-6;
    let pitch, yaw, roll;

    if (!singular) {
        roll = Math.atan2(r21, r22);
        pitch = Math.atan2(-r20, sy);
        yaw = Math.atan2(r10, r00);
    } else {
        roll = Math.atan2(-r12, r11);
        pitch = Math.atan2(-r20, sy);
        yaw = 0;
    }

    const d = 180 / Math.PI;
    return { yawDeg: yaw * d, pitchDeg: pitch * d, rollDeg: roll * d };
}

function gazeClass(blend) {
    if (!blend || !Object.keys(blend).length) {
        return { direction: "UNKNOWN", confidence: 0, reliable: false };
    }

    const n = key => Number(blend[key] ?? 0);
    const left = (n("eyeLookOutLeft") + n("eyeLookInRight")) / 2;
    const right = (n("eyeLookInLeft") + n("eyeLookOutRight")) / 2;
    const up = (n("eyeLookUpLeft") + n("eyeLookUpRight")) / 2;
    const down = (n("eyeLookDownLeft") + n("eyeLookDownRight")) / 2;

    const entries = [
        ["LEFT", left], ["RIGHT", right], ["UP", up], ["DOWN", down]
    ].sort((a, b) => b[1] - a[1]);

    const [direction, best] = entries[0];
    const second = entries[1]?.[1] ?? 0;
    if (best < 0.42 || best - second < 0.10) {
        return { direction: "CENTER", confidence: Math.max(0, 1 - best), reliable: best < 0.58 };
    }
    return { direction, confidence: best, reliable: true };
}

export function analyzeFaceLandmarkerResult(faceResult) {
    const face = faceResult?.faceLandmarks?.[0];
    if (!face?.length) {
        return {
            detected: false,
            headReliable: false,
            eyesReliable: false,
            gazeReliable: false
        };
    }

    const leftCheek = point(face, 234);
    const rightCheek = point(face, 454);
    const nose = point(face, 1);
    const leftEye = point(face, 33);
    const rightEye = point(face, 263);
    const forehead = point(face, 10);
    const chin = point(face, 152);

    if (!leftCheek || !rightCheek || !nose || !leftEye || !rightEye || !forehead || !chin) {
        return { detected: true, headReliable: false, eyesReliable: false, gazeReliable: false };
    }

    const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
    const faceHeight = Math.abs(chin.y - forehead.y);
    const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
    const eyeMid = midpoint(leftEye, rightEye);

    const yawProxy = faceWidth > 1e-5 ? (nose.x - faceCenterX) / faceWidth : 0;
    const pitchProxy = faceHeight > 1e-5 ? (nose.y - eyeMid.y) / faceHeight : 0;
    const rollDeg = normalizeAngle180(lineAngle(leftEye, rightEye));
    const euler = matrixEuler(faceResult);
    const blend = categoryMap(faceResult);

    const blinkLeft = Number(blend.eyeBlinkLeft ?? 0);
    const blinkRight = Number(blend.eyeBlinkRight ?? 0);
    const blinkMax = Math.max(blinkLeft, blinkRight);
    const blendAvailable = Object.keys(blend).length > 0;

    // Full-body shots can make the face very small. Do not force a face cue
    // below this size because jitter becomes larger than the useful signal.
    const headReliable = faceWidth >= 0.045 && faceHeight >= 0.060;
    const eyesReliable = headReliable && blendAvailable;
    const eyesClosed = eyesReliable && blinkMax >= 0.66;
    const gaze = gazeClass(blend);

    return {
        detected: true,
        headReliable,
        eyesReliable,
        gazeReliable: headReliable && gaze.reliable,
        faceWidth,
        faceHeight,
        faceCenter: { x: faceCenterX, y: (forehead.y + chin.y) / 2 },
        head: {
            yawProxy,
            pitchProxy,
            rollDeg,
            matrixYawDeg: euler?.yawDeg ?? null,
            matrixPitchDeg: euler?.pitchDeg ?? null,
            matrixRollDeg: euler?.rollDeg ?? null
        },
        eyes: {
            blinkLeft,
            blinkRight,
            blinkMax,
            closed: eyesClosed
        },
        gaze
    };
}

function poseHeadAnalysis(source) {
    const nose = point(source, 0);
    const leftEar = point(source, 7);
    const rightEar = point(source, 8);
    const leftEye = point(source, 2) ?? point(source, 3);
    const rightEye = point(source, 5) ?? point(source, 6);

    if (!nose || !leftEye || !rightEye) {
        return { reliable: false };
    }

    const eyeSpan = Math.abs(rightEye.x - leftEye.x);
    const eyeMid = midpoint(leftEye, rightEye);
    let anchorLeft = leftEar;
    let anchorRight = rightEar;
    let span = anchorLeft && anchorRight ? Math.abs(anchorRight.x - anchorLeft.x) : eyeSpan;
    let centerX = anchorLeft && anchorRight
        ? (anchorLeft.x + anchorRight.x) / 2
        : eyeMid.x;

    if (!(span > 0.018)) {
        span = eyeSpan;
        centerX = eyeMid.x;
    }

    if (!(span > 0.018)) return { reliable: false };

    return {
        reliable: true,
        yawProxy: (nose.x - centerX) / span,
        rollDeg: normalizeAngle180(lineAngle(leftEye, rightEye)),
        span
    };
}

function torsoAnalysis(imageLandmarks, referenceData, adaptiveTarget, frameWidth, frameHeight) {
    const toPx = lm => ({ x: lm.x * frameWidth, y: lm.y * frameHeight, z: Number(lm.z ?? 0) });
    const l11n = point(imageLandmarks, 11), l12n = point(imageLandmarks, 12);
    const l23n = point(imageLandmarks, 23), l24n = point(imageLandmarks, 24);
    if (!l11n || !l12n || !l23n || !l24n) {
        return { reliable: false, matched: true, level: "unknown" };
    }

    const l11 = toPx(l11n), l12 = toPx(l12n), l23 = toPx(l23n), l24 = toPx(l24n);
    const shoulderCenter = midpoint(l11, l12);
    const hipCenter = midpoint(l23, l24);
    const liveLean = normalizeAngle180(lineAngle(hipCenter, shoulderCenter) + 90);
    let liveShoulderTilt = normalizeAngle180(lineAngle(l11, l12));
    if (liveShoulderTilt > 90) liveShoulderTilt -= 180;
    if (liveShoulderTilt < -90) liveShoulderTilt += 180;

    const targetScreen = adaptiveTarget?.reference_pose_intent?.screen_orientation_2d ?? {};
    const targetLean = Number(targetScreen.body_lean_angle ?? referenceData?.pose?.body_lean_angle);
    const targetShoulderTilt = Number(targetScreen.shoulder_tilt_angle);
    const leanDelta = Number.isFinite(targetLean) ? normalizeAngle180(targetLean - liveLean) : null;
    const shoulderTiltDelta = Number.isFinite(targetShoulderTilt)
        ? normalizeAngle180(targetShoulderTilt - liveShoulderTilt)
        : null;

    const targetDepth = adaptiveTarget?.reference_pose_intent?.relative_depth_cues ?? {};
    const targetShoulderDepth = Number(targetDepth.shoulder_depth_difference);
    const targetHipDepth = Number(targetDepth.hip_depth_difference);
    const liveShoulderDepth = l11n.z - l12n.z;
    const liveHipDepth = l23n.z - l24n.z;
    const depthDeltas = [];
    if (Number.isFinite(targetShoulderDepth)) depthDeltas.push(targetShoulderDepth - liveShoulderDepth);
    if (Number.isFinite(targetHipDepth)) depthDeltas.push(targetHipDepth - liveHipDepth);
    const turnDelta = depthDeltas.length
        ? depthDeltas.reduce((a, b) => a + b, 0) / depthDeltas.length
        : null;

    const leanBad = Number.isFinite(leanDelta) && Math.abs(leanDelta) > 7;
    const shoulderBad = Number.isFinite(shoulderTiltDelta) && Math.abs(shoulderTiltDelta) > 8;
    const turnBad = Number.isFinite(turnDelta) && Math.abs(turnDelta) > 0.09;

    const severities = [
        Number.isFinite(leanDelta) ? Math.abs(leanDelta) / 10 : 0,
        Number.isFinite(shoulderTiltDelta) ? Math.abs(shoulderTiltDelta) / 11 : 0,
        Number.isFinite(turnDelta) ? Math.abs(turnDelta) / 0.13 : 0
    ];
    const maxSeverity = Math.max(...severities);

    return {
        reliable: true,
        matched: !(leanBad || shoulderBad || turnBad),
        level: maxSeverity <= 0.55 ? "good" : maxSeverity <= 1.0 ? "fair" : "bad",
        liveLean,
        targetLean,
        leanDelta,
        liveShoulderTilt,
        targetShoulderTilt,
        shoulderTiltDelta,
        liveShoulderDepth,
        liveHipDepth,
        targetShoulderDepth,
        targetHipDepth,
        turnDelta
    };
}

function headComparison(faceAnalysis, imageLandmarks, referenceData, isMirrored) {
    const refFace = referenceFaceAnalysis;
    let source = "FACE";
    let live, target;

    if (faceAnalysis?.headReliable && refFace?.headReliable) {
        live = faceAnalysis.head;
        target = refFace.head;
    } else {
        source = "POSE_FALLBACK";
        live = poseHeadAnalysis(imageLandmarks);
        target = poseHeadAnalysis(referenceData?.landmarks);
        if (!live?.reliable || !target?.reliable) {
            return { reliable: false, matched: true, level: "unknown", source: "UNAVAILABLE" };
        }
    }

    const yawDelta = Number(target.yawProxy) - Number(live.yawProxy);
    const rollDelta = normalizeAngle180(Number(target.rollDeg) - Number(live.rollDeg));
    const matrixPitchDelta = source === "FACE" &&
        Number.isFinite(target.matrixPitchDeg) && Number.isFinite(live.matrixPitchDeg)
        ? normalizeAngle180(target.matrixPitchDeg - live.matrixPitchDeg)
        : null;

    const yawThreshold = source === "FACE" ? 0.060 : 0.095;
    const rollThreshold = source === "FACE" ? 8.5 : 11;
    const pitchThreshold = 10;

    const yawBad = Math.abs(yawDelta) > yawThreshold;
    const rollBad = Math.abs(rollDelta) > rollThreshold;
    const pitchBad = Number.isFinite(matrixPitchDelta) && Math.abs(matrixPitchDelta) > pitchThreshold;

    const maxNorm = Math.max(
        Math.abs(yawDelta) / yawThreshold,
        Math.abs(rollDelta) / rollThreshold,
        Number.isFinite(matrixPitchDelta) ? Math.abs(matrixPitchDelta) / pitchThreshold : 0
    );

    return {
        reliable: true,
        source,
        matched: !(yawBad || rollBad || pitchBad),
        level: maxNorm <= 0.60 ? "good" : maxNorm <= 1.0 ? "fair" : "bad",
        yawDelta,
        rollDelta,
        pitchDelta: matrixPitchDelta,
        yawThreshold,
        rollThreshold,
        pitchThreshold,
        isMirrored
    };
}

function makeAction(key, text, phase, severity, details = {}) {
    return {
        key,
        text,
        actor: "MODEL",
        actorLabel: "모델",
        phase,
        severity,
        priorityScore: 100 + clamp(severity, 0, 2) * 8,
        details
    };
}

function stabilizeAction(rawAction, now) {
    if (!rawAction) {
        state.pendingKey = null;
        state.pendingAction = null;
        if (state.activeAction && now - state.activeLastSeenAt <= ACTION_CLEAR_GRACE_MS) {
            return state.activeAction;
        }
        state.activeAction = null;
        return null;
    }

    if (state.activeAction?.key === rawAction.key) {
        state.activeAction = rawAction;
        state.activeLastSeenAt = now;
        state.pendingKey = null;
        state.pendingAction = null;
        return rawAction;
    }

    if (state.pendingKey !== rawAction.key) {
        state.pendingKey = rawAction.key;
        state.pendingSince = now;
        state.pendingAction = rawAction;
        return state.activeAction;
    }

    state.pendingAction = rawAction;
    if (now - state.pendingSince >= ACTION_STABILITY_MS) {
        state.activeAction = state.pendingAction;
        state.activeLastSeenAt = now;
        state.pendingKey = null;
        state.pendingAction = null;
        return state.activeAction;
    }

    return state.activeAction;
}

export function setReferenceFaceAnalysis(analysis) {
    referenceFaceAnalysis = analysis ? JSON.parse(JSON.stringify(analysis)) : null;
}

export function getReferenceFaceAnalysis() {
    return referenceFaceAnalysis;
}

export function updateOrientationQuality({
    imageLandmarks,
    referenceData,
    adaptiveTarget,
    faceAnalysis = null,
    isMirrored = false,
    bodyMatched = false,
    frameWidth = 1,
    frameHeight = 1,
    now = performance.now()
}) {
    const torso = torsoAnalysis(
        imageLandmarks,
        referenceData,
        adaptiveTarget,
        frameWidth,
        frameHeight
    );

    const head = headComparison(faceAnalysis, imageLandmarks, referenceData, isMirrored);

    const eyes = {
        reliable: Boolean(faceAnalysis?.eyesReliable),
        closed: Boolean(faceAnalysis?.eyesReliable && faceAnalysis?.eyes?.closed),
        blinkMax: Number(faceAnalysis?.eyes?.blinkMax ?? 0)
    };

    let rawAction = null;

    // Only coach orientation after framing + limbs are already solved.
    if (bodyMatched) {
        if (torso.reliable && !torso.matched) {
            const options = [];

            if (Number.isFinite(torso.turnDelta) && Math.abs(torso.turnDelta) > 0.09) {
                options.push({
                    severity: Math.abs(torso.turnDelta) / 0.13,
                    action: makeAction(
                        torso.turnDelta < 0 ? "TORSO_LEFT_FORWARD" : "TORSO_RIGHT_FORWARD",
                        torso.turnDelta < 0
                            ? "왼쪽 어깨를 살짝 앞으로 보내주세요."
                            : "오른쪽 어깨를 살짝 앞으로 보내주세요.",
                        "TORSO_ORIENTATION",
                        Math.abs(torso.turnDelta) / 0.13,
                        { source: "TORSO_DEPTH", ...torso }
                    )
                });
            }

            if (Number.isFinite(torso.leanDelta) && Math.abs(torso.leanDelta) > 7) {
                let sign = Math.sign(torso.leanDelta);
                if (isMirrored) sign *= -1;
                options.push({
                    severity: Math.abs(torso.leanDelta) / 10,
                    action: makeAction(
                        sign > 0 ? "TORSO_LEAN_RIGHT" : "TORSO_LEAN_LEFT",
                        sign > 0
                            ? "상체를 오른쪽으로 살짝 기울여주세요."
                            : "상체를 왼쪽으로 살짝 기울여주세요.",
                        "TORSO_ORIENTATION",
                        Math.abs(torso.leanDelta) / 10,
                        { source: "TORSO_LEAN", ...torso }
                    )
                });
            }

            if (Number.isFinite(torso.shoulderTiltDelta) && Math.abs(torso.shoulderTiltDelta) > 8) {
                options.push({
                    severity: Math.abs(torso.shoulderTiltDelta) / 11,
                    action: makeAction(
                        torso.shoulderTiltDelta > 0 ? "LEFT_SHOULDER_UP" : "RIGHT_SHOULDER_UP",
                        torso.shoulderTiltDelta > 0
                            ? "왼쪽 어깨를 살짝 올려주세요."
                            : "오른쪽 어깨를 살짝 올려주세요.",
                        "TORSO_ORIENTATION",
                        Math.abs(torso.shoulderTiltDelta) / 11,
                        { source: "SHOULDER_TILT", ...torso }
                    )
                });
            }

            options.sort((a, b) => b.severity - a.severity);
            rawAction = options[0]?.action ?? null;
        }
        else if (head.reliable && !head.matched) {
            const options = [];
            if (Math.abs(head.yawDelta) > head.yawThreshold) {
                let visual = Math.sign(head.yawDelta);
                if (isMirrored) visual *= -1;
                options.push({
                    severity: Math.abs(head.yawDelta) / head.yawThreshold,
                    action: makeAction(
                        visual > 0 ? "HEAD_TURN_RIGHT" : "HEAD_TURN_LEFT",
                        visual > 0
                            ? "고개를 오른쪽으로 조금 돌려주세요."
                            : "고개를 왼쪽으로 조금 돌려주세요.",
                        "HEAD_ORIENTATION",
                        Math.abs(head.yawDelta) / head.yawThreshold,
                        { source: head.source, ...head }
                    )
                });
            }

            if (Math.abs(head.rollDelta) > head.rollThreshold) {
                let visual = Math.sign(head.rollDelta);
                if (isMirrored) visual *= -1;
                options.push({
                    severity: Math.abs(head.rollDelta) / head.rollThreshold,
                    action: makeAction(
                        visual > 0 ? "HEAD_TILT_RIGHT" : "HEAD_TILT_LEFT",
                        visual > 0
                            ? "고개를 오른쪽으로 살짝 기울여주세요."
                            : "고개를 왼쪽으로 살짝 기울여주세요.",
                        "HEAD_ORIENTATION",
                        Math.abs(head.rollDelta) / head.rollThreshold,
                        { source: head.source, ...head }
                    )
                });
            }

            if (Number.isFinite(head.pitchDelta) && Math.abs(head.pitchDelta) > head.pitchThreshold) {
                options.push({
                    severity: Math.abs(head.pitchDelta) / head.pitchThreshold,
                    action: makeAction(
                        "HEAD_PITCH",
                        "턱 높이를 Reference에 조금 더 맞춰주세요.",
                        "HEAD_ORIENTATION",
                        Math.abs(head.pitchDelta) / head.pitchThreshold,
                        { source: "FACE_MATRIX", ...head }
                    )
                });
            }

            options.sort((a, b) => b.severity - a.severity);
            rawAction = options[0]?.action ?? null;
        }
        else if (eyes.reliable && eyes.closed) {
            rawAction = makeAction(
                "EYES_OPEN",
                "눈을 잠깐 크게 떠주세요.",
                "CAPTURE_QUALITY",
                1.4,
                { source: "FACE_BLENDSHAPE", blinkMax: eyes.blinkMax }
            );
        }
    }

    const action = stabilizeAction(rawAction, now);

    // Gaze is intentionally diagnostic-only in v4. It is useful when reliable,
    // but not trusted enough at full-body distance to block the shutter.
    let gaze = { reliable: false, matched: true, live: null, target: null };
    if (
        faceAnalysis?.gazeReliable &&
        referenceFaceAnalysis?.gazeReliable
    ) {
        gaze = {
            reliable: true,
            live: faceAnalysis.gaze.direction,
            target: referenceFaceAnalysis.gaze.direction,
            matched: faceAnalysis.gaze.direction === referenceFaceAnalysis.gaze.direction
        };
    }

    const captureReady = Boolean(
        (!torso.reliable || torso.matched) &&
        (!head.reliable || head.matched) &&
        (!eyes.reliable || !eyes.closed)
    );

    return {
        ready: true,
        bodyMatched,
        captureReady,
        phase: action?.phase ?? (captureReady ? "ORIENTATION_READY" : "ORIENTATION_PENDING"),
        actor: action?.actor ?? "MODEL",
        action,
        rawAction,
        torso,
        head,
        eyes,
        gaze,
        face: faceAnalysis ? {
            detected: Boolean(faceAnalysis.detected),
            headReliable: Boolean(faceAnalysis.headReliable),
            eyesReliable: Boolean(faceAnalysis.eyesReliable),
            faceWidth: faceAnalysis.faceWidth ?? null,
            faceHeight: faceAnalysis.faceHeight ?? null
        } : { detected: false, headReliable: false, eyesReliable: false }
    };
}

export function estimatePersonSharpness(canvas, snapshot = null) {
    try {
        if (!canvas?.width || !canvas?.height) {
            return { available: false, level: "unknown", value: null };
        }

        let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
        const c = snapshot?.composition;
        if (c) {
            const padX = Math.max(12, (c.currentRight - c.currentLeft) * 0.08);
            const padY = Math.max(12, (c.currentBottom - c.currentTop) * 0.06);
            sx = clamp(Math.floor(c.currentLeft - padX), 0, canvas.width - 1);
            sy = clamp(Math.floor(c.currentTop - padY), 0, canvas.height - 1);
            const right = clamp(Math.ceil(c.currentRight + padX), sx + 1, canvas.width);
            const bottom = clamp(Math.ceil(c.currentBottom + padY), sy + 1, canvas.height);
            sw = right - sx;
            sh = bottom - sy;
        }

        if (sw < 24 || sh < 24) return { available: false, level: "unknown", value: null };

        const maxSide = 320;
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const w = Math.max(24, Math.round(sw * scale));
        const h = Math.max(24, Math.round(sh * scale));
        const temp = document.createElement("canvas");
        temp.width = w;
        temp.height = h;
        const tctx = temp.getContext("2d", { willReadFrequently: true });
        tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
        const data = tctx.getImageData(0, 0, w, h).data;
        const gray = new Float32Array(w * h);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }

        let sum = 0, sumSq = 0, count = 0;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                const lap = gray[i - w] + gray[i - 1] - 4 * gray[i] + gray[i + 1] + gray[i + w];
                sum += lap;
                sumSq += lap * lap;
                count++;
            }
        }
        if (!count) return { available: false, level: "unknown", value: null };
        const mean = sum / count;
        const variance = Math.max(0, sumSq / count - mean * mean);

        // Conservative thresholds: only very low values trigger a hard retake.
        const level = variance < 22 ? "bad" : variance < 45 ? "fair" : "good";
        return { available: true, level, value: variance };
    } catch (error) {
        console.warn("[QUALITY v4] sharpness analysis failed", error);
        return { available: false, level: "unknown", value: null };
    }
}

export function resetOrientationQuality() {
    state = createState();
}
