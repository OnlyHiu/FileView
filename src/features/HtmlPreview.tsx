// HTML 预览：在沙箱 iframe 中渲染，禁用脚本与表单提交

import React, { useMemo, useState } from "react";
import { useJsonStore } from "../stores/jsonStore";

export const HtmlPreview: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const text = tabs.find((t) => t.id === activeTabId)?.text ?? "";
  const [failed, setFailed] = useState(false);

  const src = useMemo(() => text, [text]);

  if (!src.trim()) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary">
        空白文档
      </div>
    );
  }

  if (failed) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary px-4 text-center">
        预览渲染失败，可切换到「源码」查看原始内容
      </div>
    );
  }

  return (
    <iframe
      title="HTML 预览"
      srcDoc={src}
      sandbox=""
      onError={() => setFailed(true)}
      className="w-full h-full bg-white border-0"
    />
  );
};
