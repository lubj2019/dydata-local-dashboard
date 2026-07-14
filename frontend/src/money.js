export function normalizeMoney(value) {
    const rounded = Number(value.toFixed(2));
    return Object.is(rounded, -0) ? 0 : rounded;
}
export function formatMoney(value) {
    return value === null ? "--" : `¥${normalizeMoney(value).toFixed(2)}`;
}
export function isVisibleMoneyChange(value) {
    return value !== null && normalizeMoney(value) !== 0;
}
export function isNegativeMoney(value) {
    return value !== null && normalizeMoney(value) < 0;
}
