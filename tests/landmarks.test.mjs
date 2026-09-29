import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCanonicalPose,
  isCanonicalLandmark,
  mirrorPoseHorizontally,
  swapLeftRightName,
} from "../src/pose/landmarks.mjs";

test("canonical landmark requires finite normalized fields", () => {
  assert.equal(
    isCanonicalLandmark({ x: 0.25, y: 0.5, visibility: 0.9 }),
    true,
  );
  assert.equal(
    isCanonicalLandmark({ x: -0.1, y: 0.5, visibility: 0.9 }),
    false,
  );
  assert.equal(
    isCanonicalLandmark({ x: 0.2, y: 0.5 }),
    false,
  );
});

test("left and right landmark names swap deterministically", () => {
  assert.equal(swapLeftRightName("leftWrist"), "rightWrist");
  assert.equal(swapLeftRightName("rightElbow"), "leftElbow");
  assert.equal(swapLeftRightName("nose"), "nose");
});

test("mirror flips x and swaps left/right semantic names", () => {
  const mirrored = mirrorPoseHorizontally({
    leftWrist: { x: 0.2, y: 0.4, visibility: 0.9 },
    rightWrist: { x: 0.8, y: 0.45, visibility: 0.85 },
    nose: { x: 0.55, y: 0.1, visibility: 1 },
  });

  assert.deepEqual(mirrored, {
    rightWrist: { x: 0.8, y: 0.4, visibility: 0.9 },
    leftWrist: { x: 0.19999999999999996, y: 0.45, visibility: 0.85 },
    nose: { x: 0.44999999999999996, y: 0.1, visibility: 1 },
  });
});

test("invalid pose fails closed", () => {
  assert.throws(
    () => assertCanonicalPose({
      leftWrist: { x: 0.2, y: 1.2, visibility: 0.9 },
    }),
    /invalid landmark: leftWrist/,
  );
});
