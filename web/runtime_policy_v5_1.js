// Photo Guide - Runtime State Policy v5.1
// Pure policy helpers used by regression tests and debug reasoning.

export const RUNTIME_STATES = Object.freeze({
    REFERENCE_LIBRARY: "REFERENCE_LIBRARY",
    CAMERA_GUIDANCE: "CAMERA_GUIDANCE",
    CAPTURE_COUNTDOWN: "CAPTURE_COUNTDOWN",
    REVIEW: "REVIEW"
});

// Named predicates keep state transitions consistent across output policies.
function isCameraState(state) {
    return state === RUNTIME_STATES.CAMERA_GUIDANCE ||
        state === RUNTIME_STATES.CAPTURE_COUNTDOWN ||
        state === RUNTIME_STATES.REVIEW;
}

function isGuidanceState(state) {
    return state === RUNTIME_STATES.CAMERA_GUIDANCE ||
        state === RUNTIME_STATES.CAPTURE_COUNTDOWN;
}

function isInferencePausedState(state) {
    return state === RUNTIME_STATES.REVIEW ||
        state === RUNTIME_STATES.REFERENCE_LIBRARY;
}

export function deriveRuntimePolicy({
    state,
    hasReference = false,
    streamLive = false,
    inferenceActive = false,
    captureLocked = false,
    reviewLocked = false,
    autoShootArmed = false,
    guidanceEnabled = true
} = {}) {
    const cameraState = isCameraState(state);
    const guidanceState = isGuidanceState(state);

    const cameraOn = Boolean(cameraState && streamLive);
    const poseOn = Boolean(
        guidanceState &&
        hasReference &&
        guidanceEnabled &&
        inferenceActive &&
        !captureLocked
    );
    const voiceOn = Boolean(
        guidanceState &&
        hasReference &&
        guidanceEnabled &&
        !captureLocked
    );
    const autoCaptureAllowed = Boolean(
        state === RUNTIME_STATES.CAPTURE_COUNTDOWN &&
        hasReference &&
        guidanceEnabled &&
        streamLive &&
        !captureLocked &&
        !reviewLocked &&
        autoShootArmed
    );

    return {
        cameraOn,
        poseOn,
        voiceOn,
        autoCaptureAllowed,
        shouldReleaseCamera:
            state === RUNTIME_STATES.REFERENCE_LIBRARY,
        shouldPauseInference: isInferencePausedState(state),
        canReviewAction:
            state === RUNTIME_STATES.REVIEW && !reviewLocked
    };
}
