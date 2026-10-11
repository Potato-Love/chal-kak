import {
    FilesetResolver,
    PoseLandmarker,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";

console.log("APP START");

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const cameraContainer = document.querySelector(".camera-container");

const referenceScreen =
    document.getElementById("referenceScreen");

const referencePreview =
    document.getElementById("referencePreview");

const referenceNumber =
    document.getElementById("referenceNumber");

const referenceThumbnails =
    document.getElementById("referenceThumbnails");

const prevReferenceButton =
    document.getElementById("prevReferenceButton");

const nextReferenceButton =
    document.getElementById("nextReferenceButton");

const selectReferenceButton =
    document.getElementById("selectReferenceButton");

const backToReferenceButton =
    document.getElementById("backToReferenceButton");

const captureButton =
    document.getElementById("captureButton");

const capturePreviewScreen =
    document.getElementById("capturePreviewScreen");

const capturedImage =
    document.getElementById("capturedImage");

const retakeButton =
    document.getElementById("retakeButton");

const savePhotoButton =
    document.getElementById("savePhotoButton");

const mirrorButton =
    document.getElementById("mirrorButton");

const ctx = canvas.getContext("2d");
const drawingUtils = new DrawingUtils(ctx);

let lastVideoTime = -1;
let poseLandmarker;
let referenceData;

let currentFacingMode = "environment";
let currentStream = null;
let predictionStarted = false;

const referenceItems = [
    {
        name: "Reference 01",
        image: "../reference_01.jpg",
        json: "reference_01.json"
    },
    {
        name: "Reference 02",
        image: "../reference_02.jpg",
        json: "reference_02.json"
    },
    {
        name: "Reference 03",
        image: "../reference_03.jpg",
        json: "reference_03.json"
    },
    {
        name: "Reference 04",
        image: "../reference_04.jpg",
        json: "reference_04.json"
    }
];

let targetPoints = {};
let targetComposition = {};

let currentReferenceIndex = 0;
let previewReferenceIndex = 0;

let swipeStartX = null;
let swipeStartY = null;

const swipeThreshold = 50;

let isReferenceAnimating = false;

let smoothedPoints = {};
const smoothingFactor = 0.3;
const visibilityThreshold = 0.5;
let overallMatched = false;

let capturedImageData = null;

const connections = [
    [11, 12],
    [11, 13], [13, 15],
    [12, 14], [14, 16],
    [11, 23], [12, 24],
    [23, 24],
    [23, 25], [25, 27],
    [24, 26], [26, 28]
];

async function createPoseLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );


    poseLandmarker = await PoseLandmarker.createFromOptions(
        vision,
        {
            baseOptions: {
                modelAssetPath: "../models/pose_landmarker_full.task"
            },
            runningMode: "VIDEO",
            numPoses: 1
        }
    );

    console.log("PoseLandmarker loaded");
}

async function loadReference(fileName) {
    const response = await fetch(`../${fileName}`);
    referenceData = await response.json();

    console.log(`Reference loaded: ${fileName}`);
}

async function loadReferenceByIndex(index) {
    if (
        index < 0 ||
        index >= referenceItems.length
    ) {
        return;
    }

    currentReferenceIndex = index;

    await loadReference(
        referenceItems[currentReferenceIndex].json
    );
}

function createReferenceThumbnails() {

    referenceThumbnails.innerHTML = "";

    referenceItems.forEach((reference, index) => {

        const button =
            document.createElement("button");

        button.type = "button";
        button.className =
            "reference-thumbnail";

        const image =
            document.createElement("img");

        image.src =
            reference.image;

        image.alt =
            reference.name;

        button.appendChild(image);

        button.addEventListener(
            "click",
            () => {

                if (
                    index ===
                    previewReferenceIndex
                ) {
                    return;
                }

                const direction =
                    index >
                        previewReferenceIndex
                        ? "next"
                        : "prev";

                showReference(
                    index,
                    direction
                );
            }
        );

        referenceThumbnails.appendChild(
            button
        );
    });
}

