// 空白文档空状态：只提供「打开文件」按钮（拖拽 / 粘贴仍然可用）

import React, { useEffect } from "react";
import { useJsonStore } from "../stores/jsonStore";
import { Button, Icon } from "../components/ui";

export const EmptyState: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const setEditorText = useJsonStore((s) => s.setEditorText);
  const setView = useJsonStore((s) => s.setView);

  // 直接粘贴内容 → 进入源码/文本编辑
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      e.preventDefault();
      setEditorText(text);
      setView("raw");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [setEditorText, setView]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 text-ink-tertiary">
      <Icon name="file" size={44} />
      <div className="text-[13px]">打开或拖拽文件到窗口，也可直接粘贴内容</div>
      <Button variant="accent" icon="open" onClick={onOpen}>
        打开文件
      </Button>
    </div>
  );
};
