// 表格视图：根为对象数组时按列展示

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import type { FlatNode } from "../lib/types";
import { Icon, InfoBar, Button } from "../components/ui";

const MAX_ROWS = 500;

export const TableView: React.FC = () => {
  const result = useJsonStore((s) => s.result);
  const setView = useJsonStore((s) => s.setView);

  const data = useMemo(() => {
    if (!result || result.nodes.length === 0) return null;
    const nodes = result.nodes;
    const root = nodes[0];
    if (!root || root.kind !== "array" || root.child_count === 0) return null;
    // 一次遍历建父子索引，避免每行/每格线性扫描全部节点
    const childrenOf = new Map<number, FlatNode[]>();
    for (const n of nodes) {
      if (n.parent === null) continue;
      const list = childrenOf.get(n.parent);
      if (list) list.push(n);
      else childrenOf.set(n.parent, [n]);
    }
    const rows = childrenOf.get(root.id) ?? [];
    if (!rows.every((r) => r.kind === "object")) return null;
    const columns: string[] = [];
    const seen = new Set<string>();
    const rowCells = new Map<number, Map<string, FlatNode>>();
    for (const row of rows) {
      const cells = new Map<string, FlatNode>();
      for (const c of childrenOf.get(row.id) ?? []) {
        if (c.key === null) continue;
        if (!seen.has(c.key)) {
          seen.add(c.key);
          columns.push(c.key);
        }
        cells.set(c.key, c);
      }
      rowCells.set(row.id, cells);
    }
    const cellValue = (row: FlatNode, col: string): FlatNode | undefined =>
      rowCells.get(row.id)?.get(col);
    return { rows, columns, cellValue };
  }, [result]);

  if (!result) return null;

  if (!data) {
    return (
      <div className="p-4">
        <InfoBar type="info" title="当前文档不是对象数组">
          表格视图要求根节点为「对象数组」（每行一个对象）。请切换到
          <Button variant="subtle" onClick={() => setView("tree")} className="px-1 h-auto">
            树形视图
          </Button>
          或
          <Button variant="subtle" onClick={() => setView("raw")} className="px-1 h-auto">
            原始视图
          </Button>
          。
        </InfoBar>
      </div>
    );
  }

  const { rows, columns, cellValue } = data;
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div className="h-full overflow-auto selectable">
      <table
        className="w-full border-collapse"
        style={{ fontSize: "var(--json-font-size)" }}
      >
        <thead className="sticky top-0 z-10">
          <tr className="bg-smoke-bg-card">
            <th className="text-left font-medium text-ink-secondary px-3 py-2 border-b border-stroke w-12">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col}
                className="text-left font-medium text-ink-secondary px-3 py-2 border-b border-stroke whitespace-nowrap"
              >
                <span className="syn-key font-mono">{col}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, idx) => (
            <tr key={row.id} className="fluent-item border-b border-stroke/50">
              <td className="px-3 py-1.5 text-ink-tertiary font-mono">{idx + 1}</td>
              {columns.map((col) => {
                const cell = cellValue(row, col);
                return (
                  <td key={col} className="px-3 py-1.5 text-ink font-mono max-w-[280px] truncate">
                    {cell ? (
                      <span
                        className={
                          cell.kind === "string"
                            ? "syn-string"
                            : cell.kind === "number"
                              ? "syn-number"
                              : cell.kind === "boolean"
                                ? "syn-bool"
                                : cell.kind === "null"
                                  ? "syn-null"
                                  : "text-ink-tertiary"
                        }
                      >
                        {cell.value.length > 80 ? cell.value.slice(0, 80) + "…" : cell.value}
                      </span>
                    ) : (
                      <span className="text-ink-tertiary">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && (
        <div className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary">
          <Icon name="info" size={14} />
          共 {rows.length} 行，表格视图仅渲染前 {MAX_ROWS} 行；完整数据请使用树形视图。
        </div>
      )}
    </div>
  );
};
