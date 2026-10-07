import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpRight, KeyRound, RefreshCw } from "lucide-react";
import { KeyError, loadPoddle, loadUmami, type Day, type Row, type SiteStats } from "./data";
import "./stats.css";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

// localStorage can throw (private windows, blocked storage): the page still works, keys just aren't remembered.
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? "";
    } catch {
      return "";
    }
  },
  set: (k: string, v: string) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* not remembered */
    }
  },
};

type SiteDef = {
  id: string;
  name: string;
  url: string;
  icon: string;
  keyName: string; // localStorage key
  keyLabel: string;
  load: (key: string, range: number) => Promise<SiteStats>;
};

const SITES: SiteDef[] = [
  {
    id: "poddle",
    name: "poddleball.com",
    url: "https://poddleball.com",
    icon: "https://poddleball.com/favicon-32.png",
    keyName: "stats.poddleKey",
    keyLabel: "Poddle key",
    load: loadPoddle,
  },
  {
    id: "site",
    name: "danielrltan.com",
    url: "https://danielrltan.com",
    icon: "/dt.png",
    keyName: "stats.umamiKey",
    keyLabel: "Umami API key",
    load: loadUmami,
  },
];

const fmt = new Intl.NumberFormat("en");
const fmtDay = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return (
    <span className={`delta ${cls}`} title={`Previous period: ${fmt.format(before)}`}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

function Chart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.views));
  const h = hover == null ? null : days[hover];
  return (
    <div className="chart" onPointerLeave={() => setHover(null)}>
      <div className="bars">
        {days.map((d, i) => (
          <div
            key={d.day}
            className={`col${hover === i ? " on" : ""}`}
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
          >
            <div className="bar views" style={{ height: `${(d.views / max) * 100}%` }} />
            <div className="bar visitors" style={{ height: `${(d.visitors / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis">
        <span>{fmtDay(days[0].day)}</span>
        <span>{fmtDay(days[days.length - 1].day)}</span>
      </div>
      {h && (
        <div
          className="tip"
          style={{
            left: `${((hover! + 0.5) / days.length) * 100}%`,
            // keep it inside the card at either end of the chart
            transform: `translateX(${hover! < days.length * 0.2 ? 0 : hover! > days.length * 0.8 ? -100 : -50}%)`,
          }}
        >
          <div className="tip-day">{fmtDay(h.day)}</div>
          <div className="tip-row">
            <i className="dot visitors" />
            Visitors <b>{fmt.format(h.visitors)}</b>
          </div>
          <div className="tip-row">
            <i className="dot views" />
            Views <b>{fmt.format(h.views)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

function List({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="list">
      <div className="list-head">{title}</div>
      {rows.length === 0 ? (
        <div className="list-empty">None yet</div>
      ) : (
        rows.map((r) => (
          <div className="list-row" key={r.label}>
            <div className="list-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            <span className="list-label">{r.label}</span>
            <span className="list-value">{fmt.format(r.value)}</span>
          </div>
        ))
      )}
    </div>
  );
}

type State = { status: "nokey" } | { status: "loading" } | { status: "error"; key: boolean; msg: string } | { status: "ok"; data: SiteStats };

function SiteCard({ site, range, tick, onKeys }: { site: SiteDef; range: Range; tick: number; onKeys: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const key = store.get(site.keyName);
    if (!key) return setState({ status: "nokey" });
    let live = true;
    setState((s) => (s.status === "ok" ? s : { status: "loading" }));
    site
      .load(key, range)
      .then((data) => live && setState({ status: "ok", data }))
      .catch((e) => live && setState({ status: "error", key: e instanceof KeyError, msg: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, [site, range, tick]);

  return (
    <section className="card">
      <header className="card-head">
        <img className="favicon" src={site.icon} alt="" width={20} height={20} />
        <h2>{site.name}</h2>
        <a className="ext" href={site.url} target="_blank" rel="noreferrer" aria-label={`Open ${site.name}`}>
          <ArrowUpRight size={16} />
        </a>
      </header>
      {state.status === "ok" ? (
        <>
          <div className="totals">
            <div className="total" title="Unique per UTC day, summed over the range">
              <div className="total-label">
                <i className="dot visitors" />
                Visitors
              </div>
              <div className="total-value">
                {fmt.format(state.data.totals.visitors)}
                <Delta now={state.data.totals.visitors} before={state.data.prev.visitors} />
              </div>
            </div>
            <div className="total">
              <div className="total-label">
                <i className="dot views" />
                Views
              </div>
              <div className="total-value">
                {fmt.format(state.data.totals.views)}
                <Delta now={state.data.totals.views} before={state.data.prev.views} />
              </div>
            </div>
          </div>
          <Chart days={state.data.days} />
          <div className="lists">
            <List title="Pages" rows={state.data.pages} />
            <List title="Sources" rows={state.data.sources} />
          </div>
        </>
      ) : state.status === "loading" ? (
        <div className="empty">
          <div className="spinner" />
        </div>
      ) : (
        <div className="empty">
          <p>{state.status === "nokey" ? `Add your ${site.keyLabel}` : state.key ? `${site.keyLabel} rejected` : `Couldn’t load (${state.msg})`}</p>
          <button className="btn" onClick={onKeys}>
            <KeyRound size={14} /> Keys
          </button>
        </div>
      )}
    </section>
  );
}

function Keys({ onDone }: { onDone: () => void }) {
  const [vals, setVals] = useState(() => Object.fromEntries(SITES.map((s) => [s.keyName, store.get(s.keyName)])));
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onDone()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          for (const s of SITES) store.set(s.keyName, vals[s.keyName].trim());
          onDone();
        }}
      >
        <h3>Keys</h3>
        {SITES.map((s) => (
          <label key={s.id} className="field">
            <span>{s.keyLabel}</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={vals[s.keyName]}
              onChange={(e) => setVals((v) => ({ ...v, [s.keyName]: e.target.value }))}
            />
          </label>
        ))}
        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function App() {
  const [range, setRange] = useState<Range>(() => {
    const r = Number(store.get("stats.range"));
    return (RANGES as readonly number[]).includes(r) ? (r as Range) : 30;
  });
  const [tick, setTick] = useState(0);
  const [keys, setKeys] = useState(() => SITES.every((s) => !store.get(s.keyName)));
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return (
    <main className="page">
      <header className="top">
        <h1>Stats</h1>
        <div className="controls">
          <div className="seg" role="tablist">
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={range === r}
                className={range === r ? "on" : ""}
                onClick={() => {
                  setRange(r);
                  store.set("stats.range", String(r));
                }}
              >
                {r}d
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="icon-btn" onClick={() => setKeys(true)} aria-label="Keys" title="Keys">
            <KeyRound size={15} />
          </button>
        </div>
      </header>
      <div className="grid">
        {SITES.map((s) => (
          <SiteCard key={s.id} site={s} range={range} tick={tick} onKeys={() => setKeys(true)} />
        ))}
      </div>
      {keys && (
        <Keys
          onDone={() => {
            setKeys(false);
            refresh();
          }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
