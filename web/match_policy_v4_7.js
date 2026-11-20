// PhotoGuide Match Policy v4.7
// Single source of truth for live hard-match thresholds and post-capture review.
// "일치" in Review must mean the same hard-match condition used during live guidance.
// "대체로 일치" is only a grace band just outside the hard-match boundary.

export const MATCH_POLICY = Object.freeze({
    pose: Object.freeze({
        jointAngleTolerance: 10,
        hipAngleTolerance: 11,
        segmentAngleTolerance: 10,
        // 3D is advisory only. It must not turn a 2D hard-match into Review failure.
        joint3DTolerance: 18,
        segment3DTolerance: 24,
        fairMultiplier: 1.60
    }),
    composition: Object.freeze({
        toleranceXRatio: 0.045,
        toleranceYRatio: 0.040,
        minTolerancePx: 10,
        fairMultiplier: 1.65
    })
});

const POSE_PARTS = Object.freeze([
    { key: "leftUpperArm", visible: "leftArm", joint: "leftElbow", jointType: "joint", segment: "leftUpperArm" },
    { key: "leftForearm", visible: "leftArm", joint: "leftElbow", jointType: "joint", segment: "leftForearm" },
    { key: "rightUpperArm", visible: "rightArm", joint: "rightElbow", jointType: "joint", segment: "rightUpperArm" },
    { key: "rightForearm", visible: "rightArm", joint: "rightElbow", jointType: "joint", segment: "rightForearm" },
    { key: "leftThigh", visible: "leftThigh", joint: "leftHip", jointType: "hip", segment: "leftThigh" },
    { key: "leftLowerLeg", visible: "leftLowerLeg", joint: "leftKnee", jointType: "joint", segment: "leftLowerLeg" },
    { key: "rightThigh", visible: "rightThigh", joint: "rightHip", jointType: "hip", segment: "rightThigh" },
    { key: "rightLowerLeg", visible: "rightLowerLeg", joint: "rightKnee", jointType: "joint", segment: "rightLowerLeg" }
]);

function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function statusFromLevel(level) {
    if (level === "good") return "일치";
    if (level === "fair") return "대체로 일치";
    if (level === "bad") return "보정 필요";
    return "분석 불가";
}

export function getLiveCompositionTolerance(referenceFrame) {
    const width = finite(referenceFrame?.width);
    const height = finite(referenceFrame?.height);
    return {
        x: Math.max(
            MATCH_POLICY.composition.minTolerancePx,
            (width ?? 0) * MATCH_POLICY.composition.toleranceXRatio
        ),
        y: Math.max(
            MATCH_POLICY.composition.minTolerancePx,
            (height ?? 0) * MATCH_POLICY.composition.toleranceYRatio
        )
    };
}

export function evaluateCompositionSnapshot(snapshot) {
    const c = snapshot?.composition;
    if (!c) {
        return {
            level: "unknown",
            status: "분석 불가",
            hardMatched: false,
            fairMatched: false,
            maxRatio: null,
            ratios: null
        };
    }

    const toleranceX =
        finite(c.toleranceX) ??
        getLiveCompositionTolerance(c.referenceFrame).x;
    const toleranceY =
        finite(c.toleranceY) ??
        getLiveCompositionTolerance(c.referenceFrame).y;

    const currentLeft = finite(c.currentLeft);
    const currentRight = finite(c.currentRight);
    const currentTop = finite(c.currentTop);
    const currentBottom = finite(c.currentBottom);
    const targetLeft = finite(c.targetLeft);
    const targetRight = finite(c.targetRight);
    const targetTop = finite(c.targetTop);
    const targetBottom = finite(c.targetBottom);

    const values = [
        currentLeft, currentRight, currentTop, currentBottom,
        targetLeft, targetRight, targetTop, targetBottom,
        toleranceX, toleranceY
    ];

    if (values.some(v => !Number.isFinite(v)) || toleranceX <= 0 || toleranceY <= 0) {
        return {
            level: "unknown",
            status: "분석 불가",
            hardMatched: false,
            fairMatched: false,
            maxRatio: null,
            ratios: null
        };
    }

    const ratios = {
        left: Math.abs(currentLeft - targetLeft) / toleranceX,
        right: Math.abs(currentRight - targetRight) / toleranceX,
        top: Math.abs(currentTop - targetTop) / toleranceY,
        bottom: Math.abs(currentBottom - targetBottom) / toleranceY
    };

    const hardMatched =
        typeof snapshot.compositionMatched === "boolean"
            ? snapshot.compositionMatched
            : Object.values(ratios).every(v => v <= 1);

    const valid = c.valid !== false && c.clipped !== true;
    const maxRatio = Math.max(...Object.values(ratios));
    const fairMatched =
        !hardMatched &&
        valid &&
        maxRatio <= MATCH_POLICY.composition.fairMultiplier;

    const level =
        hardMatched ? "good" :
        fairMatched ? "fair" :
        valid ? "bad" : "unknown";

    return {
        level,
        status: statusFromLevel(level),
        hardMatched,
        fairMatched,
        maxRatio,
        ratios,
        toleranceX,
        toleranceY
    };
}

