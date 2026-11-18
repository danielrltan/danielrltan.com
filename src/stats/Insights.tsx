// The Poddle admin section of the stats panel: Live, Players, Play, Audience, Behaviour.
// Data: src/stats/data.ts (loadLive / loadInsights), anonymous totals only.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, KeyRound } from "lucide-react";
import { KeyError, loadInsights, loadLive, type Insights as Ins, type Live } from "./data";

const TABS = ["Live", "Players", "Play", "Audience", "Behaviour"] as const;
type Tab = (typeof TABS)[number];
const DAYS = [7, 30, 90, 365] as const;
type Days = (typeof DAYS)[number];

const fmt = new Intl.NumberFormat("en");
const n0 = (v: number | undefined | null) => fmt.format(Math.round(v ?? 0));
const pct = (v: number, of: number) => (of > 0 ? Math.round((v / of) * 100) : 0);
const fmtDay = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

function dur(s: number) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return h < 100 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${fmt.format(h)}h`;
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

let names: Intl.DisplayNames | null = null;
try {
  names = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  names = null;
}
function country(cc: string) {
  if (!/^[A-Za-z]{2}$/.test(cc) || cc === "??") return { flag: "\u{1F310}", name: "Unknown" };
  const up = cc.toUpperCase();
  const flag = String.fromCodePoint(...[...up].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  let name = up;
  try {
    name = names?.of(up) ?? up;
  } catch {
    /* keep the code */
  }
  return { flag, name };
}

const prettyKey = (k: string) => k.replace(/[-_]/g, " ");

function lsGet(k: string) {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* not remembered */
  }
}

// ---- small parts ---------------------------------------------------------------

function Tiles({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="ins-tiles" style={{ ["--n" as string]: items.length }}>
      {items.map((t) => (
        <div className="tile" key={t.label}>
          <div className="total-label">{t.label}</div>
          <div className="tile-value">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

function Block({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="ins-block">
      {(title || right) && (
        <div className="ins-block-head">
          <span>{title}</span>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

type BarRow = { key: string; label: ReactNode; value: number; sub?: string };
function BarList({ rows, empty = "None yet" }: { rows: BarRow[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="list-empty">{empty}</div>;
  return (
    <div className="ins-bars">
      {rows.map((r) => (
        <div className="list-row" key={r.key}>
          <div className="list-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          <span className="list-label">{r.label}</span>
          <span className="list-value">
            {n0(r.value)}
            {r.sub && <em>{r.sub}</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

const withShare = (rows: { k: string; n: number }[], label?: (k: string) => ReactNode): BarRow[] => {
  const total = rows.reduce((a, r) => a + r.n, 0);
  return rows.map((r) => ({ key: r.k, label: label ? label(r.k) : r.k, value: r.n, sub: `${pct(r.n, total)}%` }));
};

const countryRows = (rows: { cc: string; n: number }[], share: boolean): BarRow[] => {
  const total = rows.reduce((a, r) => a + r.n, 0);
  return rows.map((r) => {
    const c = country(r.cc);
    return {
      key: r.cc,
      label: (
        <>
          <span className="flag">{c.flag}</span> {c.name}
        </>
      ),
      value: r.n,
      sub: share ? `${pct(r.n, total)}%` : undefined,
    };
  });
};

/** Day columns, optionally stacked. Hover or tap a column for its numbers. */
type Series = { name: string; color: string };
function DayChart({ days, series, values }: { days: string[]; series: Series[]; values: number[][] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((_, i) => values.reduce((a, v) => a + (v[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <div className="chart ins-chart" onPointerLeave={() => setHover(null)}>
      <div className="bars short">
        {days.map((d, i) => (
          <div key={d} className={`col${hover === i ? " on" : ""}`} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
            <div className="stk" style={{ height: `${(totals[i] / max) * 100}%` }}>
              {series.map((s, si) => (
                <div key={s.name} style={{ flex: values[si][i] ?? 0, background: s.color }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="axis">
        <span>{days.length ? fmtDay(days[0]) : ""}</span>
        <span>{days.length ? fmtDay(days[days.length - 1]) : ""}</span>
      </div>
      {hover != null && days[hover] && (
        <div
          className="tip"
          style={{
            left: `${((hover + 0.5) / days.length) * 100}%`,
            transform: `translateX(${hover < days.length * 0.2 ? 0 : hover > days.length * 0.8 ? -100 : -50}%)`,
          }}
        >
          <div className="tip-day">{fmtDay(days[hover])}</div>
          {series.map((s, si) => (
            <div className="tip-row" key={s.name}>
              <i className="dot" style={{ background: s.color }} />
              {s.name} <b>{n0(values[si][hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend ins-legend">
      {series.map((s) => (
        <span className="legend-item" key={s.name}>
          <i style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Labelled vertical columns (hours of the day, session lengths). */
function Hist({ items, every = 1 }: { items: { label: string; value: number }[]; every?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="hist">
      <div className="hist-bars">
        {items.map((it) => (
          <div className="hist-col" key={it.label} title={`${it.label}: ${n0(it.value)}`}>
            {items.length <= 8 && <span className="hist-val">{n0(it.value)}</span>}
            <div className="hist-bar" style={{ height: `${(it.value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="hist-axis">
        {items.map((it, i) => (
          <span key={it.label}>{i % every === 0 ? it.label : ""}</span>
        ))}
      </div>
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label?: (v: T) => string }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={String(o)} role="tab" aria-selected={value === o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>
          {label ? label(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

// ---- Live ------------------------------------------------------------------------

const MODES: Record<string, string> = { human: "Human", bot: "Matt", tour: "Tournament", tourbot: "Tournament Matt" };
const mode = (m: string) => MODES[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

function LiveTab({ data }: { data: Live }) {
  const courts = data.courts ?? [];
  return (
    <>
      <Tiles
        items={[
          { label: "Online", value: n0(data.online) },
          { label: "In a menu", value: n0(data.menu) },
          { label: "On court", value: n0(data.court) },
          { label: "Watching", value: n0(data.watching) },
          { label: "Signed in", value: n0(data.signedIn) },
          { label: "Guests", value: n0(data.guests) },
        ]}
      />
      <Block title="Courts" right={<span className="chip static">{courts.length}</span>}>
        {courts.length === 0 ? (
          <div className="list-empty">No courts</div>
        ) : (
          <div className="courts">
            {courts.map((c, i) => (
              <div className="court" key={i}>
                <span className="chip static">{mode(c.mode)}</span>
                <span className="court-score">
                  {c.score?.[0] ?? 0}
                  <i>–</i>
                  {c.score?.[1] ?? 0}
                </span>
                <span className="court-time">{clock(c.secs)}</span>
                <span className="court-watch" title="Watching">
                  <Eye size={13} />
                  {c.watchers}
                </span>
                <span className="court-players">
                  {c.players.map((p, j) => (
                    <span className="court-player" key={j}>
                      <span className={p.name ? "" : "dim"}>{p.name ?? "Guest"}</span>
                      {p.bot && <span className="chip static bot">Matt</span>}
                      {p.status && <span className={`chip static st-${p.status}`}>{p.status}</span>}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Block>
      <div className="ins-cols three">
        <Block title="Screens">
          <BarList rows={(data.screens ?? []).map((s) => ({ key: s.screen, label: prettyKey(s.screen), value: s.n }))} />
        </Block>
        <Block title="Countries">
          <BarList rows={countryRows(data.countries ?? [], false)} />
        </Block>
        <Block title="Devices">
          <BarList rows={(data.devices ?? []).map((d) => ({ key: d.k, label: d.k, value: d.n }))} />
        </Block>
      </div>
    </>
  );
}

// ---- Players ---------------------------------------------------------------------

function Cohorts({ rows }: { rows: Ins["retention"] }) {
  if (!rows.length) return <div className="list-empty">None yet</div>;
  return (
    <div className="scroll">
      <table className="ins-table cohorts">
        <thead>
          <tr>
            <th>Week</th>
            <th>Signups</th>
            {[1, 2, 3, 4].map((w) => (
              <th key={w}>W{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}>
              <td>{fmtDay(r.week)}</td>
              <td>{n0(r.signups)}</td>
              {[r.w1, r.w2, r.w3, r.w4].map((v, i) => {
                if (v == null) return <td key={i} className="heat">–</td>;
                const p = pct(v, r.signups);
                return (
                  <td key={i} className="heat" style={{ background: `rgba(82,168,255,${Math.min(0.75, (p / 100) * 1.4)})` }} title={`${n0(v)} of ${n0(r.signups)}`}>
                    {p}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayersTab({ d }: { d: Ins }) {
  const days = d.daily.map((x) => x.day);
  const a = d.active;
  return (
    <>
      <Tiles
        items={[
          { label: "Accounts", value: n0(d.totals.accounts) },
          { label: "Players", value: n0(d.totals.players) },
          { label: "Active 1d", value: n0(a.d1) },
          { label: "Active 7d", value: n0(a.d7) },
          { label: "Active 30d", value: n0(a.d30) },
          { label: "Signed in", value: `${pct(a.d30Accounts, a.d30)}%` },
        ]}
      />
      <div className="ins-cols two">
        <Block title="Signups">
          <DayChart days={days} series={[{ name: "Signups", color: "var(--blue)" }]} values={[d.daily.map((x) => x.signups)]} />
        </Block>
        <Block title="Players">
          <DayChart days={days} series={[{ name: "Players", color: "var(--blue)" }]} values={[d.daily.map((x) => x.players)]} />
        </Block>
      </div>
      <Block title="Retention">
        <Cohorts rows={d.retention} />
      </Block>
      <Block title="Top players">
        {d.top.length === 0 ? (
          <div className="list-empty">None yet</div>
        ) : (
          <div className="scroll">
            <table className="ins-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="l">Player</th>
                  <th>Matches</th>
                  <th>Wins</th>
                  <th>Win rate</th>
                  <th>Trophies</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((t, i) => (
                  <tr key={t.name}>
                    <td className="dim">{i + 1}</td>
                    <td className="l">{t.name}</td>
                    <td>{n0(t.matches)}</td>
                    <td>{n0(t.wins)}</td>
                    <td>{pct(t.wins, t.matches)}%</td>
                    <td>{n0(t.trophies)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    </>
  );
}

// ---- Play ------------------------------------------------------------------------

const KINDS: { k: string; name: string; color: string }[] = [
  { k: "bot", name: "Matt", color: "#52a8ff" },
  { k: "human", name: "Human", color: "#3fb950" },
  { k: "tour", name: "Tournament", color: "#ffb347" },
  { k: "tourbot", name: "Tournament Matt", color: "#a78bfa" },
];
const ENDINGS: Record<string, string> = { won: "Played out", forfeit: "Forfeit", left: "Left", dropped: "Dropped" };

function PlayTab({ d }: { d: Ins }) {
  const [local, setLocal] = useState(false);
  const days = d.daily.map((x) => x.day);
  const total = d.daily.reduce((a, x) => a + x.matches, 0);
  const hours = useMemo(() => {
    const base = d.hours?.length === 24 ? d.hours : Array(24).fill(0);
    const off = local ? Math.round(-new Date().getTimezoneOffset() / 60) : 0;
    const out: number[] = Array(24).fill(0);
    base.forEach((v, h) => (out[(((h + off) % 24) + 24) % 24] = v));
    return out.map((v, h) => ({ label: String(h), value: v }));
  }, [d.hours, local]);
  const kinds = KINDS.filter((k) => d.daily.some((x) => (x.byKind?.[k.k] ?? 0) > 0));
  const endings = Object.entries(d.match.endings ?? {}).sort((a, b) => b[1] - a[1]);
  const endTotal = endings.reduce((a, [, v]) => a + v, 0);
  return (
    <>
      <Tiles
        items={[
          { label: "Matches", value: n0(total) },
          { label: "Average length", value: dur(d.match.avgS) },
          { label: "Median length", value: dur(d.match.medianS) },
        ]}
      />
      <Block title="Matches">
        <DayChart days={days} series={kinds.map((k) => ({ name: k.name, color: k.color }))} values={kinds.map((k) => d.daily.map((x) => x.byKind?.[k.k] ?? 0))} />
        <Legend series={kinds} />
      </Block>
      <div className="ins-cols two">
        <Block title="Hour of day" right={<Seg value={local ? "Local" : "UTC"} options={["UTC", "Local"] as const} onChange={(v) => setLocal(v === "Local")} />}>
          <Hist items={hours} every={3} />
        </Block>
        <Block title="Endings">
          <BarList rows={endings.map(([k, v]) => ({ key: k, label: ENDINGS[k] ?? k, value: v, sub: `${pct(v, endTotal)}%` }))} />
        </Block>
      </div>
    </>
  );
}

// ---- Audience --------------------------------------------------------------------

function AudienceTab({ d }: { d: Ins }) {
  const days = d.daily.map((x) => x.day);
  const sessions = d.daily.reduce((a, x) => a + x.sessions, 0);
  const avg = sessions ? d.daily.reduce((a, x) => a + x.avgSessionS * x.sessions, 0) / sessions : 0;
  return (
    <>
      <Tiles
        items={[
          { label: "Sessions", value: n0(sessions) },
          { label: "Average session", value: dur(avg) },
          { label: "Visitors", value: n0(d.daily.reduce((a, x) => a + x.visitors, 0)) },
        ]}
      />
      <div className="ins-cols two">
        <Block title="Countries">
          <BarList rows={countryRows(d.countries, true)} />
          <a className="credit" href="https://db-ip.com" target="_blank" rel="noreferrer">
            IP geolocation by DB-IP
          </a>
        </Block>
        <div className="ins-stack">
          <Block title="Devices">
            <BarList rows={withShare(d.devices)} />
          </Block>
          <Block title="Operating systems">
            <BarList rows={withShare(d.os)} />
          </Block>
          <Block title="Browsers">
            <BarList rows={withShare(d.browsers)} />
          </Block>
        </div>
      </div>
      <div className="ins-cols two">
        <Block title="Session length">
          <Hist items={d.sessionLen.map((s) => ({ label: s.k, value: s.n }))} />
        </Block>
        <Block title="Sessions per day">
          <DayChart days={days} series={[{ name: "Sessions", color: "var(--blue)" }]} values={[d.daily.map((x) => x.sessions)]} />
        </Block>
      </div>
    </>
  );
}

// ---- Behaviour -------------------------------------------------------------------

function BehaviourTab({ d }: { d: Ins }) {
  const [q, setQ] = useState("");
  const totalMs = d.screens.reduce((a, s) => a + s.ms, 0);
  const screens = [...d.screens].sort((a, b) => b.ms - a.ms);
  const needle = q.trim().toLowerCase();
  const presses = d.presses.filter((p) => !needle || p.key.toLowerCase().includes(needle)).slice(0, 40);
  return (
    <>
      <Block title="Screens">
        {screens.length === 0 ? (
          <div className="list-empty">None yet</div>
        ) : (
          <div className="scroll">
            <table className="ins-table">
              <thead>
                <tr>
                  <th>Screen</th>
                  <th>Opens</th>
                  <th>Total time</th>
                  <th>Per open</th>
                  <th className="share-col">Share</th>
                </tr>
              </thead>
              <tbody>
                {screens.map((s) => {
                  const share = pct(s.ms, totalMs);
                  return (
                    <tr key={s.screen}>
                      <td>{prettyKey(s.screen)}</td>
                      <td>{n0(s.opens)}</td>
                      <td>{dur(s.ms / 1000)}</td>
                      <td>{s.opens ? dur(s.ms / 1000 / s.opens) : "–"}</td>
                      <td className="share-col">
                        <div className="share">
                          <div className="share-track">
                            <div style={{ width: `${(s.ms / Math.max(1, screens[0].ms)) * 100}%` }} />
                          </div>
                          <span>{share}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Block>
      <Block title="Buttons pressed" right={<input className="filter" type="search" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter buttons" />}>
        <BarList rows={presses.map((p) => ({ key: p.key, label: <span className="mono">{p.key}</span>, value: p.n }))} empty="No match" />
      </Block>
    </>
  );
}

// ---- the card --------------------------------------------------------------------

type Fetch<T> = { status: "loading" } | { status: "error"; key: boolean; msg: string } | { status: "ok"; data: T };

export function Insights({ tick, keyName, onKeys }: { tick: number; keyName: string; onKeys: () => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    const t = lsGet("stats.insTab") as Tab;
    return TABS.includes(t) ? t : "Live";
  });
  const [days, setDays] = useState<Days>(() => {
    const v = Number(lsGet("stats.insDays"));
    return (DAYS as readonly number[]).includes(v) ? (v as Days) : 30;
  });
  const [live, setLive] = useState<Fetch<Live>>({ status: "loading" });
  const [ins, setIns] = useState<Fetch<Ins>>({ status: "loading" });
  const isLive = tab === "Live";

  useEffect(() => {
    if (!isLive) return;
    const key = lsGet(keyName);
    if (!key) return setLive({ status: "error", key: true, msg: "no key" });
    let alive = true;
    const pull = () => {
      if (document.hidden) return;
      loadLive(key)
        .then((data) => alive && setLive({ status: "ok", data }))
        .catch((e) => alive && setLive((s) => (s.status === "ok" ? s : { status: "error", key: e instanceof KeyError, msg: String(e?.message ?? e) })));
    };
    pull();
    const id = setInterval(pull, 5000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [isLive, keyName, tick]);

  useEffect(() => {
    if (isLive) return;
    const key = lsGet(keyName);
    if (!key) return setIns({ status: "error", key: true, msg: "no key" });
    let alive = true;
    setIns((s) => (s.status === "ok" ? s : { status: "loading" }));
    loadInsights(key, days)
      .then((data) => alive && setIns({ status: "ok", data: normalise(data) }))
      .catch((e) => alive && setIns({ status: "error", key: e instanceof KeyError, msg: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [isLive, days, keyName, tick]);

  const state: Fetch<unknown> = isLive ? live : ins;
  let body: ReactNode;
  if (state.status === "ok") {
    body = isLive ? (
      <LiveTab data={(live as { data: Live }).data} />
    ) : (
      <Static d={(ins as { data: Ins }).data} tab={tab} />
    );
  } else if (state.status === "loading") {
    body = (
      <div className="empty">
        <div className="spinner" />
      </div>
    );
  } else {
    body = (
      <div className="empty">
        <p>{state.key ? "Poddle key missing or rejected" : `Couldn’t load (${state.msg})`}</p>
        <button className="btn" onClick={onKeys}>
          <KeyRound size={14} /> Keys
        </button>
      </div>
    );
  }

  return (
    <section className="card ins-card">
      <header className="card-head ins-head">
        <h2>Poddle</h2>
        <div className="ins-tabs">
          <Seg
            value={tab}
            options={TABS}
            onChange={(t) => {
              setTab(t);
              lsSet("stats.insTab", t);
            }}
          />
        </div>
        {!isLive && (
          <Seg
            value={days}
            options={DAYS}
            label={(v) => `${v}d`}
            onChange={(v) => {
              setDays(v);
              lsSet("stats.insDays", String(v));
            }}
          />
        )}
      </header>
      {body}
    </section>
  );
}

function Static({ d, tab }: { d: Ins; tab: Tab }) {
  return tab === "Players" ? <PlayersTab d={d} /> : tab === "Play" ? <PlayTab d={d} /> : tab === "Audience" ? <AudienceTab d={d} /> : <BehaviourTab d={d} />;
}

/** Fill anything the server left out so the tabs never trip on a missing field. */
function normalise(d: Partial<Ins>): Ins {
  return {
    days: d.days ?? 30,
    totals: d.totals ?? { accounts: 0, players: 0, matches: 0 },
    active: d.active ?? { d1: 0, d7: 0, d30: 0, d1Accounts: 0, d7Accounts: 0, d30Accounts: 0 },
    daily: d.daily ?? [],
    hours: d.hours ?? [],
    match: d.match ?? { avgS: 0, medianS: 0, endings: {} },
    retention: d.retention ?? [],
    top: d.top ?? [],
    countries: d.countries ?? [],
    devices: d.devices ?? [],
    os: d.os ?? [],
    browsers: d.browsers ?? [],
    sessionLen: d.sessionLen ?? [],
    screens: d.screens ?? [],
    presses: d.presses ?? [],
  };
}
