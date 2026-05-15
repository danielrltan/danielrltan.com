import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface WindowState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  minimized: boolean;
}

interface Ctx {
  windows: WindowState[];
  isOpen: (id: string) => boolean;
  open: (id: string, defaults: { width: number; height: number }) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
  toggleMinimize: (id: string) => void;
  topZ: number;
}

const WindowCtx = createContext<Ctx | null>(null);

let zCounter = 10;

/**
 * Tracks every open window's position + z-order. Designed for a real
 * desktop metaphor: many windows can be open at once, dragging one lifts
 * it to the top, closing leaves the rest stacked beneath.
 */
export function WindowManagerProvider({
  children,
  viewport,
}: {
  children: ReactNode;
  viewport: { w: number; h: number };
}) {
  const [windows, setWindows] = useState<WindowState[]>([]);

  const isOpen = useCallback(
    (id: string) => windows.some((w) => w.id === id),
    [windows],
  );

  const open = useCallback(
    (id: string, defaults: { width: number; height: number }) => {
      setWindows((ws) => {
        const existing = ws.find((w) => w.id === id);
        zCounter += 1;
        if (existing) {
          return ws.map((w) =>
            w.id === id ? { ...w, z: zCounter, minimized: false } : w,
          );
        }
        // Center the new window on the viewport with a small cascade
        // offset based on how many windows are already open.
        const cascade = ws.length * 24;
        const w = defaults.width;
        const h = defaults.height;
        const x = Math.max(20, (viewport.w - w) / 2 + cascade);
        const y = Math.max(40, (viewport.h - h) / 2 + cascade);
        return [
          ...ws,
          { id, x, y, width: w, height: h, z: zCounter, minimized: false },
        ];
      });
    },
    [viewport.w, viewport.h],
  );

  const close = useCallback(
    (id: string) => setWindows((ws) => ws.filter((w) => w.id !== id)),
    [],
  );

  const focus = useCallback((id: string) => {
    setWindows((ws) => {
      if (!ws.length) return ws;
      const max = ws.reduce((m, w) => Math.max(m, w.z), 0);
      const win = ws.find((w) => w.id === id);
      if (!win || win.z === max) return ws;
      zCounter += 1;
      return ws.map((w) => (w.id === id ? { ...w, z: zCounter } : w));
    });
  }, []);

  const move = useCallback(
    (id: string, x: number, y: number) =>
      setWindows((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          // Clamp so windows can't be dragged off-screen. Always keep
          // the title bar (top ~30 px) on screen and at least 80 px
          // of horizontal width visible so the user can grab and
          // pull the window back.
          const MIN_VISIBLE_X = 80;
          const TITLE_H = 30;
          const minX = MIN_VISIBLE_X - w.width;
          const maxX = viewport.w - MIN_VISIBLE_X;
          const minY = 0;
          const maxY = viewport.h - TITLE_H;
          const cx = Math.max(minX, Math.min(maxX, x));
          const cy = Math.max(minY, Math.min(maxY, y));
          return { ...w, x: cx, y: cy };
        }),
      ),
    [viewport.w, viewport.h],
  );

  const resize = useCallback(
    (id: string, w: number, h: number) =>
      setWindows((ws) =>
        ws.map((win) =>
          win.id === id ? { ...win, width: w, height: h } : win,
        ),
      ),
    [],
  );

  const toggleMinimize = useCallback(
    (id: string) =>
      setWindows((ws) =>
        ws.map((w) =>
          w.id === id ? { ...w, minimized: !w.minimized } : w,
        ),
      ),
    [],
  );

  const topZ = windows.reduce((m, w) => Math.max(m, w.z), 0);

  const value = useMemo<Ctx>(
    () => ({
      windows,
      isOpen,
      open,
      close,
      focus,
      move,
      resize,
      toggleMinimize,
      topZ,
    }),
    [windows, isOpen, open, close, focus, move, resize, toggleMinimize, topZ],
  );

  return <WindowCtx.Provider value={value}>{children}</WindowCtx.Provider>;
}

export function useWindows(): Ctx {
  const v = useContext(WindowCtx);
  if (!v) throw new Error("useWindows must be used inside <WindowManagerProvider>");
  return v;
}
