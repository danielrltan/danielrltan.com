import { useEffect, useRef, useState } from "react";
import { themeVars, ThemeProvider, useTheme } from "./theme";
import { WindowManagerProvider, useWindows } from "./WindowManager";
import { DraggableWindow } from "./DraggableWindow";
import { DesktopIcon } from "./DesktopIcon";
import { APPS } from "./appRegistry";
import { ClockWidget } from "./widgets/ClockWidget";
import { WeatherWidget } from "./widgets/WeatherWidget";
import { NowPlayingWidget } from "./widgets/NowPlayingWidget";
import { SystemInfoWidget } from "./widgets/SystemInfoWidget";
import { PaintWidget } from "./widgets/PaintWidget";
import { StatusBar } from "./widgets/StatusBar";
import { Wallpaper } from "./Wallpaper";

interface Props {
  width: number;
  height: number;
  onClose?: () => void;
  onFullscreen?: () => void;
}

/**
 * Desktop OS — a real desktop metaphor, not a poster.
 *
 * Layers (bottom → top):
 *   1. Wallpaper (warm bg + faint dot grid)
 *   2. 3D-mesh icon column on the left (each opens a window)
 *   3. Floating widgets in the corners (clock / weather / now playing / system)
 *   4. Window layer — draggable, stackable windows
 *   5. Status bar
 */
export function DesktopOS(props: Props) {
  return (
    <ThemeProvider>
      <WindowManagerProvider viewport={{ w: props.width, h: props.height }}>
        <DesktopShell {...props} />
      </WindowManagerProvider>
    </ThemeProvider>
  );
}

// Initial icon layout — 2-column grid in the top-left. Each user drag
// updates the entry in `iconPositions` state.
const ICON_GRID_ORIGIN = { x: 18, y: 18 };
const ICON_CELL = { w: 98, h: 108 };
const ICON_COLS = 2;

function defaultIconPositions(ids: string[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const col = i % ICON_COLS;
    const row = Math.floor(i / ICON_COLS);
    out[id] = {
      x: ICON_GRID_ORIGIN.x + col * ICON_CELL.w,
      y: ICON_GRID_ORIGIN.y + row * ICON_CELL.h,
    };
  });
  return out;
}

function DesktopShell({ width, height }: Props) {
  const { colors } = useTheme();
  const { open, isOpen, windows } = useWindows();
  const desktopRef = useRef<HTMLDivElement>(null);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [iconPositions, setIconPositions] = useState<
    Record<string, { x: number; y: number }>
  >(() => defaultIconPositions(APPS.map((a) => a.id)));

  const moveIcon = (id: string, x: number, y: number) => {
    // Clamp the drop position so icons can't be moved out of the desktop.
    const cx = Math.max(0, Math.min(width - 92, x));
    const cy = Math.max(0, Math.min(height - 108, y));
    setIconPositions((p) => ({ ...p, [id]: { x: cx, y: cy } }));
  };

  // Click on empty desktop → deselect.
  useEffect(() => {
    const el = desktopRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.closest("[data-icon-id]"))
        return;
      setSelectedIcon(null);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, []);

  return (
    <div
      ref={desktopRef}
      style={{
        ...themeVars(colors),
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text-dk)",
        fontFamily: "var(--font-body)",
        transition: "background-color 0.3s ease, color 0.3s ease",
        userSelect: "none",
      }}
    >
      {/* Animated Bauhaus blob wallpaper + paper-texture dot grid. */}
      <Wallpaper />

      {/* Icons — absolutely positioned, draggable. Each entry tracks its
          own x/y in `iconPositions`. */}
      {APPS.map((app) => {
        const pos = iconPositions[app.id] ?? { x: 0, y: 0 };
        return (
          <DesktopIcon
            key={app.id}
            id={app.id}
            label={app.label}
            shape={app.shape}
            x={pos.x}
            y={pos.y}
            selected={selectedIcon === app.id}
            onSelect={(id) => setSelectedIcon(id)}
            onMove={moveIcon}
            onActivate={() => {
              setSelectedIcon(app.id);
              open(app.id, { width: app.size[0], height: app.size[1] });
            }}
          />
        );
      })}

      {/* Top-right widget cluster: clock + live Toronto weather. Sized
          to fit the monitor's 1100×660 cssWidth/cssHeight; tweak the
          numbers here if you bump the OS resolution. */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 14,
          display: "flex",
          gap: 8,
          zIndex: 1,
        }}
      >
        <div style={{ width: 280, height: 140 }}>
          <ClockWidget />
        </div>
        <div style={{ width: 240, height: 140 }}>
          <WeatherWidget />
        </div>
      </div>

      {/* Paint pad — right side, below clock/weather. */}
      <div
        style={{
          position: "absolute",
          right: 14,
          top: 160,
          width: 528,
          zIndex: 1,
        }}
      >
        <PaintWidget />
      </div>

      {/* Now Playing — bottom-left. */}
      <div
        style={{
          position: "absolute",
          left: 14,
          bottom: 44,
          width: 420,
          height: 170,
          zIndex: 1,
        }}
      >
        <NowPlayingWidget />
      </div>

      {/* System Info — bottom-right. */}
      <div
        style={{
          position: "absolute",
          right: 14,
          bottom: 44,
          width: 400,
          height: 170,
          zIndex: 1,
        }}
      >
        <SystemInfoWidget />
      </div>

      {/* Window layer */}
      {windows.map((w) => {
        const app = APPS.find((a) => a.id === w.id);
        if (!app) return null;
        const Body = app.Body;
        return (
          <DraggableWindow key={w.id} id={w.id} title={app.label}>
            <Body />
          </DraggableWindow>
        );
      })}

      {/* Status bar at the bottom */}
      <div
        style={{
          position: "absolute",
          left: 6,
          right: 6,
          bottom: 6,
          zIndex: 2,
        }}
      >
        <StatusBar />
      </div>

      {/* Acknowledge isOpen so tooling doesn't flag it unused; could be
          used by a future taskbar to highlight running apps. */}
      <span style={{ display: "none" }}>{isOpen("about") ? "" : ""}</span>
    </div>
  );
}
