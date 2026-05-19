import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Scroll-driven "corruption" transition that visually consumes the
 * room and reveals the danny.exe OS underneath.
 *
 * Phase progression (driven by `progress` ∈ [0, 1]):
 *  - 0   .. 0.3  : Blocks rise from the bottom in ragged columns.
 *                  Translucent so the room still bleeds through.
 *  - 0.3 .. 0.7  : Block fill accelerates. Characters start cycling
 *                  every ~100ms ("decoding" feel). Room behind dims.
 *                  Occasional full-width "glitch line" strips flash.
 *  - 0.7 .. 0.95 : Almost fully covered. Char cycling slows.
 *                  Text fragments (danny.exe, loading..., 0x00401000,
 *                  main()) start appearing inside the noise and lock.
 *  - 0.95.. 1.0  : Fully covered, blocks fully opaque. The 300ms
 *                  pause + snap-to-grid wipe to danny.exe happens
 *                  in App.tsx once `onBootReady` fires.
 *
 * Phase 2-4 keep the fill source as the BOTTOM only (no side fills
 * per the user spec). Phase 2/3 effects layer ON TOP of the same
 * column-rising fill — they're modulations, not new sources.
 *
 * Implementation: one full-viewport 2D <canvas> layered over the
 * Three.js canvas with `pointerEvents: none` so 3D interactions pass
 * through. Wheel events tracked on `window`. ~30fps render — the
 * corruption doesn't need 60.
 */
interface Props {
  /** True once the intro lerp completes — corruption is dormant before. */
  active: boolean;
  /** Optional ref exposed to the parent so App can read / reset progress. */
  progressRef?: React.MutableRefObject<number>;
  /** Fires once when progress first reaches 1.0 — App mounts danny.exe. */
  onBootReady?: () => void;
  /**
   * Wipe trigger. Bumping `id` (re)starts the center-out radial wipe —
   * the overlay snaps to fully-covered solid BOOT_BG, then dissolves
   * each cell on a schedule based on its distance from screen center,
   * clearing the canvas to reveal whatever sits behind it.
   */
  wipeRequest?: { id: number } | null;
  /** Fires once the active wipe finishes clearing the canvas. */
  onWipeComplete?: () => void;
  /**
   * Reverse trigger — bumping `id` plays the full corruption→OS path
   * backwards: cells re-cover from corners inward (un-wipe), brief
   * hold, then progress rewinds 1→0 so the room is revealed.
   */
  reverseRequest?: { id: number } | null;
  /**
   * Fires when phase A (un-wipe) completes — canvas is now solid
   * BOOT_BG. App uses this to unmount the OS panel before phase C
   * starts revealing the room.
   */
  onReverseUnwipeComplete?: () => void;
  /** Fires when the full reverse finishes — overlay is fully idle. */
  onReverseComplete?: () => void;
}

const CELL_W = 70;
const CELL_H = 100;
const RENDER_FPS = 30;
const SCROLL_SENSITIVITY = 0.0018;
// Hard cap on how quickly progress can advance, regardless of how
// hard the user flings the trackpad. 0.0016 / ms = 1.0 in ~625ms of
// sustained scrolling — fast enough to feel responsive, still slow
// enough that a single hard fling can't instantly punch through.
const MAX_PROGRESS_RATE_PER_MS = 0.0016;
// Cap inter-event dt so a long idle pause followed by one wheel event
// doesn't get a giant budget. 100ms ≈ 6 frames at 60fps; plenty.
const MAX_DT_MS = 100;

// Phase boundaries — also referenced in the render fn.
const P2_START = 0.3;
const P3_START = 0.7;
const P4_START = 0.95;

// Char cycle cadence. Fast during phase 2 (decoding feel), slow in
// phase 3 (settling toward the boot).
const CYCLE_FAST_MS = 100;
const CYCLE_SLOW_MS = 360;

// Glitch line cadence (phase 2+). Random in this range.
const GLITCH_MIN_GAP_MS = 700;
const GLITCH_MAX_GAP_MS = 2200;
const GLITCH_DURATION_MS = 90;

