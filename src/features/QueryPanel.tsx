// 查询页：JSONPath 查询 + 全文搜索结果

import React from "react";
import { useJsonStore } from "../stores/jsonStore";
import { Button, TextInput, InfoBar, Icon, SectionHeader, Card } from "../components/ui";

export const QueryPanel: React.FC = () => {
  const queryExpr = useJsonStore((s) => s.queryExpr);
  const setQueryExpr = useJsonStore((s) => s.setQueryExpr);
  const runQuery = useJsonStore((s) => s.runQuery);
  const queryHits = useJsonStore((s) => s.queryHits);
  const queryError = useJsonStore((s) => s.queryError);
  const expandTo = useJsonStore((s) => s.expandTo);
  const result = useJsonStore((s) => s.result);

  const searchQuery = useJsonStore((s) => s.searchQuery);
  const setSearch = useJsonStore((s) => s.setSearch);
  const runSearch = useJsonStore((s) => s.runSearch);
  const searchHits = useJsonStore((s) => s.searchHits);
  const searchInKeys = useJsonStore((s) => s.searchInKeys);
  const searchInValues = useJsonStore((s) => s.searchInValues);
  const toggleSearchScope = useJsonStore((s) => s.toggleSearchScope);

  const nodeByPath = (p: string) => result?.nodes.find((n) => n.path === p);
  const nodeById = (id: number) => result?.nodes.find((n) => n.id === id);

  return (
    <div className="h-full overflow-auto p-5">
      <SectionHeader
        title="查询与搜索"
        subtitle="使用 JSONPath 定位节点，或全文搜索键 / 值"
      />

      {/* JSONPath */}
      <Card
        icon="search"
        title="JSONPath 查询"
        description="支持 $.key、['key']、[n]、[*]、..key（递归下降）"
        actions={
          <Button variant="accent" icon="play" onClick={() => void runQuery()}>
            执行
          </Button>
        }
      >
        <TextInput
          icon="search"
          value={queryExpr}
          placeholder="例如：$.store.book[*].title"
          onChange={(e) => setQueryExpr(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void runQuery()}
        />
        {queryError && (
          <div className="mt-2">
            <InfoBar type="error" title="查询语法错误">
              {queryError}
            </InfoBar>
          </div>
        )}
        {!queryError && queryHits.length > 0 && (
          <div className="mt-3 border border-stroke rounded-md divide-y divide-stroke/60 max-h-72 overflow-auto">
            {queryHits.map((p) => {
              const n = nodeByPath(p);
              return (
                <button
                  key={p}
                  onClick={() => n && expandTo(n.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left fluent-item"
                >
                  <Icon name="link" size={13} className="text-accent-text shrink-0" />
                  <span className="font-mono text-[12px] text-ink truncate flex-1">{p}</span>
                  {n && (
                    <span className="font-mono text-[11px] text-ink-tertiary shrink-0 max-w-[180px] truncate">
                      {n.value}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {!queryError && queryHits.length === 0 && (
          <div className="mt-2 text-[12px] text-ink-tertiary">尚无结果</div>
        )}
      </Card>

      {/* 全文搜索 */}
      <Card
        icon="search"
        title="全文搜索"
        description="在键名 / 值中搜索（不区分大小写），点击结果跳转到树形视图"
        actions={
          <Button variant="accent" icon="play" onClick={runSearch}>
            搜索
          </Button>
        }
      >
        <div className="flex items-center gap-3">
          <TextInput
            icon="search"
            className="flex-1"
            value={searchQuery}
            placeholder="输入关键字…"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
            <input
              type="checkbox"
              checked={searchInKeys}
              onChange={() => toggleSearchScope("keys")}
              className="accent-[var(--accent)]"
            />
            键
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
            <input
              type="checkbox"
              checked={searchInValues}
              onChange={() => toggleSearchScope("values")}
              className="accent-[var(--accent)]"
            />
            值
          </label>
        </div>
        <div className="mt-2 text-[12px] text-ink-tertiary">
          {searchHits.length > 0 ? `命中 ${searchHits.length} 个节点` : "尚无结果"}
        </div>
        {searchHits.length > 0 && (
          <div className="mt-2 border border-stroke rounded-md divide-y divide-stroke/60 max-h-72 overflow-auto">
            {searchHits.slice(0, 200).map((id) => {
              const n = nodeById(id);
              if (!n) return null;
              return (
                <button
                  key={id}
                  onClick={() => expandTo(id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left fluent-item"
                >
                  <span className="font-mono text-[12px] syn-key shrink-0">
                    {n.key ?? "root"}
                  </span>
                  <span className="text-ink-tertiary">→</span>
                  <span
                    className={`font-mono text-[12px] truncate flex-1 ${
                      n.kind === "string"
                        ? "syn-string"
                        : n.kind === "number"
                          ? "syn-number"
                          : "text-ink"
                    }`}
                  >
                    {n.value.length > 80 ? n.value.slice(0, 80) + "…" : n.value}
                  </span>
                  <span className="text-[11px] text-ink-tertiary shrink-0">{n.path}</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
