// Where the panel reaches Poddle's keyed API (traffic, insights, perf, admin, sponsors). The live game is
// https://playpoddle.com (poddle NOTES 1015; poddleball.com only forwards, and keeps just the older keyed routes).
//
// A local Poddle server for testing: open the panel on localhost with ?poddle=http://localhost:<port>
// (or 127.0.0.1). It is remembered in this browser (stats.poddleApi) until ?poddle=live. The override is
// honoured only when the panel itself is served from localhost, and only for a localhost target, so a
// crafted link can never send the owner's key anywhere else.

const LIVE = "https://playpoddle.com";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;
const STORE = "stats.poddleApi";

function pick(): string {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return LIVE;
    const q = new URLSearchParams(location.search).get("poddle");
    if (q !== null) {
      const v = q.replace(/\/+$/, "");
      if (LOCAL.test(v)) localStorage.setItem(STORE, v);
      else localStorage.removeItem(STORE);
    }
    const s = localStorage.getItem(STORE) ?? "";
    return LOCAL.test(s) ? s : LIVE;
  } catch {
    return LIVE;
  }
}

/** The Poddle origin every call goes to, no trailing slash. */
export const PODDLE = pick();
/** True when a local test server stands in for the live game. */
export const PODDLE_LOCAL = PODDLE !== LIVE;