function updateReferencePreview() {

    const reference =
        referenceItems[previewReferenceIndex];

    referencePreview.src =
        reference.image;

    referenceNumber.textContent =
        reference.name;

    const thumbnails =
        document.querySelectorAll(
            ".reference-thumbnail"
        );

    thumbnails.forEach(
        (thumbnail, index) => {

            thumbnail.classList.toggle(
                "active",
                index === previewReferenceIndex
            );
        }
    );

    const activeThumbnail =
        thumbnails[previewReferenceIndex];

    if (activeThumbnail) {

        activeThumbnail.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest"
        });
    }
}

function getNextReferenceIndex(direction) {

    if (direction === "next") {

        return (
            previewReferenceIndex + 1
        ) % referenceItems.length;
    }

    return (
        previewReferenceIndex -
        1 +
        referenceItems.length
    ) % referenceItems.length;
}

async function showReference(
    nextIndex,
    direction
) {

    if (
        isReferenceAnimating ||
        nextIndex === previewReferenceIndex
    ) {
        return;
    }

    isReferenceAnimating = true;

    const outX =
        direction === "next"
            ? -40
            : 40;

    const inX =
        direction === "next"
            ? 40
            : -40;


    const outAnimation =
        referencePreview.animate(
            [
                {
                    opacity: 1,
                    transform: "translateX(0)"
                },
                {
                    opacity: 0,
                    transform:
                        `translateX(${outX}px)`
                }
            ],
            {
                duration: 130,
                easing: "ease-in",
                fill: "forwards"
            }
        );

    await outAnimation.finished;


    previewReferenceIndex = nextIndex;

    updateReferencePreview();


    const inAnimation =
        referencePreview.animate(
            [
                {
                    opacity: 0,
                    transform:
                        `translateX(${inX}px)`
                },
                {
                    opacity: 1,
                    transform: "translateX(0)"
                }
            ],
            {
                duration: 180,
                easing: "ease-out",
                fill: "forwards"
            }
        );

    await inAnimation.finished;


    outAnimation.cancel();
    inAnimation.cancel();

    isReferenceAnimating = false;
}

referencePreview.addEventListener(
    "pointerdown",
    (event) => {

        swipeStartX = event.clientX;
        swipeStartY = event.clientY;

        referencePreview.setPointerCapture(
            event.pointerId
        );
    }
);

referencePreview.addEventListener(
    "pointerup",
    (event) => {

        if (
            swipeStartX === null ||
            swipeStartY === null
        ) {
            return;
        }

        const deltaX =
            event.clientX - swipeStartX;

        const deltaY =
            event.clientY - swipeStartY;

        swipeStartX = null;
        swipeStartY = null;

        if (
            Math.abs(deltaX) < swipeThreshold ||
            Math.abs(deltaX) <= Math.abs(deltaY)
        ) {
            return;
        }

        if (deltaX < 0) {

            const nextIndex =
                getNextReferenceIndex("next");

            showReference(
                nextIndex,
                "next"
            );
        }

        else {

            const nextIndex =
                getNextReferenceIndex("prev");

            showReference(
                nextIndex,
                "prev"
            );
        }
    }
);

referencePreview.addEventListener(
    "pointercancel",
    () => {
        swipeStartX = null;
        swipeStartY = null;
    }
);

prevReferenceButton.addEventListener(
    "click",
    () => {

        const nextIndex =
            getNextReferenceIndex("prev");

        showReference(
            nextIndex,
            "prev"
        );
    }
);
nextReferenceButton.addEventListener(
    "click",
    () => {

        const nextIndex =
            getNextReferenceIndex("next");

        showReference(
            nextIndex,
            "next"
        );
    }
);

console.log(
    "BEFORE SELECT LISTENER",
    selectReferenceButton
);

