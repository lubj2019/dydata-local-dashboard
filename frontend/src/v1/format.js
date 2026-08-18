export function formatMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "--";
    }
    return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}
export function formatSignedMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "--";
    }
    return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}
export function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "--";
    }
    return new Intl.NumberFormat("zh-CN").format(value);
}
export function formatSignedNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "--";
    }
    return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}
export function formatDateTime(value) {
    if (!value) {
        return "--";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "--";
    }
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}
export function getShanghaiDate(value) {
    const date = typeof value === "string" ? new Date(value) : value;
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}
