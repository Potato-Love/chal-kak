import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCameraConstraints,
  startCamera,
  stopCamera,
} from "../src/camera/camera.mjs";

test("buildCameraConstraints is deterministic", () => {
  assert.deepEqual(buildCameraConstraints(), {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
});

test("startCamera uses injected mediaDevices and attaches the stream", async () => {
  const calls = [];
  const stream = { id: "pilot-stream" };
  const mediaDevices = {
    async getUserMedia(constraints) {
      calls.push(constraints);
      return stream;
    },
  };
  let playCalls = 0;
  const video = {
    srcObject: null,
    async play() {
      playCalls += 1;
    },
  };

  const returned = await startCamera(video, { mediaDevices });

  assert.equal(returned, stream);
  assert.equal(video.srcObject, stream);
  assert.equal(playCalls, 1);
  assert.deepEqual(calls, [buildCameraConstraints()]);
});

test("startCamera fails closed when getUserMedia is unavailable", async () => {
  await assert.rejects(
    () => startCamera({}, { mediaDevices: null }),
    /getUserMedia is unavailable/,
  );
});

test("stopCamera stops tracks and clears the video source", () => {
  let stops = 0;
  const video = {
    srcObject: {
      getTracks() {
        return [
          { stop() { stops += 1; } },
          { stop() { stops += 1; } },
        ];
      },
    },
  };

  assert.equal(stopCamera(video), true);
  assert.equal(stops, 2);
  assert.equal(video.srcObject, null);
});
