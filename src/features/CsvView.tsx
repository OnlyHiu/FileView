// CSV / TSV 表格视图：按分隔符切分列，首行为表头

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { splitCsvLine } from "../lib/highlight";

const MAX_ROWS = 2000;

export const CsvView: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const text = tab?.text ?? "";
  const isTsv = /\.tsv$/i.test(tab?.path ?? "");

  const { headers, rows, delimiter } = useMemo(() => {
    const lines = text.split(/\r?\n/);
    const sep = isTsv ? "\t" : ",";
    const head = lines.length ? splitCsvLine(lines[0], sep) : [];
    const body: string[][] = [];
    for (let i = 1; i < lines.length && body.length < MAX_ROWS; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      body.push(splitCsvLine(line, sep));
    }
    return { headers: head, rows: body, delimiter: sep };
  }, [text, isTsv]);

  if (!headers.length) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary">
        暂无可展示的表格数据
      </div>
    );
  }

  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));

  return (
    <div className="h-full overflow-auto">
      <table className="text-[12px] border-collapse select-none">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 bg-smoke-bg-subtle border-b border-r border-stroke px-2 py-1.5 text-left text-ink-secondary font-medium">
              #
            </th>
            {Array.from({ length: colCount }, (_, c) => (
              <th
                key={c}
                className="bg-smoke-bg-subtle border-b border-r border-stroke px-3 py-1.5 text-left text-ink-secondary font-medium whitespace-nowrap"
              >
                {headers[c] ?? `列 ${c + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="hover:bg-smoke-bg-card-hover">
              <td className="sticky left-0 z-10 bg-smoke-bg-subtle border-b border-r border-stroke px-2 py-1 text-ink-tertiary tabular-nums">
                {r + 1}
              </td>
              {Array.from({ length: colCount }, (_, c) => (
                <td
                  key={c}
                  className="border-b border-r border-stroke/60 px-3 py-1 text-ink whitespace-nowrap max-w-[420px] truncate"
                >
                  {row[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-ink-tertiary">
        {rows.length} 行 · {colCount} 列 · 分隔符 {delimiter === "\t" ? "制表符" : "逗号"}
        {rows.length >= MAX_ROWS ? "（已截断显示前 2000 行）" : ""}
      </div>
    </div>
  );
};
