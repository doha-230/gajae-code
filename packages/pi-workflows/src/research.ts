export interface Measurement {
	count: number;
	min: number;
	max: number;
	mean: number;
	median: number;
	standardDeviation: number;
}

export function measureJson(data: unknown, field?: string): Measurement {
	if (!Array.isArray(data) || data.length === 0) throw new Error("Research data must be a non-empty JSON array");
	const values = data.map((row, index) => {
		const value: unknown = field
			? row && typeof row === "object"
				? (row as Record<string, unknown>)[field]
				: undefined
			: row;
		if (typeof value !== "number" || !Number.isFinite(value))
			throw new Error(`Row ${index + 1} has no finite numeric ${field ?? "value"}`);
		return value;
	});
	values.sort((a, b) => a - b);
	const count = values.length;
	const mean = values.reduce((sum, value) => sum + value, 0) / count;
	const median = count % 2 ? values[(count - 1) / 2]! : (values[count / 2 - 1]! + values[count / 2]!) / 2;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
	return { count, min: values[0]!, max: values[count - 1]!, mean, median, standardDeviation: Math.sqrt(variance) };
}
