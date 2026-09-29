# v064 Real Project Multi-Track Pilot Result

Status: EVIDENCE SNAPSHOT — HEAD DECISION REQUIRED

## Repository
Repository: Potato-Love/chal-kak
Pilot branch: pilot/v064-bootstrap
Remote main was not modified.

## Real project discovery
The repository began with no Git commits but contained local project documents defining the product:
- mobile web
- on-device MediaPipe
- common Landmark interface
- separate Pose Matching / Composition Matching
- Python analysis backend excluded from MVP
- OpenCV excluded unless a demonstrated requirement appears

No application source, tests, dependency manifests, or build commands existed before the pilot.
Frontend framework and JavaScript/TypeScript remain undecided.

The pilot therefore used dependency-free browser-native ES modules and node --test without selecting a final framework.

## Track results

A1 / chal-frontend:
- Assignment: 8ae8b2a5a2f243d56a64a2c143033b2712fa8906
- Candidate: 06b20c5c779e2283b9b2356fb70d7c63b6cb2a7c
- State: WORK_DONE
- Tests: 4/4 PASS
- Scope: camera boundary + static browser shell only

C1 / chal-pose:
- Assignment: 6492ab47677653c968a4364e6f7226898ec5254a
- Candidate: d3130b46765b27399a7ace35625de0e22a1e6590
- State: WORK_DONE
- Tests: 4/4 PASS
- Scope: common Landmark validation + horizontal left/right mirror only

B1 / chal-integration:
- Assignment: e05f4352401ba492c457ffe5629b981cf381d350
- State: BLOCKED
- Worktree: clean at Assignment commit
- Blocker: C1 requires explicit HEAD acceptance before B1 execution

A2 / chal-frontend:
- Assignment: b81e283da97eb98119e1606238c53432bbe6fd5c
- State: READY / not dispatched
- Blocker: A1 and B1 require explicit HEAD acceptance

## Worktree isolation
A1, C1 and B1 used separate Git worktrees and branches.
No two Tracks edited the same worktree.

## Remote durability
The following pilot branches were pushed without modifying main:
- pilot/v064-bootstrap
- pilot/v064-a1-camera
- pilot/v064-c1-landmark
- pilot/v064-b1-pose-pair

## Decision boundary
No automatic acceptance occurred.

A1 and C1 are WORK_DONE but not ACCEPTED.
B1 did not incorrectly advance across the C1 dependency.
A2 was not dispatched.

HEAD must explicitly decide A1/C1 before dependent progression.

## LocalAIControl-first routing
LocalAIControl Gateway was attempted first.
Observed result: tunnel-client did not poll / Gateway unavailable.

The online development machine did not contain a LocalAIControl checkout.
RDC was used as the explicit fallback for repository discovery, Git/worktree operations, file edits, tests, commits, and push.

No RDC use was for privilege escalation.

This is a concrete LocalAIControl availability/placement gap observed by the pilot.

## Observed project friction
- authoritative product docs referenced DEVELOPMENT.md, CONTRIBUTING.md and TEAM_GUIDE.md, but those files do not yet exist
- repository had no committed baseline before v064
- no build/test manifest existed
- framework and JS/TS choice remain deliberately undecided
- LocalAIControl was unavailable on the only online development machine

## Automation boundary
Already solved in the Control Plane design:
- bounded Assignment semantics
- isolated worktree model
- explicit dependency boundary
- candidate commits and tests
- no automatic HEAD acceptance

Manual Chat / environment boundary observed:
- LocalAIControl tunnel availability
- HEAD acceptance needed before B1 can progress

Candidate future automation should be considered only after restoring reliable LocalAIControl access; no scheduler/wake/push feature was added in v064.
