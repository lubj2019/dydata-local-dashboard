import type { TaskStatus, VideoStatus } from "./types.js";

const videoStatusMap: Array<[VideoStatus, RegExp]> = [
  ["deleted", /(删除|已删除|下架)/],
  ["private", /(私密|仅自己可见)/],
  ["rejected", /(驳回|拒绝|未通过|审核失败)/],
  ["reviewing", /(审核中|待审核)/],
  ["published", /(发布成功|已发布|公开|审核通过|流量减少)/]
];

const taskStatusMap: Array<[TaskStatus, RegExp]> = [
  ["abnormal", /(异常|违规|失败)/],
  ["paused", /(暂停|终止|取消)/],
  ["completed", /(完成|已结算|已发放)/],
  ["settling", /(结算中|待结算|待发放)/],
  ["in_progress", /(进行中|执行中|审核通过|投稿中|招募中)/]
];

export function normalizeVideoStatus(input: string | null | undefined): VideoStatus {
  if (!input) {
    return "unknown";
  }

  for (const [status, pattern] of videoStatusMap) {
    if (pattern.test(input)) {
      return status;
    }
  }

  return "unknown";
}

export function normalizeTaskStatus(input: string | null | undefined): TaskStatus {
  if (!input) {
    return "unknown";
  }

  for (const [status, pattern] of taskStatusMap) {
    if (pattern.test(input)) {
      return status;
    }
  }

  return "unknown";
}
