# 찰칵 시스템 아키텍처 v0.1

## 1. 기본 구조
찰칵의 핵심 기능은 스마트폰 브라우저에서 직접 실행한다.

Reference Image → MediaPipe → Reference Pose
Live Camera → MediaPipe → Current Pose

두 결과는 Pose Processing으로 들어가며 이후 다음과 같이 분리한다.

- Pose Matching
- Composition Matching (사진 전체 따라찍기 모드에서만 사용)

최종 결과는 Guide UI에 전달한다.

## 2. Reference Pose
사용자가 입력한 정적인 레퍼런스 이미지를 MediaPipe로 분석한다.

이미지가 변경되지 않는 동안 분석 결과는 재사용할 수 있다.

## 3. Live Pose
스마트폰 카메라 영상에서 현재 사용자의 Pose Landmark를 반복적으로 검출한다.

모든 Camera Frame을 반드시 분석할 필요는 없다.
실제 모바일 성능 테스트 후 분석 주기와 입력 해상도를 결정한다.

## 4. 공통 Landmark Interface
Reference Pose와 Current Pose는 동일한 데이터 구조를 사용한다.

예시:

    {
      leftShoulder: {
        x: 0.42,
        y: 0.31,
        visibility: 0.98
      }
    }

MediaPipe 원본 데이터에 프로젝트 전체가 직접 의존하지 않도록 공통 변환 계층을 두는 것을 목표로 한다.

## 5. Pose Normalization
포즈 따라하기 모드에서는 사진 속 원래 화면 위치를 그대로 비교하지 않는다.

다음 차이의 영향을 줄이도록 Pose를 변환한다.
- 화면 위치
- 사람 크기
- 카메라 거리
- 키와 체형

방법 후보:
- 신체 중심을 기준으로 좌표 이동
- 어깨 너비 또는 몸통 길이를 기준으로 크기 정규화
- 상대 좌표 사용
- 필요 시 관절 각도 사용

정확한 방법은 실제 테스트 후 결정한다.

## 6. Pose Matching
Normalized Reference Pose와 Normalized Current Pose를 비교한다.

초기 구현에서는 주요 Landmark 간 거리와 허용 범위를 사용할 수 있다.
필요한 경우 관절 각도 비교를 추가한다.

완전히 동일한 자세를 요구하지 않고 허용 오차를 둔다.

## 7. Pose Overlay
사용자 화면에는 목표 Pose와 현재 Pose를 함께 표시한다.

포즈 따라하기 모드에서는 Reference Pose를 현재 사용자의 위치와 크기에 맞게 변환하여 보여줄 수 있다.

따라서 원래 레퍼런스 사진에서 인물이 어디에 있었는지는 기본 Pose Match에 영향을 주지 않는다.

## 8. Composition Matching
사진 전체 따라찍기 모드에서만 원본 화면 정보를 추가로 비교한다.

후보 데이터:
- 인물 중심
- Bounding Box
- 화면에서 차지하는 크기
- 좌우 및 상하 여백

Pose Matching과 Composition Matching은 별도의 모듈로 유지한다.

## 9. Match State
초기 UI는 다음과 같은 상태를 사용할 수 있다.

Far → Near → Matched

실제 색상과 허용 범위는 구현 과정에서 결정한다.

## 10. 좌우 반전
좌우 반전 시 이미지 표시뿐 아니라 Landmark 의미도 함께 교환한다.

예:
- leftWrist ↔ rightWrist
- leftElbow ↔ rightElbow
- leftShoulder ↔ rightShoulder

## 11. 실행 위치
핵심 처리 위치는 스마트폰이다.

- Browser
- Camera
- MediaPipe
- Landmark Processing
- Pose Matching
- Optional Composition Matching
- Guide Rendering

카메라 분석용 Python 서버는 사용하지 않는다.

## 12. Web Hosting
웹 호스팅은 HTML, CSS, JavaScript 등의 애플리케이션 파일을 제공한다.

사용자의 카메라 영상을 분석하기 위한 서버는 아니다.

## 13. 예상 모듈
- Camera / UI
- Reference Pose
- Live Pose
- Pose Processing
- Pose Matching
- Composition Matching
- Guide / Overlay

실제 디렉터리 구조는 Frontend Framework를 선택한 뒤 확정한다.
