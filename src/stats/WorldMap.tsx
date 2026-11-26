// Country choropleth for the Poddle Insights tabs. Loaded lazily (with its
// pre-projected shapes, world.json from scripts/build-world-map.mjs) only when a
// tab that shows it opens, so the first paint of /admin does not carry it.
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import world from "./world.json";

export type MapRow = { cc: string; label: string; value: number; sub?: string };

const W: { w: number; h: number; shapes: Record<string, string>; dots: [string, number, number][] } = world as never;
const fmt = new Intl.NumberFormat("en");

// One hue: neutral land, then any visitor at a visible floor, up to --blue.
const LAND = [0x3a, 0x3e, 0x45];
const BLUE = [0x7c, 0xbc, 0xff];
function shade(n: number, max: number) {
  if (n <= 0) return undefined;
  const t = 0.25 + 0.75 * (max > 1 ? Math.log1p(n) / Math.log1p(max) : 1);
  const c = LAND.map((a, i) => Math.round(a + (BLUE[i] - a) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

type Tip = { cc: string; x: number; y: number };

export default function WorldMap({ rows, unit }: { rows: MapRow[]; unit: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const byCc = useMemo(() => new Map(rows.map((r) => [r.cc, r])), [rows]);
  const max = Math.max(1, ...rows.map((r) => r.value));

  const point = (e: RPointerEvent, cc: string) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ cc, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const leave = (e: RPointerEvent) => {
    if (e.pointerType !== "touch") setTip(null);
  };

  const row = tip ? byCc.get(tip.cc) : undefined;
  const label = tip ? (row?.label ?? tipName(tip.cc)) : "";
  const bw = box.current?.clientWidth ?? 1;
  const bh = box.current?.clientHeight ?? 1;

  return (
    <div className="wm" ref={box} onPointerLeave={leave} onPointerDown={(e) => e.target === e.currentTarget && setTip(null)}>
      <svg viewBox={`0 0 ${W.w} ${W.h}`} role="img" aria-label="Map of countries" onPointerDown={(e) => e.target === e.currentTarget && setTip(null)}>
        {Object.entries(W.shapes).map(([cc, d]) => {
          const fill = shade(byCc.get(cc)?.value ?? 0, max);
          return (
            <path
              key={cc}
              d={d}
              className={fill ? "wm-on" : undefined}
              style={fill ? { fill } : undefined}
              onPointerEnter={(e) => point(e, cc)}
              onPointerMove={(e) => point(e, cc)}
              onPointerDown={(e) => point(e, cc)}
            />
          );
        })}
        {tip && W.shapes[tip.cc] && <path className="wm-hi" d={W.shapes[tip.cc]} />}
      </svg>
      {W.dots.map(([cc, x, y]) => {
        const r = byCc.get(cc);
        if (!r || r.value <= 0) return null;
        return (
          <span
            key={cc}
            className={`wm-dot${tip?.cc === cc ? " on" : ""}`}
            style={{ left: `${(x / W.w) * 100}%`, top: `${(y / W.h) * 100}%`, ["--c" as string]: shade(r.value, max) }}
            onPointerEnter={(e) => point(e, cc)}
            onPointerDown={(e) => point(e, cc)}
          />
        );
      })}
      {tip && (
        <div
          className="tip wm-tip"
          style={{
            left: tip.x,
            top: tip.y > bh * 0.55 ? tip.y - 12 : tip.y + 16,
            transform: `translate(${tip.x < bw * 0.25 ? 0 : tip.x > bw * 0.75 ? -100 : -50}%, ${tip.y > bh * 0.55 ? -100 : 0}%)`,
          }}
        >
          <div className="tip-day">{label}</div>
          <div className="tip-row">
            {unit}{" "}
            <b>
              {fmt.format(row?.value ?? 0)}
              {row?.sub && <em>{row.sub}</em>}
            </b>
          </div>
        </div>
      )}
    </div>
  );
}

let names: Intl.DisplayNames | null = null;
function tipName(cc: string) {
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(cc) ?? cc;
  } catch {
    return cc;
  }
}
