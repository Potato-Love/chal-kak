// Photo Guide - Live Pose Comparator v2.1
// Body-centric 3D comparison for a user-retargeted target pose.
//
// Key change from v1.1:
// Raw MediaPipe world directions depend on camera/body orientation.
// v2 transforms both target and live skeletons into an anatomical
// body coordinate frame before comparing limb directions.

const VISIBILITY_THRESHOLD = 0.5;

const BODY_INDICES = [
    11, 12, 13, 14, 15, 16,
    23, 24, 25, 26, 27, 28
];

const SEGMENTS = {
    left_upper_arm: [11, 13],
    left_forearm: [13, 15],
    right_upper_arm: [12, 14],
    right_forearm: [14, 16],
    left_thigh: [23, 25],
    left_lower_leg: [25, 27],
    right_thigh: [24, 26],
    right_lower_leg: [26, 28]
};

const JOINTS = {
    left_elbow: [11, 13, 15],
    right_elbow: [12, 14, 16],
    left_knee: [23, 25, 27],
    right_knee: [24, 26, 28]
};

const SEGMENT_LABELS_KO = {
    left_upper_arm: "왼쪽 위팔",
    left_forearm: "왼쪽 아래팔",
    right_upper_arm: "오른쪽 위팔",
    right_forearm: "오른쪽 아래팔",
    left_thigh: "왼쪽 허벅지",
    left_lower_leg: "왼쪽 종아리",
    right_thigh: "오른쪽 허벅지",
    right_lower_leg: "오른쪽 종아리"
};

let adaptiveTarget = null;
let targetPoints = null;
let targetBody = null;
let targetFeatures = null;

function add(a, b) {
    return {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z
    };
}

function subtract(a, b) {
    return {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z
    };
}

function scale(v, s) {
    return {
        x: v.x * s,
        y: v.y * s,
        z: v.z * s
    };
}

function norm(v) {
    return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
    const length = norm(v);

    if (length < 1e-9) {
        return { x: 0, y: 0, z: 0 };
    }

    return {
        x: v.x / length,
        y: v.y / length,
        z: v.z / length
    };
}

function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function midpoint(a, b) {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: (a.z + b.z) / 2
    };
}

function angleBetweenVectors(a, b) {
    const aUnit = normalize(a);
    const bUnit = normalize(b);

    const cosine = clamp(dot(aUnit, bUnit), -1, 1);

    return Math.acos(cosine) * 180 / Math.PI;
}

function calculateJointAngle3D(points, aIndex, bIndex, cIndex) {
    const ba = subtract(points[aIndex], points[bIndex]);
    const bc = subtract(points[cIndex], points[bIndex]);

    return angleBetweenVectors(ba, bc);
}

function buildBodyFrame(points) {
    const shoulderCenter = midpoint(points[11], points[12]);
    const hipCenter = midpoint(points[23], points[24]);

    const torsoVector = subtract(shoulderCenter, hipCenter);
    const torsoLength = norm(torsoVector);

    if (torsoLength < 1e-7) {
        return null;
    }

    const up = normalize(torsoVector);

    // Anatomical LEFT -> RIGHT. Average shoulder/hip axes for stability.
    const shoulderAxis = normalize(
        subtract(points[12], points[11])
    );

    const hipAxis = normalize(
        subtract(points[24], points[23])
    );

    let right = normalize(add(shoulderAxis, hipAxis));

    // Gram-Schmidt: remove any component along the torso axis.
    right = normalize(
        subtract(right, scale(up, dot(right, up)))
    );

    if (norm(right) < 1e-7) {
        return null;
    }

    // Body-local depth axis. Same anatomical construction is used
    // for target and live, so the local frame stays comparable even
    // when the person rotates relative to the camera.
    const forward = normalize(cross(right, up));

    return {
        origin: hipCenter,
        right,
        up,
        forward,
        torsoLength,
        shoulderCenter,
        hipCenter
    };
}

function toBodyLocal(point, frame) {
    const relative = subtract(point, frame.origin);
    const scaleBy = frame.torsoLength || 1;

    return {
        x: dot(relative, frame.right) / scaleBy,
        y: dot(relative, frame.up) / scaleBy,
        z: dot(relative, frame.forward) / scaleBy
    };
}

function pointsToBodyLocal(points, frame) {
    const local = {};

    for (const index of BODY_INDICES) {
        local[index] = toBodyLocal(points[index], frame);
    }

    return local;
}

function buildCameraRelativeDepth(points, frame) {
    const scaleBy = Math.max(frame?.torsoLength ?? 0, 1e-6);
    const shoulderCenter = frame.shoulderCenter;
    const hipCenter = frame.hipCenter;

    const relativeZ = (point, anchor) =>
        (Number(point.z) - Number(anchor.z)) / scaleBy;

    return {
        left_elbow: relativeZ(points[13], shoulderCenter),
        left_wrist: relativeZ(points[15], shoulderCenter),
        right_elbow: relativeZ(points[14], shoulderCenter),
        right_wrist: relativeZ(points[16], shoulderCenter),
        left_knee: relativeZ(points[25], hipCenter),
        left_ankle: relativeZ(points[27], hipCenter),
        right_knee: relativeZ(points[26], hipCenter),
        right_ankle: relativeZ(points[28], hipCenter)
    };
}

