import {
    FilesetResolver,
    PoseLandmarker,
    FaceLandmarker,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";

import {
    loadAdaptiveTarget,
    setAdaptiveTargetData,
    getAdaptiveTarget,
    compareLivePose3D
} from "./live_pose_comparator_v2_1.js";

import {
    MATCH_POLICY,
    getLiveCompositionTolerance
} from "./match_policy_v4_7.js";

import {
    updateGuidance,
    resetGuidanceEngine
} from "./guidance_engine_v4_6.js";

import {
    updateOneCue,
    speakOneCue,
    resetOneCueController
} from "./one_cue_controller_v4_6.js";

import {
    analyzeCaptureSnapshot
} from "./post_capture_diagnosis_v4_7.js";

import {
    analyzeFaceLandmarkerResult,
    setReferenceFaceAnalysis,
    updateOrientationQuality,
    estimatePersonSharpness,
    resetOrientationQuality
} from "./orientation_quality_v4_6.js";

import {
    buildReferenceAudit,
    showReferenceAuditPanel
} from "./reference_audit_v4_6.js";

import {
    runFullValidation,
    showFullValidationPanel
} from "./validation_v5_2.js";

import {
    validateReferenceCandidate,
    buildCustomReferencePayload,
    CUSTOM_REFERENCE_LIMITS
} from "./reference_validator_v5_2.js";

import {
    listCustomReferences,
    saveCustomReference,
    deleteCustomReference
} from "./custom_reference_store_v5_2.js";

console.log("APP START - Photo Guide v5.8 clean UI integration");

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

const captureFlash =
    document.getElementById("captureFlash");

// Camera-first UX: never present the Reference Library as the initial home screen.
if (referenceScreen) referenceScreen.hidden = true;
if (capturePreviewScreen) capturePreviewScreen.hidden = true;

const ctx = canvas.getContext("2d");
const drawingUtils = new DrawingUtils(ctx);

let lastVideoTime = -1;
let poseLandmarker;
let faceLandmarker = null;
let referenceData;
let lastFaceDetectAt = 0;
let lastGoodFaceAt = -Infinity;
let latestFaceAnalysis = null;
let currentReferenceFaceAnalysis = null;
let latestFaceLandmarks = null;
let faceTimestamp = 0;

// v4.9: Debug UI is opt-in even on localhost.
// Normal user view: http://localhost:8001/web/
// Developer view:   http://localhost:8001/web/?debug=1
const isDevelopmentHost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

const debugModeParam =
    new URLSearchParams(location.search).get("debug");

const isDebugMode =
    isDevelopmentHost &&
    (debugModeParam === "1" || debugModeParam === "true");

const debugView = {
    // Debug overlays must never appear automatically on app start.
    // They become available only after the user explicitly selects a Reference.
    face: false,
    referenceFrame: false,
    metrics: false
};

let referenceFrame = null;

// v4.4: Reference leg-depth semantics are inferred only from the visible
// 2D pose projection. MediaPipe monocular z is NOT treated as ground truth
// for "which foot is in front".

let currentFacingMode = "environment";
let mirrorEnabled = false;
let currentStream = null;

const APP_STATES = Object.freeze({
    REFERENCE_LIBRARY: "REFERENCE_LIBRARY",
    CAMERA_GUIDANCE: "CAMERA_GUIDANCE",
    CAPTURE_COUNTDOWN: "CAPTURE_COUNTDOWN",
    REVIEW: "REVIEW"
});

// v4.6 is camera-first: the camera is the home screen.
let appState = APP_STATES.CAMERA_GUIDANCE;

const SELECTED_REFERENCE_STORAGE_KEY =
    "photoGuide.selectedReferenceIndex";

// No Reference is active on a true first launch. Once the user selects one,
// the choice is persisted and restored on future launches.
let hasSelectedReference = false;

// v5.4: public UI structure is declared in index.html.
// app.js only binds behavior/state to those elements.
let referenceLibraryButton = document.getElementById("referenceLibraryButton");
let referenceDockThumbnail = document.getElementById("referenceDockThumbnail");
let referenceLibraryCloseButton = document.getElementById("referenceLibraryCloseButton");
let cameraStatusPanel = document.getElementById("cameraStatusPanel");
let referenceLibraryStatus = document.getElementById("referenceLibraryStatus");
let referenceLibraryStatusTimer = null;
let cameraBottomDock = document.getElementById("cameraBottomDock");
let referenceDockSlot = document.getElementById("referenceDockSlot");
let captureDockSlot = document.getElementById("captureDockSlot");
let switchDockSlot = document.getElementById("switchDockSlot");
let customReferenceAddButton = document.getElementById("customReferenceAddButton");
let customReferenceFileInput = document.getElementById("customReferenceFileInput");
let customReferenceImportBusy = false;
let guideDrawer = document.getElementById("guideDrawer");
let guideToolbar = document.getElementById("guideToolbar");
let guideDrawerHandle = document.getElementById("guideDrawerHandle");
let voiceToggleButton = document.getElementById("voiceToggleButton");
let settingsButton = document.getElementById("settingsButton");
let settingsScreen = document.getElementById("settingsScreen");
let settingsCloseButton = document.getElementById("settingsCloseButton");
let cameraStatusText = document.getElementById("cameraStatusText");
let cameraRetryButton = document.getElementById("cameraRetryButton");
let voiceUiEnabled = true;
let referenceImportPoseLandmarker = null;
let inferenceActive = false;
let predictionFrameId = null;
// v5.1: user can temporarily return to a plain/original camera without losing the selected Reference.
let guidancePausedByUser = false;

let lastComparatorLogTime = 0;
let lastGuidanceLogTime = 0;

let latest3DComparison = null;
let latestGuidance = null;
let latestFrameSnapshot = null;
let lastCaptureReview = null;
let guidanceResumeAt = 0;

let autoCaptureTimer = null;
let autoCaptureLocked = false;

// v5.1 runtime guards: prevent double transitions and stale async camera starts.
let captureTransitionLocked = false;
let reviewActionLocked = false;
let cameraRequestSerial = 0;
let cameraStarting = false;
let debugRuntimeMonitor = null;
let debugRuntimeMonitorTimer = null;

function cancelAutoCapture(reason = "state-change") {
    if (autoCaptureTimer) {
        clearTimeout(autoCaptureTimer);
        autoCaptureTimer = null;
        console.log(`[AUTO SHOOT CANCELLED] ${reason}`);
    }
}

function guidanceSessionEnabled() {
    return Boolean(
        hasSelectedReference &&
        !guidancePausedByUser
    );
}

function cancelSpeechNow() {
    try {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
        }
    } catch (_) {
        // Speech cancellation is best-effort only.
    }
}

function voiceGuidanceEnabled() {
    return Boolean(
        voiceUiEnabled &&
        guidanceSessionEnabled() &&
        (
            appState === APP_STATES.CAMERA_GUIDANCE ||
            appState === APP_STATES.CAPTURE_COUNTDOWN
        ) &&
        !captureTransitionLocked
    );
}

function speakGuidanceCue(text, options = {}) {
    if (!voiceGuidanceEnabled()) {
        return false;
    }
    return speakOneCue(text, options);
}

function setAppState(nextState) {
    if (appState === nextState) {
        updateCameraHomeControls();
        updateDebugRuntimeMonitor();
        return;
    }

    const previousState = appState;

    // Leaving countdown for anything other than the actual capture must disarm it.
    if (
        previousState === APP_STATES.CAPTURE_COUNTDOWN &&
        nextState !== APP_STATES.REVIEW
    ) {
        cancelAutoCapture(`state ${previousState} -> ${nextState}`);
    }

    console.log(`[APP STATE] ${previousState} -> ${nextState}`);
    appState = nextState;
    updateCameraHomeControls();
    updateDebugRuntimeMonitor();
}

function canRunInference() {
    return (
        inferenceActive &&
        guidanceSessionEnabled() &&
        (
            appState === APP_STATES.CAMERA_GUIDANCE ||
            appState === APP_STATES.CAPTURE_COUNTDOWN
        )
    );
}

function queueNextPrediction() {
    if (!canRunInference()) {
        predictionFrameId = null;
        return;
    }

    predictionFrameId =
        requestAnimationFrame(predictWebcam);
}

function startPredictionLoop() {
    if (
        appState !== APP_STATES.CAMERA_GUIDANCE &&
        appState !== APP_STATES.CAPTURE_COUNTDOWN
    ) {
        return;
    }

    if (!guidanceSessionEnabled()) {
        inferenceActive = false;
        predictionFrameId = null;
        console.log(
            hasSelectedReference
                ? "[INFERENCE] idle: 사용자가 가이드를 꺼서 원본 카메라 모드로 실행"
                : "[INFERENCE] idle: Reference가 선택되지 않아 일반 카메라 모드로 실행"
        );
        return;
    }

    if (inferenceActive) {
        return;
    }

    inferenceActive = true;
    lastVideoTime = -1;
    queueNextPrediction();

    console.log("[INFERENCE] started");
    updateDebugRuntimeMonitor();
}

function stopPredictionLoop() {
    inferenceActive = false;

    if (predictionFrameId !== null) {
        cancelAnimationFrame(predictionFrameId);
        predictionFrameId = null;
    }

    console.log("[INFERENCE] stopped");
    updateDebugRuntimeMonitor();
}

function stopCameraStream() {
    // Invalidate any getUserMedia request that has not resolved yet.
    cameraRequestSerial += 1;
    cameraStarting = false;
    stopPredictionLoop();

    if (currentStream) {
        currentStream
            .getTracks()
            .forEach(track => track.stop());

        currentStream = null;
    }

    video.pause();
    video.srcObject = null;
}


function getStoredReferenceIndex() {
    try {
        const stored = Number(
            localStorage.getItem(SELECTED_REFERENCE_STORAGE_KEY)
        );

        if (
            Number.isInteger(stored) &&
            stored >= 0 &&
            stored < referenceItems.length
        ) {
            return stored;
        }
    } catch (_) {
        // Storage can be blocked; treat as no saved Reference.
    }

    return null;
}

function storeSelectedReferenceIndex(index) {
    try {
        localStorage.setItem(
            SELECTED_REFERENCE_STORAGE_KEY,
            String(index)
        );
    } catch (_) {
        // Non-critical preference persistence only.
    }
}

function selectedReferenceLabel() {
    if (!hasSelectedReference) return null;
    return referenceItems[currentReferenceIndex]?.name ?? null;
}

function setCameraStatus(message = "", { error = false, retry = false } = {}) {
    if (!cameraStatusPanel || !cameraStatusText || !cameraRetryButton) return;

    const visible = Boolean(message);
    cameraStatusPanel.style.display = visible ? "flex" : "none";
    cameraStatusPanel.classList.toggle("is-error", Boolean(error));
    cameraStatusText.textContent = message;
    cameraRetryButton.hidden = !retry;

    if (!visible) return;

    cameraRetryButton.onclick = retry
        ? () => {
            setCameraStatus("카메라를 다시 준비하고 있어요...");
            void startCamera();
        }
        : null;
}

function setReferenceLibraryStatus(
    message = "",
    { error = false, busy = false, autoHideMs = 0 } = {}
) {
    if (!referenceLibraryStatus) return;

    if (referenceLibraryStatusTimer) {
        clearTimeout(referenceLibraryStatusTimer);
        referenceLibraryStatusTimer = null;
    }

    referenceLibraryStatus.textContent = message;
    referenceLibraryStatus.hidden = !message;
    referenceLibraryStatus.classList.toggle("is-error", Boolean(error));
    referenceLibraryStatus.classList.toggle("is-busy", Boolean(busy));
    referenceLibraryStatus.setAttribute("aria-live", error ? "assertive" : "polite");
    referenceLibraryStatus.setAttribute("aria-busy", busy ? "true" : "false");

    if (message && autoHideMs > 0) {
        const shownMessage = message;
        referenceLibraryStatusTimer = setTimeout(() => {
            if (referenceLibraryStatus?.textContent === shownMessage) {
                referenceLibraryStatus.textContent = "";
                referenceLibraryStatus.hidden = true;
                referenceLibraryStatus.classList.remove("is-error", "is-busy");
                referenceLibraryStatus.setAttribute("aria-busy", "false");
            }
            referenceLibraryStatusTimer = null;
        }, autoHideMs);
    }
}

function clearStoredReferenceIndex() {
    try {
        localStorage.removeItem(SELECTED_REFERENCE_STORAGE_KEY);
    } catch (_) {
        // Non-critical preference persistence only.
    }
}

function nextCustomReferenceName() {
    const used = new Set(
        referenceItems
            .filter(item => item.isCustom)
            .map(item => item.name)
    );
    let n = 1;
    while (used.has(`내 이미지 ${String(n).padStart(2, "0")}`)) n += 1;
    return `내 이미지 ${String(n).padStart(2, "0")}`;
}

function customItemFromRecord(record) {
    const imageUrl = URL.createObjectURL(record.imageBlob);
    const thumbnailUrl = record.thumbnailBlob
        ? URL.createObjectURL(record.thumbnailBlob)
        : imageUrl;

    return {
        id: record.id,
        name: record.name,
        image: imageUrl,
        thumbnail: thumbnailUrl,
        isCustom: true,
        createdAt: record.createdAt,
        referenceData: record.referenceData,
        adaptiveTargetData: record.adaptiveTargetData,
        _objectUrls: thumbnailUrl === imageUrl ? [imageUrl] : [imageUrl, thumbnailUrl]
    };
}

function revokeCustomItemUrls(item) {
    for (const url of item?._objectUrls ?? []) {
        try { URL.revokeObjectURL(url); } catch (_) { }
    }
}

async function hydrateCustomReferencesFromStore() {
    try {
        const records = await listCustomReferences();
        for (const record of records) {
            referenceItems.push(customItemFromRecord(record));
        }
        console.log(`[CUSTOM REF v5.2] restored ${records.length} item(s)`);
    } catch (error) {
        console.warn("[CUSTOM REF v5.2] restore skipped", error);
    }
}

