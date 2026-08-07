type StatusTone = "good" | "warn" | "danger" | "neutral";

const loginStatus: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "正常", tone: "good" },
  never_logged_in: { label: "未登录", tone: "warn" },
  session_recheck_pending: { label: "待验证", tone: "warn" },
  xingtu_login_required: { label: "星图登录失效", tone: "danger" },
  expired: { label: "登录失效", tone: "danger" },
  archived: { label: "已归档", tone: "neutral" }
};

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  return <span className={`v1-status v1-status-${tone}`}>{label}</span>;
}

export function LoginStatusBadge({ status }: { status: string }) {
  const resolved = loginStatus[status] ?? { label: status || "未知", tone: "neutral" as StatusTone };
  return <StatusBadge {...resolved} />;
}
