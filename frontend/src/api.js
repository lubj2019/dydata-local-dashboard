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
export function bindTaskVideo(taskId, videoId) {
    return request(`/api/task-links/${taskId}/bind`, {
        method: "POST",
        body: JSON.stringify({ videoId })
    });
}
