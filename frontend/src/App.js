import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createAccount, deleteAccount, getAccounts, getAutoSyncStatus, getDailyEstimateSummary, getTaskVideos, launchLogin, runAllSync, syncAccount } from "./api";
import { formatMoney, isNegativeMoney, isVisibleMoneyChange, normalizeMoney } from "./money";
import "./styles.css";
const TASK_GROUPS_PER_PAGE = 6;
const RANKING_TASKS_PER_PAGE = 20;
const loginStatusLabels = {
    never_logged_in: "未登录",
    waiting_scan: "等待扫码",
    active: "已登录",
    expired: "登录失效",
    error: "登录异常"
};
const taskStatusLabels = {
    in_progress: "进行中",
    settling: "结算中",
    completed: "已完成",
    paused: "已暂停",
    abnormal: "异常",
    unknown: "未知"
};
const videoStatusLabels = {
    published: "已发布",
    reviewing: "审核中",
    rejected: "审核拒绝",
    private: "私密",
    deleted: "已删除",
    unknown: "未知"
};
const syncReasonLabels = {
    startup: "启动补同步",
    interval: "定时同步",
    daily_primary: "跨日前主同步",
    daily_retry: "跨日前补同步",
    manual_full: "手动全量同步"
};
function formatNumber(value) {
    return value === null ? "--" : value.toLocaleString("zh-CN");
}
function formatTime(value) {
    return value ? new Date(value).toLocaleString("zh-CN") : "--";
}
function formatSyncReason(value) {
    if (!value) {
        return "--";
    }
    return syncReasonLabels[value] ?? value;
}
function formatErrorText(value) {
    if (!value) {
        return "最近无错误";
    }
    const firstLine = value.split("\n")[0]?.trim() ?? value;
    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
}
function buildHeroStats(rows, dailyEstimateSummary) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    let todayPublishedCount = 0;
    for (const row of rows) {
        if (!row.publishedAt) {
            continue;
        }
        const publishedAtMs = Date.parse(row.publishedAt);
        if (Number.isNaN(publishedAtMs)) {
            continue;
        }
        if (publishedAtMs >= startOfTodayMs) {
            todayPublishedCount += 1;
        }
    }
    return {
        yesterdayEstimatedTotal: dailyEstimateSummary?.yesterdayEstimatedTotal ?? null,
        todayEstimatedTotal: dailyEstimateSummary?.todayEstimatedTotal ?? null,
        dailyIncrease: dailyEstimateSummary?.dailyIncrease ?? null,
        todayPublishedCount
    };
}
function buildGroups(rows) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    const accountMap = new Map();
    for (const row of rows) {
        let accountGroup = accountMap.get(row.accountId);
        if (!accountGroup) {
            accountGroup = {
                accountId: row.accountId,
                accountName: row.accountName,
                totalEstimatedIncome: 0,
                todayEstimatedIncome: 0,
                tasks: []
            };
            accountMap.set(row.accountId, accountGroup);
        }
        let taskGroup = accountGroup.tasks.find((task) => task.missionId === row.missionId);
        if (!taskGroup) {
            taskGroup = {
                accountId: row.accountId,
                accountName: row.accountName,
                missionId: row.missionId,
                taskName: row.taskName,
                taskStatus: row.taskStatus,
                lastSyncedAt: row.lastSyncedAt,
                estimatedIncome: row.missionEstimatedAmount,
                yesterdayEstimatedIncome: row.hasYesterdayTaskBaseline === 1 ? row.yesterdayTaskPredictedAmount : null,
                todayEstimatedDelta: row.hasYesterdayTaskBaseline === 1 && row.missionEstimatedAmount !== null && row.yesterdayTaskPredictedAmount !== null
                    ? normalizeMoney(row.missionEstimatedAmount - row.yesterdayTaskPredictedAmount)
                    : null,
                todayPublishedCount: 0,
                hasDailyBaseline: row.hasYesterdayTaskBaseline === 1,
                settledAmountTotal: 0,
                videos: []
            };
            accountGroup.tasks.push(taskGroup);
            if (row.missionEstimatedAmount === null) {
                accountGroup.totalEstimatedIncome = null;
            }
            else if (accountGroup.totalEstimatedIncome !== null) {
                accountGroup.totalEstimatedIncome += row.missionEstimatedAmount;
            }
            if (taskGroup.todayEstimatedDelta !== null) {
                accountGroup.todayEstimatedIncome += taskGroup.todayEstimatedDelta;
            }
        }
        taskGroup.videos.push(row);
        if (row.publishedAt) {
            const publishedAtMs = Date.parse(row.publishedAt);
            if (!Number.isNaN(publishedAtMs) && publishedAtMs >= startOfTodayMs) {
                taskGroup.todayPublishedCount += 1;
            }
        }
        taskGroup.settledAmountTotal += row.settledAmount ?? 0;
        taskGroup.lastSyncedAt = row.lastSyncedAt ?? taskGroup.lastSyncedAt;
    }
    return [...accountMap.values()].map((account) => ({
        ...account,
        tasks: account.tasks
            .map((task) => ({
            ...task,
            videos: task.videos.sort((left, right) => {
                const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
                const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
                return rightTime - leftTime;
            })
        }))
            .sort((left, right) => {
            const leftTime = left.videos[0]?.publishedAt ? Date.parse(left.videos[0].publishedAt) : 0;
            const rightTime = right.videos[0]?.publishedAt ? Date.parse(right.videos[0].publishedAt) : 0;
            return rightTime - leftTime;
        })
    }))
        .sort((left, right) => {
        if (right.todayEstimatedIncome !== left.todayEstimatedIncome) {
            return right.todayEstimatedIncome - left.todayEstimatedIncome;
        }
        if (right.totalEstimatedIncome !== left.totalEstimatedIncome) {
            return (right.totalEstimatedIncome ?? -Infinity) - (left.totalEstimatedIncome ?? -Infinity);
        }
        return left.accountName.localeCompare(right.accountName, "zh-CN");
    });
}
function buildRankingStats(tasks, dailyEstimateSummary) {
    const changedTasks = tasks.filter((task) => isVisibleMoneyChange(task.todayEstimatedDelta));
    return {
        updatedTaskCount: changedTasks.length,
        dailyDelta: dailyEstimateSummary?.yesterdayEstimatedTotal === null || dailyEstimateSummary === null
            ? null
            : normalizeMoney(dailyEstimateSummary.todayEstimatedTotal - dailyEstimateSummary.yesterdayEstimatedTotal),
        updatedAccountCount: new Set(changedTasks.map((task) => task.accountId)).size,
        topTask: changedTasks[0] ?? null
    };
}
export default function App() {
    const syncAllBusyId = "__sync_all__";
    const [accounts, setAccounts] = useState([]);
    const [rows, setRows] = useState([]);
    const [dailyEstimateSummary, setDailyEstimateSummary] = useState(null);
    const [displayName, setDisplayName] = useState("");
    const [accountSearch, setAccountSearch] = useState("");
    const [selectedAccountId, setSelectedAccountId] = useState("");
    const [selectedStatus, setSelectedStatus] = useState("");
    const [busyId, setBusyId] = useState(null);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rankingPage, setRankingPage] = useState(1);
    const [taskView, setTaskView] = useState("details");
    const [expandedRankingTask, setExpandedRankingTask] = useState(null);
    const [accountPanelCollapsed, setAccountPanelCollapsed] = useState(true);
    const [collapsedTaskAccounts, setCollapsedTaskAccounts] = useState({});
    const [autoSyncStatus, setAutoSyncStatus] = useState(null);
    const lastFinishedAtRef = useRef(null);
    const groupedRows = useMemo(() => buildGroups(rows), [rows]);
    const heroStats = useMemo(() => buildHeroStats(rows, dailyEstimateSummary), [rows, dailyEstimateSummary]);
    const rankingTasks = useMemo(() => groupedRows
        .flatMap((account) => account.tasks)
        .filter((task) => isVisibleMoneyChange(task.todayEstimatedDelta))
        .sort((left, right) => {
        const deltaDifference = normalizeMoney(right.todayEstimatedDelta ?? 0) - normalizeMoney(left.todayEstimatedDelta ?? 0);
        if (deltaDifference !== 0) {
            return deltaDifference;
        }
        if (right.estimatedIncome !== left.estimatedIncome) {
            return (right.estimatedIncome ?? -Infinity) - (left.estimatedIncome ?? -Infinity);
        }
        return left.taskName.localeCompare(right.taskName, "zh-CN");
    }), [groupedRows]);
    const rankingStats = useMemo(() => buildRankingStats(rankingTasks, dailyEstimateSummary), [dailyEstimateSummary, rankingTasks]);
    const dailyBaselineReady = useMemo(() => groupedRows.some((account) => account.tasks.some((task) => task.hasDailyBaseline)), [groupedRows]);
    const sortedAccounts = useMemo(() => [...accounts].sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")), [accounts]);
    const filteredAccounts = useMemo(() => {
        const keyword = accountSearch.trim().toLowerCase();
        if (!keyword) {
            return sortedAccounts;
        }
        return sortedAccounts.filter((account) => account.displayName.toLowerCase().includes(keyword));
    }, [accountSearch, sortedAccounts]);
    const totalPages = Math.max(1, Math.ceil(groupedRows.length / TASK_GROUPS_PER_PAGE));
    const pagedAccountGroups = useMemo(() => {
        const startIndex = (currentPage - 1) * TASK_GROUPS_PER_PAGE;
        return groupedRows.slice(startIndex, startIndex + TASK_GROUPS_PER_PAGE);
    }, [currentPage, groupedRows]);
    const rankingTotalPages = Math.max(1, Math.ceil(rankingTasks.length / RANKING_TASKS_PER_PAGE));
    const pagedRankingTasks = useMemo(() => {
        const startIndex = (rankingPage - 1) * RANKING_TASKS_PER_PAGE;
        return rankingTasks.slice(startIndex, startIndex + RANKING_TASKS_PER_PAGE);
    }, [rankingPage, rankingTasks]);
    useEffect(() => {
        void refreshAll();
    }, []);
    useEffect(() => {
        let cancelled = false;
        async function pollAutoSyncStatus() {
            try {
                const status = await getAutoSyncStatus();
                if (cancelled) {
                    return;
                }
                setAutoSyncStatus(status);
                if (lastFinishedAtRef.current === null) {
                    lastFinishedAtRef.current = status.lastFinishedAt;
                }
                else if (status.lastFinishedAt && status.lastFinishedAt !== lastFinishedAtRef.current) {
                    lastFinishedAtRef.current = status.lastFinishedAt;
                    await refreshAll(selectedAccountId, selectedStatus);
                    return;
                }
                if (status.isRunning) {
                    await refreshAccounts();
                }
            }
            catch {
                // Keep the UI usable even if background status polling fails.
            }
        }
        void pollAutoSyncStatus();
        const timer = window.setInterval(() => {
            void pollAutoSyncStatus();
        }, 10000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [selectedAccountId, selectedStatus]);
    useEffect(() => {
        if (!accounts.some((account) => account.loginStatus === "waiting_scan")) {
            return;
        }
        const timer = window.setInterval(() => {
            void refreshAccounts();
        }, 3000);
        return () => window.clearInterval(timer);
    }, [accounts]);
    useEffect(() => {
        setCurrentPage(1);
        setRankingPage(1);
        setExpandedRankingTask(null);
    }, [selectedAccountId, selectedStatus]);
    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);
    useEffect(() => {
        if (rankingPage > rankingTotalPages) {
            setRankingPage(rankingTotalPages);
        }
    }, [rankingPage, rankingTotalPages]);
    async function refreshAccounts() {
        setAccounts(await getAccounts());
    }
    async function refreshRows(accountId = selectedAccountId, status = selectedStatus) {
        const [taskRows, estimateSummary] = await Promise.all([
            getTaskVideos({ accountId, status }),
            getDailyEstimateSummary()
        ]);
        setRows(taskRows);
        setDailyEstimateSummary(estimateSummary);
    }
    async function refreshAll(accountId = selectedAccountId, status = selectedStatus) {
        const [accountList, taskRows, estimateSummary] = await Promise.all([
            getAccounts(),
            getTaskVideos({ accountId, status }),
            getDailyEstimateSummary()
        ]);
        setAccounts(accountList);
        setRows(taskRows);
        setDailyEstimateSummary(estimateSummary);
    }
    async function handleCreateAccount(event) {
        event.preventDefault();
        if (!displayName.trim()) {
            setError("请输入账号名称");
            return;
        }
        setError(null);
        setMessage(null);
        await createAccount(displayName.trim());
        setDisplayName("");
        setMessage("账号已创建");
        await refreshAll();
    }
    async function handleLaunchLogin(accountId) {
        setBusyId(accountId);
        setError(null);
        setMessage(null);
        try {
            await launchLogin(accountId);
            setMessage("已打开扫码登录窗口，页面不会自动刷新，请直接扫码登录创作者中心。");
            await refreshAccounts();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "登录窗口启动失败");
        }
        finally {
            setBusyId(null);
        }
    }
    async function handleSync(accountId) {
        setBusyId(accountId);
        setError(null);
        setMessage(null);
        try {
            await syncAccount(accountId);
            setMessage("同步完成");
            await refreshAll();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "同步失败");
            await refreshAccounts();
        }
        finally {
            setBusyId(null);
        }
    }
    async function handleSyncAll() {
        if (accounts.length === 0) {
            return;
        }
        setBusyId(syncAllBusyId);
        setError(null);
        setMessage(null);
        try {
            const result = await runAllSync();
            setAutoSyncStatus(await getAutoSyncStatus());
            setMessage(result.status === "queued"
                ? "后台已有同步任务，已追加一次全量同步请求。"
                : "已启动后台全量同步，失败账号会自动跳过并继续。");
            await refreshAccounts();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "全量同步启动失败");
        }
        finally {
            setBusyId(null);
        }
    }
    async function handleDeleteAccount(accountId, accountName) {
        const confirmed = window.confirm(`确认删除账号“${accountName}”吗？这会同时删除该账号的本地会话和已采集数据。`);
        if (!confirmed) {
            return;
        }
        setBusyId(accountId);
        setError(null);
        setMessage(null);
        try {
            await deleteAccount(accountId);
            const nextAccountId = selectedAccountId === accountId ? "" : selectedAccountId;
            setSelectedAccountId(nextAccountId);
            setMessage("账号已删除");
            await refreshAll(nextAccountId, selectedStatus);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : "删除账号失败");
        }
        finally {
            setBusyId(null);
        }
    }
    async function handleFilterChange(accountId, status) {
        setSelectedAccountId(accountId);
        setSelectedStatus(status);
        setError(null);
        await refreshRows(accountId, status);
    }
    function toggleTaskAccountCollapse(accountId) {
        setCollapsedTaskAccounts((current) => ({
            ...current,
            [accountId]: !(current[accountId] ?? true)
        }));
    }
    return (_jsxs("main", { className: "page", children: [_jsxs("section", { className: "hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u672C\u5730\u7F51\u9875 + \u672C\u5730\u91C7\u96C6\u670D\u52A1" }), _jsx("h1", { children: "\u6296\u97F3\u4EFB\u52A1\u6570\u636E\u7EDF\u8BA1" }), _jsx("p", { className: "subtle", children: "\u73B0\u5728\u6309\u201C\u8D26\u53F7 \u2192 \u4EFB\u52A1 \u2192 \u89C6\u9891\u201D\u5C42\u7EA7\u5C55\u793A\u4EFB\u52A1\u8BE6\u60C5\u3002\u4EFB\u52A1\u5934\u90E8\u663E\u793A\u603B\u9884\u4F30\u6536\u76CA\uFF0C\u89C6\u9891\u884C\u663E\u793A\u5355\u6761\u9884\u4F30\u5206\u4F63\u91D1\u989D\u548C\u64AD\u653E\u6570\u636E\u3002" }), autoSyncStatus ? (_jsxs("div", { className: "sync-summary", children: [_jsxs("p", { children: ["\u81EA\u52A8\u540C\u6B65\uFF1A", autoSyncStatus.isRunning
                                                ? `${formatSyncReason(autoSyncStatus.currentReason)}进行中（${autoSyncStatus.accountsCompleted}/${autoSyncStatus.accountsTotal}）`
                                                : "空闲"] }), _jsxs("p", { children: ["\u5E76\u53D1\u8D26\u53F7\u6570\uFF1A", autoSyncStatus.activeAccounts.length, "/", autoSyncStatus.parallelLimit, autoSyncStatus.activeAccounts.length > 0 ? ` ｜ 当前账号：${autoSyncStatus.activeAccounts.join("、")}` : ""] }), _jsxs("p", { children: ["\u4E0B\u4E00\u6B21\u5B9A\u65F6\u540C\u6B65\uFF1A", formatTime(autoSyncStatus.nextRegularRunAt), " \uFF5C \u8DE8\u65E5\u524D\u4E3B\u540C\u6B65\uFF1A", formatTime(autoSyncStatus.nextDailyCutoffAt)] }), _jsxs("p", { children: ["\u8DE8\u65E5\u524D\u8865\u540C\u6B65\uFF1A", formatTime(autoSyncStatus.nextDailyRetryAt), " \uFF5C \u4E0A\u6B21\u5B8C\u6210\uFF1A", formatTime(autoSyncStatus.lastFinishedAt)] }), _jsxs("p", { children: ["\u4E0A\u6B21\u6210\u529F\uFF1A", formatTime(autoSyncStatus.lastSuccessAt)] }), autoSyncStatus.lastError ? _jsxs("p", { className: "error-text", children: ["\u6700\u8FD1\u81EA\u52A8\u540C\u6B65\u9519\u8BEF\uFF1A", formatErrorText(autoSyncStatus.lastError)] }) : null] })) : null] }), _jsxs("div", { className: "status-box", children: [_jsxs("div", { className: "status-item", children: [_jsx("span", { children: "\u8D26\u53F7\u6570" }), _jsx("strong", { children: accounts.length })] }), _jsxs("div", { className: "status-item", children: [_jsx("span", { children: "\u4EFB\u52A1\u89C6\u9891\u6570" }), _jsx("strong", { children: rows.length })] }), _jsxs("div", { className: "status-item", children: [_jsx("span", { children: "\u6628\u65E5\u603B\u9884\u4F30" }), _jsx("strong", { children: formatMoney(heroStats.yesterdayEstimatedTotal) })] }), _jsxs("div", { className: "status-item", children: [_jsx("span", { children: "\u4ECA\u65E5\u603B\u9884\u4F30" }), _jsx("strong", { children: formatMoney(heroStats.todayEstimatedTotal) })] }), _jsxs("div", { className: "status-item", children: [_jsx("span", { children: "\u65E5\u589E\u91CF" }), _jsx("strong", { children: formatMoney(heroStats.dailyIncrease) })] }), _jsxs("div", { className: "status-item", children: [_jsx("span", { children: "\u4ECA\u65E5\u89C6\u9891\u53D1\u5E03\u6570" }), _jsx("strong", { children: formatNumber(heroStats.todayPublishedCount) })] })] })] }), message ? _jsx("div", { className: "message success", children: message }) : null, error ? _jsx("div", { className: "message error", children: error }) : null, _jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("h2", { children: "\u8D26\u53F7\u9875" }), _jsx("div", { className: "panel-actions", children: _jsx("button", { type: "button", className: "secondary", onClick: () => setAccountPanelCollapsed((current) => !current), children: accountPanelCollapsed ? "展开账号页" : "收起账号页" }) })] }), !accountPanelCollapsed ? (_jsxs("div", { className: "panel-body", children: [_jsxs("div", { className: "panel-actions", children: [_jsx("input", { className: "account-search", value: accountSearch, onChange: (event) => setAccountSearch(event.target.value), placeholder: "\u641C\u7D22\u8D26\u53F7\u540D\u79F0" }), _jsx("button", { type: "button", className: "secondary", onClick: () => handleSyncAll(), disabled: busyId !== null || accounts.length === 0, children: busyId === syncAllBusyId ? "提交中..." : "一键全量同步" })] }), _jsxs("form", { className: "account-form", onSubmit: handleCreateAccount, children: [_jsx("input", { value: displayName, onChange: (event) => setDisplayName(event.target.value), placeholder: "\u8F93\u5165\u8D26\u53F7\u540D\u79F0" }), _jsx("button", { type: "submit", children: "\u65B0\u589E\u8D26\u53F7" })] }), _jsxs("div", { className: "account-grid", children: [filteredAccounts.map((account) => (_jsxs("article", { className: "account-card", children: [_jsxs("div", { children: [_jsx("h3", { children: account.displayName }), _jsx("p", { children: account.platform })] }), _jsxs("div", { className: "account-card-body", children: [_jsxs("div", { children: [_jsxs("p", { children: ["\u767B\u5F55\u72B6\u6001\uFF1A", loginStatusLabels[account.loginStatus] ?? account.loginStatus] }), _jsxs("p", { children: ["\u6700\u540E\u540C\u6B65\uFF1A", formatTime(account.lastSyncAt)] }), _jsx("p", { className: "error-text", title: account.lastError ?? "最近无错误", children: formatErrorText(account.lastError) }), account.loginStatus === "waiting_scan" ? (_jsx("p", { className: "hint-text", children: "\u626B\u7801\u7A97\u53E3\u5DF2\u6253\u5F00\uFF0C\u5F53\u524D\u4E0D\u4F1A\u81EA\u52A8\u5237\u65B0\u9875\u9762\uFF0C\u8BF7\u76F4\u63A5\u626B\u7801\u3002" })) : null] }), _jsxs("div", { className: "account-actions", children: [_jsx("button", { type: "button", onClick: () => handleLaunchLogin(account.id), disabled: busyId !== null, children: account.loginStatus === "waiting_scan" ? "等待扫码" : "扫码登录" }), _jsx("button", { type: "button", className: "secondary", onClick: () => handleSync(account.id), disabled: busyId !== null || account.loginStatus === "waiting_scan", children: "\u624B\u52A8\u540C\u6B65" }), _jsx("button", { type: "button", className: "secondary", onClick: () => handleDeleteAccount(account.id, account.displayName), disabled: busyId !== null, children: "\u5220\u9664\u8D26\u53F7" })] })] })] }, account.id))), accounts.length === 0 ? _jsx("p", { className: "empty", children: "\u8FD8\u6CA1\u6709\u8D26\u53F7\uFF0C\u5148\u65B0\u589E\u4E00\u4E2A\u8D26\u53F7\u3002" }) : null, accounts.length > 0 && filteredAccounts.length === 0 ? _jsx("p", { className: "empty", children: "\u6CA1\u6709\u5339\u914D\u5230\u8D26\u53F7\u3002" }) : null] })] })) : null] }), _jsxs("section", { className: "panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("h2", { children: "\u4EFB\u52A1\u89C6\u9891\u9875" }), _jsxs("div", { className: "task-panel-tools", children: [_jsxs("div", { className: "view-switch", "aria-label": "\u4EFB\u52A1\u6570\u636E\u89C6\u56FE", children: [_jsx("button", { type: "button", className: taskView === "details" ? "active" : "", onClick: () => setTaskView("details"), children: "\u4EFB\u52A1\u660E\u7EC6" }), _jsx("button", { type: "button", className: taskView === "ranking" ? "active" : "", onClick: () => setTaskView("ranking"), children: "\u4ECA\u65E5\u9884\u4F30\u6392\u884C" })] }), _jsxs("div", { className: "filters", children: [_jsxs("select", { value: selectedAccountId, onChange: (event) => handleFilterChange(event.target.value, selectedStatus), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u8D26\u53F7" }), sortedAccounts.map((account) => (_jsx("option", { value: account.id, children: account.displayName }, account.id)))] }), _jsxs("select", { value: selectedStatus, onChange: (event) => handleFilterChange(selectedAccountId, event.target.value), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u4EFB\u52A1\u72B6\u6001" }), Object.entries(taskStatusLabels).map(([key, value]) => (_jsx("option", { value: key, children: value }, key)))] })] })] })] }), taskView === "details" ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "task-groups", children: [pagedAccountGroups.map((accountGroup) => {
                                        const collapsed = collapsedTaskAccounts[accountGroup.accountId] ?? true;
                                        return (_jsxs("section", { className: "account-section", children: [_jsxs("div", { className: "account-section-header", children: [_jsxs("div", { className: "account-section-summary", children: [_jsx("h3", { children: accountGroup.accountName }), _jsxs("span", { children: ["\u603B\u9884\u4F30\uFF1A", formatMoney(accountGroup.totalEstimatedIncome)] })] }), _jsxs("div", { className: "account-section-actions", children: [_jsxs("span", { children: [accountGroup.tasks.length, " \u4E2A\u4EFB\u52A1"] }), _jsx("button", { type: "button", className: "secondary", onClick: () => toggleTaskAccountCollapse(accountGroup.accountId), children: collapsed ? "展开" : "收起" })] })] }), !collapsed
                                                    ? accountGroup.tasks.map((task) => (_jsxs("article", { className: "task-card", children: [_jsxs("header", { className: "task-card-header", children: [_jsxs("div", { children: [_jsx("h4", { children: task.taskName }), _jsxs("p", { children: ["\u4EFB\u52A1\u72B6\u6001\uFF1A", taskStatusLabels[task.taskStatus] ?? task.taskStatus, " | \u6700\u540E\u540C\u6B65\uFF1A", formatTime(task.lastSyncedAt)] })] }), _jsxs("div", { className: "task-metrics", children: [_jsxs("div", { children: [_jsx("span", { children: "\u9884\u4F30\u6536\u76CA" }), _jsx("strong", { children: formatMoney(task.estimatedIncome) })] }), _jsxs("div", { children: [_jsx("span", { children: "\u5DF2\u53D1\u653E\u6536\u76CA" }), _jsx("strong", { children: formatMoney(task.settledAmountTotal) })] }), _jsxs("div", { children: [_jsx("span", { children: "\u89C6\u9891\u6570" }), _jsx("strong", { children: task.videos.length })] })] })] }), _jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "video-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u89C6\u9891\u6807\u9898" }), _jsx("th", { children: "\u53D1\u5E03\u65F6\u95F4" }), _jsx("th", { children: "\u4EFB\u52A1\u53E3\u5F84\u64AD\u653E\u91CF" }), _jsx("th", { children: "\u5F53\u524D\u64AD\u653E\u91CF" }), _jsx("th", { children: "\u5DEE\u503C" }), _jsx("th", { children: "\u9884\u4F30\u5206\u4F63\u91D1\u989D" }), _jsx("th", { children: "\u5DF2\u53D1\u653E\u6536\u76CA" }), _jsx("th", { children: "\u89C6\u9891\u72B6\u6001" }), _jsx("th", { children: "\u6765\u6E90" })] }) }), _jsx("tbody", { children: task.videos.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.videoTitle ?? "--" }), _jsx("td", { children: formatTime(row.publishedAt) }), _jsx("td", { children: formatNumber(row.xingtuPlayCount) }), _jsx("td", { children: formatNumber(row.actualPlayCount) }), _jsx("td", { children: formatNumber(row.playDelta) }), _jsx("td", { children: formatMoney(row.predictedAmount) }), _jsx("td", { children: formatMoney(row.settledAmount) }), _jsx("td", { children: row.videoStatus ? (videoStatusLabels[row.videoStatus] ?? row.videoStatus) : "--" }), _jsx("td", { children: row.matchSource === "manual" ? "手工绑定" : "任务详情直连" })] }, row.taskId))) })] }) })] }, task.missionId)))
                                                    : null] }, accountGroup.accountId));
                                    }), groupedRows.length === 0 ? _jsx("p", { className: "empty", children: "\u5F53\u524D\u6CA1\u6709\u4EFB\u52A1\u89C6\u9891\u6570\u636E\uFF0C\u8BF7\u5148\u540C\u6B65\u8D26\u53F7\u3002" }) : null] }), groupedRows.length > 0 ? (_jsxs("div", { className: "pagination", children: [_jsx("button", { type: "button", className: "secondary", onClick: () => setCurrentPage((page) => Math.max(1, page - 1)), disabled: currentPage === 1, children: "\u4E0A\u4E00\u9875" }), _jsxs("span", { children: ["\u7B2C ", currentPage, " / ", totalPages, " \u9875"] }), _jsx("button", { type: "button", className: "secondary", onClick: () => setCurrentPage((page) => Math.min(totalPages, page + 1)), disabled: currentPage === totalPages, children: "\u4E0B\u4E00\u9875" })] })) : null] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "ranking-summary", children: [_jsxs("div", { children: [_jsx("span", { children: "\u4ECA\u65E5\u6709\u66F4\u65B0\u4EFB\u52A1\u6570" }), _jsx("strong", { children: rankingStats.updatedTaskCount })] }), _jsxs("div", { children: [_jsx("span", { children: "\u4ECA\u65E5\u9884\u4F30\u589E\u91CF" }), _jsx("strong", { className: isNegativeMoney(rankingStats.dailyDelta) ? "amount-negative" : "amount-positive", children: formatMoney(rankingStats.dailyDelta) })] }), _jsxs("div", { children: [_jsx("span", { children: "\u6709\u589E\u91CF\u8D26\u53F7\u6570" }), _jsx("strong", { children: rankingStats.updatedAccountCount })] }), _jsxs("div", { children: [_jsx("span", { children: "\u589E\u91CF\u6700\u9AD8\u4EFB\u52A1" }), _jsx("strong", { className: "top-task-name", children: rankingStats.topTask
                                                    ? `${rankingStats.topTask.accountName} / ${rankingStats.topTask.taskName}`
                                                    : "--" }), _jsx("small", { children: rankingStats.topTask ? formatMoney(rankingStats.topTask.todayEstimatedDelta) : "" })] })] }), !dailyBaselineReady && rows.length > 0 ? (_jsx("p", { className: "baseline-notice", children: "\u4ECA\u65E5\u5DF2\u5F00\u59CB\u8BB0\u5F55\u9884\u4F30\u5FEB\u7167\uFF0C\u5F85\u660E\u65E5\u5F62\u6210\u771F\u5B9E\u6628\u65E5\u57FA\u7EBF\u540E\u663E\u793A\u589E\u91CF\u6392\u884C\u3002" })) : rankingTasks.length === 0 ? (_jsx("p", { className: "empty", children: "\u5F53\u524D\u7B5B\u9009\u8303\u56F4\u5185\uFF0C\u4ECA\u65E5\u6682\u65E0\u9884\u4F30\u6536\u76CA\u53D8\u5316\u3002" })) : (_jsx("div", { className: "table-wrap ranking-table-wrap", children: _jsxs("table", { className: "ranking-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u6392\u540D" }), _jsx("th", { children: "\u8D26\u53F7\u540D\u79F0" }), _jsx("th", { children: "\u4EFB\u52A1\u540D\u79F0" }), _jsx("th", { children: "\u6628\u65E5\u9884\u4F30" }), _jsx("th", { children: "\u5F53\u524D\u9884\u4F30" }), _jsx("th", { children: "\u4ECA\u65E5\u65B0\u589E\u9884\u4F30" }), _jsx("th", { children: "\u4ECA\u65E5\u65B0\u589E\u89C6\u9891" }), _jsx("th", { children: "\u6700\u540E\u66F4\u65B0\u65F6\u95F4" }), _jsx("th", { children: "\u660E\u7EC6" })] }) }), _jsx("tbody", { children: pagedRankingTasks.map((task, index) => {
                                                const taskKey = `${task.accountId}:${task.missionId}`;
                                                const expanded = expandedRankingTask === taskKey;
                                                return (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { className: index + (rankingPage - 1) * RANKING_TASKS_PER_PAGE < 3 ? "rank-top" : "", children: index + 1 + (rankingPage - 1) * RANKING_TASKS_PER_PAGE }), _jsx("td", { children: task.accountName }), _jsx("td", { children: task.taskName }), _jsx("td", { children: formatMoney(task.yesterdayEstimatedIncome) }), _jsx("td", { children: formatMoney(task.estimatedIncome) }), _jsx("td", { className: isNegativeMoney(task.todayEstimatedDelta) ? "amount-negative" : "amount-positive", children: formatMoney(task.todayEstimatedDelta) }), _jsx("td", { children: task.todayPublishedCount }), _jsx("td", { children: formatTime(task.lastSyncedAt) }), _jsx("td", { children: _jsx("button", { type: "button", className: "secondary compact-button", onClick: () => setExpandedRankingTask(expanded ? null : taskKey), children: expanded ? "收起" : "展开" }) })] }), expanded ? (_jsx("tr", { className: "ranking-detail-row", children: _jsx("td", { colSpan: 9, children: _jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "ranking-video-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u89C6\u9891\u6807\u9898" }), _jsx("th", { children: "\u6628\u65E5\u9884\u4F30" }), _jsx("th", { children: "\u5F53\u524D\u9884\u4F30" }), _jsx("th", { children: "\u4ECA\u65E5\u589E\u91CF" }), _jsx("th", { children: "\u5F53\u524D\u64AD\u653E\u91CF" }), _jsx("th", { children: "\u89C6\u9891\u72B6\u6001" })] }) }), _jsx("tbody", { children: task.videos.map((row) => (_jsxs("tr", { children: [_jsx("td", { children: row.videoTitle ?? "--" }), _jsx("td", { children: formatMoney(row.yesterdayPredictedAmount) }), _jsx("td", { children: formatMoney(row.predictedAmount) }), _jsx("td", { className: isNegativeMoney(row.todayPredictedDelta) ? "amount-negative" : "amount-positive", children: formatMoney(row.todayPredictedDelta) }), _jsx("td", { children: formatNumber(row.actualPlayCount) }), _jsx("td", { children: row.videoStatus ? (videoStatusLabels[row.videoStatus] ?? row.videoStatus) : "--" })] }, row.taskId))) })] }) }) }) })) : null] }, taskKey));
                                            }) })] }) })), rankingTasks.length > RANKING_TASKS_PER_PAGE ? (_jsxs("div", { className: "pagination", children: [_jsx("button", { type: "button", className: "secondary", onClick: () => setRankingPage((page) => Math.max(1, page - 1)), disabled: rankingPage === 1, children: "\u4E0A\u4E00\u9875" }), _jsxs("span", { children: ["\u7B2C ", rankingPage, " / ", rankingTotalPages, " \u9875"] }), _jsx("button", { type: "button", className: "secondary", onClick: () => setRankingPage((page) => Math.min(rankingTotalPages, page + 1)), disabled: rankingPage === rankingTotalPages, children: "\u4E0B\u4E00\u9875" })] })) : null] }))] })] }));
}
