// Reference Pose와 Current Pose가 함께 사용할 타입을 정의할 위치입니다.
// 공통 Landmark 인터페이스가 확정되면 이 모듈에서 내보냅니다.

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseData {
  landmarks: Landmark[];
  timestamp?: number;
}

export interface CompositionData {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

// 기존 import 경로와의 호환성을 유지합니다. 새 코드는 역할별 모듈을 사용합니다.
export type { CaptureMode } from "./capture";
export type {
  PoseMatchResult,
  CompositionMatchResult,
  MatchResult,
  GuidanceCue,
} from "./matching";