function buildFeatures(points, body) {
    const segmentDirections = {};

    for (const [name, [start, end]] of Object.entries(SEGMENTS)) {
        segmentDirections[name] = normalize(
            subtract(
                body.localPoints[end],
                body.localPoints[start]
            )
        );
    }

    const jointAngles = {};

    for (const [name, [a, b, c]] of Object.entries(JOINTS)) {
        jointAngles[name] = calculateJointAngle3D(
            points,
            a,
            b,
            c
        );
    }

    return {
        segmentDirections,
        jointAngles
    };
}

function targetJsonToPoints(targetJson) {
    const source = targetJson.retargeted_landmarks_3d;

    if (!source) {
        throw new Error(
            "Target JSON has no retargeted_landmarks_3d."
        );
    }

    const points = {};

    for (const index of BODY_INDICES) {
        const point = source[String(index)];

        if (!point) {
            throw new Error(
                `Target JSON is missing landmark ${index}.`
            );
        }

        points[index] = {
            x: Number(point.x),
            y: Number(point.y),
            z: Number(point.z)
        };
    }

    return points;
}

function worldLandmarksToPoints(worldLandmarks) {
    if (!worldLandmarks || worldLandmarks.length < 29) {
        return null;
    }

    const points = {};

    for (const index of BODY_INDICES) {
        const lm = worldLandmarks[index];

        if (!lm) {
            return null;
        }

        points[index] = {
            x: Number(lm.x),
            y: Number(lm.y),
            z: Number(lm.z)
        };
    }

    return points;
}

function isLandmarkUsable(index, imageLandmarks, worldLandmarks) {
    if (imageLandmarks && imageLandmarks[index]) {
        const lm = imageLandmarks[index];

        const visibility =
            lm.visibility === undefined
                ? 1
                : Number(lm.visibility);

        const inFrame =
            Number(lm.x) >= 0 &&
            Number(lm.x) <= 1 &&
            Number(lm.y) >= 0 &&
            Number(lm.y) <= 1;

        return (
            visibility >= VISIBILITY_THRESHOLD &&
            inFrame
        );
    }

    if (worldLandmarks && worldLandmarks[index]) {
        const lm = worldLandmarks[index];

        const visibility =
            lm.visibility === undefined
                ? 1
                : Number(lm.visibility);

        return visibility >= VISIBILITY_THRESHOLD;
    }

    return false;
}

function scoreFromAngle(errorDeg, fullPenaltyDeg = 60) {
    const normalizedError = clamp(
        errorDeg / fullPenaltyDeg,
        0,
        1
    );

    return (1 - normalizedError) * 100;
}

function mean(values) {
    if (!values.length) {
        return null;
    }

    return (
        values.reduce((sum, value) => sum + value, 0) /
        values.length
    );
}

function applyAdaptiveTargetData(data, sourceLabel = "in-memory") {
    adaptiveTarget = data;
    targetPoints = targetJsonToPoints(adaptiveTarget);

    const frame = buildBodyFrame(targetPoints);

    if (!frame) {
        throw new Error("Failed to build target body frame.");
    }

    targetBody = {
        frame,
        localPoints: pointsToBodyLocal(targetPoints, frame),
        cameraRelativeDepth: buildCameraRelativeDepth(targetPoints, frame)
    };

    targetFeatures = buildFeatures(targetPoints, targetBody);

    console.log(
        "Adaptive 3D target loaded (Comparator v2):",
        adaptiveTarget.source?.reference_image ?? sourceLabel
    );

    return adaptiveTarget;
}

