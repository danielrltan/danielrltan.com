import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Download, KeyRound, X } from "lucide-react";
import { KeyError } from "./data";
import { Tiles } from "./Insights";
import { panelName } from "./sponsor/boards";
import { aspectOf, drawFace } from "./sponsor/face";
import { drawMat } from "./sponsor/mat";
import {
  OffError,
  day,
  left,
  logoOf,
  spGet,
  spPost,
  usd,
  whenUtc,
  type AuData,
  type BbData,
  type BbRow,
  type Kind,
  type SpAsk,
  type SpData,
  type SpRow,
} from "./sponsor/api";

// Poddle's sponsor admin, moved here from playpoddle.com/sponsor-admin.html (poddle NOTES 1056; what each control means: NOTES 351,
// 358, 388, 507, 509-513, 528). The same key as the rest of the panel. Everything a buyer typed is shown as text (never a link but
// a mailto:), logos are fetched with the key and drawn on their own board's shape. It refreshes every 30 s while the tab is in view,
// and the count waiting shows in the tab's title.

const TABS = ["Bookings", "Auctions", "Requests", "Panels", "Sales"] as const;
type Tab = (typeof TABS)[number];
const FILTERS = [
  ["wait", "Waiting"],
  ["live", "Live"],
  ["soon", "Upcoming"],
  ["ended", "Ended"],
  ["all", "All"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const STATUS: Record<string, string> = {
  checkout: "At Stripe checkout",
  pending: "Card authorised, waiting for you",
  live: "Paid, booked",
  rejected: "Rejected, released",
  expired: "Ended, nothing charged",
  lost: "Another booking approved first, released",
  pulled: "Pulled",
};
const COURT: Record<string, string> = {
  checkout: "At Stripe checkout",
  review: "Paid, waiting for you",
  live: "On the court",
  outbid: "Taken over",
  released: "Rejected, released",
  expired: "Ended, nothing charged",
  lost: "Lost the race, released",
  pulled: "Pulled",
};
const ERR: Record<string, string> = {
  clash: "Those months on that panel are already paid for by someone else: reject this one.",
  state: "Not from this status.",
  past: "Those months are over: reject it.",
  corner: "A corner panel shows logos in one tone only.",
  capture: "Stripe refused the charge: it is released.",
  stripe: "Stripe did not answer. Nothing changed: try again.",
  refund: "Stripe refused the refund. Check the payment in Stripe.",
  charge: "The winner's card was declined: the next highest bid is now the winner.",
  empty: "Every bid is gone: the auction ended empty.",
  bad_request: "Not accepted (check the text: up to 1000 characters).",
  rate: "Too many requests: wait a minute.",
};
const errText = (e: unknown) => (e instanceof KeyError ? "Key rejected" : ERR[String((e as Error)?.message)] ?? `Failed: ${String((e as Error)?.message ?? e)}`);

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

const panelIn = (r: SpRow, k: Filter, now: number) =>
  k === "all" ||
  (k === "wait"
    ? ["checkout", "pending"].includes(r.status)
    : k === "live"
      ? r.status === "live" && r.showing
      : k === "soon"
        ? r.status === "live" && !r.showing && (r.start ?? 0) > now
        : !["checkout", "pending"].includes(r.status) && !(r.status === "live" && (r.showing || (r.start ?? 0) > now)));
const courtIn = (r: BbRow, k: Filter) =>
  k === "all" || (k === "wait" ? ["checkout", "review"].includes(r.status) : k === "live" ? r.status === "live" : k === "soon" ? false : !["checkout", "review", "live"].includes(r.status));

// ---- small parts --------------------------------------------------------------------

function Seg<T extends string>({ value, options, onChange, count }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; count?: (v: T) => number }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([k, label]) => {
        const n = count?.(k) ?? 0;
        return (
          <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
            {label}
            {n > 0 && <b className="spn-n">{n}</b>}
          </button>
        );
      })}
    </div>
  );
}

