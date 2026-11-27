export function selectAnswerContext(sources, limit = 12) {
  if (!Array.isArray(sources) || !Number.isInteger(limit) || limit < 1) return [];
  const selected = [];
  const seenUnits = new Set();

  // Search results put the strongest result for each requested unit first.
  // Preserve that coverage before filling the remaining context by rank.
  for (const source of sources) {
    if (!source?.unit || seenUnits.has(source.unit)) continue;
    if (selected.length >= limit) break;
    selected.push(source);
    seenUnits.add(source.unit);
  }
  for (const source of sources) {
    if (selected.length >= limit) break;
    if (!selected.includes(source)) selected.push(source);
  }
  return selected;
}