function loadImageElementFromBlob(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => resolve({ image, url });
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Image decode failed"));
        };
        image.src = url;
    });
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error("Image encoding failed"));
        }, type, quality);
    });
}

async function resizeImageBlob(sourceBlob, maxDimension, quality = 0.92) {
    const { image, url } = await loadImageElementFromBlob(sourceBlob);
    try {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const outWidth = Math.max(1, Math.round(width * scale));
        const outHeight = Math.max(1, Math.round(height * scale));
        const temp = document.createElement("canvas");
        temp.width = outWidth;
        temp.height = outHeight;
        const tempCtx = temp.getContext("2d");
        tempCtx.drawImage(image, 0, 0, outWidth, outHeight);
        const blob = await canvasToBlob(temp, "image/jpeg", quality);
        return { blob, width: outWidth, height: outHeight };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function getReferenceImportPoseLandmarker() {
    if (referenceImportPoseLandmarker) return referenceImportPoseLandmarker;

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );
    referenceImportPoseLandmarker = await PoseLandmarker.createFromOptions(
        vision,
        {
            baseOptions: { modelAssetPath: "../models/pose_landmarker_full.task" },
            runningMode: "IMAGE",
            numPoses: 2,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5
        }
    );
    return referenceImportPoseLandmarker;
}

async function analyzeCustomReferenceBlob(blob, width, height) {
    const detector = await getReferenceImportPoseLandmarker();
    const { image, url } = await loadImageElementFromBlob(blob);
    try {
        const result = detector.detect(image);
        const validation = validateReferenceCandidate({
            landmarksList: result?.landmarks ?? [],
            worldLandmarksList: result?.worldLandmarks ?? [],
            width,
            height
        });
        return { result, validation };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function importCustomReferenceFile(file) {
    if (customReferenceImportBusy || !file) return;

    if (!String(file.type ?? "").startsWith("image/")) {
        setReferenceLibraryStatus("이미지 파일만 추가할 수 있습니다.", { error: true });
        return;
    }
    if (file.size > CUSTOM_REFERENCE_LIMITS.maxFileBytes) {
        setReferenceLibraryStatus("이미지 파일이 너무 큽니다. 15MB 이하의 사진을 선택해주세요.", { error: true });
        return;
    }

    customReferenceImportBusy = true;
    if (customReferenceAddButton) {
        customReferenceAddButton.disabled = true;
        customReferenceAddButton.setAttribute("aria-busy", "true");
        customReferenceAddButton.textContent = "분석 중...";

    }
    setReferenceLibraryStatus("이미지를 분석하는 중입니다...", { busy: true });

    try {
        const resized = await resizeImageBlob(
            file,
            CUSTOM_REFERENCE_LIMITS.maxAnalysisDimension,
            0.93
        );
        const analyzed = await analyzeCustomReferenceBlob(
            resized.blob,
            resized.width,
            resized.height
        );

        if (!analyzed.validation.valid) {
            console.warn("[CUSTOM REF v5.2] rejected", analyzed.validation);
            setReferenceLibraryStatus(analyzed.validation.message, { error: true });
            return;
        }

        const landmarks = analyzed.result.landmarks[0];
        const worldLandmarks = analyzed.result.worldLandmarks[0];
        const name = nextCustomReferenceName();
        const id = globalThis.crypto?.randomUUID?.() ??
            `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const payload = buildCustomReferencePayload({
            name,
            fileName: file.name || `${name}.jpg`,
            width: resized.width,
            height: resized.height,
            landmarks,
            worldLandmarks
        });
        const thumb = await resizeImageBlob(
            resized.blob,
            CUSTOM_REFERENCE_LIMITS.maxThumbnailDimension,
            0.84
        );
        const record = {
            id,
            name,
            imageBlob: resized.blob,
            thumbnailBlob: thumb.blob,
            referenceData: payload.referenceData,
            adaptiveTargetData: payload.adaptiveTargetData,
            createdAt: new Date().toISOString()
        };

        await saveCustomReference(record);
        referenceItems.push(customItemFromRecord(record));
        createReferenceThumbnails();
        previewReferenceIndex = referenceItems.length - 1;
        updateReferencePreview();
        setReferenceLibraryStatus(
            `${name}을(를) 추가했습니다. 선택하면 바로 사용할 수 있어요.`
        );
        console.log("[CUSTOM REF v5.2] added", { id, name });
    } catch (error) {
        console.error("[CUSTOM REF v5.2] import failed", error);
        setReferenceLibraryStatus(
            "이미지를 추가하지 못했습니다. 다른 사진으로 다시 시도해주세요.",
            { error: true }
        );
    } finally {
        customReferenceImportBusy = false;
        if (customReferenceAddButton) {
            customReferenceAddButton.disabled = false;
            customReferenceAddButton.setAttribute("aria-busy", "false");
            customReferenceAddButton.textContent = "+ 이미지 추가";

        }
        if (customReferenceFileInput) customReferenceFileInput.value = "";
    }
}

async function removeCustomReference(index) {
    const item = referenceItems[index];
    if (!item?.isCustom) return;
    if (!window.confirm("이 이미지를 Reference Library에서 삭제할까요?")) return;

    try {
        await deleteCustomReference(item.id);
    } catch (error) {
        console.error("[CUSTOM REF v5.2] delete failed", error);
        setReferenceLibraryStatus("이미지를 삭제하지 못했습니다. 다시 시도해주세요.", { error: true });
        return;
    }

    const deletedWasSelected = hasSelectedReference && currentReferenceIndex === index;
    revokeCustomItemUrls(item);
    referenceItems.splice(index, 1);

    if (deletedWasSelected) {
        hasSelectedReference = false;
        guidancePausedByUser = false;
        clearStoredReferenceIndex();
        resetLiveGuidanceSession();
        if (canvas.width && canvas.height) ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else if (hasSelectedReference && currentReferenceIndex > index) {
        currentReferenceIndex -= 1;
        storeSelectedReferenceIndex(currentReferenceIndex);
    }

    previewReferenceIndex = Math.max(0, Math.min(index, referenceItems.length - 1));
    createReferenceThumbnails();
    updateReferencePreview();
    updateReferenceLibraryButton();
    syncReferenceDebugControls();
    setReferenceLibraryStatus("사용자 Reference를 삭제했습니다.");
}

function ensureCustomReferenceControls() {
    if (!referenceScreen || !customReferenceAddButton || !customReferenceFileInput) return;

    if (customReferenceFileInput.dataset.customReferenceBound !== "true") {
        customReferenceFileInput.dataset.customReferenceBound = "true";
        customReferenceFileInput.addEventListener("change", () => {
            const file = customReferenceFileInput.files?.[0];
            if (file) void importCustomReferenceFile(file);
        });
    }

    if (customReferenceAddButton.dataset.customReferenceBound !== "true") {
        customReferenceAddButton.dataset.customReferenceBound = "true";
        customReferenceAddButton.addEventListener("click", () => {
            if (!customReferenceImportBusy) customReferenceFileInput.click();
        });
    }

    // Status and add button are now a static HTML row.
    setReferenceLibraryStatus("");
}

function refreshReferenceLibrarySelectionUI() {
    const thumbnails = document.querySelectorAll(".reference-thumbnail");

    thumbnails.forEach((thumbnail, index) => {
        const isPreview = index === previewReferenceIndex;
        const isSelected = hasSelectedReference && index === currentReferenceIndex;

        thumbnail.classList.toggle("active", isPreview);
        thumbnail.dataset.selectedReference = isSelected ? "true" : "false";
        thumbnail.title = isSelected
            ? `${referenceItems[index]?.name ?? "Reference"} · 현재 적용 중`
            : (referenceItems[index]?.name ?? "Reference");
    });

    if (referenceNumber) {
        const reference = referenceItems[previewReferenceIndex];
        const isSelected = hasSelectedReference && previewReferenceIndex === currentReferenceIndex;
        referenceNumber.textContent = isSelected
            ? `${reference.name} · 현재 적용 중`
            : reference.name;
    }
}

function updateReferenceLibraryButton() {
    if (!referenceLibraryButton) return;

    const reference = hasSelectedReference
        ? referenceItems[currentReferenceIndex]
        : null;

    referenceLibraryButton.classList.toggle("has-reference", Boolean(reference));
    if (referenceDockThumbnail) {
        if (reference) {
            referenceDockThumbnail.src = reference.thumbnail ?? reference.image;
            referenceDockThumbnail.alt = `${reference.name} 미리보기`;
            referenceDockThumbnail.hidden = false;
        } else {
            referenceDockThumbnail.removeAttribute("src");
            referenceDockThumbnail.alt = "";
            referenceDockThumbnail.hidden = true;
        }
    }

    referenceLibraryButton.setAttribute(
        "aria-label",
        reference
            ? `Reference 변경. 현재 선택된 이미지는 ${reference.name}`
            : "Reference 이미지 선택"
    );
}

function updateCameraHomeControls() {
    if (!referenceLibraryButton) return;

    const cameraHomeVisible =
        appState === APP_STATES.CAMERA_GUIDANCE ||
        appState === APP_STATES.CAPTURE_COUNTDOWN;

    if (cameraBottomDock) cameraBottomDock.hidden = !cameraHomeVisible;
    if (guideDrawer) guideDrawer.hidden = !cameraHomeVisible;

    document.querySelectorAll("[data-guide-tool]").forEach(button => {
        const unavailable = !hasSelectedReference;
        button.disabled = unavailable;
        button.setAttribute("aria-disabled", unavailable ? "true" : "false");
    });

    referenceLibraryButton.hidden = !cameraHomeVisible;
    updateReferenceLibraryButton();
}

function setGuideDrawerOpen(isOpen) {
    if (!guideDrawer || !guideDrawerHandle) return;
    const nextOpen = Boolean(isOpen);
    guideDrawer.classList.toggle("is-open", nextOpen);
    guideDrawerHandle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    guideDrawerHandle.setAttribute(
        "aria-label",
        nextOpen ? "촬영 보조 도구 닫기" : "촬영 보조 도구 열기"
    );
    if (guideToolbar) {
        guideToolbar.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    }
}
function enterOriginalCameraMode() {
    if (!hasSelectedReference || guidancePausedByUser) return;

    guidancePausedByUser = true;

    cancelAutoCapture("original-camera-mode");
    autoCaptureLocked = false;
    captureTransitionLocked = false;

    if (appState === APP_STATES.CAPTURE_COUNTDOWN) {
        setAppState(APP_STATES.CAMERA_GUIDANCE);
    }

    stopPredictionLoop();
    debugView.face = false;
    debugView.referenceFrame = false;
    debugView.metrics = false;
    syncReferenceDebugControls();
    resetOneCueController();
    resetGuidanceEngine();
    resetOrientationQuality();
    cancelSpeechNow();

    latestGuidance = null;
    latestFrameSnapshot = null;
    latest3DComparison = null;
    latestFaceAnalysis = null;
    latestFaceLandmarks = null;
    autoCaptureLocked = false;
    captureButton.classList.remove("matched");

    if (canvas.width && canvas.height) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    closeDevelopmentPanels();
    updateCameraHomeControls();
    updateDebugRuntimeMonitor();
    console.log("[ORIGINAL CAMERA] Guidance paused; Reference selection preserved");
}

function resumeReferenceGuidance() {
    if (!hasSelectedReference || !guidancePausedByUser) return;

    guidancePausedByUser = false;
    resetLiveGuidanceSession();
    guidanceResumeAt = performance.now() + 250;
    setAppState(APP_STATES.CAMERA_GUIDANCE);
    syncReferenceDebugControls();
    startPredictionLoop();
    updateCameraHomeControls();
    updateDebugRuntimeMonitor();
    console.log("[ORIGINAL CAMERA] Guidance resumed");
}

function toggleGuidanceMode() {
    if (!hasSelectedReference) return;
    if (guidancePausedByUser) {
        resumeReferenceGuidance();
    } else {
        enterOriginalCameraMode();
    }
}

function ensurePublicCameraChrome() {
    if (!cameraContainer || !referenceLibraryButton || !captureButton || !switchCameraButton || !mirrorButton) return;

    mirrorButton.title = "좌우 반전";
    updateReferenceLibraryButton();
}

function ensureCameraFirstControls() {
    // v5.4: controls are static HTML. Bind events once and keep behavior here.
    if (referenceLibraryButton?.dataset.bound !== "true") {
        referenceLibraryButton.dataset.bound = "true";
        referenceLibraryButton.addEventListener("click", () => {
            void openReferenceLibrary();
        });
    }

    if (guideDrawerHandle?.dataset.bound !== "true") {
        guideDrawerHandle.dataset.bound = "true";
        guideDrawerHandle.addEventListener("click", () => {
            const isOpen = guideDrawerHandle.getAttribute("aria-expanded") === "true";
            setGuideDrawerOpen(!isOpen);
        });
    }

    if (cameraContainer?.dataset.drawerCloseBound !== "true") {
        cameraContainer.dataset.drawerCloseBound = "true";
        cameraContainer.addEventListener("pointerdown", (event) => {
            if (guideDrawer?.contains(event.target)) return;
            setGuideDrawerOpen(false);
        });
    }

    if (referenceLibraryCloseButton?.dataset.bound !== "true") {
        referenceLibraryCloseButton.dataset.bound = "true";
        referenceLibraryCloseButton.addEventListener("click", () => {
            void closeReferenceLibrary();
        });
    }

    ensureCustomReferenceControls();

    if (voiceToggleButton?.dataset.bound !== "true") {
        voiceToggleButton.dataset.bound = "true";
        voiceToggleButton.addEventListener("click", () => {
            voiceUiEnabled = !voiceUiEnabled;
            voiceToggleButton.setAttribute("aria-pressed", voiceUiEnabled ? "true" : "false");
            if (!voiceUiEnabled) cancelSpeechNow();
        });
    }

    if (settingsButton?.dataset.bound !== "true") {
        settingsButton.dataset.bound = "true";
        settingsButton.addEventListener("click", () => {
            if (settingsScreen) settingsScreen.hidden = false;
        });
    }

    if (settingsCloseButton?.dataset.bound !== "true") {
        settingsCloseButton.dataset.bound = "true";
        settingsCloseButton.addEventListener("click", () => {
            if (settingsScreen) settingsScreen.hidden = true;
        });
    }

    document.querySelectorAll("[data-guide-tool], [data-setting-toggle]").forEach(button => {
        if (button.dataset.bound === "true") return;
        button.dataset.bound = "true";
        button.addEventListener("click", () => {
            const nextPressed = button.getAttribute("aria-pressed") !== "true";
            button.setAttribute("aria-pressed", nextPressed ? "true" : "false");
            button.classList.toggle("is-active", nextPressed);
        });
    });

    const retakeTopButton = document.getElementById("retakeTopButton");
    if (retakeTopButton?.dataset.bound !== "true") {
        retakeTopButton.dataset.bound = "true";
        retakeTopButton.addEventListener("click", () => retakeButton?.click());
    }

    ensurePublicCameraChrome();
    updateReferenceLibraryButton();
    updateCameraHomeControls();
}

function resetLiveGuidanceSession() {
    // A screen/state transition must be a hard boundary for voice guidance.
    // This prevents an already queued browser utterance from leaking into
    // Reference Library / Review / plain-camera states.
    cancelSpeechNow();
    resetOneCueController();
    resetGuidanceEngine();
    resetOrientationQuality();

    cancelAutoCapture("reset-live-session");

    autoCaptureLocked = false;
    captureTransitionLocked = false;
    latest3DComparison = null;
    latestGuidance = null;
    latestFrameSnapshot = null;
    latestFaceAnalysis = null;
    latestFaceLandmarks = null;
    lastGoodFaceAt = -Infinity;
    smoothedPoints = {};
    lastVideoTime = -1;
}

async function openReferenceLibrary() {
    closeDevelopmentPanels();

    if (
        appState === APP_STATES.REVIEW ||
        appState === APP_STATES.REFERENCE_LIBRARY
    ) {
        return;
    }

    setAppState(APP_STATES.REFERENCE_LIBRARY);
    setCameraStatus("");
    setReferenceLibraryStatus("");

    // Library can stay open for a while, so release the camera instead of
    // wasting battery/heat in the background.
    stopCameraStream();
    resetLiveGuidanceSession();

    previewReferenceIndex =
        hasSelectedReference ? currentReferenceIndex : 0;
    updateReferencePreview();
    refreshReferenceLibrarySelectionUI();
    referenceScreen.hidden = false;

    console.log("[CAMERA-FIRST v5.1] Reference Library opened");
}

async function closeReferenceLibrary() {
    closeDevelopmentPanels();
    referenceScreen.hidden = true;
    setReferenceLibraryStatus("");
    resetLiveGuidanceSession();
    await startCamera();

    console.log("[CAMERA-FIRST v5.1] Returned to camera");
}

async function resumeCameraAfterReview() {
    closeDevelopmentPanels();
    closeCapturePreview();
    resetLiveGuidanceSession();
    captureTransitionLocked = false;
    reviewActionLocked = false;
    setCameraStatus("");

    // The normal fast path keeps the MediaStream attached during Review.
    // Mobile browsers can still suspend/end that stream while the page is
    // backgrounded, the screen locks, or the camera device changes. In that
    // case, reconnect instead of leaving the user on a frozen camera frame.
    const hasLiveVideoTrack = Boolean(
        currentStream &&
        currentStream.getVideoTracks().some(track => track.readyState === "live")
    );

    if (!hasLiveVideoTrack || video.srcObject !== currentStream) {
        await startCamera();
        updateReferenceLibraryButton();
        return;
    }

    setAppState(APP_STATES.CAMERA_GUIDANCE);

    try {
        await video.play();
    } catch (error) {
        console.warn("[CAMERA] Review resume play failed; reconnecting", error);
        await startCamera();
        updateReferenceLibraryButton();
        return;
    }

    guidanceResumeAt = performance.now();
    startPredictionLoop();
    updateReferenceLibraryButton();
}

const referenceItems = [
    {
        id: "default-01",
        isCustom: false,
        name: "Reference 01",
        image: "../reference_01.jpg",
        json: "reference_01.json",
        adaptiveTarget: "retargeted_reference_01_user.json"
    },
    {
        id: "default-02",
        isCustom: false,
        name: "Reference 02",
        image: "../reference_02.jpg",
        json: "reference_02.json",
        adaptiveTarget: "retargeted_reference_02_user.json"
    },
    {
        id: "default-03",
        isCustom: false,
        name: "Reference 03",
        image: "../reference_03.jpg",
        json: "reference_03.json",
        adaptiveTarget: "retargeted_reference_03_user.json"
    },
    {
        id: "default-04",
        isCustom: false,
        name: "Reference 04",
        image: "../reference_04.jpg",
        json: "reference_04.json",
        adaptiveTarget: "retargeted_reference_04_user.json"
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

function clonePlain(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        } catch (_) {
            // Fall back to JSON cloning below.
        }
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return null;
    }
}


function nextFaceTimestamp() {
    const now = Math.floor(performance.now());
    faceTimestamp = Math.max(faceTimestamp + 1, now);
    return faceTimestamp;
}

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}

async function analyzeReferenceFace(imageSrc) {
    currentReferenceFaceAnalysis = null;
    setReferenceFaceAnalysis(null);

    if (!faceLandmarker) {
        console.log("[FACE v4.6] FaceLandmarker unavailable; using pose fallback");
        return null;
    }

    try {
        const image = await loadImageElement(imageSrc);
        const result = faceLandmarker.detectForVideo(
            image,
            nextFaceTimestamp()
        );
        const analysis = analyzeFaceLandmarkerResult(result);
        currentReferenceFaceAnalysis = analysis;
        setReferenceFaceAnalysis(analysis);
        console.log("[FACE v4.6] reference", {
            detected: analysis.detected,
            headReliable: analysis.headReliable,
            eyesReliable: analysis.eyesReliable
        });
        return analysis;
    } catch (error) {
        console.warn("[FACE v4.6] Reference face analysis failed; using pose fallback", error);
        currentReferenceFaceAnalysis = null;
        setReferenceFaceAnalysis(null);
        return null;
    }
}

function resetCaptureReviewPosition(panel) {
    if (!panel) return;

    Object.assign(panel.style, {
        left: "50%",
        top: "auto",
        right: "auto",
        bottom: "86px",
        transform: "translateX(-50%)"
    });

    panel.dataset.reviewMoved = "false";
}

function clampReviewPanelPosition(panel, left, top) {
    const margin = 10;
    const maxLeft = Math.max(
        margin,
        window.innerWidth - panel.offsetWidth - margin
    );
    const maxTop = Math.max(
        margin,
        window.innerHeight - panel.offsetHeight - margin
    );

    return {
        left: Math.min(Math.max(left, margin), maxLeft),
        top: Math.min(Math.max(top, margin), maxTop)
    };
}

function enableCaptureReviewDragging(panel) {
    if (!panel || panel.dataset.dragReady === "true") return;

    panel.dataset.dragReady = "true";

    let dragState = null;

    panel.addEventListener("pointerdown", event => {
        if (event.target.closest("[data-review-collapse]")) return;

        const handle = event.target.closest("[data-review-drag-handle]");
        if (!handle) return;

        const rect = panel.getBoundingClientRect();

        // Convert the centered/default placement to explicit viewport coordinates
        // before dragging starts.
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.transform = "none";

        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };

        panel.dataset.reviewMoved = "true";
        handle.style.cursor = "grabbing";
        handle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });

    panel.addEventListener("pointermove", event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;

        const target = clampReviewPanelPosition(
            panel,
            event.clientX - dragState.offsetX,
            event.clientY - dragState.offsetY
        );

        panel.style.left = `${target.left}px`;
        panel.style.top = `${target.top}px`;
        event.preventDefault();
    });

    const finishDrag = event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;

        const handle = panel.querySelector("[data-review-drag-handle]");
        if (handle) handle.style.cursor = "grab";

        try {
            handle?.releasePointerCapture?.(event.pointerId);
        } catch (_) {
            // Pointer capture can already be released by the browser.
        }

        dragState = null;
    };

    panel.addEventListener("pointerup", finishDrag);
    panel.addEventListener("pointercancel", finishDrag);

    window.addEventListener("resize", () => {
        if (panel.style.display === "none") return;
        if (panel.dataset.reviewMoved !== "true") return;

        const rect = panel.getBoundingClientRect();
        const target = clampReviewPanelPosition(panel, rect.left, rect.top);
        panel.style.left = `${target.left}px`;
        panel.style.top = `${target.top}px`;
    });
}

function ensureCaptureReviewUI() {
    let panel = document.getElementById("captureReviewPanel");

    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "captureReviewPanel";
    panel.setAttribute("aria-live", "polite");
    capturePreviewScreen.appendChild(panel);
    return panel;
}

function reviewStatusText(value) {
    return value ?? "-";
}

function reviewStatusOpacity(level) {
    if (level === "good") return "1";
    if (level === "fair") return ".86";
    if (level === "bad") return ".95";
    return ".65";
}

function renderCaptureReview(review) {
    const panel = ensureCaptureReviewUI();

    if (!review) {
        panel.style.display = "none";
        panel.innerHTML = "";
        return;
    }

    const recommendation = review.recommendRetake
        ? "다시 촬영을 권장해요"
        : "현재 사진을 저장해도 좋아요";
    const issueText = review.primaryIssue?.text ?? review.summary ?? "Reference와 비교를 완료했어요.";
    const showFaceOrientation = Boolean(
        review.faceOrientationStatus &&
        review.faceOrientationStatus !== "분석 불가"
    );
    const scopeNote = isDebugMode && review.scopeNote
        ? `<div class="review-scope-note">${review.scopeNote}</div>`
        : "";

    const metric = (label, value) => `
        <div class="review-metric">
            <small>${label}</small>
            <strong>${reviewStatusText(value)}</strong>
        </div>`;

    panel.innerHTML = `
        <div class="review-summary-header">
            <div>
                <div class="review-kicker">촬영 결과 · ${review.reference?.name ?? "Reference"}</div>
                <div class="review-title">${review.verdict?.title ?? "촬영 분석 완료"}</div>
            </div>
            <button type="button" class="review-collapse" data-review-collapse>접기</button>
        </div>
        <div data-review-body>
            <div class="review-metrics${showFaceOrientation ? " has-face" : ""}">
                ${metric("인물 구도", review.compositionStatus)}
                ${metric("포즈", review.poseStatus)}
                ${showFaceOrientation ? metric("얼굴 방향", review.faceOrientationStatus) : ""}
            </div>
            <div class="review-issue">
                <small>가장 큰 차이</small>
                <p>${issueText}</p>
            </div>
            <div class="review-recommendation">${recommendation}</div>
            ${scopeNote}
        </div>`;

    const collapseButton = panel.querySelector("[data-review-collapse]");
    const body = panel.querySelector("[data-review-body]");

    collapseButton?.addEventListener("click", () => {
        const collapsed = panel.dataset.reviewCollapsed === "true";
        panel.dataset.reviewCollapsed = collapsed ? "false" : "true";
        if (body) body.hidden = !collapsed;
        collapseButton.textContent = collapsed ? "접기" : "펼치기";
    });

    panel.dataset.reviewCollapsed = "false";
    panel.style.display = "block";
}

function clearCaptureReview() {
    const panel = document.getElementById("captureReviewPanel");
    if (panel) {
        panel.style.display = "none";
        panel.innerHTML = "";
    }
}

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

    // FaceLandmarker is optional. If the model cannot be downloaded or the
    // device is too slow, the rest of PhotoGuide keeps working with pose-only
    // head fallback and simply skips blink/gaze-specific decisions.
    try {
        let faceModelPath =
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

        try {
            const localFaceModel = await fetch(
                "../models/face_landmarker.task",
                { method: "HEAD", cache: "no-store" }
            );
            if (localFaceModel.ok) {
                faceModelPath = "../models/face_landmarker.task";
            }
        } catch (_) {
            // Remote fallback below.
        }

        faceLandmarker = await FaceLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath: faceModelPath
                },
                runningMode: "VIDEO",
                numFaces: 1,
                minFaceDetectionConfidence: 0.45,
                minFacePresenceConfidence: 0.45,
                minTrackingConfidence: 0.45,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true
            }
        );
        console.log("FaceLandmarker loaded");
    } catch (error) {
        faceLandmarker = null;
        console.warn("FaceLandmarker unavailable; continuing with pose fallback", error);
    }
}

async function loadReference(fileName) {
    const response = await fetch(`../${fileName}`);

    if (!response.ok) {
        throw new Error(`Reference JSON load failed: ${response.status}`);
    }

    referenceData = await response.json();

    console.log(`Reference loaded: ${fileName}`);
}

async function loadReferenceByIndex(index, { persist = true } = {}) {

    if (
        index < 0 ||
        index >= referenceItems.length
    ) {
        throw new Error("Reference index out of range");
    }

    const reference = referenceItems[index];

    // Load all required assets first. The selection is committed only after
    // the Reference and adaptive target are available.
    if (reference.isCustom) {
        referenceData = clonePlain(reference.referenceData);
        setAdaptiveTargetData(clonePlain(reference.adaptiveTargetData));
    } else {
        await loadReference(reference.json);
        await loadAdaptiveTarget(`../${reference.adaptiveTarget}`);
    }

    currentReferenceIndex = index;

    await analyzeReferenceFace(reference.image);

    if (persist) {
        hasSelectedReference = true;
        guidancePausedByUser = false;
        storeSelectedReferenceIndex(index);

        // Debug views are available after selection but always begin OFF.
        debugView.face = false;
        debugView.referenceFrame = false;
        debugView.metrics = false;
        syncReferenceDebugControls();
    }

    // Clear previous guidance/cue/auto-shoot state when changing references.
    resetOneCueController();
    resetGuidanceEngine();
    resetOrientationQuality();

    cancelAutoCapture("reference-change");
    autoCaptureLocked = false;
    captureTransitionLocked = false;

    const audit = currentReferenceAudit();
    if (audit) {
        console.log(
            "[REFERENCE AUDIT SUMMARY v4.9]",
            {
                reference: audit.referenceName,
                leftKnee: audit.joints.leftKnee,
                rightKnee: audit.joints.rightKnee,
                bodyLean: audit.torso.bodyLean,
                faceReliable: audit.face.headReliable
            }
        );
    }

    updateReferenceLibraryButton();
    refreshReferenceLibrarySelectionUI();

    console.log(
        `Reference + Adaptive Target loaded: ${reference.name}`
    );
}

function createReferenceThumbnails() {
    referenceThumbnails.innerHTML = "";

    referenceItems.forEach((reference, index) => {
        const wrap = document.createElement("div");
        wrap.className = "reference-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "reference-thumbnail";
        button.setAttribute("aria-label", `${reference.name} 미리보기`);

        const image = document.createElement("img");
        image.src = reference.thumbnail ?? reference.image;
        image.alt = reference.name;
        button.appendChild(image);

        button.addEventListener("click", () => {
            if (index === previewReferenceIndex) return;
            const direction = index > previewReferenceIndex ? "next" : "prev";
            showReference(index, direction);
        });

        wrap.appendChild(button);

        if (reference.isCustom) {
            const badge = document.createElement("span");
            badge.className = "reference-source-badge";
            badge.textContent = "내 이미지";
            wrap.appendChild(badge);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "reference-remove-button";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `${reference.name} 삭제`);
            remove.title = "사용자 Reference 삭제";
            remove.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                void removeCustomReference(index);
            });
            wrap.appendChild(remove);
        }

        referenceThumbnails.appendChild(wrap);
    });
}

function updateReferencePreview() {

    const reference =
        referenceItems[previewReferenceIndex];

    referencePreview.src =
        reference.image;

    refreshReferenceLibrarySelectionUI();

    const thumbnails =
        document.querySelectorAll(
            ".reference-thumbnail"
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
        closeDevelopmentPanels();
        setReferenceLibraryStatus("");

        const originalText = selectReferenceButton.textContent;
        selectReferenceButton.disabled = true;
        selectReferenceButton.textContent = "불러오는 중...";
        selectReferenceButton.style.opacity = ".65";

        try {
            await loadReferenceByIndex(
                previewReferenceIndex
            );

            referenceScreen.hidden = true;
            resetLiveGuidanceSession();
            await startCamera();

            console.log(
                `[CAMERA-FIRST v4.9] Selected ${referenceItems[currentReferenceIndex].name} and returned to camera`
            );
        } catch (error) {
            console.error("Reference selection failed:", error);
            setReferenceLibraryStatus(
                "이미지를 불러오지 못했어요. 파일을 확인한 뒤 다시 선택해주세요.",
                { error: true }
            );
        } finally {
            selectReferenceButton.disabled = false;
            selectReferenceButton.textContent = originalText || "선택";
            selectReferenceButton.style.opacity = "";
        }
    }
);

console.log("SELECT LISTENER REGISTERED");


function computeReferenceFrame() {
    if (!referenceData?.image || !canvas.width || !canvas.height) {
        return null;
    }

    const referenceWidth = Number(referenceData.image.width);
    const referenceHeight = Number(referenceData.image.height);

    if (!(referenceWidth > 0) || !(referenceHeight > 0)) {
        return null;
    }

    // Keep the Reference's original aspect ratio inside the live camera.
    // This creates a "virtual Reference frame" instead of pretending a
    // portrait Reference and a landscape camera are the same canvas.
    const scale = Math.min(
        canvas.width / referenceWidth,
        canvas.height / referenceHeight
    );

    const width = referenceWidth * scale;
    const height = referenceHeight * scale;
    const left = (canvas.width - width) / 2;
    const top = (canvas.height - height) / 2;

    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        scale,
        referenceAspect: referenceWidth / referenceHeight,
        liveAspect: canvas.width / canvas.height,
        aspectMismatch:
            Math.abs(
                (canvas.width / canvas.height) -
                (referenceWidth / referenceHeight)
            ) > 0.08
    };
}

function normalizedInReferenceFrame(x, y) {
    if (!referenceFrame) return null;

    return {
        x: (x - referenceFrame.left) / referenceFrame.width,
        y: (y - referenceFrame.top) / referenceFrame.height
    };
}

function syncReferenceDebugControls() {
    const definitions = {
        face: "FACE",
        referenceFrame: "FRAME",
        metrics: "INFO"
    };

    const referenceReady = Boolean(
        hasSelectedReference &&
        !guidancePausedByUser
    );

    // Before Reference selection or while Original Camera is active,
    // all camera-relative debug overlays are forced OFF.
    if (!referenceReady) {
        debugView.face = false;
        debugView.referenceFrame = false;
        debugView.metrics = false;
    }

    Object.entries(definitions).forEach(([key, label]) => {
        const button = document.querySelector(
            `#photoGuideDebugControls button[data-debug-key="${key}"]`
        );
        if (!button) return;

        button.disabled = !referenceReady;
        button.textContent = `${label} ${debugView[key] ? "ON" : "OFF"}`;
        button.style.opacity = referenceReady
            ? (debugView[key] ? "1" : ".55")
            : ".28";
        button.style.cursor = referenceReady ? "pointer" : "not-allowed";
        button.style.filter = referenceReady ? "none" : "grayscale(1)";
        button.setAttribute(
            "aria-disabled",
            String(!referenceReady)
        );
    });
}

function ensureDebugControls() {
    if (!isDebugMode) {
        document.getElementById("photoGuideDebugControls")?.remove();
        document.getElementById("referenceAuditPanel")?.remove();
        document.getElementById("guidanceValidationPanel")?.remove();
        return null;
    }

    let root = document.getElementById("photoGuideDebugControls");
    if (root) return root;

    root = document.createElement("div");
    root.id = "photoGuideDebugControls";

    Object.assign(root.style, {
        position: "fixed",
        top: "42px",
        right: "10px",
        zIndex: "10020",
        display: isDebugMode ? "flex" : "none",
        gap: "5px",
        padding: "5px",
        borderRadius: "10px",
        background: "rgba(0,0,0,.48)",
        backdropFilter: "blur(8px)",
        fontFamily: "system-ui, sans-serif"
    });

    const addButton = (label, key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.debugKey = key;
        button.style.cssText =
            "border:0;border-radius:7px;padding:5px 7px;font-size:10px;color:#fff;background:rgba(255,255,255,.12);cursor:pointer;";

        const refresh = () => {
            const referenceReady = Boolean(hasSelectedReference);
            button.disabled = !referenceReady;
            button.textContent = `${label} ${debugView[key] ? "ON" : "OFF"}`;
            button.style.opacity = referenceReady
                ? (debugView[key] ? "1" : ".55")
                : ".28";
            button.style.cursor = referenceReady ? "pointer" : "not-allowed";
            button.style.filter = referenceReady ? "none" : "grayscale(1)";
            button.setAttribute("aria-disabled", String(!referenceReady));
        };

        button.addEventListener("click", () => {
            if (!hasSelectedReference) {
                debugView[key] = false;
                refresh();
                return;
            }

            debugView[key] = !debugView[key];
            refresh();
        });

        refresh();
        root.appendChild(button);
    };

    addButton("FACE", "face");
    addButton("FRAME", "referenceFrame");
    addButton("INFO", "metrics");

    const addActionButton = (label, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.cssText =
            "border:0;border-radius:7px;padding:5px 7px;font-size:10px;font-weight:800;color:#fff;background:rgba(70,145,255,.32);cursor:pointer;";
        button.addEventListener("click", handler);
        root.appendChild(button);
    };

    addActionButton("AUDIT", openReferenceAudit);
    addActionButton("TEST", openGuidanceValidation);

    document.body.appendChild(root);
    syncReferenceDebugControls();
    return root;
}

function getRuntimeDebugSnapshot() {
    const streamLive = Boolean(
        currentStream &&
        currentStream.getVideoTracks().some(track => track.readyState === "live")
    );
    const synth =
        typeof window !== "undefined" && "speechSynthesis" in window
            ? window.speechSynthesis
            : null;

    return {
        state: appState,
        reference: hasSelectedReference
            ? String(currentReferenceIndex + 1).padStart(2, "0")
            : "-",
        guide: hasSelectedReference
            ? (guidancePausedByUser ? "OFF · ORIGINAL" : "ON")
            : "OFF · NO REF",
        camera: streamLive ? "ON" : (cameraStarting ? "STARTING" : "OFF"),
        pose: canRunInference() ? "ON" : "OFF",
        voice: voiceGuidanceEnabled() ? "ON" : "OFF",
        speech: synth
            ? (synth.speaking ? "SPEAKING" : (synth.pending ? "QUEUED" : "IDLE"))
            : "UNAVAILABLE",
        mirror: mirrorEnabled ? "ON" : "OFF",
        autoShoot: autoCaptureTimer ? "ARMED" : "IDLE",
        captureLock: captureTransitionLocked ? "LOCKED" : "FREE",
        reviewLock: reviewActionLocked ? "LOCKED" : "FREE"
    };
}

function updateDebugRuntimeMonitor() {
    if (!isDebugMode || !debugRuntimeMonitor) return;

    const s = getRuntimeDebugSnapshot();
    debugRuntimeMonitor.innerHTML = `
        <div style="font-size:10px;font-weight:850;opacity:.82;margin-bottom:5px;">RUNTIME · v5.1</div>
        <div>STATE&nbsp;&nbsp;&nbsp;${s.state}</div>
        <div>REF&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${s.reference}</div>
        <div>GUIDE&nbsp;&nbsp;&nbsp;${s.guide}</div>
        <div>CAMERA&nbsp;&nbsp;${s.camera}</div>
        <div>POSE&nbsp;&nbsp;&nbsp;&nbsp;${s.pose}</div>
        <div>VOICE&nbsp;&nbsp;&nbsp;${s.voice}</div>
        <div>SPEECH&nbsp;&nbsp;${s.speech}</div>
        <div>MIRROR&nbsp;&nbsp;${s.mirror}</div>
        <div>AUTO&nbsp;&nbsp;&nbsp;&nbsp;${s.autoShoot}</div>
        <div style="opacity:.66;margin-top:3px;">CAP ${s.captureLock} · REVIEW ${s.reviewLock}</div>
    `;
}

function ensureDebugRuntimeMonitor() {
    if (!isDebugMode) {
        document.getElementById("photoGuideRuntimeMonitor")?.remove();
        if (debugRuntimeMonitorTimer) {
            clearInterval(debugRuntimeMonitorTimer);
            debugRuntimeMonitorTimer = null;
        }
        debugRuntimeMonitor = null;
        return null;
    }

    debugRuntimeMonitor = document.getElementById("photoGuideRuntimeMonitor");
    if (!debugRuntimeMonitor) {
        debugRuntimeMonitor = document.createElement("div");
        debugRuntimeMonitor.id = "photoGuideRuntimeMonitor";
        debugRuntimeMonitor.style.cssText = [
            "position:fixed",
            "top:78px",
            "right:10px",
            "z-index:10019",
            "min-width:178px",
            "padding:8px 10px",
            "border:1px solid rgba(255,255,255,.16)",
            "border-radius:10px",
            "background:rgba(0,0,0,.58)",
            "backdrop-filter:blur(8px)",
            "color:#fff",
            "font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
            "pointer-events:none",
            "transform:none"
        ].join(";");
        document.body.appendChild(debugRuntimeMonitor);
    }

    updateDebugRuntimeMonitor();

    if (!debugRuntimeMonitorTimer) {
        debugRuntimeMonitorTimer = setInterval(updateDebugRuntimeMonitor, 250);
    }

    return debugRuntimeMonitor;
}

function displayCanvasX(x) {
    const value = Number(x);
    if (!Number.isFinite(value)) return value;
    return mirrorEnabled ? canvas.width - value : value;
}

function mirroredRectX(left, right) {
    if (!mirrorEnabled) {
        return { left, right };
    }

    return {
        left: canvas.width - right,
        right: canvas.width - left
    };
}

function normalizeNonSceneUI() {
    // Defensive cleanup for legacy mirror implementations.
    // UI must never inherit/retain camera mirroring.
    document.documentElement.classList.remove("mirror");
    document.body?.classList.remove("mirror");
    cameraContainer.classList.remove("mirror");
    cameraContainer.style.transform = "";

    [
        mirrorButton,
        captureButton,
        referenceLibraryButton,
        guideDrawer,
        document.getElementById("switchCameraButton"),
        document.getElementById("photoGuideDebugControls"),
        document.getElementById("referenceAuditPanel"),
        document.getElementById("guidanceValidationPanel"),
        document.getElementById("photoGuideRuntimeMonitor")
    ]
        .filter(Boolean)
        .forEach(element => {
            element.style.transform = "none";
        });
}

function closeDevelopmentPanels({ except = null } = {}) {
    const panels = {
        audit: document.getElementById("referenceAuditPanel"),
        test: document.getElementById("guidanceValidationPanel")
    };

    for (const [key, panel] of Object.entries(panels)) {
        if (!panel || key === except) continue;
        panel.style.display = "none";
    }
}

function drawReferenceFrameDebug() {
    if (!debugView.referenceFrame || !referenceFrame) return;

    const rect = mirroredRectX(
        referenceFrame.left,
        referenceFrame.right
    );

    ctx.save();
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = "rgba(255,255,255,.62)";
    ctx.lineWidth = 1.3;
    ctx.strokeRect(
        rect.left,
        referenceFrame.top,
        rect.right - rect.left,
        referenceFrame.height
    );
    ctx.setLineDash([]);

    // Text itself is never mirrored; only its camera-relative position is.
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.fillText(
        "Reference frame",
        rect.left + 8,
        referenceFrame.top + 18
    );
    ctx.restore();
}

function drawFaceDebug(faceAnalysis = null) {
    if (!debugView.face || !latestFaceLandmarks?.length) return;

    ctx.save();
    ctx.fillStyle = "rgba(0,255,255,.62)";

    // Camera-relative face points follow the mirrored video.
    for (let i = 0; i < latestFaceLandmarks.length; i += 2) {
        const p = latestFaceLandmarks[i];
        if (!p) continue;
        const rawX = Number(p.x) * canvas.width;
        const x = displayCanvasX(rawX);
        const y = Number(p.y) * canvas.height;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ctx.beginPath();
        ctx.arc(x, y, 1.05, 0, Math.PI * 2);
        ctx.fill();
    }

    const keyIndices = [1, 10, 33, 152, 234, 263, 454];
    ctx.fillStyle = "rgba(255,235,60,.96)";
    for (const index of keyIndices) {
        const p = latestFaceLandmarks[index];
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(
            displayCanvasX(Number(p.x) * canvas.width),
            Number(p.y) * canvas.height,
            2.5,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    // Metrics are UI text: keep them readable and never mirror the glyphs.
    if (debugView.metrics && faceAnalysis) {
        const a = faceAnalysis;
        const lines = [
            `face ${a.detected ? "detected" : "none"}`,
            `head ${a.headReliable ? "reliable" : "fallback"}`,
            `yawProxy ${Number(a.head?.yawProxy ?? 0).toFixed(3)}`,
            `roll ${Number(a.head?.rollDeg ?? 0).toFixed(1)}°`,
            `blink ${Number(a.eyes?.blinkMax ?? 0).toFixed(2)}`
        ];

        ctx.font = "12px ui-monospace, monospace";
        const x = 12;
        let y = 78;
        for (const line of lines) {
            ctx.fillStyle = "rgba(0,0,0,.58)";
            ctx.fillRect(x - 4, y - 12, 160, 17);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(line, x, y);
            y += 18;
        }
    }

    ctx.restore();
}


function distancePx(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function referencePointPx(index) {
    const lm =
        referenceData?.landmarks?.[String(index)] ??
        referenceData?.landmarks?.[index];

    if (!lm || !referenceData?.image) return null;

    return {
        x: Number(lm.x) * Number(referenceData.image.width),
        y: Number(lm.y) * Number(referenceData.image.height)
    };
}

function currentReferenceAudit() {
    if (!referenceData) {
        return null;
    }

    const reference =
        referenceItems[currentReferenceIndex] ?? {};

    return buildReferenceAudit({
        referenceData,
        referenceName:
            reference.name ??
            `Reference ${String(currentReferenceIndex + 1).padStart(2, "0")}`,
        referenceFaceAnalysis: currentReferenceFaceAnalysis
    });
}

function openReferenceAudit() {
    closeDevelopmentPanels({ except: "audit" });

    const audit = currentReferenceAudit();

    if (!audit) {
        console.warn(
            "[REFERENCE AUDIT v4.6] Reference가 아직 로드되지 않았습니다."
        );
        return null;
    }

    console.groupCollapsed(
        `[REFERENCE AUDIT v4.6] ${audit.referenceName}`
    );
    console.table({
        leftElbow: audit.joints.leftElbow,
        rightElbow: audit.joints.rightElbow,
        leftKnee: audit.joints.leftKnee,
        rightKnee: audit.joints.rightKnee,
        bodyLean: audit.torso.bodyLean,
        shoulderTilt: audit.torso.shoulderTilt
    });
    console.log(audit);
    console.groupEnd();

    const panel = showReferenceAuditPanel(audit);
    normalizeNonSceneUI();
    return panel;
}

function openGuidanceValidation() {
    closeDevelopmentPanels({ except: "test" });

    const report = runFullValidation();

    console.groupCollapsed(
        `[FULL VALIDATION v5.1] ${report.passed}/${report.total}`
    );
    console.table(
        report.tests.map(test => ({
            id: test.id,
            result: test.pass ? "PASS" : "FAIL",
            expected: test.expectedKey,
            actual: test.actualKey,
            actor: test.actualActor
        }))
    );
    console.groupEnd();

    const panel = showFullValidationPanel(report);
    normalizeNonSceneUI();
    return panel;
}

function drawTargetSkeleton() {
    if (!referenceData) {
        return;
    }

    const referenceWidth = referenceData.image.width;
    const referenceHeight = referenceData.image.height;

    referenceFrame = computeReferenceFrame();
    if (!referenceFrame) {
        return;
    }

    const fitScale = referenceFrame.scale;
    const offsetX = referenceFrame.left;
    const offsetY = referenceFrame.top;

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
            displayCanvasX(targetPoints[start].x),
            targetPoints[start].y
        );

        ctx.lineTo(
            displayCanvasX(targetPoints[end].x),
            targetPoints[end].y
        );

        ctx.stroke();
    }

    // Development-only anatomical labels. MediaPipe LEFT/RIGHT are the
    // subject's own sides, not the viewer's screen sides.
    if (isDebugMode && debugView.referenceFrame) {
        ctx.save();
        ctx.font = "bold 12px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,235,60,.95)";
        if (targetPoints[27]) {
            ctx.fillText(
                "L(27)",
                displayCanvasX(targetPoints[27].x) + 6,
                targetPoints[27].y - 8
            );
        }
        if (targetPoints[28]) {
            ctx.fillText(
                "R(28)",
                displayCanvasX(targetPoints[28].x) + 6,
                targetPoints[28].y - 8
            );
        }
        ctx.restore();
    }
}

function drawCompositionGuide(
    leftColor,
    rightColor,
    topColor,
    bottomColor
) {
    const cornerLength = 25;

    let left = targetComposition.left;
    let right = targetComposition.right;
    const top = targetComposition.top;
    const bottom = targetComposition.bottom;

    let displayLeftColor = leftColor;
    let displayRightColor = rightColor;

    if (mirrorEnabled) {
        const mirrored = mirroredRectX(left, right);
        left = mirrored.left;
        right = mirrored.right;

        // The raw right edge is displayed on the left after mirroring.
        displayLeftColor = rightColor;
        displayRightColor = leftColor;
    }

    ctx.lineWidth = 2;

    ctx.strokeStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + cornerLength, top);
    ctx.stroke();

    ctx.strokeStyle = displayLeftColor;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + cornerLength);
    ctx.stroke();

    ctx.strokeStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(right, top);
    ctx.lineTo(right - cornerLength, top);
    ctx.stroke();

    ctx.strokeStyle = displayRightColor;
    ctx.beginPath();
    ctx.moveTo(right, top);
    ctx.lineTo(right, top + cornerLength);
    ctx.stroke();

    ctx.strokeStyle = bottomColor;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left + cornerLength, bottom);
    ctx.stroke();

    ctx.strokeStyle = displayLeftColor;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, bottom - cornerLength);
    ctx.stroke();

    ctx.strokeStyle = bottomColor;
    ctx.beginPath();
    ctx.moveTo(right, bottom);
    ctx.lineTo(right - cornerLength, bottom);
    ctx.stroke();

    ctx.strokeStyle = displayRightColor;
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
    // This callback represents one scheduled frame. Clear the handle first.
    predictionFrameId = null;

    if (!canRunInference()) {
        return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
        queueNextPrediction();
        return;
    }

    if (
        !poseLandmarker ||
        typeof poseLandmarker.detectForVideo !== "function"
    ) {
        queueNextPrediction();
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

        const frameNow = performance.now();

        const results = poseLandmarker.detectForVideo(
            video,
            frameNow
        );

        // Face analysis is intentionally throttled (~7 fps) to protect the
        // latency of the existing pose guidance loop.
        if (faceLandmarker && frameNow - lastFaceDetectAt >= 140) {
            lastFaceDetectAt = frameNow;
            try {
                const faceResult = faceLandmarker.detectForVideo(
                    video,
                    nextFaceTimestamp()
                );
                const faceAnalysis = analyzeFaceLandmarkerResult(faceResult);
                const detectedFaceLandmarks = faceResult?.faceLandmarks?.[0] ?? null;

                if (faceAnalysis.detected) {
                    latestFaceAnalysis = faceAnalysis;
                    latestFaceLandmarks = detectedFaceLandmarks;
                    lastGoodFaceAt = frameNow;
                } else if (frameNow - lastGoodFaceAt > 500) {
                    latestFaceAnalysis = faceAnalysis;
                    latestFaceLandmarks = null;
                }
            } catch (error) {
                console.warn("[FACE v4.6] live analysis failed", error);
            }
        }

        // ========================================
        // Body-centric Live 3D Comparator v2
        // ========================================

        latest3DComparison = null;

        if (
            results.worldLandmarks &&
            results.worldLandmarks.length > 0
        ) {
            const comparison = compareLivePose3D(
                results.worldLandmarks[0],
                results.landmarks?.[0] ?? null
            );

            latest3DComparison = comparison;

            const now = performance.now();

            if (
                comparison.ready &&
                now - lastComparatorLogTime >= 1000
            ) {
                lastComparatorLogTime = now;

                console.log(
                    "[3D Comparator v2]",
                    {
                        overallScore:
                            comparison.score.overall?.toFixed(1),

                        priority:
                            comparison.priority?.label_ko ?? "없음",

                        priorityError:
                            comparison.priority
                                ? comparison.priority.error_deg.toFixed(1)
                                : "없음",

                        coverage:
                            comparison.coverage,

                        meanErrors:
                            comparison.mean_errors_deg
                    }
                );
            }
        }

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

                // Composition should not be driven by hallucinated low-visibility
                // landmarks. Use tracked points first, then fall back if needed.
                for (let index = 0; index < 33; index++) {
                    const visibility =
                        landmarks[index]?.visibility === undefined
                            ? 1
                            : Number(landmarks[index]?.visibility);

                    if (visibility < 0.25) continue;
                    currentXValues.push(currentPoints[index].x);
                    currentYValues.push(currentPoints[index].y);
                }

                if (currentXValues.length < 8) {
                    currentXValues.length = 0;
                    currentYValues.length = 0;
                    for (let index = 0; index < 33; index++) {
                        currentXValues.push(currentPoints[index].x);
                        currentYValues.push(currentPoints[index].y);
                    }
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

                const compositionInsideReferenceFrame = Boolean(
                    referenceFrame &&
                    currentLeft >= referenceFrame.left - referenceFrame.width * 0.04 &&
                    currentRight <= referenceFrame.right + referenceFrame.width * 0.04 &&
                    currentTop >= referenceFrame.top - referenceFrame.height * 0.04 &&
                    currentBottom <= referenceFrame.bottom + referenceFrame.height * 0.04
                );

                const compositionValid =
                    coreBodyVisible &&
                    compositionInsideFrame;

                const torsoLength = Math.hypot(
                    currentPoints[23].x - currentPoints[11].x,
                    currentPoints[23].y - currentPoints[11].y
                );

                // v4.1: compare framing in the virtual Reference coordinate
                // system. Horizontal/vertical tolerance is tied to the
                // Reference frame, not to the user's current torso size.
                const liveCompositionTolerance =
                    getLiveCompositionTolerance(
                        referenceFrame ?? {
                            width: canvas.width,
                            height: canvas.height
                        }
                    );
                const compositionToleranceX =
                    liveCompositionTolerance.x;
                const compositionToleranceY =
                    liveCompositionTolerance.y;
                const compositionTolerance =
                    Math.max(compositionToleranceX, compositionToleranceY);

                const leftMatched =
                    compositionValid &&
                    Math.abs(
                        currentLeft - targetComposition.left
                    ) <= compositionToleranceX;

                const rightMatched =
                    compositionValid &&
                    Math.abs(
                        currentRight - targetComposition.right
                    ) <= compositionToleranceX;

                const topMatched =
                    compositionValid &&
                    Math.abs(
                        currentTop - targetComposition.top
                    ) <= compositionToleranceY;

                const bottomMatched =
                    compositionValid &&
                    Math.abs(
                        currentBottom - targetComposition.bottom
                    ) <= compositionToleranceY;

                // v4.3 Pose Fidelity thresholds.
                // 2D joint/segment geometry is the primary hard match because it
                // is much more stable than monocular 3D segment orientation.
                // 3D is now advisory, except for a coarse camera-relative depth
                // sign check when the Reference clearly places a distal joint
                // toward/away from the camera.
                const jointAngleTolerance =
                    MATCH_POLICY.pose.jointAngleTolerance;
                const hipAngleTolerance =
                    MATCH_POLICY.pose.hipAngleTolerance;
                const segmentAngleTolerance =
                    MATCH_POLICY.pose.segmentAngleTolerance;
                const joint3DTolerance =
                    MATCH_POLICY.pose.joint3DTolerance;
                const segment3DTolerance =
                    MATCH_POLICY.pose.segment3DTolerance;
                const pronouncedDepthThreshold = 0.16;
                const depthAgreementTolerance = 0.13;

                const poseDepthReliable = Boolean(
                    latest3DComparison?.ready &&
                    latest3DComparison?.coverage?.sufficient
                );

                const segment3DErrors =
                    latest3DComparison?.segment_errors_deg ?? {};
                const joint3DErrors =
                    latest3DComparison?.joint_errors_deg ?? {};
                const liveJointAngles3D =
                    latest3DComparison?.live_joint_angles_3d ?? {};
                const targetJointAngles3D =
                    latest3DComparison?.target_joint_angles_3d ?? {};
                const liveCameraDepth =
                    latest3DComparison?.camera_relative_depth?.live ?? {};
                const targetCameraDepth =
                    latest3DComparison?.camera_relative_depth?.target ?? {};

                const leftUpperArm3DDiff = Number(segment3DErrors.left_upper_arm);
                const leftForearm3DDiff = Number(segment3DErrors.left_forearm);
                const rightUpperArm3DDiff = Number(segment3DErrors.right_upper_arm);
                const rightForearm3DDiff = Number(segment3DErrors.right_forearm);
                const leftThigh3DDiff = Number(segment3DErrors.left_thigh);
                const leftLowerLeg3DDiff = Number(segment3DErrors.left_lower_leg);
                const rightThigh3DDiff = Number(segment3DErrors.right_thigh);
                const rightLowerLeg3DDiff = Number(segment3DErrors.right_lower_leg);

                const leftElbow3DDiff = Number(joint3DErrors.left_elbow);
                const rightElbow3DDiff = Number(joint3DErrors.right_elbow);
                const leftKnee3DDiff = Number(joint3DErrors.left_knee);
                const rightKnee3DDiff = Number(joint3DErrors.right_knee);

                const depthState = (key) => {
                    const live = Number(liveCameraDepth[key]);
                    const target = Number(targetCameraDepth[key]);

                    if (
                        !poseDepthReliable ||
                        !Number.isFinite(live) ||
                        !Number.isFinite(target)
                    ) {
                        return {
                            reliable: false,
                            matched: true,
                            live,
                            target,
                            delta: null,
                            pronounced: false
                        };
                    }

                    const pronounced =
                        Math.abs(target) >= pronouncedDepthThreshold;

                    if (!pronounced) {
                        return {
                            reliable: true,
                            matched: true,
                            live,
                            target,
                            delta: target - live,
                            pronounced: false
                        };
                    }

                    const sameSide =
                        Math.sign(live) === Math.sign(target) ||
                        Math.abs(live) < 0.04 ||
                        Math.abs(target) < 0.04;

                    const closeEnough =
                        Math.abs(target - live) <= depthAgreementTolerance;

                    return {
                        reliable: true,
                        matched: sameSide || closeEnough,
                        live,
                        target,
                        delta: target - live,
                        pronounced: true
                    };
                };

                const leftElbowDepth = depthState("left_elbow");
                const leftWristDepth = depthState("left_wrist");
                const rightElbowDepth = depthState("right_elbow");
                const rightWristDepth = depthState("right_wrist");
                const leftKneeDepth = depthState("left_knee");
                const leftAnkleDepth = depthState("left_ankle");
                const rightKneeDepth = depthState("right_knee");
                const rightAnkleDepth = depthState("right_ankle");
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
                    leftHipDiff <= hipAngleTolerance &&
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
                    rightHipDiff <= hipAngleTolerance &&
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

                // Body match is the existing visual matcher. v4 adds
                // torso/head/eye gates after this baseline is satisfied.
                const bodyMatched =
                    allPoseMatched &&
                    compositionMatched;

                overallMatched = bodyMatched;

                const pointSnapshot = (point) => ({
                    x: point.x / canvas.width,
                    y: point.y / canvas.height
                });

                const localPoint3D = (index, source = "live") => {
                    const p = latest3DComparison?.body_local?.[source]?.[index];
                    if (!p) return null;
                    const x = Number(p.x), y = Number(p.y), z = Number(p.z);
                    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
                };

                const signedJointDelta3D = (name) => {
                    const live = Number(liveJointAngles3D[name]);
                    const target = Number(targetJointAngles3D[name]);
                    return Number.isFinite(live) && Number.isFinite(target)
                        ? target - live
                        : null;
                };

                const copyDepthState = (value) => ({
                    reliable: Boolean(value?.reliable),
                    matched: value?.matched !== false,
                    live: Number.isFinite(value?.live) ? value.live : null,
                    target: Number.isFinite(value?.target) ? value.target : null,
                    delta: Number.isFinite(value?.delta) ? value.delta : null,
                    pronounced: Boolean(value?.pronounced)
                });

                const poseMatchState = {
                    jointAngleTolerance,
                    hipAngleTolerance,
                    segmentAngleTolerance,
                    joint3DTolerance,
                    segment3DTolerance,
                    depthReliable: poseDepthReliable,
                    parts: {
                        leftUpperArm: {
                            matched: leftUpperArmMatched,
                            visible: leftArmVisible,
                            partLabel: "왼쪽 위팔",
                            endpointLabel: "왼쪽 팔꿈치",
                            jointDiff: leftElbowDiff,
                            segmentDiff: leftUpperArmDiff,
                            signedJointDelta: targetLeftElbowAngle - leftElbowAngle,
                            joint3DDiff: leftElbow3DDiff,
                            segment3DDiff: leftUpperArm3DDiff,
                            signedJointDelta3D: signedJointDelta3D("left_elbow"),
                            local3D: {
                                currentStart: localPoint3D(11, "live"),
                                currentEnd: localPoint3D(13, "live"),
                                targetStart: localPoint3D(11, "target"),
                                targetEnd: localPoint3D(13, "target")
                            },
                            cameraDepth: copyDepthState(leftElbowDepth),
                            currentStart: pointSnapshot(currentPoints[11]),
                            currentEnd: pointSnapshot(currentPoints[13]),
                            targetStart: pointSnapshot(targetPoints[11]),
                            targetEnd: pointSnapshot(targetPoints[13])
                        },
                        leftForearm: {
                            matched: leftForearmMatched,
                            visible: leftArmVisible,
                            partLabel: "왼쪽 아래팔",
                            endpointLabel: "왼손",
                            jointDiff: leftElbowDiff,
                            segmentDiff: leftForearmDiff,
                            signedJointDelta: targetLeftElbowAngle - leftElbowAngle,
                            joint3DDiff: leftElbow3DDiff,
                            segment3DDiff: leftForearm3DDiff,
                            signedJointDelta3D: signedJointDelta3D("left_elbow"),
                            local3D: {
                                currentStart: localPoint3D(13, "live"),
                                currentEnd: localPoint3D(15, "live"),
                                targetStart: localPoint3D(13, "target"),
                                targetEnd: localPoint3D(15, "target")
                            },
                            cameraDepth: copyDepthState(leftWristDepth),
                            currentStart: pointSnapshot(currentPoints[13]),
                            currentEnd: pointSnapshot(currentPoints[15]),
                            targetStart: pointSnapshot(targetPoints[13]),
                            targetEnd: pointSnapshot(targetPoints[15])
                        },
                        rightUpperArm: {
                            matched: rightUpperArmMatched,
                            visible: rightArmVisible,
                            partLabel: "오른쪽 위팔",
                            endpointLabel: "오른쪽 팔꿈치",
                            jointDiff: rightElbowDiff,
                            segmentDiff: rightUpperArmDiff,
                            signedJointDelta: targetRightElbowAngle - rightElbowAngle,
                            joint3DDiff: rightElbow3DDiff,
                            segment3DDiff: rightUpperArm3DDiff,
                            signedJointDelta3D: signedJointDelta3D("right_elbow"),
                            local3D: {
                                currentStart: localPoint3D(12, "live"),
                                currentEnd: localPoint3D(14, "live"),
                                targetStart: localPoint3D(12, "target"),
                                targetEnd: localPoint3D(14, "target")
                            },
                            cameraDepth: copyDepthState(rightElbowDepth),
                            currentStart: pointSnapshot(currentPoints[12]),
                            currentEnd: pointSnapshot(currentPoints[14]),
                            targetStart: pointSnapshot(targetPoints[12]),
                            targetEnd: pointSnapshot(targetPoints[14])
                        },
                        rightForearm: {
                            matched: rightForearmMatched,
                            visible: rightArmVisible,
                            partLabel: "오른쪽 아래팔",
                            endpointLabel: "오른손",
                            jointDiff: rightElbowDiff,
                            segmentDiff: rightForearmDiff,
                            signedJointDelta: targetRightElbowAngle - rightElbowAngle,
                            joint3DDiff: rightElbow3DDiff,
                            segment3DDiff: rightForearm3DDiff,
                            signedJointDelta3D: signedJointDelta3D("right_elbow"),
                            local3D: {
                                currentStart: localPoint3D(14, "live"),
                                currentEnd: localPoint3D(16, "live"),
                                targetStart: localPoint3D(14, "target"),
                                targetEnd: localPoint3D(16, "target")
                            },
                            cameraDepth: copyDepthState(rightWristDepth),
                            currentStart: pointSnapshot(currentPoints[14]),
                            currentEnd: pointSnapshot(currentPoints[16]),
                            targetStart: pointSnapshot(targetPoints[14]),
                            targetEnd: pointSnapshot(targetPoints[16])
                        },
                        leftThigh: {
                            matched: leftThighMatched,
                            visible: leftThighVisible,
                            partLabel: "왼쪽 허벅지",
                            endpointLabel: "왼쪽 무릎",
                            jointDiff: leftHipDiff,
                            segmentDiff: leftThighDiff,
                            signedJointDelta: targetLeftHipAngle - leftHipAngle,
                            joint3DDiff: null,
                            segment3DDiff: leftThigh3DDiff,
                            signedJointDelta3D: null,
                            local3D: {
                                currentStart: localPoint3D(23, "live"),
                                currentEnd: localPoint3D(25, "live"),
                                targetStart: localPoint3D(23, "target"),
                                targetEnd: localPoint3D(25, "target")
                            },
                            cameraDepth: copyDepthState(leftKneeDepth),
                            currentStart: pointSnapshot(currentPoints[23]),
                            currentEnd: pointSnapshot(currentPoints[25]),
                            targetStart: pointSnapshot(targetPoints[23]),
                            targetEnd: pointSnapshot(targetPoints[25])
                        },
                        leftLowerLeg: {
                            matched: leftLowerLegMatched,
                            visible: leftLowerLegVisible,
                            partLabel: "왼쪽 종아리",
                            endpointLabel: "왼발",
                            jointDiff: leftKneeDiff,
                            segmentDiff: leftLowerLegDiff,
                            signedJointDelta: targetLeftKneeAngle - leftKneeAngle,
                            joint3DDiff: leftKnee3DDiff,
                            segment3DDiff: leftLowerLeg3DDiff,
                            signedJointDelta3D: signedJointDelta3D("left_knee"),
                            local3D: {
                                currentStart: localPoint3D(25, "live"),
                                currentEnd: localPoint3D(27, "live"),
                                targetStart: localPoint3D(25, "target"),
                                targetEnd: localPoint3D(27, "target")
                            },
                            cameraDepth: copyDepthState(leftAnkleDepth),
                            currentStart: pointSnapshot(currentPoints[25]),
                            currentEnd: pointSnapshot(currentPoints[27]),
                            targetStart: pointSnapshot(targetPoints[25]),
                            targetEnd: pointSnapshot(targetPoints[27])
                        },
                        rightThigh: {
                            matched: rightThighMatched,
                            visible: rightThighVisible,
                            partLabel: "오른쪽 허벅지",
                            endpointLabel: "오른쪽 무릎",
                            jointDiff: rightHipDiff,
                            segmentDiff: rightThighDiff,
                            signedJointDelta: targetRightHipAngle - rightHipAngle,
                            joint3DDiff: null,
                            segment3DDiff: rightThigh3DDiff,
                            signedJointDelta3D: null,
                            local3D: {
                                currentStart: localPoint3D(24, "live"),
                                currentEnd: localPoint3D(26, "live"),
                                targetStart: localPoint3D(24, "target"),
                                targetEnd: localPoint3D(26, "target")
                            },
                            cameraDepth: copyDepthState(rightKneeDepth),
                            currentStart: pointSnapshot(currentPoints[24]),
                            currentEnd: pointSnapshot(currentPoints[26]),
                            targetStart: pointSnapshot(targetPoints[24]),
                            targetEnd: pointSnapshot(targetPoints[26])
                        },
                        rightLowerLeg: {
                            matched: rightLowerLegMatched,
                            visible: rightLowerLegVisible,
                            partLabel: "오른쪽 종아리",
                            endpointLabel: "오른발",
                            jointDiff: rightKneeDiff,
                            segmentDiff: rightLowerLegDiff,
                            signedJointDelta: targetRightKneeAngle - rightKneeAngle,
                            joint3DDiff: rightKnee3DDiff,
                            segment3DDiff: rightLowerLeg3DDiff,
                            signedJointDelta3D: signedJointDelta3D("right_knee"),
                            local3D: {
                                currentStart: localPoint3D(26, "live"),
                                currentEnd: localPoint3D(28, "live"),
                                targetStart: localPoint3D(26, "target"),
                                targetEnd: localPoint3D(28, "target")
                            },
                            cameraDepth: copyDepthState(rightAnkleDepth),
                            currentStart: pointSnapshot(currentPoints[26]),
                            currentEnd: pointSnapshot(currentPoints[28]),
                            targetStart: pointSnapshot(targetPoints[26]),
                            targetEnd: pointSnapshot(targetPoints[28])
                        }
                    }
                };

                const currentWidth = currentRight - currentLeft;
                const currentHeight = currentBottom - currentTop;
                const targetWidth = targetComposition.right - targetComposition.left;
                const targetHeight = targetComposition.bottom - targetComposition.top;

                const currentShoulderWidth = Math.hypot(
                    currentPoints[12].x - currentPoints[11].x,
                    currentPoints[12].y - currentPoints[11].y
                );
                const targetShoulderWidth = Math.hypot(
                    targetPoints[12].x - targetPoints[11].x,
                    targetPoints[12].y - targetPoints[11].y
                );

                const currentHipWidth = Math.hypot(
                    currentPoints[24].x - currentPoints[23].x,
                    currentPoints[24].y - currentPoints[23].y
                );
                const targetHipWidth = Math.hypot(
                    targetPoints[24].x - targetPoints[23].x,
                    targetPoints[24].y - targetPoints[23].y
                );

                const targetTorsoLength = Math.hypot(
                    targetPoints[23].x - targetPoints[11].x,
                    targetPoints[23].y - targetPoints[11].y
                );

                const safeRatio = (a, b) =>
                    Number.isFinite(a) &&
                        Number.isFinite(b) &&
                        Math.abs(b) > 1e-6
                        ? a / b
                        : null;

                const compositionState = {
                    valid: compositionValid,
                    matched: compositionMatched,
                    tolerancePx: compositionTolerance,
                    toleranceX: compositionToleranceX,
                    toleranceY: compositionToleranceY,
                    clipped: !compositionInsideFrame,
                    insideReferenceFrame: compositionInsideReferenceFrame,
                    referenceFrame: referenceFrame ? { ...referenceFrame } : null,
                    edges: {
                        leftMatched,
                        rightMatched,
                        topMatched,
                        bottomMatched
                    },
                    current: {
                        left: currentLeft,
                        right: currentRight,
                        top: currentTop,
                        bottom: currentBottom,
                        width: currentWidth,
                        height: currentHeight,
                        centerX: (currentLeft + currentRight) / 2,
                        centerY: (currentTop + currentBottom) / 2
                    },
                    target: {
                        left: targetComposition.left,
                        right: targetComposition.right,
                        top: targetComposition.top,
                        bottom: targetComposition.bottom,
                        width: targetWidth,
                        height: targetHeight,
                        centerX: (targetComposition.left + targetComposition.right) / 2,
                        centerY: (targetComposition.top + targetComposition.bottom) / 2
                    },
                    scaleSignals: {
                        heightRatio: safeRatio(currentHeight, targetHeight),
                        widthRatio: safeRatio(currentWidth, targetWidth),
                        shoulderRatio: safeRatio(currentShoulderWidth, targetShoulderWidth),
                        hipRatio: safeRatio(currentHipWidth, targetHipWidth),
                        torsoRatio: safeRatio(torsoLength, targetTorsoLength)
                    },
                    normalized: referenceFrame ? {
                        currentLeft: (currentLeft - referenceFrame.left) / referenceFrame.width,
                        currentRight: (currentRight - referenceFrame.left) / referenceFrame.width,
                        currentTop: (currentTop - referenceFrame.top) / referenceFrame.height,
                        currentBottom: (currentBottom - referenceFrame.top) / referenceFrame.height,
                        targetLeft: (targetComposition.left - referenceFrame.left) / referenceFrame.width,
                        targetRight: (targetComposition.right - referenceFrame.left) / referenceFrame.width,
                        targetTop: (targetComposition.top - referenceFrame.top) / referenceFrame.height,
                        targetBottom: (targetComposition.bottom - referenceFrame.top) / referenceFrame.height
                    } : null,
                    visibility: {
                        coreBodyVisible,
                        fullBodyVisible:
                            coreBodyVisible &&
                            isVisible(27) &&
                            isVisible(28)
                    }
                };

                const orientationState = updateOrientationQuality({
                    imageLandmarks: landmarks,
                    referenceData,
                    adaptiveTarget: getAdaptiveTarget(),
                    faceAnalysis: latestFaceAnalysis,
                    isMirrored:
                        mirrorEnabled,
                    bodyMatched,
                    frameWidth: canvas.width,
                    frameHeight: canvas.height
                });

                // Auto-shoot now requires the old body matcher PLUS every
                // reliable orientation/eye gate. Unknown face state never blocks.
                overallMatched =
                    bodyMatched &&
                    orientationState.captureReady;

                // Do not generate or speak guidance while the capture preview is open.
                // autoCaptureLocked becomes true inside capturePhoto().
                if (
                    !autoCaptureLocked &&
                    performance.now() >= guidanceResumeAt
                ) {
                    latestGuidance = updateGuidance({
                        imageLandmarks: landmarks,
                        comparison: latest3DComparison,
                        adaptiveTarget: getAdaptiveTarget(),
                        referenceData: referenceData,
                        compositionState: compositionState,
                        isMirrored:
                            mirrorEnabled,
                        poseMatched: allPoseMatched,
                        poseMatchState: poseMatchState,
                        compositionMatched: compositionMatched,
                        overallMatched: overallMatched
                    });

                    // Once framing + limb pose are solved, v4 takes over
                    // with torso -> head -> eye-open coaching.
                    if (bodyMatched && orientationState.action) {
                        latestGuidance = {
                            ...latestGuidance,
                            phase: orientationState.phase,
                            actor: orientationState.actor,
                            action: orientationState.action,
                            orientation: orientationState
                        };
                    } else {
                        latestGuidance = {
                            ...latestGuidance,
                            orientation: orientationState
                        };
                    }

                    const now = performance.now();

                    if (now - lastGuidanceLogTime >= 1000) {
                        lastGuidanceLogTime = now;

                        console.log(
                            "[GUIDANCE v4.2]",
                            {
                                phase:
                                    latestGuidance.phase ?? "NONE",
                                actor:
                                    latestGuidance.action?.actor ?? latestGuidance.actor ?? "NONE",
                                action:
                                    latestGuidance.action?.key ?? "NONE",
                                text:
                                    latestGuidance.action?.text ?? "",
                                subjectDetected:
                                    latestGuidance.subject?.detected,
                                comparisonReady:
                                    latestGuidance.comparisonReady,
                                reliable3D:
                                    latestGuidance.comparisonReliable3D,
                                torsoMatched:
                                    orientationState.torso?.matched,
                                headMatched:
                                    orientationState.head?.matched,
                                headSource:
                                    orientationState.head?.source,
                                eyesClosed:
                                    orientationState.eyes?.reliable
                                        ? orientationState.eyes.closed
                                        : "unknown",
                                motionSpeed:
                                    latestGuidance.motion?.speed?.toFixed(3),
                                scaleRatio:
                                    latestGuidance.metrics?.composition
                                        ?.scaleRatio?.toFixed(3),
                                heightRatio:
                                    latestGuidance.metrics?.composition
                                        ?.heightRatio?.toFixed(3),
                                centerErrorX:
                                    latestGuidance.metrics?.composition
                                        ?.centerErrorX?.toFixed(3),
                                unmatchedVisualParts:
                                    Object.entries(poseMatchState.parts)
                                        .filter(([, part]) => part.visible && !part.matched)
                                        .map(([name]) => name),
                                topCandidates:
                                    latestGuidance.candidates
                                        ?.slice(0, 3)
                                        .map(item => ({
                                            key: item.key,
                                            score: item.priorityScore.toFixed(1),
                                            source: item.details?.source ?? "SECONDARY"
                                        }))
                            }
                        );
                    }

                    // Freeze all data needed for a post-capture diagnosis.
                    // capturePhoto() copies the most recent analyzed frame so the
                    // preview review cannot drift with later live-camera frames.
                    latestFrameSnapshot = {
                        analyzedAt: performance.now(),
                        reference: {
                            index: currentReferenceIndex,
                            name: referenceItems[currentReferenceIndex]?.name ??
                                `Reference ${currentReferenceIndex + 1}`
                        },
                        isMirrored:
                            mirrorEnabled,
                        poseMatched: allPoseMatched,
                        compositionMatched: compositionMatched,
                        overallMatched: overallMatched,
                        composition: {
                            valid: compositionValid,
                            clipped: !compositionInsideFrame,
                            currentLeft,
                            currentRight,
                            currentTop,
                            currentBottom,
                            targetLeft: targetComposition.left,
                            targetRight: targetComposition.right,
                            targetTop: targetComposition.top,
                            targetBottom: targetComposition.bottom,
                            tolerance: compositionTolerance,
                            toleranceX: compositionToleranceX,
                            toleranceY: compositionToleranceY,
                            referenceFrame: referenceFrame ? { ...referenceFrame } : null,
                            normalized: referenceFrame ? {
                                currentLeft: (currentLeft - referenceFrame.left) / referenceFrame.width,
                                currentRight: (currentRight - referenceFrame.left) / referenceFrame.width,
                                currentTop: (currentTop - referenceFrame.top) / referenceFrame.height,
                                currentBottom: (currentBottom - referenceFrame.top) / referenceFrame.height,
                                targetLeft: (targetComposition.left - referenceFrame.left) / referenceFrame.width,
                                targetRight: (targetComposition.right - referenceFrame.left) / referenceFrame.width,
                                targetTop: (targetComposition.top - referenceFrame.top) / referenceFrame.height,
                                targetBottom: (targetComposition.bottom - referenceFrame.top) / referenceFrame.height
                            } : null,
                            matches: {
                                left: leftMatched,
                                right: rightMatched,
                                top: topMatched,
                                bottom: bottomMatched
                            }
                        },
                        pose: {
                            jointAngleTolerance,
                            hipAngleTolerance,
                            segmentAngleTolerance,
                            joint3DTolerance,
                            segment3DTolerance,
                            depthReliable: poseDepthReliable,
                            visibility: {
                                leftArm: leftArmVisible,
                                rightArm: rightArmVisible,
                                leftThigh: leftThighVisible,
                                leftLowerLeg: leftLowerLegVisible,
                                rightThigh: rightThighVisible,
                                rightLowerLeg: rightLowerLegVisible
                            },
                            errors: {
                                leftElbow: leftElbowDiff,
                                rightElbow: rightElbowDiff,
                                leftHip: leftHipDiff,
                                rightHip: rightHipDiff,
                                leftKnee: leftKneeDiff,
                                rightKnee: rightKneeDiff,
                                leftUpperArm: leftUpperArmDiff,
                                leftForearm: leftForearmDiff,
                                rightUpperArm: rightUpperArmDiff,
                                rightForearm: rightForearmDiff,
                                leftThigh: leftThighDiff,
                                leftLowerLeg: leftLowerLegDiff,
                                rightThigh: rightThighDiff,
                                rightLowerLeg: rightLowerLegDiff
                            },
                            errors3d: {
                                leftElbow: leftElbow3DDiff,
                                rightElbow: rightElbow3DDiff,
                                leftKnee: leftKnee3DDiff,
                                rightKnee: rightKnee3DDiff,
                                leftUpperArm: leftUpperArm3DDiff,
                                leftForearm: leftForearm3DDiff,
                                rightUpperArm: rightUpperArm3DDiff,
                                rightForearm: rightForearm3DDiff,
                                leftThigh: leftThigh3DDiff,
                                leftLowerLeg: leftLowerLeg3DDiff,
                                rightThigh: rightThigh3DDiff,
                                rightLowerLeg: rightLowerLeg3DDiff
                            },
                            angles3d: {
                                current: { ...liveJointAngles3D },
                                target: { ...targetJointAngles3D }
                            },
                            angles: {
                                current: {
                                    leftElbow: leftElbowAngle,
                                    rightElbow: rightElbowAngle,
                                    leftKnee: leftKneeAngle,
                                    rightKnee: rightKneeAngle
                                },
                                target: {
                                    leftElbow: targetLeftElbowAngle,
                                    rightElbow: targetRightElbowAngle,
                                    leftKnee: targetLeftKneeAngle,
                                    rightKnee: targetRightKneeAngle
                                }
                            }
                        },
                        comparison: clonePlain(latest3DComparison),
                        guidance: clonePlain(latestGuidance),
                        orientation: clonePlain(orientationState),
                        face: clonePlain(latestFaceAnalysis)
                    };

                    const oneCue = updateOneCue({
                        guidance: latestGuidance,
                        comparison: latest3DComparison,
                        compositionMatched: compositionMatched,
                        poseMatched: allPoseMatched,
                        overallMatched: overallMatched
                    });

                    if (oneCue.cancelAutoCapture && autoCaptureTimer) {
                        clearTimeout(autoCaptureTimer);
                        autoCaptureTimer = null;

                        if (appState === APP_STATES.CAPTURE_COUNTDOWN) {
                            setAppState(APP_STATES.CAMERA_GUIDANCE);
                        }

                        console.log("[AUTO SHOOT CANCELLED]");
                    }

                    if (oneCue.shouldSpeak) {
                        console.log(
                            "[ONE CUE v4.2]",
                            oneCue.cueKey,
                            oneCue.cueText
                        );

                        speakGuidanceCue(
                            oneCue.cueText,
                            {
                                interrupt: oneCue.interruptSpeech
                            }
                        );
                    }

                    if (
                        oneCue.shouldAutoCapture &&
                        !autoCaptureLocked
                    ) {
                        setAppState(APP_STATES.CAPTURE_COUNTDOWN);

                        console.log(
                            "[AUTO SHOOT SCHEDULED]",
                            `${oneCue.captureDelayMs} ms`
                        );

                        if (autoCaptureTimer) {
                            clearTimeout(autoCaptureTimer);
                        }

                        autoCaptureTimer = setTimeout(() => {
                            autoCaptureTimer = null;

                            if (
                                appState === APP_STATES.CAPTURE_COUNTDOWN &&
                                guidanceSessionEnabled() &&
                                !autoCaptureLocked &&
                                !captureTransitionLocked
                            ) {
                                capturePhoto("auto");
                            } else {
                                console.log("[AUTO SHOOT SKIPPED] stale countdown");
                            }
                        }, oneCue.captureDelayMs);
                    }

                } else {
                    latestGuidance = null;
                }

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
                        displayCanvasX(currentPoints[start].x),
                        currentPoints[start].y
                    );

                    ctx.lineTo(
                        displayCanvasX(currentPoints[end].x),
                        currentPoints[end].y
                    );

                    ctx.stroke();
                }
                ctx.strokeStyle = "#A0A0A0";
                ctx.lineWidth = 1;

                const currentDisplayRect = mirroredRectX(
                    currentLeft,
                    currentRight
                );

                ctx.strokeRect(
                    currentDisplayRect.left,
                    currentTop,
                    currentDisplayRect.right - currentDisplayRect.left,
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

                drawReferenceFrameDebug();
                drawFaceDebug(latestFaceAnalysis);
            }
        }
    }

    if (!overallMatched) {
        captureButton.classList.remove("matched");
    }

    queueNextPrediction();
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

