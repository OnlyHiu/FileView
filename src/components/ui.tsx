// WinUI 3 / Windows 11 Fluent 风格基础组件集

import React, { useEffect, useRef, useState } from "react";

// ============ 图标 ============

const ICON_PATHS: Record<string, string> = {
  file: "M6 2h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm6 1.5V8h4.5",
  tree: "M4 4h6v4H4zM4 16h6v4H4zM10 6h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4",
  table: "M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16",
  code: "M8 6l-6 6 6 6M16 6l6 6-6 6",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17l-6-6",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4l-2-1.5.3-2.5-2.4-.8-1-2.3-2.4.6L12 3l-1.5 2.5-2.4-.6-1 2.3-2.4.8.3 2.5L3 12l2 1.5-.3 2.5 2.4.8 1 2.3 2.4-.6L12 21l1.5-2.5 2.4.6 1-2.3 2.4-.8-.3-2.5z",
  chevron: "M9 6l6 6-6 6",
  check: "M4 12l5 5L20 6",
  folder: "M3 6a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  power: "M12 4v8m5-5a8 8 0 1 1-10 0",
  trash: "M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13",
  play: "M7 5l12 7-12 7z",
  open: "M3 6a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v3M3 8h18l-2 10H5z",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  minimize: "M5 12h14",
  maximize: "M5 5h14v14H5z",
  copy: "M8 8h12v12H8zM4 16V4h12",
  save: "M5 3h11l3 3v15H5V3zm3 0v6h7V3M8 21v-7h8v7",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v2m0 18v2M2 12h2m18 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v5m0 4h.01",
  warning: "M12 3l10 18H2zM12 9v5m0 3h.01",
};

export const Icon: React.FC<{ name: string; size?: number; className?: string }> = ({
  name,
  size = 16,
  className = "",
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d={ICON_PATHS[name] ?? ICON_PATHS.info} />
  </svg>
);

// ============ 按钮 ============

type ButtonVariant = "accent" | "standard" | "subtle" | "danger";

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    icon?: string;
  }
> = ({ variant = "standard", icon, children, className = "", ...rest }) => {
  const base =
    "inline-flex items-center gap-2 px-3 h-8 rounded-sm text-[13px] font-medium transition-colors duration-150 fluent-focus disabled:opacity-40 disabled:pointer-events-none";
  const styles: Record<ButtonVariant, string> = {
    accent: "bg-accent text-ink-on-accent hover:bg-accent-hover",
    standard: "bg-smoke-bg-card text-ink border border-stroke hover:bg-smoke-bg-card-hover",
    subtle: "text-ink hover:bg-smoke-bg-card-hover",
    danger: "bg-danger text-white hover:opacity-90",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
};

// ============ 卡片（设置项）============

export const Card: React.FC<{
  icon?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ icon, title, description, actions, children }) => (
  <section className="bg-smoke-bg-card border border-stroke rounded-lg shadow-card mb-3">
    <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
      {icon && (
        <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent-text flex items-center justify-center shrink-0">
          <Icon name={icon} size={16} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-ink truncate">{title}</div>
        {description && (
          <div className="text-[12px] text-ink-secondary leading-4 mt-0.5">{description}</div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
    {children && (
      <div className="px-4 pb-4 pt-1 border-t border-stroke animate-fade-in">{children}</div>
    )}
  </section>
);

// ============ ToggleSwitch ============

export const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <label className={`inline-flex items-center gap-2 ${disabled ? "opacity-40" : "cursor-pointer"}`}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[18px] rounded-full border transition-colors duration-150 fluent-focus ${
        checked ? "bg-accent border-accent" : "bg-transparent border-stroke-strong"
      }`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all duration-150 ${
          checked
            ? "left-[22px] bg-white"
            : "left-[3px] bg-ink-secondary"
        }`}
      />
    </button>
    {label && <span className="text-[13px] text-ink">{label}</span>}
  </label>
);

// ============ ComboBox（原生 select 风格化）============

export const ComboBox: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
}> = ({ value, onChange, options, width = "w-44" }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={`${width} h-8 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[13px] px-2 fluent-focus cursor-pointer`}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

// ============ SegmentedControl ============

export const SegmentedControl: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: string }[];
}> = ({ value, onChange, options }) => (
  <div className="inline-flex bg-smoke-bg-subtle border border-stroke rounded-md p-0.5">
    {options.map((o) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        className={`flex items-center gap-1.5 px-3 h-7 rounded-[4px] text-[13px] transition-colors duration-150 ${
          value === o.value
            ? "bg-smoke-bg-layer text-ink shadow-card font-medium"
            : "text-ink-secondary hover:text-ink"
        }`}
      >
        {o.icon && <Icon name={o.icon} size={14} />}
        {o.label}
      </button>
    ))}
  </div>
);

