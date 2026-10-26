// XML 结构视图：轻量标签树（属性以键值展示，容错处理不闭合标签）

import React, { useMemo } from "react";
import { useJsonStore } from "../stores/jsonStore";

interface XmlNode {
  id: number;
  name: string;
  attrs: [string, string][];
  text: string;
  children: XmlNode[];
}

const TAG_RE = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export const XmlView: React.FC = () => {
  const tabs = useJsonStore((s) => s.tabs);
  const activeTabId = useJsonStore((s) => s.activeTabId);
  const text = tabs.find((t) => t.id === activeTabId)?.text ?? "";

  const root = useMemo(() => parseXml(text), [text]);

  if (!root) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-ink-tertiary">
        未解析到 XML 标签
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto py-1">
      <XmlRow node={root} depth={0} />
    </div>
  );
};

function parseXml(text: string): XmlNode | null {
  let counter = 0;
  const root: XmlNode = { id: counter++, name: "(根)", attrs: [], text: "", children: [] };
  const stack: XmlNode[] = [root];
  let lastIndex = 0;

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text))) {
    const [full, closing, name, attrText, selfClose] = m;
    const parent = stack[stack.length - 1];
    // 标签之间的文本内容
    const between = text.slice(lastIndex, m.index).trim();
    if (between && parent) parent.text = between;
    lastIndex = m.index + full.length;

    if (closing) {
      // 闭合标签：回退到对应开标签
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const attrs: [string, string][] = [];
    ATTR_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ATTR_RE.exec(attrText))) {
      attrs.push([am[1], am[2] ?? am[3] ?? ""]);
    }
    const node: XmlNode = { id: counter++, name, attrs, text: "", children: [] };
    parent.children.push(node);
    if (!selfClose) stack.push(node);
  }
  const tail = text.slice(lastIndex).trim();
  if (tail && stack.length === 1) root.text = tail;
  return root.children.length || root.text ? root : null;
}

const XmlRow: React.FC<{ node: XmlNode; depth: number }> = ({ node, depth }) => (
  <>
    <div
      className="flex items-baseline gap-2 px-3 py-1 hover:bg-smoke-bg-card-hover"
      style={{ paddingLeft: 12 + depth * 14 }}
    >
      <span className="text-[12px] text-syn-tag font-medium">&lt;{node.name}&gt;</span>
      {node.attrs.map(([k, v]) => (
        <span key={k} className="text-[11px] text-ink-tertiary">
          {k}=<span className="text-syn-string">{v}</span>
        </span>
      ))}
      {node.text && !node.children.length && (
        <span className="text-[12px] text-ink truncate">{node.text}</span>
      )}
    </div>
    {node.children.map((c) => (
      <XmlRow key={c.id} node={c} depth={depth + 1} />
    ))}
  </>
);
