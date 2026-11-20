import {
    evaluateCompositionSnapshot,
    evaluatePoseSnapshot
} from "./match_policy_v4_7.js";

// PhotoGuide Post-Capture Diagnosis v4.7
// Purpose: give an interpretable review, not a pseudo-precise percentage.
// The visible UI should communicate match status and the largest difference.
// Numeric similarity is kept only for debugging/tuning.

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function mean(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentile(values, p) {
    const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!valid.length) return null;
    const index = (valid.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    if (lo === hi) return valid[lo];
    const t = index - lo;
    return valid[lo] * (1 - t) + valid[hi] * t;
}

function angleQuality(errorDeg, goodDeg = 4, badDeg = 22) {
    if (!Number.isFinite(errorDeg)) return null;
    if (errorDeg <= goodDeg) return 100;
    if (errorDeg >= badDeg) return 0;
    const t = (errorDeg - goodDeg) / (badDeg - goodDeg);
    return 100 * (1 - t * t);
}

function normalizedQuality(error, good = 0.02, bad = 0.16) {
    if (!Number.isFinite(error)) return null;
    if (error <= good) return 100;
    if (error >= bad) return 0;
    const t = (error - good) / (bad - good);
    return 100 * (1 - t * t);
}

function weightedAverage(items) {
    const usable = items.filter(
        item => Number.isFinite(item.value) && Number.isFinite(item.weight)
    );
    const total = usable.reduce((sum, item) => sum + item.weight, 0);
    if (!total) return null;
    return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / total;
}

const PART_LABEL = {
    leftUpperArm: "왼쪽 위팔",
    leftForearm: "왼쪽 아래팔",
    rightUpperArm: "오른쪽 위팔",
    rightForearm: "오른쪽 아래팔",
    leftThigh: "왼쪽 허벅지",
    leftLowerLeg: "왼쪽 종아리",
    rightThigh: "오른쪽 허벅지",
    rightLowerLeg: "오른쪽 종아리"
};

function analyzeComposition(snapshot) {
    const c = snapshot?.composition;
    if (!c) {
        return { status: "분석 불가", level: "unknown", score: null, issues: [], metrics: null };
    }

    const n = c.normalized;

    let targetWidth;
    let targetHeight;
    let edgeErrors;

    if (n) {
        targetWidth = n.targetRight - n.targetLeft;
        targetHeight = n.targetBottom - n.targetTop;

        if (!(targetWidth > 0.02) || !(targetHeight > 0.02)) {
            return { status: "분석 불가", level: "unknown", score: null, issues: [], metrics: null };
        }

        // v4.1: evaluate in the Reference's own normalized frame. This keeps
        // portrait Reference vs landscape camera comparisons meaningful.
        edgeErrors = {
            left: Math.abs(n.currentLeft - n.targetLeft) / targetWidth,
            right: Math.abs(n.currentRight - n.targetRight) / targetWidth,
            top: Math.abs(n.currentTop - n.targetTop) / targetHeight,
            bottom: Math.abs(n.currentBottom - n.targetBottom) / targetHeight
        };
    } else {
        targetWidth = c.targetRight - c.targetLeft;
        targetHeight = c.targetBottom - c.targetTop;
        if (!(targetWidth > 1) || !(targetHeight > 1)) {
            return { status: "분석 불가", level: "unknown", score: null, issues: [], metrics: null };
        }

        edgeErrors = {
            left: Math.abs(c.currentLeft - c.targetLeft) / targetWidth,
            right: Math.abs(c.currentRight - c.targetRight) / targetWidth,
            top: Math.abs(c.currentTop - c.targetTop) / targetHeight,
            bottom: Math.abs(c.currentBottom - c.targetBottom) / targetHeight
        };
    }

    const values = Object.values(edgeErrors);
    const meanEdgeError = mean(values);
    const maxEdgeError = Math.max(...values);

    const edgeScores = values.map(value => normalizedQuality(value, 0.018, 0.15));
    const rawMean = mean(edgeScores);
    const worstScore = normalizedQuality(maxEdgeError, 0.025, 0.18);
    const score = weightedAverage([
        { value: rawMean, weight: 0.65 },
        { value: worstScore, weight: 0.35 }
    ]);

    // v4.7: Review "일치" uses the exact same hard-match captured by live framing.
    // "대체로 일치" is only a grace band immediately outside that boundary.
    const policyResult = evaluateCompositionSnapshot(snapshot);
    const status = policyResult.status;
    const level = policyResult.level;

    const issues = [];
    const mirrored = Boolean(snapshot.isMirrored);
    const currentLeft = n ? n.currentLeft : c.currentLeft;
    const currentRight = n ? n.currentRight : c.currentRight;
    const currentTop = n ? n.currentTop : c.currentTop;
    const currentBottom = n ? n.currentBottom : c.currentBottom;
    const targetLeft = n ? n.targetLeft : c.targetLeft;
    const targetRight = n ? n.targetRight : c.targetRight;
    const targetTop = n ? n.targetTop : c.targetTop;
    const targetBottom = n ? n.targetBottom : c.targetBottom;

    const currentCenterX = (currentLeft + currentRight) / 2;
    const currentCenterY = (currentTop + currentBottom) / 2;
    const targetCenterX = (targetLeft + targetRight) / 2;
    const targetCenterY = (targetTop + targetBottom) / 2;
    const centerErrorX = (currentCenterX - targetCenterX) / targetWidth;
    const centerErrorY = (currentCenterY - targetCenterY) / targetHeight;

    if (Math.abs(centerErrorX) > 0.055) {
        const visualSign = mirrored ? -centerErrorX : centerErrorX;
        const moveDirection = visualSign < 0 ? "오른쪽" : "왼쪽";
        issues.push({
            key: "CENTER_X",
            severity: Math.abs(centerErrorX) / 0.12,
            text: `인물의 좌우 위치가 Reference와 달라요.`,
            retakeText: `이번에는 ${moveDirection}으로 조금만 와주세요.`
        });
    }

    if (Math.abs(centerErrorY) > 0.06) {
        const cameraDirection = centerErrorY < 0 ? "아래" : "위";
        issues.push({
            key: "CENTER_Y",
            severity: Math.abs(centerErrorY) / 0.13,
            text: "인물의 세로 위치가 Reference와 달라요.",
            retakeText: `이번에는 카메라를 살짝 ${cameraDirection}로 맞춰주세요.`
        });
    }

    const currentWidth = currentRight - currentLeft;
    const currentHeight = currentBottom - currentTop;
    const widthRatio = currentWidth / targetWidth;
    const heightRatio = currentHeight / targetHeight;

    if (heightRatio > 1.12 || widthRatio > 1.15) {
        issues.push({
            key: "TOO_CLOSE",
            severity: Math.max(heightRatio - 1, widthRatio - 1) / 0.22,
            text: "인물이 Reference보다 크게 잡혔어요.",
            retakeText: "이번에는 조금만 뒤로 가주세요."
        });
    } else if (heightRatio < 0.88 || widthRatio < 0.85) {
        issues.push({
            key: "TOO_FAR",
            severity: Math.max(1 - heightRatio, 1 - widthRatio) / 0.22,
            text: "인물이 Reference보다 작게 잡혔어요.",
            retakeText: "이번에는 조금만 앞으로 와주세요."
        });
    }

    // Hip-only or combined part failures can be missed by the simple elbow/knee
    // issue loops above. Use the shared live-match part ratios as a fallback.
    if (level === "bad" && issues.length === 0) {
        const worstPart = [...(policyResult.parts ?? [])]
            .filter(part => Number.isFinite(part.ratio))
            .sort((a, b) => b.ratio - a.ratio)[0];

        if (worstPart && worstPart.ratio > 1) {
            const label = PART_LABEL[worstPart.key] ?? "신체 부위";
            issues.push({
                key: worstPart.key,
                severity: worstPart.ratio,
                text: `${label}의 자세가 Reference와 달라요.`,
                retakeText: `이번에는 ${label}의 각도와 방향을 Reference에 조금 더 맞춰주세요.`
            });
        }
    }

    return {
        status,
        level,
        score,
        issues,
        metrics: {
            edgeErrors,
            meanEdgeError,
            maxEdgeError,
            centerErrorX,
            centerErrorY,
            widthRatio,
            heightRatio,
            liveMatchRatios: policyResult.ratios,
            liveMatchMaxRatio: policyResult.maxRatio,
            hardMatched: policyResult.hardMatched,
            fairMatched: policyResult.fairMatched
        }
    };
}

function analyzePose(snapshot) {
    const pose = snapshot?.pose;
    if (!pose) {
        return { status: "분석 불가", level: "unknown", score: null, issues: [], metrics: null };
    }

    const e = pose.errors ?? {};
    // 3D remains available in snapshot.comparison for debugging, but v4.7
    // does not let advisory monocular 3D override the live 2D hard-match.
    const visibility = pose.visibility ?? {};

    const maxFinite = (...values) => {
        const valid = values.map(Number).filter(Number.isFinite);
        return valid.length ? Math.max(...valid) : null;
    };

    const segmentDefs = [
        ["leftUpperArm", Number(e.leftUpperArm), visibility.leftArm],
        ["leftForearm", Number(e.leftForearm), visibility.leftArm],
        ["rightUpperArm", Number(e.rightUpperArm), visibility.rightArm],
        ["rightForearm", Number(e.rightForearm), visibility.rightArm],
        ["leftThigh", Number(e.leftThigh), visibility.leftThigh],
        ["leftLowerLeg", Number(e.leftLowerLeg), visibility.leftLowerLeg],
        ["rightThigh", Number(e.rightThigh), visibility.rightThigh],
        ["rightLowerLeg", Number(e.rightLowerLeg), visibility.rightLowerLeg]
    ];

    const jointDefs = [
        ["leftElbow", "왼쪽 팔꿈치", Number(e.leftElbow), visibility.leftArm,
            pose.angles?.current?.leftElbow, pose.angles?.target?.leftElbow],
        ["rightElbow", "오른쪽 팔꿈치", Number(e.rightElbow), visibility.rightArm,
            pose.angles?.current?.rightElbow, pose.angles?.target?.rightElbow],
        ["leftKnee", "왼쪽 무릎", Number(e.leftKnee), visibility.leftLowerLeg,
            pose.angles?.current?.leftKnee, pose.angles?.target?.leftKnee],
        ["rightKnee", "오른쪽 무릎", Number(e.rightKnee), visibility.rightLowerLeg,
            pose.angles?.current?.rightKnee, pose.angles?.target?.rightKnee]
    ];

    const segmentErrors = segmentDefs
        .filter(([, error, visible]) => visible !== false && Number.isFinite(error))
        .map(([, error]) => error);
    const jointErrors = jointDefs
        .filter(([, , error, visible]) => visible !== false && Number.isFinite(error))
        .map(([, , error]) => error);
    const allErrors = [...segmentErrors, ...jointErrors];

    if (!allErrors.length) {
        return { status: "분석 불가", level: "unknown", score: null, issues: [], metrics: null };
    }

    const meanError = mean(allErrors);
    const p75Error = percentile(allErrors, 0.75);
    const maxError = Math.max(...allErrors);

    const segmentScore = mean(segmentErrors.map(error => angleQuality(error, 4, 21)));
    const jointScore = mean(jointErrors.map(error => angleQuality(error, 4, 20)));
    const meanScore = weightedAverage([
        { value: segmentScore, weight: 0.62 },
        { value: jointScore, weight: 0.38 }
    ]);
    const worstScore = angleQuality(maxError, 5, 24);
    const p75Score = angleQuality(p75Error, 4, 19);

    // A single obviously wrong limb must not be hidden by many easy joints.
    const score = weightedAverage([
        { value: meanScore, weight: 0.55 },
        { value: p75Score, weight: 0.25 },
        { value: worstScore, weight: 0.20 }
    ]);

    // v4.7: same rule as live Pose matching.
    // A live hard-match is always "일치" in Review.
    const policyResult = evaluatePoseSnapshot(snapshot);
    const status = policyResult.status;
    const level = policyResult.level;

    const issues = [];

    for (const [key, label, error, visible, current, target] of jointDefs) {
        const jointTolerance =
            Number(pose.jointAngleTolerance) || 10;
        if (
            visible === false ||
            !Number.isFinite(error) ||
            error <= jointTolerance
        ) continue;
        let text = `${label} 각도가 Reference와 달라요.`;
        let retakeText = `이번에는 ${label} 각도를 조금만 더 맞춰주세요.`;
        if (Number.isFinite(current) && Number.isFinite(target)) {
            const moreOpen = current > target;
            text = `${label}가 Reference보다 ${moreOpen ? "더 펴져" : "더 굽혀져"} 있어요.`;
            retakeText = `이번에는 ${label}를 ${moreOpen ? "조금 더 굽혀" : "조금 더 펴"}주세요.`;
        }
        issues.push({
            key,
            severity: error / 18,
            text,
            retakeText
        });
    }

    for (const [key, error, visible] of segmentDefs) {
        const segmentTolerance =
            Number(pose.segmentAngleTolerance) || 10;
        if (
            visible === false ||
            !Number.isFinite(error) ||
            error <= segmentTolerance
        ) continue;
        issues.push({
            key,
            severity: error / 18,
            text: `${PART_LABEL[key]}의 방향이나 앞뒤 위치가 Reference와 달라요.`,
            retakeText: `이번에는 ${PART_LABEL[key]}의 방향과 앞뒤 위치를 조금만 더 맞춰주세요.`
        });
    }

    return {
        status,
        level,
        score,
        issues,
        metrics: {
            meanError,
            p75Error,
            maxError,
            segmentScore,
            jointScore,
            liveMatchMaxRatio: policyResult.maxRatio,
            hardMatched: policyResult.hardMatched,
            fairMatched: policyResult.fairMatched
        }
    };
}


function worstLevel(...levels) {
    const rank = { unknown: 0, good: 1, fair: 2, bad: 3 };
    return levels.filter(Boolean).sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0] ?? "unknown";
}