selectReferenceButton.addEventListener(
    "click",
    async () => {

        await loadReferenceByIndex(
            previewReferenceIndex
        );

        referenceScreen.style.display = "none";

        await startCamera();
    }
);

console.log("SELECT LISTENER REGISTERED");

function drawTargetSkeleton() {
    if (!referenceData) {
        return;
    }

    const referenceWidth = referenceData.image.width;
    const referenceHeight = referenceData.image.height;

    const fitScale = Math.min(
        canvas.width / referenceWidth,
        canvas.height / referenceHeight
    );

    const scaledWidth = referenceWidth * fitScale;
    const scaledHeight = referenceHeight * fitScale;

    const offsetX = (canvas.width - scaledWidth) / 2;
    const offsetY = (canvas.height - scaledHeight) / 2;

    targetPoints = {};

    for (let index = 0; index < 33; index++) {
        const landmark =
            referenceData.landmarks[index.toString()];

        const referenceX =
            landmark.x * referenceWidth;

        const referenceY =
            landmark.y * referenceHeight;

        const targetX =
            referenceX * fitScale + offsetX;

        const targetY =
            referenceY * fitScale + offsetY;

        targetPoints[index] = {
            x: targetX,
            y: targetY
        };
    }

    const composition = referenceData.composition;

    const referenceLeft =
        composition.center_x - composition.width / 2;

    const referenceRight =
        composition.center_x + composition.width / 2;

    const referenceTop =
        composition.center_y - composition.height / 2;

    const referenceBottom =
        composition.center_y + composition.height / 2;

    targetComposition = {
        left:
            referenceLeft * referenceWidth * fitScale + offsetX,

        right:
            referenceRight * referenceWidth * fitScale + offsetX,

        top:
            referenceTop * referenceHeight * fitScale + offsetY,

        bottom:
            referenceBottom * referenceHeight * fitScale + offsetY
    };

    ctx.strokeStyle = "#FF6600";
    ctx.lineWidth = 2;

    for (const [start, end] of connections) {
        ctx.beginPath();

        ctx.moveTo(
            targetPoints[start].x,
            targetPoints[start].y
        );

        ctx.lineTo(
            targetPoints[end].x,
            targetPoints[end].y
        );

        ctx.stroke();
    }
}

function drawCompositionGuide(
    leftColor,
    rightColor,
    topColor,
    bottomColor
) {
    const cornerLength = 25;

    const left = targetComposition.left;
    const right = targetComposition.right;
    const top = targetComposition.top;
    const bottom = targetComposition.bottom;

    ctx.lineWidth = 2;


    // Top Leftedictweb
    ctx.strokeStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + cornerLength, top);
    ctx.stroke();

    ctx.strokeStyle = leftColor;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + cornerLength);
    ctx.stroke();


    // Top Right
    ctx.strokeStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(right, top);
    ctx.lineTo(right - cornerLength, top);
    ctx.stroke();

    ctx.strokeStyle = rightColor;
    ctx.beginPath();
    ctx.moveTo(right, top);
    ctx.lineTo(right, top + cornerLength);
    ctx.stroke();


    // Bottom Left
    ctx.strokeStyle = bottomColor;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left + cornerLength, bottom);
    ctx.stroke();

    ctx.strokeStyle = leftColor;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, bottom - cornerLength);
    ctx.stroke();


    // Bottom Right
    ctx.strokeStyle = bottomColor;
    ctx.beginPath();
    ctx.moveTo(right, bottom);
    ctx.lineTo(right - cornerLength, bottom);
    ctx.stroke();

    ctx.strokeStyle = rightColor;
    ctx.beginPath();
    ctx.moveTo(right, bottom);
    ctx.lineTo(right, bottom - cornerLength);
    ctx.stroke();
}

