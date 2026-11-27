"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setThemeMode: (next: ThemeMode, persistToServer?: boolean) => void;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "ambo-theme";

function computeResolved(mode: ThemeMode): "light" | "dark" {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyHtmlClass(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    let initial: ThemeMode = "light";
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        initial = saved;
      }
    } catch {}
    const res = computeResolved(initial);
    setMode(initial);
    setResolved(res);
    applyHtmlClass(res);

    // Sync with authenticated user preference from DB if present
    fetch("/api/settings/ai")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const pref = d?.settings?.themePreference;
        if (pref === "light" || pref === "dark" || pref === "system") {
          try {
            localStorage.setItem(STORAGE_KEY, pref);
          } catch {}
          const nextRes = computeResolved(pref);
          setMode(pref);
          setResolved(nextRes);
          applyHtmlClass(nextRes);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      const nextRes = computeResolved("system");
      setResolved(nextRes);
      applyHtmlClass(nextRes);
    };
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, [mode]);

  const setThemeMode = useCallback((next: ThemeMode, persistToServer = true) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    const nextRes = computeResolved(next);
    setMode(next);
    setResolved(nextRes);
    applyHtmlClass(nextRes);

    if (persistToServer) {
      fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePreference: next }),
      }).catch(() => {});
    }
  }, []);

  const toggleDark = useCallback(() => {
    const next: ThemeMode = resolved === "dark" ? "light" : "dark";
    setThemeMode(next, true);
  }, [resolved, setThemeMode]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setThemeMode, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return ctx;
}