function capturePhoto(source = "manual") {
    closeDevelopmentPanels();

    if (
        captureTransitionLocked ||
        appState === APP_STATES.REVIEW ||
        appState === APP_STATES.REFERENCE_LIBRARY
    ) {
        console.log(`[CAPTURE IGNORED] source=${source} state=${appState}`);
        return false;
    }

    if (
        video.videoWidth === 0 ||
        video.videoHeight === 0
    ) {
        return false;
    }

    // Lock before changing state so manual+auto or double-click cannot capture twice.
    captureTransitionLocked = true;
    reviewActionLocked = false;

    // REVIEW is a hard inference boundary: no MediaPipe work after capture.
    setCameraStatus("");
    setAppState(APP_STATES.REVIEW);
    stopPredictionLoop();

    // In original-camera mode, capture a plain photo without Reference evaluation.
    // Otherwise copy the latest analyzed frame BEFORE resetting live guidance.
    const captureSnapshot = guidancePausedByUser
        ? null
        : clonePlain(latestFrameSnapshot);

    if (captureSnapshot) {
        captureSnapshot.frameAgeMs = Math.max(
            0,
            performance.now() - (captureSnapshot.analyzedAt ?? performance.now())
        );
        captureSnapshot.capturedAt = performance.now();
    }

    cancelAutoCapture(`capture-${source}`);
    autoCaptureLocked = true;

    // Capture is a terminal state for the current guidance cycle.
    // Stop any queued/current speech and prevent post-capture chatter.
    cancelSpeechNow();
    resetOneCueController();
    resetGuidanceEngine();
    latestGuidance = null;

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
        mirrorEnabled;

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

    if (captureSnapshot) {
        captureSnapshot.quality = {
            sharpness: estimatePersonSharpness(
                captureCanvas,
                captureSnapshot
            )
        };
    }

    capturedImageData =
        captureCanvas.toDataURL(
            "image/jpeg",
            0.95
        );

    capturedImage.src =
        capturedImageData;

    // Keep the MediaStream attached for fast retake, but stop video playback
    // while the still-image review is open. The camera reconnect is avoided.
    video.pause();

    capturePreviewScreen.hidden = false;

    lastCaptureReview = guidancePausedByUser
        ? null
        : analyzeCaptureSnapshot(captureSnapshot);

    if (lastCaptureReview) {
        renderCaptureReview(lastCaptureReview);
    } else {
        clearCaptureReview();
    }

    console.log(
        "[POST-CAPTURE v4]",
        lastCaptureReview
    );

    console.log(`Photo captured (${source})`);
    updateDebugRuntimeMonitor();
    return true;
}