function calculateJointAngle(a, b, c) {
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

function calculateSegmentAngle(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    return Math.atan2(dy, dx) * 180 / Math.PI;
}

function calculateAngleDifference(angle1, angle2) {
    const difference = Math.abs(angle1 - angle2);

    return Math.min(
        difference,
        360 - difference
    );
}

function predictWebcam() {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        requestAnimationFrame(predictWebcam);
        return;
    }

    if (!poseLandmarker) {
        console.error("PoseLandmarker is not initialized");
        return;
    }

    if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
    ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        const results = poseLandmarker.detectForVideo(
            video,
            performance.now()
        );

        console.log("Landmarks detected:", results.landmarks.length);

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        overallMatched = false;

        drawTargetSkeleton();

        drawCompositionGuide(
            "#FF00FF",
            "#FF00FF",
            "#FF00FF",
            "#FF00FF"
        );

        if (results.landmarks.length > 0) {
            for (const landmarks of results.landmarks) {

                const isVisible = (index) => {
                    return (
                        landmarks[index].visibility !== undefined &&
                        landmarks[index].visibility >= visibilityThreshold
                    );
                };

                const currentPoints = {};

                for (let index = 0; index < 33; index++) {

                    const newX =
                        landmarks[index].x * canvas.width;

                    const newY =
                        landmarks[index].y * canvas.height;

                    let smoothX;
                    let smoothY;

                    if (!smoothedPoints[index]) {
                        smoothX = newX;
                        smoothY = newY;
                    }

                    else {
                        smoothX =
                            smoothedPoints[index].x *
                            (1 - smoothingFactor) +
                            newX * smoothingFactor;

                        smoothY =
                            smoothedPoints[index].y *
                            (1 - smoothingFactor) +
                            newY * smoothingFactor;
                    }

                    smoothedPoints[index] = {
                        x: smoothX,
                        y: smoothY
                    };

                    currentPoints[index] = {
                        x: smoothX,
                        y: smoothY
                    };
                }

                const currentXValues = [];
                const currentYValues = [];

                for (let index = 0; index < 33; index++) {
                    currentXValues.push(currentPoints[index].x);
                    currentYValues.push(currentPoints[index].y);
                }

                const currentLeft = Math.min(...currentXValues);
                const currentRight = Math.max(...currentXValues);
                const currentTop = Math.min(...currentYValues);
                const currentBottom = Math.max(...currentYValues);

                const coreBodyVisible =
                    isVisible(11) &&
                    isVisible(12) &&
                    isVisible(23) &&
                    isVisible(24);

                const compositionInsideFrame =
                    currentLeft >= 0 &&
                    currentRight <= canvas.width &&
                    currentTop >= 0 &&
                    currentBottom <= canvas.height;

                const compositionValid =
                    coreBodyVisible &&
                    compositionInsideFrame;

                const torsoLength = Math.hypot(
                    currentPoints[23].x - currentPoints[11].x,
                    currentPoints[23].y - currentPoints[11].y
                );

                const compositionTolerance =
                    torsoLength * 0.15;

                const leftMatched =
                    compositionValid &&
                    Math.abs(
                        currentLeft - targetComposition.left
                    ) <= compositionTolerance;

                const rightMatched =
                    compositionValid &&
                    Math.abs(
                        currentRight - targetComposition.right
                    ) <= compositionTolerance;

                const topMatched =
                    compositionValid &&
                    Math.abs(
                        currentTop - targetComposition.top
                    ) <= compositionTolerance;

                const bottomMatched =
                    compositionValid &&
                    Math.abs(
                        currentBottom - targetComposition.bottom
                    ) <= compositionTolerance;

                const jointAngleTolerance = 15;
                const segmentAngleTolerance = 15;
                const leftArmVisible =
                    isVisible(11) &&
                    isVisible(13) &&
                    isVisible(15);

                const rightArmVisible =
                    isVisible(12) &&
                    isVisible(14) &&
                    isVisible(16);

                const leftThighVisible =
                    isVisible(11) &&
                    isVisible(23) &&
                    isVisible(25);

                const leftLowerLegVisible =
                    isVisible(23) &&
                    isVisible(25) &&
                    isVisible(27);

                const rightThighVisible =
                    isVisible(12) &&
                    isVisible(24) &&
                    isVisible(26);

                const rightLowerLegVisible =
                    isVisible(24) &&
                    isVisible(26) &&
                    isVisible(28);


                // =========================
                // LEFT ARM
                // =========================

                const leftElbowAngle = calculateJointAngle(
                    currentPoints[11],
                    currentPoints[13],
                    currentPoints[15]
                );

                const targetLeftElbowAngle = calculateJointAngle(
                    targetPoints[11],
                    targetPoints[13],
                    targetPoints[15]
                );

                const leftUpperArmAngle = calculateSegmentAngle(
                    currentPoints[11],
                    currentPoints[13]
                );

                const targetLeftUpperArmAngle = calculateSegmentAngle(
                    targetPoints[11],
                    targetPoints[13]
                );

                const leftForearmAngle = calculateSegmentAngle(
                    currentPoints[13],
                    currentPoints[15]
                );

                const targetLeftForearmAngle = calculateSegmentAngle(
                    targetPoints[13],
                    targetPoints[15]
                );

                const leftElbowDiff = Math.abs(
                    leftElbowAngle - targetLeftElbowAngle
                );

                const leftUpperArmDiff = calculateAngleDifference(
                    leftUpperArmAngle,
                    targetLeftUpperArmAngle
                );

                const leftForearmDiff = calculateAngleDifference(
                    leftForearmAngle,
                    targetLeftForearmAngle
                );

                const leftUpperArmMatched =
                    leftArmVisible &&
                    leftElbowDiff <= jointAngleTolerance &&
                    leftUpperArmDiff <= segmentAngleTolerance;

                const leftForearmMatched =
                    leftArmVisible &&
                    leftElbowDiff <= jointAngleTolerance &&
                    leftForearmDiff <= segmentAngleTolerance;


                // =========================
                // RIGHT ARM
                // =========================

                const rightElbowAngle = calculateJointAngle(
                    currentPoints[12],
                    currentPoints[14],
                    currentPoints[16]
                );

                const targetRightElbowAngle = calculateJointAngle(
                    targetPoints[12],
                    targetPoints[14],
                    targetPoints[16]
                );

                const rightUpperArmAngle = calculateSegmentAngle(
                    currentPoints[12],
                    currentPoints[14]
                );

                const targetRightUpperArmAngle = calculateSegmentAngle(
                    targetPoints[12],
                    targetPoints[14]
                );

                const rightForearmAngle = calculateSegmentAngle(
                    currentPoints[14],
                    currentPoints[16]
                );

                const targetRightForearmAngle = calculateSegmentAngle(
                    targetPoints[14],
                    targetPoints[16]
                );

                const rightElbowDiff = Math.abs(
                    rightElbowAngle - targetRightElbowAngle
                );

                const rightUpperArmDiff = calculateAngleDifference(
                    rightUpperArmAngle,
                    targetRightUpperArmAngle
                );

                const rightForearmDiff = calculateAngleDifference(
                    rightForearmAngle,
                    targetRightForearmAngle
                );

                const rightUpperArmMatched =
                    rightArmVisible &&
                    rightElbowDiff <= jointAngleTolerance &&
                    rightUpperArmDiff <= segmentAngleTolerance;

                const rightForearmMatched =
                    rightArmVisible &&
                    rightElbowDiff <= jointAngleTolerance &&
                    rightForearmDiff <= segmentAngleTolerance;

                // =========================
                // LEFT LEG
                // =========================

                const leftHipAngle = calculateJointAngle(
                    currentPoints[11],
                    currentPoints[23],
                    currentPoints[25]
                );

                const targetLeftHipAngle = calculateJointAngle(
                    targetPoints[11],
                    targetPoints[23],
                    targetPoints[25]
                );

                const leftKneeAngle = calculateJointAngle(
                    currentPoints[23],
                    currentPoints[25],
                    currentPoints[27]
                );

                const targetLeftKneeAngle = calculateJointAngle(
                    targetPoints[23],
                    targetPoints[25],
                    targetPoints[27]
                );

                const leftThighAngle = calculateSegmentAngle(
                    currentPoints[23],
                    currentPoints[25]
                );

                const targetLeftThighAngle = calculateSegmentAngle(
                    targetPoints[23],
                    targetPoints[25]
                );

                const leftLowerLegAngle = calculateSegmentAngle(
                    currentPoints[25],
                    currentPoints[27]
                );

                const targetLeftLowerLegAngle = calculateSegmentAngle(
                    targetPoints[25],
                    targetPoints[27]
                );

                const leftHipDiff = Math.abs(
                    leftHipAngle - targetLeftHipAngle
                );

                const leftKneeDiff = Math.abs(
                    leftKneeAngle - targetLeftKneeAngle
                );

                const leftThighDiff = calculateAngleDifference(
                    leftThighAngle,
                    targetLeftThighAngle
                );

                const leftLowerLegDiff = calculateAngleDifference(
                    leftLowerLegAngle,
                    targetLeftLowerLegAngle
                );

                const leftThighMatched =
                    leftThighVisible &&
                    leftHipDiff <= jointAngleTolerance &&
                    leftThighDiff <= segmentAngleTolerance;

                const leftLowerLegMatched =
                    leftLowerLegVisible &&
                    leftKneeDiff <= jointAngleTolerance &&
                    leftLowerLegDiff <= segmentAngleTolerance;

                // =========================
                // RIGHT LEG
                // =========================

                const rightHipAngle = calculateJointAngle(
                    currentPoints[12],
                    currentPoints[24],
                    currentPoints[26]
                );

                const targetRightHipAngle = calculateJointAngle(
                    targetPoints[12],
                    targetPoints[24],
                    targetPoints[26]
                );

                const rightKneeAngle = calculateJointAngle(
                    currentPoints[24],
                    currentPoints[26],
                    currentPoints[28]
                );

                const targetRightKneeAngle = calculateJointAngle(
                    targetPoints[24],
                    targetPoints[26],
                    targetPoints[28]
                );

                const rightThighAngle = calculateSegmentAngle(
                    currentPoints[24],
                    currentPoints[26]
                );

                const targetRightThighAngle = calculateSegmentAngle(
                    targetPoints[24],
                    targetPoints[26]
                );

                const rightLowerLegAngle = calculateSegmentAngle(
                    currentPoints[26],
                    currentPoints[28]
                );

                const targetRightLowerLegAngle = calculateSegmentAngle(
                    targetPoints[26],
                    targetPoints[28]
                );

                const rightHipDiff = Math.abs(
                    rightHipAngle - targetRightHipAngle
                );

                const rightKneeDiff = Math.abs(
                    rightKneeAngle - targetRightKneeAngle
                );

                const rightThighDiff = calculateAngleDifference(
                    rightThighAngle,
                    targetRightThighAngle
                );

                const rightLowerLegDiff = calculateAngleDifference(
                    rightLowerLegAngle,
                    targetRightLowerLegAngle
                );

                const rightThighMatched =
                    rightThighVisible &&
                    rightHipDiff <= jointAngleTolerance &&
                    rightThighDiff <= segmentAngleTolerance;

                const rightLowerLegMatched =
                    rightLowerLegVisible &&
                    rightKneeDiff <= jointAngleTolerance &&
                    rightLowerLegDiff <= segmentAngleTolerance;

                const allPoseMatched =
                    leftUpperArmMatched &&
                    leftForearmMatched &&
                    rightUpperArmMatched &&
                    rightForearmMatched &&
                    leftThighMatched &&
                    leftLowerLegMatched &&
                    rightThighMatched &&
                    rightLowerLegMatched;

                const compositionMatched =
                    leftMatched &&
                    rightMatched &&
                    topMatched &&
                    bottomMatched;

                overallMatched =
                    allPoseMatched &&
                    compositionMatched;

                if (overallMatched) {
                    console.log("OVERALL MATCH");
                }

                captureButton.classList.toggle(
                    "matched",
                    overallMatched
                );

                // =========================
                // DRAW CURRENT SKELETON
                // =========================

                for (const [start, end] of connections) {

                    let color = "#0064FF";

                    // Torso = Gray
                    if (
                        (start === 11 && end === 12) ||
                        (start === 11 && end === 23) ||
                        (start === 12 && end === 24) ||
                        (start === 23 && end === 24)
                    ) {
                        color = "#A0A0A0";
                    }

                    // Left Arm
                    else if (
                        start === 11 &&
                        end === 13 &&
                        leftUpperArmMatched
                    ) {
                        color = "#00FF00";
                    }

                    else if (
                        start === 13 &&
                        end === 15 &&
                        leftForearmMatched
                    ) {
                        color = "#00FF00";
                    }

                    // Right Arm
                    else if (
                        start === 12 &&
                        end === 14 &&
                        rightUpperArmMatched
                    ) {
                        color = "#00FF00";
                    }

                    else if (
                        start === 14 &&
                        end === 16 &&
                        rightForearmMatched
                    ) {
                        color = "#00FF00";
                    }

                    // Left Leg
                    else if (
                        start === 23 &&
                        end === 25 &&
                        leftThighMatched
                    ) {
                        color = "#00FF00";
                    }

                    else if (
                        start === 25 &&
                        end === 27 &&
                        leftLowerLegMatched
                    ) {
                        color = "#00FF00";
                    }

                    // Right Leg
                    else if (
                        start === 24 &&
                        end === 26 &&
                        rightThighMatched
                    ) {
                        color = "#00FF00";
                    }

                    else if (
                        start === 26 &&
                        end === 28 &&
                        rightLowerLegMatched
                    ) {
                        color = "#00FF00";
                    }

                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;

                    ctx.beginPath();

                    ctx.moveTo(
                        currentPoints[start].x,
                        currentPoints[start].y
                    );

                    ctx.lineTo(
                        currentPoints[end].x,
                        currentPoints[end].y
                    );

                    ctx.stroke();
                }
                ctx.strokeStyle = "#A0A0A0";
                ctx.lineWidth = 1;

                ctx.strokeRect(
                    currentLeft,
                    currentTop,
                    currentRight - currentLeft,
                    currentBottom - currentTop
                );

                const targetColor = "#FF00FF";
                const matchedColor = "#00FF00";

                const leftColor =
                    leftMatched ? matchedColor : targetColor;

                const rightColor =
                    rightMatched ? matchedColor : targetColor;

                const topColor =
                    topMatched ? matchedColor : targetColor;

                const bottomColor =
                    bottomMatched ? matchedColor : targetColor;

                drawCompositionGuide(
                    leftColor,
                    rightColor,
                    topColor,
                    bottomColor
                );
            }
        }
    }

    if (!overallMatched) {
        captureButton.classList.remove("matched");
    }

    requestAnimationFrame(predictWebcam);
}

