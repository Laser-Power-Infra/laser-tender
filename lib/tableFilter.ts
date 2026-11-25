// Row filtering shared by components/FilterTable.tsx: a search over all columns, a search per column and a value list per column.
export const BLANK = "(Blank)";

/** Indexes of the rows that pass. `skipCol` ignores that column's value list (used to build its own dropdown options). */
export function filterRows(texts: string[][], q: string, searches: string[], selected: string[][], skipCol = -1): number[] {
  const all = q.trim().toLowerCase();
  const per = searches.map(s => (s ?? "").trim().toLowerCase());
  const sets = selected.map((s, c) => (c !== skipCol && s?.length ? new Set(s) : null));
  const out: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const row = texts[i];
    if (all && !row.some(v => v.toLowerCase().includes(all))) continue;
    let ok = true;
    for (let c = 0; ok && c < row.length; c++) {
      if (per[c] && !row[c].toLowerCase().includes(per[c])) ok = false;
      else if (sets[c] && !sets[c]!.has(row[c].trim() === "" ? BLANK : row[c])) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

/** Distinct values of one column over the given rows, sorted, with "(Blank)" first when a cell is empty. */
export function columnOptions(texts: string[][], rowIndexes: number[], col: number): string[] {
  const set = new Set<string>();
  let blank = false;
  for (const i of rowIndexes) { const v = texts[i][col]; if (v.trim() === "") blank = true; else set.add(v); }
  const out = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return blank ? [BLANK, ...out] : out;
}
