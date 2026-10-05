// Canonical text layout for data files: top-level keys pretty-printed, one item per line.
// Shared by the in-browser editor (exports) and tools/format-data.mjs so diffs stay small.

function inline(value) {
  return JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ');
}

export function formatDataset(dataset) {
  const { items = [], ...rest } = dataset;
  const lines = Object.entries(rest).map(([key, value]) => `  ${JSON.stringify(key)}: ${inline(value)}`);
  const body = items.length ? `[\n${items.map((item) => `    ${inline(item)}`).join(',\n')}\n  ]` : '[]';
  lines.push(`  "items": ${body}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