function showCaptureFlash() {

    if (!captureFlash) {
        return;
    }

    captureFlash.classList.add("active");

    setTimeout(() => {
        captureFlash.classList.remove("active");
    }, 120);
}

function capturePhoto() {

    if (
        video.videoWidth === 0 ||
        video.videoHeight === 0
    ) {
        return;
    }

    showCaptureFlash();

    const captureCanvas =
        document.createElement("canvas");

    const captureContext =
        captureCanvas.getContext("2d");

    captureCanvas.width =
        video.videoWidth;

    captureCanvas.height =
        video.videoHeight;

    const isMirrored =
        cameraContainer.classList.contains("mirror");

    if (isMirrored) {

        captureContext.save();

        captureContext.translate(
            captureCanvas.width,
            0
        );

        captureContext.scale(
            -1,
            1
        );

        captureContext.drawImage(
            video,
            0,
            0,
            captureCanvas.width,
            captureCanvas.height
        );

        captureContext.restore();
    }

    else {

        captureContext.drawImage(
            video,
            0,
            0,
            captureCanvas.width,
            captureCanvas.height
        );
    }

    capturedImageData =
        captureCanvas.toDataURL(
            "image/jpeg",
            0.95
        );

    capturedImage.src =
        capturedImageData;

    capturePreviewScreen.style.display =
        "flex";

    console.log("Photo captured");
}

