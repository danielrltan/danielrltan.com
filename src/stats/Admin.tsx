import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Dices, KeyRound, X } from "lucide-react";
import {
  adminGet,
  adminPost,
  KeyError,
  type AdminCode,
  type AdminHit,
  type AdminItem,
  type AdminLog,
  type AdminPlayer,
  type AdminStats,
} from "./data";
import { Block, DayChart, Hist, Tiles, dur } from "./Insights";

// The owner's Poddle admin tools (contract: Poddle docs/ADMIN.md). Same key as the rest of the panel.

const TABS = ["Players", "Codes", "Log"] as const;
type Tab = (typeof TABS)[number];

const fmt = new Intl.NumberFormat("en");
const n0 = (n: number | null | undefined) => fmt.format(n ?? 0);

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

/** Times arrive as unix ms (seconds also tolerated) or ISO strings. */
function when(t: number | string | null | undefined): string {
  if (t == null || t === 0 || t === "") return "never";
  const ms = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  if (!Number.isFinite(ms)) return "never";
  return new Date(ms).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function whenDay(t: number | null | undefined): string {
  if (!t) return "never";
  const ms = t < 1e12 ? t * 1000 : t;
  return new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}
/** "5 min ago", "3 d ago". */
function ago(t: number | string | null | undefined): string {
  if (t == null || t === 0 || t === "") return "Never";
  const ms = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  if (!Number.isFinite(ms)) return "Never";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 36) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 24 * 60) return `${Math.round(m / 1440)} d ago`;
  return `${Math.round(m / 43200)} mo ago`;
}
const msOf = (t: number | null | undefined) => (!t ? 0 : t < 1e12 ? t * 1000 : t);

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o} role="tab" aria-selected={value === o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---- inline action state: busy on the button, result next to it, no toasts ----------

type St = { busy?: boolean; msg?: string; err?: boolean };

function useRuns(onDone: () => void | Promise<void>) {
  const [st, setSt] = useState<Record<string, St>>({});
  const run = useCallback(
    async (id: string, fn: () => Promise<unknown>, ok = "Done", refetch = true) => {
      setSt((s) => ({ ...s, [id]: { busy: true } }));
      try {
        await fn();
        setSt((s) => ({ ...s, [id]: { msg: ok } }));
        if (refetch) await onDone();
        return true;
      } catch (e) {
        const msg = e instanceof KeyError ? "Key rejected" : String((e as Error)?.message ?? e);
        setSt((s) => ({ ...s, [id]: { msg, err: true } }));
        return false;
      }
    },
    [onDone],
  );
  return { st, run };
}

function Go({ id, st, label, onClick, disabled, danger }: { id: string; st: Record<string, St>; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  const s = st[id];
  return (
    <span className="adm-go">
      <button className={`btn${danger ? " danger" : " primary"}`} disabled={disabled || s?.busy} onClick={onClick}>
        {s?.busy ? <i className="adm-spin" /> : null}
        {label}
      </button>
      {s?.msg && !s.busy && (
        <span className={`adm-res${s.err ? " err" : ""}`} role="status">
          {s.err ? <X size={13} /> : <Check size={13} />}
          {s.msg}
        </span>
      )}
    </span>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`adm-tog${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <i />
      {label}
    </button>
  );
}

// ---- item picker --------------------------------------------------------------------

const RARITY_ORDER = ["common", "rare", "epic", "legendary", "exclusive"];
const rarityRank = (r: string) => {
  const i = RARITY_ORDER.indexOf(r.toLowerCase());
  return i < 0 ? 99 : i;
};

function ItemPicker({ items, value, onChange }: { items: AdminItem[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const picked = items.find((i) => i.id === value);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const by = new Map<string, AdminItem[]>();
    for (const it of items) {
      if (needle && !`${it.name} ${it.kind} ${it.rarity} ${it.id}`.toLowerCase().includes(needle)) continue;
      by.set(it.kind, [...(by.get(it.kind) ?? []), it]);
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([kind, list]) => ({ kind, list: list.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name)) }));
  }, [items, q]);

  if (picked && !open) {
    return (
      <div className="adm-picked">
        <span className={`adm-rar r-${picked.rarity.toLowerCase()}`} />
        <b>{picked.name}</b>
        <span className="dim">{picked.kind}</span>
        <button className="adm-x" aria-label="Clear item" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <div className="adm-picker">
      <input
        className="adm-in"
        placeholder="Search items"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="adm-pick-list">
          {groups.length === 0 && <div className="list-empty">No items</div>}
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="adm-pick-kind">{g.kind}</div>
              {g.list.map((it) => (
                <button
                  key={it.id}
                  className="adm-pick-row"
                  onClick={() => {
                    onChange(it.id);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className={`adm-rar r-${it.rarity.toLowerCase()}`} />
                  <span className="adm-pick-name">{it.name}</span>
                  <span className="dim">{it.rarity}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Several items at once (a code's bundle): picked ones as chips, the list stays open while you tick rows. */
function MultiItemPicker({ items, value, onChange }: { items: AdminItem[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const by = new Map<string, AdminItem[]>();
    for (const it of items) {
      if (needle && !`${it.name} ${it.kind} ${it.rarity} ${it.id}`.toLowerCase().includes(needle)) continue;
      by.set(it.kind, [...(by.get(it.kind) ?? []), it]);
    }
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([kind, list]) => ({ kind, list: list.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name)) }));
  }, [items, q]);
  const has = new Set(value);
  const toggle = (id: string) => onChange(has.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="adm-picker">
      {value.length > 0 && (
        <div className="adm-multi-chips">
          {value.map((id) => {
            const it = byId.get(id);
            return (
              <span className="adm-multi-chip" key={id}>
                <span className={`adm-rar r-${(it?.rarity ?? "").toLowerCase()}`} />
                {it?.name ?? id}
                <button className="adm-x" aria-label={`Remove ${it?.name ?? id}`} onClick={() => toggle(id)}>
                  <X size={12} />
                </button>
              </span>
            );
          })}
          <button className="adm-multi-clear" onClick={() => onChange([])}>Clear</button>
        </div>
      )}
      <input
        className="adm-in"
        placeholder={value.length ? "Add more items" : "Search items"}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="adm-pick-list">
          <div className="adm-pick-top">
            <span className="dim">{value.length} picked</span>
            <button className="btn" onClick={() => (setOpen(false), setQ(""))}>Done</button>
          </div>
          {groups.length === 0 && <div className="list-empty">No items</div>}
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="adm-pick-kind">{g.kind}</div>
              {g.list.map((it) => (
                <button key={it.id} className={`adm-pick-row${has.has(it.id) ? " on" : ""}`} aria-pressed={has.has(it.id)} onClick={() => toggle(it.id)}>
                  <span className="adm-pick-tick">{has.has(it.id) ? <Check size={13} /> : null}</span>
                  <span className={`adm-rar r-${it.rarity.toLowerCase()}`} />
                  <span className="adm-pick-name">{it.name}</span>
                  <span className="dim">{it.rarity}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Players ------------------------------------------------------------------------

const ACTIONS = ["Coins", "Item", "Inbox", "Rename", "Access"] as const;
type Action = (typeof ACTIONS)[number];
const NOTE_MAX = 140;
const MSG_MAX = 500;

const TIER_NAMES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Champion", "Master", "Pro"];
const ROMAN = ["I", "II", "III"];
function rankName(r: { tier: number | string; div: number | string } | null | undefined): string {
  if (!r) return "None";
  const t = typeof r.tier === "number" ? TIER_NAMES[r.tier - 1] ?? String(r.tier) : r.tier;
  const d = typeof r.div === "number" ? ROMAN[r.div - 1] ?? String(r.div) : r.div;
  return t === "Pro" ? t : `${t} ${d}`;
}
const LIVE_LABEL = { menu: "In a menu", court: "On court", watching: "Watching" } as const;

function PlayPanel({ s }: { s: AdminStats }) {
  const [local, setLocal] = useState(false);
  const l = s.last30;
  const hours = useMemo(() => {
    const off = local ? Math.round(-new Date().getTimezoneOffset() / 60) : 0;
    const out: number[] = Array(24).fill(0);
    l.hours.forEach((v, h) => (out[(((h + off) % 24) + 24) % 24] = v));
    const zone = local ? new Intl.DateTimeFormat("en", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "Local" : "UTC";
    const at = (h: number) => new Date(Date.UTC(2000, 0, 1, h % 24)).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    return out.map((v, h) => ({ label: String(h), value: v, tip: `${at(h)} – ${at(h + 1)} ${zone}` }));
  }, [l.hours, local]);
  const pl = s.play;
  const shots: [string, string][] = [
    ["Hits", n0(pl.hits)],
    ["Returns", n0(pl.returns)],
    ["Chances", n0(pl.chances)],
    ["Winners", n0(pl.winners)],
    ["Aces", n0(pl.aces)],
    ["Smashes", n0(pl.smashes)],
    ["Points won", n0(pl.ptsWon)],
    ["Points lost", n0(pl.ptsLost)],
    ["Best rally", n0(pl.bestRally)],
    ["Best hit", n0(pl.bestHit)],
    ["Best speed", String(Math.round(pl.bestSpeed * 10) / 10)],
    ["Win streak", `${n0(pl.streak)} / ${n0(pl.bestStreak)}`],
    ["Tour titles", n0(pl.tourTitles)],
    ["Best rank", rankName(s.ladder.bestRank)],
  ];
  return (
    <>
      <Block title="Hour of day" right={<Seg value={local ? "Local" : "UTC"} options={["UTC", "Local"] as const} onChange={(v) => setLocal(v === "Local")} />}>
        <Hist items={hours} every={3} unit="Matches" />
      </Block>
      <div className="adm-sub">Against Matt</div>
      <div className="adm-matt">
        <div className="adm-matt-row head"><span>Level</span><span>Wins</span><span>Losses</span><span>Best streak</span></div>
        {s.matt.map((m) => (
          <div className="adm-matt-row" key={m.level}><span>{m.level}</span><span>{n0(m.wins)}</span><span>{n0(m.losses)}</span><span>{n0(m.bestStreak)}</span></div>
        ))}
      </div>
      <div className="adm-sub">Shots</div>
      <div className="ins-tiles adm-shots">
        {shots.map(([lab, v]) => (
          <div className="tile" key={lab}>
            <div className="total-label">{lab}</div>
            <div className="tile-value">{v}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Ghost button that asks for a second click before it fires. */
function Confirm({ id, st, label, onConfirm }: { id: string; st: Record<string, St>; label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  const s = st[id];
  return (
    <span className="adm-go">
      <button
        className={`btn ghost sm${armed ? " danger" : ""}`}
        disabled={s?.busy}
        onClick={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          onConfirm();
        }}
      >
        {s?.busy ? <i className="adm-spin" /> : null}
        {armed ? "Confirm" : label}
      </button>
      {s?.msg && !s.busy && s.err && (
        <span className="adm-res err" role="status">
          <X size={13} />
          {s.msg}
        </span>
      )}
    </span>
  );
}

const SUBS = ["Overview", "Play", "Inbox & gifts", "Items"] as const;
type Sub = (typeof SUBS)[number];

function Profile({ keyVal, name, items, onGone, onRenamed }: { keyVal: string; name: string; items: AdminItem[]; onGone: () => void; onRenamed: (n: string) => void }) {
  const [p, setP] = useState<AdminPlayer | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action>("Coins");
  const [sub, setSub] = useState<Sub>("Overview");
  const [actOpen, setActOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  // Reloads keep the old profile on screen (no unmount, no scroll jump) and show a thin bar.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setP((await adminGet(keyVal, `player?name=${encodeURIComponent(name)}`)) as AdminPlayer);
      setErr("");
    } catch (e) {
      setErr(String((e as Error)?.message ?? e) === "404" ? "No such player" : `Couldn’t load (${(e as Error)?.message})`);
    } finally {
      setLoading(false);
    }
  }, [keyVal, name]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const { st, run } = useRuns(reload);

  // action form state
  const [amount, setAmount] = useState("");
  const [coinNote, setCoinNote] = useState("");
  const [coinGift, setCoinGift] = useState(true);
  const [item, setItem] = useState("");
  const [itemNote, setItemNote] = useState("");
  const [itemGift, setItemGift] = useState(true);
  const [kind, setKind] = useState<"Warning" | "Message">("Warning");
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const [reserved, setReserved] = useState(false);
  const [confReset, setConfReset] = useState("");
  const [confDel, setConfDel] = useState("");

  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const ownedSorted = useMemo(
    () => [...(p?.owned ?? [])].sort((a, b) => rarityRank(itemName.get(b)?.rarity ?? "") - rarityRank(itemName.get(a)?.rarity ?? "") || (itemName.get(a)?.name ?? a).localeCompare(itemName.get(b)?.name ?? b)),
    [p?.owned, itemName],
  );
  const amt = Number(amount);
  const amtOk = amount.trim() !== "" && Number.isInteger(amt) && amt !== 0 && Math.abs(amt) <= 100000;
  const taking = amtOk && amt < 0;

  if (err) return <div className="adm-body"><div className="list-empty">{err}</div></div>;
  if (!p) return <div className="adm-body"><div className="spinner" /></div>;

  const nm = p.name;
  const post = (path: string, body: Record<string, unknown>) => adminPost(keyVal, path, { name: nm, ...body });
  const rank = p.rank ? rankName(p.rank) : "Unranked";
  const withdraw = (id: number | string) => run(`w${id}`, () => adminPost(keyVal, "notice/withdraw", { id }), "Withdrawn");
  const withdrawGift = (id: number | string) => run(`g${id}`, () => adminPost(keyVal, "gift/withdraw", { id }), "Withdrawn");
  const s = p.stats;
  const people = s ? s.play.hWins + s.play.hLosses : p.wins + p.losses;
  const wins = s ? s.play.hWins : p.wins;
  const m30 = s ? s.last30.days.reduce((a, d) => a + d.matches, 0) : p.matches30d;
  const unread = p.notices.filter((n) => !n.seenAt).length;

  return (
    <div className={`adm-body adm-prof${loading ? " loading" : ""}`}>
      <i className="adm-load" aria-hidden="true" />
      <div className="adm-who">
        <h3>{nm}</h3>
        {p.live && <span className="chip static st-live">{LIVE_LABEL[p.live.state]}</span>}
        <span className="dim">Created {whenDay(p.createdAt)}</span>
        <span className="chip static">{rank}</span>
        <span className="adm-spacer" />
        <span className={`chip static${p.lbHidden ? " bot" : ""}`}>{p.lbHidden ? "Hidden on boards" : "On boards"}</span>
        <span className="chip static">{p.sharing ? "Sharing on" : "Sharing off"}</span>
      </div>

      <aside className={`adm-side${actOpen ? " open" : ""}`}>
        <button className="adm-side-toggle" aria-expanded={actOpen} onClick={() => setActOpen((o) => !o)}>
          <span>Actions</span>
          <ChevronDown size={16} />
        </button>
        <div className="adm-sub adm-side-title">Actions</div>
        <div className="adm-side-body">
          <div className="adm-actions">
            <Seg value={action} options={ACTIONS} onChange={setAction} />
            {action === "Coins" && (
              <div className="adm-form">
                <div className="adm-grid">
                  <label className="adm-f">
                    <span>Amount</span>
                    <input className="adm-in mono" inputMode="numeric" placeholder="500 or -500" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <label className="adm-f grow">
                    <span>Note</span>
                    <input className="adm-in" maxLength={NOTE_MAX} value={coinNote} onChange={(e) => setCoinNote(e.target.value)} />
                  </label>
                </div>
                <div className="adm-foot">
                  <Toggle on={coinGift && !taking} disabled={taking} onChange={setCoinGift} label="As a gift" />
                  <Go
                    id="coins"
                    st={st}
                    label={taking ? "Take coins" : "Give coins"}
                    disabled={!amtOk}
                    onClick={() => run("coins", () => post("coins", { amount: amt, ...(coinNote.trim() ? { note: coinNote.trim() } : {}), gift: coinGift && !taking }), "Done").then((ok) => ok && (setAmount(""), setCoinNote("")))}
                  />
                </div>
              </div>
            )}
            {action === "Item" && (
              <div className="adm-form">
                <ItemPicker items={items} value={item} onChange={setItem} />
                <label className="adm-f">
                  <span>Note</span>
                  <input className="adm-in" maxLength={NOTE_MAX} value={itemNote} onChange={(e) => setItemNote(e.target.value)} />
                </label>
                <div className="adm-foot">
                  <Toggle on={itemGift} onChange={setItemGift} label="As a gift" />
                  <Go
                    id="item"
                    st={st}
                    label="Give item"
                    disabled={!item}
                    onClick={() => run("item", () => post("item", { item, ...(itemNote.trim() ? { note: itemNote.trim() } : {}), gift: itemGift }), "Given").then((ok) => ok && (setItem(""), setItemNote("")))}
                  />
                </div>
              </div>
            )}
            {action === "Inbox" && (
              <div className="adm-form">
                <Seg value={kind} options={["Warning", "Message"] as const} onChange={setKind} />
                <label className="adm-f">
                  <span>Text</span>
                  <textarea className="adm-in" rows={3} maxLength={MSG_MAX} value={text} onChange={(e) => setText(e.target.value)} />
                  <em className={text.length > MSG_MAX - 40 ? "warn" : ""}>{text.length}/{MSG_MAX}</em>
                </label>
                <div className="adm-prev" aria-label="Preview">
                  <div className={`adm-nt ${kind.toLowerCase()}`}>
                    <div className="adm-nt-head">
                      <span className="adm-nt-tile" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="#fff" stroke="#fff">
                          {kind === "Warning" ? (
                            <>
                              <path d="M12 5.2v8.6" strokeWidth="3.6" strokeLinecap="round" />
                              <circle cx="12" cy="19" r="2.2" stroke="none" />
                            </>
                          ) : (
                            <>
                              <path d="M4.6 6.6a2.6 2.6 0 0 1 2.6-2.6h9.6a2.6 2.6 0 0 1 2.6 2.6v6.6a2.6 2.6 0 0 1-2.6 2.6h-4.6l-4.4 3.8v-3.8h-.6a2.6 2.6 0 0 1-2.6-2.6Z" stroke="none" />
                              <circle cx="8.6" cy="9.9" r="1.25" fill="#00c2ff" stroke="none" />
                              <circle cx="12" cy="9.9" r="1.25" fill="#00c2ff" stroke="none" />
                              <circle cx="15.4" cy="9.9" r="1.25" fill="#00c2ff" stroke="none" />
                            </>
                          )}
                        </svg>
                      </span>
                      <div className="adm-nt-hw">
                        <h2 className="adm-nt-h">{kind}</h2>
                        <span className="adm-nt-when">Today</span>
                      </div>
                    </div>
                    <div className="adm-nt-plate">
                      <p className={`adm-nt-text${text.trim() ? "" : " dim"}`}>{text.trim() || "Your text"}</p>
                    </div>
                    <div className="adm-nt-acts">
                      <span className="adm-nt-ok">OK</span>
                    </div>
                  </div>
                </div>
                <div className="adm-foot">
                  <span />
                  <Go
                    id="notice"
                    st={st}
                    label="Send"
                    disabled={!text.trim()}
                    onClick={() => run("notice", () => post("notice", { kind: kind.toLowerCase(), text: text.trim() }), "Sent").then((ok) => ok && setText(""))}
                  />
                </div>
              </div>
            )}
            {action === "Rename" && (
              <div className="adm-form">
                <label className="adm-f">
                  <span>New name</span>
                  <input className="adm-in" maxLength={24} value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                <div className="adm-foot">
                  <Toggle on={reserved} onChange={setReserved} label="Reserved" />
                  <Go
                    id="rename"
                    st={st}
                    label="Rename"
                    disabled={!to.trim()}
                    onClick={async () => {
                      const target = to.trim();
                      const ok = await run("rename", () => post("rename", { to: target, reserved }), "Renamed", false);
                      if (ok) {
                        setTo("");
                        onRenamed(target);
                      }
                    }}
                  />
                </div>
              </div>
            )}
            {action === "Access" && (
              <div className="adm-form">
                <div className="adm-row">
                  <span>{p.lbHidden ? "Hidden on leaderboards" : "Visible on leaderboards"}</span>
                  <Go id="lb" st={st} label={p.lbHidden ? "Show" : "Hide"} onClick={() => run("lb", () => post("lb-hide", { hidden: !p.lbHidden }), "Updated")} />
                </div>
                <div className="adm-row">
                  <span>Share link</span>
                  <Go id="unshare" st={st} label="Stop sharing" disabled={!p.sharing} onClick={() => run("unshare", () => post("unshare", {}), "Stopped")} />
                </div>
                <div className="adm-row">
                  <span>Name hold</span>
                  <Go id="release" st={st} label="Release" onClick={() => run("release", () => post("release", {}), "Released")} />
                </div>
              </div>
            )}
          </div>

          <button className={`adm-danger-toggle${dangerOpen ? " open" : ""}`} aria-expanded={dangerOpen} onClick={() => setDangerOpen((o) => !o)}>
            <span>Danger</span>
            <ChevronDown size={16} />
          </button>
          {dangerOpen && (
            <div className="adm-danger">
              <label className="adm-f">
                <span>Reset stats: type <code>{nm}</code></span>
                <input className="adm-in mono" value={confReset} onChange={(e) => setConfReset(e.target.value)} />
              </label>
              <Go id="reset" st={st} label="Reset stats" danger disabled={confReset !== nm} onClick={() => run("reset", () => post("reset-stats", { confirm: confReset }), "Reset").then((ok) => ok && setConfReset(""))} />
              <label className="adm-f">
                <span>Delete account: type <code>delete {nm}</code></span>
                <input className="adm-in mono" value={confDel} onChange={(e) => setConfDel(e.target.value)} />
              </label>
              <Go
                id="delete"
                st={st}
                label="Delete account"
                danger
                disabled={confDel !== `delete ${nm}`}
                onClick={async () => {
                  const ok = await run("delete", () => post("delete", { confirm: confDel }), "Deleted", false);
                  if (ok) onGone();
                }}
              />
            </div>
          )}
        </div>
      </aside>

      <div className="adm-main">
        <div className="adm-subtabs">
          <Seg value={sub} options={SUBS} onChange={setSub} />
        </div>

        {sub === "Overview" && (
          <>
            <div className="adm-t6"><Tiles
              items={[
                { label: "Rank", value: rank, sub: `${n0(p.trophies)} trophies` },
                { label: "Coins", value: n0(p.coins.coins), hint: `Earned ${n0(p.coins.earned)}, spent ${n0(p.coins.spent)}` },
                { label: "Game hours", value: s ? `${s.gameHours}h` : "None" },
                { label: "Matches 30d", value: n0(m30) },
                { label: "Win rate vs people", value: people ? `${Math.round((wins / people) * 100)}%` : "None" },
                { label: "Last online", value: ago(p.lastOn), hint: when(p.lastOn) },
              ]}
            /></div>
            {s && (
              <>
                <Block title="Matches, last 30 days">
                  <DayChart days={s.last30.days.map((d) => d.day)} series={[{ name: "Matches", color: "var(--blue)" }]} values={[s.last30.days.map((d) => d.matches)]} />
                </Block>
                <div className="adm-t4"><Tiles
                  items={[
                    { label: "Friends", value: n0(s.friends) },
                    { label: "Items", value: n0(s.itemsOwned) },
                    { label: "Quits 30d", value: n0(s.last30.quits) },
                    { label: "Average match", value: s.last30.avgMatchS ? dur(s.last30.avgMatchS) : "None" },
                  ]}
                /></div>
              </>
            )}
          </>
        )}

        {sub === "Play" && (s ? <PlayPanel s={s} /> : <div className="list-empty adm-pad">None</div>)}

        {sub === "Inbox & gifts" && (
          <>
            <div className="adm-sub first">Notices <b>{p.notices.length}</b>{unread > 0 && <span className="chip static st-unread">{unread} unread</span>}</div>
            {p.notices.length === 0 ? (
              <div className="list-empty adm-pad">None</div>
            ) : (
              <div className="adm-list">
                {p.notices.map((n) => (
                  <div className="adm-line" key={n.id}>
                    <div className="adm-line-top">
                      <span className={`chip static ${n.kind === "warning" ? "st-away" : ""}`}>{n.kind === "warning" ? "Warning" : "Message"}</span>
                      <span className="dim">{ago(n.at)}</span>
                      <span className={`chip static ${n.seenAt ? "" : "st-unread"}`}>{n.seenAt ? "Read" : "Unread"}</span>
                      <span className="adm-spacer" />
                      <Confirm id={`w${n.id}`} st={st} label="Withdraw" onConfirm={() => withdraw(n.id)} />
                    </div>
                    <div className="adm-text">{n.text}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="adm-sub">Gifts <b>{p.gifts.length}</b></div>
            {p.gifts.length === 0 ? (
              <div className="list-empty adm-pad">None</div>
            ) : (
              <div className="adm-list">
                {p.gifts.map((g) => (
                  <div className="adm-line" key={g.id}>
                    <div className="adm-line-top">
                      {g.coins ? <span className="chip static">{n0(g.coins)} coins</span> : null}
                      {g.item ? <span className="chip static">{itemName.get(g.item)?.name ?? g.item}</span> : null}
                      <span className="dim">{ago(g.at)}</span>
                      <span className="adm-spacer" />
                      <span className={`chip static ${g.shownAt ? "" : "st-unread"}`}>{g.shownAt ? "Claimed" : "Not claimed"}</span>
                      {g.withdrawable && <Confirm id={`g${g.id}`} st={st} label="Withdraw" onConfirm={() => withdrawGift(g.id)} />}
                    </div>
                    {g.note && <div className="adm-text">{g.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {sub === "Items" && (
          <>
            <div className="adm-sub first">Items <b>{p.owned.length}</b></div>
            {p.owned.length === 0 ? (
              <div className="list-empty adm-pad">None</div>
            ) : (
              <div className="adm-chips">
                {ownedSorted.map((id) => {
                  const it = itemName.get(id);
                  return (
                    <span className="chip static" key={id}>
                      {it && <span className={`adm-rar r-${it.rarity.toLowerCase()}`} />}
                      {it?.name ?? id}
                    </span>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PlayersTab({ keyVal, items }: { keyVal: string; items: AdminItem[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AdminHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState("");
  const [err, setErr] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (!open) return;
    if (term.length < 2) {
      setHits(null);
      setErr("");
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = (await adminGet(keyVal, `search?q=${encodeURIComponent(term.slice(0, 12))}`)) as { players: AdminHit[] };
        if (mine === seq.current) {
          setHits(r.players ?? []);
          setErr("");
        }
      } catch (e) {
        if (mine === seq.current) setErr(e instanceof KeyError ? "Key rejected" : `Couldn’t search (${(e as Error).message})`);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q, keyVal, open]);

  const pick = (n: string) => {
    seq.current++;
    setSel(n);
    setQ(n);
    setOpen(false);
    setSearching(false);
  };
  const clear = () => {
    seq.current++;
    setQ("");
    setHits(null);
    setOpen(false);
    setSearching(false);
    setErr("");
  };

  return (
    <>
      <div className="adm-search">
        <input
          className="adm-in"
          placeholder="Search players"
          value={q}
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && open && hits && hits[0]) pick(hits[0].name);
            else if (e.key === "Escape") clear();
          }}
        />
        {searching && <i className="adm-spin big" />}
      </div>
      {err && open && <div className="adm-pad adm-res err"><X size={13} />{err}</div>}
      {open && hits && (
        <div className="adm-hits">
          {hits.length === 0 && <div className="list-empty">No players</div>}
          {hits.map((h) => (
            <button key={h.name} className={`adm-hit${sel === h.name ? " on" : ""}`} onClick={() => pick(h.name)}>
              <b>{h.name}</b>
              <span className="dim">{ago(h.lastOn)}</span>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <Profile
          key={sel}
          keyVal={keyVal}
          name={sel}
          items={items}
          onGone={() => {
            setSel("");
            clear();
          }}
          onRenamed={(n) => {
            setSel(n);
            setQ(n);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// ---- Codes --------------------------------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I L O 0 1
const randomCode = () => {
  const b = new Uint32Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
};

function codeState(c: AdminCode): "live" | "ended" | "off" {
  if (c.off) return "off";
  if ((c.endsAt && msOf(c.endsAt) < Date.now()) || (c.maxUses > 0 && c.uses >= c.maxUses)) return "ended";
  return "live";
}

function CodesTab({ keyVal, items }: { keyVal: string; items: AdminItem[] }) {
  const [codes, setCodes] = useState<AdminCode[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      setCodes(((await adminGet(keyVal, "codes")) as { codes: AdminCode[] }).codes ?? []);
      setErr("");
    } catch (e) {
      setErr(e instanceof KeyError ? "Key rejected" : `Couldn’t load (${(e as Error).message})`);
    }
  }, [keyVal]);
  useEffect(() => {
    void load();
  }, [load]);
  const { st, run } = useRuns(load);
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);

  const [code, setCode] = useState("");
  const [coins, setCoins] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  const [uses, setUses] = useState("");
  const [days, setDays] = useState("");
  const [made, setMade] = useState("");
  const [copied, setCopied] = useState(false);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const bad = [coins, uses, days].some((s) => s.trim() !== "" && !(Number(s) >= 0 && Number.isFinite(Number(s)))) || (!picks.length && !(Number(coins) > 0));

  const create = () =>
    run(
      "create",
      async () => {
        const r = await adminPost(keyVal, "codes", {
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
          ...(num(coins) ? { coins: num(coins) } : {}),
          ...(picks.length ? { items: picks } : {}),
          ...(num(uses) ? { uses: num(uses) } : {}),
          ...(num(days) ? { days: num(days) } : {}),
        });
        setMade(String(r.code ?? code));
        setCopied(false);
      },
      "Created",
    ).then((ok) => ok && (setCode(""), setCoins(""), setPicks([]), setUses(""), setDays("")));

  return (
    <>
      <div className="adm-body">
        <div className="adm-sub first">New code</div>
        <div className="adm-form flat">
          <div className="adm-grid">
            <label className="adm-f grow">
              <span>Code</span>
              <div className="adm-with">
                <input className="adm-in mono" placeholder="Blank = server picks" maxLength={24} value={code} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase())} />
                <button className="btn" onClick={() => setCode(randomCode())}>
                  <Dices size={14} /> Random
                </button>
              </div>
            </label>
          </div>
          <div className="adm-grid four">
            <label className="adm-f">
              <span>Coins</span>
              <input className="adm-in mono" inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value)} />
            </label>
            <label className="adm-f">
              <span>Max uses</span>
              <input className="adm-in mono" inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value)} />
            </label>
            <label className="adm-f">
              <span>Days</span>
              <input className="adm-in mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </label>
          </div>
          <div className="adm-f">
            <span>Items</span>
            <MultiItemPicker items={items} value={picks} onChange={setPicks} />
          </div>
          <div className="adm-foot">
            <span />
            <Go id="create" st={st} label="Create" disabled={bad} onClick={create} />
          </div>
        </div>
        {made && (
          <div className="adm-made">
            <code>{made}</code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(made).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
      <div className="scroll adm-tablewrap">
        {err ? (
          <div className="list-empty adm-pad">{err}</div>
        ) : !codes ? (
          <div className="adm-pad"><div className="spinner" /></div>
        ) : codes.length === 0 ? (
          <div className="list-empty adm-pad">No codes</div>
        ) : (
          <table className="ins-table adm-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Gives</th>
                <th>Uses</th>
                <th>Ends</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const s = codeState(c);
                return (
                  <tr key={c.code}>
                    <td className="mono c-code">{c.code}</td>
                    <td className="l c-gives">
                      {c.coins ? <span className="chip static">{n0(c.coins)} coins</span> : null}
                      {(c.items?.length ? c.items : c.item ? [c.item] : []).map((id) => <span key={id} className="chip static">{names.get(id) ?? id}</span>)}
                    </td>
                    <td className="c-uses">
                      {n0(c.uses)}/{c.maxUses ? n0(c.maxUses) : "∞"}
                    </td>
                    <td className="c-ends">{c.endsAt ? whenDay(c.endsAt) : "None"}</td>
                    <td className="c-state">
                      <span className={`chip static adm-state ${s}`}>{s}</span>
                    </td>
                    <td className="r c-act">
                      {s === "live" && <Go id={`off${c.code}`} st={st} label="Turn off" danger onClick={() => run(`off${c.code}`, () => adminPost(keyVal, "codes/off", { code: c.code }), "Off")} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---- Log ----------------------------------------------------------------------------

function detailText(d: unknown): string {
  if (d == null || d === "") return "";
  if (typeof d !== "object") return String(d);
  return Object.entries(d as Record<string, unknown>)
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function LogTab({ keyVal }: { keyVal: string }) {
  const [log, setLog] = useState<AdminLog[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    adminGet(keyVal, "log?limit=100")
      .then((r: { log: AdminLog[] }) => live && setLog(r.log ?? []))
      .catch((e) => live && setErr(e instanceof KeyError ? "Key rejected" : `Couldn’t load (${e.message})`));
    return () => {
      live = false;
    };
  }, [keyVal]);
  if (err) return <div className="list-empty adm-pad">{err}</div>;
  if (!log) return <div className="adm-pad"><div className="spinner" /></div>;
  if (!log.length) return <div className="list-empty adm-pad">No actions yet</div>;
  return (
    <div className="adm-log">
      {log.map((l, i) => (
        <div className="adm-log-row" key={i}>
          <span className="dim adm-log-t">{when(l.at)}</span>
          <span className="chip static adm-log-a">{l.action}</span>
          <b className="adm-log-g">{l.target ?? ""}</b>
          <span className="dim adm-log-d">{detailText(l.detail)}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Card ---------------------------------------------------------------------------

export function Admin({ keyName, onKeys }: { keyName: string; onKeys: () => void; tick?: number }) {
  const keyVal = lsGet(keyName);
  const [tab, setTab] = useState<Tab>(() => (TABS as readonly string[]).includes(lsGet("stats.adminTab")) ? (lsGet("stats.adminTab") as Tab) : "Players");
  const [items, setItems] = useState<AdminItem[]>([]);
  const [bad, setBad] = useState("");
  useEffect(() => {
    if (!keyVal) return;
    let live = true;
    adminGet(keyVal, "items")
      .then((r: { items: AdminItem[] }) => live && setItems(r.items ?? []))
      .catch((e) => live && setBad(e instanceof KeyError ? "Key rejected" : `Couldn’t load (${e.message})`));
    return () => {
      live = false;
    };
  }, [keyVal]);

  let body: ReactNode;
  if (!keyVal || bad) {
    body = (
      <div className="empty">
        <p>{!keyVal ? "Add your Poddle key" : bad}</p>
        <button className="btn" onClick={onKeys}>
          <KeyRound size={14} /> Keys
        </button>
      </div>
    );
  } else if (tab === "Players") body = <PlayersTab keyVal={keyVal} items={items} />;
  else if (tab === "Codes") body = <CodesTab keyVal={keyVal} items={items} />;
  else body = <LogTab keyVal={keyVal} />;

  return (
    <section className="card ins-card adm-card">
      <header className="card-head ins-head">
        <h2>Admin</h2>
        <div className="ins-tabs">
          <Seg
            value={tab}
            options={TABS}
            onChange={(t) => {
              setTab(t);
              lsSet("stats.adminTab", t);
            }}
          />
        </div>
      </header>
      {body}
    </section>
  );
}
