export function buildCameraConstraints({
  facingMode = "environment",
  width = 1280,
  height = 720,
} = {}) {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: width },
      height: { ideal: height },
    },
  };
}

export async function startCamera(
  videoElement,
  {
    mediaDevices = globalThis.navigator?.mediaDevices,
    constraints = buildCameraConstraints(),
  } = {},
) {
  if (!videoElement || typeof videoElement !== "object") {
    throw new TypeError("videoElement is required");
  }
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
    throw new Error("getUserMedia is unavailable");
  }

  const stream = await mediaDevices.getUserMedia(constraints);
  videoElement.srcObject = stream;

  if (typeof videoElement.play === "function") {
    await videoElement.play();
  }

  return stream;
}

export function stopCamera(videoElement) {
  const stream = videoElement?.srcObject;
  if (!stream || typeof stream.getTracks !== "function") {
    return false;
  }

  for (const track of stream.getTracks()) {
    if (track && typeof track.stop === "function") {
      track.stop();
    }
  }
  videoElement.srcObject = null;
  return true;
}
