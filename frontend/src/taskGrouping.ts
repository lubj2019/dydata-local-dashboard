import type { TaskVideoRow } from "./types";

export type TaskGroupRow = {
  groupId: string;
  task: TaskVideoRow;
  videos: TaskVideoRow[];
  taskEstimate: number | null;
  yesterdayTaskPredictedAmount: number | null;
  todayPredictedDelta: number | null;
  xingtuPlayCount: number | null;
  actualPlayCount: number | null;
  playDelta: number | null;
  settledAmount: number | null;
};

function firstValue(values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null) ?? null;
}

function sumValues(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

export function groupTaskRows(rows: TaskVideoRow[]): TaskGroupRow[] {
  const grouped = new Map<string, TaskVideoRow[]>();

  for (const row of rows) {
    const groupId = JSON.stringify([row.accountId, row.missionId]);
    const items = grouped.get(groupId) ?? [];
    items.push(row);
    grouped.set(groupId, items);
  }

  return [...grouped.entries()].map(([groupId, items]) => {
    const task = items[0]!;
    return {
      groupId,
      task,
      videos: items.filter((item) => item.videoId),
      taskEstimate: firstValue(items.map((item) => item.missionEstimatedAmount)) ?? firstValue(items.map((item) => item.predictedAmount)),
      yesterdayTaskPredictedAmount: firstValue(items.map((item) => item.yesterdayTaskPredictedAmount)),
      todayPredictedDelta: sumValues(items.map((item) => item.todayPredictedDelta)),
      xingtuPlayCount: sumValues(items.map((item) => item.xingtuPlayCount)),
      actualPlayCount: sumValues(items.map((item) => item.actualPlayCount)),
      playDelta: sumValues(items.map((item) => item.playDelta)),
      settledAmount: sumValues(items.map((item) => item.settledAmount))
    };
  });
}
