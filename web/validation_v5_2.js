// Photo Guide - Full Regression Validation v5.2
// v5.1 30 tests + Custom Reference validation tests.

import {
    runFullValidation as runV51Validation,
    showFullValidationPanel as showV51ValidationPanel
} from "./validation_v5_1.js";

import {
    validateReferenceCandidate,
    buildCustomReferencePayload
} from "./reference_validator_v5_2.js";

function basePose() {
    const pts=Array.from({length:33},(_,i)=>({x:0.5,y:0.2+i*0.015,z:0,visibility:0.99,presence:0.99}));
    const set=(i,x,y,z=0)=>{pts[i]={x,y,z,visibility:0.99,presence:0.99};};
    set(0,.50,.12,-.1);
    set(11,.42,.28,-.03); set(12,.58,.28,.03);
    set(13,.35,.42,-.03); set(14,.65,.42,.03);
    set(15,.30,.56,-.03); set(16,.70,.56,.03);
    set(23,.45,.52,-.02); set(24,.55,.52,.02);
    set(25,.43,.70,-.02); set(26,.57,.70,.02);
    set(27,.41,.90,-.02); set(28,.59,.90,.02);
    set(31,.39,.94,-.02); set(32,.61,.94,.02);
    return pts;
}
function worldPose() {
    return basePose().map(p=>({x:(p.x-.5)*2,y:(p.y-.52)*2,z:p.z,visibility:p.visibility,presence:p.presence}));
}
function resultCase(id,description,actual,expectedPass) {
    return {
        id,description,pass:Boolean(actual.valid)===expectedPass,
        expectedKey:expectedPass?"VALID":"INVALID",
        expectedActor:"CUSTOM_REFERENCE",
        actualKey:`${actual.reasonCode}:${actual.valid}`,
        actualActor:"CUSTOM_REFERENCE",
        text:actual.message,phase:"CUSTOM_REFERENCE"
    };
}
function customReferenceTests() {
    const tests=[];
    const good=basePose(), world=worldPose();
    tests.push(resultCase("T31","정상 전신 사진 → VALID",validateReferenceCandidate({landmarksList:[good],worldLandmarksList:[world],width:900,height:1200}),true));
    tests.push(resultCase("T32","사람 미검출 → INVALID",validateReferenceCandidate({landmarksList:[],worldLandmarksList:[],width:900,height:1200}),false));
    tests.push(resultCase("T33","여러 사람 검출 → INVALID",validateReferenceCandidate({landmarksList:[good,basePose()],worldLandmarksList:[world,worldPose()],width:900,height:1200}),false));
    const cropped=basePose(); cropped[28]={...cropped[28],x:1.03};
    tests.push(resultCase("T34","신체 일부 프레임 밖 → INVALID",validateReferenceCandidate({landmarksList:[cropped],worldLandmarksList:[world],width:900,height:1200}),false));
    const tiny=basePose().map(p=>({...p,x:.48+(p.x-.5)*.2,y:.48+(p.y-.5)*.2}));
    tests.push(resultCase("T35","인물이 너무 작음 → INVALID",validateReferenceCandidate({landmarksList:[tiny],worldLandmarksList:[world],width:900,height:1200}),false));
    const low=basePose(); low[15]={...low[15],visibility:.05};
    tests.push(resultCase("T36","주요 관절 신뢰도 부족 → INVALID",validateReferenceCandidate({landmarksList:[low],worldLandmarksList:[world],width:900,height:1200}),false));
    const broken=basePose(); broken[13]={...broken[11]};
    tests.push(resultCase("T37","관절 geometry 계산 불가 → INVALID",validateReferenceCandidate({landmarksList:[broken],worldLandmarksList:[world],width:900,height:1200}),false));
    tests.push(resultCase("T38","World landmark 없음 → INVALID",validateReferenceCandidate({landmarksList:[good],worldLandmarksList:[],width:900,height:1200}),false));
    try {
        const payload=buildCustomReferencePayload({name:"내 이미지 01",fileName:"test.jpg",width:900,height:1200,landmarks:good,worldLandmarks:world});
        tests.push({id:"T39",description:"VALID 입력 → Reference/Adaptive payload 생성",pass:Boolean(payload.referenceData?.landmarks?.["11"]&&payload.adaptiveTargetData?.retargeted_landmarks_3d?.["28"]),expectedKey:"payload ready",expectedActor:"CUSTOM_REFERENCE",actualKey:"payload generated",actualActor:"CUSTOM_REFERENCE",text:null,phase:"CUSTOM_REFERENCE"});
    } catch (error) {
        tests.push({id:"T39",description:"VALID 입력 → Reference/Adaptive payload 생성",pass:false,expectedKey:"payload ready",expectedActor:"CUSTOM_REFERENCE",actualKey:String(error),actualActor:"CUSTOM_REFERENCE",text:null,phase:"CUSTOM_REFERENCE"});
    }
    return tests;
}

export function runFullValidation() {
    const base=runV51Validation();
    const extra=customReferenceTests();
    const tests=[...base.tests,...extra];
    const passed=tests.filter(t=>t.pass).length;
    return {version:"5.2",passed,failed:tests.length-passed,total:tests.length,allPassed:passed===tests.length,tests};
}

export function showFullValidationPanel(report) {
    return showV51ValidationPanel(report);
}
