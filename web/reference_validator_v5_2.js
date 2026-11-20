// Photo Guide - Custom Reference Validator v5.2
// Pure validation/data-build helpers for user-imported Reference images.

const REQUIRED_LANDMARKS = [11,12,13,14,15,16,23,24,25,26,27,28];
const BODY_LANDMARKS = REQUIRED_LANDMARKS;
const CORE = new Set([11,12,23,24]);
const MID = new Set([13,14,25,26]);
const END = new Set([15,16,27,28]);

function finite(v) { return Number.isFinite(Number(v)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
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
function midpoint(a,b) { return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z??0)+(b.z??0))/2}; }
function lineAngle(a,b) { return normalizeAngle180(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI); }
function jointAngle(a,b,c) {
    const a1=Math.atan2(a.y-b.y,a.x-b.x);
    const a2=Math.atan2(c.y-b.y,c.x-b.x);
    let deg=Math.abs((a2-a1)*180/Math.PI);
    if (deg>180) deg=360-deg;
    return deg;
}
function visibilityOf(lm) { return lm?.visibility === undefined ? 1 : Number(lm.visibility); }
function presenceOf(lm) { return lm?.presence === undefined ? 1 : Number(lm.presence); }
function requiredVisibility(index) {
    if (CORE.has(index)) return 0.45;
    if (MID.has(index)) return 0.35;
    if (END.has(index)) return 0.30;
    return 0.35;
}
function landmarkUsable(lm,index) {
    if (!lm || !finite(lm.x) || !finite(lm.y)) return false;
    if (presenceOf(lm) < 0.45) return false;
    if (visibilityOf(lm) < requiredVisibility(index)) return false;
    return lm.x >= 0.01 && lm.x <= 0.99 && lm.y >= 0.01 && lm.y <= 0.99;
}
function bodyBox(landmarks) {
    const usable = landmarks.filter(lm => lm && finite(lm.x) && finite(lm.y) && visibilityOf(lm) >= 0.25);
    if (!usable.length) return null;
    const xs=usable.map(p=>Number(p.x)), ys=usable.map(p=>Number(p.y));
    const min_x=Math.min(...xs), max_x=Math.max(...xs), min_y=Math.min(...ys), max_y=Math.max(...ys);
    return {
        min_x,max_x,min_y,max_y,
        width:max_x-min_x,height:max_y-min_y,
        center_x:(min_x+max_x)/2,center_y:(min_y+max_y)/2
    };
}
function geometryValid(landmarks) {
    const P=i=>landmarks[i];
    const triples=[[11,13,15],[12,14,16],[11,23,25],[12,24,26],[23,25,27],[24,26,28]];
    for (const [a,b,c] of triples) {
        const value=jointAngle(P(a),P(b),P(c));
        if (!finite(value)) return false;
    }
    for (const [a,b] of [[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]]) {
        const d=Math.hypot(P(b).x-P(a).x,P(b).y-P(a).y);
        if (!finite(d) || d < 0.005) return false;
    }
    return true;
}

export function validateReferenceCandidate({landmarksList, worldLandmarksList, width, height}) {
    if (!finite(width) || !finite(height) || Number(width) < 32 || Number(height) < 32) {
        return {valid:false,reasonCode:"INVALID_IMAGE",message:"이미지 크기를 확인할 수 없습니다. 다른 사진을 선택해주세요."};
    }
    const poses = Array.isArray(landmarksList) ? landmarksList : [];
    if (poses.length === 0) {
        return {valid:false,reasonCode:"NO_PERSON",message:"사람을 찾을 수 없습니다. 사람이 잘 보이는 사진을 선택해주세요."};
    }
    if (poses.length > 1) {
        return {valid:false,reasonCode:"MULTIPLE_PEOPLE",message:"여러 사람이 검출되었습니다. 한 명만 나온 사진을 선택해주세요."};
    }
    const landmarks=poses[0];
    const missing=REQUIRED_LANDMARKS.filter(i=>!landmarkUsable(landmarks[i],i));
    if (missing.length) {
        const cropped = missing.some(i => {
            const lm=landmarks[i];
            return lm && finite(lm.x) && finite(lm.y) && (lm.x < 0.01 || lm.x > 0.99 || lm.y < 0.01 || lm.y > 0.99);
        });
        return {
            valid:false,
            reasonCode:cropped ? "BODY_CROPPED" : "LANDMARKS_LOW_CONFIDENCE",
            message:cropped
                ? "팔이나 다리 일부가 잘려 자세를 정확하게 비교하기 어렵습니다. 전신이 충분히 보이는 사진을 선택해주세요."
                : "주요 관절을 충분히 확인하기 어렵습니다. 팔과 다리가 잘 보이는 사진을 선택해주세요.",
            details:{missingLandmarks:missing}
        };
    }
    const box=bodyBox(landmarks);
    if (!box || box.width < 0.12 || box.height < 0.32) {
        return {valid:false,reasonCode:"PERSON_TOO_SMALL",message:"인물이 너무 작아 자세를 안정적으로 분석하기 어렵습니다. 사람이 더 크게 나온 사진을 선택해주세요.",details:{box}};
    }
    if (!geometryValid(landmarks)) {
        return {valid:false,reasonCode:"GEOMETRY_INVALID",message:"자세 정보를 안정적으로 계산하기 어렵습니다. 다른 전신 사진을 선택해주세요."};
    }
    const world = Array.isArray(worldLandmarksList) && worldLandmarksList[0];
    if (!world || BODY_LANDMARKS.some(i=>!world[i] || !finite(world[i].x) || !finite(world[i].y) || !finite(world[i].z))) {
        return {valid:false,reasonCode:"WORLD_LANDMARKS_MISSING",message:"자세의 공간 정보를 계산하기 어렵습니다. 다른 사진을 선택해주세요."};
    }
    return {valid:true,reasonCode:"VALID",message:"Reference로 사용할 수 있는 사진입니다.",details:{box}};
}

