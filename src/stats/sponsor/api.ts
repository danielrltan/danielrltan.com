// The sponsor admin's calls (poddle docs/ADMIN.md "Sponsors", NOTES 351, 358, 388, 507, 509-513, 1056): the panel bookings
// (/api/sponsors/admin), King of the Court (/api/billboard/admin) and the auctions (/api/auctions/admin), each GET for the list and
// POST { op, ... } for an action, with the same Poddle key as the rest of the panel. Poddle answers this panel's origin cross-origin
// for these routes only (server/api.js). Logos come from the keyed /logo?id= routes, so they are fetched with the key and drawn
// from a blob; never an <img src> on Poddle.
import { KeyError } from "../data";
import { PODDLE } from "../poddle";

export type Kind = "sponsors" | "billboard" | "auctions";
export class OffError extends Error {}

export type SpRow = {
  id: number; at: number; company: string; contact: string; email: string; website?: string; months: string[]; category: string; note?: string;
  w: number; h: number; v: number; status: string; panel: number; name: string; start: number | null; end: number | null; listed: number; price: number; offer: boolean;
  feature: number; total: number; pkg: number; discount: number; mode: string; corner: boolean; decided: number | null; stripe: string | null; authLeft: number | null;
  showing: boolean; ord: number; refunded: number | null; fit: { s: number; x: number; y: number } | null; byBuyer: boolean; account: boolean; adminNote: string;
};
export type SpPanel = { id: number; name: string; price: number; corner: boolean; booked: { id: number; company: string; from: string; to: string; now: boolean }[] };
export type SpAsk = { id: number; kind: "panel" | "court"; ref: number; text: string; at: number; done: number | null; company: string | null; contact: string | null; email: string | null };
export type SpData = {
  configured: boolean; paused: { panels: boolean; court: boolean }; blocked: number[]; now: number; testClock: boolean; sold: number; ladderPct: number;
  audience: { players: number; days: number; base: number; factor: number }; panels: SpPanel[]; rows: SpRow[]; asks: SpAsk[];
};
export type BbRow = {
  id: number; at: number; company: string; contact: string; email: string; website?: string; category: string; w: number; h: number; v: number; mode: string; price: number;
  status: string; review_at: number | null; live_at: number | null; ended_at: number | null; releasesAt: number | null; stripe: string | null; fit: SpRow["fit"];
  account: boolean; adminNote: string; refunded: number | null; byBuyer?: boolean;
};
export type BbData = {
  configured: boolean; paused: boolean; state: "open" | "locked" | "review" | string; price: number; buyIn: number; heat: number; players: number; rate: number;
  opensAt: number | null; hold: { sessions: number; target: number } | null; testClock: boolean; rows: BbRow[];
};
export type AuBid = { id: number; amount: number; company: string; logo_ok: boolean; w: number; h: number; v: number; fit: SpRow["fit"]; email: string | null; card: string | null };
export type AuCheck = { id: number; auction: number; amount: number; company: string; logo_w: number; logo_h: number; logo_v: number; fit: SpRow["fit"]; panel: number; ends_at: number };
export type AuData = { now: number; toCheck: AuCheck[]; reviews: { id: number; panel: number; startsAt: number; bid: AuBid | null }[] };

const url = (k: Kind, logo = false) => `${PODDLE}/api/${k}/admin${logo ? "/logo" : ""}`;

/** GET a list. A 404 means that part is off on Poddle (SPONSORS=0, or the auctions off): OffError. */
export async function spGet<T>(key: string, k: Kind): Promise<T> {
  const res = await fetch(url(k), { headers: { Authorization: `Bearer ${key}` }, credentials: "omit", cache: "no-store" });
  if (res.status === 401) throw new KeyError("key rejected");
  if (res.status === 404) throw new OffError("off");
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** POST an action. Throws Error(<server's error code>) on refusal. */
export async function spPost(key: string, k: Kind, body: Record<string, unknown>) {
  const res = await fetch(url(k), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    cache: "no-store",
  });
  if (res.status === 401) throw new KeyError("key rejected");
  let out: { error?: string; [k: string]: unknown } = {};
  try {
    out = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) throw new Error(out.error ? String(out.error) : `${res.status}`);
  return out;
}

// one decoded logo per (route, id, version): fetched once with the key, kept as an ImageBitmap
const logos = new Map<string, Promise<ImageBitmap | null>>();
export function logoOf(key: string, k: Kind, id: number, v: number | string = ""): Promise<ImageBitmap | null> {
  const tag = `${k}:${id}:${v}`;
  let p = logos.get(tag);
  if (!p) {
    p = fetch(`${url(k, true)}?id=${id}`, { headers: { Authorization: `Bearer ${key}` }, credentials: "omit", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return null;
        const blob = await r.blob();
        const src = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.src = src;
          await img.decode();
          return await createImageBitmap(img);
        } finally {
          URL.revokeObjectURL(src);
        }
      })
      .catch(() => null);
    logos.set(tag, p);
    p.then((b) => b || logos.delete(tag));
  }
  return p;
}

// ---- formatting, as the old page (web/sponsor-admin.js) ----
export const usd = (c: number) => "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
export const day = (t: number | null | undefined) => (t == null ? "" : new Date(t).toISOString().slice(0, 10));
export const whenUtc = (t: number | null | undefined) => (t == null ? "" : new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC");
export const left = (ms: number) => {
  const h = Math.floor(ms / 3600e3);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${Math.floor(ms / 60e3) % 60} min`;
};
