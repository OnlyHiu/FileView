// 应用设置状态（含系统集成）

import { create } from "zustand";
import * as api from "../lib/api";
import type { IntegrationStatus, Settings } from "../lib/types";

interface SettingsState {
  settings: Settings;
  integration: IntegrationStatus | null;
  busy: boolean;
  message: string | null;

  load: () => Promise<void>;
  patch: (p: Partial<Settings>) => Promise<void>;
  refreshIntegration: () => Promise<void>;
  applyContextMenu: (targets: string[]) => Promise<void>;
  applyFileAssoc: (exts: string[]) => Promise<void>;
  applyAutostart: (enabled: boolean, minimized: boolean) => Promise<void>;
  openDefaultApps: () => Promise<void>;
  cleanupAll: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: api.defaultSettings(),
  integration: null,
  busy: false,
  message: null,

  load: async () => {
    const settings = await api.getSettings();
    set({ settings });
    await get().refreshIntegration();
  },

  patch: async (p) => {
    const settings = await api.updateSettings(p);
    set({ settings });
  },

  refreshIntegration: async () => {
    try {
      const integration = await api.integrationStatus();
      set({ integration });
    } catch (e) {
      set({ message: `读取系统集成状态失败: ${e}` });
    }
  },

  applyContextMenu: async (targets) => {
    set({ busy: true });
    try {
      if (targets.length === 0) {
        await api.uninstallContextMenu();
        set({ message: "已移除右键菜单项" });
      } else {
        await api.installContextMenu(targets);
        set({ message: `已注入右键菜单：${targets.length} 个目标` });
      }
      await get().patch({ contextMenuTargets: targets });
    } catch (e) {
      set({ message: `右键菜单操作失败: ${e}` });
    } finally {
      set({ busy: false });
      await get().refreshIntegration();
    }
  },

  applyFileAssoc: async (exts) => {
    set({ busy: true });
    try {
      const status = get().integration;
      const current = new Set(
        (status?.file_assoc ?? []).filter(([, on]) => on).map(([ext]) => ext)
      );
      const toRegister = exts.filter((e) => !current.has(e));
      const toUnregister = [...current].filter((e) => !exts.includes(e));
      if (toRegister.length) await api.registerFileAssociations(toRegister);
      if (toUnregister.length) await api.unregisterFileAssociations(toUnregister);
      await get().patch({ associatedExtensions: exts });
      set({ message: "文件关联已更新" });
    } catch (e) {
      set({ message: `文件关联操作失败: ${e}` });
    } finally {
      set({ busy: false });
      await get().refreshIntegration();
    }
  },

  applyAutostart: async (enabled, minimized) => {
    set({ busy: true });
    try {
      await api.setAutostart(enabled, minimized);
      await get().patch({ autostart: enabled, autostartMinimized: minimized });
      set({ message: enabled ? "已启用开机自启" : "已关闭开机自启" });
    } catch (e) {
      set({ message: `自启设置失败: ${e}` });
    } finally {
      set({ busy: false });
      await get().refreshIntegration();
    }
  },

  openDefaultApps: async () => {
    try {
      await api.openDefaultAppsSettings();
      set({ message: "已打开系统默认应用设置，请在列表中选择 FileView" });
    } catch (e) {
      set({ message: `打开系统设置失败: ${e}` });
    }
  },

  cleanupAll: async () => {
    set({ busy: true });
    try {
      const integration = await api.cleanupIntegration();
      set({ integration, message: "已移除全部系统集成，注册表无残留" });
      await get().patch({
        contextMenuTargets: [],
        associatedExtensions: [],
        autostart: false,
      });
    } catch (e) {
      set({ message: `清理失败: ${e}` });
    } finally {
      set({ busy: false });
      await get().refreshIntegration();
    }
  },
}));
