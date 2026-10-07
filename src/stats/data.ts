// Data for the stats panel (/stats). Each site has its own source:
//  - poddleball.com: Poddle's own page-view counter (no third party), read
//    from GET https://poddleball.com/api/traffic with the STATS_KEY bearer
//    (poddle NOTES 231). Its "people" are distinct addresses per UTC day.
//  - danielrltan.com: Umami Cloud's API with an API key from Umami's settings.
// "Visitors" is the same thing for both: unique per UTC day, summed over the
// range, so the two cards can be compared. Keys live in this browser's
// localStorage only, never in the bundle.

export type Day = { day: string; views: number; visitors: number };
export type Row = { label: string; value: number };
export type Totals = { views: number; visitors: number };
export type SiteStats = {
  days: Day[]; // oldest first, one per UTC day of the range, zeros filled
  totals: Totals;
  prev: Totals; // the same length of time just before the range
  pages: Row[];
  sources: Row[];
};

export class KeyError extends Error {}

const DAY_MS = 86400e3;
const UMAMI_API = "https://api.umami.is/v1";
export const UMAMI_WEBSITE = "cc7aecbb-7a58-4e15-84de-1932fc608d79"; // danielrltan.com (index.html's tracker)
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

// Umami gets its own header: its preflight answers Allow-Headers "*", which
// covers a custom header but, by the Fetch spec, never Authorization.
async function getJson(url: string, key: string) {
  const headers: Record<string, string> = url.startsWith(UMAMI_API) ? { "x-umami-api-key": key } : { Authorization: `Bearer ${key}` };
  const res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) throw new KeyError("key rejected");
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ---- poddleball.com ---------------------------------------------------------

type PoddleCell = { views: number; people: number };
type PoddleDay = PoddleCell & {
  day: string;
  sources: (PoddleCell & { source: string })[];
  pages: (PoddleCell & { page: string })[];
};

const PODDLE_SOURCE: Record<string, string> = { site: "poddleball.com" };

export async function loadPoddle(key: string, range: number): Promise<SiteStats> {
  const s = spans(range);
  const body = await getJson(`${PODDLE_API}?days=${2 * range}`, key);
  const list: PoddleDay[] = Array.isArray(body?.days) ? body.days : [];
  const byDay = new Map<string, Day>();
  const inRange = new Set(s.cur);
  const pages = new Map<string, number>();
  const sources = new Map<string, number>();
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
      const label = PODDLE_SOURCE[x.source] ?? x.source;
      sources.set(label, (sources.get(label) ?? 0) + x.people);
    }
  }
  const days = fill(byDay, s.cur);
  return { days, totals: sum(days), prev: sum(fill(byDay, s.prev)), pages: top(pages), sources: top(sources) };
}

// ---- danielrltan.com (Umami) ------------------------------------------------

type XY = { x: string; y: number | string };
const num = (v: unknown): number => {
  if (v && typeof v === "object" && "value" in v) return num((v as { value: unknown }).value);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function loadUmami(key: string, range: number): Promise<SiteStats> {
  const s = spans(range);
  const base = `${UMAMI_API}/websites/${UMAMI_WEBSITE}`;
  const curStart = Date.parse(s.cur[0] + "T00:00:00Z");
  const q = (startAt: number, extra = "") => `startAt=${startAt}&endAt=${s.endAt}&timezone=UTC${extra}`;
  const [series, pathRows, refRows] = await Promise.all([
    getJson(`${base}/pageviews?${q(s.startAt, "&unit=day")}`, key),
    getJson(`${base}/metrics?${q(curStart, "&type=path&limit=8")}`, key).catch(() =>
      getJson(`${base}/metrics?${q(curStart, "&type=url&limit=8")}`, key), // older Umami calls it url
    ),
    getJson(`${base}/metrics?${q(curStart, "&type=referrer&limit=8")}`, key),
  ]);
  const byDay = new Map<string, Day>();
  const at = (x: string) => {
    const day = String(x).replace(" ", "T").slice(0, 10);
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day, views: 0, visitors: 0 }));
    return d;
  };
  for (const p of (series?.pageviews ?? []) as XY[]) at(p.x).views += num(p.y);
  for (const p of (series?.sessions ?? []) as XY[]) at(p.x).visitors += num(p.y);
  const rows = (list: unknown, blank: string): Row[] =>
    (Array.isArray(list) ? (list as XY[]) : []).map((r) => ({ label: r.x || blank, value: num(r.y) })).filter((r) => r.value > 0);
  const days = fill(byDay, s.cur);
  return {
    days,
    totals: sum(days),
    prev: sum(fill(byDay, s.prev)),
    pages: rows(pathRows, "/"),
    sources: rows(refRows, "direct"),
  };
}
