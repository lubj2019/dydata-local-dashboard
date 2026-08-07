import { normalizeMoney } from "./money";

export function getTaskEstimatedDelta(
  missionEstimatedAmount: number | null,
  yesterdayEstimatedAmount: number | null,
  hasYesterdayTaskBaseline: boolean
): number | null {
  if (missionEstimatedAmount === null) {
    return null;
  }
  if (!hasYesterdayTaskBaseline) {
    return normalizeMoney(missionEstimatedAmount);
  }
  if (yesterdayEstimatedAmount === null) {
    return null;
  }

  return normalizeMoney(missionEstimatedAmount - yesterdayEstimatedAmount);
}