export async function loadAdaptiveTarget(
    url = "../retargeted_reference_04_user.json"
) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Failed to load adaptive target: ${response.status}`
        );
    }

    const data = await response.json();
    return applyAdaptiveTargetData(data, url);
}

export function setAdaptiveTargetData(data) {
    if (!data || typeof data !== "object") {
        throw new Error("Adaptive target data is required.");
    }
    return applyAdaptiveTargetData(data, "custom-reference");
}

export function getAdaptiveTarget() {
    return adaptiveTarget;
}

export function isAdaptiveTargetLoaded() {
    return Boolean(
        adaptiveTarget &&
        targetPoints &&
        targetBody &&
        targetFeatures
    );
}

export function compareLivePose3D(
    worldLandmarks,
    imageLandmarks = null
) {
    if (!isAdaptiveTargetLoaded()) {
        return {
            ready: false,
            reason: "target_not_loaded"
        };
    }

    const livePoints = worldLandmarksToPoints(worldLandmarks);

    if (!livePoints) {
        return {
            ready: false,
            reason: "live_world_landmarks_unavailable"
        };
    }

    const liveFrame = buildBodyFrame(livePoints);

    if (!liveFrame) {
        return {
            ready: false,
            reason: "live_body_frame_unavailable"
        };
    }

    const liveBody = {
        frame: liveFrame,
        localPoints: pointsToBodyLocal(livePoints, liveFrame),
        cameraRelativeDepth: buildCameraRelativeDepth(livePoints, liveFrame)
    };

    const liveFeatures = buildFeatures(livePoints, liveBody);

    const usable = {};

    for (const index of BODY_INDICES) {
        usable[index] = isLandmarkUsable(
            index,
            imageLandmarks,
            worldLandmarks
        );
    }

    const segmentErrors = {};
    const segmentErrorValues = [];

    for (const [name, [start, end]] of Object.entries(SEGMENTS)) {
        if (!usable[start] || !usable[end]) {
            segmentErrors[name] = null;
            continue;
        }

        const error = angleBetweenVectors(
            liveFeatures.segmentDirections[name],
            targetFeatures.segmentDirections[name]
        );

        segmentErrors[name] = error;
        segmentErrorValues.push(error);
    }

    const jointErrors = {};
    const jointErrorValues = [];

    for (const [name, [a, b, c]] of Object.entries(JOINTS)) {
        if (!usable[a] || !usable[b] || !usable[c]) {
            jointErrors[name] = null;
            continue;
        }

        const error = Math.abs(
            liveFeatures.jointAngles[name] -
            targetFeatures.jointAngles[name]
        );

        jointErrors[name] = error;
        jointErrorValues.push(error);
    }

    const meanSegmentError = mean(segmentErrorValues);
    const meanJointError = mean(jointErrorValues);

    const segmentScore =
        meanSegmentError === null
            ? null
            : scoreFromAngle(meanSegmentError, 55);

    const jointScore =
        meanJointError === null
            ? null
            : scoreFromAngle(meanJointError, 50);

    const availableScores = [];

    if (segmentScore !== null) {
        availableScores.push({ value: segmentScore, weight: 0.58 });
    }

    if (jointScore !== null) {
        availableScores.push({ value: jointScore, weight: 0.42 });
    }

    const totalWeight = availableScores.reduce(
        (sum, item) => sum + item.weight,
        0
    );

    const overallScore =
        totalWeight > 0
            ? availableScores.reduce(
                (sum, item) => sum + item.value * item.weight,
                0
            ) / totalWeight
            : null;

    const visibleSegmentCount = segmentErrorValues.length;
    const visibleJointCount = jointErrorValues.length;

    const segmentCoverage =
        visibleSegmentCount / Object.keys(SEGMENTS).length;

    const jointCoverage =
        visibleJointCount / Object.keys(JOINTS).length;

    // Full body should be sufficiently visible before guidance is trusted.
    const coverageSufficient =
        visibleSegmentCount >= 6 &&
        visibleJointCount >= 3 &&
        usable[11] && usable[12] &&
        usable[23] && usable[24];

    const priorityEntry = Object.entries(segmentErrors)
        .filter(([, value]) => value !== null)
        .sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
        ready: overallScore !== null,

        coverage: {
            sufficient: coverageSufficient,
            visible_segments: visibleSegmentCount,
            total_segments: Object.keys(SEGMENTS).length,
            segment_ratio: segmentCoverage,
            visible_joints: visibleJointCount,
            total_joints: Object.keys(JOINTS).length,
            joint_ratio: jointCoverage
        },

        score: {
            overall: overallScore,
            segment: segmentScore,
            joint: jointScore
        },

        mean_errors_deg: {
            segment: meanSegmentError,
            joint: meanJointError
        },

        segment_errors_deg: segmentErrors,
        joint_errors_deg: jointErrors,

        live_joint_angles_3d: {
            ...liveFeatures.jointAngles
        },

        target_joint_angles_3d: {
            ...targetFeatures.jointAngles
        },

        body_local: {
            live: liveBody.localPoints,
            target: targetBody.localPoints,
            live_torso_length: liveFrame.torsoLength,
            target_torso_length: targetBody.frame.torsoLength
        },

        // Camera-relative distal depth, normalized by torso length.
        // MediaPipe depth uses a camera-oriented z axis. We deliberately keep
        // this separate from the body-local "forward" axis because that axis
        // can flip semantic front/back when body orientation changes.
        camera_relative_depth: {
            live: { ...liveBody.cameraRelativeDepth },
            target: { ...targetBody.cameraRelativeDepth }
        },

        priority: priorityEntry
            ? {
                segment: priorityEntry[0],
                label_ko:
                    SEGMENT_LABELS_KO[priorityEntry[0]] ??
                    priorityEntry[0],
                error_deg: priorityEntry[1]
            }
            : null
    };
}
