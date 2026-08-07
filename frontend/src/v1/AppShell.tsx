import { useEffect, useMemo, useState } from "react";
import { archiveV2Account, createV2Account, getAccounts, getAutoSyncStatus, getDashboardSummary, getTaskVideos, launchV2Login, runV2Sync, syncV2Account } from "../api";
import type { AccountSummary, AutoSyncStatus, DashboardSummary, DailyEstimateSummary, TaskVideoRow } from "../types";
import { LoginStatusBadge, StatusBadge } from "./StatusBadge";
import { formatDateTime, formatMoney, formatNumber, formatSignedMoney, getShanghaiDate } from "./format";
import "./v1.css";

type PageId = "dashboard" | "accounts" | "tasks" | "videos" | "analytics";

type DataState = {
  accounts: AccountSummary[];
  rows: TaskVideoRow[];
  summary: DailyEstimateSummary | null;
  dashboard: DashboardSummary | null;
  sync: AutoSyncStatus | null;
};

const navigation: Array<{ id: PageId; label: string }> = [
  { id: "dashboard", label: "总览" },
  { id: "accounts", label: "账号" },
  { id: "tasks", label: "任务" },
  { id: "videos", label: "视频" },
  { id: "analytics", label: "历史分析" }
];

const pageTitles: Record<PageId, string> = {
  dashboard: "每日经营总览",
  accounts: "账号运营",
  tasks: "任务分析",
  videos: "视频明细",
  analytics: "历史分析"
};

function getTaskEstimate(row: TaskVideoRow): number | null {
  return row.missionEstimatedAmount ?? row.predictedAmount;
}

