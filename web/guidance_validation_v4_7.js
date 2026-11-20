// Photo Guide - Guidance + Review Validation Harness v4.7
// Synthetic regression tests for Guidance Engine behavior.

import {
    updateGuidance,
    resetGuidanceEngine
} from "./guidance_engine_v4_6.js";

import {
    analyzeCaptureSnapshot
} from "./post_capture_diagnosis_v4_7.js";

import {
    MATCH_POLICY
} from "./match_policy_v4_7.js";

function baseLandmarks() {
    const lms = Array.from({ length: 33 }, (_, i) => ({
        x: 0.5,
        y: 0.5,
        z: 0,
        visibility: 0.99,
        presence: 0.99
    }));

    // Give the core body a simple valid full-body geometry.
    Object.assign(lms[11], { x: 0.44, y: 0.28 });
    Object.assign(lms[12], { x: 0.56, y: 0.28 });
    Object.assign(lms[13], { x: 0.41, y: 0.43 });
    Object.assign(lms[14], { x: 0.59, y: 0.43 });
    Object.assign(lms[15], { x: 0.40, y: 0.58 });
    Object.assign(lms[16], { x: 0.60, y: 0.58 });
    Object.assign(lms[23], { x: 0.46, y: 0.52 });
    Object.assign(lms[24], { x: 0.54, y: 0.52 });
    Object.assign(lms[25], { x: 0.45, y: 0.72 });
    Object.assign(lms[26], { x: 0.55, y: 0.72 });
    Object.assign(lms[27], { x: 0.44, y: 0.94 });
    Object.assign(lms[28], { x: 0.56, y: 0.94 });

    return lms;
}

function matchedPart(label, endpoint) {
    return {
        matched: true,
        visible: true,
        partLabel: label,
        endpointLabel: endpoint,
        jointDiff: 0,
        segmentDiff: 0,
        signedJointDelta: 0,
        joint3DDiff: 0,
        segment3DDiff: 0,
        currentStart: { x: 0, y: 0 },
        currentEnd: { x: 1, y: 0 },
        targetStart: { x: 0, y: 0 },
        targetEnd: { x: 1, y: 0 }
    };
}