function closeCapturePreview() {
    capturePreviewScreen.hidden = true;

    capturedImage.src = "";
    capturedImageData = null;

    clearCaptureReview();
    lastCaptureReview = null;
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

    // Camera-first UX: saving ends only the review, not the camera session.
    // Keep the selected Reference and return directly to live camera.
    console.log(
        "[CAMERA-FIRST v5.1] Photo saved; returning to camera"
    );

    void resumeCameraAfterReview();
}

function syncCameraViewportGeometry() {
    if (!cameraContainer || !video || !canvas) return;

    const viewportWidth = Math.max(1, cameraContainer.clientWidth || window.innerWidth || 1);
    const viewportHeight = Math.max(1, cameraContainer.clientHeight || window.innerHeight || 1);
    const sourceWidth = Number(video.videoWidth) || 0;
    const sourceHeight = Number(video.videoHeight) || 0;

    // Before camera metadata exists, keep both scene layers pinned to the viewport.
    if (!sourceWidth || !sourceHeight) {
        for (const element of [video, canvas]) {
            element.style.width = `${viewportWidth}px`;
            element.style.height = `${viewportHeight}px`;
            element.style.left = '0px';
            element.style.top = '0px';
        }
        return;
    }

    // Explicit cover geometry. This avoids device/browser-specific video letterboxing
    // while preserving the camera aspect ratio. The overlay receives the exact same
    // geometry so landmarks and reference guides remain aligned with the preview.
    const scale = Math.max(
        viewportWidth / sourceWidth,
        viewportHeight / sourceHeight
    );
    const displayWidth = Math.ceil(sourceWidth * scale);
    const displayHeight = Math.ceil(sourceHeight * scale);
    const offsetLeft = Math.floor((viewportWidth - displayWidth) / 2);
    const offsetTop = Math.floor((viewportHeight - displayHeight) / 2);

    for (const element of [video, canvas]) {
        element.style.width = `${displayWidth}px`;
        element.style.height = `${displayHeight}px`;
        element.style.left = `${offsetLeft}px`;
        element.style.top = `${offsetTop}px`;
    }
}

