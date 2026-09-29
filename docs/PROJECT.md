# 찰칵 프로젝트 정의 v0.1

## 1. 프로젝트 목표
찰칵은 사용자가 레퍼런스 인물 사진을 보고 원하는 **자세 또는 사진 전체 구도**를 보다 쉽게 따라 촬영할 수 있도록 돕는 모바일 웹 서비스이다.

별도의 모바일 앱 설치 없이 스마트폰 웹 브라우저에서 사용하는 것을 기본 방향으로 한다.

## 2. 두 가지 사용 모드

### 포즈 따라하기
레퍼런스 사진 속 사람의 자세를 따라 한다.

주요 비교 대상 후보:
- 팔과 다리 방향
- 관절의 상대적 위치
- 몸통 방향
- 주요 관절 각도

사진 속 인물의 절대적인 화면 위치와 크기는 기본 판정에서 제외한다.

### 사진 전체 따라찍기
포즈에 더해 레퍼런스의 구도까지 따라 한다.

추가 비교 대상 후보:
- 인물의 화면상 위치
- 화면에서 차지하는 크기
- 좌우 및 상하 여백
- 전체 프레이밍

사진 전체 따라찍기 = Pose Matching + Composition Matching

## 3. 기본 사용자 흐름
1. 사용자가 스마트폰으로 찰칵 웹사이트에 접속한다.
2. 레퍼런스 사진을 선택한다.
3. 포즈 따라하기 또는 사진 전체 따라찍기 모드를 선택한다.
4. MediaPipe가 레퍼런스 인물의 Pose Landmark를 추출한다.
5. 스마트폰 카메라를 실행한다.
6. MediaPipe가 현재 사용자의 Pose Landmark를 실시간으로 추출한다.
7. 선택한 모드에 맞게 두 Pose를 비교한다.
8. 화면에 레퍼런스 기준점과 현재 사용자의 포인트를 표시한다.
9. 사용자가 자세를 조절하면 Match 상태가 변한다.
10. 허용 범위 안에 들어온 포인트는 초록색 등의 상태로 표시한다.

## 4. 기본 가이드 방식
초기 버전에서는 긴 텍스트 설명보다 시각적인 Overlay를 중심으로 한다.

개념적으로 다음 상태를 사용한다.
- 불일치
- 접근
- 일치

정확한 색상과 기준값은 구현 과정에서 결정한다.

## 5. 좌우 반전
레퍼런스의 반대 방향 자세를 따라 하고 싶은 경우를 위해 좌우 반전을 지원한다.

화면만 뒤집는 것이 아니라 Landmark의 Left / Right 관계도 함께 처리해야 한다.

## 6. 기술 방향
기본 구조는 **Mobile Web + On-device Processing**이다.

주요 후보 기술:
- HTML / CSS
- JavaScript 또는 TypeScript
- Browser Camera API
- MediaPipe Pose Landmarker
- Canvas 등 Web Graphics
- Git / GitHub

Python 분석 Backend는 현재 기본 구조에서 제외한다.
OpenCV는 필요성이 확인될 경우에만 추가 검토한다.

## 7. MVP
가장 먼저 완성할 대상은 **포즈 따라하기 모드**이다.

MVP 후보 기능:
- 모바일 웹 실행
- 레퍼런스 이미지 입력
- Reference Pose 검출
- 스마트폰 카메라 실행
- Live Pose 검출
- 공통 Landmark 데이터 변환
- Pose Normalization
- Pose Matching
- Overlay
- Match 상태 표시
- 좌우 반전

Composition Matching과 사진 전체 따라찍기는 다음 단계로 개발한다.

## 8. 현재 MVP 범위에서 제외
- Python 분석 서버
- 데이터베이스
- 회원가입
- 클라우드 사진 저장
- 네이티브 Android/iOS 앱
- 단체 사진
- 전문적인 사진 미학 평가

## 9. 아직 결정하지 않은 사항
- Frontend Framework
- JavaScript / TypeScript 선택
- 비교할 Landmark 범위
- Pose 중심 기준
- 크기 정규화 방법
- 관절별 허용 범위
- Pose Match 계산 방식
- Composition Match 계산 방식
- 분석 FPS
- 카메라 해상도
- iPhone Safari 지원 범위
