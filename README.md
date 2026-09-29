# 찰칵 (Chal-Kak)

찰칵은 사용자가 레퍼런스 인물 사진의 **포즈 또는 사진 전체 구도**를 따라 촬영할 수 있도록 돕는 모바일 웹 기반 촬영 보조 프로젝트입니다.

별도의 앱 설치 없이 스마트폰 웹 브라우저에서 사용하는 것을 기본 방향으로 합니다.

## 사용 모드

### 포즈 따라하기
레퍼런스 사진에서 사람의 자세만 추출해 따라 합니다.
사진 속 사람의 화면 위치와 크기는 기본 포즈 판정에서 제외합니다.

### 사진 전체 따라찍기
포즈에 더해 사람의 화면상 위치, 크기, 여백 등 구도 요소도 함께 비교합니다.

즉, 사진 전체 따라찍기는 **Pose Matching + Composition Matching**으로 구성합니다.

## 기본 기술 방향
- Mobile Web
- On-device MediaPipe
- Smartphone Camera
- JavaScript 또는 TypeScript
- Canvas 등 Web Graphics
- Git / GitHub

핵심 포즈 분석은 스마트폰 브라우저에서 실행합니다.
별도의 Python 분석 서버는 기본 아키텍처에 포함하지 않습니다.
OpenCV 역시 필수 기술이 아니며 필요성이 확인될 경우 OpenCV.js 등을 검토합니다.

## 문서
- docs/PROJECT.md — 프로젝트 목표와 범위
- docs/ARCHITECTURE.md — 시스템 구조
- docs/TEAM_GUIDE.md — 팀원을 위한 쉬운 설명
- docs/DEVELOPMENT.md — 개발 및 테스트 방법
- docs/CONTRIBUTING.md — Git 협업 규칙
- AGENTS.md — AI Coding Agent 기본 지침

## 기본 개발 흐름
GitHub Issue → 작업 Branch → 개발 → 실행/테스트 → Commit → Pull Request → Review → main

특정 AI Coding Agent에 종속하지 않으며, 사람과 Agent 모두 GitHub의 코드와 문서를 공통 기준으로 사용합니다.