function closeCapturePreview() {

    capturePreviewScreen.style.display =
        "none";

    capturedImage.src = "";

    capturedImageData = null;
}

function saveCapturedPhoto() {

    if (!capturedImageData) {
        return;
    }

    const link =
        document.createElement("a");

    link.href =
        capturedImageData;

    link.download =
        `photo-guide-${Date.now()}.jpg`;

    link.click();

    closeCapturePreview();

    console.log("Photo saved");
}

function setMirrorState(isMirror) {

    cameraContainer.classList.toggle(
        "mirror",
        isMirror
    );

    mirrorButton.classList.toggle(
        "active",
        isMirror
    );

    mirrorButton.setAttribute(
        "aria-pressed",
        isMirror
    );
}

function toggleMirror() {

    const isMirror =
        cameraContainer.classList.toggle("mirror");

    mirrorButton.classList.toggle(
        "active",
        isMirror
    );

    mirrorButton.setAttribute(
        "aria-pressed",
        isMirror
    );
}

document.addEventListener("keydown", async (event) => {

    const key = event.key.toLowerCase();
    if (key === "m") {
        toggleMirror();
    }

    else if (key === "1") {
        await loadReferenceByIndex(0);
    }

    else if (key === "2") {
        await loadReferenceByIndex(1);
    }

    else if (key === "c") {
        capturePhoto();
    }
});

