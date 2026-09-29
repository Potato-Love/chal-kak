# v064 Assignment — A2 Pose Readiness UI Integration

Project: chal-kak
Track: chal-frontend
Task: v064-a2-readiness-ui
Plan: docs/CONTROL_PLANE_PILOT_V064.md

## Goal
Consume the accepted B1 integration output in the browser shell to expose a minimal pose-input readiness state.

## Allowed files
- src/ui/pose-readiness.mjs
- web/index.html
- tests/pose-readiness.test.mjs

## Dependencies
- v064-a1-camera-ui explicitly accepted by HEAD
- v064-b1-pose-pair explicitly accepted by HEAD

## Completion criteria
- maps integration readiness to a small UI state
- no pose score/tolerance/color product decision
- node --test tests/pose-readiness.test.mjs passes

## Prohibited
No final overlay design, MediaPipe initialization, composition matching, or unrelated files.

## Expected Result
READY but not dispatched until both dependencies are explicitly accepted.