function basePoseState() {
    return {
        jointAngleTolerance: MATCH_POLICY.pose.jointAngleTolerance,
        hipAngleTolerance: MATCH_POLICY.pose.hipAngleTolerance,
        segmentAngleTolerance: MATCH_POLICY.pose.segmentAngleTolerance,
        joint3DTolerance: MATCH_POLICY.pose.joint3DTolerance,
        segment3DTolerance: MATCH_POLICY.pose.segment3DTolerance,
        parts: {
            leftUpperArm: matchedPart("왼쪽 위팔", "왼쪽 팔꿈치"),
            leftForearm: matchedPart("왼쪽 아래팔", "왼손"),
            rightUpperArm: matchedPart("오른쪽 위팔", "오른쪽 팔꿈치"),
            rightForearm: matchedPart("오른쪽 아래팔", "오른손"),
            leftThigh: matchedPart("왼쪽 허벅지", "왼쪽 무릎"),
            leftLowerLeg: matchedPart("왼쪽 종아리", "왼발"),
            rightThigh: matchedPart("오른쪽 허벅지", "오른쪽 무릎"),
            rightLowerLeg: matchedPart("오른쪽 종아리", "오른발")
        }
    };
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function stableResult(args) {
    resetGuidanceEngine();

    // First call starts temporal stabilization.
    updateGuidance({
        ...args,
        now: 1000
    });

    // Second call after the normal action stability window should activate it.
    return updateGuidance({
        ...args,
        now: 1600
    });
}

function compositionState({
    currentCenterX = 0.5,
    currentCenterY = 0.5,
    targetCenterX = 0.5,
    targetCenterY = 0.5,
    matched = true,
    leftMatched = true,
    rightMatched = true,
    topMatched = true,
    bottomMatched = true,
    heightRatio = 1,
    widthRatio = 1,
    shoulderRatio = 1,
    hipRatio = 1,
    torsoRatio = 1,
    fullBodyVisible = true
} = {}) {
    return {
        matched,
        current: {
            centerX: currentCenterX,
            centerY: currentCenterY,
            width: 0.34,
            height: 0.75
        },
        target: {
            centerX: targetCenterX,
            centerY: targetCenterY,
            width: 0.34,
            height: 0.75
        },
        scaleSignals: {
            heightRatio,
            widthRatio,
            shoulderRatio,
            hipRatio,
            torsoRatio
        },
        visibility: {
            fullBodyVisible
        },
        edges: {
            leftMatched,
            rightMatched,
            topMatched,
            bottomMatched
        }
    };
}

function runCase({
    id,
    description,
    expectedKey,
    expectedActor = null,
    args
}) {
    const result = stableResult(args);
    const actualKey =
        result?.action?.key ??
        result?.rawAction?.key ??
        null;
    const actualActor =
        result?.action?.actor ??
        result?.rawAction?.actor ??
        result?.actor ??
        null;

    const keyPass =
        typeof expectedKey === "function"
            ? expectedKey(actualKey, result)
            : actualKey === expectedKey;

    const actorPass =
        expectedActor === null ||
        actualActor === expectedActor;

    return {
        id,
        description,
        pass: Boolean(keyPass && actorPass),
        expectedKey:
            typeof expectedKey === "string"
                ? expectedKey
                : "(custom matcher)",
        expectedActor,
        actualKey,
        actualActor,
        text:
            result?.action?.text ??
            result?.rawAction?.text ??
            null,
        phase: result?.phase ?? null
    };
}


function makeReviewSnapshot({
    poseMatched = true,
    compositionMatched = true,
    poseErrors = {},
    poseErrors3d = {},
    compositionDelta = {},
    visibility = {}
} = {}) {
    const jointTol = MATCH_POLICY.pose.jointAngleTolerance;
    const hipTol = MATCH_POLICY.pose.hipAngleTolerance;
    const segmentTol = MATCH_POLICY.pose.segmentAngleTolerance;

    const baseErrors = {
        leftElbow: 2,
        rightElbow: 2,
        leftHip: 2,
        rightHip: 2,
        leftKnee: 2,
        rightKnee: 2,
        leftUpperArm: 2,
        leftForearm: 2,
        rightUpperArm: 2,
        rightForearm: 2,
        leftThigh: 2,
        leftLowerLeg: 2,
        rightThigh: 2,
        rightLowerLeg: 2
    };

    const target = {
        left: 100,
        right: 300,
        top: 80,
        bottom: 420
    };

    const toleranceX = 10;
    const toleranceY = 10;

    return {
        reference: { index: 0, name: "Synthetic Reference" },
        poseMatched,
        compositionMatched,
        overallMatched: poseMatched && compositionMatched,
        isMirrored: false,
        composition: {
            valid: true,
            clipped: false,
            currentLeft: target.left + Number(compositionDelta.left ?? 0),
            currentRight: target.right + Number(compositionDelta.right ?? 0),
            currentTop: target.top + Number(compositionDelta.top ?? 0),
            currentBottom: target.bottom + Number(compositionDelta.bottom ?? 0),
            targetLeft: target.left,
            targetRight: target.right,
            targetTop: target.top,
            targetBottom: target.bottom,
            toleranceX,
            toleranceY,
            tolerance: 10,
            referenceFrame: {
                left: 0,
                top: 0,
                width: 400,
                height: 500
            },
            matches: {
                left: compositionMatched,
                right: compositionMatched,
                top: compositionMatched,
                bottom: compositionMatched
            }
        },
        pose: {
            jointAngleTolerance: jointTol,
            hipAngleTolerance: hipTol,
            segmentAngleTolerance: segmentTol,
            joint3DTolerance: MATCH_POLICY.pose.joint3DTolerance,
            segment3DTolerance: MATCH_POLICY.pose.segment3DTolerance,
            visibility: {
                leftArm: true,
                rightArm: true,
                leftThigh: true,
                leftLowerLeg: true,
                rightThigh: true,
                rightLowerLeg: true,
                ...visibility
            },
            errors: {
                ...baseErrors,
                ...poseErrors
            },
            errors3d: {
                leftUpperArm: 0,
                leftForearm: 0,
                rightUpperArm: 0,
                rightForearm: 0,
                leftThigh: 0,
                leftLowerLeg: 0,
                rightThigh: 0,
                rightLowerLeg: 0,
                ...poseErrors3d
            },
            angles: {
                current: {
                    leftElbow: 120,
                    rightElbow: 120,
                    leftKnee: 150,
                    rightKnee: 150
                },
                target: {
                    leftElbow: 120,
                    rightElbow: 120,
                    leftKnee: 150,
                    rightKnee: 150
                }
            }
        },
        comparison: {
            segment_errors_deg: {},
            joint_errors_deg: {}
        },
        orientation: null,
        quality: null
    };
}

function runReviewCase({
    id,
    description,
    snapshot,
    expectedComposition = null,
    expectedPose = null,
    predicate = null
}) {
    const result = analyzeCaptureSnapshot(snapshot);

    const pass =
        typeof predicate === "function"
            ? Boolean(predicate(result))
            : (
                (expectedComposition === null ||
                    result.compositionStatus === expectedComposition) &&
                (expectedPose === null ||
                    result.poseStatus === expectedPose)
            );

    return {
        id,
        description,
        pass,
        expectedKey: [
            expectedComposition ? `composition=${expectedComposition}` : null,
            expectedPose ? `pose=${expectedPose}` : null
        ].filter(Boolean).join(", ") || "(custom matcher)",
        expectedActor: "REVIEW",
        actualKey:
            `composition=${result.compositionStatus}, pose=${result.poseStatus}`,
        actualActor: "REVIEW",
        text: result.summary ?? null,
        phase: "POST_CAPTURE"
    };
}

export function runGuidanceValidation() {
    const landmarks = baseLandmarks();
    const tests = [];

    // 1. Framing must beat pose.
    {
        const pose = basePoseState();
        pose.parts.rightForearm = {
            ...pose.parts.rightForearm,
            matched: false,
            jointDiff: 28,
            signedJointDelta: -28
        };
        pose.parts.rightUpperArm = {
            ...pose.parts.rightUpperArm,
            matched: false,
            jointDiff: 28,
            signedJointDelta: -28
        };

        tests.push(
            runCase({
                id: "T01",
                description: "구도+오른팔 동시 오류 → 구도 우선",
                expectedKey: "MODEL_MOVE_SCREEN_RIGHT",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    comparison: null,
                    adaptiveTarget: null,
                    referenceData: null,
                    compositionState: compositionState({
                        currentCenterX: 0.37,
                        targetCenterX: 0.50,
                        matched: false,
                        leftMatched: false,
                        rightMatched: false
                    }),
                    compositionMatched: false,
                    poseMatched: false,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 2. Right elbow flexion semantic cue must beat translation.
    {
        const pose = basePoseState();
        for (const key of ["rightUpperArm", "rightForearm"]) {
            pose.parts[key] = {
                ...pose.parts[key],
                matched: false,
                jointDiff: 26,
                segmentDiff: 35,
                signedJointDelta: -26,
                currentStart: { x: 0, y: 0 },
                currentEnd: { x: 0.5, y: 0.5 },
                targetStart: { x: 0, y: 0 },
                targetEnd: { x: 1.0, y: 0.0 }
            };
        }

        tests.push(
            runCase({
                id: "T02",
                description: "오른팔 굽힘 오류 → 위치보다 굽히기 우선",
                expectedKey: "RIGHT_ELBOW_BEND",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState(),
                    compositionMatched: true,
                    poseMatched: false,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 3. Left knee semantic straighten cue.
    {
        const pose = basePoseState();
        pose.parts.leftLowerLeg = {
            ...pose.parts.leftLowerLeg,
            matched: false,
            jointDiff: 22,
            signedJointDelta: 22,
            segmentDiff: 8
        };

        tests.push(
            runCase({
                id: "T03",
                description: "왼 무릎 각도 오류 → 무릎 펴기",
                expectedKey: "LEFT_KNEE_STRAIGHTEN",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState(),
                    compositionMatched: true,
                    poseMatched: false,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 4. Right lower-leg 2D direction mismatch -> move right foot to the Reference direction.
    {
        const pose = basePoseState();
        pose.parts.rightLowerLeg = {
            ...pose.parts.rightLowerLeg,
            matched: false,
            jointDiff: 4,
            signedJointDelta: 0,
            segmentDiff: 18,
            currentStart: { x: 0.50, y: 0.50 },
            currentEnd: { x: 0.50, y: 1.00 },
            targetStart: { x: 0.50, y: 0.50 },
            targetEnd: { x: 0.68, y: 0.98 }
        };

        tests.push(
            runCase({
                id: "T04",
                description: "오른 종아리 방향 오류 → 오른발을 Reference 방향으로 이동",
                expectedKey: "RIGHT_LOWER_LEG_RIGHT",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState(),
                    compositionMatched: true,
                    poseMatched: false,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 5. Matched body part must never be coached.
    {
        const pose = basePoseState();

        tests.push(
            runCase({
                id: "T05",
                description: "모든 Pose matched → 특정 팔/다리 Cue 없음",
                expectedKey: (actualKey, result) => {
                    const forbidden =
                        /ELBOW|KNEE|UPPER_ARM|FOREARM|THIGH|LOWER_LEG|FRONT_LEG/.test(
                            String(actualKey ?? "")
                        );
                    return !forbidden;
                },
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState(),
                    compositionMatched: true,
                    poseMatched: true,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 6. Vertical framing belongs to photographer.
    {
        tests.push(
            runCase({
                id: "T06",
                description: "세로 구도 오류 → 촬영자 카메라 조정",
                expectedKey: "PHOTOGRAPHER_CAMERA_UP",
                expectedActor: "PHOTOGRAPHER",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState({
                        currentCenterY: 0.40,
                        targetCenterY: 0.50,
                        matched: false,
                        topMatched: false,
                        bottomMatched: false
                    }),
                    compositionMatched: false,
                    poseMatched: true,
                    poseMatchState: basePoseState(),
                    overallMatched: false
                }
            })
        );
    }


    // 7. Left elbow is too bent relative to target -> straighten it.
    {
        const pose = basePoseState();
        for (const key of ["leftUpperArm", "leftForearm"]) {
            pose.parts[key] = {
                ...pose.parts[key],
                matched: false,
                jointDiff: 24,
                segmentDiff: 4,
                signedJointDelta: 24
            };
        }

        tests.push(
            runCase({
                id: "T07",
                description: "왼팔 각도 오류 → 왼 팔꿈치 펴기",
                expectedKey: "LEFT_ELBOW_STRAIGHTEN",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState(),
                    compositionMatched: true,
                    poseMatched: false,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 8. Right knee is too straight relative to target -> bend it.
    {
        const pose = basePoseState();
        pose.parts.rightLowerLeg = {
            ...pose.parts.rightLowerLeg,
            matched: false,
            jointDiff: 24,
            signedJointDelta: -24,
            segmentDiff: 4
        };

        tests.push(
            runCase({
                id: "T08",
                description: "오른 무릎 각도 오류 → 오른 무릎 굽히기",
                expectedKey: "RIGHT_KNEE_BEND",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState(),
                    compositionMatched: true,
                    poseMatched: false,
                    poseMatchState: pose,
                    overallMatched: false
                }
            })
        );
    }

    // 9. Subject is too large in frame -> model steps back.
    {
        tests.push(
            runCase({
                id: "T09",
                description: "인물이 너무 크게 잡힘 → 뒤로 이동",
                expectedKey: "MODEL_MOVE_BACK",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState({
                        matched: false,
                        heightRatio: 1.25,
                        widthRatio: 1.22,
                        shoulderRatio: 1.20
                    }),
                    compositionMatched: false,
                    poseMatched: true,
                    poseMatchState: basePoseState(),
                    overallMatched: false
                }
            })
        );
    }

    // 10. Subject is too far to the right -> move visually left.
    {
        tests.push(
            runCase({
                id: "T10",
                description: "가로 구도 오른쪽 치우침 → 왼쪽 이동",
                expectedKey: "MODEL_MOVE_SCREEN_LEFT",
                expectedActor: "MODEL",
                args: {
                    imageLandmarks: landmarks,
                    compositionState: compositionState({
                        currentCenterX: 0.63,
                        targetCenterX: 0.50,
                        matched: false,
                        leftMatched: false,
                        rightMatched: false
                    }),
                    compositionMatched: false,
                    poseMatched: true,
                    poseMatchState: basePoseState(),
                    overallMatched: false
                }
            })
        );
    }

    // 11. Exact live hard-match must remain "일치" in Review.
    tests.push(
        runReviewCase({
            id: "T11",
            description: "Live Pose+구도 일치 → Review도 둘 다 일치",
            snapshot: makeReviewSnapshot(),
            expectedComposition: "일치",
            expectedPose: "일치"
        })
    );

    // 12. Just outside the live pose threshold -> only "대체로 일치".
    tests.push(
        runReviewCase({
            id: "T12",
            description: "Pose 허용오차 소폭 초과 → Review 대체로 일치",
            snapshot: makeReviewSnapshot({
                poseMatched: false,
                poseErrors: {
                    rightElbow: 12,
                    rightUpperArm: 11,
                    rightForearm: 11
                }
            }),
            expectedPose: "대체로 일치"
        })
    );

    // 13. Clearly outside the live pose threshold -> Review correction needed.
    tests.push(
        runReviewCase({
            id: "T13",
            description: "Pose 허용오차 큰 폭 초과 → Review 보정 필요",
            snapshot: makeReviewSnapshot({
                poseMatched: false,
                poseErrors: {
                    rightElbow: 24,
                    rightUpperArm: 22,
                    rightForearm: 22
                }
            }),
            expectedPose: "보정 필요"
        })
    );

    // 14. Advisory 3D error must not override a 2D live hard-match.
    tests.push(
        runReviewCase({
            id: "T14",
            description: "2D Live 일치 + 3D 큰 오차 → Review Pose 일치 유지",
            snapshot: makeReviewSnapshot({
                poseMatched: true,
                poseErrors3d: {
                    rightUpperArm: 80,
                    rightForearm: 75,
                    leftThigh: 70
                }
            }),
            expectedPose: "일치"
        })
    );

    // 15. Slightly outside live framing threshold -> "대체로 일치".
    tests.push(
        runReviewCase({
            id: "T15",
            description: "구도 허용오차 소폭 초과 → Review 대체로 일치",
            snapshot: makeReviewSnapshot({
                compositionMatched: false,
                compositionDelta: {
                    left: 13,
                    right: 13
                }
            }),
            expectedComposition: "대체로 일치"
        })
    );

    // 16. Large framing error -> correction needed.
    tests.push(
        runReviewCase({
            id: "T16",
            description: "구도 허용오차 큰 폭 초과 → Review 보정 필요",
            snapshot: makeReviewSnapshot({
                compositionMatched: false,
                compositionDelta: {
                    left: 25,
                    right: 25
                }
            }),
            expectedComposition: "보정 필요"
        })
    );

    // 17. Hip-only mismatch used by live thigh matcher must not be called "일치".
    tests.push(
        runReviewCase({
            id: "T17",
            description: "고관절만 Live 허용오차 초과 → Review Pose 일치 금지",
            snapshot: makeReviewSnapshot({
                poseMatched: false,
                poseErrors: {
                    leftHip: 14
                }
            }),
            predicate: result => result.poseStatus !== "일치"
        })
    );

    // 18. A missing required limb cannot be reported as a full pose match.
    tests.push(
        runReviewCase({
            id: "T18",
            description: "필수 다리 검출 부족 → Review Pose 일치 금지",
            snapshot: makeReviewSnapshot({
                poseMatched: false,
                visibility: {
                    rightLowerLeg: false
                }
            }),
            predicate: result => result.poseStatus !== "일치"
        })
    );

    const passed = tests.filter(t => t.pass).length;

    return {
        version: "4.7",
        passed,
        failed: tests.length - passed,
        total: tests.length,
        allPassed: passed === tests.length,
        tests
    };
}

export function showGuidanceValidationPanel(report) {
    let panel = document.getElementById("guidanceValidationPanel");

    if (!panel) {
        panel = document.createElement("aside");
        panel.id = "guidanceValidationPanel";
        Object.assign(panel.style, {
            position: "fixed",
            top: "78px",
            left: "12px",
            width: "430px",
            maxHeight: "calc(100vh - 100px)",
            overflow: "auto",
            zIndex: "10061",
            borderRadius: "14px",
            padding: "14px",
            background: "rgba(9,11,16,.94)",
            color: "#fff",
            boxShadow: "0 14px 40px rgba(0,0,0,.45)",
            backdropFilter: "blur(12px)",
            fontFamily: "system-ui,-apple-system,sans-serif"
        });
        document.body.appendChild(panel);
    }

    panel.innerHTML = "";

    const header = document.createElement("div");
    header.style.cssText =
        "display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;";

    const title = document.createElement("div");
    title.innerHTML =
        `<div style="font-size:11px;opacity:.62">GUIDANCE + REVIEW VALIDATION · v4.7</div>
         <div style="font-size:17px;font-weight:850">${
            report.allPassed ? "ALL PASS" : "CHECK REQUIRED"
         } · ${report.passed}/${report.total}</div>`;

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.style.cssText =
        "border:0;background:rgba(255,255,255,.1);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:18px;";
    close.onclick = () => {
        panel.style.display = "none";
    };

    header.append(title, close);
    panel.appendChild(header);

    for (const test of report.tests) {
        const card = document.createElement("div");
        card.style.cssText = [
            "padding:10px",
            "margin:7px 0",
            "border-radius:10px",
            test.pass
                ? "background:rgba(33,124,81,.22);border:1px solid rgba(94,220,154,.22)"
                : "background:rgba(147,58,47,.22);border:1px solid rgba(255,130,111,.30)"
        ].join(";");

        card.innerHTML = `
            <div style="display:flex;gap:7px;align-items:center">
              <b style="font-size:12px">${test.id}</b>
              <span style="font-size:11px;font-weight:800;color:${
                  test.pass ? "#aef2cf" : "#ffb5a8"
              }">${test.pass ? "PASS" : "FAIL"}</span>
            </div>
            <div style="font-size:12px;margin-top:4px">${test.description}</div>
            <div style="font-size:10px;opacity:.68;margin-top:5px;font-family:ui-monospace,monospace">
              expected: ${test.expectedKey}<br>
              actual: ${test.actualKey ?? "null"}<br>
              actor: ${test.actualActor ?? "null"}<br>
              text: ${test.text ?? "-"}
            </div>
        `;
        panel.appendChild(card);
    }

    panel.style.display = "block";
    return panel;
}
