import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { archiveV2Account, bindV2TaskVideo, createV2Account, getAccounts, getAutoSyncStatus, getDashboardSummary, getV2Tasks, launchV2Login, runV2Sync, syncV2Account } from "../api";
import { LoginStatusBadge, StatusBadge } from "./StatusBadge";
import { formatDateTime, formatMoney, formatNumber, formatSignedMoney, getShanghaiDate } from "./format";
import "./v1.css";
const navigation = [
    { id: "dashboard", label: "总览" },
    { id: "accounts", label: "账号" },
    { id: "tasks", label: "任务" },
    { id: "videos", label: "视频" },
    { id: "analytics", label: "历史分析" }
];
const pageTitles = {
    dashboard: "每日经营总览",
    accounts: "账号运营",
    tasks: "任务分析",
    videos: "视频明细",
    analytics: "历史分析"
};
function getTaskEstimate(row) {
    return row.missionEstimatedAmount ?? row.predictedAmount;
}
function getFreshness(lastSyncAt) {
    if (!lastSyncAt) {
        return { label: "未同步", tone: "danger" };
    }
    const elapsed = Date.now() - new Date(lastSyncAt).getTime();
    if (elapsed <= 2 * 60 * 60 * 1000) {
        return { label: "新鲜", tone: "good" };
    }
    if (elapsed <= 24 * 60 * 60 * 1000) {
        return { label: "待更新", tone: "warn" };
    }
    return { label: "已过期", tone: "danger" };
}
function Metric({ label, value, caption, tone = "default" }) {
    return (_jsxs("article", { className: `v1-metric v1-metric-${tone}`, children: [_jsx("span", { children: label }), _jsx("strong", { children: value }), _jsx("small", { children: caption })] }));
}
function EmptyState({ title }) {
    return _jsx("div", { className: "v1-empty", children: title });
}
export default function AppShell() {
    const [page, setPage] = useState("dashboard");
    const [data, setData] = useState({ accounts: [], rows: [], summary: null, dashboard: null, sync: null });
    const [selectedTask, setSelectedTask] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    async function refresh() {
        setLoading(true);
        setError(null);
        try {
            const [accounts, rows, dashboard, sync] = await Promise.all([
                getAccounts(),
                getV2Tasks(),
                getDashboardSummary(),
                getAutoSyncStatus()
            ]);
            const summary = {
                yesterdayEstimatedTotal: dashboard.yesterdayFinalEstimatedTotal,
                todayEstimatedTotal: dashboard.realtimeEstimatedTotal,
                dailyIncrease: dashboard.dailyIncrease,
                snapshotDate: dashboard.snapshotDate,
                expectedAccountCount: dashboard.snapshot.expectedAccountCount,
                freshAccountCount: dashboard.snapshot.freshAccountCount,
                carriedForwardAccountCount: dashboard.snapshot.carriedForwardAccountCount,
                missingAccountCount: dashboard.snapshot.missingAccountCount,
                isComplete: dashboard.snapshot.isComplete
            };
            setData({ accounts, rows, summary, dashboard, sync });
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "数据加载失败");
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void refresh();
    }, []);
    const insights = useMemo(() => {
        const today = getShanghaiDate(new Date());
        const activeAccounts = data.accounts.filter((account) => account.loginStatus === "active").length;
        const exceptions = data.dashboard
            ? data.dashboard.accounts.exceptions
            : data.accounts
                .filter((account) => account.lastError || account.loginStatus !== "active")
                .map((account) => ({ accountId: account.id, displayName: account.displayName, message: account.lastError, lastSyncAt: account.lastSyncAt }));
        const staleAccounts = data.accounts.filter((account) => getFreshness(account.lastSyncAt).tone !== "good");
        const publishedToday = data.rows.filter((row) => row.publishedAt && getShanghaiDate(row.publishedAt) === today).length;
        const rankedTasks = [...data.rows].sort((left, right) => (right.todayPredictedDelta ?? -Infinity) - (left.todayPredictedDelta ?? -Infinity));
        const lastSyncAt = data.dashboard?.updatedAt ?? data.accounts.reduce((latest, account) => {
            if (!account.lastSyncAt || (latest && latest >= account.lastSyncAt)) {
                return latest;
            }
            return account.lastSyncAt;
        }, null);
        return { activeAccounts, exceptions, staleAccounts, publishedToday, rankedTasks, lastSyncAt };
    }, [data]);
    const summary = data.summary;
    const deltaTone = (summary?.dailyIncrease ?? 0) < 0 ? "negative" : "positive";
    const drawerTask = selectedTask;
    return (_jsxs("div", { className: "v1-app", children: [_jsxs("aside", { className: "v1-sidebar", "aria-label": "\u4E3B\u5BFC\u822A", children: [_jsxs("div", { className: "v1-brand", children: [_jsx("span", { children: "DY" }), _jsxs("div", { children: [_jsx("strong", { children: "\u661F\u56FE\u9A7E\u9A76\u8231" }), _jsx("small", { children: "v1 \u5F00\u53D1\u7248" })] })] }), _jsx("nav", { children: navigation.map((item) => (_jsx("button", { type: "button", className: page === item.id ? "v1-nav-item active" : "v1-nav-item", onClick: () => setPage(item.id), children: item.label }, item.id))) }), _jsxs("div", { className: "v1-sidebar-footer", children: [_jsx("span", { children: "\u6570\u636E\u65E5\u671F" }), _jsx("strong", { children: getShanghaiDate(new Date()) })] })] }), _jsxs("main", { className: "v1-main", children: [_jsxs("header", { className: "v1-topbar", children: [_jsxs("div", { children: [_jsx("p", { children: "\u6296\u97F3\u661F\u56FE\u7ECF\u8425\u9A7E\u9A76\u8231" }), _jsx("h1", { children: pageTitles[page] })] }), _jsxs("div", { className: "v1-topbar-actions", children: [_jsxs("span", { className: "v1-last-updated", children: ["\u66F4\u65B0\u4E8E ", formatDateTime(insights.lastSyncAt)] }), _jsx("button", { type: "button", className: "v1-refresh", onClick: () => void refresh(), disabled: loading, children: loading ? "更新中" : "刷新" })] })] }), error ? _jsx("div", { className: "v1-alert", children: error }) : null, _jsxs("div", { className: "v1-workspace", children: [_jsxs("section", { className: "v1-content", "aria-busy": loading, children: [page === "dashboard" ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "v1-metric-grid", children: [_jsx(Metric, { label: "\u4ECA\u65E5\u5B9E\u65F6\u9884\u4F30", value: formatMoney(summary?.todayEstimatedTotal), caption: "\u5B9E\u65F6" }), _jsx(Metric, { label: "\u6628\u65E5\u6700\u7EC8\u9884\u4F30", value: formatMoney(summary?.yesterdayEstimatedTotal), caption: "\u6628\u65E5\u5DF2\u7ED3\u7B97" }), _jsx(Metric, { label: "\u4ECA\u65E5\u589E\u91CF", value: formatSignedMoney(summary?.dailyIncrease), caption: summary?.isComplete ? "实时对昨日已结算" : "待补全", tone: deltaTone }), _jsx(Metric, { label: "\u4ECA\u65E5\u5DF2\u53D1\u5E03\u89C6\u9891", value: formatNumber(insights.publishedToday), caption: "\u6309\u4E0A\u6D77\u65E5\u671F" }), _jsx(Metric, { label: "\u6D3B\u8DC3\u8D26\u53F7", value: formatNumber(data.dashboard?.accounts.activeCount ?? insights.activeAccounts), caption: `${formatNumber(data.accounts.length)} 个账号` }), _jsx(Metric, { label: "\u5F85\u5904\u7406\u8D26\u53F7", value: formatNumber(data.dashboard?.accounts.pendingSyncCount ?? insights.exceptions.length), caption: summary?.isComplete ? "数据完整" : "快照待补全", tone: insights.exceptions.length ? "negative" : "positive" })] }), _jsxs("div", { className: "v1-section-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u9700\u8981\u5904\u7406" }), _jsx("span", { children: "\u767B\u5F55\u3001\u540C\u6B65\u548C\u6570\u636E\u5B8C\u6574\u5EA6" })] }), _jsx(StatusBadge, { label: summary?.isComplete ? "快照完整" : "待补全", tone: summary?.isComplete ? "good" : "warn" })] }), insights.exceptions.length === 0 && insights.staleAccounts.length === 0 ? (_jsx(EmptyState, { title: "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u8D26\u53F7" })) : (_jsx("div", { className: "v1-queue", children: [...insights.exceptions.map((account) => ({ id: account.accountId, displayName: account.displayName, lastError: account.message, lastSyncAt: account.lastSyncAt })), ...insights.staleAccounts.filter((account) => !insights.exceptions.some((item) => item.accountId === account.id))]
                                                    .slice(0, 6)
                                                    .map((account) => {
                                                    const freshness = getFreshness(account.lastSyncAt);
                                                    return (_jsxs("button", { type: "button", className: "v1-queue-item", onClick: () => setPage("accounts"), children: [_jsx("span", { children: account.displayName }), _jsx("small", { children: account.lastError || `最后同步 ${formatDateTime(account.lastSyncAt)}` }), _jsx(StatusBadge, { ...freshness })] }, account.id));
                                                }) })), _jsxs("div", { className: "v1-section-header", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u4EFB\u52A1\u589E\u91CF\u6392\u884C" }), _jsx("span", { children: "\u5F53\u524D\u540C\u6B65\u6570\u636E" })] }), _jsx("button", { type: "button", className: "v1-text-action", onClick: () => setPage("tasks"), children: "\u67E5\u770B\u4EFB\u52A1" })] }), _jsx(TaskTable, { rows: insights.rankedTasks.slice(0, 8), onSelect: setSelectedTask, compact: true })] })) : null, page === "accounts" ? _jsx(AccountsTable, { accounts: data.accounts, onRefresh: () => void refresh() }) : null, page === "tasks" ? _jsx(TaskPage, { rows: data.rows, accounts: data.accounts, onSelect: setSelectedTask, onRefresh: () => void refresh() }) : null, page === "videos" ? _jsx(VideoTable, { rows: data.rows, onSelect: setSelectedTask }) : null, page === "analytics" ? _jsx(AnalyticsState, { summary: summary }) : null] }), _jsx("aside", { className: "v1-drawer", "aria-label": "\u8BE6\u60C5", children: drawerTask ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "v1-drawer-label", children: "\u4EFB\u52A1\u8BE6\u60C5" }), _jsx("h2", { children: drawerTask.taskName }), _jsx("p", { children: drawerTask.accountName }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u5F53\u524D\u9884\u4F30" }), _jsx("dd", { children: formatMoney(getTaskEstimate(drawerTask)) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u6628\u65E5\u9884\u4F30" }), _jsx("dd", { children: formatMoney(drawerTask.yesterdayTaskPredictedAmount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u4ECA\u65E5\u589E\u91CF" }), _jsx("dd", { children: formatSignedMoney(drawerTask.todayPredictedDelta) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u5B9E\u9645\u64AD\u653E" }), _jsx("dd", { children: formatNumber(drawerTask.actualPlayCount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u6700\u540E\u540C\u6B65" }), _jsx("dd", { children: formatDateTime(drawerTask.lastSyncedAt) })] })] })] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "v1-drawer-label", children: "\u6570\u636E\u72B6\u6001" }), _jsx("h2", { children: summary?.isComplete ? "数据已就绪" : "等待补全" }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u65B0\u9C9C\u5FEB\u7167" }), _jsx("dd", { children: formatNumber(summary?.freshAccountCount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u6CBF\u7528\u5FEB\u7167" }), _jsx("dd", { children: formatNumber(summary?.carriedForwardAccountCount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u7F3A\u5931\u8D26\u53F7" }), _jsx("dd", { children: formatNumber(summary?.missingAccountCount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u81EA\u52A8\u540C\u6B65" }), _jsx("dd", { children: data.sync?.isRunning ? "进行中" : "空闲" })] })] })] })) })] })] })] }));
}
function AccountsTable({ accounts, onRefresh }) {
    const [displayName, setDisplayName] = useState("");
    const [busyId, setBusyId] = useState(null);
    const [message, setMessage] = useState(null);
    async function run(action, id, success) {
        setBusyId(id);
        setMessage(null);
        try {
            await action();
            setMessage(success);
            onRefresh();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "操作失败");
        }
        finally {
            setBusyId(null);
        }
    }
    async function create() {
        const value = displayName.trim();
        if (!value) {
            setMessage("请输入账号名称");
            return;
        }
        await run(() => createV2Account(value), "create", "账号已创建");
        setDisplayName("");
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "v1-section-header v1-account-toolbar", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u6D3B\u8DC3\u8D26\u53F7" }), _jsx("span", { children: "\u9ED8\u8BA4\u9690\u85CF\u5DF2\u5F52\u6863\u8D26\u53F7" })] }), _jsxs("div", { className: "v1-account-actions", children: [_jsx("input", { value: displayName, onChange: (event) => setDisplayName(event.target.value), placeholder: "\u65B0\u589E\u8D26\u53F7\u540D\u79F0" }), _jsx("button", { type: "button", onClick: () => void create(), disabled: busyId !== null, children: "\u65B0\u589E\u8D26\u53F7" }), _jsx("button", { type: "button", className: "v1-button-secondary", onClick: () => void run(runV2Sync, "all", "批量同步已提交"), disabled: busyId !== null, children: "\u6279\u91CF\u540C\u6B65" })] })] }), message ? _jsx("div", { className: "v1-inline-message", children: message }) : null, accounts.length === 0 ? _jsx(EmptyState, { title: "\u6682\u65E0\u6D3B\u8DC3\u8D26\u53F7" }) : (_jsx("div", { className: "v1-table-wrap", children: _jsxs("table", { className: "v1-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u8D26\u53F7\u540D\u79F0" }), _jsx("th", { children: "\u6296\u97F3\u53F7" }), _jsx("th", { children: "\u767B\u5F55\u72B6\u6001" }), _jsx("th", { children: "\u6700\u8FD1\u540C\u6B65" }), _jsx("th", { children: "\u6570\u636E\u65B0\u9C9C\u5EA6" }), _jsx("th", { children: "\u6700\u8FD1\u9519\u8BEF" }), _jsx("th", { children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: accounts.map((account) => {
                                const freshness = getFreshness(account.lastSyncAt);
                                return _jsxs("tr", { children: [_jsx("td", { children: account.displayName }), _jsx("td", { children: account.douyinId ?? "--" }), _jsx("td", { children: _jsx(LoginStatusBadge, { status: account.loginStatus }) }), _jsx("td", { children: formatDateTime(account.lastSyncAt) }), _jsx("td", { children: _jsx(StatusBadge, { ...freshness }) }), _jsx("td", { className: "v1-cell-error", children: account.lastError ?? "--" }), _jsx("td", { children: _jsxs("div", { className: "v1-row-actions", children: [_jsx("button", { type: "button", onClick: () => void run(() => launchV2Login(account.id), account.id, "登录窗口已启动"), disabled: busyId !== null, children: "\u767B\u5F55" }), _jsx("button", { type: "button", onClick: () => void run(() => syncV2Account(account.id), account.id, "同步已完成"), disabled: busyId !== null, children: "\u540C\u6B65" }), _jsx("button", { type: "button", className: "v1-button-secondary", onClick: () => void run(() => archiveV2Account(account.id), account.id, "账号已归档"), disabled: busyId !== null, children: "\u5F52\u6863" })] }) })] }, account.id);
                            }) })] }) }))] }));
}
function TaskPage({ rows, accounts, onSelect, onRefresh }) {
    const [accountId, setAccountId] = useState("");
    const [status, setStatus] = useState("");
    const [sort, setSort] = useState("delta");
    const [expanded, setExpanded] = useState({});
    const [busyId, setBusyId] = useState(null);
    const [message, setMessage] = useState(null);
    const statuses = useMemo(() => [...new Set(rows.map((row) => row.taskStatus))].sort((left, right) => left.localeCompare(right)), [rows]);
    const groups = useMemo(() => {
        const grouped = new Map();
        for (const row of rows) {
            if (accountId && row.accountId !== accountId)
                continue;
            if (status && row.taskStatus !== status)
                continue;
            const items = grouped.get(row.taskId) ?? [];
            items.push(row);
            grouped.set(row.taskId, items);
        }
        const result = [...grouped.values()].map((items) => {
            const task = items[0];
            const actualValues = items.map((item) => item.actualPlayCount).filter((value) => value !== null);
            const deltaValues = items.map((item) => item.playDelta).filter((value) => value !== null);
            return {
                task,
                videos: items.filter((item) => item.videoId),
                actualPlayCount: actualValues.length ? actualValues.reduce((sum, value) => sum + value, 0) : null,
                playDelta: deltaValues.length ? deltaValues.reduce((sum, value) => sum + value, 0) : null
            };
        });
        return result.sort((left, right) => {
            const leftValue = sort === "delta" ? left.task.todayPredictedDelta : sort === "estimate" ? getTaskEstimate(left.task) : left.playDelta;
            const rightValue = sort === "delta" ? right.task.todayPredictedDelta : sort === "estimate" ? getTaskEstimate(right.task) : right.playDelta;
            return (rightValue ?? -Infinity) - (leftValue ?? -Infinity) || left.task.taskName.localeCompare(right.task.taskName, "zh-CN");
        });
    }, [accountId, rows, sort, status]);
    function toggle(taskId) {
        setExpanded((current) => ({ ...current, [taskId]: !current[taskId] }));
    }
    function exportRows() {
        const output = groups.map(({ task, actualPlayCount, playDelta, videos }) => [
            task.accountName,
            task.taskName,
            task.taskStatus,
            getTaskEstimate(task),
            task.yesterdayTaskPredictedAmount,
            task.todayPredictedDelta,
            task.xingtuPlayCount,
            actualPlayCount,
            playDelta,
            task.settledAmount,
            task.lastSyncedAt,
            videos.length
        ]);
        const worksheet = XLSX.utils.aoa_to_sheet([["账号", "任务名称", "任务状态", "当前预估", "昨日预估", "今日增量", "任务播放量", "实际播放量", "播放差值", "已发放金额", "最后同步时间", "视频数"], ...output]);
        worksheet["!cols"] = [{ wch: 18 }, { wch: 28 }, { wch: 14 }, ...Array.from({ length: 9 }, () => ({ wch: 16 }))];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "任务分析");
        XLSX.writeFile(workbook, "任务分析.xlsx");
        setMessage("当前筛选结果已导出");
    }
    async function bindVideo(taskId) {
        const videoId = window.prompt("输入要绑定的视频 ID");
        if (!videoId?.trim())
            return;
        setBusyId(taskId);
        setMessage(null);
        try {
            await bindV2TaskVideo(taskId, videoId.trim());
            setMessage("视频已绑定");
            onRefresh();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "视频绑定失败");
        }
        finally {
            setBusyId(null);
        }
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "v1-section-header v1-task-toolbar", children: [_jsxs("div", { children: [_jsx("h2", { children: "\u4EFB\u52A1\u5206\u6790" }), _jsx("span", { children: "\u5F52\u6863\u8D26\u53F7\u9ED8\u8BA4\u9690\u85CF\uFF0C\u6570\u636E\u4ECD\u4FDD\u7559\u5728\u603B\u89C8\u7EDF\u8BA1\u4E2D" })] }), _jsxs("div", { className: "v1-filter-actions", children: [_jsxs("select", { "aria-label": "\u8D26\u53F7\u7B5B\u9009", value: accountId, onChange: (event) => setAccountId(event.target.value), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u8D26\u53F7" }), accounts.map((account) => _jsx("option", { value: account.id, children: account.displayName }, account.id))] }), _jsxs("select", { "aria-label": "\u4EFB\u52A1\u72B6\u6001\u7B5B\u9009", value: status, onChange: (event) => setStatus(event.target.value), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u72B6\u6001" }), statuses.map((item) => _jsx("option", { value: item, children: item }, item))] }), _jsxs("select", { "aria-label": "\u4EFB\u52A1\u6392\u5E8F", value: sort, onChange: (event) => setSort(event.target.value), children: [_jsx("option", { value: "delta", children: "\u6309\u589E\u91CF\u6392\u5E8F" }), _jsx("option", { value: "estimate", children: "\u6309\u9884\u4F30\u91D1\u989D\u6392\u5E8F" }), _jsx("option", { value: "play", children: "\u6309\u64AD\u653E\u589E\u957F\u6392\u5E8F" })] }), _jsx("button", { type: "button", className: "v1-button-secondary", onClick: exportRows, disabled: groups.length === 0, children: "\u5BFC\u51FA" })] })] }), message ? _jsx("div", { className: "v1-inline-message", children: message }) : null, groups.length === 0 ? _jsx(EmptyState, { title: "\u6682\u65E0\u7B26\u5408\u6761\u4EF6\u7684\u4EFB\u52A1" }) : (_jsx("div", { className: "v1-table-wrap", children: _jsxs("table", { className: "v1-table v1-task-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u8D26\u53F7" }), _jsx("th", { children: "\u4EFB\u52A1\u540D\u79F0" }), _jsx("th", { children: "\u4EFB\u52A1\u72B6\u6001" }), _jsx("th", { children: "\u5F53\u524D\u9884\u4F30" }), _jsx("th", { children: "\u6628\u65E5\u9884\u4F30" }), _jsx("th", { children: "\u4ECA\u65E5\u589E\u91CF" }), _jsx("th", { children: "\u4EFB\u52A1\u64AD\u653E\u91CF" }), _jsx("th", { children: "\u5B9E\u9645\u64AD\u653E\u91CF" }), _jsx("th", { children: "\u64AD\u653E\u5DEE\u503C" }), _jsx("th", { children: "\u5DF2\u53D1\u653E\u91D1\u989D" }), _jsx("th", { children: "\u6700\u540E\u540C\u6B65" }), _jsx("th", { children: "\u64CD\u4F5C" })] }) }), _jsx("tbody", { children: groups.map(({ task, videos, actualPlayCount, playDelta }) => (_jsxs(Fragment, { children: [_jsxs("tr", { onClick: () => onSelect(task), className: "v1-selectable-row", children: [_jsx("td", { children: task.accountName }), _jsx("td", { children: task.taskName }), _jsx("td", { children: _jsx(StatusBadge, { label: task.taskStatus }) }), _jsx("td", { children: formatMoney(getTaskEstimate(task)) }), _jsx("td", { children: formatMoney(task.yesterdayTaskPredictedAmount) }), _jsx("td", { children: formatSignedMoney(task.todayPredictedDelta) }), _jsx("td", { children: formatNumber(task.xingtuPlayCount) }), _jsx("td", { children: formatNumber(actualPlayCount) }), _jsx("td", { children: formatNumber(playDelta) }), _jsx("td", { children: formatMoney(task.settledAmount) }), _jsx("td", { children: formatDateTime(task.lastSyncedAt) }), _jsx("td", { children: _jsxs("div", { className: "v1-row-actions", children: [_jsx("button", { type: "button", className: "v1-button-secondary", onClick: (event) => { event.stopPropagation(); toggle(task.taskId); }, children: expanded[task.taskId] ? "收起" : "视频" }), _jsx("button", { type: "button", onClick: (event) => { event.stopPropagation(); void bindVideo(task.taskId); }, disabled: busyId !== null, children: "\u7ED1\u5B9A" })] }) })] }), expanded[task.taskId] ? _jsx("tr", { children: _jsx("td", { colSpan: 12, children: _jsx("div", { className: "v1-task-details", children: videos.length === 0 ? _jsx("span", { children: "\u6682\u65E0\u5DF2\u7ED1\u5B9A\u89C6\u9891" }) : _jsxs("table", { className: "v1-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u89C6\u9891" }), _jsx("th", { children: "\u72B6\u6001" }), _jsx("th", { children: "\u5B9E\u9645\u64AD\u653E" }), _jsx("th", { children: "\u64AD\u653E\u5DEE\u503C" }), _jsx("th", { children: "\u53D1\u5E03\u65F6\u95F4" }), _jsx("th", { children: "\u7ED1\u5B9A\u65B9\u5F0F" })] }) }), _jsx("tbody", { children: videos.map((video) => _jsxs("tr", { children: [_jsx("td", { children: video.videoTitle ?? video.videoId }), _jsx("td", { children: video.videoStatus ?? "--" }), _jsx("td", { children: formatNumber(video.actualPlayCount) }), _jsx("td", { children: formatNumber(video.playDelta) }), _jsx("td", { children: formatDateTime(video.publishedAt) }), _jsx("td", { children: video.matchSource === "manual" ? "手工绑定" : "自动匹配" })] }, `${task.taskId}:${video.videoId}`)) })] }) }) }) }, `${task.taskId}:details`) : null] }, task.taskId))) })] }) }))] }));
}
function TaskTable({ rows, onSelect, compact = false }) {
    if (rows.length === 0) {
        return _jsx(EmptyState, { title: "\u6682\u65E0\u4EFB\u52A1\u6570\u636E" });
    }
    return _jsx("div", { className: "v1-table-wrap", children: _jsxs("table", { className: "v1-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u8D26\u53F7" }), _jsx("th", { children: "\u4EFB\u52A1\u540D\u79F0" }), _jsx("th", { children: "\u72B6\u6001" }), _jsx("th", { children: "\u5F53\u524D\u9884\u4F30" }), _jsx("th", { children: "\u4ECA\u65E5\u589E\u91CF" }), _jsx("th", { children: "\u5B9E\u9645\u64AD\u653E" }), compact ? null : _jsx("th", { children: "\u6700\u540E\u540C\u6B65" })] }) }), _jsx("tbody", { children: rows.map((row) => _jsxs("tr", { onClick: () => onSelect(row), className: "v1-selectable-row", children: [_jsx("td", { children: row.accountName }), _jsx("td", { children: row.taskName }), _jsx("td", { children: _jsx(StatusBadge, { label: row.taskStatus }) }), _jsx("td", { children: formatMoney(getTaskEstimate(row)) }), _jsx("td", { children: formatSignedMoney(row.todayPredictedDelta) }), _jsx("td", { children: formatNumber(row.actualPlayCount) }), compact ? null : _jsx("td", { children: formatDateTime(row.lastSyncedAt) })] }, row.taskId)) })] }) });
}
function VideoTable({ rows, onSelect }) {
    const videos = rows.filter((row) => row.videoId);
    if (videos.length === 0) {
        return _jsx(EmptyState, { title: "\u6682\u65E0\u5DF2\u7ED1\u5B9A\u89C6\u9891" });
    }
    return _jsx("div", { className: "v1-table-wrap", children: _jsxs("table", { className: "v1-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u8D26\u53F7" }), _jsx("th", { children: "\u89C6\u9891\u6807\u9898" }), _jsx("th", { children: "\u5173\u8054\u4EFB\u52A1" }), _jsx("th", { children: "\u5B9E\u9645\u64AD\u653E" }), _jsx("th", { children: "\u64AD\u653E\u5DEE\u503C" }), _jsx("th", { children: "\u53D1\u5E03\u65F6\u95F4" })] }) }), _jsx("tbody", { children: videos.map((row) => _jsxs("tr", { onClick: () => onSelect(row), className: "v1-selectable-row", children: [_jsx("td", { children: row.accountName }), _jsx("td", { children: row.videoTitle ?? "--" }), _jsx("td", { children: row.taskName }), _jsx("td", { children: formatNumber(row.actualPlayCount) }), _jsx("td", { children: formatNumber(row.playDelta) }), _jsx("td", { children: formatDateTime(row.publishedAt) })] }, `${row.taskId}:${row.videoId}`)) })] }) });
}
function AnalyticsState({ summary }) {
    return _jsxs("div", { className: "v1-analytics-state", children: [_jsx("span", { children: "\u5F53\u524D\u7EDF\u8BA1\u57FA\u7EBF" }), _jsx("strong", { children: summary?.snapshotDate ?? "--" }), _jsx("p", { children: summary?.isComplete ? "昨日最终快照可用于趋势聚合。" : "历史快照仍在补全。" })] });
}
