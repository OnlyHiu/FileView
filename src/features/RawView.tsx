// 原始/源码/文本视图：复用 SourceEditor（可编辑，Ctrl+S 保存）+ JSON 诊断标注

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { SourceEditor } from "./SourceEditor";
import { kindFromPath, langFromPath } from "../lib/types";

export const RawView: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const setEditorText = useJsonStore((s) => s.setEditorText);
  const result = useJsonStore((s) => s.result);
  const tab = tabs.find((t) => t.id === activeTabId);
  const text = tab?.text ?? "";
  const path = tab?.path ?? null;

  const lang = langFromPath(path);
  const isJson = kindFromPath(path) === "json";

  // 错误行标注仅对 JSON（其他类型不解析、无诊断）
  const errorLines = useMemo(() => {
    const set = new Map<number, string>();
    if (!isJson) return set;
    for (const d of result?.diagnostics ?? []) {
      if (d.severity === "error") set.set(d.line, d.message);
    }
    return set;
  }, [result, isJson]);

  return <SourceEditor text={text} lang={lang} onChange={setEditorText} errorLines={errorLines} />;
};