function applyMirrorVisualState() {
    // Mirror ONLY the camera image as a DOM element.
    // The canvas element itself stays unmirrored so UI/debug text remains readable.
    // Camera-relative overlay geometry is mirrored explicitly at draw time.
    video.classList.toggle("is-mirrored", mirrorEnabled);

    normalizeNonSceneUI();
}

function setMirrorState(isMirror) {

    mirrorEnabled =
        Boolean(isMirror);

    applyMirrorVisualState();

    mirrorButton.classList.toggle(
        "active",
        mirrorEnabled
    );

    mirrorButton.setAttribute(
        "aria-pressed",
        mirrorEnabled
    );
    mirrorButton.title = mirrorEnabled ? "좌우 반전 켜짐" : "좌우 반전 꺼짐";
    updateDebugRuntimeMonitor();
}

function toggleMirror() {

    setMirrorState(
        !mirrorEnabled
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
        capturePhoto("keyboard");
    }
});

function waitForVideoMetadata(requestId, timeoutMs = 5000) {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        let settled = false;

        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            video.removeEventListener("loadedmetadata", onReady);
            video.removeEventListener("loadeddata", onReady);
            resolve(value);
        };

        const onReady = () => {
            if (requestId !== cameraRequestSerial) {
                finish(false);
                return;
            }
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                finish(true);
            }
        };

        const timer = setTimeout(() => finish(false), timeoutMs);
        video.addEventListener("loadedmetadata", onReady);
        video.addEventListener("loadeddata", onReady);
    });
}

