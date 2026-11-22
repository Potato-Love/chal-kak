# Photo Guide 프로토타입 분석 및 Next.js 이식 가이드

> **참고 구현**: [`Potato-Love/chal-kak` / `feature/jiyun-web-prototype`](https://github.com/Potato-Love/chal-kak/tree/feature/jiyun-web-prototype/web)  
> **확인 커밋**: `f777217128df90e1df384d19907bb66ee20b9a6c` (2026-11-22 확인)  
> 이 문서는 **실제 코드에서 확인한 동작**과 **최종 시스템으로의 이식 판단**을 분리한다. 제품 요구사항의 기준은 [`PROJECT.md`](PROJECT.md)다.
> **중요**: 확인 커밋의 프로토타입은 Camera-first이지만, 최종 찰칵 UX는 **Reference-first**로 변경되었다. 아래의 Camera-first 항목은 **프로토타입의 사실 기록**이며 최종 구현 지침이 아니다.

## 1. 프로토타입에서 확인한 기능

| 분야 | 코드에서 확인된 동작 | 파일 |
|---|---|---|
| Camera-first (프로토타입만) | 확인 커밋은 일반 카메라 자동 시작, Library 선택 후 Guidance 활성화. **최종 제품은 이 시작 동작을 채택하지 않음** | `web/app.js`, `web/index.html` |
| 앱 상태 | `REFERENCE_LIBRARY`, `CAMERA_GUIDANCE`, `CAPTURE_COUNTDOWN`, `REVIEW` 상태 전이, 추론/음성/카메라 해제 | `web/app.js`, `web/runtime_policy_v5_1.js` |
| Reference 추가 | 이미지 검증, Pose 및 World Landmark 추출, 썸네일 생성, IndexedDB 저장·삭제 | `web/reference_validator_v5_2.js`, `web/custom_reference_store_v5_2.js` |
| 실시간 Pose | MediaPipe Pose Landmarker `detectForVideo`, 2D 관절각 및 Segment 방향 매칭 | `web/app.js` |
| 3D 보조 | 신체 로컬 좌표계 기반 비교, 상대 깊이 신호 | `web/live_pose_comparator_v2_1.js` |
| 얼굴·자세 방향 | Face Landmarker 및 Orientation Quality, 신뢰도 낮을 때 Pose 대체 | `web/orientation_quality_v4_6.js`, `web/app.js` |
| Guidance | 행동 후보와 우선순위, 반복·안정화 정책 | `web/guidance_engine_v4_6.js` |
| One Cue/음성 | SpeechSynthesis, 대기열 및 일반/촬영 중요 안내의 중단 정책 | `web/one_cue_controller_v4_6.js` |
| Auto Shoot | 포즈·방향 일치, 움직임·유지 시간, 카운트다운 후 `capturePhoto('auto')` | `web/one_cue_controller_v4_6.js`, `web/app.js` |
| 촬영 후 진단 | 시점의 MatchSnapshot을 기반으로 포즈·구도·얼굴/방향·선명도 평가, 재촬영 안내 | `web/post_capture_diagnosis_v4_7.js` |
| 결과 저장 | Review에서 JPEG를 브라우저로 다운로드하고 카메라로 복귀 | `web/app.js` |
| 회귀 검증 | 자체 검증 모듈의 T01~T39 사례 정의 | `web/guidance_validation_v4_7.js`, `web/validation_v5_1.js`, `web/validation_v5_2.js` |

위 항목은 **코드의 연결 및 구현 존재**를 뜻하며, 실기기 동작·테스트 통과·정확도 검증 완료를 의미하지 않는다.

## 2. 프로토타입과 최종 UX의 변경 사항

| 구분 | 프로토타입 `f777217` | 최종 Reference-first 동작 |
|---|---|---|
| 초기 진입 | 일반 Camera 자동 실행 | `/` Reference Library, 카메라 미실행 |
| Reference 선택 | Camera에서 Library 열기 → 선택 후 Camera 복귀 | Library 첫 화면에서 Reference 선택·검증 → `/camera` **즉시 이동** |
| 권한 요청 | 초기 카메라 시작 단계에서 발생 가능 | Reference 선택 성공 후 Camera 진입 시 요청 |
| Library 복귀 | Camera에서 Library 열기·스트림 해제 | Camera의 Reference 변경/종료로 Library 이동·스트림 해제 |
| 직접 URL | HTML 단일 페이지 내 상태 전이 | `/camera`의 Reference 선택 가드, `/review`의 결과 가드 필요 |
| Review 저장 | JPEG 다운로드 후 Camera 복귀 | 다운로드는 Review 내 별도 동작, 저장 완료 후 종료는 Library 복귀 |
| 재촬영 | 기존 Reference로 Camera 복귀 | 기존 Reference를 유지해 Camera 복귀 |

이 표는 **제품 UX의 변경**이다. `match_policy`, 2D/3D 비교, Guidance Engine, One Cue, Auto Shoot, Post-Capture Diagnosis 등의 알고리즘을 변경해야 한다는 뜻은 아니다. 프로토타입의 `app.js` 초기 상태·카메라 자동 실행 코드를 복제하지 않고 새 라우팅·세션 정책으로 교체한다.

## 3. 핵심 설계에 반영할 알고리즘

### 2D Match와 보조 3D의 책임

- `match_policy_v4_7.js`는 2D 관절각/Segment 및 구도 경계 오차를 기반으로 hard-match와 Review 등급을 정의한다.
- `live_pose_comparator_v2_1.js`는 월드 랜드마크를 신체 로컬 좌표로 정렬해 3D 방향을 비교한다.
- 프로토타입에는 **3D는 조언용이며 2D hard-match를 Review 실패로 바꾸지 않는다**는 정책이 명시되어 있다.
- 정식 설계는 2D hard-match, 보조 3D Guidance, 촬영 후 진단 점수를 서로 구분한다.

### Guidance → One Cue → Auto Shoot

1. `GuidanceEngine`이 인물 상태·구도·포즈·방향 분석에서 수정 행동 후보를 만든다.
2. `OneCueController`가 가장 적절한 한 가지 안내와 반복/음성/유지 시간 정책을 적용한다.
3. 조건이 유지되면 자동 촬영을 예약하고, 상태가 바뀌면 취소한다.
4. 촬영 시 최신 분석 스냅샷을 고정하고 Review 진단으로 전달한다.

프로토타입의 One Cue 설정 예시: 매칭 유지 1,000ms, 촬영 지연 2,000ms, 자동 촬영 간격 8,000ms, 매칭 이탈 유예 450ms, 음성 일반 간격 2,200ms. **이는 프로토타입 상수이며 확정 성능·사용자 설정값은 아니다.**

### Review 판정

- `match_policy_v4_7.js`는 실시간 판정과 Review의 **일치** 정의를 일관되게 사용한다.
- `post_capture_diagnosis_v4_7.js`에는 보조적인 가중 점수/품질 추정도 포함되어 있다.
- 따라서 *0~100 점수 중심의 실시간 촬영 결정*과 *Review 참고 진단 점수*를 혼동해서는 안 된다.

## 4. 프로토타입 코드와 목표 모듈의 대응

| 프로토타입 파일/영역 | 정식 모듈 경계 | 이식 원칙 |
|---|---|---|
| `web/app.js` Camera/State | `app/page.tsx`, `app/camera/page.tsx`, `features/camera`, `features/capture`, `features/reference` | Camera-first 초기 진입 폐기. Reference-first 라우팅·가드·세션 도입 및 직접 DOM/전역 상태 분리 |
| `web/app.js` Pose/Composition 계산 | `features/pose`, `features/composition` | 순수 함수로 추출 후 2D 단위 테스트 |
| `guidance_engine_v4_6.js` | `features/guidance/guidance-engine` | 행동 우선순위와 히스테리시스 로직 보존 |
| `one_cue_controller_v4_6.js` | `features/guidance/one-cue-controller` | 결정 로직과 `speechSynthesis` 실행을 분리 |
| `match_policy_v4_7.js` | `features/matching/match-policy` | 실시간/Review 공통 기준 단일화 |
| `live_pose_comparator_v2_1.js` | `features/pose/body-local-3d-comparator` | 보조 3D 인터페이스로 캡슐화 |
| `orientation_quality_v4_6.js` | `features/orientation` | Face 모델 미사용/미검출 폴백 유지 |
| `reference_validator_v5_2.js` | `features/reference/reference-validator` | 입력 신뢰도·크롭·한 명 검증 순수화 |
| `custom_reference_store_v5_2.js` | `lib/local-storage/reference-repository` | IndexedDB Adapter 분리 |
| `post_capture_diagnosis_v4_7.js` | `features/capture/post-capture-diagnosis` | 스냅샷 기반 순수 진단, 점수는 별도 타입 |
| `validation_v5_*.js` | `tests/unit`, `tests/integration` | 회귀 사례를 Vitest로 이전 |

분석 수식이나 정책은 참고 가능하지만 브라우저 전역 이벤트, 수동으로 생성하는 DOM, CSS 클래스와 판정 조건의 직접 결합은 그대로 복사하지 않는다.

## 5. 소스 코드에서 확인한 불일치·검토 항목

- 포즈/구도/얼굴 및 촬영 설정의 일부 토글은 `aria-pressed`·CSS 상태만 바꾼다. **실제 엔진 활성/비활성 및 자동 촬영 정책 연결을 별도로 검증·구현**해야 한다. 반면 음성 토글은 `voiceUiEnabled`에 연결되어 있다.
- HTML에는 Pose/Composition 도구가 동시에 활성 상태로 표시되지만, 제품 요구사항의 `pose` / `full-composition` 모드 정책과 완전히 동일하다고 가정할 수 없다. 모드별 필수 판정 기준을 코드 계약으로 정한다.
- 프로토타입은 새 세션에서 Camera를 열되 Reference 미리보기 인덱스만 기억한다. **최종 UX는 Camera 자체를 자동 실행하지 않고 Library에서 명시적 선택을 요구한다.**
- 프로토타입의 사용자 Reference는 브라우저 IndexedDB에 있고, 촬영 후 저장은 JPEG 다운로드다. **계정 기반 클라우드 저장과 공유는 별도의 최종 시스템 모듈**이 담당한다.
- 얼굴 모델은 선택적으로 로드하며, 실제 추론 코드에서는 Pose 반복 검출과 별도의 주기로 실행한다. 이 구조의 모바일 성능을 측정한다.
- 프로토타입의 `app.js`는 수천 줄의 조립·판정·출력 코드가 혼재한다. 정식 프로젝트에서는 사용자 흐름과 데이터 계약을 보존하되 모듈 책임을 재구성한다.
- `validation_v5_2.js`에는 회귀 시나리오 **39개**가 정의되어 있다. 이 문서는 실행 성공률을 주장하지 않는다.

## 6. 이식 순서 및 수용 테스트

1. **계약**: `PoseData`, `ReferenceData`, `MatchSnapshot`, `GuidanceAction`, `CaptureResult`의 타입과 단위를 정한다.
2. **순수 알고리즘**: Reference Validator → MatchPolicy → Pose/Composition → 3D/Orientation → Guidance Engine → One Cue → Post-Capture Diagnosis를 테스트와 함께 옮긴다.
3. **브라우저 어댑터**: MediaPipe, CameraStream, Canvas, SpeechSynthesis, IndexedDB를 React UI와 분리해 연결한다.
4. **상태 통합**: Reference-first Library → 명시적 선택·검증 → Camera → Review의 라우트 가드를 구성하고 중복 촬영·잔여 음성·추론 재실행을 방지한다.
5. **저장 통합**: 기기 다운로드와 인증된 사진첩/Reference 저장·공유를 서로 분리해 구현한다.
6. **모바일 E2E**: iOS Safari/Android Chrome에서 카메라·권한·음성·Auto Shoot·Background/Resume·전/후면 전환·발열을 검증한다.

주요 회귀 시나리오: **초기 Library에서 카메라 권한 요청 없음, 검증 성공 후 Camera 자동 전환, 검증 실패 시 Library 유지, 직접 `/camera` 접근 방어, Review 재촬영/저장 후 이동**, 인물 미검출, 낮은 Landmark 신뢰도, 미러 전환, 구도 불일치, 움직임 중 자동 촬영 취소, 카운트다운 중 Library 이동, Review 진입 시 음성 종료, 비활성 탭 복귀, 잘못된 커스텀 Reference 차단, 사진첩 접근 제어.

## 7. 소스 링크

- [프로토타입 웹 코드](https://github.com/Potato-Love/chal-kak/tree/feature/jiyun-web-prototype/web)
- [프로토타입 UI/실행 안내](https://github.com/Potato-Love/chal-kak/blob/feature/jiyun-web-prototype/README.md)
- [Match Policy](https://github.com/Potato-Love/chal-kak/blob/feature/jiyun-web-prototype/web/match_policy_v4_7.js)
- [One Cue Controller](https://github.com/Potato-Love/chal-kak/blob/feature/jiyun-web-prototype/web/one_cue_controller_v4_6.js)
- [Reference Validator](https://github.com/Potato-Love/chal-kak/blob/feature/jiyun-web-prototype/web/reference_validator_v5_2.js)
