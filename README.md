# Photo Guide

모바일 웹 기반 Reference 사진 촬영 보조 프로토타입입니다.

## 실행

프로젝트 루트에서:

```bash
python -m http.server 8001
```

PC 브라우저:

```text
http://localhost:8001/web/
```

Android USB 디버깅 테스트:

```powershell
cd "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
.\adb devices
.\adb reverse tcp:8001 tcp:8001
```

그 다음 휴대폰 Chrome에서:

```text
http://localhost:8001/web/
```

## UI 원칙

- Camera-first
- Primary theme: `#243450`
- 기본 카메라 화면에는 Reference / 촬영 / 전환만 상시 노출
- 포즈 / 구도 / 얼굴 / 미러는 왼쪽 접이식 도구 메뉴에서 접근
- 음성 Guidance 중심, 촬영 화면 자막 배너는 사용하지 않음
- CSS `!important` 사용 금지
- 인라인 스타일 대신 클래스 기반 상태 변경 사용

## 주요 경로

- `web/index.html`: 화면 구조
- `web/style.css`: 전체 디자인 시스템 및 반응형 스타일
- `web/app.js`: 카메라 / Reference / Guidance / Capture 상태 관리
- `models/`: MediaPipe Pose 모델
- `reference_*.jpg`, `reference_*.json`: 기본 Reference 데이터