// Text fragments placed during phase 3.
const FRAGMENTS = [
  "danny.exe",
  "loading...",
  "0x64616e",
  "main()",
  "danny.exe",
  "0x73 757020",
  "init()",
];
const FRAGMENT_COUNT_TARGET = 14;

const CHARS = ["▓", "░", "▒", "█", "▄", "▀", "▐", "▌"];

// Boot/OS background — every cell converges to this in the final
// scroll segment so the corruption blends seamlessly into BootSequence.
const BOOT_BG = "#1a1714";

// Tight monochrome palette clustered around BOOT_BG. Only enough
// variation to give the noise some texture; everything sits in the
// same near-black band as the OS background.
const COLORS = [
  "#0e0c0b",
  "#1a1714",
  "#262320",
  "#322d29",
];
// Locked text fragments — same dark bg, slightly lifted muted glyph.
const FRAGMENT_BG = "#1a1714";
const FRAGMENT_FG = "#5a5048";
// Glyph color for non-locked cells, chosen so it reads subtly against
// the tight dark palette without becoming an eyesore.
const GLYPH_FG = "#3a342f";

// Per-cell convergence band — each cell picks its own start in
// [CONVERGE_MIN, CONVERGE_MAX] and ramps over CONVERGE_RAMP scroll.
// Cells are grouped into BLOCK_R×BLOCK_C chunks that share a start
// so the screen flips in batches rather than as uniform snow.
const CONVERGE_MIN = 0.45;
const CONVERGE_MAX = 0.92;
const CONVERGE_RAMP = 0.04;
const CONVERGE_JITTER = 0.02;
const BLOCK_R = 2;
const BLOCK_C = 2;

interface Cell {
  filled: boolean;
  char: string;
  color: string;
  /** Locked cells skip cycling — used by text fragments in phase 3. */
  locked: boolean;
  /** Per-cell glyph override for locked fragments (else use palette). */
  glyphColor?: string;
  /** True once the wipe phase has cleared this cell. */
  wiped: boolean;
}

function makeCell(): Cell {
  return {
    filled: false,
    char: CHARS[Math.floor(Math.random() * CHARS.length)]!,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    locked: false,
    wiped: false,
  };
}

// Wipe phase configuration. Total duration is a touch under 1s so
// the reveal feels snappy but readable.
const WIPE_DURATION_MS = 900;

interface WipeState {
  startAt: number;
  flipAt: number[][];
  done: boolean;
}

// Reverse phase durations. Phase A re-covers the screen from corners
// inward, phase B holds on solid BOOT_BG, phase C rewinds the
// corruption progress back to 0 so the room reappears.
const REVERSE_UNWIPE_MS = 900;
const REVERSE_PAUSE_MS = 200;
const REVERSE_UNCORRUPT_MS = 1800;
const REVERSE_TOTAL_MS =
  REVERSE_UNWIPE_MS + REVERSE_PAUSE_MS + REVERSE_UNCORRUPT_MS;

interface ReverseState {
  startAt: number;
  flipAt: number[][];
  unwipeCompleteFired: boolean;
  done: boolean;
}

/**
 * Center-out radial flip schedule. Each cell's wipe time is a linear
 * function of its distance from screen center — innermost cells go
 * first, corners last.
 */
function buildWipeFlipAt(rows: number, cols: number): number[][] {
  const cy = (rows - 1) / 2;
  const cx = (cols - 1) / 2;
  const maxD = Math.hypot(cy, cx) || 1;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const d = Math.hypot(r - cy, c - cx);
      return (d / maxD) * WIPE_DURATION_MS;
    }),
  );
}

function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const BOOT_BG_RGB = hexToRgb(BOOT_BG);

/** Lerp a hex color toward BOOT_BG by t∈[0,1], return `rgb(...)` string. */
function lerpToBootBg(hex: string, t: number): string {
  if (t <= 0) return hex;
  if (t >= 1) return BOOT_BG;
  const [r, g, b] = hexToRgb(hex);
  const [br, bg, bb] = BOOT_BG_RGB;
  const lr = Math.round(r + (br - r) * t);
  const lg = Math.round(g + (bg - g) * t);
  const lb = Math.round(b + (bb - b) * t);
  return `rgb(${lr},${lg},${lb})`;
}

