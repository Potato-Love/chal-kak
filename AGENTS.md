# Chal-Kak Agent Guide

## Project
Chal-Kak is a mobile web application that helps users follow a pose or composition from a reference photo.

The application is designed to run primarily on the user's smartphone browser.
Do not assume that a Python backend exists.

## Read before working
- Project goals: docs/PROJECT.md
- Architecture: docs/ARCHITECTURE.md
- Development and testing: docs/DEVELOPMENT.md
- Git workflow: docs/CONTRIBUTING.md
- Easy project overview: docs/TEAM_GUIDE.md

## Core architecture
- Mobile Web
- On-device MediaPipe
- Reference Pose
- Live Pose
- Common Landmark Interface
- Pose Normalization
- Pose Matching
- Optional Composition Matching
- Overlay-based visual guidance

## Important distinction
Pose Matching and Composition Matching are different.

Pose Matching compares posture after reducing the effects of screen position, body size and camera distance.
Composition Matching additionally compares screen position, person size and framing.

Do not mix these concepts unless the assigned task explicitly requires it.

## Development rules
- Do not develop directly on main.
- Work within the assigned Issue or task scope.
- Do not modify unrelated files.
- Do not introduce a backend unless the task explicitly requires it.
- Do not introduce OpenCV unless a demonstrated requirement exists.
- Keep Reference Pose and Current Pose interfaces compatible.
- Run or test the changed feature before considering the task complete.
- Update shared documentation when architecture or interfaces change.
- Do not copy temporary chat discussions into project documentation unless they represent an agreed project decision.

## Task management
Development backlog and schedules are managed through GitHub Issues and GitHub Projects.
Do not use this file as the project backlog.
