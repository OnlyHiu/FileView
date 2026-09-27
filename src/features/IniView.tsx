// INI 结构视图：分组展示 [section] 与键值对

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { Icon } from "../components/ui";

interface IniEntry {
  key: string;
  value: string;
}

interface IniSection {
  name: string;
  entries: IniEntry[];
}

function parseIni(text: string): IniSection[] {
  const sections: IniSection[] = [{ name: "全局", entries: [] }];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sec = /^\[([^\]]*)\]$/.exec(line);
    if (sec) {
      sections.push({ name: sec[1] || "(未命名)", entries: [] });
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv) {
      sections[sections.length - 1].entries.push({ key: kv[1].trim(), value: kv[2].trim() });
    } else {
      sections[sections.length - 1].entries.push({ key: line, value: "" });
    }
  }
  return sections.filter((s) => s.entries.length > 0 || s.name !== "全局");
}

export const IniView: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const text = tabs.find((t) => t.id === activeTabId)?.text ?? "";
  const sections = useMemo(() => parseIni(text), [text]);

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-tertiary gap-2">
        <Icon name="folder" size={32} />
        <span className="text-[13px]">无配置项 — 未解析到 [section] 或 key=value</span>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto selectable"
      style={{ fontSize: "var(--json-font-size)" }}
    >
      <div className="p-4 flex flex-col gap-3">
        {sections.map((sec, i) => (
          <div key={i} className="border border-stroke rounded-md overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-smoke-bg-card border-b border-stroke">
              <Icon name="folder" size={13} className="text-accent-text" />
              <span className="syn-section font-mono">{sec.name}</span>
              <span className="text-[11px] text-ink-tertiary">{sec.entries.length} 项</span>
            </div>
            <div className="divide-y divide-stroke/50">
              {sec.entries.map((e, j) => (
                <div key={j} className="flex items-baseline gap-3 px-3 py-1.5">
                  <span className="syn-keyname font-mono shrink-0 max-w-[40%] truncate" title={e.key}>
                    {e.key}
                  </span>
                  <span className="syn-punct shrink-0">=</span>
                  <span className="syn-string font-mono truncate flex-1" title={e.value}>
                    {e.value || <span className="text-ink-tertiary">（空）</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
