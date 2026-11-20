// Photo Guide - Full Regression Validation v5.1
// Combines Guidance/Review regression tests with runtime state-policy tests.

import {
    runGuidanceValidation
} from "./guidance_validation_v4_7.js";

import {
    deriveRuntimePolicy,
    RUNTIME_STATES
} from "./runtime_policy_v5_1.js";

function runtimeCase({ id, description, input, predicate, expected }) {
    const actual = deriveRuntimePolicy(input);
    const pass = Boolean(predicate(actual));
    return {
        id,
        description,
        pass,
        expectedKey: expected,
        expectedActor: "RUNTIME",
        actualKey: JSON.stringify(actual),
        actualActor: "RUNTIME",
        text: null,
        phase: "STATE_POLICY"
    };
}

function runtimeTests() {
    const tests = [];

    tests.push(runtimeCase({
        id: "T19",
        description: "앱 첫 화면 + Reference 미선택 → Pose/Voice OFF",
        input: {
            state: RUNTIME_STATES.CAMERA_GUIDANCE,
            hasReference: false,
            streamLive: true,
            inferenceActive: false
        },
        expected: "camera=ON, pose=OFF, voice=OFF",
        predicate: a => a.cameraOn && !a.poseOn && !a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T20",
        description: "Reference 선택 후 Camera → Pose/Voice ON",
        input: {
            state: RUNTIME_STATES.CAMERA_GUIDANCE,
            hasReference: true,
            streamLive: true,
            inferenceActive: true
        },
        expected: "camera=ON, pose=ON, voice=ON",
        predicate: a => a.cameraOn && a.poseOn && a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T21",
        description: "Reference Library → 카메라 해제 + Pose/Voice OFF",
        input: {
            state: RUNTIME_STATES.REFERENCE_LIBRARY,
            hasReference: true,
            streamLive: false,
            inferenceActive: false
        },
        expected: "releaseCamera=true, pose=OFF, voice=OFF",
        predicate: a => a.shouldReleaseCamera && !a.poseOn && !a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T22",
        description: "Review → Camera stream 유지 가능, Pose/Voice OFF",
        input: {
            state: RUNTIME_STATES.REVIEW,
            hasReference: true,
            streamLive: true,
            inferenceActive: false
        },
        expected: "camera=ON, pose=OFF, voice=OFF, pauseInference=true",
        predicate: a => a.cameraOn && !a.poseOn && !a.voiceOn && a.shouldPauseInference
    }));

    tests.push(runtimeCase({
        id: "T23",
        description: "Auto Shoot countdown 정상 조건 → 촬영 허용",
        input: {
            state: RUNTIME_STATES.CAPTURE_COUNTDOWN,
            hasReference: true,
            streamLive: true,
            inferenceActive: true,
            autoShootArmed: true
        },
        expected: "autoCaptureAllowed=true",
        predicate: a => a.autoCaptureAllowed
    }));

    tests.push(runtimeCase({
        id: "T24",
        description: "Countdown 중 capture lock → 중복 Auto Shoot 차단",
        input: {
            state: RUNTIME_STATES.CAPTURE_COUNTDOWN,
            hasReference: true,
            streamLive: true,
            inferenceActive: true,
            autoShootArmed: true,
            captureLocked: true
        },
        expected: "autoCaptureAllowed=false",
        predicate: a => !a.autoCaptureAllowed && !a.poseOn && !a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T25",
        description: "Review 버튼 처리 중 → 저장/재촬영 중복 입력 차단",
        input: {
            state: RUNTIME_STATES.REVIEW,
            hasReference: true,
            streamLive: true,
            reviewLocked: true
        },
        expected: "canReviewAction=false",
        predicate: a => !a.canReviewAction
    }));

    tests.push(runtimeCase({
        id: "T26",
        description: "Countdown에서 Reference 없음 → Auto Shoot 불가",
        input: {
            state: RUNTIME_STATES.CAPTURE_COUNTDOWN,
            hasReference: false,
            streamLive: true,
            inferenceActive: true,
            autoShootArmed: true
        },
        expected: "autoCaptureAllowed=false, voice=OFF",
        predicate: a => !a.autoCaptureAllowed && !a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T27",
        description: "Reference 선택 상태에서 원본 카메라 모드 → Camera ON, Pose/Voice OFF",
        input: {
            state: RUNTIME_STATES.CAMERA_GUIDANCE,
            hasReference: true,
            streamLive: true,
            inferenceActive: false,
            guidanceEnabled: false
        },
        expected: "camera=ON, pose=OFF, voice=OFF",
        predicate: a => a.cameraOn && !a.poseOn && !a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T28",
        description: "원본 모드에서는 Auto Shoot countdown 조건이어도 자동촬영 차단",
        input: {
            state: RUNTIME_STATES.CAPTURE_COUNTDOWN,
            hasReference: true,
            streamLive: true,
            inferenceActive: true,
            autoShootArmed: true,
            guidanceEnabled: false
        },
        expected: "autoCaptureAllowed=false, pose=OFF, voice=OFF",
        predicate: a => !a.autoCaptureAllowed && !a.poseOn && !a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T29",
        description: "원본 모드 해제 후 Reference Guidance 재개 → Pose/Voice ON",
        input: {
            state: RUNTIME_STATES.CAMERA_GUIDANCE,
            hasReference: true,
            streamLive: true,
            inferenceActive: true,
            guidanceEnabled: true
        },
        expected: "pose=ON, voice=ON",
        predicate: a => a.poseOn && a.voiceOn
    }));

    tests.push(runtimeCase({
        id: "T30",
        description: "Reference 미선택에서는 가이드 활성 플래그가 있어도 Pose/Voice OFF",
        input: {
            state: RUNTIME_STATES.CAMERA_GUIDANCE,
            hasReference: false,
            streamLive: true,
            inferenceActive: true,
            guidanceEnabled: true
        },
        expected: "pose=OFF, voice=OFF",
        predicate: a => !a.poseOn && !a.voiceOn
    }));

    return tests;
}

export function runFullValidation() {
    const base = runGuidanceValidation();
    const extra = runtimeTests();
    const tests = [...base.tests, ...extra];
    const passed = tests.filter(test => test.pass).length;

    return {
        version: "5.1",
        passed,
        failed: tests.length - passed,
        total: tests.length,
        allPassed: passed === tests.length,
        tests
    };
}

export function showFullValidationPanel(report) {
    let panel = document.getElementById("guidanceValidationPanel");

    if (!panel) {
        panel = document.createElement("aside");
        panel.id = "guidanceValidationPanel";
        Object.assign(panel.style, {
            position: "fixed",
            top: "78px",
            left: "12px",
            width: "450px",
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
        `<div style="font-size:11px;opacity:.62">FULL REGRESSION VALIDATION · v${report.version}</div>
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
