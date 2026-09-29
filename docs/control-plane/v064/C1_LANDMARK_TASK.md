# v064 Assignment — C1 Common Landmark + Mirror

Project ID: chal-kak
Track ID: chal-pose
Task ID: v064-c1-landmark
Plan: docs/CONTROL_PLANE_PILOT_V064.md

## Goal
Implement the agreed common Landmark representation utilities and left/right mirror semantics without choosing the final normalization or scoring algorithm.

## Allowed files
- src/pose/landmarks.mjs
- tests/landmarks.test.mjs

## Dependencies
None.

## Completion criteria
- validates canonical x/y/visibility fields
- deterministic left/right landmark-name swap
- horizontal mirror transforms x and swaps left/right semantics
- node --test tests/landmarks.test.mjs passes

## Prohibited
No final normalization algorithm, pose scoring/tolerances, MediaPipe package choice, OpenCV, UI, or backend.

## Expected Result
RESULT / WORK_DONE / next_action = HEAD decision