function statusFromLevel(level) {
    if (level === "good") return "일치";
    if (level === "fair") return "대체로 일치";
    if (level === "bad") return "보정 필요";
    return "분석 불가";
}

function analyzeOrientation(snapshot) {
    const o = snapshot?.orientation;
    if (!o) {
        return {
            torso: { status: "분석 불가", level: "unknown", issues: [] },
            head: { status: "분석 불가", level: "unknown", issues: [] },
            eyes: { level: "unknown", issues: [] },
            gaze: { level: "unknown", issues: [] },
            issues: []
        };
    }

    const issues = [];

    const torsoLevel = o.torso?.reliable ? (o.torso.level ?? "unknown") : "unknown";
    if (torsoLevel === "bad") {
        const t = o.torso;
        const values = [
            ["상체 기울기", Math.abs(Number(t.leanDelta ?? 0)) / 12, "이번에는 상체 기울기를 Reference에 조금 더 맞춰주세요."],
            ["어깨 기울기", Math.abs(Number(t.shoulderTiltDelta ?? 0)) / 13, "이번에는 어깨 높이를 Reference에 조금 더 맞춰주세요."],
            ["상체 방향", Math.abs(Number(t.turnDelta ?? 0)) / 0.18, "이번에는 몸이 향하는 방향을 Reference에 조금 더 맞춰주세요."]
        ].sort((a, b) => b[1] - a[1]);
        const [label, severity, retakeText] = values[0];
        issues.push({
            key: "TORSO_ORIENTATION",
            category: "orientation",
            severity,
            text: `${label}가 Reference와 달라요.`,
            retakeText
        });
    }

    const headLevel = o.head?.reliable ? (o.head.level ?? "unknown") : "unknown";
    if (headLevel === "bad") {
        const h = o.head;
        const options = [
            ["고개 방향", Math.abs(Number(h.yawDelta ?? 0)) / Math.max(Number(h.yawThreshold ?? 0.06), 1e-6), "이번에는 고개 방향을 Reference에 조금 더 맞춰주세요."],
            ["고개 기울기", Math.abs(Number(h.rollDelta ?? 0)) / Math.max(Number(h.rollThreshold ?? 8.5), 1e-6), "이번에는 고개 기울기를 Reference에 조금 더 맞춰주세요."],
            ["턱 높이", Math.abs(Number(h.pitchDelta ?? 0)) / Math.max(Number(h.pitchThreshold ?? 10), 1e-6), "이번에는 턱 높이를 Reference에 조금 더 맞춰주세요."]
        ].sort((a, b) => b[1] - a[1]);
        const [label, severity, retakeText] = options[0];
        issues.push({
            key: "HEAD_ORIENTATION",
            category: "face",
            severity,
            text: `${label}이 Reference와 달라요.`,
            retakeText
        });
    }

    const eyesReliable = Boolean(o.eyes?.reliable);
    const eyesClosed = Boolean(eyesReliable && o.eyes?.closed);
    if (eyesClosed) {
        issues.push({
            key: "EYES_CLOSED",
            category: "quality",
            severity: 2.2,
            text: "촬영 순간 눈이 감겨 있었어요.",
            retakeText: "이번에는 찍을 때 눈을 떠주세요."
        });
    }

    const gazeReliable = Boolean(o.gaze?.reliable);
    const gazeMatched = !gazeReliable || Boolean(o.gaze?.matched);
    if (gazeReliable && !gazeMatched) {
        issues.push({
            key: "GAZE_DIRECTION",
            category: "face",
            severity: 0.8,
            text: "시선 방향이 Reference와 달라요.",
            retakeText: "이번에는 시선 방향도 Reference에 조금 더 맞춰주세요."
        });
    }

    return {
        torso: {
            status: statusFromLevel(torsoLevel),
            level: torsoLevel,
            metrics: o.torso ?? null
        },
        head: {
            status: statusFromLevel(headLevel),
            level: headLevel,
            metrics: o.head ?? null
        },
        eyes: {
            status: eyesReliable ? (eyesClosed ? "눈 감김" : "눈 뜸") : "분석 불가",
            level: eyesReliable ? (eyesClosed ? "bad" : "good") : "unknown",
            metrics: o.eyes ?? null
        },
        gaze: {
            status: gazeReliable ? (gazeMatched ? "일치" : "차이 있음") : "분석 불가",
            level: gazeReliable ? (gazeMatched ? "good" : "fair") : "unknown",
            metrics: o.gaze ?? null
        },
        issues
    };
}