function objectifyLandmarks(list) {
    const out={};
    list.forEach((lm,index)=>{
        if (!lm) return;
        out[String(index)]={
            x:Number(lm.x), y:Number(lm.y), z:finite(lm.z)?Number(lm.z):0,
            visibility:visibilityOf(lm), presence:presenceOf(lm)
        };
    });
    return out;
}

function poseIntent(landmarks, worldLandmarks) {
    const P=i=>landmarks[i];
    const shoulderCenter=midpoint(P(11),P(12));
    const hipCenter=midpoint(P(23),P(24));
    const joint_angles_2d={
        left_elbow:jointAngle(P(11),P(13),P(15)), right_elbow:jointAngle(P(12),P(14),P(16)),
        left_hip:jointAngle(P(11),P(23),P(25)), right_hip:jointAngle(P(12),P(24),P(26)),
        left_knee:jointAngle(P(23),P(25),P(27)), right_knee:jointAngle(P(24),P(26),P(28))
    };
    const screen_orientation_2d={
        body_lean_angle:normalizeAngle180(lineAngle(hipCenter,shoulderCenter)+90),
        shoulder_tilt_angle:normalizeAxisTilt(lineAngle(P(11),P(12))),
        hip_tilt_angle:normalizeAxisTilt(lineAngle(P(23),P(24)))
    };
    const W=i=>worldLandmarks?.[i];
    const relative_depth_cues={
        shoulder_depth_difference:W(11)&&W(12) ? Number(W(12).z)-Number(W(11).z) : 0,
        hip_depth_difference:W(23)&&W(24) ? Number(W(24).z)-Number(W(23).z) : 0
    };
    return {joint_angles_2d,screen_orientation_2d,relative_depth_cues};
}

function compositionFromLandmarks(landmarks) {
    const box=bodyBox(landmarks);
    return {
        center_x:box.center_x, center_y:box.center_y, width:box.width, height:box.height,
        min_x:box.min_x,max_x:box.max_x,min_y:box.min_y,max_y:box.max_y,
        bbox_area_ratio:box.width*box.height,
        horizontal_offset_from_center:box.center_x-0.5,
        vertical_offset_from_center:box.center_y-0.5,
        left_margin:box.min_x,right_margin:1-box.max_x,headroom:box.min_y,footroom:1-box.max_y
    };
}

export function buildCustomReferencePayload({name,fileName,width,height,landmarks,worldLandmarks}) {
    const composition=compositionFromLandmarks(landmarks);
    const intent=poseIntent(landmarks,worldLandmarks);
    const referenceData={
        schema_version:"custom-2.1",
        reference:{image_file:fileName,custom:true,name},
        image:{width:Number(width),height:Number(height)},
        composition,
        pose_intent:intent,
        landmarks:objectifyLandmarks(landmarks),
        world_landmarks:objectifyLandmarks(worldLandmarks),
        quality:{custom_reference:true,validated:true},
        design_note:"Generated in-browser by Photo Guide Custom Reference Import v5.2"
    };
    const retargeted_landmarks_3d={};
    for (const i of BODY_LANDMARKS) {
        const p=worldLandmarks[i];
        retargeted_landmarks_3d[String(i)]={x:Number(p.x),y:Number(p.y),z:Number(p.z)};
    }
    const adaptiveTargetData={
        schema_version:"custom-1.0",
        profile_type:"custom_reference_pose",
        source:{reference_image:fileName,custom:true},
        reference_pose_intent:intent,
        retargeted_landmarks_3d,
        composition_target:composition,
        notes:{coordinate_system:"MediaPipe world landmarks normalized by comparator body frame."}
    };
    return {referenceData,adaptiveTargetData,composition};
}

export const CUSTOM_REFERENCE_LIMITS = Object.freeze({
    maxFileBytes: 15 * 1024 * 1024,
    maxAnalysisDimension: 1600,
    maxThumbnailDimension: 240
});