async function startCamera() {
    const requestId = ++cameraRequestSerial;
    cameraStarting = true;

    if (!navigator.mediaDevices?.getUserMedia) {
        cameraStarting = false;
        setCameraStatus(
            "이 브라우저에서는 카메라를 사용할 수 없어요. HTTPS 또는 localhost에서 열어주세요.",
            { error: true, retry: false }
        );
        updateDebugRuntimeMonitor();
        return false;
    }
    updateDebugRuntimeMonitor();

    try {
        stopPredictionLoop();
        setCameraStatus("카메라를 준비하고 있어요...");

        // Stop an older physical stream before opening another camera.
        if (currentStream) {
            currentStream
                .getTracks()
                .forEach(track => track.stop());
            currentStream = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: currentFacingMode }
            },
            audio: false
        });

        // Another navigation/camera request happened while permission/device was resolving.
        if (requestId !== cameraRequestSerial) {
            stream.getTracks().forEach(track => track.stop());
            console.log("[CAMERA] stale stream discarded");
            return false;
        }

        currentStream = stream;
        video.srcObject = stream;

        const metadataReady = await waitForVideoMetadata(requestId);

        if (requestId !== cameraRequestSerial) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        if (!metadataReady) {
            throw new Error("Camera metadata did not become ready in time");
        }

        syncCameraViewportGeometry();

        try {
            await video.play();
        } catch (error) {
            throw new Error(`Camera preview could not start: ${error?.message ?? error}`);
        }

        if (requestId !== cameraRequestSerial) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        cameraStarting = false;
        captureTransitionLocked = false;
        reviewActionLocked = false;

        setAppState(APP_STATES.CAMERA_GUIDANCE);
        autoCaptureLocked = false;
        guidanceResumeAt = performance.now();
        lastVideoTime = -1;

        setCameraStatus("");
            startPredictionLoop();

        console.log(
            `Camera started: ${currentFacingMode === "environment" ? "rear" : "front"}`
        );
        updateDebugRuntimeMonitor();
        return true;

    } catch (error) {
        if (requestId !== cameraRequestSerial) {
            return false;
        }

        cameraStarting = false;

        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
        }
        currentStream = null;
        video.srcObject = null;

        let message = "카메라를 시작하지 못했어요.";

        if (
            error?.name === "NotAllowedError" ||
            error?.name === "SecurityError"
        ) {
            message = "카메라 권한이 필요해요. 브라우저 설정에서 카메라를 허용해주세요.";
        } else if (error?.name === "NotFoundError") {
            message = "사용 가능한 카메라를 찾을 수 없어요.";
        } else if (error?.name === "NotReadableError") {
            message = "다른 앱에서 카메라를 사용 중인지 확인해주세요.";
        }

        setCameraStatus(message, { error: true, retry: true });
        console.error("Camera Error:", error);
        updateDebugRuntimeMonitor();
        return false;
    }
}

