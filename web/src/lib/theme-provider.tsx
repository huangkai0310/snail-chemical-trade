"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuthStore } from "./auth-store";
import { updatePreferences } from "./api";

export type ThemeMode = "dark" | "light";

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (t: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export const THEME_STORAGE_KEY = "snailchem_theme";

function applyTheme(t: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
}

/** 仅认用户显式保存的 dark/light；不再用系统偏好覆盖（避免重开回到白天） */
export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "dark";
}

export function persistThemeLocal(t: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {}
  applyTheme(t);
}

function persistThemeServer(t: ThemeMode) {
  if (!useAuthStore.getState().token) return;
  updatePreferences({ theme: t }).catch(() => {});
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    const t = getStoredTheme();
    setThemeState(t);
    applyTheme(t);
    const onThemeChanged = (e: Event) => {
      const detail = (e as CustomEvent<ThemeMode>).detail;
      if (detail === "light" || detail === "dark") {
        setThemeState(detail);
        applyTheme(detail);
      }
    };
    window.addEventListener("theme-changed", onThemeChanged);
    return () => window.removeEventListener("theme-changed", onThemeChanged);
  }, []);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    persistThemeLocal(t);
    persistThemeServer(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      persistThemeLocal(next);
      persistThemeServer(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
