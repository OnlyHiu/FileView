// 树形视图：虚拟滚动 + 折叠 + 选中联动

import React, { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useJsonStore } from "../stores/jsonStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { FlatNode } from "../lib/types";
import { Icon } from "../components/ui";

const BASE_ROW_HEIGHT = 28;

const KIND_ICON: Record<string, string> = {
  object: "folder",
  array: "table",
  string: "code",
  number: "code",
  boolean: "code",
  null: "code",
};

const KIND_COLOR: Record<string, string> = {
  object: "text-accent-text",
  array: "text-accent-text",
  string: "syn-string",
  number: "syn-number",
  boolean: "syn-bool",
  null: "syn-null",
};

export const TreeView: React.FC = () => {
  const result = useJsonStore((s) => s.result);
  const expanded = useJsonStore((s) => s.expanded);
  const selectedId = useJsonStore((s) => s.selectedId);
  const searchHits = useJsonStore((s) => s.searchHits);
  const toggleExpand = useJsonStore((s) => s.toggleExpand);
  const select = useJsonStore((s) => s.select);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  // 行高随字号缩放（默认 14px → 28px）
  const ROW_HEIGHT = Math.max(BASE_ROW_HEIGHT, Math.round((fontSize / 14) * BASE_ROW_HEIGHT));

  const hitSet = useMemo(() => new Set(searchHits), [searchHits]);
  const byId = useMemo(
    () => new Map<number, FlatNode>((result?.nodes ?? []).map((n) => [n.id, n])),
    [result]
  );

  // 计算可见节点（折叠子树不进入列表）
  const visible = useMemo(() => {
    if (!result) return [] as FlatNode[];
    const nodes = result.nodes;
    const childrenOf = new Map<number | null, FlatNode[]>();
    for (const n of nodes) {
      const list = childrenOf.get(n.parent);
      if (list) list.push(n);
      else childrenOf.set(n.parent, [n]);
    }
    const out: FlatNode[] = [];
    const stack = [...(childrenOf.get(null) ?? [])].reverse();
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      if (n.has_children && expanded[n.id]) {
        const kids = childrenOf.get(n.id) ?? [];
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    return out;
  }, [result, expanded]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  // 字号变化导致行高变化时重新测量
  const measure = virtualizer.measure;
  useEffect(() => {
    measure();
  }, [ROW_HEIGHT, measure]);

  if (!result) return null;

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto selectable"
      style={{ fontSize: "var(--json-font-size)" }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const n = visible[vi.index];
          const isSelected = n.id === selectedId;
          const isHit = hitSet.has(n.id);
          const parentKind = n.parent === null ? null : byId.get(n.parent)?.kind ?? null;
          return (
            <div
              key={n.id}
              onClick={() => select(n.id)}
              onDoubleClick={() => n.has_children && toggleExpand(n.id)}
              className={`absolute left-0 top-0 flex items-center gap-1 pr-3 cursor-default fluent-item ${
                isSelected ? "bg-accent-subtle" : ""
              }`}
              style={{
                height: ROW_HEIGHT,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
                paddingLeft: 12 + n.depth * 18,
              }}
            >
              {/* 展开箭头 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (n.has_children) toggleExpand(n.id);
                }}
                className={`w-4 h-4 flex items-center justify-center rounded-sm text-ink-secondary hover:bg-smoke-bg-card-hover ${
                  n.has_children ? "" : "invisible"
                }`}
              >
                <Icon
                  name="chevron"
                  size={11}
                  className={`transition-transform duration-150 ${
                    expanded[n.id] ? "rotate-90" : ""
                  }`}
                />
              </button>

              {/* 类型图标 */}
              <span className={KIND_COLOR[n.kind]}>
                <Icon name={KIND_ICON[n.kind]} size={13} />
              </span>

              {/* 键（数组下标不加引号；对象非法标识符键加单引号） */}
              {n.key !== null && (
                <>
                  <span
                    className={`font-mono syn-key ${isHit ? "bg-warning/30 rounded-sm px-0.5" : ""}`}
                  >
                    {parentKind === "array"
                      ? n.key
                      : /^[A-Za-z_$][\w$]*$/.test(n.key)
                        ? n.key
                        : `'${n.key}'`}
                  </span>
                  <span className="syn-punct">:</span>
                </>
              )}

              {/* 值 */}
              <span
                className={`font-mono truncate ${KIND_COLOR[n.kind]} ${
                  isHit ? "bg-warning/30 rounded-sm px-0.5" : ""
                }`}
              >
                {n.value.length > 120 ? n.value.slice(0, 120) + "…" : n.value}
              </span>

              {/* 子项计数 */}
              {n.has_children && (
                <span className="text-[11px] text-ink-tertiary ml-1 shrink-0">
                  {n.child_count}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {visible.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-ink-tertiary gap-2">
          <Icon name="tree" size={32} />
          <span className="text-[13px]">无数据 — 请打开或粘贴 JSON</span>
        </div>
      )}
    </div>
  );
};