async function startCamera() {
    try {
        // 기존 카메라가 실행 중이면 먼저 종료
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }

        // 현재 선택된 방향의 카메라 요청
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: currentFacingMode }
            },
            audio: false
        });

        currentStream = stream;
        video.srcObject = stream;

        // 카메라 영상이 준비되면 Pose 추론 시작
        video.onloadeddata = () => {
            if (!predictionStarted) {
                predictionStarted = true;
                predictWebcam();
            }
        };

        console.log(
            `Camera started: ${currentFacingMode === "environment" ? "rear" : "front"
            }`
        );

    } catch (error) {
        console.error("Camera Error:", error);
    }
}

async function switchCamera() {

    currentFacingMode =
        currentFacingMode === "environment"
            ? "user"
            : "environment";

    const shouldMirror =
        currentFacingMode === "user";

    setMirrorState(shouldMirror);

    await startCamera();
}

const switchCameraButton =
    document.getElementById("switchCameraButton");

switchCameraButton.addEventListener("click", async () => {
    await switchCamera();
});

mirrorButton.addEventListener(
    "click",
    () => {
        toggleMirror();
    }
);

backToReferenceButton.addEventListener(
    "click",
    () => {

        if (currentStream) {
            currentStream
                .getTracks()
                .forEach(track => track.stop());

            currentStream = null;
        }

        video.srcObject = null;

        smoothedPoints = {};

        previewReferenceIndex =
            currentReferenceIndex;

        updateReferencePreview();

        referenceScreen.style.display = "flex";
    }
);

captureButton.addEventListener(
    "click",
    () => {
        capturePhoto();
    }
);

retakeButton.addEventListener(
    "click",
    () => {
        closeCapturePreview();
    }
);

savePhotoButton.addEventListener(
    "click",
    () => {
        saveCapturedPhoto();
    }
);

await createPoseLandmarker();

createReferenceThumbnails();

updateReferencePreview();