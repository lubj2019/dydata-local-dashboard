function firstValue(values) {
    return values.find((value) => value !== null) ?? null;
}
function sumValues(values) {
    const present = values.filter((value) => value !== null);
    return present.length ? present.reduce((total, value) => total + value, 0) : null;
}
export function groupTaskRows(rows) {
    const grouped = new Map();
    for (const row of rows) {
        const groupId = JSON.stringify([row.accountId, row.missionId]);
        const items = grouped.get(groupId) ?? [];
        items.push(row);
        grouped.set(groupId, items);
    }
    return [...grouped.entries()].map(([groupId, items]) => {
        const task = items[0];
        return {
            groupId,
            task,
            videos: items.filter((item) => item.videoId),
            taskEstimate: firstValue(items.map((item) => item.missionEstimatedAmount)) ?? firstValue(items.map((item) => item.predictedAmount)),
            yesterdayTaskPredictedAmount: firstValue(items.map((item) => item.yesterdayTaskPredictedAmount)),
            todayPredictedDelta: sumValues(items.map((item) => item.todayPredictedDelta)),
            xingtuPlayCount: sumValues(items.map((item) => item.xingtuPlayCount)),
            actualPlayCount: sumValues(items.map((item) => item.actualPlayCount)),
            playDelta: sumValues(items.map((item) => item.playDelta)),
            settledAmount: sumValues(items.map((item) => item.settledAmount))
        };
    });
}
