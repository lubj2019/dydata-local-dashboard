import { jsx as _jsx } from "react/jsx-runtime";
const loginStatus = {
    active: { label: "正常", tone: "good" },
    never_logged_in: { label: "未登录", tone: "warn" },
    session_recheck_pending: { label: "待验证", tone: "warn" },
    xingtu_login_required: { label: "星图登录失效", tone: "danger" },
    expired: { label: "登录失效", tone: "danger" },
    archived: { label: "已归档", tone: "neutral" }
};
export function StatusBadge({ label, tone = "neutral" }) {
    return _jsx("span", { className: `v1-status v1-status-${tone}`, children: label });
}
export function LoginStatusBadge({ status }) {
    const resolved = loginStatus[status] ?? { label: status || "未知", tone: "neutral" };
    return _jsx(StatusBadge, { ...resolved });
}
