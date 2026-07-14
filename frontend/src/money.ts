export function normalizeMoney(value: number): number {
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatMoney(value: number | null): string {
  return value === null ? "--" : `¥${normalizeMoney(value).toFixed(2)}`;
}

export function isVisibleMoneyChange(value: number | null): boolean {
  return value !== null && normalizeMoney(value) !== 0;
}

export function isNegativeMoney(value: number | null): boolean {
  return value !== null && normalizeMoney(value) < 0;
}
