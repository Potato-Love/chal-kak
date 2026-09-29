function isFiniteUnit(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isCanonicalLandmark(value) {
  return Boolean(
    value
    && typeof value === "object"
    && isFiniteUnit(value.x)
    && isFiniteUnit(value.y)
    && isFiniteUnit(value.visibility),
  );
}

export function assertCanonicalPose(pose) {
  if (!pose || typeof pose !== "object" || Array.isArray(pose)) {
    throw new TypeError("pose must be an object");
  }

  for (const [name, landmark] of Object.entries(pose)) {
    if (!name || !isCanonicalLandmark(landmark)) {
      throw new TypeError(`invalid landmark: ${name || "<empty>"}`);
    }
  }

  return pose;
}

export function swapLeftRightName(name) {
  if (typeof name !== "string" || !name) {
    throw new TypeError("landmark name must be a non-empty string");
  }
  if (name.startsWith("left") && name.length > 4) {
    return `right${name.slice(4)}`;
  }
  if (name.startsWith("right") && name.length > 5) {
    return `left${name.slice(5)}`;
  }
  return name;
}

export function mirrorPoseHorizontally(pose) {
  assertCanonicalPose(pose);

  const mirrored = {};
  for (const [name, landmark] of Object.entries(pose)) {
    mirrored[swapLeftRightName(name)] = {
      x: 1 - landmark.x,
      y: landmark.y,
      visibility: landmark.visibility,
    };
  }

  return mirrored;
}
