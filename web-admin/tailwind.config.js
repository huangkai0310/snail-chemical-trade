/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
        },
        trade: {
          up: "var(--color-up)",
          down: "var(--color-down)",
        },
        status: {
          info: "var(--color-info)",
          warning: "var(--color-warning)",
          success: "var(--color-success)",
          error: "var(--color-error)",
        },
        t: {
          bg: "var(--bg-primary)",
          panel: "var(--bg-panel)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
          border: "var(--border-color)",
          text: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
