// Data for the stats panel (/stats). Both sites are counted in-house by Poddle's
// server (no third party) and read from GET https://poddleball.com/api/traffic
// with the STATS_KEY bearer (the Poddle key):
//  - poddleball.com: its pages, counted as they are served (poddle NOTES 231).
//  - danielrltan.com: counted from public/rum.js's load beacons, with the named
//    events of src/analytics.ts (?site=danielrltan.com, poddle NOTES 233). It
//    used Umami until 2026-10-07; that history stays in Umami's dashboard.
// "Visitors" = distinct network addresses per UTC day, summed over the range.
// The key lives in this browser's localStorage only, never in the bundle.

export type Day = { day: string; views: number; visitors: number };
export type Row = { label: string; value: number };
export type Totals = { views: number; visitors: number };
export type SiteStats = {
  days: Day[]; // oldest first, one per UTC day of the range, zeros filled
  totals: Totals;
  prev: Totals; // the same length of time just before the range
  pages: Row[];
  sources: Row[];
  events?: Row[]; // danielrltan.com: "name · detail", counts over the range
};

export class KeyError extends Error {}

const DAY_MS = 86400e3;
const PODDLE_API = "https://poddleball.com/api/traffic";

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfUtcDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;

/** The UTC days of the range (oldest first) and of the period before it. */
function spans(range: number, now = Date.now()) {
  const today = startOfUtcDay(now);
  const cur: string[] = [];
  const prev: string[] = [];
  for (let i = range - 1; i >= 0; i--) cur.push(dayOf(today - i * DAY_MS));
  for (let i = 2 * range - 1; i >= range; i--) prev.push(dayOf(today - i * DAY_MS));
  return { cur, prev, startAt: today - (2 * range - 1) * DAY_MS, endAt: now };
}

const sum = (days: Day[]): Totals =>
  days.reduce((t, d) => ({ views: t.views + d.views, visitors: t.visitors + d.visitors }), { views: 0, visitors: 0 });

function fill(byDay: Map<string, Day>, list: string[]): Day[] {
  return list.map((day) => byDay.get(day) ?? { day, views: 0, visitors: 0 });
}

function top(map: Map<string, number>, n = 8): Row[] {
  return [...map]
    .map(([label, value]) => ({ label, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, n);
}

async function getJson(url: string, key: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401 || res.status === 403) throw new KeyError("key rejected");
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ---- both sites ---------------------------------------------------------------

type PoddleCell = { views: number; people: number };
type PoddleDay = PoddleCell & {
  day: string;
  sources: (PoddleCell & { source: string })[];
  pages: (PoddleCell & { page: string })[];
  events?: { name: string; detail: string; n: number }[];
};

export const loadPoddle = (key: string, range: number) => loadTraffic("poddleball.com", key, range);
export const loadSite = (key: string, range: number) => loadTraffic("danielrltan.com", key, range);

async function loadTraffic(site: string, key: string, range: number): Promise<SiteStats> {
  const s = spans(range);
  const body = await getJson(`${PODDLE_API}?site=${site}&days=${2 * range}`, key);
  const list: PoddleDay[] = Array.isArray(body?.days) ? body.days : [];
  const byDay = new Map<string, Day>();
  const inRange = new Set(s.cur);
  const pages = new Map<string, number>();
  const sources = new Map<string, number>();
  const events = new Map<string, number>();
  for (const d of list) {
    // The day totals count crawlers too (source 'bot'): take them out.
    const bot = d.sources.find((x) => x.source === "bot");
    byDay.set(d.day, {
      day: d.day,
      views: Math.max(0, d.views - (bot?.views ?? 0)),
      visitors: Math.max(0, d.people - (bot?.people ?? 0)),
    });
    if (!inRange.has(d.day)) continue;
    for (const p of d.pages) pages.set(p.page, (pages.get(p.page) ?? 0) + p.views);
    for (const x of d.sources) {
      if (x.source === "bot") continue;
      const label = x.source === "site" ? site : x.source;
      sources.set(label, (sources.get(label) ?? 0) + x.people);
    }
    for (const e of d.events ?? []) {
      const label = e.detail ? `${e.name} · ${e.detail}` : e.name;
      events.set(label, (events.get(label) ?? 0) + e.n);
    }
  }
  const days = fill(byDay, s.cur);
  return {
    days,
    totals: sum(days),
    prev: sum(fill(byDay, s.prev)),
    pages: top(pages),
    sources: top(sources),
    ...(site === "poddleball.com" ? {} : { events: top(events, 12) }),
  };
}