function analyzeQuality(snapshot) {
    const q = snapshot?.quality?.sharpness;
    if (!q?.available || !Number.isFinite(q.value)) {
        return { status: "분석 불가", level: "unknown", issues: [], metrics: q ?? null };
    }

    if (q.level === "bad") {
        return {
            status: "흐림 가능성",
            level: "bad",
            metrics: q,
            issues: [{
                key: "LOW_SHARPNESS",
                category: "quality",
                severity: 1.8,
                text: "사진이 많이 흐릴 가능성이 있어요.",
                retakeText: "이번에는 카메라를 고정하고 한 번 더 찍어볼게요."
            }]
        };
    }

    if (q.level === "fair") {
        return {
            status: "약간 부드러움",
            level: "fair",
            metrics: q,
            issues: []
        };
    }

    return { status: "선명", level: "good", issues: [], metrics: q };
}

function overallVerdict(composition, poseLevel, head, quality, eyes) {
    if (
        composition.level === "bad" ||
        poseLevel === "bad" ||
        head.level === "bad" ||
        quality.level === "bad" ||
        eyes.level === "bad"
    ) {
        return { title: "Reference와 차이가 보여요", tone: "retake" };
    }

    const known = [composition.level, poseLevel, head.level]
        .filter(level => level !== "unknown");
    if (known.length && known.every(level => level === "good")) {
        return { title: "Reference와 꽤 잘 맞았어요", tone: "good" };
    }

    return { title: "대체로 비슷하게 맞았어요", tone: "fair" };
}

