// Markdown 预览：基于 lib/markdown 的轻量渲染（标题/代码/列表/引用/表格/链接/HTML 直通）

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { isTauri, readFileText } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { resolveRelativePath } from "../lib/paths";

export const MarkdownPreview: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const loadFile = useJsonStore((s) => s.loadFile);
  const setStatus = useJsonStore((s) => s.setStatus);
  const tab = tabs.find((t) => t.id === activeTabId);
  const text = tab?.text ?? "";
  const html = useMemo(() => renderMarkdown(text), [text]);

  /**
   * 链接点击：
   *   · http(s) / mailto → 交给系统浏览器（绝不让 webview 导航走）；
   *   · 相对路径 → 相对当前文档所在目录解析后，在应用内打开；
   *   · 锚点 → 留在文档内（暂不跳转）。
   */
  const onClick = async (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const url = a.getAttribute("href") ?? "";
    if (!url) return;
    if (/^(?:https?:|mailto:)/i.test(url)) {
      if (isTauri()) {
        void import("@tauri-apps/plugin-opener")
          .then((m) => m.openUrl(url))
          .catch(() => {});
      } else {
        window.open(url, "_blank", "noopener");
      }
      return;
    }
    if (url.startsWith("#")) return; // 文档内锚点：留在文档内
    const base = tab?.path;
    if (!base) {
      setStatus("相对链接需要先保存当前文档，才能确定所在目录");
      return;
    }
    const target = resolveRelativePath(base, url);
    if (!target) {
      setStatus(`无法解析链接：${url}`);
      return;
    }
    try {
      const payload = await readFileText(target);
      loadFile(payload.path, payload.text);
      setStatus(`已打开：${payload.path}`);
    } catch (err) {
      setStatus(`无法打开链接目标 ${target}：${err}`);
    }
  };

  return (
    <div
      className="h-full overflow-auto selectable"
      style={{ fontSize: "var(--json-font-size)" }}
      onClick={(e) => void onClick(e)}
    >
      <div className="markdown-body px-6 py-4" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};
