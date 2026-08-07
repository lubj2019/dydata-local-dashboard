import type { AccountSummary, AutoSyncStatus, DashboardSummary, DashboardTrend, DailyEstimateSummary, TaskPlayGrowthPage, TaskVideoRow } from "./types";

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    headers,
    ...init
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getAccounts(): Promise<AccountSummary[]> {
  return request<AccountSummary[]>("/api/accounts");
}

export function createAccount(displayName: string): Promise<AccountSummary> {
  return request<AccountSummary>("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ displayName })
  });
}

export function launchLogin(accountId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/accounts/${accountId}/login`, {
    method: "POST",
    body: "{}"
  });
}

export function syncAccount(accountId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/accounts/${accountId}/sync`, {
    method: "POST",
    body: "{}"
  });
}

export function deleteAccount(accountId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/accounts/${accountId}`, {
    method: "DELETE"
  });
}

export function getAutoSyncStatus(): Promise<AutoSyncStatus> {
  return request<AutoSyncStatus>("/api/sync-status");
}

export function getDailyEstimateSummary(): Promise<DailyEstimateSummary> {
  return request<DailyEstimateSummary>("/api/daily-estimate-summary");
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return request<DashboardSummary>("/api/v2/dashboard/summary");
}

export function getDashboardTrend(options: { days?: number; from?: string; to?: string } = {}): Promise<DashboardTrend> {
  const params = new URLSearchParams();
  if (options.days !== undefined) params.set("days", String(options.days));
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const query = params.toString();
  return request<DashboardTrend>(`/api/v2/dashboard/trend${query ? `?${query}` : ""}`);
}

export function createV2Account(displayName: string): Promise<AccountSummary> {
  return request<AccountSummary>("/api/v2/accounts", { method: "POST", body: JSON.stringify({ displayName }) });
}

export function launchV2Login(accountId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v2/accounts/${accountId}/login`, { method: "POST", body: "{}" });
}

export function syncV2Account(accountId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v2/accounts/${accountId}/sync`, { method: "POST", body: "{}" });
}

export function archiveV2Account(accountId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v2/accounts/${accountId}/archive`, { method: "PATCH" });
}

export function runV2Sync(): Promise<{ status: string }> {
  return request<{ status: string }>("/api/v2/sync/run-all", { method: "POST", body: "{}" });
}

export function runAllSync(): Promise<{ status: "started" | "queued" }> {
  return request<{ status: "started" | "queued" }>("/api/sync/run-all", {
    method: "POST",
    body: "{}"
  });
}

export function getTaskVideos(filters: {
  accountId?: string;
  status?: string;
}): Promise<TaskVideoRow[]> {
  const params = new URLSearchParams();
  if (filters.accountId) {
    params.set("accountId", filters.accountId);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }

  const query = params.toString();
  return request<TaskVideoRow[]>(`/api/task-videos${query ? `?${query}` : ""}`);
}

export function getV2Tasks(filters: { accountId?: string; status?: string } = {}): Promise<TaskVideoRow[]> {
  const params = new URLSearchParams();
  if (filters.accountId) {
    params.set("accountId", filters.accountId);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  const query = params.toString();
  return request<TaskVideoRow[]>(`/api/v2/tasks${query ? `?${query}` : ""}`);
}

export function bindV2TaskVideo(taskId: string, videoId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v2/tasks/${taskId}/video-link`, {
    method: "POST",
    body: JSON.stringify({ videoId })
  });
}

export function getTaskPlayGrowth(page: number): Promise<TaskPlayGrowthPage> {
  return request<TaskPlayGrowthPage>(`/api/task-play-growth?page=${page}`);
}

export function bindTaskVideo(taskId: string, videoId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/task-links/${taskId}/bind`, {
    method: "POST",
    body: JSON.stringify({ videoId })
  });
}
