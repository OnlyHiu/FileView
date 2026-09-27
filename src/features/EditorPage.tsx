// 编辑器页（左侧导航）：编辑当前文件；无文件时为可直接输入的空白编辑页
// Ctrl+S / 保存按钮写回磁盘，未命名文档弹「另存为」

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { SourceEditor } from "./SourceEditor";
import { Button, Tooltip } from "../components/ui";
import { kindFromPath, kindLabel, langFromPath } from "../lib/types";

export const EditorPage: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const setEditorText = useJsonStore((s) => s.setEditorText);
  const result = useJsonStore((s) => s.result);
  const parseMode = useJsonStore((s) => s.parseMode);
  const setParseMode = useJsonStore((s) => s.setParseMode);
  const saveFile = useJsonStore((s) => s.saveFile);
  const applyFormat = useJsonStore((s) => s.applyFormat);
  const applyMinify = useJsonStore((s) => s.applyMinify);
  const applySort = useJsonStore((s) => s.applySort);

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
    <>
      {/* 编辑器工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-stroke/60 shrink-0">
        <Button icon="open" onClick={onOpen}>
          打开文件
        </Button>
        <Tooltip text="保存 (Ctrl+S)">
          <Button icon="save" variant="accent" onClick={() => void saveFile()}>
            保存
          </Button>
        </Tooltip>
        {isJson && (
          <>
            <div className="w-px h-5 bg-stroke" />
            <Tooltip text="格式化 (Ctrl+Shift+F)">
              <Button icon="code" onClick={() => void applyFormat()}>
                格式化
              </Button>
            </Tooltip>
            <Button icon="play" onClick={() => void applyMinify()}>
              压缩
            </Button>
            <Button icon="copy" onClick={() => void applySort()}>
              键排序
            </Button>
          </>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-ink-tertiary">
          {tab?.path ? kindLabel(kind) : "未命名"}
        </span>
        {isJson && (
          <select
            value={parseMode}
            onChange={(e) => setParseMode(e.target.value as typeof parseMode)}
            className="h-8 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[12px] px-2"
          >
            <option value="strict">严格 JSON</option>
            <option value="jsonc">JSONC（注释/尾逗号）</option>
            <option value="jsonl">JSONL（逐行）</option>
          </select>
        )}
      </div>

      {/* 编辑区（空白文档也可直接输入） */}
      <div className="flex-1 min-h-0">
        <SourceEditor text={text} lang={langFromPath(path)} onChange={setEditorText} errorLines={errorLines} />
      </div>
    </>
  );
};