type Run = (id: string, fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
type St = Record<string, { busy?: boolean; msg?: string; err?: boolean }>;

/** A button that asks first (inline: the question, Yes, Cancel) when `ask` is given; its result beside it. */
function Act({ id, st, run, label, ask, go, danger, fn, ok }: { id: string; st: St; run: Run; label: string; ask?: string; go?: boolean; danger?: boolean; fn: () => Promise<unknown>; ok?: string }) {
  const [asking, setAsking] = useState(false);
  const s = st[id];
  const cls = `btn${go ? " primary" : danger ? " danger" : ""}`;
  return (
    <span className="adm-go">
      {asking ? (
        <span className="spn-ask">
          <span>{ask}</span>
          <button className={cls} onClick={() => (setAsking(false), run(id, fn, ok))}>
            Yes
          </button>
          <button className="btn ghost" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button className={cls} disabled={s?.busy} onClick={() => (ask ? setAsking(true) : run(id, fn, ok))}>
          {s?.busy ? <i className="adm-spin" /> : null}
          {label}
        </button>
      )}
      {s?.msg && !s.busy && !asking && (
        <span className={`adm-res${s.err ? " err" : ""}`} role="status">
          {s.err ? <X size={13} /> : <Check size={13} />}
          {s.msg}
        </span>
      )}
    </span>
  );
}

function Chips({ list }: { list: ({ t: string; tone?: string } | null | false)[] }) {
  const xs = list.filter(Boolean) as { t: string; tone?: string }[];
  if (!xs.length) return null;
  return (
    <div className="spn-chips">
      {xs.map((c) => (
        <span key={c.t} className={`chip static spn-chip${c.tone ? " " + c.tone : ""}`}>
          {c.t}
        </span>
      ))}
    </div>
  );
}

function Meta({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="spn-meta">
      {rows
        .filter(([, v]) => v != null && v !== "" && v !== false)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
const mail = (e: string | null | undefined, subject?: string) =>
  e ? <a href={`mailto:${encodeURIComponent(e).replace(/%40/g, "@")}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`}>{e}</a> : null;

/** A logo from a keyed route, drawn on its board (a panel's face, or King of the Court's mat seen from above). */
function Logo({ keyVal, kind, id, v, panel, mode, fit, court }: { keyVal: string; kind: Kind; id: number; v?: number; panel?: number; mode: string; fit: SpRow["fit"]; court?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [none, setNone] = useState(false);
  useEffect(() => {
    let live = true;
    logoOf(keyVal, kind, id, v).then((img) => {
      const c = ref.current;
      if (!live || !c) return;
      if (!img) return setNone(true);
      if (court) {
        const m = drawMat(document.createElement("canvas"), img, mode, fit);
        c.width = 512;
        c.height = 144;
        const g = c.getContext("2d")!;
        g.fillStyle = "#ff7a4d";
        g.fillRect(0, 0, c.width, c.height);
        const h = (m.height * c.width) / m.width;
        g.drawImage(m, 0, (c.height - h) / 2, c.width, h);
      } else drawFace(c, img, mode, panel ?? 3, aspectOf(panel ?? 3), fit);
    });
    return () => {
      live = false;
    };
  }, [keyVal, kind, id, v, panel, mode, fit, court]);
  return (
    <div className={`spn-logo${court ? " court" : ""}`}>
      <canvas ref={ref} width={512} height={court ? 144 : 309} aria-label="Logo on its board" data-logo={`${kind}:${id}`} />
      {none && <span className="dim">No logo</span>}
    </div>
  );
}

function Note({ value, onSave }: { value: string; onSave: (t: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(!!value);
  const [t, setT] = useState(value);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setT(value), [value]);
  if (!open)
    return (
      <button className="spn-link" onClick={() => setOpen(true)}>
        Add a note
      </button>
    );
  return (
    <div className="spn-note">
      <textarea className="adm-in" rows={2} maxLength={1000} value={t} aria-label="Private note" onChange={(e) => setT(e.target.value)} />
      <span className="adm-go">
        <button
          className="btn"
          disabled={busy || t === value}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await onSave(t);
              setMsg({ text: "Saved" });
            } catch (e) {
              setMsg({ text: errText(e), err: true });
            }
            setBusy(false);
          }}
        >
          {busy ? <i className="adm-spin" /> : null}Save note
        </button>
        {msg && (
          <span className={`adm-res${msg.err ? " err" : ""}`} role="status">
            {msg.err ? <X size={13} /> : <Check size={13} />}
            {msg.text}
          </span>
        )}
      </span>
    </div>
  );
}

const flags = (r: { account: boolean; byBuyer?: boolean; refunded: number | null }) => [
  r.account ? { t: "Signed-in buyer", tone: "blue" } : { t: "No account (older booking)" },
  !!r.byBuyer && !r.refunded && { t: "Cancelled by the buyer" },
  !!r.refunded && { t: "Refunded " + day(r.refunded), tone: "amber" },
];

// ---- the bookings --------------------------------------------------------------------

function PanelCard({ r, sp, keyVal, st, run, fresh }: { r: SpRow; sp: SpData; keyVal: string; st: St; run: Run; fresh: boolean }) {
  const ord = sp.rows.filter((x) => x.ord === r.ord);
  const ordTotal = ord.reduce((a, x) => a + x.total, 0);
  const post = (b: Record<string, unknown>) => spPost(keyVal, "sponsors", b);
  const id = (op: string) => `sp${op}${r.id}`;
  return (
    <div className={`spn-item${fresh ? " fresh" : ""}`} data-kind="panel" data-id={r.id}>
      <div className="spn-item-head">
        <b>{r.company}</b>
        <span className={`chip static spn-st ${r.status}`}>{STATUS[r.status] ?? r.status}{r.showing ? ", on the boards now" : ""}</span>
      </div>
      <Chips list={flags(r)} />
      <div className="spn-row">
        <Logo keyVal={keyVal} kind="sponsors" id={r.id} v={r.v} panel={r.panel} mode={r.mode} fit={r.fit} />
        <Meta
          rows={[
            ["Panel", r.name],
            ["Booking", ord.length > 1 ? `${ord.length} panels: ${ord.map((x) => x.name.replace(/:.*$/, "")).join(", ")}; ${usd(ordTotal)} in all` : null],
            ["Dates", r.status === "live" ? `${day(r.start)} to ${day(r.end)}` : r.status === "pending" ? "From your approval (or when the panel is free)" : r.months.join(", ")],
            ["Price", r.offer ? `Offered ${usd(r.price)} a month (listed ${usd(r.listed)})` : `Listed ${usd(r.price)} a month`],
            ["Launch post", r.feature ? `Yes, ${usd(r.feature)}: feature this logo in a launch post by hand` : null],
            ["Package", `${r.pkg} month${r.pkg > 1 ? "s" : ""}${r.discount ? `, ${Math.round(r.discount * 100)}% off` : ""}`],
            ["Total", `${usd(r.total)}, charged at once`],
            ["Hold left", r.authLeft != null ? `${left(r.authLeft)}, then released by itself` : null],
            ["Refunded", r.refunded ? `${whenUtc(r.refunded)}, cancelled by the buyer` : null],
            ["Contact", r.contact],
            ["Email", mail(r.email)],
            ["Website", r.website || null],
            ["Sells", r.category],
            ["Note", r.note || null],
            ["Applied", day(r.at)],
            ["Stripe", r.stripe ? <span className="mono">{r.stripe}</span> : null],
            ["Logo", `${r.w} x ${r.h} px, shown ${r.mode === "colour" ? "in its colours" : "in the panel tone"}`],
          ]}
        />
      </div>
      <div className="spn-acts">
        {r.status === "pending" && (
          <>
            <Act id={id("approve")} st={st} run={run} go label={`Approve: charge ${usd(ordTotal)}`} ask={`Charge ${usd(ordTotal)} and book ${r.company} on ${ord.length > 1 ? ord.length + " panels" : r.name}?`} fn={() => post({ op: "approve", id: r.id })} ok="Charged, booked" />
            <Act id={id("reject")} st={st} run={run} danger label="Reject: release" ask={`Release ${r.company}'s hold? Nothing is charged.`} fn={() => post({ op: "reject", id: r.id })} ok="Released" />
          </>
        )}
        {r.status === "live" && <Act id={id("pull")} st={st} run={run} danger label="Pull" ask={`Take ${r.company} off the boards? Nothing is refunded by this.`} fn={() => post({ op: "pull", id: r.id })} ok="Pulled" />}
        {(r.status === "pending" || r.status === "live") && !r.corner && (
          <Act id={id("mode")} st={st} run={run} label={r.mode === "colour" ? "Show in panel tone" : "Show in its colours"} fn={() => post({ op: "mode", id: r.id, mode: r.mode === "colour" ? "mark" : "colour" })} />
        )}
        {["live", "pulled"].includes(r.status) && !r.refunded && !ord.some((x) => x.refunded) && (
          <Act
            id={id("refund")}
            st={st}
            run={run}
            danger
            label={`Refund ${usd(ordTotal)}`}
            ask={`Give ${r.company} back ${usd(ordTotal)}${ord.length > 1 ? " for all " + ord.length + " panels" : ""} and take ${ord.length > 1 ? "them" : "it"} off the boards? This cannot be undone.`}
            fn={() => post({ op: "refund", id: r.id })}
            ok="Refunded"
          />
        )}
        {!["checkout", "pending"].includes(r.status) && <Act id={id("delete")} st={st} run={run} danger label="Delete" ask={`Delete ${r.company}'s application and logo for good?`} fn={() => post({ op: "delete", id: r.id })} ok="Deleted" />}
      </div>
      <Note value={r.adminNote} onSave={(text) => post({ op: "note", id: r.id, text })} />
    </div>
  );
}

function CourtCard({ r, keyVal, st, run, fresh }: { r: BbRow; keyVal: string; st: St; run: Run; fresh: boolean }) {
  const post = (b: Record<string, unknown>) => spPost(keyVal, "billboard", b);
  const id = (op: string) => `bb${op}${r.id}`;
  return (
    <div className={`spn-item${fresh ? " fresh" : ""}`} data-kind="court" data-id={r.id}>
      <div className="spn-item-head">
        <b>{r.company}</b>
        <span className={`chip static spn-st ${r.status}`}>{COURT[r.status] ?? r.status}</span>
      </div>
      <Chips list={flags(r)} />
      <div className="spn-row">
        <Logo keyVal={keyVal} kind="billboard" id={r.id} v={r.v} mode={r.mode} fit={r.fit} court />
        <Meta
          rows={[
            ["Spot", "King of the Court"],
            ["Price", usd(r.price)],
            ["Contact", r.contact],
            ["Email", mail(r.email)],
            ["Website", r.website || null],
            ["Sells", r.category],
            ["Started", whenUtc(r.at)],
            ["Paid", whenUtc(r.review_at)],
            ["Auto-release", r.releasesAt ? whenUtc(r.releasesAt) : null],
            ["Live", whenUtc(r.live_at)],
            ["Ended", whenUtc(r.ended_at)],
            ["Stripe", r.stripe ? <span className="mono">{r.stripe}</span> : null],
          ]}
        />
      </div>
      <div className="spn-acts">
        {r.status === "review" && (
          <>
            <Act id={id("approve")} st={st} run={run} go label={`Approve: charge ${usd(r.price)}`} ask={`Charge ${usd(r.price)} and put ${r.company} on the court now?`} fn={() => post({ op: "approve", id: r.id })} ok="On the court" />
            <Act id={id("reject")} st={st} run={run} danger label="Reject: release" ask={`Release ${r.company}'s hold? Nothing is charged.`} fn={() => post({ op: "reject", id: r.id })} ok="Released" />
          </>
        )}
        {r.status === "live" && <Act id={id("pull")} st={st} run={run} danger label="Pull" ask={`Take ${r.company} off the court? The spot opens now; nothing is refunded by this.`} fn={() => post({ op: "pull", id: r.id })} ok="Pulled" />}
        {(r.status === "review" || r.status === "live") && (
          <Act id={id("mode")} st={st} run={run} label={r.mode === "colour" ? "Show in mat tone" : "Show in its colours"} fn={() => post({ op: "mode", id: r.id, mode: r.mode === "colour" ? "mark" : "colour" })} />
        )}
        {["live", "outbid", "pulled"].includes(r.status) && !!r.live_at && !r.refunded && (
          <Act
            id={id("refund")}
            st={st}
            run={run}
            danger
            label={`Refund ${usd(r.price)}`}
            ask={`Give ${r.company} back ${usd(r.price)}${r.status === "live" ? " and take it off the court (the spot opens now)" : ""}? This cannot be undone.`}
            fn={() => post({ op: "refund", id: r.id })}
            ok="Refunded"
          />
        )}
        {!["checkout", "review", "live"].includes(r.status) && <Act id={id("delete")} st={st} run={run} danger label="Delete" ask={`Delete ${r.company}'s takeover and logo for good?`} fn={() => post({ op: "delete", id: r.id })} ok="Deleted" />}
      </div>
      <Note value={r.adminNote} onSave={(text) => post({ op: "note", id: r.id, text })} />
    </div>
  );
}

const csvCell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  const f = /^[=+\-@\t]/.test(t);
  return /[",\n\r]/.test(t) || f ? '"' + (f ? "'" : "") + t.replace(/"/g, '""') + '"' : t; // a leading ' so a spreadsheet never runs a typed formula
};
function downloadCsv(sp: SpData | null, bb: BbData | null) {
  const head = ["kind", "id", "order", "status", "company", "contact", "email", "spot", "start", "end", "months", "price", "total", "refunded", "applied"];
  const lines = [
    head,
    ...(sp?.rows ?? []).map((r) => ["panel", r.id, r.ord, r.status, r.company, r.contact, r.email, r.name, day(r.start), day(r.end), r.pkg, (r.price / 100).toFixed(2), (r.total / 100).toFixed(2), r.refunded ? day(r.refunded) : "", day(r.at)]),
    ...(bb?.rows ?? []).map((r) => ["court", r.id, "", r.status, r.company, r.contact, r.email, "King of the Court", day(r.live_at), day(r.ended_at), "", (r.price / 100).toFixed(2), (r.price / 100).toFixed(2), "", day(r.at)]),
  ].map((l) => l.map(csvCell).join(","));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv" }));
  a.download = `poddle-sponsors-${day(Date.now())}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function BookingsTab({ sp, bb, keyVal, st, run, fresh }: { sp: SpData; bb: BbData | null; keyVal: string; st: St; run: Run; fresh: Set<string> }) {
  const [f, setF] = useState<Filter>(() => (FILTERS.some(([k]) => k === lsGet("stats.spFilter")) ? (lsGet("stats.spFilter") as Filter) : "wait"));
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hit = (r: { company: string; contact: string; email: string; name?: string }) => !needle || [r.company, r.contact, r.email, r.name].some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
  const count = (k: Filter) => (k === "all" ? 0 : sp.rows.filter((r) => panelIn(r, k, sp.now)).length + (bb?.rows ?? []).filter((r) => courtIn(r, k)).length);
  const panels = sp.rows.filter((r) => panelIn(r, f, sp.now) && hit(r));
  const court = (bb?.rows ?? []).filter((r) => courtIn(r, f) && hit(r));
  return (
    <>
      <div className="spn-bar">
        <div className="adm-subtabs">
          <Seg value={f} options={FILTERS} count={count} onChange={(k) => (setF(k), lsSet("stats.spFilter", k))} />
        </div>
        <input className="adm-in spn-q" type="search" placeholder="Search company, name or email" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => downloadCsv(sp, bb)}>
          <Download size={14} /> CSV
        </button>
      </div>
      {bb && court.length > 0 && (
        <div className="spn-group">
          <div className="spn-group-head">King of the Court</div>
          {court.map((r) => (
            <CourtCard key={r.id} r={r} keyVal={keyVal} st={st} run={run} fresh={fresh.has("bb" + r.id)} />
          ))}
        </div>
      )}
      <div className="spn-group">
        <div className="spn-group-head">Panels</div>
        {panels.length ? (
          panels.map((r) => <PanelCard key={r.id} r={r} sp={sp} keyVal={keyVal} st={st} run={run} fresh={fresh.has("sp" + r.id)} />)
        ) : (
          <div className="list-empty spn-none">{sp.rows.length ? "Nothing here" : "No applications"}</div>
        )}
      </div>
    </>
  );
}

// ---- the auctions (NOTES 509, 512): winners to approve, logos to check once ----

function AuctionsTab({ au, keyVal, st, run }: { au: AuData | "off" | null; keyVal: string; st: St; run: Run }) {
  if (au === "off") return <div className="list-empty adm-pad">The auctions are off on Poddle</div>;
  if (!au) return <div className="adm-pad"><div className="spinner" /></div>;
  const post = (b: Record<string, unknown>) => spPost(keyVal, "auctions", b);
  if (!au.reviews.length && !au.toCheck.length) return <div className="list-empty adm-pad">Nothing waiting</div>;
  return (
    <>
      {au.reviews.length > 0 && (
        <div className="spn-group">
          <div className="spn-group-head">Winners to approve</div>
          {au.reviews.map((a) => {
            const b = a.bid;
            return (
              <div className="spn-item fresh" key={a.id} data-kind="review" data-id={a.id}>
                <div className="spn-item-head">
                  <b>{b ? b.company : "No bid left"}</b>
                </div>
                <div className="spn-row">
                  {b ? <Logo keyVal={keyVal} kind="auctions" id={b.id} v={b.v} panel={a.panel} mode="mark" fit={b.fit} /> : <div className="spn-logo" />}
                  <Meta
                    rows={[
                      ["Panel", panelName(a.panel)],
                      ["Winning bid", b ? usd(b.amount) : null],
                      ["Card", b?.card ?? null],
                      ["Email", mail(b?.email)],
                      ["Logo", b ? (b.logo_ok ? "Checked" : "Not checked yet") : null],
                      ["Starts", whenUtc(a.startsAt)],
                    ]}
                  />
                </div>
                {b && (
                  <div className="spn-acts">
                    <Act id={`auok${a.id}`} st={st} run={run} go label={`Approve: charge ${usd(b.amount)}`} ask={`Charge ${b.company} ${usd(b.amount)} and put them on ${panelName(a.panel)} for a month?`} fn={() => post({ op: "approve", id: a.id })} ok="Charged, booked" />
                    <Act id={`auno${a.id}`} st={st} run={run} danger label="Refuse: next bid" ask={`Refuse ${b.company}'s logo? Nothing is charged; the next highest bid wins at its own amount.`} fn={() => post({ op: "refuse", id: a.id })} ok="Refused" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {au.toCheck.length > 0 && (
        <div className="spn-group">
          <div className="spn-group-head">Logos to check</div>
          {au.toCheck.map((b) => (
            <div className="spn-item" key={b.id} data-kind="check" data-id={b.id}>
              <div className="spn-item-head">
                <b>{b.company}</b>
              </div>
              <div className="spn-row">
                <Logo keyVal={keyVal} kind="auctions" id={b.id} v={b.logo_v} panel={b.panel} mode="mark" fit={b.fit} />
                <Meta
                  rows={[
                    ["Panel", panelName(b.panel)],
                    ["Bid", usd(b.amount)],
                    ["Ends", whenUtc(b.ends_at)],
                  ]}
                />
              </div>
              <div className="spn-acts">
                <Act id={`aulogo${b.id}`} st={st} run={run} go label="Logo is fine: show it" fn={() => post({ op: "logook", id: b.id })} ok={`${b.company}’s logo is showing on ${panelName(b.panel)}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---- change requests (NOTES 507): reply by email; Done files it ----

function RequestsTab({ asks, keyVal, st, run, fresh }: { asks: SpAsk[]; keyVal: string; st: St; run: Run; fresh: Set<string> }) {
  if (!asks.length) return <div className="list-empty adm-pad">No change requests</div>;
  return (
    <div className="spn-group">
      {asks.map((a) => (
        <div className={`spn-item${a.done ? " done" : fresh.has("ask" + a.id) ? " fresh" : ""}`} key={a.id} data-kind="ask" data-id={a.id}>
          <div className="spn-item-head">
            <b>{a.company || "Booking deleted"}</b>
            {a.done ? <span className="chip static spn-st ended">Done</span> : <span className="chip static spn-st pending">Waiting</span>}
          </div>
          <p className="adm-text spn-ask-text">{a.text}</p>
          <Meta
            rows={[
              ["Booking", `${a.kind === "court" ? "King of the Court" : "Panel order"} #${a.ref}`],
              ["Contact", a.contact],
              ["Email", mail(a.email, "Your Poddle booking")],
              ["Sent", whenUtc(a.at)],
              ["Done", whenUtc(a.done)],
            ]}
          />
          {!a.done && (
            <div className="spn-acts">
              <Act id={`ask${a.id}`} st={st} run={run} label="Done" fn={() => spPost(keyVal, "sponsors", { op: "askdone", id: a.id })} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- the panels (NOTES 351, 388, 511, 513): prices, bookings, on or off sale ----

function PanelsTab({ sp, keyVal, st, run }: { sp: SpData; keyVal: string; st: St; run: Run }) {
  const A = sp.audience;
  const blocked = new Set(sp.blocked);
  return (
    <>
      {!sp.configured && <Chips list={[{ t: "Not open: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set", tone: "red" }]} />}
      <Tiles
        items={[
          { label: "Panels sold now", value: `${sp.sold} / ${sp.panels.length}` },
          { label: "Per panel sold", value: `+${sp.ladderPct}%` },
          { label: "Players a day (7 d)", value: String(A.players) },
          { label: "Players the prices stand for", value: String(A.base) },
          { label: "Audience factor", value: `×${A.factor}` },
        ]}
      />
      <div className="scroll adm-tablewrap spn-panels">
        <table className="ins-table adm-table">
          <thead>
            <tr>
              <th>Panel</th>
              <th>Price</th>
              <th>Booked</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sp.panels.map((p) => {
              const off = blocked.has(p.id);
              return (
                <tr key={p.id}>
                  <td className="l">
                    <span className="dim mono">{p.id}</span> {p.name}
                  </td>
                  <td className="mono">{usd(p.price)}/mo</td>
                  <td className="l">
                    {p.booked.length
                      ? p.booked.map((b) => (
                          <span key={b.id} className={`chip static${b.now ? " spn-now" : ""}`}>
                            {b.company} {b.from}
                            {b.to !== b.from ? ` – ${b.to}` : ""}
                          </span>
                        ))
                      : <span className="dim">None</span>}
                  </td>
                  <td className="r">
                    <span className="adm-go">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!off}
                        className={`adm-tog${off ? "" : " on"}`}
                        disabled={st[`blk${p.id}`]?.busy}
                        onClick={() => run(`blk${p.id}`, () => spPost(keyVal, "sponsors", { op: "block", panel: p.id, on: !off }), off ? "For sale" : "Off sale")}
                        title={off ? "Put it back on sale" : "Take it off sale (a house ad)"}
                      >
                        <i />
                        {off ? "Not for sale" : "For sale"}
                      </button>
                      {st[`blk${p.id}`]?.err && <span className="adm-res err">{st[`blk${p.id}`]?.msg}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- the sales switches and King of the Court's state (NOTES 358, 511, 513) ----

function SalesTab({ sp, bb, keyVal, st, run }: { sp: SpData; bb: BbData | "off" | null; keyVal: string; st: St; run: Run }) {
  const P = sp.paused;
  const sw = (what: "panels" | "court", label: string) => {
    const open = !P[what];
    return (
      <div className="spn-switch">
        <span>{label}</span>
        <b className={open ? "spn-open" : "spn-paused"}>{open ? "Open" : "Paused"}</b>
        <Act
          id={`pause${what}`}
          st={st}
          run={run}
          danger={open}
          label={open ? "Pause" : "Open again"}
          ask={open ? `Pause ${label.toLowerCase()}? No new bookings until you open it again; what is booked keeps running.` : undefined}
          fn={() => spPost(keyVal, "sponsors", { op: "pause", what, on: open })}
          ok={open ? "Paused" : "Open"}
        />
      </div>
    );
  };
  const court = bb && bb !== "off" ? bb : null;
  const state = !court
    ? null
    : !court.configured
      ? { t: "Not open: Stripe keys not set", tone: "red" }
      : court.state === "review"
        ? { t: "Waiting for you", tone: "amber" }
        : court.state === "locked"
          ? { t: "Held · opens by " + whenUtc(court.opensAt), tone: "green" }
          : { t: "Open", tone: "blue" };
  return (
    <>
      <div className="adm-pad spn-switches">
        {sw("panels", "Panel bookings")}
        {sw("court", "King of the Court")}
      </div>
      {court && (
        <>
          <div className="spn-group-head adm-pad spn-sub">King of the Court</div>
          <Chips list={[state, court.testClock && { t: "Test clock" }]} />
          <Tiles
            items={[
              { label: "Price now", value: usd(court.price) },
              { label: "Buy-in", value: usd(court.buyIn) },
              { label: "Takeovers, 24 h", value: String(court.heat) },
              { label: "Players at once", value: String(court.players) },
              { label: "New sessions an hour", value: String(court.rate) },
              ...(court.state === "locked" && court.hold ? [{ label: "Sessions of the hold", value: `${court.hold.sessions} / ${court.hold.target}` }] : []),
            ]}
          />
          {(court.state === "locked" || court.heat > 0) && (
            <div className="spn-acts adm-pad">
              {court.state === "locked" && (
                <Act id="opennow" st={st} run={run} label="Open the court now" ask="End the current hold now? The holder stays on the court until someone takes it." fn={() => spPost(keyVal, "billboard", { op: "opennow" })} ok="Open" />
              )}
              {court.heat > 0 && (
                <Act id="resetheat" st={st} run={run} label={`Price back to ${usd(court.buyIn)}`} ask={`Set the court's price back to the buy-in, ${usd(court.buyIn)}? Takeovers so far stop adding to it.`} fn={() => spPost(keyVal, "billboard", { op: "resetheat" })} ok="Reset" />
              )}
            </div>
          )}
        </>
      )}
      {bb === "off" && <div className="list-empty adm-pad">King of the Court is off on Poddle</div>}
    </>
  );
}

// ---- the overview (NOTES 511): what is waiting, what is up, and the money ----

function overview(sp: SpData, bb: BbData | null, waiting: number) {
  const rows = sp.rows, C = bb?.rows ?? [];
  const d = new Date(sp.now), m0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const orders = [...new Map(rows.map((r) => [r.ord, rows.filter((x) => x.ord === r.ord)])).values()];
  const paid = orders.filter((o) => o.some((x) => x.status === "live" || x.status === "pulled") && !o.some((x) => x.refunded));
  const refunded = orders.filter((o) => o.some((x) => x.refunded));
  const sum = (os: SpRow[][]) => os.reduce((a, o) => a + o.reduce((b, x) => b + x.total, 0), 0);
  const courtPaid = C.filter((r) => ["live", "outbid", "pulled"].includes(r.status) && r.live_at);
  const charged = sum(paid) + courtPaid.reduce((a, r) => a + r.price, 0);
  const chargedM = sum(paid.filter((o) => (o[0].decided || 0) >= m0)) + courtPaid.filter((r) => (r.live_at ?? 0) >= m0).reduce((a, r) => a + r.price, 0);
  const held = sum(orders.filter((o) => o.some((x) => x.status === "pending"))) + C.filter((r) => r.status === "review").reduce((a, r) => a + r.price, 0);
  const showing = rows.filter((r) => r.status === "live" && r.showing).length + (bb && bb.state !== "open" && C.some((r) => r.status === "live") ? 1 : 0);
  return [
    { label: "Waiting for you", value: String(waiting) },
    { label: "Logos up now", value: String(showing) },
    { label: "Charged this month", value: usd(chargedM) },
    { label: "Charged, on record", value: usd(charged) },
    { label: "Held on cards now", value: usd(held) },
    { label: "Refunded", value: usd(sum(refunded)) },
  ];
}

// ---- Card ---------------------------------------------------------------------------

type Got = { sp: SpData | null; bb: BbData | "off" | null; au: AuData | "off" | null; off: boolean; err: string };

export function Sponsors({ keyName, onKeys, tick }: { keyName: string; onKeys: () => void; tick?: number }) {
  const keyVal = lsGet(keyName);
  const [tab, setTab] = useState<Tab>(() => ((TABS as readonly string[]).includes(lsGet("stats.spTab")) ? (lsGet("stats.spTab") as Tab) : "Bookings"));
  const [got, setGot] = useState<Got>({ sp: null, bb: null, au: null, off: false, err: "" });
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const [st, setSt] = useState<St>({});
  // the last action's result, above the lists: a row that an action files (Shown, Approved, Refused) leaves its list at the reload, its own note with it
  const [done, setDone] = useState<{ msg: string; err: boolean } | null>(null);
  const doneT = useRef<number | undefined>(undefined);
  const say = useCallback((msg: string, err: boolean) => {
    setDone({ msg, err });
    window.clearTimeout(doneT.current);
    doneT.current = window.setTimeout(() => setDone(null), 8000);
  }, []);

  const load = useCallback(async () => {
    if (!keyVal) return;
    const [a, b, c] = await Promise.allSettled([spGet<SpData>(keyVal, "sponsors"), spGet<BbData>(keyVal, "billboard"), spGet<AuData>(keyVal, "auctions")]);
    if (a.status === "rejected") {
      const e = a.reason;
      setGot({ sp: null, bb: null, au: null, off: e instanceof OffError, err: e instanceof OffError ? "" : e instanceof KeyError ? "Key rejected" : `Couldn’t load (${(e as Error)?.message ?? e})` });
      return;
    }
    const sp = a.value;
    const bb = b.status === "fulfilled" ? b.value : b.reason instanceof OffError ? "off" : null;
    const au = c.status === "fulfilled" ? c.value : c.reason instanceof OffError ? "off" : null;
    // what is waiting that was not here at the last look: marked, as the old page did
    const waitingIds = [
      ...sp.rows.filter((r) => r.status === "pending").map((r) => "sp" + r.id),
      ...(bb && bb !== "off" ? bb.rows.filter((r) => r.status === "review").map((r) => "bb" + r.id) : []),
      ...sp.asks.filter((x) => !x.done).map((x) => "ask" + x.id),
    ];
    const prev = seen.current;
    setFresh(new Set(prev ? waitingIds.filter((id) => !prev.has(id)) : []));
    seen.current = new Set([...(prev ?? []), ...sp.rows.map((r) => "sp" + r.id), ...(bb && bb !== "off" ? bb.rows.map((r) => "bb" + r.id) : []), ...sp.asks.map((x) => "ask" + x.id)]);
    setGot({ sp, bb, au, off: false, err: "" });
  }, [keyVal]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 30e3);
    return () => clearInterval(t);
  }, [load, tick]);

  const run: Run = useCallback(
    async (id, fn, ok = "Done") => {
      setSt((s) => ({ ...s, [id]: { busy: true } }));
      try {
        await fn();
        setSt((s) => ({ ...s, [id]: { msg: ok } }));
        say(ok, false);
        await load();
        return true;
      } catch (e) {
        setSt((s) => ({ ...s, [id]: { msg: errText(e), err: true } }));
        say(errText(e), true);
        await load().catch(() => {});
        return false;
      }
    },
    [load, say],
  );

  const { sp, bb, au } = got;
  const court = bb && bb !== "off" ? bb : null;
  const counts = useMemo(() => {
    const panels = sp ? sp.rows.filter((r) => r.status === "pending").length : 0;
    const courtN = court ? court.rows.filter((r) => r.status === "review").length : 0;
    const asks = sp ? sp.asks.filter((a) => !a.done).length : 0;
    const auN = au && au !== "off" ? au.reviews.length + au.toCheck.length : 0;
    return { bookings: panels + courtN, asks, auctions: auN, total: panels + courtN + asks + auN };
  }, [sp, court, au]);

  useEffect(() => {
    document.title = (counts.total ? `(${counts.total}) ` : "") + "Admin";
  }, [counts.total]);

  let body: ReactNode;
  if (!keyVal || got.err === "Key rejected") {
    body = (
      <div className="empty">
        <p>{!keyVal ? "Add your Poddle key" : got.err}</p>
        <button className="btn" onClick={onKeys}>
          <KeyRound size={14} /> Keys
        </button>
      </div>
    );
  } else if (got.off) body = <div className="list-empty adm-pad">Sponsors are off on Poddle (SPONSORS=0)</div>;
  else if (got.err) body = <div className="list-empty adm-pad">{got.err}</div>;
  else if (!sp) body = <div className="adm-pad"><div className="spinner" /></div>;
  else {
    body = (
      <>
        <Tiles items={overview(sp, court, counts.total)} />
        {done && (
          <p className={`adm-res spn-done${done.err ? " err" : ""}`} role="status">
            {done.err ? <X size={13} /> : <Check size={13} />}
            {done.msg}
          </p>
        )}
        {tab === "Bookings" && <BookingsTab sp={sp} bb={court} keyVal={keyVal} st={st} run={run} fresh={fresh} />}
        {tab === "Auctions" && <AuctionsTab au={au} keyVal={keyVal} st={st} run={run} />}
        {tab === "Requests" && <RequestsTab asks={sp.asks} keyVal={keyVal} st={st} run={run} fresh={fresh} />}
        {tab === "Panels" && <PanelsTab sp={sp} keyVal={keyVal} st={st} run={run} />}
        {tab === "Sales" && <SalesTab sp={sp} bb={bb} keyVal={keyVal} st={st} run={run} />}
      </>
    );
  }
  const tabCount = (t: Tab) => (t === "Bookings" ? counts.bookings : t === "Auctions" ? counts.auctions : t === "Requests" ? counts.asks : 0);

  return (
    <section className="card ins-card adm-card spn-card" id="sponsors">
      <header className="card-head ins-head">
        <h2>Sponsors</h2>
        {sp && (
          <div className="ins-tabs adm-subtabs">
            <Seg value={tab} options={TABS.map((t) => [t, t] as const)} count={tabCount} onChange={(t) => (setTab(t), lsSet("stats.spTab", t))} />
          </div>
        )}
      </header>
      {body}
    </section>
  );
}

