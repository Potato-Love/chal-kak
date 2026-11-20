// Photo Guide - Guidance Engine v4.6
// Matcher-aligned staged guidance: framing first, pose second, with MODEL/PHOTOGRAPHER separation.
//
// Design principles:
// - framing before fine pose details
// - user-actionable directions, not raw error labels
// - temporal stabilization to stop cue ping-pong
// - confidence gates: if a direction is not reliable, stay generic

const VISIBILITY_THRESHOLD = 0.5;
const ACTION_STABILITY_MS = 480;
const OPPOSITE_ACTION_STABILITY_MS = 900;
const ACTION_MIN_HOLD_MS = 1400;
const ACTION_CLEAR_GRACE_MS = 520;
const SUBJECT_LOSS_GRACE_MS = 1100;
const ACTIVE_ACTION_SCORE_HYSTERESIS = 12;

const BODY_INDICES = [
    11, 12, 13, 14, 15, 16,
    23, 24, 25, 26, 27, 28
];

let state = createState();

function createState() {
    return {
        pendingKey: null,
        pendingSince: 0,
        pendingAction: null,
        activeAction: null,
        activeLastSeenAt: 0,
        activeSince: 0,
        lastSubjectSeenAt: null,
        previousMotionPoints: null,
        previousMotionAt: null,
        motionSpeedEma: 0
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function mean(values) {
    if (!values.length) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function midpoint2(a, b) {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
    };
}

function distance2(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeAngle180(angle) {
    let value = ((angle + 180) % 360 + 360) % 360 - 180;
    if (value === -180) value = 180;
    return value;
}

function normalizeAxisTilt(angle) {
    let value = normalizeAngle180(angle);
    if (value > 90) value -= 180;
    if (value < -90) value += 180;
    return value;
}

function lineAngle(a, b) {
    return Math.atan2(
        b.y - a.y,
        b.x - a.x
    ) * 180 / Math.PI;
}

function jointAngle2D(a, b, c) {
    const angle1 = Math.atan2(
        a.y - b.y,
        a.x - b.x
    );

    const angle2 = Math.atan2(
        c.y - b.y,
        c.x - b.x
    );

    let angle = Math.abs(
        (angle2 - angle1) * 180 / Math.PI
    );

    if (angle > 180) {
        angle = 360 - angle;
    }

    return angle;
}

function isUsable(lm) {
    if (!lm) return false;

    const visibility =
        lm.visibility === undefined
            ? 1
            : Number(lm.visibility);

    return (
        visibility >= VISIBILITY_THRESHOLD &&
        Number(lm.x) >= 0 &&
        Number(lm.x) <= 1 &&
        Number(lm.y) >= 0 &&
        Number(lm.y) <= 1
    );
}

function isFiniteLandmark(lm, minVisibility = 0.15) {
    if (!lm) return false;

    const x = Number(lm.x);
    const y = Number(lm.y);
    const visibility =
        lm.visibility === undefined
            ? 1
            : Number(lm.visibility);

    return (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        visibility >= minVisibility
    );
}

function getSubjectPresence(imageLandmarks) {
    if (!imageLandmarks?.length) {
        return {
            detected: false,
            coreCount: 0,
            trackedBodyCount: 0
        };
    }

    const core = [11, 12, 23, 24];

    const coreCount = core.filter(
        index => isFiniteLandmark(imageLandmarks[index], 0.18)
    ).length;

    const trackedBodyCount = BODY_INDICES.filter(
        index => isFiniteLandmark(imageLandmarks[index], 0.12)
    ).length;

    return {
        detected:
            coreCount >= 2 &&
            trackedBodyCount >= 5,
        coreCount,
        trackedBodyCount
    };
}

function getReferenceLandmark(referenceData, index) {
    const source = referenceData?.landmarks;
    if (!source) return null;

    const lm = source[String(index)] ?? source[index];
    if (!lm) return null;

    return {
        x: Number(lm.x),
        y: Number(lm.y),
        z: Number(lm.z ?? 0)
    };
}

function getLiveBBox(imageLandmarks) {
    if (!imageLandmarks?.length) return null;

    const xs = [];
    const ys = [];

    // Composition is a 2D framing problem. Use a low visibility gate
    // and keep slightly off-screen coordinates instead of tying framing
    // to strict 3D visibility.
    for (const lm of imageLandmarks) {
        if (!isFiniteLandmark(lm, 0.12)) continue;
        xs.push(Number(lm.x));
        ys.push(Number(lm.y));
    }

    if (xs.length < 8) return null;

    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);

    return {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2,
        clipped:
            left < -0.02 ||
            right > 1.02 ||
            top < -0.02 ||
            bottom > 1.02,
        pointCount: xs.length
    };
}

function getTorsoLength2D(landmarksLike, getter) {
    const l11 = getter(landmarksLike, 11);
    const l12 = getter(landmarksLike, 12);
    const l23 = getter(landmarksLike, 23);
    const l24 = getter(landmarksLike, 24);

    if (!l11 || !l12 || !l23 || !l24) {
        return null;
    }

    const shoulderCenter = midpoint2(l11, l12);
    const hipCenter = midpoint2(l23, l24);

    return distance2(shoulderCenter, hipCenter);
}

function liveGetter(source, index) {
    const lm = source?.[index];
    if (!isUsable(lm)) return null;
    return {
        x: Number(lm.x),
        y: Number(lm.y),
        z: Number(lm.z ?? 0)
    };
}

function referenceGetter(source, index) {
    return getReferenceLandmark(source, index);
}

function updateMotion(imageLandmarks, now) {
    const current = {};

    for (const index of BODY_INDICES) {
        const lm = imageLandmarks?.[index];
        if (!isUsable(lm)) continue;
        current[index] = {
            x: Number(lm.x),
            y: Number(lm.y)
        };
    }

    let rawSpeed = 0;

    if (
        state.previousMotionPoints &&
        state.previousMotionAt !== null
    ) {
        const dt = (now - state.previousMotionAt) / 1000;

        if (dt > 0.008 && dt < 0.5) {
            const displacements = [];

            for (const index of BODY_INDICES) {
                const a = state.previousMotionPoints[index];
                const b = current[index];
                if (!a || !b) continue;

                displacements.push(
                    Math.hypot(b.x - a.x, b.y - a.y) / dt
                );
            }

            rawSpeed = mean(displacements) ?? 0;
        }
    }

    state.previousMotionPoints = current;
    state.previousMotionAt = now;

    const alpha = 0.28;
    state.motionSpeedEma =
        state.motionSpeedEma * (1 - alpha) +
        rawSpeed * alpha;

    return {
        speed: state.motionSpeedEma,
        stable: state.motionSpeedEma < 0.24,
        veryStable: state.motionSpeedEma < 0.13
    };
}

function candidate(
    key,
    text,
    basePriority,
    severity,
    details = {},
    actor = "MODEL",
    phase = "MODEL_POSE"
) {
    const normalizedSeverity = clamp(severity, 0, 2.5);

    return {
        key,
        text,
        actor,
        actorLabel:
            actor === "PHOTOGRAPHER"
                ? "촬영자"
                : actor === "MODEL"
                    ? "모델"
                    : "시스템",
        phase,
        priorityScore:
            basePriority + normalizedSeverity * 8,
        severity: normalizedSeverity,
        details
    };
}

function safeRatio(a, b) {
    return (
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        Math.abs(b) > 1e-6
    )
        ? a / b
        : null;
}

function addCompositionCandidates(
    candidates,
    compositionState,
    isMirrored
) {
    const c = compositionState;

    if (!c?.current || !c?.target) {
        return {
            scaleRatio: null,
            heightRatio: null,
            widthRatio: null,
            shoulderRatio: null,
            hipRatio: null,
            torsoRatio: null,
            centerErrorX: null,
            centerErrorY: null,
            distanceEvidence: "unavailable"
        };
    }

    const current = c.current;
    const target = c.target;
    const s = c.scaleSignals ?? {};

    const heightRatio = Number(s.heightRatio);
    const widthRatio = Number(s.widthRatio);
    const shoulderRatio = Number(s.shoulderRatio);
    const hipRatio = Number(s.hipRatio);
    const torsoRatio = Number(s.torsoRatio);

    const secondary = [
        shoulderRatio,
        hipRatio,
        torsoRatio
    ].filter(Number.isFinite);

    const backVotes = secondary.filter(r => r > 1.12).length;
    const forwardVotes = secondary.filter(r => r < 0.88).length;

    // Distance is intentionally conservative. A single bbox-height value is
    // NOT enough because pose compression/crouching can make a nearby person
    // look artificially small. We require agreement from body-scale signals.
    const confidentTooClose =
        Number.isFinite(heightRatio) &&
        heightRatio > 1.18 &&
        backVotes >= 1;

    const confidentTooFar =
        Number.isFinite(heightRatio) &&
        heightRatio < 0.82 &&
        Boolean(c.visibility?.fullBodyVisible) &&
        forwardVotes >= 2;

    let distanceEvidence = "neutral";

    if (confidentTooClose) {
        distanceEvidence = "too_close";
        candidates.push(
            candidate(
                "MODEL_MOVE_BACK",
                "조금만 뒤로 가주세요.",
                120,
                Math.max(
                    (heightRatio - 1.18) / 0.20,
                    backVotes / 3
                ),
                {
                    heightRatio,
                    widthRatio,
                    shoulderRatio,
                    hipRatio,
                    torsoRatio,
                    backVotes
                },
                "MODEL",
                "MODEL_POSITION"
            )
        );
    }
    else if (confidentTooFar) {
        distanceEvidence = "too_far";
        candidates.push(
            candidate(
                "MODEL_MOVE_FORWARD",
                "조금만 앞으로 와주세요.",
                120,
                Math.max(
                    (0.82 - heightRatio) / 0.20,
                    forwardVotes / 3
                ),
                {
                    heightRatio,
                    widthRatio,
                    shoulderRatio,
                    hipRatio,
                    torsoRatio,
                    forwardVotes
                },
                "MODEL",
                "MODEL_POSITION"
            )
        );
    }

    const currentCenterX = Number(current.centerX);
    const currentCenterY = Number(current.centerY);
    const targetCenterX = Number(target.centerX);
    const targetCenterY = Number(target.centerY);
    const targetWidth = Math.max(Number(target.width) || 0, 1);
    const targetHeight = Math.max(Number(target.height) || 0, 1);

    const rawCenterErrorX =
        Number.isFinite(targetCenterX) && Number.isFinite(currentCenterX)
            ? (targetCenterX - currentCenterX) / targetWidth
            : null;

    const centerErrorX =
        Number.isFinite(rawCenterErrorX)
            ? (isMirrored ? -rawCenterErrorX : rawCenterErrorX)
            : null;

    const centerErrorY =
        Number.isFinite(targetCenterY) && Number.isFinite(currentCenterY)
            ? (targetCenterY - currentCenterY) / targetHeight
            : null;

    // Subject horizontal placement is a MODEL action, not a camera action.
    if (
        !confidentTooClose &&
        !confidentTooFar &&
        Number.isFinite(centerErrorX) &&
        Math.abs(centerErrorX) > 0.055
    ) {
        candidates.push(
            candidate(
                centerErrorX > 0
                    ? "MODEL_MOVE_SCREEN_RIGHT"
                    : "MODEL_MOVE_SCREEN_LEFT",
                centerErrorX > 0
                    ? "조금만 오른쪽으로 와주세요."
                    : "조금만 왼쪽으로 와주세요.",
                112,
                (Math.abs(centerErrorX) - 0.055) / 0.12,
                { centerErrorX },
                "MODEL",
                "MODEL_POSITION"
            )
        );
    }

    // Vertical framing is explicitly a PHOTOGRAPHER action and is only
    // considered after model distance/horizontal placement are acceptable.
    if (
        !confidentTooClose &&
        !confidentTooFar &&
        (!Number.isFinite(centerErrorX) || Math.abs(centerErrorX) <= 0.075) &&
        Number.isFinite(centerErrorY) &&
        Math.abs(centerErrorY) > 0.075
    ) {
        candidates.push(
            candidate(
                centerErrorY > 0
                    ? "PHOTOGRAPHER_CAMERA_UP"
                    : "PHOTOGRAPHER_CAMERA_DOWN",
                centerErrorY > 0
                    ? "카메라를 살짝 위로 올려주세요."
                    : "카메라를 살짝 아래로 내려주세요.",
                104,
                (Math.abs(centerErrorY) - 0.075) / 0.14,
                { centerErrorY },
                "PHOTOGRAPHER",
                "PHOTOGRAPHER_FRAMING"
            )
        );
    }

    // Hard fallback: when the app's exact composition matcher is false,
    // NEVER fall through to an arm/leg pose cue. Give a framing cue instead.
    if (c.matched === false && candidates.length === 0) {
        const horizontalMismatch =
            c.edges?.leftMatched === false ||
            c.edges?.rightMatched === false;

        const verticalMismatch =
            c.edges?.topMatched === false ||
            c.edges?.bottomMatched === false;

        if (horizontalMismatch && !verticalMismatch) {
            const dir = Number.isFinite(centerErrorX)
                ? Math.sign(centerErrorX)
                : 0;

            candidates.push(
                candidate(
                    dir >= 0
                        ? "MODEL_FRAME_RIGHT"
                        : "MODEL_FRAME_LEFT",
                    dir >= 0
                        ? "조금만 오른쪽으로 와주세요."
                        : "조금만 왼쪽으로 와주세요.",
                    96,
                    0.7,
                    { centerErrorX, fallback: true },
                    "MODEL",
                    "MODEL_POSITION"
                )
            );
        }
        else if (verticalMismatch) {
            const dir = Number.isFinite(centerErrorY)
                ? Math.sign(centerErrorY)
                : 0;

            candidates.push(
                candidate(
                    dir >= 0
                        ? "PHOTOGRAPHER_FRAME_UP"
                        : "PHOTOGRAPHER_FRAME_DOWN",
                    dir >= 0
                        ? "카메라를 살짝 위로 올려주세요."
                        : "카메라를 살짝 아래로 내려주세요.",
                    94,
                    0.7,
                    { centerErrorY, fallback: true },
                    "PHOTOGRAPHER",
                    "PHOTOGRAPHER_FRAMING"
                )
            );
        }
        else {
            candidates.push(
                candidate(
                    "PHOTOGRAPHER_CHECK_FRAMING",
                    "카메라 구도를 조금만 더 맞춰주세요.",
                    90,
                    0.6,
                    { fallback: true },
                    "PHOTOGRAPHER",
                    "PHOTOGRAPHER_FRAMING"
                )
            );
        }
    }

    return {
        scaleRatio: heightRatio,
        heightRatio,
        widthRatio,
        shoulderRatio,
        hipRatio,
        torsoRatio,
        centerErrorX,
        centerErrorY,
        distanceEvidence,
        backVotes,
        forwardVotes
    };
}

function addTorsoCandidates(
    candidates,
    imageLandmarks,
    adaptiveTarget,
    isMirrored
) {
    const l11 = liveGetter(imageLandmarks, 11);
    const l12 = liveGetter(imageLandmarks, 12);
    const l23 = liveGetter(imageLandmarks, 23);
    const l24 = liveGetter(imageLandmarks, 24);

    if (!l11 || !l12 || !l23 || !l24) {
        return {};
    }

    const shoulderCenter = midpoint2(l11, l12);
    const hipCenter = midpoint2(l23, l24);

    const liveBodyLean =
        lineAngle(hipCenter, shoulderCenter) + 90;

    const liveShoulderTilt =
        normalizeAxisTilt(lineAngle(l11, l12));

    const targetScreen =
        adaptiveTarget?.reference_pose_intent?.screen_orientation_2d ?? {};

    const targetLean = Number(targetScreen.body_lean_angle);
    const targetShoulderTilt = Number(targetScreen.shoulder_tilt_angle);

    let leanDelta = null;

    if (Number.isFinite(targetLean)) {
        leanDelta = normalizeAngle180(targetLean - liveBodyLean);

        if (Math.abs(leanDelta) > 7.5) {
            // Convert raw-camera direction to displayed-screen direction.
            let displayDirection = Math.sign(leanDelta);
            if (isMirrored) displayDirection *= -1;

            candidates.push(
                candidate(
                    displayDirection > 0
                        ? "LEAN_SCREEN_RIGHT"
                        : "LEAN_SCREEN_LEFT",
                    displayDirection > 0
                        ? "상체를 화면 오른쪽으로 조금 기울여주세요."
                        : "상체를 화면 왼쪽으로 조금 기울여주세요.",
                    86,
                    (Math.abs(leanDelta) - 7.5) / 12,
                    {
                        liveBodyLean,
                        targetLean,
                        leanDelta
                    }
                )
            );
        }
    }

    let shoulderTiltDelta = null;

    if (Number.isFinite(targetShoulderTilt)) {
        shoulderTiltDelta =
            targetShoulderTilt - liveShoulderTilt;

        if (Math.abs(shoulderTiltDelta) > 8.5) {
            candidates.push(
                candidate(
                    shoulderTiltDelta > 0
                        ? "LEFT_SHOULDER_UP"
                        : "RIGHT_SHOULDER_UP",
                    shoulderTiltDelta > 0
                        ? "왼쪽 어깨를 조금 올려주세요."
                        : "오른쪽 어깨를 조금 올려주세요.",
                    70,
                    (Math.abs(shoulderTiltDelta) - 8.5) / 12,
                    {
                        liveShoulderTilt,
                        targetShoulderTilt,
                        shoulderTiltDelta
                    }
                )
            );
        }
    }

    const targetDepth =
        adaptiveTarget?.reference_pose_intent?.relative_depth_cues ?? {};

    const targetShoulderDepth =
        Number(targetDepth.shoulder_depth_difference);

    const targetHipDepth =
        Number(targetDepth.hip_depth_difference);

    const liveShoulderDepth = l11.z - l12.z;
    const liveHipDepth = l23.z - l24.z;

    const depthDeltas = [];

    if (Number.isFinite(targetShoulderDepth)) {
        depthDeltas.push(targetShoulderDepth - liveShoulderDepth);
    }

    if (Number.isFinite(targetHipDepth)) {
        depthDeltas.push(targetHipDepth - liveHipDepth);
    }

    const turnDelta = mean(depthDeltas);

    if (
        turnDelta !== null &&
        Math.abs(turnDelta) > 0.105
    ) {
        // z smaller = closer to camera in MediaPipe image landmarks.
        candidates.push(
            candidate(
                turnDelta < 0
                    ? "LEFT_SHOULDER_FORWARD"
                    : "RIGHT_SHOULDER_FORWARD",
                turnDelta < 0
                    ? "왼쪽 어깨를 조금 앞으로 보내세요."
                    : "오른쪽 어깨를 조금 앞으로 보내세요.",
                90,
                (Math.abs(turnDelta) - 0.105) / 0.16,
                {
                    liveShoulderDepth,
                    liveHipDepth,
                    targetShoulderDepth,
                    targetHipDepth,
                    turnDelta
                }
            )
        );
    }

    return {
        liveBodyLean,
        targetLean,
        leanDelta,
        liveShoulderTilt,
        targetShoulderTilt,
        shoulderTiltDelta,
        turnDelta
    };
}

function addJointCandidates(
    candidates,
    imageLandmarks,
    adaptiveTarget
) {
    const target =
        adaptiveTarget?.reference_pose_intent?.joint_angles_2d ?? {};

    const definitions = [
        {
            name: "left_elbow",
            indices: [11, 13, 15],
            bendKey: "LEFT_ELBOW_BEND",
            straightenKey: "LEFT_ELBOW_STRAIGHTEN",
            bendText: "왼팔을 조금 더 굽혀주세요.",
            straightenText: "왼팔을 조금 펴주세요.",
            base: 82,
            threshold: 13
        },
        {
            name: "right_elbow",
            indices: [12, 14, 16],
            bendKey: "RIGHT_ELBOW_BEND",
            straightenKey: "RIGHT_ELBOW_STRAIGHTEN",
            bendText: "오른팔을 조금 더 굽혀주세요.",
            straightenText: "오른팔을 조금 펴주세요.",
            base: 82,
            threshold: 13
        },
        {
            name: "left_knee",
            indices: [23, 25, 27],
            bendKey: "LEFT_KNEE_BEND",
            straightenKey: "LEFT_KNEE_STRAIGHTEN",
            bendText: "왼쪽 무릎을 조금 더 굽혀주세요.",
            straightenText: "왼쪽 무릎을 조금 펴주세요.",
            base: 80,
            threshold: 12
        },
        {
            name: "right_knee",
            indices: [24, 26, 28],
            bendKey: "RIGHT_KNEE_BEND",
            straightenKey: "RIGHT_KNEE_STRAIGHTEN",
            bendText: "오른쪽 무릎을 조금 더 굽혀주세요.",
            straightenText: "오른쪽 무릎을 조금 펴주세요.",
            base: 80,
            threshold: 12
        }
    ];

    const metrics = {};

    for (const def of definitions) {
        const [aIndex, bIndex, cIndex] = def.indices;
        const a = liveGetter(imageLandmarks, aIndex);
        const b = liveGetter(imageLandmarks, bIndex);
        const c = liveGetter(imageLandmarks, cIndex);
        const targetAngle = Number(target[def.name]);

        if (!a || !b || !c || !Number.isFinite(targetAngle)) {
            continue;
        }

        const liveAngle = jointAngle2D(a, b, c);
        const delta = targetAngle - liveAngle;

        metrics[def.name] = {
            live: liveAngle,
            target: targetAngle,
            delta
        };

        if (Math.abs(delta) <= def.threshold) {
            continue;
        }

        // Smaller joint angle = more bent.
        // If target - live < 0, target is more bent than live.
        const needBend = delta < 0;

        candidates.push(
            candidate(
                needBend ? def.bendKey : def.straightenKey,
                needBend ? def.bendText : def.straightenText,
                def.base,
                (Math.abs(delta) - def.threshold) / 20,
                {
                    joint: def.name,
                    liveAngle,
                    targetAngle,
                    delta
                }
            )
        );
    }

    return metrics;
}

function addLocalLimbCandidates(candidates, comparison) {
    const local = comparison?.body_local;

    if (!local?.live || !local?.target) {
        return {};
    }

    const live = local.live;
    const target = local.target;
    const metrics = {};

    const armDefs = [
        {
            side: "left",
            shoulder: 11,
            elbow: 13,
            wrist: 15,
            label: "왼손"
        },
        {
            side: "right",
            shoulder: 12,
            elbow: 14,
            wrist: 16,
            label: "오른손"
        }
    ];

    for (const def of armDefs) {
        const liveWrist = live[def.wrist];
        const targetWrist = target[def.wrist];
        const liveShoulder = live[def.shoulder];
        const targetShoulder = target[def.shoulder];

        if (!liveWrist || !targetWrist || !liveShoulder || !targetShoulder) {
            continue;
        }

        const liveUp = liveWrist.y - liveShoulder.y;
        const targetUp = targetWrist.y - targetShoulder.y;
        const upDelta = targetUp - liveUp;

        const liveOutward =
            def.side === "left"
                ? -(liveWrist.x - liveShoulder.x)
                : (liveWrist.x - liveShoulder.x);

        const targetOutward =
            def.side === "left"
                ? -(targetWrist.x - targetShoulder.x)
                : (targetWrist.x - targetShoulder.x);

        const outwardDelta =
            targetOutward - liveOutward;

        metrics[def.side] = {
            upDelta,
            outwardDelta
        };

        if (Math.abs(upDelta) > 0.16) {
            candidates.push(
                candidate(
                    upDelta > 0
                        ? `${def.side.toUpperCase()}_HAND_UP`
                        : `${def.side.toUpperCase()}_HAND_DOWN`,
                    upDelta > 0
                        ? `${def.label}을 조금 올려주세요.`
                        : `${def.label}을 조금 내려주세요.`,
                    78,
                    (Math.abs(upDelta) - 0.16) / 0.28,
                    {
                        side: def.side,
                        upDelta
                    }
                )
            );
        }

        if (Math.abs(outwardDelta) > 0.17) {
            candidates.push(
                candidate(
                    outwardDelta > 0
                        ? `${def.side.toUpperCase()}_HAND_OUT`
                        : `${def.side.toUpperCase()}_HAND_IN`,
                    outwardDelta > 0
                        ? `${def.label}을 몸에서 조금 바깥쪽으로 보내세요.`
                        : `${def.label}을 몸쪽으로 조금 붙여주세요.`,
                    74,
                    (Math.abs(outwardDelta) - 0.17) / 0.28,
                    {
                        side: def.side,
                        outwardDelta
                    }
                )
            );
        }
    }

    const legDefs = [
        {
            side: "left",
            hip: 23,
            ankle: 27,
            label: "왼발"
        },
        {
            side: "right",
            hip: 24,
            ankle: 28,
            label: "오른발"
        }
    ];

    for (const def of legDefs) {
        const liveAnkle = live[def.ankle];
        const targetAnkle = target[def.ankle];
        const liveHip = live[def.hip];
        const targetHip = target[def.hip];

        if (!liveAnkle || !targetAnkle || !liveHip || !targetHip) {
            continue;
        }

        const liveOutward =
            def.side === "left"
                ? -(liveAnkle.x - liveHip.x)
                : (liveAnkle.x - liveHip.x);

        const targetOutward =
            def.side === "left"
                ? -(targetAnkle.x - targetHip.x)
                : (targetAnkle.x - targetHip.x);

        const outwardDelta =
            targetOutward - liveOutward;

        metrics[`${def.side}_leg`] = {
            outwardDelta
        };

        if (Math.abs(outwardDelta) > 0.15) {
            candidates.push(
                candidate(
                    outwardDelta > 0
                        ? `${def.side.toUpperCase()}_FOOT_OUT`
                        : `${def.side.toUpperCase()}_FOOT_IN`,
                    outwardDelta > 0
                        ? `${def.label}을 조금 바깥쪽으로 옮겨주세요.`
                        : `${def.label}을 몸쪽으로 조금 옮겨주세요.`,
                    72,
                    (Math.abs(outwardDelta) - 0.15) / 0.26,
                    {
                        side: def.side,
                        outwardDelta
                    }
                )
            );
        }
    }

    return metrics;
}


function normalizeVector2(dx, dy) {
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1e-6) return null;
    return { x: dx / length, y: dy / length };
}

function endpointDirectionCue(part) {
    if (!part?.currentStart || !part?.currentEnd || !part?.targetStart || !part?.targetEnd) {
        return null;
    }

    const currentVec = normalizeVector2(
        part.currentEnd.x - part.currentStart.x,
        part.currentEnd.y - part.currentStart.y
    );
    const targetVec = normalizeVector2(
        part.targetEnd.x - part.targetStart.x,
        part.targetEnd.y - part.targetStart.y
    );

    if (!currentVec || !targetVec) return null;

    const dx = targetVec.x - currentVec.x;
    const dy = targetVec.y - currentVec.y;

    if (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.04) {
        return null;
    }

    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const label = part.endpointLabel ?? '관절';

    if (horizontal) {
        return {
            keySuffix: dx > 0 ? 'RIGHT' : 'LEFT',
            text: `${label}을 화면 ${dx > 0 ? '오른쪽' : '왼쪽'}으로 조금 옮겨주세요.`,
            directionalError: Math.abs(dx)
        };
    }

    return {
        keySuffix: dy > 0 ? 'DOWN' : 'UP',
        text: `${label}을 화면 ${dy > 0 ? '아래쪽' : '위쪽'}으로 조금 옮겨주세요.`,
        directionalError: Math.abs(dy)
    };
}

function cameraRelativeDepthCue(part) {
    const depth = part?.cameraDepth;

    if (
        !depth?.reliable ||
        !depth.pronounced ||
        depth.matched !== false ||
        !Number.isFinite(Number(depth.delta))
    ) {
        return null;
    }

    const delta = Number(depth.delta);
    if (Math.abs(delta) < 0.10) {
        return null;
    }

    const label = part.endpointLabel ?? "관절";

    // MediaPipe camera-relative z: a smaller value means closer to camera.
    // target - live < 0 => Reference endpoint is closer to camera.
    if (delta < 0) {
        return {
            keySuffix: "TOWARD_CAMERA",
            text: `${label}을 카메라 쪽으로 조금 내밀어주세요.`,
            directionalError: Math.abs(delta),
            axis: "camera_z"
        };
    }

    return {
        keySuffix: "AWAY_FROM_CAMERA",
        text: `${label}을 카메라에서 조금 멀어지게 빼주세요.`,
        directionalError: Math.abs(delta),
        axis: "camera_z"
    };
}

function bodyLocalPlanarDirectionCue(part) {
    const local = part?.local3D;

    if (
        !local?.currentStart ||
        !local?.currentEnd ||
        !local?.targetStart ||
        !local?.targetEnd
    ) {
        return null;
    }

    const vec = (a, b) => ({
        x: b.x - a.x,
        y: b.y - a.y
    });

    const live = vec(local.currentStart, local.currentEnd);
    const target = vec(local.targetStart, local.targetEnd);

    const dx = target.x - live.x;
    const dy = target.y - live.y;

    const label = part.endpointLabel ?? "관절";
    const side = part.side ?? null;

    if (
        Math.abs(dx) < 0.055 &&
        Math.abs(dy) < 0.055
    ) {
        return null;
    }

    if (Math.abs(dy) >= Math.abs(dx)) {
        return {
            keySuffix: dy > 0 ? "UP" : "DOWN",
            text: `${label}을 조금 ${dy > 0 ? "올려" : "내려"}주세요.`,
            directionalError: Math.abs(dy),
            axis: "body_y"
        };
    }

    if (side) {
        const outward =
            side === "left"
                ? dx < 0
                : dx > 0;

        return {
            keySuffix: outward ? "OUT" : "IN",
            text: outward
                ? `${label}을 몸에서 조금 바깥쪽으로 보내주세요.`
                : `${label}을 몸쪽으로 조금 붙여주세요.`,
            directionalError: Math.abs(dx),
            axis: "body_x"
        };
    }

    return null;
}

function addMatcherAlignedPoseCandidates(candidates, poseMatchState) {
    if (!poseMatchState?.parts) return {};

    const metrics = {};
    const jointTolerance = Number(poseMatchState.jointAngleTolerance) || 9;
    const hipTolerance = Number(poseMatchState.hipAngleTolerance) || 10;
    const segmentTolerance = Number(poseMatchState.segmentAngleTolerance) || 9;
    const joint3DTolerance = Number(poseMatchState.joint3DTolerance) || 11;
    const segment3DTolerance = Number(poseMatchState.segment3DTolerance) || 12;

    const p = poseMatchState.parts;

    const jointGroups = [
        {
            keys: ["leftUpperArm", "leftForearm"],
            cue: "LEFT_ELBOW",
            label: "왼팔",
            bend: "왼팔을 조금 더 굽혀주세요.",
            straighten: "왼팔을 조금 펴주세요."
        },
        {
            keys: ["rightUpperArm", "rightForearm"],
            cue: "RIGHT_ELBOW",
            label: "오른팔",
            bend: "오른팔을 조금 더 굽혀주세요.",
            straighten: "오른팔을 조금 펴주세요."
        },
        {
            keys: ["leftLowerLeg"],
            cue: "LEFT_KNEE",
            label: "왼쪽 무릎",
            bend: "왼쪽 무릎을 조금 더 굽혀주세요.",
            straighten: "왼쪽 무릎을 조금 펴주세요."
        },
        {
            keys: ["rightLowerLeg"],
            cue: "RIGHT_KNEE",
            label: "오른쪽 무릎",
            bend: "오른쪽 무릎을 조금 더 굽혀주세요.",
            straighten: "오른쪽 무릎을 조금 펴주세요."
        }
    ];

    const handledByJoint = new Set();

    // v4.2 rule: flexion/extension is semantic. If the elbow/knee angle is
    // wrong, BEND/STRAIGHTEN always wins over endpoint translation.
    for (const group of jointGroups) {
        const parts = group.keys.map(k => p[k]).filter(Boolean);
        const visibleUnmatched = parts.filter(part => part.visible !== false && !part.matched);
        if (!visibleUnmatched.length) continue;

        const representative = visibleUnmatched[0];
        const joint2d = Number(representative.jointDiff);
        const joint3d = Number(representative.joint3DDiff);
        const jointWrong =
            Number.isFinite(joint2d) &&
            joint2d > jointTolerance;

        if (!jointWrong) continue;

        const signed2d = Number(representative.signedJointDelta);
        const signed = signed2d;
        if (!Number.isFinite(signed)) continue;

        // Smaller target angle => target is more bent.
        const needBend = signed < 0;
        const severity = Math.max(
            Number.isFinite(joint2d) ? joint2d / jointTolerance : 0,
            1.01
        );

        candidates.push(
            candidate(
                `${group.cue}_${needBend ? "BEND" : "STRAIGHTEN"}`,
                needBend ? group.bend : group.straighten,
                128,
                severity - 1,
                {
                    source: "JOINT_FLEXION_PRIORITY",
                    joint2d,
                    joint3d,
                    signed
                },
                "MODEL",
                "MODEL_POSE"
            )
        );

        group.keys.forEach(k => handledByJoint.add(k));
    }


    const defs = [
        ["leftUpperArm", "LEFT_UPPER_ARM", "left"],
        ["leftForearm", "LEFT_FOREARM", "left"],
        ["rightUpperArm", "RIGHT_UPPER_ARM", "right"],
        ["rightForearm", "RIGHT_FOREARM", "right"],
        ["leftThigh", "LEFT_THIGH", "left"],
        ["leftLowerLeg", "LEFT_LOWER_LEG", "left"],
        ["rightThigh", "RIGHT_THIGH", "right"],
        ["rightLowerLeg", "RIGHT_LOWER_LEG", "right"]
    ];

    for (const [key, cuePrefix, side] of defs) {
        const part = p[key];
        if (
            !part ||
            part.visible === false ||
            part.matched === true ||
            handledByJoint.has(key)
        ) {
            continue;
        }

        part.side = side;
        const jointDiff = Number(part.jointDiff);
        const segment2d = Number(part.segmentDiff);
        const segment3d = Number(part.segment3DDiff);
        const jTol = key.includes("Thigh") ? hipTolerance : jointTolerance;

        // v4.6: action severity follows the photographic 2D matcher.
        // Monocular 3D errors remain debug-only and may not dominate guidance.
        const severity = Math.max(
            Number.isFinite(jointDiff) ? jointDiff / jTol : 0,
            Number.isFinite(segment2d) ? segment2d / segmentTolerance : 0,
            1.01
        );

        metrics[key] = {
            jointDiff,
            segment2d,
            segment3d,
            severity
        };

        // v4.6: once bend/straighten is correct, follow the visible
        // Reference projection. Never infer "toward/away from camera" from
        // monocular z for a user-facing cue.
        const endpointDirection = endpointDirectionCue(part);
        const direction = endpointDirection;

        if (direction) {
            candidates.push(
                candidate(
                    `${cuePrefix}_${direction.keySuffix}`,
                    direction.text,
                    112,
                    Math.max(severity - 1, direction.directionalError),
                    {
                        source: "REFERENCE_2D_ENDPOINT",
                        part: key,
                        jointDiff,
                        segment2d,
                        segment3d,
                        axis: "image_xy",
                        directionalError: direction.directionalError
                    },
                    "MODEL",
                    "MODEL_POSE"
                )
            );
        } else {
            candidates.push(
                candidate(
                    `${cuePrefix}_ADJUST`,
                    `${part.partLabel ?? "해당 부위"} 모양을 레퍼런스에 조금 더 맞춰주세요.`,
                    104,
                    severity - 1,
                    {
                        source: "POSE_FIDELITY_FALLBACK",
                        part: key,
                        jointDiff,
                        segment2d,
                        segment3d
                    },
                    "MODEL",
                    "MODEL_POSE"
                )
            );
        }
    }

    return metrics;
}

function removeStaleActivePoseAction(validCandidates) {
    if (!state.activeAction || state.activeAction.phase !== 'MODEL_POSE') {
        return;
    }

    const stillValid = validCandidates.some(
        item => item.key === state.activeAction.key
    );

    if (!stillValid) {
        state.activeAction = null;
        state.activeSince = 0;
        state.activeLastSeenAt = 0;
        state.pendingKey = null;
        state.pendingAction = null;
    }
}

function isOppositeAction(a, b) {
    if (!a || !b) return false;

    const pairs = [
        ["MOVE_BACK", "MOVE_FORWARD"],
        ["MODEL_MOVE_BACK", "MODEL_MOVE_FORWARD"],
        ["MOVE_SCREEN_LEFT", "MOVE_SCREEN_RIGHT"],
        ["MODEL_MOVE_SCREEN_LEFT", "MODEL_MOVE_SCREEN_RIGHT"],
        ["MODEL_FRAME_LEFT", "MODEL_FRAME_RIGHT"],
        ["CAMERA_UP", "CAMERA_DOWN"],
        ["PHOTOGRAPHER_CAMERA_UP", "PHOTOGRAPHER_CAMERA_DOWN"],
        ["PHOTOGRAPHER_FRAME_UP", "PHOTOGRAPHER_FRAME_DOWN"],
        ["LEAN_SCREEN_LEFT", "LEAN_SCREEN_RIGHT"],
        ["LEFT_SHOULDER_UP", "RIGHT_SHOULDER_UP"],
        ["LEFT_SHOULDER_FORWARD", "RIGHT_SHOULDER_FORWARD"],
        ["LEFT_HAND_UP", "LEFT_HAND_DOWN"],
        ["RIGHT_HAND_UP", "RIGHT_HAND_DOWN"],
        ["LEFT_HAND_IN", "LEFT_HAND_OUT"],
        ["RIGHT_HAND_IN", "RIGHT_HAND_OUT"],
        ["LEFT_FOOT_IN", "LEFT_FOOT_OUT"],
        ["RIGHT_FOOT_IN", "RIGHT_FOOT_OUT"],
        ["LEFT_ELBOW_BEND", "LEFT_ELBOW_STRAIGHTEN"],
        ["RIGHT_ELBOW_BEND", "RIGHT_ELBOW_STRAIGHTEN"],
        ["LEFT_KNEE_BEND", "LEFT_KNEE_STRAIGHTEN"],
        ["RIGHT_KNEE_BEND", "RIGHT_KNEE_STRAIGHTEN"]
    ];

    return pairs.some(
        ([x, y]) =>
            (a === x && b === y) ||
            (a === y && b === x)
    );
}

function stabilizeAction(rawAction, now) {
    if (!rawAction) {
        state.pendingKey = null;
        state.pendingAction = null;

        if (
            state.activeAction &&
            now - state.activeLastSeenAt <= ACTION_CLEAR_GRACE_MS
        ) {
            return state.activeAction;
        }

        state.activeAction = null;
        state.activeSince = 0;
        return null;
    }

    // A framing/pose phase change or MODEL/PHOTOGRAPHER actor change is
    // semantically important. Do not keep a stale arm cue when framing breaks.
    if (
        state.activeAction &&
        (
            state.activeAction.phase !== rawAction.phase ||
            state.activeAction.actor !== rawAction.actor
        )
    ) {
        state.activeAction = rawAction;
        state.activeLastSeenAt = now;
        state.activeSince = now;
        state.pendingKey = null;
        state.pendingAction = null;
        return state.activeAction;
    }

    // If the same action is still the best action, refresh it immediately.
    if (
        state.activeAction &&
        state.activeAction.key === rawAction.key
    ) {
        state.activeAction = rawAction;
        state.activeLastSeenAt = now;
        state.pendingKey = null;
        state.pendingAction = null;
        return state.activeAction;
    }

    // Once a cue becomes active, keep it for a minimum time. This stops
    // left/right, forward/back, arm/leg ping-pong from frame noise.
    if (
        state.activeAction &&
        now - state.activeSince < ACTION_MIN_HOLD_MS
    ) {
        if (state.pendingKey !== rawAction.key) {
            state.pendingKey = rawAction.key;
            state.pendingSince = now;
        }
        state.pendingAction = rawAction;
        return state.activeAction;
    }

    if (state.pendingKey !== rawAction.key) {
        state.pendingKey = rawAction.key;
        state.pendingSince = now;
        state.pendingAction = rawAction;
        return state.activeAction;
    }

    state.pendingAction = rawAction;

    const requiredStability =
        state.activeAction &&
        isOppositeAction(
            state.activeAction.key,
            rawAction.key
        )
            ? OPPOSITE_ACTION_STABILITY_MS
            : ACTION_STABILITY_MS;

    if (now - state.pendingSince >= requiredStability) {
        state.activeAction = rawAction;
        state.activeLastSeenAt = now;
        state.activeSince = now;
        state.pendingKey = null;
        state.pendingAction = null;
    }

    return state.activeAction;
}

export function updateGuidance({
    imageLandmarks,
    comparison,
    adaptiveTarget,
    referenceData,
    compositionState = null,
    isMirrored = false,
    poseMatched = false,
    poseMatchState = null,
    compositionMatched = false,
    overallMatched = false,
    now = performance.now()
}) {
    const motion = updateMotion(imageLandmarks, now);
    const rawSubject = getSubjectPresence(imageLandmarks);

    if (rawSubject.detected) {
        state.lastSubjectSeenAt = now;
    }

    const subject = {
        ...rawSubject,
        rawDetected: rawSubject.detected,
        detected:
            rawSubject.detected ||
            (
                state.lastSubjectSeenAt !== null &&
                now - state.lastSubjectSeenAt <= SUBJECT_LOSS_GRACE_MS
            )
    };

    if (!subject.detected) {
        const rawAction = candidate(
            "WAIT_FOR_PERSON",
            "사람을 찾는 중이에요.",
            130,
            1,
            {},
            "SYSTEM",
            "ACQUIRE_SUBJECT"
        );

        const action = stabilizeAction(rawAction, now);

        return {
            ready: false,
            phase: "ACQUIRE_SUBJECT",
            actor: "SYSTEM",
            subject,
            comparisonReady: Boolean(comparison?.ready),
            comparisonReliable3D: false,
            action,
            motion,
            rawAction,
            candidates: []
        };
    }

    // ==========================================================
    // HARD STAGE 1: FRAMING
    // If composition is not matched, pose coaching is forbidden.
    // ==========================================================
    if (!compositionMatched) {
        const framingCandidates = [];

        const compositionMetrics = addCompositionCandidates(
            framingCandidates,
            compositionState,
            isMirrored
        );

        framingCandidates.sort(
            (a, b) => b.priorityScore - a.priorityScore
        );

        const rawAction = framingCandidates[0] ?? candidate(
            "PHOTOGRAPHER_CHECK_FRAMING",
            "카메라 구도를 조금만 더 맞춰주세요.",
            90,
            0.5,
            { fallback: true },
            "PHOTOGRAPHER",
            "PHOTOGRAPHER_FRAMING"
        );

        const action = stabilizeAction(rawAction, now);

        return {
            ready: true,
            phase: action?.phase ?? rawAction.phase,
            actor: action?.actor ?? rawAction.actor,
            subject,
            comparisonReady: Boolean(comparison?.ready),
            comparisonReliable3D: Boolean(
                comparison?.ready &&
                comparison?.coverage?.sufficient
            ),
            action,
            rawAction,
            motion,
            candidates: framingCandidates,
            metrics: {
                composition: compositionMetrics,
                torso: {},
                joints: {},
                limbs: {}
            }
        };
    }

    // ==========================================================
    // HARD STAGE 2: MODEL POSE
    // The visual matcher is the single source of truth.
    // If a body part is already green/matched in app.js, Guidance is
    // forbidden from coaching that part with a stricter private threshold.
    // ==========================================================
    const candidates = [];

    const comparisonReliable3D = Boolean(
        comparison?.ready &&
        comparison?.coverage?.sufficient
    );

    const matcherMetrics = addMatcherAlignedPoseCandidates(
        candidates,
        poseMatchState
    );

    // Only use secondary torso/depth coaching if the visual matcher did not
    // identify a concrete unmatched limb. This prevents a less important
    // independent signal from overriding the actual red/blue unmatched part.
    let torsoMetrics = {};
    let jointMetrics = {};
    let limbMetrics = {};

    if (candidates.length === 0 && !poseMatched) {
        torsoMetrics = addTorsoCandidates(
            candidates,
            imageLandmarks,
            adaptiveTarget,
            isMirrored
        );

        // Legacy independent joint/local-limb candidates are intentionally
        // disabled when poseMatchState is available. Their thresholds differ
        // from the visible matcher and previously caused "right arm" cues
        // even when the right arm was already matched.
        if (!poseMatchState) {
            jointMetrics = addJointCandidates(
                candidates,
                imageLandmarks,
                adaptiveTarget
            );

            limbMetrics = comparisonReliable3D
                ? addLocalLimbCandidates(candidates, comparison)
                : {};
        }
    }

    if (
        !overallMatched &&
        candidates.length === 0 &&
        !poseMatched
    ) {
        candidates.push(
            candidate(
                "MODEL_FINE_TUNE",
                "자세를 조금만 더 맞춰주세요.",
                40,
                0.5,
                { comparisonReliable3D, source: 'FALLBACK' },
                "MODEL",
                "MODEL_POSE"
            )
        );
    }

    candidates.sort(
        (a, b) => b.priorityScore - a.priorityScore
    );

    // Do not keep repeating a body-part cue after that body part has become
    // matched. The current candidate set is the truth for this frame.
    removeStaleActivePoseAction(candidates);

    let rawAction = null;

    if (!overallMatched) {
        const topAction = candidates[0] ?? null;

        const activeCandidate =
            state.activeAction
                ? candidates.find(
                    item => item.key === state.activeAction.key
                ) ?? null
                : null;

        if (
            topAction &&
            activeCandidate &&
            topAction.priorityScore - activeCandidate.priorityScore <=
                ACTIVE_ACTION_SCORE_HYSTERESIS
        ) {
            rawAction = activeCandidate;
        }
        else {
            rawAction = topAction;
        }
    }

    const action = stabilizeAction(rawAction, now);

    return {
        ready: true,
        phase: overallMatched ? "READY" : "MODEL_POSE",
        actor: action?.actor ?? (overallMatched ? "SYSTEM" : "MODEL"),
        subject,
        comparisonReady: Boolean(comparison?.ready),
        comparisonReliable3D,
        action,
        rawAction,
        motion,
        candidates,
        metrics: {
            composition: compositionState?.metrics ?? null,
            matcher: matcherMetrics,
            torso: torsoMetrics,
            joints: jointMetrics,
            limbs: limbMetrics
        }
    };
}

export function resetGuidanceEngine() {
    state = createState();
}
