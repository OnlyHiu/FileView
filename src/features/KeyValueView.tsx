// 键值结构视图：YAML / TOML 的层级键路径一览（轻量行解析，容错友好）

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";

interface KeyNode {
  /** 缩进层级 */
  depth: number;
  /** 完整键路径 */
  path: string;
  /** 当前行键名 */
  key: string;
  /** 当前行值（无值时为空） */
  value: string;
  /** 是否是列表项 */
  isItem: boolean;
}

function stripComment(line: string): string {
  let inQuote = false;
  let quoteCh = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === quoteCh) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteCh = ch;
      continue;
    }
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function parseYaml(text: string): KeyNode[] {
  const out: KeyNode[] = [];
  const stack: { indent: number; path: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    const isItem = body.startsWith("- ");
    const content = isItem ? body.slice(2) : body;
    const m = /^([^:]+):\s*(.*)$/.exec(content);
    if (!m) continue;
    const key = m[1].trim().replace(/^["']|["']$/g, "");
    const value = m[2].trim();
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].path : "";
    const path = parent ? `${parent}.${key}` : key;
    out.push({ depth: stack.length, path, key, value, isItem });
    if (!value) stack.push({ indent, path });
  }
  return out;
}

function parseToml(text: string): KeyNode[] {
  const out: KeyNode[] = [];
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const table = /^\[\[?([^\]]*)\]?\]$/.exec(line.trim());
    if (table) {
      section = table[1].trim();
      out.push({ depth: 0, path: section, key: section, value: "", isItem: false });
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].trim().replace(/^["']|["']$/g, "");
    const value = kv[2].trim();
    const path = section ? `${section}.${key}` : key;
    out.push({ depth: section ? 1 : 0, path, key, value, isItem: false });
  }
  return out;
}

export const KeyValueView: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const fileKind = useJsonStore((s) => s.fileKind);
  const tab = tabs.find((t) => t.id === activeTabId);
  const text = tab?.text ?? "";

  const nodes = useMemo(
    () => (fileKind === "toml" ? parseToml(text) : parseYaml(text)),
    [text, fileKind]
  );

  if (!nodes.length) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary">
        未解析到键值结构
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto py-1">
      {nodes.map((n, i) => (
        <div
          key={`${n.path}-${i}`}
          className="flex items-baseline gap-2 px-3 py-1 hover:bg-smoke-bg-card-hover"
          style={{ paddingLeft: 12 + n.depth * 14 }}
        >
          <span className="text-[12px] text-ink-tertiary truncate max-w-[55%]">{n.path}</span>
          {n.value && (
            <>
              <span className="text-[12px] text-ink-tertiary">=</span>
              <span className="text-[12px] text-ink truncate">{n.value}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
};