async function switchCamera() {

    closeDevelopmentPanels();
    stopPredictionLoop();

    cancelAutoCapture("switch-camera");
    autoCaptureLocked = false;
    captureTransitionLocked = false;
    resetOneCueController();
    resetGuidanceEngine();
    resetOrientationQuality();
    latestFaceAnalysis = null;
    latestFaceLandmarks = null;
    lastGoodFaceAt = -Infinity;
    latestGuidance = null;

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

captureButton.addEventListener(
    "click",
    () => {
        capturePhoto("manual");
    }
);

retakeButton.addEventListener(
    "click",
    async () => {
        if (reviewActionLocked || appState !== APP_STATES.REVIEW) return;
        reviewActionLocked = true;
        updateDebugRuntimeMonitor();
        closeDevelopmentPanels();

        const retakeHint =
            lastCaptureReview?.retakeHintText ?? null;

        await resumeCameraAfterReview();

        // Give the diagnosis one short turn before normal live coaching.
        if (retakeHint) {
            guidanceResumeAt = performance.now() + 2200;

            setTimeout(() => {
                if (
                    appState === APP_STATES.CAMERA_GUIDANCE &&
                    !autoCaptureLocked &&
                    voiceGuidanceEnabled()
                ) {
                    speakGuidanceCue(retakeHint, {
                        interrupt: true
                    });
                }
            }, 250);
        }
    }
);

savePhotoButton.addEventListener(
    "click",
    () => {
        if (reviewActionLocked || appState !== APP_STATES.REVIEW) return;
        reviewActionLocked = true;
        updateDebugRuntimeMonitor();
        saveCapturedPhoto();
    }
);

ensureDebugControls();
ensureCameraFirstControls();
ensureDebugRuntimeMonitor();

console.log(
    `[UI MODE v5.4] ${isDebugMode ? "DEBUG" : "NORMAL"}`
);

// v5.1: clear any legacy whole-container mirror state before camera starts.
window.addEventListener("resize", syncCameraViewportGeometry);
window.addEventListener("orientationchange", () => {
    window.setTimeout(syncCameraViewportGeometry, 120);
});
if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncCameraViewportGeometry);
}
video.addEventListener("loadedmetadata", syncCameraViewportGeometry);

