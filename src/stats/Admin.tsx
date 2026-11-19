import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Dices, KeyRound, MessageSquare, TriangleAlert, X } from "lucide-react";
import {
  adminGet,
  adminPost,
  KeyError,
  type AdminCode,
  type AdminHit,
  type AdminItem,
  type AdminLog,
  type AdminPlayer,
} from "./data";

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

// ---- Players ------------------------------------------------------------------------

const ACTIONS = ["Coins", "Item", "Inbox", "Rename", "Access"] as const;
type Action = (typeof ACTIONS)[number];
const NOTE_MAX = 140;
const MSG_MAX = 500;

function Profile({ keyVal, name, items, onGone, onRenamed }: { keyVal: string; name: string; items: AdminItem[]; onGone: () => void; onRenamed: (n: string) => void }) {
  const [p, setP] = useState<AdminPlayer | null>(null);
  const [err, setErr] = useState("");
  const [action, setAction] = useState<Action>("Coins");
  const reload = useCallback(async () => {
    try {
      setP((await adminGet(keyVal, `player?name=${encodeURIComponent(name)}`)) as AdminPlayer);
      setErr("");
    } catch (e) {
      setErr(String((e as Error)?.message ?? e) === "404" ? "No such player" : `Couldn’t load (${(e as Error)?.message})`);
    }
  }, [keyVal, name]);
  useEffect(() => {
    setP(null);
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
  const amt = Number(amount);
  const amtOk = amount.trim() !== "" && Number.isInteger(amt) && amt !== 0 && Math.abs(amt) <= 100000;
  const taking = amtOk && amt < 0;

  if (err) return <div className="adm-body"><div className="list-empty">{err}</div></div>;
  if (!p) return <div className="adm-body"><div className="spinner" /></div>;

  const nm = p.name;
  const post = (path: string, body: Record<string, unknown>) => adminPost(keyVal, path, { name: nm, ...body });
  const rank = p.rank ? `${p.rank.tier} ${p.rank.div}` : "Unranked";
  const withdraw = (id: number | string) => run(`w${id}`, () => adminPost(keyVal, "notice/withdraw", { id }), "Withdrawn");

  return (
    <div className="adm-body">
      <div className="adm-who">
        <h3>{nm}</h3>
        <span className="dim">Created {whenDay(p.createdAt)}</span>
        <span className="adm-spacer" />
        <span className={`chip static${p.lbHidden ? " bot" : ""}`}>{p.lbHidden ? "Hidden on boards" : "On boards"}</span>
        <span className="chip static">{p.sharing ? "Sharing on" : "Sharing off"}</span>
      </div>

      <div className="ins-tiles adm-tiles">
        {[
          ["Rank", rank],
          ["Trophies", n0(p.trophies)],
          ["Coins", n0(p.coins.coins)],
          ["Earned", n0(p.coins.earned)],
          ["Spent", n0(p.coins.spent)],
          ["Played", n0(p.played)],
          ["Wins", n0(p.wins)],
          ["Losses", n0(p.losses)],
          ["Matches 30d", n0(p.matches30d)],
          ["Last online", when(p.lastOn)],
        ].map(([l, v]) => (
          <div className="tile" key={l}>
            <div className="total-label">{l}</div>
            <div className="tile-value">{v}</div>
          </div>
        ))}
      </div>

      <div className="adm-sub">Items <b>{p.owned.length}</b></div>
      {p.owned.length === 0 ? (
        <div className="list-empty adm-pad">None</div>
      ) : (
        <div className="adm-chips">
          {p.owned.map((id) => {
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

      <div className="adm-two">
        <div>
          <div className="adm-sub">Notices <b>{p.notices.length}</b></div>
          {p.notices.length === 0 && <div className="list-empty adm-pad">None</div>}
          {p.notices.map((n) => (
            <div className="adm-line" key={n.id}>
              <div className="adm-line-top">
                <span className={`chip static ${n.kind === "warning" ? "st-away" : ""}`}>{n.kind === "warning" ? "Warning" : "Message"}</span>
                <span className="dim">Sent {when(n.at)}</span>
                <span className={n.seenAt ? "dim" : "adm-unread"}>{n.seenAt ? `Read ${when(n.seenAt)}` : "Unread"}</span>
                <span className="adm-spacer" />
                <Go id={`w${n.id}`} st={st} label="Withdraw" danger onClick={() => withdraw(n.id)} />
              </div>
              <div className="adm-text">{n.text}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="adm-sub">Gifts <b>{p.gifts.length}</b></div>
          {p.gifts.length === 0 && <div className="list-empty adm-pad">None</div>}
          {p.gifts.map((g) => (
            <div className="adm-line" key={g.id}>
              <div className="adm-line-top">
                {g.coins ? <span className="chip static">{n0(g.coins)} coins</span> : null}
                {g.item ? <span className="chip static">{itemName.get(g.item)?.name ?? g.item}</span> : null}
                <span className="dim">{when(g.at)}</span>
                <span className="adm-spacer" />
                <span className={g.shownAt ? "dim" : "adm-unread"}>{g.shownAt ? "Shown" : "Not shown"}</span>
              </div>
              {g.note && <div className="adm-text">{g.note}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="adm-sub">Actions</div>
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
            <div className={`adm-prev ${kind.toLowerCase()}`} aria-label="Preview">
              <div className="adm-prev-icon">{kind === "Warning" ? <TriangleAlert size={20} /> : <MessageSquare size={20} />}</div>
              <div className="adm-prev-text">{text.trim() || <span className="dim">Your text</span>}</div>
              <div className="adm-prev-ok">OK</div>
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

      <div className="adm-danger">
        <div className="adm-sub red">Danger</div>
        <div className="adm-grid">
          <label className="adm-f grow">
            <span>Reset stats: type <code>{nm}</code></span>
            <input className="adm-in mono" value={confReset} onChange={(e) => setConfReset(e.target.value)} />
          </label>
          <Go id="reset" st={st} label="Reset stats" danger disabled={confReset !== nm} onClick={() => run("reset", () => post("reset-stats", { confirm: confReset }), "Reset").then((ok) => ok && setConfReset(""))} />
        </div>
        <div className="adm-grid">
          <label className="adm-f grow">
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
      </div>
    </div>
  );
}

function PlayersTab({ keyVal, items }: { keyVal: string; items: AdminItem[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AdminHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState("");
  const [err, setErr] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setErr("");
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
  }, [q, keyVal]);

  return (
    <>
      <div className="adm-search">
        <input className="adm-in" placeholder="Search players" value={q} autoCapitalize="off" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        {searching && <i className="adm-spin big" />}
      </div>
      {err && <div className="adm-pad adm-res err"><X size={13} />{err}</div>}
      {hits && (
        <div className="adm-hits">
          {hits.length === 0 && <div className="list-empty">No players</div>}
          {hits.map((h) => (
            <button key={h.name} className={`adm-hit${sel === h.name ? " on" : ""}`} onClick={() => setSel(h.name)}>
              <b>{h.name}</b>
              <span className="dim">{when(h.lastOn)}</span>
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
            setHits(null);
            setQ("");
          }}
          onRenamed={(n) => {
            setSel(n);
            setQ(n);
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
  const [item, setItem] = useState("");
  const [uses, setUses] = useState("");
  const [days, setDays] = useState("");
  const [made, setMade] = useState("");
  const [copied, setCopied] = useState(false);
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const bad = [coins, uses, days].some((s) => s.trim() !== "" && !(Number(s) >= 0 && Number.isFinite(Number(s)))) || (!item && !(Number(coins) > 0));

  const create = () =>
    run(
      "create",
      async () => {
        const r = await adminPost(keyVal, "codes", {
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
          ...(num(coins) ? { coins: num(coins) } : {}),
          ...(item ? { item } : {}),
          ...(num(uses) ? { uses: num(uses) } : {}),
          ...(num(days) ? { days: num(days) } : {}),
        });
        setMade(String(r.code ?? code));
        setCopied(false);
      },
      "Created",
    ).then((ok) => ok && (setCode(""), setCoins(""), setItem(""), setUses(""), setDays("")));

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
            <span>Item</span>
            <ItemPicker items={items} value={item} onChange={setItem} />
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
                      {c.item ? <span className="chip static">{names.get(c.item) ?? c.item}</span> : null}
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
