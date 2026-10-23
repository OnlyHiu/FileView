// 编辑器页：编辑当前文件；无文件时为可直接输入的空白编辑页
// 保存 / 格式化等动作位于顶部工具栏与菜单栏

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { SourceEditor } from "./SourceEditor";
import { kindFromPath, langFromPath } from "../lib/types";

export const EditorPage: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const setEditorText = useJsonStore((s) => s.setEditorText);
  const result = useJsonStore((s) => s.result);

  const tab = tabs.find((t) => t.id === activeTabId);
  const text = tab?.text ?? "";
  const path = tab?.path ?? null;
  const kind = kindFromPath(path);
  const isJson = kind === "json";

  // 编辑时同步标出 JSON 语法错误行
  const errorLines = useMemo(() => {
    const set = new Map<number, string>();
    if (!isJson) return set;
    for (const d of result?.diagnostics ?? []) {
      if (d.severity === "error") set.set(d.line, d.message);
    }
    return set;
  }, [result, isJson]);

  return (
    <div className="flex-1 min-h-0">
      <SourceEditor
        text={text}
        lang={langFromPath(path)}
        onChange={setEditorText}
        errorLines={errorLines}
      />
    </div>
  );
};
