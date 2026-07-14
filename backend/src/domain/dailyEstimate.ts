const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export function getShanghaiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function getPreviousDateKey(date: Date): string {
  return getShanghaiDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}
