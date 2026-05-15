/**
 * Bauhaus-leaning blob wallpaper. Three large, blurred radial-gradient
 * discs slowly drift across the desktop on alternating keyframes so the
 * motion never quite loops in an obvious place. Colors track the active
 * theme via CSS variables (warm mode = oranges + tan; cool mode swaps in
 * the muted purple as the second blob).
 *
 * Sits behind every other layer (icons, widgets, windows). Inert: no
 * pointer events so clicks pass through to the desktop beneath.
 */
export function Wallpaper() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        // Stack: blobs first, dot grid on top for that paper texture.
      }}
    >
      <div className="bw-blob bw-blob-a" />
      <div className="bw-blob bw-blob-b" />
      <div className="bw-blob bw-blob-c" />
      <div className="bw-blob bw-blob-d" />
      <div className="bw-dotgrid" />

      <style>{`
        .bw-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          will-change: transform;
          mix-blend-mode: multiply;
        }
        .bw-blob-a {
          width: 720px; height: 720px;
          background: radial-gradient(circle, color-mix(in srgb, var(--accent) 70%, transparent) 0%, transparent 62%);
          top: -160px;
          left: -180px;
          opacity: 0.95;
          animation: bw-drift-a 26s ease-in-out infinite alternate;
        }
        .bw-blob-b {
          width: 620px; height: 620px;
          background: radial-gradient(circle, color-mix(in srgb, var(--accent2) 75%, transparent) 0%, transparent 64%);
          bottom: -180px;
          right: -160px;
          opacity: 0.9;
          animation: bw-drift-b 32s ease-in-out infinite alternate;
        }
        .bw-blob-c {
          width: 460px; height: 460px;
          background: radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, transparent) 0%, transparent 68%);
          top: 30%;
          left: 38%;
          opacity: 0.75;
          animation: bw-drift-c 22s ease-in-out infinite alternate;
        }
        .bw-blob-d {
          width: 540px; height: 540px;
          background: radial-gradient(circle, color-mix(in srgb, var(--accent2) 50%, transparent) 0%, transparent 65%);
          top: 8%;
          right: 12%;
          opacity: 0.65;
          animation: bw-drift-d 38s ease-in-out infinite alternate;
        }
        .bw-dotgrid {
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at center, color-mix(in srgb, var(--muted) 40%, transparent) 1px, transparent 1.4px);
          background-size: 26px 26px;
          opacity: 0.18;
        }

        @keyframes bw-drift-a {
          0%   { transform: translate(0, 0)        scale(1);    }
          50%  { transform: translate(28vw, 18vh) scale(1.05); }
          100% { transform: translate(10vw, 36vh) scale(0.95); }
        }
        @keyframes bw-drift-b {
          0%   { transform: translate(0, 0)         scale(1);    }
          50%  { transform: translate(-22vw, -16vh) scale(1.08); }
          100% { transform: translate(-6vw, -34vh)  scale(0.94); }
        }
        @keyframes bw-drift-c {
          0%   { transform: translate(0, 0)        scale(1);   }
          50%  { transform: translate(-14vw, 12vh) scale(1.1); }
          100% { transform: translate(14vw, -10vh) scale(0.9); }
        }
        @keyframes bw-drift-d {
          0%   { transform: translate(0, 0)        scale(1);    }
          50%  { transform: translate(-18vw, 24vh) scale(0.92); }
          100% { transform: translate(8vw, 10vh)   scale(1.05); }
        }

        @media (prefers-reduced-motion: reduce) {
          .bw-blob { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
