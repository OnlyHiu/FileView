// 代码大纲视图：按语言提取函数 / 类 / 结构定义，形成可点击的符号列表

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { langFromPath } from "../lib/types";

interface OutlineItem {
  name: string;
  /** 关键字（class / def / function …） */
  keyword: string;
  /** 缩进层级 */
  depth: number;
  line: number;
}

interface Rule {
  re: RegExp;
  keyword: string;
}

const RULES: Record<string, Rule[]> = {
  python: [{ re: /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/, keyword: "" }],
  javascript: [
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?class\s+([A-Za-z_$][\w$]*)/, keyword: "class" },
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, keyword: "function" },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, keyword: "" },
  ],
  typescript: [
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, keyword: "class" },
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, keyword: "function" },
    { re: /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, keyword: "" },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/, keyword: "" },
  ],
  rust: [
    { re: /^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl|mod)\s+([A-Za-z_]\w*)/, keyword: "" },
  ],
  go: [
    { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, keyword: "func" },
    { re: /^\s*type\s+([A-Za-z_]\w*)/, keyword: "type" },
  ],
  java: [
    { re: /^\s*(?:public|private|protected|static|final|abstract|\s)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/, keyword: "" },
    { re: /^\s*(?:public|private|protected|static|final|synchronized|\s)+\w[\w<>\[\],. ]*\s+([A-Za-z_]\w*)\s*\(/, keyword: "" },
  ],
  csharp: [
    { re: /^\s*(?:public|private|protected|internal|static|sealed|abstract|partial|\s)*(class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/, keyword: "" },
    { re: /^\s*(?:public|private|protected|internal|static|virtual|override|async|\s)+\w[\w<>\[\],. ]*\s+([A-Za-z_]\w*)\s*\(/, keyword: "" },
  ],
  cpp: [
    { re: /^\s*(?:class|struct|enum|union|namespace)\s+([A-Za-z_]\w*)/, keyword: "" },
    { re: /^\s*[\w:<>,*&\[\]]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const)?\s*\{/, keyword: "" },
  ],
  kotlin: [
    { re: /^\s*(?:private\s+|public\s+|internal\s+|open\s+|abstract\s+)*(?:class|object|interface|enum class|fun)\s+([A-Za-z_]\w*)/, keyword: "" },
  ],
  swift: [
    { re: /^\s*(?:public\s+|private\s+|internal\s+|open\s+|final\s+)*(?:class|struct|enum|protocol|extension|func)\s+([A-Za-z_]\w*)/, keyword: "" },
  ],
  php: [
    { re: /^\s*(?:final\s+|abstract\s+|public\s+|private\s+|protected\s+|static\s+)*function\s+([A-Za-z_]\w*)/, keyword: "function" },
    { re: /^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/, keyword: "class" },
  ],
  ruby: [
    { re: /^\s*(?:def|class|module)\s+([A-Za-z_][\w?!=]*)/, keyword: "" },
  ],
  shell: [{ re: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/, keyword: "" }],
  powershell: [
    { re: /^\s*function\s+([A-Za-z_][\w-]*)/, keyword: "function" },
  ],
  sql: [{ re: /^\s*create\s+(?:or\s+replace\s+)?(?:table|view|index|function)\s+([A-Za-z_][\w.]*)/, keyword: "" }],
  lua: [{ re: /^\s*(?:local\s+)?function\s+([A-Za-z_]\w*)/, keyword: "" }],
  dart: [
    { re: /^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/, keyword: "class" },
    { re: /^\s*[\w<>?,\s]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*)?\{/, keyword: "" },
  ],
  css: [{ re: /^\s*([.#]?[A-Za-z_][\w-]*)\s*\{/, keyword: "" }],
};

function extract(text: string, lang: string): OutlineItem[] {
  const rules = RULES[lang];
  if (!rules) return [];
  const out: OutlineItem[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (m) {
        const name = m[m.length - 1];
        const keyword = rule.keyword || m[1] || "";
        out.push({
          name,
          keyword,
          depth: Math.min(4, Math.floor((line.length - line.trimStart().length) / 2)),
          line: idx + 1,
        });
        return;
      }
    }
  });
  return out;
}

export const OutlineView: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const text = tab?.text ?? "";
  const lang = langFromPath(tab?.path ?? null);

  const items = useMemo(() => extract(text, lang), [text, lang]);

  if (!items.length) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary px-4 text-center">
        未在当前文件中找到符号定义
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto py-1">
      {items.map((it, i) => (
        <div
          key={`${it.name}-${it.line}-${i}`}
          className="flex items-baseline gap-2 px-3 py-1 hover:bg-smoke-bg-card-hover"
          style={{ paddingLeft: 12 + it.depth * 14 }}
        >
          {it.keyword && <span className="text-[11px] text-syn-keyword">{it.keyword}</span>}
          <span className="text-[12px] text-ink truncate">{it.name}</span>
          <span className="text-[11px] text-ink-tertiary ml-auto tabular-nums">{it.line}</span>
        </div>
      ))}
    </div>
  );
};
