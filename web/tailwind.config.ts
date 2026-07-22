import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          300: "#fca5a5",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
          900: "#7f1d1d",
        },
        // Theme-aware colors via CSS variables
        "t-bg": "var(--bg-primary)",
        "t-panel": "var(--bg-secondary)",
        "t-card": "var(--bg-elevated)",
        "t-tertiary": "var(--bg-tertiary)",
        "t-hover": "var(--bg-hover)",
        "t-active": "var(--bg-active)",
        "t-input": "var(--bg-input)",
        "t-border": "var(--border-color)",
        "t-border-subtle": "var(--border-subtle)",
        "t-border-strong": "var(--border-strong)",
        "t-text": "var(--text-primary)",
        "t-text-2": "var(--text-secondary)",
        "t-text-3": "var(--text-muted)",
        "t-text-disabled": "var(--text-disabled)",
        // Accent / action colors
        "t-accent": "var(--accent)",
        "t-accent-hover": "var(--accent-hover)",
        "t-accent-bg": "var(--accent-bg)",
        "t-accent-border": "var(--accent-border)",
        // Warning / success text
        "t-warning-text": "var(--color-warning-text)",
        "t-success-text": "var(--color-success-text)",
        // Trading colors (Chinese convention: Red up, Green down)
        trade: {
          up: "var(--color-up)",
          down: "var(--color-down)",
          "up-bg": "var(--color-up-bg)",
          "down-bg": "var(--color-down-bg)",
          "up-text": "var(--color-up-text)",
          "down-text": "var(--color-down-text)",
        },
        // Status colors
        status: {
          info: "var(--color-info)",
          "info-bg": "var(--color-info-bg)",
          warning: "var(--color-warning)",
          "warning-bg": "var(--color-warning-bg)",
          success: "var(--color-success)",
          "success-bg": "var(--color-success-bg)",
          error: "var(--color-error)",
          "error-bg": "var(--color-error-bg)",
        },
        // Backward compat aliases
        dark: {
          bg: "#0d1117",
          panel: "#161b22",
          card: "#1a1f2e",
          hover: "#252d3d",
          border: "#2d3748",
          input: "#1c2333",
        },
      },
      fontSize: {
        'xxs': ['10px', '14px'],
        'xs': ['11px', '16px'],
        'sm': ['12px', '18px'],
        'base': ['13px', '20px'],
        'lg': ['14px', '22px'],
        'xl': ['16px', '24px'],
        '2xl': ['20px', '28px'],
        '3xl': ['28px', '36px'],
      },
      boxShadow: {
        'panel': 'var(--shadow-panel)',
        'dropdown': 'var(--shadow-dropdown)',
        'glow': 'var(--shadow-glow)',
      },
      borderRadius: {
        't-sm': 'var(--radius-sm)',
        't-md': 'var(--radius-md)',
        't-lg': 'var(--radius-lg)',
        't-xl': 'var(--radius-xl)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
