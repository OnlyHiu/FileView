// Markdown 预览：基于 lib/markdown 的轻量渲染（标题/代码/列表/引用/表格/链接/HTML 直通）

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { isTauri } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

export const MarkdownPreview: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const text = tabs.find((t) => t.id === activeTabId)?.text ?? "";
  const html = useMemo(() => renderMarkdown(text), [text]);

  // 链接用系统浏览器打开，避免 webview 被导航走
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const url = a.getAttribute("href") ?? "";
    if (!url || url === "#") return;
    if (isTauri()) {
      void import("@tauri-apps/plugin-opener")
        .then((m) => m.openUrl(url))
        .catch(() => {});
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div
      className="h-full overflow-auto selectable"
      style={{ fontSize: "var(--json-font-size)" }}
      onClick={onClick}
    >
      <div className="markdown-body px-6 py-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};