function getFreshness(lastSyncAt: string | null): { label: string; tone: "good" | "warn" | "danger" } {
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

function Metric({ label, value, caption, tone = "default" }: { label: string; value: string; caption: string; tone?: "default" | "positive" | "negative" }) {
  return (
    <article className={`v1-metric v1-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </article>
  );
}

function EmptyState({ title }: { title: string }) {
  return <div className="v1-empty">{title}</div>;
}

export default function AppShell() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [data, setData] = useState<DataState>({ accounts: [], rows: [], summary: null, dashboard: null, sync: null });
  const [selectedTask, setSelectedTask] = useState<TaskVideoRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [accounts, rows, dashboard, sync] = await Promise.all([
        getAccounts(),
        getTaskVideos({}),
        getDashboardSummary(),
        getAutoSyncStatus()
      ]);
      const summary: DailyEstimateSummary = {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "数据加载失败");
    } finally {
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
    const lastSyncAt = data.dashboard?.updatedAt ?? data.accounts.reduce<string | null>((latest, account) => {
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

  return (
    <div className="v1-app">
      <aside className="v1-sidebar" aria-label="主导航">
        <div className="v1-brand">
          <span>DY</span>
          <div>
            <strong>星图驾驶舱</strong>
            <small>v1 开发版</small>
          </div>
        </div>
        <nav>
          {navigation.map((item) => (
            <button
              type="button"
              className={page === item.id ? "v1-nav-item active" : "v1-nav-item"}
              key={item.id}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="v1-sidebar-footer">
          <span>数据日期</span>
          <strong>{getShanghaiDate(new Date())}</strong>
        </div>
      </aside>

      <main className="v1-main">
        <header className="v1-topbar">
          <div>
            <p>抖音星图经营驾驶舱</p>
            <h1>{pageTitles[page]}</h1>
          </div>
          <div className="v1-topbar-actions">
            <span className="v1-last-updated">更新于 {formatDateTime(insights.lastSyncAt)}</span>
            <button type="button" className="v1-refresh" onClick={() => void refresh()} disabled={loading}>
              {loading ? "更新中" : "刷新"}
            </button>
          </div>
        </header>

        {error ? <div className="v1-alert">{error}</div> : null}
        <div className="v1-workspace">
          <section className="v1-content" aria-busy={loading}>
            {page === "dashboard" ? (
              <>
                <div className="v1-metric-grid">
                  <Metric label="今日实时预估" value={formatMoney(summary?.todayEstimatedTotal)} caption="实时" />
                  <Metric label="昨日最终预估" value={formatMoney(summary?.yesterdayEstimatedTotal)} caption="昨日已结算" />
                  <Metric label="今日增量" value={formatSignedMoney(summary?.dailyIncrease)} caption={summary?.isComplete ? "实时对昨日已结算" : "待补全"} tone={deltaTone} />
                  <Metric label="今日已发布视频" value={formatNumber(insights.publishedToday)} caption="按上海日期" />
                  <Metric label="活跃账号" value={formatNumber(data.dashboard?.accounts.activeCount ?? insights.activeAccounts)} caption={`${formatNumber(data.accounts.length)} 个账号`} />
                  <Metric label="待处理账号" value={formatNumber(data.dashboard?.accounts.pendingSyncCount ?? insights.exceptions.length)} caption={summary?.isComplete ? "数据完整" : "快照待补全"} tone={insights.exceptions.length ? "negative" : "positive"} />
                </div>

                <div className="v1-section-header">
                  <div>
                    <h2>需要处理</h2>
                    <span>登录、同步和数据完整度</span>
                  </div>
                  <StatusBadge label={summary?.isComplete ? "快照完整" : "待补全"} tone={summary?.isComplete ? "good" : "warn"} />
                </div>
                {insights.exceptions.length === 0 && insights.staleAccounts.length === 0 ? (
                  <EmptyState title="当前没有待处理账号" />
                ) : (
                  <div className="v1-queue">
                    {[...insights.exceptions.map((account) => ({ id: account.accountId, displayName: account.displayName, lastError: account.message, lastSyncAt: account.lastSyncAt })), ...insights.staleAccounts.filter((account) => !insights.exceptions.some((item) => item.accountId === account.id))]
                      .slice(0, 6)
                      .map((account) => {
                        const freshness = getFreshness(account.lastSyncAt);
                        return (
                          <button type="button" className="v1-queue-item" key={account.id} onClick={() => setPage("accounts")}>
                            <span>{account.displayName}</span>
                            <small>{account.lastError || `最后同步 ${formatDateTime(account.lastSyncAt)}`}</small>
                            <StatusBadge {...freshness} />
                          </button>
                        );
                      })}
                  </div>
                )}

                <div className="v1-section-header">
                  <div>
                    <h2>任务增量排行</h2>
                    <span>当前同步数据</span>
                  </div>
                  <button type="button" className="v1-text-action" onClick={() => setPage("tasks")}>查看任务</button>
                </div>
                <TaskTable rows={insights.rankedTasks.slice(0, 8)} onSelect={setSelectedTask} compact />
              </>
            ) : null}

            {page === "accounts" ? <AccountsTable accounts={data.accounts} onRefresh={() => void refresh()} /> : null}
            {page === "tasks" ? <TaskTable rows={data.rows} onSelect={setSelectedTask} /> : null}
            {page === "videos" ? <VideoTable rows={data.rows} onSelect={setSelectedTask} /> : null}
            {page === "analytics" ? <AnalyticsState summary={summary} /> : null}
          </section>

          <aside className="v1-drawer" aria-label="详情">
            {drawerTask ? (
              <>
                <span className="v1-drawer-label">任务详情</span>
                <h2>{drawerTask.taskName}</h2>
                <p>{drawerTask.accountName}</p>
                <dl>
                  <div><dt>当前预估</dt><dd>{formatMoney(getTaskEstimate(drawerTask))}</dd></div>
                  <div><dt>昨日预估</dt><dd>{formatMoney(drawerTask.yesterdayTaskPredictedAmount)}</dd></div>
                  <div><dt>今日增量</dt><dd>{formatSignedMoney(drawerTask.todayPredictedDelta)}</dd></div>
                  <div><dt>实际播放</dt><dd>{formatNumber(drawerTask.actualPlayCount)}</dd></div>
                  <div><dt>最后同步</dt><dd>{formatDateTime(drawerTask.lastSyncedAt)}</dd></div>
                </dl>
              </>
            ) : (
              <>
                <span className="v1-drawer-label">数据状态</span>
                <h2>{summary?.isComplete ? "数据已就绪" : "等待补全"}</h2>
                <dl>
                  <div><dt>新鲜快照</dt><dd>{formatNumber(summary?.freshAccountCount)}</dd></div>
                  <div><dt>沿用快照</dt><dd>{formatNumber(summary?.carriedForwardAccountCount)}</dd></div>
                  <div><dt>缺失账号</dt><dd>{formatNumber(summary?.missingAccountCount)}</dd></div>
                  <div><dt>自动同步</dt><dd>{data.sync?.isRunning ? "进行中" : "空闲"}</dd></div>
                </dl>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function AccountsTable({ accounts, onRefresh }: { accounts: AccountSummary[]; onRefresh: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, id: string, success: string) {
    setBusyId(id);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
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

  return (
    <>
      <div className="v1-section-header v1-account-toolbar">
        <div><h2>活跃账号</h2><span>默认隐藏已归档账号</span></div>
        <div className="v1-account-actions"><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="新增账号名称" /><button type="button" onClick={() => void create()} disabled={busyId !== null}>新增账号</button><button type="button" className="v1-button-secondary" onClick={() => void run(runV2Sync, "all", "批量同步已提交")} disabled={busyId !== null}>批量同步</button></div>
      </div>
      {message ? <div className="v1-inline-message">{message}</div> : null}
      {accounts.length === 0 ? <EmptyState title="暂无活跃账号" /> : (
        <div className="v1-table-wrap"><table className="v1-table"><thead><tr><th>账号名称</th><th>抖音号</th><th>登录状态</th><th>最近同步</th><th>数据新鲜度</th><th>最近错误</th><th>操作</th></tr></thead><tbody>
          {accounts.map((account) => {
            const freshness = getFreshness(account.lastSyncAt);
            return <tr key={account.id}><td>{account.displayName}</td><td>{account.douyinId ?? "--"}</td><td><LoginStatusBadge status={account.loginStatus} /></td><td>{formatDateTime(account.lastSyncAt)}</td><td><StatusBadge {...freshness} /></td><td className="v1-cell-error">{account.lastError ?? "--"}</td><td><div className="v1-row-actions"><button type="button" onClick={() => void run(() => launchV2Login(account.id), account.id, "登录窗口已启动")} disabled={busyId !== null}>登录</button><button type="button" onClick={() => void run(() => syncV2Account(account.id), account.id, "同步已完成")} disabled={busyId !== null}>同步</button><button type="button" className="v1-button-secondary" onClick={() => void run(() => archiveV2Account(account.id), account.id, "账号已归档")} disabled={busyId !== null}>归档</button></div></td></tr>;
          })}
        </tbody></table></div>
      )}
    </>
  );
}

function TaskTable({ rows, onSelect, compact = false }: { rows: TaskVideoRow[]; onSelect: (row: TaskVideoRow) => void; compact?: boolean }) {
  if (rows.length === 0) {
    return <EmptyState title="暂无任务数据" />;
  }

  return <div className="v1-table-wrap"><table className="v1-table"><thead><tr><th>账号</th><th>任务名称</th><th>状态</th><th>当前预估</th><th>今日增量</th><th>实际播放</th>{compact ? null : <th>最后同步</th>}</tr></thead><tbody>
    {rows.map((row) => <tr key={row.taskId} onClick={() => onSelect(row)} className="v1-selectable-row"><td>{row.accountName}</td><td>{row.taskName}</td><td><StatusBadge label={row.taskStatus} /></td><td>{formatMoney(getTaskEstimate(row))}</td><td>{formatSignedMoney(row.todayPredictedDelta)}</td><td>{formatNumber(row.actualPlayCount)}</td>{compact ? null : <td>{formatDateTime(row.lastSyncedAt)}</td>}</tr>)}
  </tbody></table></div>;
}

function VideoTable({ rows, onSelect }: { rows: TaskVideoRow[]; onSelect: (row: TaskVideoRow) => void }) {
  const videos = rows.filter((row) => row.videoId);
  if (videos.length === 0) {
    return <EmptyState title="暂无已绑定视频" />;
  }

  return <div className="v1-table-wrap"><table className="v1-table"><thead><tr><th>账号</th><th>视频标题</th><th>关联任务</th><th>实际播放</th><th>播放差值</th><th>发布时间</th></tr></thead><tbody>
    {videos.map((row) => <tr key={`${row.taskId}:${row.videoId}`} onClick={() => onSelect(row)} className="v1-selectable-row"><td>{row.accountName}</td><td>{row.videoTitle ?? "--"}</td><td>{row.taskName}</td><td>{formatNumber(row.actualPlayCount)}</td><td>{formatNumber(row.playDelta)}</td><td>{formatDateTime(row.publishedAt)}</td></tr>)}
  </tbody></table></div>;
}

function AnalyticsState({ summary }: { summary: DailyEstimateSummary | null }) {
  return <div className="v1-analytics-state"><span>当前统计基线</span><strong>{summary?.snapshotDate ?? "--"}</strong><p>{summary?.isComplete ? "昨日最终快照可用于趋势聚合。" : "历史快照仍在补全。"}</p></div>;
}
