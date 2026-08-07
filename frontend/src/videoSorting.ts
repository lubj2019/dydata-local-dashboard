import type { TaskVideoRow } from "./types";

export type VideoSortKey = "publishedAt" | "actualPlayCount" | "playDelta";
export type VideoSortDirection = "asc" | "desc";
export type VideoSort = { key: VideoSortKey; direction: VideoSortDirection };

function getSortValue(row: TaskVideoRow, key: VideoSortKey): number | null {
  if (key === "publishedAt") {
    if (!row.publishedAt) return null;
    const value = Date.parse(row.publishedAt);
    return Number.isNaN(value) ? null : value;
  }

  return row[key];
}

export function nextVideoSort(current: VideoSort | null, key: VideoSortKey): VideoSort {
  return current?.key === key && current.direction === "desc"
    ? { key, direction: "asc" }
    : { key, direction: "desc" };
}

export function sortVideoRows(rows: TaskVideoRow[], sort: VideoSort | null): TaskVideoRow[] {
  if (!sort) return rows;

  const multiplier = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = getSortValue(left, sort.key);
    const rightValue = getSortValue(right, sort.key);
    if (leftValue === null) return rightValue === null ? 0 : 1;
    if (rightValue === null) return -1;
    return (leftValue - rightValue) * multiplier;
  });
}
