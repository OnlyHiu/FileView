import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Fluent design tokens -> CSS variables (see src/styles/index.css)
        smoke: {
          bg: "var(--smoke-bg)",
          "bg-card": "var(--smoke-bg-card)",
          "bg-card-hover": "var(--smoke-bg-card-hover)",
          "bg-subtle": "var(--smoke-bg-subtle)",
          "bg-layer": "var(--smoke-bg-layer)",
        },
        stroke: "var(--stroke-color)",
        "stroke-strong": "var(--stroke-strong)",
        ink: {
          DEFAULT: "var(--ink-primary)",
          secondary: "var(--ink-secondary)",
          tertiary: "var(--ink-tertiary)",
          "on-accent": "var(--ink-on-accent)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          subtle: "var(--accent-subtle)",
          "text": "var(--accent-text)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        // JSON syntax colors
        syn: {
          key: "var(--syn-key)",
          str: "var(--syn-string)",
          num: "var(--syn-number)",
          bool: "var(--syn-bool)",
          null: "var(--syn-null)",
          punct: "var(--syn-punct)",
        },
      },
      fontFamily: {
        sans: ["'Segoe UI Variable Text'", "'Segoe UI'", "system-ui", "sans-serif"],
        display: ["'Segoe UI Variable Display'", "'Segoe UI'", "sans-serif"],
        mono: ["'Cascadia Code'", "'Cascadia Mono'", "Consolas", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--stroke-color)",
        flyout: "0 8px 24px rgba(0,0,0,0.14), 0 0 0 1px var(--stroke-color)",
      },
      transitionTimingFunction: {
        fluent: "cubic-bezier(0.33, 0, 0.67, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
