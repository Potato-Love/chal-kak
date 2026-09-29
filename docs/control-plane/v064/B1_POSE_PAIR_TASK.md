# v064 Assignment — B1 Pose Pair Integration Validator

Project: chal-kak
Track: chal-integration
Task: v064-b1-pose-pair
Plan: docs/CONTROL_PLANE_PILOT_V064.md

## Goal
Consume the accepted C1 common Landmark interface to validate Reference Pose and Current Pose structural compatibility before future normalization/matching.

## Allowed files
- src/integration/pose-pair.mjs
- tests/pose-pair.test.mjs

## Dependencies
- v064-c1-landmark must be explicitly accepted by HEAD.

## Completion criteria
- imports C1 common interface utilities
- identifies shared valid landmarks
- fails closed on malformed pose input
- does not invent match scoring
- node --test tests/pose-pair.test.mjs passes

## Prohibited
No Python backend, normalization choice, match scoring, UI change, or modification of C1 files.

## Expected Result
BLOCKED until C1 explicit HEAD acceptance; then RESULT / WORK_DONE after execution.
