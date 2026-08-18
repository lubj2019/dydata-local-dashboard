async function request(input, init) {
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
    return response.json();
}
export function getAccounts() {
    return request("/api/accounts");
}
export function createAccount(displayName) {
    return request("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ displayName })
    });
}
export function launchLogin(accountId) {
    return request(`/api/accounts/${accountId}/login`, {
        method: "POST",
        body: "{}"
    });
}
export function syncAccount(accountId) {
    return request(`/api/accounts/${accountId}/sync`, {
        method: "POST",
        body: "{}"
    });
}
export function deleteAccount(accountId) {
    return request(`/api/accounts/${accountId}`, {
        method: "DELETE"
    });
}
export function getAutoSyncStatus() {
    return request("/api/sync-status");
}
export function getDailyEstimateSummary() {
    return request("/api/daily-estimate-summary");
}
export function getDashboardSummary() {
    return request("/api/v2/dashboard/summary");
}
export function getDashboardTrend(options = {}) {
    const params = new URLSearchParams();
    if (options.days !== undefined)
        params.set("days", String(options.days));
    if (options.from)
        params.set("from", options.from);
    if (options.to)
        params.set("to", options.to);
    const query = params.toString();
    return request(`/api/v2/dashboard/trend${query ? `?${query}` : ""}`);
}
export function createV2Account(displayName) {
    return request("/api/v2/accounts", { method: "POST", body: JSON.stringify({ displayName }) });
}
export function launchV2Login(accountId) {
    return request(`/api/v2/accounts/${accountId}/login`, { method: "POST", body: "{}" });
}
export function syncV2Account(accountId) {
    return request(`/api/v2/accounts/${accountId}/sync`, { method: "POST", body: "{}" });
}
export function archiveV2Account(accountId) {
    return request(`/api/v2/accounts/${accountId}/archive`, { method: "PATCH" });
}
export function runV2Sync() {
    return request("/api/v2/sync/run-all", { method: "POST", body: "{}" });
}
export function runAllSync() {
    return request("/api/sync/run-all", {
        method: "POST",
        body: "{}"
    });
}
export function getTaskVideos(filters) {
    const params = new URLSearchParams();
    if (filters.accountId) {
        params.set("accountId", filters.accountId);
    }
    if (filters.status) {
        params.set("status", filters.status);
    }
    const query = params.toString();
    return request(`/api/task-videos${query ? `?${query}` : ""}`);
}
export function getV2Tasks(filters = {}) {
    const params = new URLSearchParams();
    if (filters.accountId) {
        params.set("accountId", filters.accountId);
    }
    if (filters.status) {
        params.set("status", filters.status);
    }
    const query = params.toString();
    return request(`/api/v2/tasks${query ? `?${query}` : ""}`);
}
export function getV2Videos() {
    return request("/api/v2/videos");
}
export function bindV2TaskVideo(taskId, videoId) {
    return request(`/api/v2/tasks/${taskId}/video-link`, {
        method: "POST",
        body: JSON.stringify({ videoId })
    });
}
export function getTaskPlayGrowth(page) {
    return request(`/api/task-play-growth?page=${page}`);
}
export function bindTaskVideo(taskId, videoId) {
    return request(`/api/task-links/${taskId}/bind`, {
        method: "POST",
        body: JSON.stringify({ videoId })
    });
}
