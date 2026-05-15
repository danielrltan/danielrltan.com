import { useEffect, useRef, useState } from "react";
import { themeVars, ThemeProvider, useTheme } from "./theme";
import { WindowManagerProvider, useWindows } from "./WindowManager";
import { DraggableWindow } from "./DraggableWindow";
import { DesktopIcon } from "./DesktopIcon";
import { APPS } from "./appRegistry";
import { ClockWidget } from "./widgets/ClockWidget";
import { WeatherWidget } from "./widgets/WeatherWidget";
import { SpotifyWidget } from "./widgets/SpotifyWidget";
import { Eyebrow } from "./Card";
import { DistroAsciiWidget } from "./widgets/DistroAsciiWidget";
import { StatusBar } from "./widgets/StatusBar";
import { Wallpaper } from "./Wallpaper";

interface Props {
  width: number;
  height: number;
  /** Whether the OS is currently in fullscreen overlay mode. */
  isFullscreen?: boolean;
  /** Flip between desk-mounted and fullscreen overlay. */
  onToggleFullscreen?: () => void;
  /** Return the camera to the free-orbit room (closes OS entirely). */
  onBackToRoom?: () => void;
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

// Icon hit-box for overlap testing during drag. The visible icon
// is 92×108 (DesktopIcon's outer div); keep these in sync.
const ICON_W = 92;
const ICON_H = 108;

function iconsOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return !(
    a.x + ICON_W <= b.x ||
    b.x + ICON_W <= a.x ||
    a.y + ICON_H <= b.y ||
    b.y + ICON_H <= a.y
  );
}

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

function DesktopShell({
  width,
  height,
}: Props) {
  const { colors } = useTheme();
  const { open, isOpen, windows } = useWindows();
  const desktopRef = useRef<HTMLDivElement>(null);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [iconPositions, setIconPositions] = useState<
    Record<string, { x: number; y: number }>
  >(() => defaultIconPositions(APPS.map((a) => a.id)));

  // While dragging, the icon follows the cursor freely (it can pass
  // over other icons). The snap happens on drop — see `dropIcon`.
  const moveIcon = (id: string, x: number, y: number) => {
    const cx = Math.max(0, Math.min(width - ICON_W, x));
    const cy = Math.max(0, Math.min(height - ICON_H, y));
    setIconPositions((prev) => ({ ...prev, [id]: { x: cx, y: cy } }));
  };

  // MacOS Finder behaviour: on drop, if the icon's position overlaps
  // another, slide to the nearest open grid slot. Slots are derived
  // from ICON_GRID_ORIGIN + ICON_CELL × col/row. Search outward from
  // the closest slot to the drop point, by squared cell distance.
  const dropIcon = (id: string, x: number, y: number) => {
    const cx = Math.max(0, Math.min(width - ICON_W, x));
    const cy = Math.max(0, Math.min(height - ICON_H, y));
    setIconPositions((prev) => {
      const candidate = { x: cx, y: cy };
      const overlapsAny = Object.entries(prev).some(
        ([oid, opos]) => oid !== id && iconsOverlap(candidate, opos),
      );
      if (!overlapsAny) return { ...prev, [id]: candidate };

      const cols = Math.max(
        1,
        Math.floor((width - ICON_GRID_ORIGIN.x) / ICON_CELL.w),
      );
      const rows = Math.max(
        1,
        Math.floor((height - ICON_GRID_ORIGIN.y) / ICON_CELL.h),
      );
      const nearestCol = Math.round(
        (candidate.x - ICON_GRID_ORIGIN.x) / ICON_CELL.w,
      );
      const nearestRow = Math.round(
        (candidate.y - ICON_GRID_ORIGIN.y) / ICON_CELL.h,
      );

      const slotOccupied = (col: number, row: number): boolean => {
        const sx = ICON_GRID_ORIGIN.x + col * ICON_CELL.w;
        const sy = ICON_GRID_ORIGIN.y + row * ICON_CELL.h;
        for (const [oid, opos] of Object.entries(prev)) {
          if (oid === id) continue;
          if (iconsOverlap({ x: sx, y: sy }, opos)) return true;
        }
        return false;
      };

      // Scan all slots, ranked by squared distance from the dropped
      // position's nearest cell, and return the first free one.
      const ranked: { col: number; row: number; d: number }[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dc = c - nearestCol;
          const dr = r - nearestRow;
          ranked.push({ col: c, row: r, d: dc * dc + dr * dr });
        }
      }
      ranked.sort((a, b) => a.d - b.d);
      for (const { col, row } of ranked) {
        if (!slotOccupied(col, row)) {
          return {
            ...prev,
            [id]: {
              x: ICON_GRID_ORIGIN.x + col * ICON_CELL.w,
              y: ICON_GRID_ORIGIN.y + row * ICON_CELL.h,
            },
          };
        }
      }
      // No free slot — leave at the drop position (rare; desktop is full).
      return { ...prev, [id]: candidate };
    });
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
            onDrop={dropIcon}
            onActivate={() => {
              setSelectedIcon(app.id);
              open(app.id, { width: app.size[0], height: app.size[1] });
            }}
          />
        );
      })}

      {/* Top-right widget cluster: clock + live Toronto weather.
          Fullscreen affordance moved out — see App.tsx for the
          "press F to fullscreen" notification banner. */}
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
        <div style={{ width: 264, height: 140 }}>
          <ClockWidget />
        </div>
        <div style={{ width: 260, height: 140 }}>
          <WeatherWidget />
        </div>
      </div>

      {/* One merged "current favourites" widget — single card with the
          eyebrow at the top and both Spotify embeds stacked
          underneath. Title sits above the embeds (in the same
          wrapper) so it never overlaps them. */}
      <div
        style={{
          position: "absolute",
          // Slotted under the clock + weather row on the right.
          // Top: 12 + 140 (cluster height) + 8 (gap) = 160.
          top: 160,
          right: 14,
          // Width matches the cluster: clock 240 + gap 8 + weather
          // 220 + gap 8 + fullscreen 56 = 532.
          width: 532,
          zIndex: 1,
          background: "var(--surface)",
          borderRadius: 10,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          boxSizing: "border-box",
        }}
      >
        <div style={{ paddingLeft: 4 }}>
          <Eyebrow>current favourites</Eyebrow>
        </div>
        {/* Clip each iframe to its own rounded rect — Spotify's
            embed renders rounded internal content, but the iframe
            element itself is rectangular with a default white
            backdrop that pokes through the corners. overflow:hidden
            on a rounded wrapper crops that out. */}
        <div
          style={{
            height: 152,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <SpotifyWidget playlistId="6iRfWw8xNLvslofQBvkvCy" />
        </div>
        <div
          style={{
            height: 152,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <SpotifyWidget playlistId="46avDHmN3Nlz3zN7J8bWpN" />
        </div>
      </div>


      {/* Distro / neofetch-style ASCII art card — columned under
          the Spotify widget (same width, right side only). Wide
          rectangle that fills the gap between Spotify and the
          status bar. */}
      <div
        style={{
          position: "absolute",
          right: 14,
          top: 530,
          width: 532,
          bottom: 44,
          zIndex: 1,
        }}
      >
        <DistroAsciiWidget />
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
