import type { MatchSource, VideoRecord, XingtuTaskRecord } from "./types.js";

export type TaskMatch = {
  taskId: string;
  videoId: string;
  matchSource: MatchSource;
};

function normalizeTitle(input: string | null | undefined): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function extractStableId(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const match = input.match(/(?:video|item|aweme)[/_=-]?([0-9]{6,})/i);
  return match?.[1] ?? null;
}

export function autoMatchTasksToVideos(tasks: XingtuTaskRecord[], videos: VideoRecord[]): TaskMatch[] {
  const matches: TaskMatch[] = [];
  const remainingVideos = new Map(videos.map((video) => [video.id, video]));

  for (const task of tasks) {
    const taskStableId = extractStableId(task.sourceUrl);
    const idMatchedVideo = taskStableId
      ? [...remainingVideos.values()].find((video) => {
          return video.id === taskStableId || extractStableId(video.sourceUrl) === taskStableId;
        })
      : null;

    if (idMatchedVideo) {
      matches.push({ taskId: task.id, videoId: idMatchedVideo.id, matchSource: "auto" });
      remainingVideos.delete(idMatchedVideo.id);
      continue;
    }

    const taskTitle = normalizeTitle(task.videoTitle ?? task.taskName);
    const taskPublishedAt = parseTimestamp(task.publishedAt);

    let bestVideo: VideoRecord | null = null;
    let bestScore = -1;

    for (const video of remainingVideos.values()) {
      const videoTitle = normalizeTitle(video.title);
      if (!taskTitle || !videoTitle) {
        continue;
      }

      let score = 0;
      if (taskTitle === videoTitle) {
        score += 5;
      } else if (taskTitle.includes(videoTitle) || videoTitle.includes(taskTitle)) {
        score += 3;
      } else {
        continue;
      }

      const videoPublishedAt = parseTimestamp(video.publishedAt);
      if (taskPublishedAt !== null && videoPublishedAt !== null) {
        const hours = Math.abs(taskPublishedAt - videoPublishedAt) / (1000 * 60 * 60);
        if (hours <= 72) {
          score += 2;
        } else if (hours > 168) {
          score = -1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestVideo = video;
      }
    }

    if (bestVideo && bestScore >= 3) {
      matches.push({ taskId: task.id, videoId: bestVideo.id, matchSource: "auto" });
      remainingVideos.delete(bestVideo.id);
    }
  }

  return matches;
}
