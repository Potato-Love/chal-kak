// Photo Guide - Reference Audit v4.6
// Development-only inspection of what the system believes the Reference pose is.

function finite(v) {
    return Number.isFinite(Number(v));
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function normalizeAngle180(angle) {
    let value = ((Number(angle) + 180) % 360 + 360) % 360 - 180;
    if (value === -180) value = 180;
    return value;
}

function normalizeAxisTilt(angle) {
    let value = normalizeAngle180(angle);
    if (value > 90) value -= 180;
    if (value < -90) value += 180;
    return value;
}

function pxPoint(referenceData, index) {
    const lm =
        referenceData?.landmarks?.[String(index)] ??
        referenceData?.landmarks?.[index];

    const width = Number(referenceData?.image?.width);
    const height = Number(referenceData?.image?.height);

    if (!lm || !finite(width) || !finite(height)) return null;

    return {
        x: Number(lm.x) * width,
        y: Number(lm.y) * height,
        z: finite(lm.z) ? Number(lm.z) : null
    };
}

function lineAngle(a, b) {
    if (!a || !b) return null;
    return normalizeAngle180(
        Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
    );
}

function jointAngle(a, b, c) {
    if (!a || !b || !c) return null;

    const a1 = Math.atan2(a.y - b.y, a.x - b.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);

    let deg = Math.abs((a2 - a1) * 180 / Math.PI);
    if (deg > 180) deg = 360 - deg;
    return deg;
}

function dist(a, b) {
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function round(value, digits = 1) {
    if (!finite(value)) return null;
    const p = 10 ** digits;
    return Math.round(Number(value) * p) / p;
}

function sideOfScreen(point, width) {
    if (!point || !finite(width)) return "-";
    if (point.x < width * 0.42) return "화면 왼쪽";
    if (point.x > width * 0.58) return "화면 오른쪽";
    return "화면 중앙";
}

function compositionAudit(referenceData) {
    const c = referenceData?.composition ?? {};
    return {
        centerX: round(c.center_x ?? c.centerX, 3),
        centerY: round(c.center_y ?? c.centerY, 3),
        width: round(c.width, 3),
        height: round(c.height, 3)
    };
}

export function buildReferenceAudit({
    referenceData,
    referenceName = "Reference",
    referenceFaceAnalysis = null
}) {
    const P = index => pxPoint(referenceData, index);

    const p11 = P(11), p12 = P(12);
    const p13 = P(13), p14 = P(14);
    const p15 = P(15), p16 = P(16);
    const p23 = P(23), p24 = P(24);
    const p25 = P(25), p26 = P(26);
    const p27 = P(27), p28 = P(28);

    const width = Number(referenceData?.image?.width);
    const height = Number(referenceData?.image?.height);

    const shoulderCenter =
        p11 && p12
            ? { x: (p11.x + p12.x) / 2, y: (p11.y + p12.y) / 2 }
            : null;

    const hipCenter =
        p23 && p24
            ? { x: (p23.x + p24.x) / 2, y: (p23.y + p24.y) / 2 }
            : null;

    const torso = dist(shoulderCenter, hipCenter);

    const warnings = [];

    if (!p27 || !p28) {
        warnings.push("발목 Landmark 27/28 중 일부가 없습니다.");
    }


    const joints = {
        leftElbow: round(jointAngle(p11, p13, p15)),
        rightElbow: round(jointAngle(p12, p14, p16)),
        leftHip: round(jointAngle(p11, p23, p25)),
        rightHip: round(jointAngle(p12, p24, p26)),
        leftKnee: round(jointAngle(p23, p25, p27)),
        rightKnee: round(jointAngle(p24, p26, p28))
    };

    const segments = {
        leftUpperArm: round(lineAngle(p11, p13)),
        rightUpperArm: round(lineAngle(p12, p14)),
        leftForearm: round(lineAngle(p13, p15)),
        rightForearm: round(lineAngle(p14, p16)),
        leftThigh: round(lineAngle(p23, p25)),
        rightThigh: round(lineAngle(p24, p26)),
        leftLowerLeg: round(lineAngle(p25, p27)),
        rightLowerLeg: round(lineAngle(p26, p28))
    };

    const torsoMetrics = {
        bodyLean: round(
            hipCenter && shoulderCenter
                ? lineAngle(hipCenter, shoulderCenter) + 90
                : null
        ),
        shoulderTilt: round(
            p11 && p12
                ? normalizeAxisTilt(lineAngle(p11, p12))
                : null
        ),
        hipTilt: round(
            p23 && p24
                ? normalizeAxisTilt(lineAngle(p23, p24))
                : null
        )
    };

    const feet = {
        anatomicalLeft: {
            landmark: 27,
            screenPosition: sideOfScreen(p27, width),
            x: round(p27?.x, 1),
            y: round(p27?.y, 1)
        },
        anatomicalRight: {
            landmark: 28,
            screenPosition: sideOfScreen(p28, width),
            x: round(p28?.x, 1),
            y: round(p28?.y, 1)
        }
    };

    const face = referenceFaceAnalysis
        ? {
            detected: Boolean(referenceFaceAnalysis.detected),
            headReliable: Boolean(referenceFaceAnalysis.headReliable),
            eyesReliable: Boolean(referenceFaceAnalysis.eyesReliable),
            yawProxy: round(referenceFaceAnalysis?.head?.yawProxy, 3),
            rollDeg: round(referenceFaceAnalysis?.head?.rollDeg, 1),
            blinkMax: round(referenceFaceAnalysis?.eyes?.blinkMax, 2)
        }
        : {
            detected: false,
            headReliable: false,
            eyesReliable: false,
            yawProxy: null,
            rollDeg: null,
            blinkMax: null
        };

    return {
        version: "4.5",
        referenceName,
        image: {
            width: finite(width) ? width : null,
            height: finite(height) ? height : null,
            aspect:
                finite(width) && finite(height) && height !== 0
                    ? round(width / height, 3)
                    : null
        },
        joints,
        segments,
        torso: torsoMetrics,
        feet,
        composition: compositionAudit(referenceData),
        face,
        warnings
    };
}

function badge(text, tone = "neutral") {
    const span = document.createElement("span");
    span.textContent = text;
    span.style.cssText = [
        "display:inline-block",
        "padding:3px 7px",
        "border-radius:999px",
        "font-size:11px",
        "font-weight:700",
        tone === "good"
            ? "background:#124f35;color:#aef2cf"
            : tone === "warn"
                ? "background:#5a3a10;color:#ffd99a"
                : "background:#262b33;color:#dce3ed"
    ].join(";");
    return span;
}

function metricRow(label, value) {
    const row = document.createElement("div");
    row.style.cssText =
        "display:grid;grid-template-columns:1.45fr 1fr;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:12px;";
    const a = document.createElement("div");
    a.textContent = label;
    a.style.opacity = ".75";
    const b = document.createElement("div");
    b.textContent = value ?? "-";
    b.style.fontFamily = "ui-monospace,monospace";
    b.style.textAlign = "right";
    row.append(a, b);
    return row;
}

function section(title) {
    const wrap = document.createElement("section");
    wrap.style.cssText =
        "padding:10px 0;border-top:1px solid rgba(255,255,255,.10);";
    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText =
        "font-weight:800;font-size:12px;margin-bottom:5px;color:#fff;";
    wrap.appendChild(h);
    return wrap;
}

export function showReferenceAuditPanel(audit) {
    let panel = document.getElementById("referenceAuditPanel");

    if (!panel) {
        panel = document.createElement("aside");
        panel.id = "referenceAuditPanel";
        Object.assign(panel.style, {
            position: "fixed",
            top: "78px",
            right: "12px",
            width: "360px",
            maxHeight: "calc(100vh - 100px)",
            overflow: "auto",
            zIndex: "10060",
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

    const top = document.createElement("div");
    top.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;";

    const title = document.createElement("div");
    title.innerHTML =
        `<div style="font-size:11px;opacity:.62">REFERENCE AUDIT · v4.6</div>
         <div style="font-weight:850;font-size:16px">${audit.referenceName}</div>`;

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.style.cssText =
        "border:0;background:rgba(255,255,255,.1);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:18px;";
    close.onclick = () => {
        panel.style.display = "none";
    };

    top.append(title, close);
    panel.appendChild(top);

    const intent = document.createElement("div");
    intent.style.cssText =
        "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px;";
    intent.append(
        badge(
            audit.face.headReliable
                ? "얼굴 방향 신뢰 가능"
                : "얼굴 방향 보조/미검출",
            audit.face.headReliable ? "good" : "neutral"
        )
    );
    panel.appendChild(intent);

    const footSec = section("좌우 / 다리 기준");
    footSec.append(
        metricRow(
            "L(27) 인물 왼발",
            `${audit.feet.anatomicalLeft.screenPosition}`
        ),
        metricRow(
            "R(28) 인물 오른발",
            `${audit.feet.anatomicalRight.screenPosition}`
        )
    );
    panel.appendChild(footSec);

    const jointSec = section("관절각 (deg)");
    const j = audit.joints;
    jointSec.append(
        metricRow("왼 팔꿈치", j.leftElbow),
        metricRow("오른 팔꿈치", j.rightElbow),
        metricRow("왼 고관절", j.leftHip),
        metricRow("오른 고관절", j.rightHip),
        metricRow("왼 무릎", j.leftKnee),
        metricRow("오른 무릎", j.rightKnee)
    );
    panel.appendChild(jointSec);

    const segSec = section("Segment 방향 (deg)");
    const s = audit.segments;
    segSec.append(
        metricRow("왼 위팔", s.leftUpperArm),
        metricRow("오른 위팔", s.rightUpperArm),
        metricRow("왼 아래팔", s.leftForearm),
        metricRow("오른 아래팔", s.rightForearm),
        metricRow("왼 허벅지", s.leftThigh),
        metricRow("오른 허벅지", s.rightThigh),
        metricRow("왼 종아리", s.leftLowerLeg),
        metricRow("오른 종아리", s.rightLowerLeg)
    );
    panel.appendChild(segSec);

    const torsoSec = section("상체");
    torsoSec.append(
        metricRow("Body lean", `${audit.torso.bodyLean ?? "-"}°`),
        metricRow("Shoulder tilt", `${audit.torso.shoulderTilt ?? "-"}°`),
        metricRow("Hip tilt", `${audit.torso.hipTilt ?? "-"}°`)
    );
    panel.appendChild(torsoSec);

    const compSec = section("구도");
    const c = audit.composition;
    compSec.append(
        metricRow("center x / y", `${c.centerX ?? "-"} / ${c.centerY ?? "-"}`),
        metricRow("width / height", `${c.width ?? "-"} / ${c.height ?? "-"}`)
    );
    panel.appendChild(compSec);

    const faceSec = section("얼굴");
    faceSec.append(
        metricRow("검출", audit.face.detected ? "YES" : "NO"),
        metricRow("head reliable", audit.face.headReliable ? "YES" : "NO"),
        metricRow("yaw proxy", audit.face.yawProxy),
        metricRow("roll", audit.face.rollDeg !== null ? `${audit.face.rollDeg}°` : "-")
    );
    panel.appendChild(faceSec);

    if (audit.warnings?.length) {
        const warningSec = section("주의");
        for (const warning of audit.warnings) {
            const line = document.createElement("div");
            line.textContent = `• ${warning}`;
            line.style.cssText =
                "font-size:11px;line-height:1.5;color:#ffd99a;";
            warningSec.appendChild(line);
        }
        panel.appendChild(warningSec);
    }

    panel.style.display = "block";
    return panel;
}