export function CorruptionOverlay({
  active,
  progressRef,
  onBootReady,
  wipeRequest,
  onWipeComplete,
  reverseRequest,
  onReverseUnwipeComplete,
  onReverseComplete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const internalProgressRef = useRef(0);
  const progress = progressRef ?? internalProgressRef;
  const activeRef = useRef(active);
  const bootFiredRef = useRef(false);
  const onBootReadyRef = useRef(onBootReady);
  onBootReadyRef.current = onBootReady;
  const wipeRequestRef = useRef<Props["wipeRequest"]>(null);
  wipeRequestRef.current = wipeRequest ?? null;
  const onWipeCompleteRef = useRef(onWipeComplete);
  onWipeCompleteRef.current = onWipeComplete;
  const reverseRequestRef = useRef<Props["reverseRequest"]>(null);
  reverseRequestRef.current = reverseRequest ?? null;
  const onReverseUnwipeCompleteRef = useRef(onReverseUnwipeComplete);
  onReverseUnwipeCompleteRef.current = onReverseUnwipeComplete;
  const onReverseCompleteRef = useRef(onReverseComplete);
  onReverseCompleteRef.current = onReverseComplete;

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      progress.current = 0;
      bootFiredRef.current = false;
    }
  }, [active, progress]);

  // Bridge paint — when a wipe is requested, synchronously fill the
  // canvas with BOOT_BG before the browser commits the React render.
  // Without this, the placeholder beneath the canvas can flash
  // through for one frame while we wait for the next 30fps render
  // tick to start drawing the wipe.
  useLayoutEffect(() => {
    if (!wipeRequest) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = BOOT_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [wipeRequest]);

  // Wheel → cumulative progress, with a per-millisecond rate cap so
  // fast trackpad flings can't instantly fill the corruption.
  useEffect(() => {
    let lastWheelAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!activeRef.current) return;
      // Once we've booted, lock progress at 1.0. Reverse path is via
      // the imperative reset (ESC handler in App).
      if (bootFiredRef.current) return;
      const now = performance.now();
      const dt = lastWheelAt === 0 ? 16 : Math.min(now - lastWheelAt, MAX_DT_MS);
      lastWheelAt = now;
      const desired = e.deltaY * SCROLL_SENSITIVITY;
      const cap = dt * MAX_PROGRESS_RATE_PER_MS;
      const clamped = Math.max(-cap, Math.min(cap, desired));
      progress.current = Math.max(0, Math.min(1, progress.current + clamped));
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [progress]);

  // Canvas + render loop. The big one.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cols = 0;
    let rows = 0;
    let grid: Cell[][] = [];
    let columnSpeeds: number[] = [];
    // Per-cell scroll position at which the cell starts lerping to
    // BOOT_BG. Cells in the same BLOCK_R×BLOCK_C chunk share a base
    // value (with small jitter) so adjacent cells flip in batches.
    let cellConvergeStart: number[][] = [];

    // Phase-specific runtime state.
    let lastCycleAt = 0;
    let glitchActiveUntil = 0;
    let glitchRow = -1;
    let nextGlitchAt = performance.now() + GLITCH_MIN_GAP_MS;
    const placedFragments = new Set<string>();
    // Wipe runtime state. `lastWipeId` lets us detect a fresh request
    // even when the same mode is selected twice in a row.
    let wipeState: WipeState | null = null;
    let lastWipeId: number | null = null;
    // Reverse runtime state — set when ESC triggers the un-corruption.
    let reverseState: ReverseState | null = null;
    let lastReverseId: number | null = null;

    const buildGrid = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Math.ceil(canvas.width / CELL_W) + 1;
      rows = Math.ceil(canvas.height / CELL_H) + 1;
      grid = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, makeCell),
      );
      // Per-column 0.8-1.2× speed jitter so the rising water level
      // has a ragged top edge instead of a flat band.
      columnSpeeds = Array.from(
        { length: cols },
        () => 0.8 + Math.random() * 0.4,
      );
      // Pick one base convergeStart per chunk, then assign every cell
      // in the chunk that base + small jitter. Chunks of 2x2 cells
      // mean a visible "blob" of adjacent squares flips together.
      const chunkRows = Math.ceil(rows / BLOCK_R);
      const chunkCols = Math.ceil(cols / BLOCK_C);
      const chunkStarts: number[][] = Array.from(
        { length: chunkRows },
        () =>
          Array.from(
            { length: chunkCols },
            () => CONVERGE_MIN + Math.random() * (CONVERGE_MAX - CONVERGE_MIN),
          ),
      );
      cellConvergeStart = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const base = chunkStarts[Math.floor(r / BLOCK_R)]![Math.floor(c / BLOCK_C)]!;
          return base + (Math.random() * 2 - 1) * CONVERGE_JITTER;
        }),
      );
      placedFragments.clear();
    };

    buildGrid();
    const onResize = () => buildGrid();
    window.addEventListener("resize", onResize);

    const placeFragmentsIfNeeded = (p: number) => {
      // Phase 3: drop text fragments into the noise. Cumulative —
      // once placed, they stay (locked). Target count scales 0..1
      // across phase 3.
      if (p < P3_START) return;
      const targetCount = Math.floor(
        FRAGMENT_COUNT_TARGET * Math.min(1, (p - P3_START) / (P4_START - P3_START)),
      );
      while (placedFragments.size < targetCount) {
        const text = FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)]!;
        const len = text.length;
        // Pick a random row anywhere on screen + a column where the
        // fragment fits horizontally. Only place into already-filled
        // cells so the fragment doesn't float above the water level.
        const row = Math.floor(Math.random() * rows);
        const col = Math.floor(Math.random() * Math.max(1, cols - len));
        const key = `${row}:${col}:${text}`;
        if (placedFragments.has(key)) continue;
        // Check all target cells are currently filled.
        let allFilled = true;
        for (let i = 0; i < len; i++) {
          if (!grid[row]?.[col + i]?.filled) {
            allFilled = false;
            break;
          }
        }
        if (!allFilled) {
          // No-op this frame — try again next render. Bail to avoid an
          // infinite loop if the screen isn't filled enough yet.
          break;
        }
        for (let i = 0; i < len; i++) {
          const cell = grid[row]![col + i]!;
          cell.char = text[i]!;
          cell.color = FRAGMENT_BG;
          cell.glyphColor = FRAGMENT_FG;
          cell.locked = true;
        }
        placedFragments.add(key);
      }
    };

    const cycleChars = (now: number, p: number) => {
      // Phase 2+ only. Cadence interpolates fast → slow across
      // phases 2-3 so the noise feels frantic mid-way and calms as
      // it settles toward the boot.
      if (p < P2_START) return;
      const phase23T = Math.min(1, (p - P2_START) / (P4_START - P2_START));
      const cadence = CYCLE_FAST_MS + (CYCLE_SLOW_MS - CYCLE_FAST_MS) * phase23T;
      if (now - lastCycleAt < cadence) return;
      lastCycleAt = now;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = grid[row]![col]!;
          if (!cell.filled || cell.locked) continue;
          // Don't re-roll cells that have begun converging — their
          // bg is lerping to BOOT_BG and the glyph is fading out.
          if (p >= cellConvergeStart[row]![col]!) continue;
          // Re-roll glyph + color so the same cell flickers through
          // the palette + charset.
          cell.char = CHARS[Math.floor(Math.random() * CHARS.length)]!;
          cell.color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
        }
      }
    };

    const updateGlitchLine = (now: number, p: number) => {
      // Phase 2+. A random full-width row briefly flashes with chars
      // at full opacity. Cleared on its own; doesn't permanently
      // change the grid.
      if (p < P2_START) {
        glitchActiveUntil = 0;
        glitchRow = -1;
        return;
      }
      if (now > glitchActiveUntil && now > nextGlitchAt) {
        glitchRow = Math.floor(Math.random() * rows);
        glitchActiveUntil = now + GLITCH_DURATION_MS;
        nextGlitchAt =
          now +
          GLITCH_MIN_GAP_MS +
          Math.random() * (GLITCH_MAX_GAP_MS - GLITCH_MIN_GAP_MS);
      }
    };

    const FRAME_MS = 1000 / RENDER_FPS;
    let lastRender = 0;
    let raf = 0;

    const tick = (now: number) => {
      if (now - lastRender >= FRAME_MS) {
        lastRender = now;
        render(now);
      }
      raf = requestAnimationFrame(tick);
    };

    const render = (now: number) => {
      // Wipe request detection — runs before the normal corruption
      // path so a wipe can be triggered from any prior state. On a
      // new id we snap every cell to a solid BOOT_BG square and
      // compute the per-cell flip schedule for the chosen mode.
      const req = wipeRequestRef.current;
      if (req && req.id !== lastWipeId) {
        lastWipeId = req.id;
        progress.current = 1;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const cell = grid[r]![c]!;
            cell.filled = true;
            cell.wiped = false;
            cell.char = " ";
            cell.color = BOOT_BG;
            cell.locked = false;
            cell.glyphColor = undefined;
          }
        }
        wipeState = {
          startAt: now,
          flipAt: buildWipeFlipAt(rows, cols),
          done: false,
        };
      }

      // Reverse request detection — clears any wipe state and starts
      // the multi-phase rewind. flipAt is reused from the wipe (so
      // phase A is the geometric inverse) when one exists, else we
      // build a fresh schedule.
      const revReq = reverseRequestRef.current;
      if (revReq && revReq.id !== lastReverseId) {
        lastReverseId = revReq.id;
        const flipAt = wipeState?.flipAt ?? buildWipeFlipAt(rows, cols);
        wipeState = null;
        progress.current = 1;
        reverseState = {
          startAt: now,
          flipAt,
          unwipeCompleteFired: false,
          done: false,
        };
      }

      // Reverse render path — phase A re-covers from corners inward,
      // phase B holds, phase C rewinds progress and falls through to
      // the normal corruption render so the water recedes naturally.
      if (reverseState && !reverseState.done) {
        const elapsed = now - reverseState.startAt;

        if (elapsed < REVERSE_UNWIPE_MS) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = BOOT_BG;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (
                elapsed >=
                REVERSE_UNWIPE_MS - reverseState.flipAt[r]![c]!
              ) {
                ctx.fillRect(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
              }
            }
          }
          return;
        }

        if (!reverseState.unwipeCompleteFired) {
          reverseState.unwipeCompleteFired = true;
          onReverseUnwipeCompleteRef.current?.();
        }

        if (elapsed < REVERSE_UNWIPE_MS + REVERSE_PAUSE_MS) {
          ctx.fillStyle = BOOT_BG;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          return;
        }

        if (elapsed >= REVERSE_TOTAL_MS) {
          reverseState = null;
          progress.current = 0;
          bootFiredRef.current = false;
          buildGrid();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          onReverseCompleteRef.current?.();
          return;
        }

        // Phase C — drive progress back to 0 with an ease-out so the
        // water recedes fast initially then settles. Falls through to
        // the corruption render below with the updated progress.
        const t =
          (elapsed - REVERSE_UNWIPE_MS - REVERSE_PAUSE_MS) /
          REVERSE_UNCORRUPT_MS;
        const eased = 1 - Math.pow(1 - t, 3);
        progress.current = 1 - eased;
      }

      // Wipe render path — once a wipe is in flight the corruption
      // logic is suspended entirely. Cells render as solid BOOT_BG
      // until their flipAt elapses, then they're marked wiped and
      // skipped (leaving the canvas transparent so whatever sits
      // beneath shows through).
      if (wipeState) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!wipeState.done) {
          const elapsed = now - wipeState.startAt;
          let anyVisible = false;
          ctx.fillStyle = BOOT_BG;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cell = grid[r]![c]!;
              if (cell.wiped) continue;
              if (elapsed >= wipeState.flipAt[r]![c]!) {
                cell.wiped = true;
                continue;
              }
              anyVisible = true;
              ctx.fillRect(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
            }
          }
          if (!anyVisible) {
            wipeState.done = true;
            onWipeCompleteRef.current?.();
          }
        }
        return;
      }

      const p = progress.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (p <= 0) return;

      // 1. Room-dim layer: a black tint behind the blocks that gets
      //    darker as corruption advances. Starts at 0, reaches ~0.42
      //    at progress = 1.0, so the room is well-suppressed by the
      //    time blocks are fully opaque on top.
      ctx.globalAlpha = 0.42 * p;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;

      // 2. Fill bookkeeping — derived per frame so the water level
      //    can recede during the reverse phase. Cleared first, then
      //    re-marked from the bottom-rising columns and the per-cell
      //    convergence overrides. Forward behavior is identical
      //    because p only increases there.
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          grid[row]![col]!.filled = false;
        }
      }
      for (let col = 0; col < cols; col++) {
        const fillHeight = Math.floor(p * rows * columnSpeeds[col]!);
        for (let i = 0; i < fillHeight; i++) {
          const row = rows - 1 - i;
          if (row < 0) break;
          const cell = grid[row]?.[col];
          if (cell) cell.filled = true;
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (p >= cellConvergeStart[row]![col]!) {
            grid[row]![col]!.filled = true;
          }
        }
      }

      // 3. Phase 2 effects: char cycling + glitch line scheduling.
      cycleChars(now, p);
      updateGlitchLine(now, p);

      // 4. Phase 3 effects: text fragment placement (locks cells).
      placeFragmentsIfNeeded(p);

      // 5. Block render. Opacity ramps 0.7 → 1.0 with progress so
      //    the room is visible early and fully obscured by 1.0.
      const blockAlpha = 0.7 + 0.3 * p;
      ctx.font = `${CELL_H - 4}px ui-monospace, "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = grid[row]![col]!;
          if (!cell.filled) continue;

          const x = col * CELL_W;
          const y = row * CELL_H;

          // Per-cell convergence — 0 before this cell's batch starts,
          // ramps to 1 over CONVERGE_RAMP scroll, snapping cell bg to
          // BOOT_BG and fading the glyph out independently of others.
          const cellT = Math.max(
            0,
            Math.min(1, (p - cellConvergeStart[row]![col]!) / CONVERGE_RAMP),
          );

          // Locked fragment cells always render at full opacity so
          // the text reads cleanly through the noise.
          const a = cell.locked ? 1 : blockAlpha;
          ctx.globalAlpha = a;
          ctx.fillStyle = lerpToBootBg(cell.color, cellT);
          ctx.fillRect(x, y, CELL_W, CELL_H);

          // Glyph fades out as this cell converges so a fully-flipped
          // cell renders as solid BOOT_BG with no leftover character.
          if (cellT < 1) {
            ctx.globalAlpha = a * (1 - cellT);
            const baseGlyph =
              cell.glyphColor ?? (isDark(cell.color) ? GLYPH_FG : "#0a0a0a");
            ctx.fillStyle = baseGlyph;
            ctx.fillText(cell.char, x + 1, y + 1);
          }
        }
      }

      // 6. Glitch line overlay — drawn AFTER the blocks so it sits
      //    on top of everything else. A full-width row of random
      //    chars at full opacity, palette light-on-dark for max pop.
      // Glitch line tapers off as overall progress approaches 1.0 so
      // it doesn't strobe over an already-converged frame.
      const glitchAlpha = Math.max(0, Math.min(1, (0.95 - p) / 0.1));
      if (glitchRow >= 0 && now < glitchActiveUntil && glitchAlpha > 0) {
        const y = glitchRow * CELL_H;
        ctx.globalAlpha = glitchAlpha;
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, y, canvas.width, CELL_H);
        ctx.fillStyle = GLYPH_FG;
        for (let col = 0; col < cols; col++) {
          const ch = CHARS[Math.floor(Math.random() * CHARS.length)]!;
          ctx.fillText(ch, col * CELL_W + 1, y + 1);
        }
      }

      ctx.globalAlpha = 1;

      // 7. Boot signal — fires once when progress first reaches 1.0.
      //    App owns the post-boot UI; this overlay just hangs at full
      //    coverage until it's dismissed.
      if (p >= 1 && !bootFiredRef.current) {
        bootFiredRef.current = true;
        onBootReadyRef.current?.();
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [progress]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        pointerEvents: "none",
        display: active ? "block" : "none",
      }}
    />
  );
}