// ============ InfoBar ============

export const InfoBar: React.FC<{
  type: "info" | "success" | "warning" | "error";
  title: string;
  children?: React.ReactNode;
  onClose?: () => void;
}> = ({ type, title, children, onClose }) => {
  const colors = {
    info: "bg-accent-subtle border-accent/30 text-ink",
    success: "bg-success/10 border-success/30 text-ink",
    warning: "bg-warning/10 border-warning/30 text-ink",
    error: "bg-danger/10 border-danger/30 text-ink",
  } as const;
  const icons = { info: "info", success: "check", warning: "warning", error: "warning" };
  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 mb-3 ${colors[type]}`}>
      <div
        className={`mt-0.5 ${
          type === "error" ? "text-danger" : type === "warning" ? "text-warning" : type === "success" ? "text-success" : "text-accent-text"
        }`}
      >
        <Icon name={icons[type]} size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {children && <div className="text-[12px] text-ink-secondary mt-0.5 leading-4">{children}</div>}
      </div>
      {onClose && (
        <button onClick={onClose} className="text-ink-tertiary hover:text-ink">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
};

// ============ 复选框 ============

export const Checkbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, description, disabled }) => (
  <label
    className={`flex items-start gap-2.5 py-1.5 px-2 rounded-sm cursor-pointer fluent-item ${
      disabled ? "opacity-40 pointer-events-none" : ""
    }`}
  >
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-4 h-4 mt-0.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors fluent-focus ${
        checked ? "bg-accent border-accent text-white" : "border-stroke-strong bg-smoke-bg-layer"
      }`}
    >
      {checked && <Icon name="check" size={11} />}
    </button>
    <span className="min-w-0">
      <span className="text-[13px] text-ink block leading-5">{label}</span>
      {description && (
        <span className="text-[11px] text-ink-tertiary block leading-4">{description}</span>
      )}
    </span>
  </label>
);

// ============ 进度条 ============

export const ProgressBar: React.FC<{ indeterminate?: boolean; value?: number }> = ({
  indeterminate,
  value = 0,
}) => (
  <div className="h-1 rounded-full bg-smoke-bg-subtle overflow-hidden">
    <div
      className={`h-full bg-accent rounded-full transition-all duration-300 ${
        indeterminate ? "w-1/3 animate-pulse" : ""
      }`}
      style={indeterminate ? undefined : { width: `${Math.min(100, value)}%` }}
    />
  </div>
);

// ============ 状态徽标 ============

export const Badge: React.FC<{ on?: boolean; onText?: string; offText?: string }> = ({
  on,
  onText = "已启用",
  offText = "未启用",
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 h-5 rounded-full text-[11px] font-medium ${
      on ? "bg-success/15 text-success" : "bg-smoke-bg-subtle text-ink-tertiary"
    }`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-success" : "bg-ink-tertiary"}`} />
    {on ? onText : offText}
  </span>
);

// ============ 对话框 ============

export const Dialog: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, title, onClose, footer, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-smoke-bg-layer border border-stroke rounded-lg shadow-flyout w-[420px] max-w-[90vw] animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2 text-[16px] font-semibold text-ink">{title}</div>
        <div className="px-5 pb-4 text-[13px] text-ink-secondary">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-stroke flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
};

// ============ 分组标题 ============

export const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({
  title,
  subtitle,
}) => (
  <div className="mb-3">
    <h2 className="text-[18px] font-semibold text-ink font-display">{title}</h2>
    {subtitle && <p className="text-[12px] text-ink-secondary mt-0.5">{subtitle}</p>}
  </div>
);

// ============ 文本输入 ============

export const TextInput: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { icon?: string }
> = ({ icon, className = "", ...rest }) => (
  <div className={`relative ${className}`}>
    {icon && (
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary">
        <Icon name={icon} size={14} />
      </div>
    )}
    <input
      {...rest}
      className={`w-full h-8 rounded-sm border border-stroke-strong bg-smoke-bg-layer text-ink text-[13px] ${
        icon ? "pl-8" : "pl-2.5"
      } pr-2.5 fluent-focus placeholder:text-ink-tertiary`}
    />
  </div>
);

// ============ 滑块 ============

export const Slider: React.FC<{
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
}> = ({ value, min, max, step = 1, onChange, label }) => (
  <div className="flex items-center gap-3">
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 accent-[var(--accent)]"
    />
    <span className="text-[12px] text-ink-secondary w-14 text-right">
      {label ?? `${value}px`}
    </span>
  </div>
);

// ============ Tooltip（CSS 实现）============

export const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({
  text,
  children,
}) => (
  <span className="relative group inline-flex">
    {children}
    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-sm bg-smoke-bg-layer border border-stroke shadow-flyout text-[11px] text-ink whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-40">
      {text}
    </span>
  </span>
);
