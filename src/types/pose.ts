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

export type CaptureMode =
  | "pose"
  | "full-composition";

export interface CompositionData {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface PoseMatchResult {
  matched: boolean;
  jointErrors: Record<string, number>;
}

export interface CompositionMatchResult {
  matched: boolean;
  positionError: number;
  sizeError: number;
}

export interface MatchResult {
  pose: PoseMatchResult;
  composition?: CompositionMatchResult;
}

export interface GuidanceCue {
  type: "pose" | "composition";
  target: string;
  message: string;
  priority: number;
}

