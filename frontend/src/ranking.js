import { normalizeMoney } from "./money";
export function getTaskEstimatedDelta(missionEstimatedAmount, yesterdayEstimatedAmount, hasYesterdayTaskBaseline) {
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
