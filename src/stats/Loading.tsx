// The Loading card of the stats panel: page-load timings, a merged flame graph of the sampled JS profiles,
// clicks, and per-load waterfall + flame chart. Data: ./perf.ts (Poddle's collector, the Poddle key).
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, X } from "lucide-react";
import { KeyError } from "./data";
import {
  PERF_SITES,
  fileLabel,
  flameChart,
  getClicks,
  getTrace,
  getView,
  listLoads,
  mergeTraces,
  pct,
  profiledIds,
  toCpuProfile,
  type ClickStats,
  type FlameNode,
  type Frame,
  type LoadRow,
  type PerfSite,
  type Trace,
  type View,
} from "./perf";

const ms = (v: number | null | undefined) => (v == null ? "–" : v >= 10000 ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const kb = (v: number | null | undefined) => (v == null ? "" : v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.round(v / 1024)} KB`);
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const readKey = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* not remembered */
  }
};

// ---- flame graph canvas (icicle for the merged tree, flame chart for one load) ----

type Block = { depth: number; x0: number; x1: number; frame: Frame; total: number; self: number | null };
const PALETTE = ["#ff7a3d", "#ffb347", "#f2d16b", "#7cc4a4", "#52a8ff", "#a78bfa", "#f472b6", "#5eead4"];
function colorOf(f: Frame) {
  if (!f.file) return "#3a3a3a"; // native / browser
  let h = 0;
  for (let i = 0; i < f.file.length; i++) h = (h * 31 + f.file.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function treeBlocks(root: FlameNode): Block[] {
  const out: Block[] = [];
  const walk = (n: FlameNode, depth: number, x0: number) => {
    out.push({ depth, x0, x1: x0 + n.total, frame: n.frame, total: n.total, self: n.self });
    let x = x0;
    for (const c of [...n.children.values()].sort((a, b) => b.total - a.total)) {
      walk(c, depth + 1, x);
      x += c.total;
    }
  };
  walk(root, 0, 0);
  return out;
}

const ROW = 18;
function Flame({ blocks, span, unit }: { blocks: Block[]; span: [number, number]; unit: "tree" | "time" }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<[number, number]>(span);
  const [hover, setHover] = useState<{ b: Block; x: number; y: number } | null>(null);
  const [w, setW] = useState(800);
  useEffect(() => setView(span), [span]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const depth = Math.min(60, blocks.reduce((m, b) => Math.max(m, b.depth + 1), 1));
  const h = depth * ROW;
  const sx = (x: number) => ((x - view[0]) / Math.max(1e-6, view[1] - view[0])) * w;
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = "11px Geist Mono, ui-monospace, monospace";
    g.textBaseline = "middle";
    for (const b of blocks) {
      if (b.depth >= depth) continue;
      const x0 = sx(b.x0);
      const x1 = sx(b.x1);
      if (x1 < 0 || x0 > w || x1 - x0 < 0.5) continue;
      const y = b.depth * ROW;
      g.fillStyle = b.depth === 0 && unit === "tree" ? "#262626" : colorOf(b.frame);
      g.globalAlpha = hover && hover.b === b ? 1 : 0.85;
      g.fillRect(Math.max(0, x0), y, Math.min(w, x1) - Math.max(0, x0) - 1, ROW - 1);
      const tw = Math.min(w, x1) - Math.max(0, x0) - 6;
      if (tw > 24) {
        g.globalAlpha = 1;
        g.fillStyle = b.frame.file || (b.depth === 0 && unit === "tree") ? "#0a0a0a" : "#d4d4d4";
        if (b.depth === 0 && unit === "tree") g.fillStyle = "#ededed";
        let label = b.frame.name;
        while (label.length > 1 && g.measureText(label).width > tw) label = label.slice(0, -2);
        if (label !== b.frame.name) label = label.slice(0, -1) + "…";
        g.fillText(label, Math.max(0, x0) + 3, y + ROW / 2);
      }
    }
    g.globalAlpha = 1;
  }, [blocks, view, w, h, hover]);
  const hit = (e: React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const d = Math.floor((e.clientY - r.top) / ROW);
    const t = view[0] + (x / w) * (view[1] - view[0]);
    return blocks.find((b) => b.depth === d && b.x0 <= t && t < b.x1) ?? null;
  };
  const whole = span[1] - span[0];
  return (
    <div className="flame" ref={wrap} onPointerLeave={() => setHover(null)}>
      <canvas
        ref={cv}
        style={{ width: w, height: h }}
        onPointerMove={(e) => {
          const b = hit(e);
          const r = wrap.current!.getBoundingClientRect();
          setHover(b ? { b, x: e.clientX - r.left, y: e.clientY - r.top + wrap.current!.scrollTop } : null);
        }}
        onClick={(e) => {
          const b = hit(e);
          if (!b || (b.x0 <= view[0] && b.x1 >= view[1])) setView(span);
          else setView([b.x0, b.x1]);
        }}
      />
      {hover && (
        <div className="tip flame-tip" style={{ left: Math.min(hover.x + 12, w - 280), top: hover.y + 14 }}>
          <div className="tip-day">{hover.b.frame.name}</div>
          {hover.b.frame.file && (
            <div className="tip-file">
              {hover.b.frame.file}
              {hover.b.frame.line != null ? `:${hover.b.frame.line}:${hover.b.frame.col}` : ""}
            </div>
          )}
          <div className="tip-row">
            {unit === "tree" ? "Total" : "Duration"} <b>{ms(hover.b.total)}</b>
            {unit === "tree" && whole > 0 && <span className="tip-dim">{Math.round((hover.b.total / whole) * 100)}%</span>}
          </div>
          {hover.b.self != null && (
            <div className="tip-row">
              Self <b>{ms(hover.b.self)}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- waterfall ----

function Waterfall({ v }: { v: View }) {
  const L = v.load;
  if (!L) return <div className="list-empty">The load part never arrived (the tab closed before it settled).</div>;
  const n = L.nav;
  const res = [...L.res].sort((a, b) => a[2] - b[2]).slice(0, 80);
  const end = Math.max(n.le ?? 0, L.lcp.t ?? 0, ...res.map((r) => r[2] + r[3]), ...L.loaf.map((f) => f[0] + f[1])) * 1.04 || 1;
  const pc = (t: number | null | undefined) => `${(Math.max(0, t ?? 0) / end) * 100}%`;
  const wd = (a: number | null | undefined, b: number | null | undefined) => `${(Math.max(0.15, (b ?? 0) - (a ?? 0)) / end) * 100}%`;
  const phases: [string, number | null, number | null][] = [
    ["Redirect", 0, n.rs],
    ["DNS", n.ds, n.de],
    ["Connect", n.cs, n.ce],
    ["Request", n.qs, n.ps],
    ["Download", n.ps, n.pe],
  ];
  const marks: [string, number | null][] = [
    ["FCP", L.fcp],
    ["LCP", L.lcp.t],
    ["DCL", n.dl],
    ["Load", n.le],
  ];
  return (
    <div className="wf">
      <div className="wf-row">
        <span className="wf-label">Document</span>
        <div className="wf-track">
          {phases
            .filter(([, a, b]) => a != null && b != null && b - a > 0)
            .map(([name, a, b]) => (
              <div key={name} className={`wf-bar ph-${name.toLowerCase()}`} style={{ left: pc(a), width: wd(a, b) }} title={`${name} ${ms((b ?? 0) - (a ?? 0))}`} />
            ))}
        </div>
      </div>
      <div className="wf-row">
        <span className="wf-label">Main thread</span>
        <div className="wf-track">
          {L.loaf.map((f, i) => (
            <div
              key={i}
              className="wf-bar loaf"
              style={{ left: pc(f[0]), width: wd(f[0], f[0] + f[1]) }}
              title={`Long frame ${ms(f[1])} (blocking ${ms(f[2])})\n` + f[5].map((s) => `${ms(s[5])}  ${s[1] || s[2] || s[3]}  ${fileLabel(s[0])}`).join("\n")}
            />
          ))}
        </div>
      </div>
      {res.map((r, i) => (
        <div className="wf-row" key={i} title={`${r[0]}\n${r[1]} · ${ms(r[3])}${r[4] ? " · " + kb(r[4]) : r[5] ? " · cached " + kb(r[5]) : ""}${r[7] === "blocking" ? " · render-blocking" : ""}`}>
          <span className="wf-label">
            {r[7] === "blocking" && <i className="wf-block" />}
            {fileLabel(r[0])}
          </span>
          <div className="wf-track">
            <div className={`wf-bar res-${r[1]}`} style={{ left: pc(r[2]), width: wd(r[2], r[2] + r[3]) }} />
          </div>
        </div>
      ))}
      <div className="wf-marks">
        {marks
          .filter(([, t]) => t != null)
          .map(([name, t], i) => (
            <div key={name} className="wf-mark" style={{ left: pc(t) }}>
              <span style={{ top: -14 - i * 12 }}>
                {name} {ms(t)}
              </span>
            </div>
          ))}
      </div>
      <div className="wf-axis">
        <span>0</span>
        <span>{ms(end / 2)}</span>
        <span>{ms(end)}</span>
      </div>
    </div>
  );
}

// ---- one load ----

function LoadDetail({ id, keyStr, onClose }: { id: string; keyStr: string; onClose: () => void }) {
  const [v, setV] = useState<View | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setV(null);
    setTrace(null);
    getView(keyStr, id)
      .then((x) => {
        if (!live) return;
        setV(x);
        if (x.prof) getTrace(keyStr, id).then((t) => live && setTrace(t), () => {});
      })
      .catch((e) => live && setErr(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [id, keyStr]);
  const chart = useMemo(() => {
    if (!trace) return null;
    const c = flameChart(trace);
    const blocks: Block[] = c.blocks.map((b) => ({ depth: b.depth, x0: b.start, x1: b.end, frame: b.frame, total: b.end - b.start, self: null }));
    return { blocks, span: [c.start, c.end] as [number, number] };
  }, [trace]);
  const save = () => {
    if (!trace) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(toCpuProfile(trace))], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${v?.site ?? "load"}-${id}.cpuprofile`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <b>{v?.page ?? "…"}</b>
          {v && (
            <span className="detail-meta">
              {new Date(v.at).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {v.ua}
              {v.load ? ` · ${v.load.env.w}×${v.load.env.h}` : ""}
              {v.load?.env.cpu ? ` · ${v.load.env.cpu} cores` : ""}
              {v.load?.env.net ? ` · ${v.load.env.net}` : ""}
              {v.load?.nav.pr ? ` · ${v.load.nav.pr}` : ""}
            </span>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      {err && <div className="list-empty">Couldn’t load ({err})</div>}
      {v && (
        <>
          <div className="tiles small">
            <Tile label="TTFB" v={v.ttfb} />
            <Tile label="FCP" v={v.fcp} />
            <Tile label="LCP" v={v.lcp} />
            <Tile label="Load" v={v.onload} />
            <Tile label="Blocking" v={v.block} />
            <Tile label="INP" v={v.inp} />
          </div>
          <Waterfall v={v} />
          <div className="sub-head">
            <span>Flame chart</span>
            {trace && (
              <button className="btn ghost" onClick={save}>
                <Download size={14} /> .cpuprofile
              </button>
            )}
          </div>
          {chart ? (
            <Flame blocks={chart.blocks} span={chart.span} unit="time" />
          ) : (
            <div className="list-empty">
              {v.prof ? "Loading the profile…" : v.load?.profErr ? `Not profiled (${v.load.profErr})` : "This load was not in the profiled sample."}
            </div>
          )}
          {v.fin && v.fin.ev.length > 0 && (
            <div className="list">
              <div className="list-head">Interactions (slowest first)</div>
              {v.fin.ev.map((e, i) => (
                <div className="list-row" key={i}>
                  <span className="list-label">
                    {e[0]} {e[1]}
                  </span>
                  <span className="list-value" title={`input delay ${ms(e[4])} · processing ${ms(e[5])} · presentation ${ms(e[6])}`}>
                    {ms(e[3])}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, v, text }: { label: string; v: number | null; text?: string }) {
  return (
    <div className="tile">
      <div className="total-label">{label}</div>
      <div className="tile-value">{text ?? ms(v)}</div>
    </div>
  );
}

// ---- the card ----

type St = { status: "nokey" } | { status: "loading" } | { status: "error"; key: boolean; msg: string } | { status: "ok"; rows: LoadRow[] };

export function Loading({ range, tick, onKeys }: { range: number; tick: number; onKeys: () => void }) {
  const [site, setSite] = useState<PerfSite>(() => (PERF_SITES as readonly string[]).includes(readKey("stats.perfSite")) ? (readKey("stats.perfSite") as PerfSite) : "danielrltan.com");
  const [st, setSt] = useState<St>({ status: "loading" });
  const [page, setPage] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tree, setTree] = useState<{ root: FlameNode; n: number } | "loading" | null>(null);
  const [clicks, setClicks] = useState<ClickStats | null>(null);
  const key = readKey("stats.poddleKey");
  const days = Math.min(30, range);

  useEffect(() => {
    if (!key) return setSt({ status: "nokey" });
    let live = true;
    setSt((s) => (s.status === "ok" ? s : { status: "loading" }));
    listLoads(key, site, days)
      .then((rows) => live && setSt({ status: "ok", rows }))
      .catch((e) => live && setSt({ status: "error", key: e instanceof KeyError, msg: String(e?.message ?? e) }));
    getClicks(key, site, days).then((c) => live && setClicks(c), () => live && setClicks(null));
    return () => {
      live = false;
    };
  }, [key, site, days, tick]);

  const rows = st.status === "ok" ? st.rows : [];
  const pages = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.page, (m.get(r.page) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const cur = page && pages.some(([p]) => p === page) ? page : pages[0]?.[0] ?? null;
  const sel = rows.filter((r) => r.page === cur);

  useEffect(() => {
    if (!key || !cur) return setTree(null);
    let live = true;
    setTree("loading");
    profiledIds(key, site, cur, days)
      .then((ids) => Promise.all(ids.slice(0, 30).map((id) => getTrace(key, id).catch(() => null))))
      .then((ts) => {
        if (!live) return;
        const ok = ts.filter((t): t is Trace => !!t);
        setTree(ok.length ? { root: mergeTraces(ok), n: ok.length } : null);
      })
      .catch(() => live && setTree(null));
    return () => {
      live = false;
    };
  }, [key, site, cur, days, tick]);
  const merged = useMemo(() => (tree && tree !== "loading" ? { blocks: treeBlocks(tree.root), span: [0, tree.root.total] as [number, number] } : null), [tree]);

  return (
    <section className="card loading-card">
      <header className="card-head">
        <h2>Loading</h2>
        <div className="seg" role="tablist">
          {PERF_SITES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={site === s}
              className={site === s ? "on" : ""}
              onClick={() => {
                setSite(s);
                setPage(null);
                setOpen(null);
                remember("stats.perfSite", s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </header>
      {st.status === "ok" ? (
        rows.length === 0 ? (
          <div className="empty">
            <p>No loads recorded in the last {days} days</p>
          </div>
        ) : (
          <>
            <div className="chips">
              {pages.slice(0, 12).map(([p, n]) => (
                <button key={p} className={`chip${p === cur ? " on" : ""}`} onClick={() => (setPage(p), setOpen(null))}>
                  {p} <span>{n}</span>
                </button>
              ))}
            </div>
            <div className="tiles">
              <Tile label="Loads" v={null} text={String(sel.length)} />
              <Tile label="TTFB p75" v={pct(sel.map((r) => r.ttfb), 0.75)} />
              <Tile label="FCP p75" v={pct(sel.map((r) => r.fcp), 0.75)} />
              <Tile label="LCP p75" v={pct(sel.map((r) => r.lcp), 0.75)} />
              <Tile label="Load p75" v={pct(sel.map((r) => r.onload), 0.75)} />
              <Tile label="Blocking p75" v={pct(sel.map((r) => r.block), 0.75)} />
              <Tile label="INP p75" v={pct(sel.map((r) => r.inp), 0.75)} />
            </div>
            <div className="sub-head">
              <span>Flame graph{tree && tree !== "loading" ? ` · ${tree.n} profiled load${tree.n === 1 ? "" : "s"}, ${(tree.root.total / 1000).toFixed(1)} s of JS` : ""}</span>
            </div>
            {merged ? (
              <Flame blocks={merged.blocks} span={merged.span} unit="tree" />
            ) : (
              <div className="list-empty">{tree === "loading" ? "Loading profiles…" : "No profiled loads of this page yet (Chromium browsers only)."}</div>
            )}
            {open && <LoadDetail id={open} keyStr={key} onClose={() => setOpen(null)} />}
            <div className="lists">
              <div className="list loads">
                <div className="list-head">Loads</div>
                <div className="loads-head">
                  <span>When</span>
                  <span>Browser</span>
                  <span>TTFB</span>
                  <span>LCP</span>
                  <span>Load</span>
                  <span>Blocking</span>
                </div>
                {sel.slice(0, 40).map((r) => (
                  <button key={r.id} className={`loads-row${open === r.id ? " on" : ""}`} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <span>{ago(r.at)}</span>
                    <span className="loads-ua">
                      {r.prof ? <i className="dot prof" title="Profiled" /> : null}
                      {r.ua}
                    </span>
                    <span>{ms(r.ttfb)}</span>
                    <span>{ms(r.lcp)}</span>
                    <span>{ms(r.onload)}</span>
                    <span>{ms(r.block)}</span>
                  </button>
                ))}
              </div>
              <div className="list">
                <div className="list-head">{site === "poddleball.com" ? "Slowest to respond (by element type)" : "Slowest to respond"}</div>
                {!clicks || clicks.slow.length === 0 ? (
                  <div className="list-empty">None yet</div>
                ) : (
                  clicks.slow.slice(0, 8).map((s) => (
                    <div className="list-row" key={s.target}>
                      <span className="list-label">{s.target}</span>
                      <span className="list-value" title={`${s.n} interactions, worst ${ms(s.max)}`}>
                        {ms(s.p75)}
                      </span>
                    </div>
                  ))
                )}
                {site === "danielrltan.com" && (
                  <>
                    <div className="list-head gap">Clicks</div>
                    {!clicks || clicks.targets.length === 0 ? (
                      <div className="list-empty">None yet</div>
                    ) : (
                      clicks.targets.slice(0, 10).map((c) => (
                        <div className="list-row" key={c.target}>
                          <span className="list-label">{c.target}</span>
                          <span className="list-value">{c.n}</span>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )
      ) : st.status === "loading" ? (
        <div className="empty">
          <div className="spinner" />
        </div>
      ) : (
        <div className="empty">
          <p>{st.status === "nokey" ? "Add your Poddle key" : st.key ? "Poddle key rejected" : `Couldn’t load (${st.msg})`}</p>
          <button className="btn" onClick={onKeys}>
            <KeyRound size={14} /> Keys
          </button>
        </div>
      )}
    </section>
  );
}
