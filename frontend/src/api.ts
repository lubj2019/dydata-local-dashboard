import type { AccountSummary, AutoSyncStatus, DailyEstimateSummary, TaskVideoRow } from "./types";

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

export function bindTaskVideo(taskId: string, videoId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/task-links/${taskId}/bind`, {
    method: "POST",
    body: JSON.stringify({ videoId })
  });
}
