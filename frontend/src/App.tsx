import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  createAccount,
  deleteAccount,
  getAccounts,
  getAutoSyncStatus,
  getDailyEstimateSummary,
  getTaskVideos,
  launchLogin,
  runAllSync,
  syncAccount
} from "./api";
import type { AccountSummary, AutoSyncStatus, DailyEstimateSummary, TaskVideoRow } from "./types";
import { formatMoney, isNegativeMoney, isVisibleMoneyChange, normalizeMoney } from "./money";
import "./styles.css";

const TASK_GROUPS_PER_PAGE = 6;
const RANKING_TASKS_PER_PAGE = 20;

const loginStatusLabels: Record<string, string> = {
  never_logged_in: "未登录",
  waiting_scan: "等待扫码",
  active: "已登录",
  session_recheck_pending: "等待自动复核",
  expired: "登录失效",
  error: "登录异常"
};

const taskStatusLabels: Record<string, string> = {
  in_progress: "进行中",
  settling: "结算中",
  completed: "已完成",
  paused: "已暂停",
  abnormal: "异常",
  unknown: "未知"
};

const videoStatusLabels: Record<string, string> = {
  published: "已发布",
  reviewing: "审核中",
  rejected: "审核拒绝",
  private: "私密",
  deleted: "已删除",
  unknown: "未知"
};

const syncReasonLabels: Record<string, string> = {
  startup: "启动补同步",
  interval: "定时同步",
  daily_primary: "跨日前主同步",
  daily_retry: "跨日前补同步",
  manual_full: "手动全量同步"
};

type TaskGroup = {
  accountId: string;
  accountName: string;
  missionId: string;
  taskName: string;
  taskStatus: string;
  lastSyncedAt: string | null;
  estimatedIncome: number | null;
  yesterdayEstimatedIncome: number | null;
  todayEstimatedDelta: number | null;
  todayPublishedCount: number;
  hasDailyBaseline: boolean;
  settledAmountTotal: number;
  videos: TaskVideoRow[];
};

type AccountGroup = {
  accountId: string;
  accountName: string;
  totalEstimatedIncome: number | null;
  todayEstimatedIncome: number;
  tasks: TaskGroup[];
};

type HeroStats = {
  yesterdayEstimatedTotal: number | null;
  todayEstimatedTotal: number | null;
  dailyIncrease: number | null;
  todayPublishedCount: number;
};

type RankingStats = {
  updatedTaskCount: number;
  dailyDelta: number | null;
  updatedAccountCount: number;
  topTask: TaskGroup | null;
};

function formatNumber(value: number | null): string {
  return value === null ? "--" : value.toLocaleString("zh-CN");
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "--";
}

function formatSyncReason(value: string | null): string {
  if (!value) {
    return "--";
  }

  return syncReasonLabels[value] ?? value;
}

function formatErrorText(value: string | null): string {
  if (!value) {
    return "最近无错误";
  }

  const firstLine = value.split("\n")[0]?.trim() ?? value;
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
}

