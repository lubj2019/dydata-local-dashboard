function getSortValue(row, key) {
    if (key === "publishedAt") {
        if (!row.publishedAt)
            return null;
        const value = Date.parse(row.publishedAt);
        return Number.isNaN(value) ? null : value;
    }
    return row[key];
}
export function nextVideoSort(current, key) {
    return current?.key === key && current.direction === "desc"
        ? { key, direction: "asc" }
        : { key, direction: "desc" };
}
export function sortVideoRows(rows, sort) {
    if (!sort)
        return rows;
    const multiplier = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
        const leftValue = getSortValue(left, sort.key);
        const rightValue = getSortValue(right, sort.key);
        if (leftValue === null)
            return rightValue === null ? 0 : 1;
        if (rightValue === null)
            return -1;
        return (leftValue - rightValue) * multiplier;
    });
}
