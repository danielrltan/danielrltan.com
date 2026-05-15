import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type ThemeMode = "warm" | "cool";

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  accent2: string;
  textLt: string;
  textDk: string;
  muted: string;
  border: string;
}

export const THEMES: Record<ThemeMode, ThemeColors> = {
  warm: {
    bg: "#f2ece4",
    surface: "#1a1714",
    surfaceAlt: "#23201d",
    accent: "#e87040",
    accent2: "#d4a574",
    textLt: "#f2ece4",
    textDk: "#1a1714",
    muted: "#8a8078",
    border: "#d4cdc4",
  },
  cool: {
    bg: "#e8e4f0",
    surface: "#1a1720",
    surfaceAlt: "#23202c",
    accent: "#e87040",
    accent2: "#9088b8",
    textLt: "#e8e4f0",
    textDk: "#1a1720",
    muted: "#807888",
    border: "#c8c0d4",
  },
};

interface Ctx {
  mode: ThemeMode;
  colors: ThemeColors;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("warm");
  const toggle = useCallback(
    () => setMode((m) => (m === "warm" ? "cool" : "warm")),
    [],
  );
  const value = useMemo(
    () => ({ mode, colors: THEMES[mode], toggle, setMode }),
    [mode, toggle],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme must be used inside <ThemeProvider>");
  return v;
}

/**
 * Inline CSS variables for the active palette. Spread onto a wrapping
 * element so descendant components can use `var(--bg)` etc. Includes the
 * font-family tokens used across widgets.
 */
export function themeVars(c: ThemeColors): CSSProperties {
  return {
    "--bg": c.bg,
    "--surface": c.surface,
    "--surface-alt": c.surfaceAlt,
    "--accent": c.accent,
    "--accent2": c.accent2,
    "--text-lt": c.textLt,
    "--text-dk": c.textDk,
    "--muted": c.muted,
    "--border": c.border,
    "--font-display":
      'Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--font-body":
      'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--font-mono":
      '"JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  } as CSSProperties;
}