function buildHeroStats(rows: TaskVideoRow[], dailyEstimateSummary: DailyEstimateSummary | null): HeroStats {
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

function buildGroups(rows: TaskVideoRow[]): AccountGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const accountMap = new Map<string, AccountGroup>();

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
        todayEstimatedDelta:
          row.hasYesterdayTaskBaseline === 1 && row.missionEstimatedAmount !== null && row.yesterdayTaskPredictedAmount !== null
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
      } else if (accountGroup.totalEstimatedIncome !== null) {
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

function buildRankingStats(tasks: TaskGroup[], dailyEstimateSummary: DailyEstimateSummary | null): RankingStats {
  const changedTasks = tasks.filter((task) => isVisibleMoneyChange(task.todayEstimatedDelta));

  return {
    updatedTaskCount: changedTasks.length,
    dailyDelta:
      dailyEstimateSummary?.yesterdayEstimatedTotal === null || dailyEstimateSummary === null
        ? null
        : normalizeMoney(dailyEstimateSummary.todayEstimatedTotal - dailyEstimateSummary.yesterdayEstimatedTotal),
    updatedAccountCount: new Set(changedTasks.map((task) => task.accountId)).size,
    topTask: changedTasks[0] ?? null
  };
}

export default function App() {
  const syncAllBusyId = "__sync_all__";
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [rows, setRows] = useState<TaskVideoRow[]>([]);
  const [dailyEstimateSummary, setDailyEstimateSummary] = useState<DailyEstimateSummary | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rankingPage, setRankingPage] = useState(1);
  const [taskView, setTaskView] = useState<"details" | "ranking">("details");
  const [expandedRankingTask, setExpandedRankingTask] = useState<string | null>(null);
  const [accountPanelCollapsed, setAccountPanelCollapsed] = useState(true);
  const [collapsedTaskAccounts, setCollapsedTaskAccounts] = useState<Record<string, boolean>>({});
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const lastFinishedAtRef = useRef<string | null>(null);

  const groupedRows = useMemo(() => buildGroups(rows), [rows]);
  const heroStats = useMemo(() => buildHeroStats(rows, dailyEstimateSummary), [rows, dailyEstimateSummary]);
  const rankingTasks = useMemo(
    () =>
      groupedRows
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
        }),
    [groupedRows]
  );
  const rankingStats = useMemo(
    () => buildRankingStats(rankingTasks, dailyEstimateSummary),
    [dailyEstimateSummary, rankingTasks]
  );
  const dailyBaselineReady = useMemo(
    () => groupedRows.some((account) => account.tasks.some((task) => task.hasDailyBaseline)),
    [groupedRows]
  );

  const sortedAccounts = useMemo(
    () => [...accounts].sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")),
    [accounts]
  );

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
        } else if (status.lastFinishedAt && status.lastFinishedAt !== lastFinishedAtRef.current) {
          lastFinishedAtRef.current = status.lastFinishedAt;
          await refreshAll(selectedAccountId, selectedStatus);
          return;
        }

        if (status.isRunning) {
          await refreshAccounts();
        }
      } catch {
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

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
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

  async function handleLaunchLogin(accountId: string) {
    setBusyId(accountId);
    setError(null);
    setMessage(null);
    try {
      await launchLogin(accountId);
      setMessage("已打开扫码登录窗口，页面不会自动刷新，请直接扫码登录创作者中心。");
      await refreshAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录窗口启动失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSync(accountId: string) {
    setBusyId(accountId);
    setError(null);
    setMessage(null);
    try {
      await syncAccount(accountId);
      setMessage("同步完成");
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步失败");
      await refreshAccounts();
    } finally {
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
      setMessage(
        result.status === "queued"
          ? "后台已有同步任务，已追加一次全量同步请求。"
          : "已启动后台全量同步，失败账号会自动跳过并继续。"
      );
      await refreshAccounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "全量同步启动失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteAccount(accountId: string, accountName: string) {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除账号失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleFilterChange(accountId: string, status: string) {
    setSelectedAccountId(accountId);
    setSelectedStatus(status);
    setError(null);
    await refreshRows(accountId, status);
  }

  function toggleTaskAccountCollapse(accountId: string) {
    setCollapsedTaskAccounts((current) => ({
      ...current,
      [accountId]: !(current[accountId] ?? true)
    }));
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">本地网页 + 本地采集服务</p>
          <h1>抖音任务数据统计</h1>
          <p className="subtle">
            现在按“账号 → 任务 → 视频”层级展示任务详情。任务头部显示总预估收益，视频行显示单条预估分佣金额和播放数据。
          </p>
          {autoSyncStatus ? (
            <div className="sync-summary">
              <p>
                自动同步：
                {autoSyncStatus.isRunning
                  ? `${formatSyncReason(autoSyncStatus.currentReason)}进行中（${autoSyncStatus.accountsCompleted}/${autoSyncStatus.accountsTotal}）`
                  : "空闲"}
              </p>
              <p>
                并发账号数：{autoSyncStatus.activeAccounts.length}/{autoSyncStatus.parallelLimit}
                {autoSyncStatus.activeAccounts.length > 0 ? ` ｜ 当前账号：${autoSyncStatus.activeAccounts.join("、")}` : ""}
              </p>
              <p>
                下一次定时同步：{formatTime(autoSyncStatus.nextRegularRunAt)} ｜ 跨日前主同步：{formatTime(autoSyncStatus.nextDailyCutoffAt)}
              </p>
              <p>
                跨日前补同步：{formatTime(autoSyncStatus.nextDailyRetryAt)} ｜ 上次完成：{formatTime(autoSyncStatus.lastFinishedAt)}
              </p>
              <p>上次成功：{formatTime(autoSyncStatus.lastSuccessAt)}</p>
              {autoSyncStatus.lastError ? <p className="error-text">最近自动同步错误：{formatErrorText(autoSyncStatus.lastError)}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="status-box">
          <div className="status-item">
            <span>账号数</span>
            <strong>{accounts.length}</strong>
          </div>
          <div className="status-item">
            <span>任务视频数</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="status-item">
            <span>昨日总预估</span>
            <strong>{formatMoney(heroStats.yesterdayEstimatedTotal)}</strong>
          </div>
          <div className="status-item">
            <span>今日总预估</span>
            <strong>{formatMoney(heroStats.todayEstimatedTotal)}</strong>
          </div>
          <div className="status-item">
            <span>日增量</span>
            <strong>{formatMoney(heroStats.dailyIncrease)}</strong>
          </div>
          <div className="status-item">
            <span>今日视频发布数</span>
            <strong>{formatNumber(heroStats.todayPublishedCount)}</strong>
          </div>
        </div>
      </section>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <h2>账号页</h2>
          <div className="panel-actions">
            <button type="button" className="secondary" onClick={() => setAccountPanelCollapsed((current) => !current)}>
              {accountPanelCollapsed ? "展开账号页" : "收起账号页"}
            </button>
          </div>
        </div>

        {!accountPanelCollapsed ? (
          <div className="panel-body">
            <div className="panel-actions">
              <input
                className="account-search"
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                placeholder="搜索账号名称"
              />
              <button type="button" className="secondary" onClick={() => handleSyncAll()} disabled={busyId !== null || accounts.length === 0}>
                {busyId === syncAllBusyId ? "提交中..." : "一键全量同步"}
              </button>
            </div>

            <form className="account-form" onSubmit={handleCreateAccount}>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="输入账号名称" />
              <button type="submit">新增账号</button>
            </form>

            <div className="account-grid">
              {filteredAccounts.map((account) => (
                <article key={account.id} className="account-card">
                  <div>
                    <h3>{account.displayName}</h3>
                    <p>{account.platform}</p>
                  </div>
                  <div className="account-card-body">
                    <div>
                      <p>登录状态：{loginStatusLabels[account.loginStatus] ?? account.loginStatus}</p>
                      <p>最后同步：{formatTime(account.lastSyncAt)}</p>
                      <p className="error-text" title={account.lastError ?? "最近无错误"}>
                        {formatErrorText(account.lastError)}
                      </p>
                      {account.loginStatus === "waiting_scan" ? (
                        <p className="hint-text">扫码窗口已打开，当前不会自动刷新页面，请直接扫码。</p>
                      ) : null}
                    </div>
                    <div className="account-actions">
                      <button type="button" onClick={() => handleLaunchLogin(account.id)} disabled={busyId !== null}>
                        {account.loginStatus === "waiting_scan" ? "等待扫码" : "扫码登录"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleSync(account.id)}
                        disabled={busyId !== null || account.loginStatus === "waiting_scan"}
                      >
                        手动同步
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleDeleteAccount(account.id, account.displayName)}
                        disabled={busyId !== null}
                      >
                        删除账号
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {accounts.length === 0 ? <p className="empty">还没有账号，先新增一个账号。</p> : null}
              {accounts.length > 0 && filteredAccounts.length === 0 ? <p className="empty">没有匹配到账号。</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>任务视频页</h2>
          <div className="task-panel-tools">
            <div className="view-switch" aria-label="任务数据视图">
              <button
                type="button"
                className={taskView === "details" ? "active" : ""}
                onClick={() => setTaskView("details")}
              >
                任务明细
              </button>
              <button
                type="button"
                className={taskView === "ranking" ? "active" : ""}
                onClick={() => setTaskView("ranking")}
              >
                今日预估排行
              </button>
            </div>
            <div className="filters">
              <select value={selectedAccountId} onChange={(event) => handleFilterChange(event.target.value, selectedStatus)}>
                <option value="">全部账号</option>
                {sortedAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName}
                  </option>
                ))}
              </select>
              <select value={selectedStatus} onChange={(event) => handleFilterChange(selectedAccountId, event.target.value)}>
                <option value="">全部任务状态</option>
                {Object.entries(taskStatusLabels).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {taskView === "details" ? (
          <>
            <div className="task-groups">
          {pagedAccountGroups.map((accountGroup) => {
            const collapsed = collapsedTaskAccounts[accountGroup.accountId] ?? true;

            return (
              <section key={accountGroup.accountId} className="account-section">
                <div className="account-section-header">
                  <div className="account-section-summary">
                    <h3>{accountGroup.accountName}</h3>
                    <span>总预估：{formatMoney(accountGroup.totalEstimatedIncome)}</span>
                  </div>
                  <div className="account-section-actions">
                    <span>{accountGroup.tasks.length} 个任务</span>
                    <button type="button" className="secondary" onClick={() => toggleTaskAccountCollapse(accountGroup.accountId)}>
                      {collapsed ? "展开" : "收起"}
                    </button>
                  </div>
                </div>

                {!collapsed
                  ? accountGroup.tasks.map((task) => (
                      <article key={task.missionId} className="task-card">
                        <header className="task-card-header">
                          <div>
                            <h4>{task.taskName}</h4>
                            <p>
                              任务状态：{taskStatusLabels[task.taskStatus] ?? task.taskStatus} | 最后同步：
                              {formatTime(task.lastSyncedAt)}
                            </p>
                          </div>
                          <div className="task-metrics">
                            <div>
                              <span>预估收益</span>
                              <strong>{formatMoney(task.estimatedIncome)}</strong>
                            </div>
                            <div>
                              <span>已发放收益</span>
                              <strong>{formatMoney(task.settledAmountTotal)}</strong>
                            </div>
                            <div>
                              <span>视频数</span>
                              <strong>{task.videos.length}</strong>
                            </div>
                          </div>
                        </header>

                        <div className="table-wrap">
                          <table className="video-table">
                            <thead>
                              <tr>
                                <th>视频标题</th>
                                <th>发布时间</th>
                                <th>任务口径播放量</th>
                                <th>当前播放量</th>
                                <th>差值</th>
                                <th>预估分佣金额</th>
                                <th>已发放收益</th>
                                <th>视频状态</th>
                                <th>来源</th>
                              </tr>
                            </thead>
                            <tbody>
                              {task.videos.map((row) => (
                                <tr key={row.taskId}>
                                  <td>{row.videoTitle ?? "--"}</td>
                                  <td>{formatTime(row.publishedAt)}</td>
                                  <td>{formatNumber(row.xingtuPlayCount)}</td>
                                  <td>{formatNumber(row.actualPlayCount)}</td>
                                  <td>{formatNumber(row.playDelta)}</td>
                                  <td>{formatMoney(row.predictedAmount)}</td>
                                  <td>{formatMoney(row.settledAmount)}</td>
                                  <td>{row.videoStatus ? (videoStatusLabels[row.videoStatus] ?? row.videoStatus) : "--"}</td>
                                  <td>{row.matchSource === "manual" ? "手工绑定" : "任务详情直连"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    ))
                  : null}
              </section>
            );
          })}

          {groupedRows.length === 0 ? <p className="empty">当前没有任务视频数据，请先同步账号。</p> : null}
            </div>

            {groupedRows.length > 0 ? (
              <div className="pagination">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                >
                  上一页
                </button>
                <span>
                  第 {currentPage} / {totalPages} 页
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="ranking-summary">
              <div>
                <span>今日有更新任务数</span>
                <strong>{rankingStats.updatedTaskCount}</strong>
              </div>
              <div>
                <span>今日预估增量</span>
                <strong className={isNegativeMoney(rankingStats.dailyDelta) ? "amount-negative" : "amount-positive"}>
                  {formatMoney(rankingStats.dailyDelta)}
                </strong>
              </div>
              <div>
                <span>有增量账号数</span>
                <strong>{rankingStats.updatedAccountCount}</strong>
              </div>
              <div>
                <span>增量最高任务</span>
                <strong className="top-task-name">
                  {rankingStats.topTask
                    ? `${rankingStats.topTask.accountName} / ${rankingStats.topTask.taskName}`
                    : "--"}
                </strong>
                <small>{rankingStats.topTask ? formatMoney(rankingStats.topTask.todayEstimatedDelta) : ""}</small>
              </div>
            </div>

            {!dailyBaselineReady && rows.length > 0 ? (
              <p className="baseline-notice">今日已开始记录预估快照，待明日形成真实昨日基线后显示增量排行。</p>
            ) : rankingTasks.length === 0 ? (
              <p className="empty">当前筛选范围内，今日暂无预估收益变化。</p>
            ) : (
              <div className="table-wrap ranking-table-wrap">
                <table className="ranking-table">
                  <thead>
                    <tr>
                      <th>排名</th>
                      <th>账号名称</th>
                      <th>任务名称</th>
                      <th>昨日预估</th>
                      <th>当前预估</th>
                      <th>今日新增预估</th>
                      <th>今日新增视频</th>
                      <th>最后更新时间</th>
                      <th>明细</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRankingTasks.map((task, index) => {
                      const taskKey = `${task.accountId}:${task.missionId}`;
                      const expanded = expandedRankingTask === taskKey;

                      return (
                        <Fragment key={taskKey}>
                          <tr>
                            <td className={index + (rankingPage - 1) * RANKING_TASKS_PER_PAGE < 3 ? "rank-top" : ""}>
                              {index + 1 + (rankingPage - 1) * RANKING_TASKS_PER_PAGE}
                            </td>
                            <td>{task.accountName}</td>
                            <td>{task.taskName}</td>
                            <td>{formatMoney(task.yesterdayEstimatedIncome)}</td>
                            <td>{formatMoney(task.estimatedIncome)}</td>
                            <td className={isNegativeMoney(task.todayEstimatedDelta) ? "amount-negative" : "amount-positive"}>
                              {formatMoney(task.todayEstimatedDelta)}
                            </td>
                            <td>{task.todayPublishedCount}</td>
                            <td>{formatTime(task.lastSyncedAt)}</td>
                            <td>
                              <button
                                type="button"
                                className="secondary compact-button"
                                onClick={() => setExpandedRankingTask(expanded ? null : taskKey)}
                              >
                                {expanded ? "收起" : "展开"}
                              </button>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="ranking-detail-row">
                              <td colSpan={9}>
                                <div className="table-wrap">
                                  <table className="ranking-video-table">
                                    <thead>
                                      <tr>
                                        <th>视频标题</th>
                                        <th>昨日预估</th>
                                        <th>当前预估</th>
                                        <th>今日增量</th>
                                        <th>当前播放量</th>
                                        <th>视频状态</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {task.videos.map((row) => (
                                        <tr key={row.taskId}>
                                          <td>{row.videoTitle ?? "--"}</td>
                                          <td>{formatMoney(row.yesterdayPredictedAmount)}</td>
                                          <td>{formatMoney(row.predictedAmount)}</td>
                                          <td className={isNegativeMoney(row.todayPredictedDelta) ? "amount-negative" : "amount-positive"}>
                                            {formatMoney(row.todayPredictedDelta)}
                                          </td>
                                          <td>{formatNumber(row.actualPlayCount)}</td>
                                          <td>{row.videoStatus ? (videoStatusLabels[row.videoStatus] ?? row.videoStatus) : "--"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {rankingTasks.length > RANKING_TASKS_PER_PAGE ? (
              <div className="pagination">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRankingPage((page) => Math.max(1, page - 1))}
                  disabled={rankingPage === 1}
                >
                  上一页
                </button>
                <span>
                  第 {rankingPage} / {rankingTotalPages} 页
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRankingPage((page) => Math.min(rankingTotalPages, page + 1))}
                  disabled={rankingPage === rankingTotalPages}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