cameraContainer.classList.remove("mirror");
applyMirrorVisualState();

await createPoseLandmarker();
await hydrateCustomReferencesFromStore();

createReferenceThumbnails();
refreshReferenceLibrarySelectionUI();

// Camera-first startup v5.2:
// A fresh app load ALWAYS begins as a plain camera.
// A previously used Reference may be remembered only as the Library preview
// position; it is NOT activated for guidance until the user explicitly taps
// the select button in the Reference Library during this session.
const storedReferenceIndex = getStoredReferenceIndex();
hasSelectedReference = false;
guidancePausedByUser = false;
debugView.face = false;
debugView.referenceFrame = false;
debugView.metrics = false;
syncReferenceDebugControls();
currentReferenceIndex =
    storedReferenceIndex !== null
        ? storedReferenceIndex
        : 0;
previewReferenceIndex = currentReferenceIndex;
updateReferencePreview();

// Preload data only for fast Library preview. Because hasSelectedReference is
// false, startPredictionLoop() remains idle and no pose/face/composition
// overlay is drawn on the initial camera screen.
await loadReferenceByIndex(currentReferenceIndex, { persist: false });

// Defensive clear: ensure no stale overlay survives hot reload/navigation.
if (canvas.width && canvas.height) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
latestFaceAnalysis = null;
latestFaceLandmarks = null;
latestGuidance = null;
overallMatched = false;

referenceScreen.hidden = true;
updateReferenceLibraryButton();
await startCamera();

console.log(
    "[CAMERA-FIRST v5.2] Home = plain camera, Reference = not selected"
);
console.log("[CUSTOM REF UX] v5.2.6 status-chip loaded");

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        // Never keep coaching/countdown running while the app is backgrounded.
        cancelAutoCapture("page-hidden");
        cancelSpeechNow();
        stopPredictionLoop();
        return;
    }

    if (
        appState === APP_STATES.CAMERA_GUIDANCE ||
        appState === APP_STATES.CAPTURE_COUNTDOWN
    ) {
        const hasLiveVideoTrack = Boolean(
            currentStream &&
            currentStream.getVideoTracks().some(track => track.readyState === "live")
        );

        if (!hasLiveVideoTrack) {
            void startCamera();
            return;
        }

        void video.play()
            .then(() => {
                guidanceResumeAt = performance.now() + 250;
                startPredictionLoop();
            })
            .catch(() => {
                void startCamera();
            });
    }
});

window.addEventListener("pagehide", () => {
    cancelAutoCapture("pagehide");
    cancelSpeechNow();
    stopCameraStream();
});

window.addEventListener("beforeunload", () => {
    for (const item of referenceItems) {
        if (item.isCustom) revokeCustomItemUrls(item);
    }
});