export function analyzeCaptureSnapshot(snapshot) {
    if (!snapshot) {
        return {
            ready: false,
            verdict: { title: "촬영 결과를 충분히 분석하지 못했어요", tone: "unknown" },
            compositionStatus: "분석 불가",
            poseStatus: "분석 불가",
            faceOrientationStatus: "분석 불가",
            faceOrientationLevel: "unknown",
            primaryIssue: {
                text: "촬영 순간 분석 정보가 없어요.",
                retakeText: "다시 한 번 촬영해볼게요."
            },
            recommendRetake: true,
            retakeHintText: "다시 한 번 촬영해볼게요.",
            issues: []
        };
    }

    const composition = analyzeComposition(snapshot);
    const pose = analyzePose(snapshot);
    const orientation = analyzeOrientation(snapshot);
    const quality = analyzeQuality(snapshot);

    // Torso orientation belongs to the pose result, not to a separate user-facing score.
    const poseLevel = worstLevel(pose.level, orientation.torso.level);
    const poseStatus = statusFromLevel(poseLevel);

    const issues = [
        ...composition.issues.map(item => ({ ...item, category: item.category ?? "composition" })),
        ...pose.issues.map(item => ({ ...item, category: item.category ?? "pose" })),
        ...orientation.issues,
        ...quality.issues
    ].sort((a, b) => b.severity - a.severity);

    const primaryIssue = issues[0] ?? null;
    const recommendRetake = Boolean(
        composition.level === "bad" ||
        poseLevel === "bad" ||
        orientation.head.level === "bad" ||
        orientation.eyes.level === "bad" ||
        quality.level === "bad"
    );

    const verdict = overallVerdict(
        composition,
        poseLevel,
        orientation.head,
        quality,
        orientation.eyes
    );

    let summary;
    if (primaryIssue) {
        summary = primaryIssue.text;
    } else if (
        composition.level === "good" &&
        poseLevel === "good" &&
        (orientation.head.level === "good" || orientation.head.level === "unknown")
    ) {
        summary = "인물 구도와 포즈가 Reference에 가깝게 맞았어요.";
    } else {
        summary = "큰 차이는 없지만 일부 위치나 방향은 조금 달라요.";
    }

    return {
        ready: true,
        reference: snapshot.reference ?? null,
        verdict,
        summary,
        primaryIssue,
        issues,
        recommendRetake,
        retakeHintText:
            primaryIssue?.retakeText ??
            (recommendRetake ? "한 번 더 맞춰서 촬영해볼게요." : null),

        compositionStatus: composition.status,
        compositionLevel: composition.level,
        poseStatus,
        poseLevel,
        faceOrientationStatus: orientation.head.status,
        faceOrientationLevel: orientation.head.level,
        eyesStatus: orientation.eyes.status,
        qualityStatus: quality.status,
        qualityLevel: quality.level,

        debugScores: {
            composition: Number.isFinite(composition.score) ? Math.round(composition.score) : null,
            pose: Number.isFinite(pose.score) ? Math.round(pose.score) : null,
            sharpness: Number.isFinite(quality.metrics?.value)
                ? Math.round(quality.metrics.value * 10) / 10
                : null
        },
        metrics: {
            composition: composition.metrics,
            pose: pose.metrics,
            torso: orientation.torso.metrics,
            face: orientation.head.metrics,
            eyes: orientation.eyes.metrics,
            gaze: orientation.gaze.metrics,
            quality: quality.metrics,
            frameAgeMs: snapshot.frameAgeMs ?? null
        },
        matchedAtCapture: {
            pose: Boolean(snapshot.poseMatched),
            composition: Boolean(snapshot.compositionMatched),
            orientation: Boolean(snapshot.orientation?.captureReady),
            overall: Boolean(snapshot.overallMatched)
        },
        scopeNote: "구도는 Reference 화면비를 보존한 가상 프레임에서 인물 위치·크기·여백을 비교해요. 포즈는 신체와 상체 방향을 평가하고 얼굴 방향은 얼굴 검출이 충분할 때만 반영해요. 배경 정렬은 아직 포함하지 않아요."
    };
}
