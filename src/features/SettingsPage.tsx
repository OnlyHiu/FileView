// 设置页：外观 / 编辑器 / 系统集成 / 关于

import React, { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import {
  Button,
  Card,
  Checkbox,
  ComboBox,
  Icon,
  InfoBar,
  SectionHeader,
  Slider,
  ToggleSwitch,
  Badge,
  Dialog,
} from "../components/ui";
import { MENU_TARGETS, SUPPORTED_EXTS, type Settings } from "../lib/types";
import { isTauri } from "../lib/api";

export const SettingsPage: React.FC = () => {
  const {
    settings,
    integration,
    busy,
    message,
    load,
    patch,
    applyContextMenu,
    applyFileAssoc,
    applyAutostart,
    openDefaultApps,
    cleanupAll,
  } = useSettingsStore();

  const [confirmCleanup, setConfirmCleanup] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const themeOptions = [
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
    { value: "system", label: "跟随系统" },
  ];
  const indentOptions = [
    { value: "2", label: "2 空格" },
    { value: "4", label: "4 空格" },
    { value: "tab", label: "Tab" },
  ];
  const startupOptions = [
    { value: "blank", label: "空白页" },
    { value: "recent", label: "最近文件" },
    { value: "last", label: "上次会话" },
  ];

  const menuSelected = new Set(settings.contextMenuTargets);
  const extSelected = new Set(settings.associatedExtensions);

  const menuOnMap = new Map(integration?.context_menu ?? []);
  const extOnMap = new Map(integration?.file_assoc ?? []);

  const toggleMenuTarget = (id: string) => {
    const next = new Set(menuSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void applyContextMenu([...next]);
  };

  const toggleExt = (ext: string) => {
    const next = new Set(extSelected);
    if (next.has(ext)) next.delete(ext);
    else next.add(ext);
    void applyFileAssoc([...next]);
  };

  return (
    <div className="h-full overflow-auto p-5 pb-10">
      <SectionHeader title="设置" subtitle="外观、编辑器与 Windows 系统集成" />

      {!isTauri() && (
        <InfoBar type="info" title="当前为浏览器预览模式">
          系统集成功能仅在 Windows 桌面版中可用。
        </InfoBar>
      )}

      {message && (
        <InfoBar
          type="info"
          title={message}
          onClose={() => useSettingsStore.setState({ message: null })}
        />
      )}

      {/* ============ 外观 ============ */}
      <div className="text-[13px] font-semibold text-ink-secondary mt-4 mb-2">外观</div>
      <Card icon="sun" title="主题" description="选择应用的明暗配色">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-ink-secondary">应用主题</span>
          <ComboBox
            value={settings.theme}
            onChange={(v) => void patch({ theme: v } as Partial<Settings>)}
            options={themeOptions}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[13px] text-ink-secondary">正文字号</span>
          <div className="w-56">
            <Slider
              value={settings.fontSize}
              min={11}
              max={20}
              onChange={(v) => void patch({ fontSize: v } as Partial<Settings>)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="text-[13px] text-ink">Mica 材质背景</div>
            <div className="text-[11px] text-ink-tertiary">
              Windows 11 半透明云母效果（低配设备可关闭）
            </div>
          </div>
          <ToggleSwitch
            checked={settings.mica}
            onChange={(v) => void patch({ mica: v } as Partial<Settings>)}
          />
        </div>
      </Card>

      {/* ============ 编辑器 ============ */}
      <div className="text-[13px] font-semibold text-ink-secondary mt-5 mb-2">编辑器</div>
      <Card icon="code" title="编辑偏好" description="格式化与文件行为">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-ink-secondary">默认缩进</span>
          <ComboBox
            value={settings.indent}
            onChange={(v) => void patch({ indent: v } as Partial<Settings>)}
            options={indentOptions}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[13px] text-ink-secondary">启动时打开</span>
          <ComboBox
            value={settings.startup}
            onChange={(v) => void patch({ startup: v } as Partial<Settings>)}
            options={startupOptions}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="text-[13px] text-ink">文件变更自动重载</div>
            <div className="text-[11px] text-ink-tertiary">监视当前打开文件的外部修改</div>
          </div>
          <ToggleSwitch
            checked={settings.watchFile}
            onChange={(v) => void patch({ watchFile: v } as Partial<Settings>)}
          />
        </div>
      </Card>

      {/* ============ 系统集成 ============ */}
      <div className="text-[13px] font-semibold text-ink-secondary mt-5 mb-2">系统集成</div>

      {/* 右键菜单注入 */}
      <Card
        icon="folder"
        title="Windows 右键菜单注入"
        description="在资源管理器右键菜单中添加「用 FileView 打开」"
        actions={<Badge on={(integration?.context_menu ?? []).some(([, on]) => on)} />}
      >
        <InfoBar type="info" title="菜单位置说明">
          桌面版（NSIS）注入的菜单项显示在 Windows 11 的「显示更多选项」经典菜单中；
          MSIX 打包版可出现在新版紧凑右键菜单顶层。
        </InfoBar>
        <div className="grid grid-cols-2 gap-x-4">
          {MENU_TARGETS.map((t) => (
            <Checkbox
              key={t.id}
              checked={menuSelected.has(t.id) || menuOnMap.get(t.id) === true}
              onChange={() => toggleMenuTarget(t.id)}
              label={t.label}
              description={t.desc}
            />
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Button
            variant="accent"
            icon="link"
            disabled={busy || !isTauri()}
            onClick={() => void applyContextMenu([...menuSelected])}
          >
            应用注入
          </Button>
          <Button
            icon="trash"
            disabled={busy || !isTauri()}
            onClick={() => void applyContextMenu([])}
          >
            移除全部
          </Button>
        </div>
      </Card>

      {/* 默认打开方式 */}
      <Card
        icon="file"
        title="默认打开方式（文件关联）"
        description="注册 ProgID，使 FileView 出现在「打开方式」列表中"
        actions={<Badge on={(integration?.file_assoc ?? []).some(([, on]) => on)} />}
      >
        <InfoBar type="info" title="关于 Windows 默认应用策略">
          Windows 通过用户确认（UserChoice 哈希保护）决定默认应用，程序无法直接改写。
          勾选扩展名完成注册后，点击下方按钮在系统设置中一键确认 FileView 为默认应用。
        </InfoBar>
        <div className="grid grid-cols-3 gap-x-4">
          {SUPPORTED_EXTS.map((ext) => (
            <Checkbox
              key={ext}
              checked={extSelected.has(ext) || extOnMap.get(ext) === true}
              onChange={() => toggleExt(ext)}
              label={`.${ext}`}
            />
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Button
            variant="accent"
            icon="check"
            disabled={busy || !isTauri()}
            onClick={() => void applyFileAssoc([...extSelected])}
          >
            注册关联
          </Button>
          <Button icon="settings" disabled={!isTauri()} onClick={() => void openDefaultApps()}>
            在系统设置中设为默认
          </Button>
        </div>
      </Card>

      {/* 开机自启 */}
      <Card
        icon="power"
        title="开机自启"
        description="登录 Windows 后自动启动 FileView"
        actions={
          <Badge
            on={integration?.autostart ?? false}
            onText="已开启"
            offText="已关闭"
          />
        }
      >
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-ink">随系统启动</span>
          <ToggleSwitch
            checked={settings.autostart}
            disabled={!isTauri() || busy}
            onChange={(v) => void applyAutostart(v, settings.autostartMinimized)}
          />
        </div>
        {settings.autostart && (
          <div className="flex items-center justify-between mt-2">
            <span className="text-[13px] text-ink-secondary">启动时最小化到任务栏</span>
            <ToggleSwitch
              checked={settings.autostartMinimized}
              disabled={!isTauri() || busy}
              onChange={(v) => void applyAutostart(true, v)}
            />
          </div>
        )}
      </Card>

      {/* 清理 */}
      <Card
        icon="trash"
        title="移除全部系统集成"
        description="删除本应用写入的全部注册表项（右键菜单、文件关联、自启动），保证无残留"
      >
        <Button
          variant="danger"
          disabled={busy || !isTauri()}
          onClick={() => setConfirmCleanup(true)}
        >
          一键清理
        </Button>
        {integration && (
          <div className="mt-2 text-[11px] text-ink-tertiary">
            当前受管理注册表键：{integration.managed_key_count} 个
          </div>
        )}
      </Card>

      {/* ============ 关于 ============ */}
      <div className="text-[13px] font-semibold text-ink-secondary mt-5 mb-2">关于</div>
      <Card
        icon="info"
        title="FileView"
        description="v0.1.0 · Tauri 2 + React + Vite + Tailwind CSS"
      >
        <div className="text-[12px] text-ink-secondary leading-5">
          Windows 11 Fluent 风格的多格式文件查看与编辑器。支持 JSON / JSONC / JSONL、Markdown、
          INI 配置、日志与纯文本；提供树形 / 表格 / 原始 / 预览 / 结构多视图、JSONPath 查询、
          语法诊断、编辑保存与系统集成。
        </div>
      </Card>

      <Dialog
        open={confirmCleanup}
        title="移除全部系统集成？"
        onClose={() => setConfirmCleanup(false)}
        footer={
          <>
            <Button onClick={() => setConfirmCleanup(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmCleanup(false);
                void cleanupAll();
              }}
            >
              确认清理
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2">
          <Icon name="warning" size={18} className="text-warning mt-0.5" />
          <span>
            将删除右键菜单项、全部文件关联注册与开机自启项。此操作只影响本应用写入的注册表键，不会影响系统其他设置。
          </span>
        </div>
      </Dialog>
    </div>
  );
};