function poseToleranceFor(type, pose) {
    if (type === "hip") {
        return finite(pose?.hipAngleTolerance) ?? MATCH_POLICY.pose.hipAngleTolerance;
    }
    return finite(pose?.jointAngleTolerance) ?? MATCH_POLICY.pose.jointAngleTolerance;
}

export function evaluatePoseSnapshot(snapshot) {
    const pose = snapshot?.pose;
    if (!pose) {
        return {
            level: "unknown",
            status: "분석 불가",
            hardMatched: false,
            fairMatched: false,
            maxRatio: null,
            parts: []
        };
    }

    const errors = pose.errors ?? {};
    const visibility = pose.visibility ?? {};
    const segmentTolerance =
        finite(pose.segmentAngleTolerance) ??
        MATCH_POLICY.pose.segmentAngleTolerance;

    const parts = [];
    let inputsComplete = true;

    for (const def of POSE_PARTS) {
        const visible = visibility[def.visible] !== false;
        const jointError = finite(errors[def.joint]);
        const segmentError = finite(errors[def.segment]);
        const jointTolerance = poseToleranceFor(def.jointType, pose);

        if (!visible || jointError === null || segmentError === null) {
            inputsComplete = false;
            parts.push({
                ...def,
                visible,
                jointError,
                segmentError,
                jointTolerance,
                segmentTolerance,
                ratio: null,
                hardMatched: false
            });
            continue;
        }

        const jointRatio = jointError / jointTolerance;
        const segmentRatio = segmentError / segmentTolerance;
        const ratio = Math.max(jointRatio, segmentRatio);

        parts.push({
            ...def,
            visible,
            jointError,
            segmentError,
            jointTolerance,
            segmentTolerance,
            jointRatio,
            segmentRatio,
            ratio,
            hardMatched: ratio <= 1
        });
    }

    const computedHardMatched =
        inputsComplete &&
        parts.every(part => part.hardMatched);

    // Prefer the exact hard-match boolean frozen at capture time.
    const hardMatched =
        typeof snapshot.poseMatched === "boolean"
            ? snapshot.poseMatched
            : computedHardMatched;

    const finiteRatios = parts
        .map(part => part.ratio)
        .filter(Number.isFinite);

    const maxRatio = finiteRatios.length
        ? Math.max(...finiteRatios)
        : null;

    const fairMatched =
        !hardMatched &&
        inputsComplete &&
        Number.isFinite(maxRatio) &&
        maxRatio <= MATCH_POLICY.pose.fairMultiplier;

    const level =
        hardMatched ? "good" :
        fairMatched ? "fair" :
        inputsComplete ? "bad" : "unknown";

    return {
        level,
        status: statusFromLevel(level),
        hardMatched,
        fairMatched,
        maxRatio,
        inputsComplete,
        parts
    };
}

export function statusForLevel(level) {
    return statusFromLevel(level);
}
