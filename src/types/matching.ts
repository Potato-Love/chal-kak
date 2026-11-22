// Pose와 Composition의 독립적인 비교 결과 및 안내 타입입니다.

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

