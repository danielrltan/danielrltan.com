import { useEffect, useRef } from "react";

/**
 * Hero ignition: a one-shot ASCII "comic blast" drawn on a 2D canvas that
 * overlays the ring. It plays the instant the loading scrim lifts (same
 * trigger the ring's entrance uses), then fades out as the ring crossfades
 * in over it — so the sequence reads as: blast → ring appears → ring tilts
 * into the scene. Pure 2D canvas (no WebGL); stops its rAF once finished.
 *
 * Mounted INSIDE `.hero-ring-wrap`, inset:0, so its centre lines up with the
 * ring's centre.
 */
export function HeroIgnition() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // no blast for reduced-motion users

    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const parent = cv.parentElement;
    if (!ctx || !parent) return;

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const CELL = 14;
    const FONT = 15;
    const RAMP = " .:-=+*oc#%@&"; // sparse → dense (matches the ring ramp)
    let W = 0, H = 0, cx = 0, cy = 0, cols = 0, rows = 0;

    const resize = () => {
      const r = parent.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / CELL);
      rows = Math.ceil(H / CELL);
      cx = W / 2; cy = H / 2;
    };
    resize();

    const hash = (x: number, y: number) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const vnoise = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x: number, y: number) =>
      0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.1 * vnoise(x * 4.3, y * 4.3);
    // Punchy ease for the shock front — an explosion BANGS out fast then
    // decelerates. The "too fast" feel before came from the whole blast
    // being short; the fix is a sharp burst + a long lingering fade (below),
    // not a gradual front (that read as an "opening", not a blast).
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    const DUR = 1.7; // blast lifetime (s): brief BANG + long lingering fade
    // DEV: ?introFreeze=<seconds> renders the blast at a fixed elapsed time
    // (matching the ring's freeze) for screenshot review; bypasses the gate.
    const INTRO_FREEZE = (() => {
      const raw = new URLSearchParams(window.location.search).get("introFreeze");
      if (raw == null) return null;
      const v = parseFloat(raw);
      return Number.isFinite(v) ? v : null;
    })();
    const ENTRANCE_DELAY_MS = 500; // beat AFTER the loading screen clears
    let startT: number | null = null;
    let gateMetAt: number | null = null;
    let raf = 0;

    const frame = (now: number) => {
      let t: number;
      if (INTRO_FREEZE != null) {
        t = INTRO_FREEZE; // fixed time; keep looping so it stays drawable
      } else {
        // Hold until the LOADING SCREEN is gone AND the composition is
        // revealed (loading-active removed = scrim cleared), THEN wait
        // ENTRANCE_DELAY_MS so the blast lands a beat after the load-in,
        // not on its fade-out. Same gate + delay as the ring's entrance so
        // they're in lockstep.
        if (startT === null) {
          const ready =
            document.querySelector(".hero-composition.is-visible") &&
            !document.documentElement.classList.contains("loading-active");
          if (!ready) {
            raf = requestAnimationFrame(frame);
            return;
          }
          if (gateMetAt === null) gateMetAt = now;
          if (now - gateMetAt < ENTRANCE_DELAY_MS) {
            raf = requestAnimationFrame(frame);
            return;
          }
          startT = now;
        }
        t = (now - startT) / 1000;
      }
      const life = t / DUR;
      if (INTRO_FREEZE == null && life >= 1) { ctx.clearRect(0, 0, W, H); return; } // done — stop the loop
      // PERF: the blast is a load-in flourish, invisible under the dive mosaic
      // once you scroll. Stop the thousands-of-fillText loop the instant the user
      // scrolls so it never overlaps (and tanks) the scroll dive.
      if (INTRO_FREEZE == null && window.scrollY > (window.innerHeight || 1) * 0.1) {
        ctx.clearRect(0, 0, W, H);
        return;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.font = `600 ${FONT}px "Geist Mono","Geist",monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Sized to sit ON the ring (its outer band ≈ the ASCII ring's
      // radius), not tucked inside it. Tunable.
      const maxR = Math.min(W, H) * 0.66;
      // BANG: the shock front bursts out fast (full size by ~16% of life),
      // then the blast HOLDS and slowly dissipates over the long tail so the
      // explosion is clearly seen and lingers (not a quick zip, not a slow
      // open).
      const front = easeOut(Math.min(1, life / 0.16)) * maxR;
      const flash = Math.max(0, 1 - life / 0.1); // intense, brief onset flash
      // Hold at full, then a slow ease-out dissipation across the back ~60%.
      const gA = 1 - smooth(0.4, 1.0, life);

      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2;
          const dx = px - cx, dy = py - cy;
          const r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);

          // rounded blast perimeter (v1, rounded): big round base, gentle
          // lumps, softened radiating spikes.
          const puffs = 0.5 + 0.5 * Math.sin(ang * 5 + 1.3) + 0.35 * Math.sin(ang * 3 - 0.7);
          const spikes = Math.pow(0.5 + 0.5 * Math.cos(ang * 9), 5);
          const edge = front * (0.84 + 0.13 * puffs) * (1.0 + 0.28 * spikes);
          if (r > edge + CELL) continue;

          const turb = fbm(gx * 0.18 + ang * 1.5, gy * 0.18 - t * 1.6);
          const norm = r / Math.max(1, edge);
          const shell = Math.exp(-Math.pow((r - front * 0.92) / (maxR * 0.16), 2));
          const core = Math.max(0, 1 - norm * 1.25);
          let inten = (0.55 * core + 0.85 * shell) * (0.65 + 0.7 * turb);
          inten += flash * Math.max(0, 1 - r / (maxR * 0.28)) * 1.4;
          if (norm > 0.82) inten *= 0.4 + 0.9 * turb;
          inten = Math.max(0, Math.min(1, inten)) * gA;
          if (inten < 0.1) continue;

          const gi = Math.min(RAMP.length - 1, Math.max(1, Math.floor(inten * (RAMP.length - 1) + 0.001)));
          let col: string;
          if (inten > 0.82) col = `rgba(255,${Math.round(225 - 60 * (1 - inten))},200,1)`;
          else if (inten > 0.45) col = `rgba(255,79,0,${(0.85 + 0.15 * inten).toFixed(2)})`;
          else col = `rgba(255,79,0,${(0.35 + 0.5 * inten).toFixed(2)})`;
          ctx.fillStyle = col;
          ctx.fillText(RAMP[gi]!, px, py);
        }
      }

      // flying debris glyphs
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * 6.283 + i * 0.7;
        const dr = front * (1.05 + hash(i, 3) * 0.7);
        const dlife = Math.max(0, 1 - (life - 0.15) / 0.85) * gA;
        if (dlife <= 0) continue;
        const rr = dr * easeOut(Math.min(1, life / 0.22)); // flung out fast, then drift
        ctx.fillStyle = `rgba(255,79,0,${(0.7 * dlife).toFixed(2)})`;
        ctx.fillText(RAMP[2 + (i % 4)]!, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1, // above the ring (z0), below the wordmark (z2)
      }}
    />
  );
}
