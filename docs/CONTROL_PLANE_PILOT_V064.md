# Real Project Multi-Track Development Pilot v064

Status: FROZEN PILOT PLAN
Repository: Potato-Love/chal-kak
Pilot branch: pilot/v064-bootstrap
Baseline commit: a81a8e77ad61ab6889f6a8f81777e8345dace8f8

## Current-state snapshot

The repository has no prior commits on remote main. The existing local project state consists of:
- README.md
- AGENTS.md
- docs/PROJECT.md
- docs/ARCHITECTURE.md

No application source files, dependency manifests, build scripts, or tests exist yet.

The current project architecture is Mobile Web + on-device processing.
Python analysis backend is explicitly out of the MVP.
OpenCV is not part of the initial implementation unless a demonstrated need appears.
Frontend framework and JavaScript/TypeScript choice are still undecided.

For this pilot only, implementation remains framework-neutral and dependency-free:
- browser-native ES modules
- HTML/CSS
- node --test for pure JavaScript tests
- no npm dependency installation

This does not select the final frontend framework.

## Track map

### Track A — Camera / Browser UI
Owns browser camera entry points and user-facing shell.
Does not own pose processing algorithms.

### Track B — Web App Integration / Shared Pose Contract
Owns composition of Reference/Current pose data into application-ready integration boundaries.
Does not create a Python backend.

### Track C — MediaPipe / Pose Processing
Owns the common Landmark interface and deterministic pose-processing primitives.
Does not choose the final MediaPipe package/runtime in this pilot.

HEAD retains priority, dependency, acceptance, and next-Assignment authority.

## Pilot backlog

### A1 — Browser Camera Boundary
Owner: Track A
Goal: add a minimal browser camera module and static page shell without selecting a framework.
Allowed scope:
- src/camera/camera.mjs
- web/index.html
- web/styles.css
- tests/camera.test.mjs
Dependencies: none
Completion:
- camera constraints are deterministic
- getUserMedia boundary can be injected/mocked
- stream attaches to a provided video element
- tests pass with node --test
Prohibited:
- MediaPipe
- pose matching
- backend/API
- framework installation
Expected Result: RESULT / WORK_DONE

### C1 — Common Landmark + Mirror
Owner: Track C
Goal: implement the agreed common Landmark representation utilities and left/right mirror semantics.
Allowed scope:
- src/pose/landmarks.mjs
- tests/landmarks.test.mjs
Dependencies: none
Completion:
- canonical landmark objects validate x/y/visibility
- deterministic left/right name swap
- horizontal mirror transforms x and swaps left/right semantics
- tests pass with node --test
Prohibited:
- final normalization algorithm
- pose score/tolerance design
- MediaPipe package choice
- OpenCV
Expected Result: RESULT / WORK_DONE

### B1 — Pose Pair Integration Validator
Owner: Track B
Goal: consume the C1 common Landmark interface to verify that Reference Pose and Current Pose are structurally compatible before future normalization/matching.
Allowed scope:
- src/integration/pose-pair.mjs
- tests/pose-pair.test.mjs
Dependencies:
- C1 accepted by HEAD
Completion:
- imports C1 common interface utilities
- identifies shared valid landmarks
- fails closed on malformed pose input
- does not invent a match score
- tests pass with node --test
Prohibited:
- Python backend
- normalization choice
- match scoring
- UI changes
Expected Result: initially BLOCKED until C1 HEAD decision

### A2 — Pose Readiness UI Integration
Owner: Track A
Goal: consume the B1 integration output in the browser shell to show pose-input readiness without defining final visual guidance.
Allowed scope:
- src/ui/pose-readiness.mjs
- web/index.html
- tests/pose-readiness.test.mjs
Dependencies:
- A1 accepted by HEAD
- B1 accepted by HEAD
Completion:
- maps integration readiness to a small UI state
- no pose score or color/tolerance product decision
- tests pass with node --test
Prohibited:
- final overlay design
- MediaPipe initialization
- composition matching
Expected Result: READY but not dispatched during the first pilot unless dependencies are explicitly accepted.

## Dependency graph

A1 -> A2
C1 -> B1 -> A2

A1 and C1 may run independently in separate worktrees.
B1 may hold a committed Assignment but must remain BLOCKED until C1 receives explicit HEAD acceptance.
A2 is not dispatched before A1 and B1 are both explicitly accepted.

## Pilot execution boundary

The pilot will execute real code on A1 and C1.
B1 will demonstrate dependency-blocked state.
No automatic HEAD acceptance is permitted.
The pilot stops at a HEAD decision point with A1/C1 real Results and B1 still blocked unless HEAD explicitly authorizes dependency progression.

## Tool routing

LocalAIControl was attempted first but the Gateway returned that the tunnel client was not polling.
The online development machine does not contain a LocalAIControl checkout.
RDC is therefore the explicit fallback for this pilot's filesystem/Git/command operations.

Observed LocalAIControl gap:
- gateway unavailable from the current online machine/session
- no local LocalAIControl checkout on the online development machine

This is recorded as a concrete availability/placement gap, not a reason to redesign LocalAIControl during v064.
