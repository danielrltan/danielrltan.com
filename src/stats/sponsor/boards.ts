// The stadium's 32 sponsor panels and the end mats' word box, ported from Poddle's web/scenery/stadium-boards.js
// (PANELS, THEMES, sideTheme, END_MARK, END_BELT_MARK, FLOOR_WORD; poddle NOTES 351, 388, 401, 406). Pure data: keep it in
// step with that file if the panels ever change (ids 1..32, each panel's fill and mark tone).

const THEMES = {
  far: { a: ["#0f7cb8", "#2a8dc5"], b: ["#1f69d7", "#3d80e0"], mark: "#549ad2" },
  warm: { a: ["#ff7a4d", "#ffa77e"], b: ["#ff9a3c", "#ffc48a"], mark: "#ffe6cf" },
  belt: { a: ["#2f8fea", "#7cc4f6"], b: ["#17a7b8", "#6fdcd6"], mark: "#ffffff" },
  beltFar: { a: ["#1e6fd9", "#3f8fe4"], b: ["#0f93a8", "#2fb4bc"], mark: "#5cc8d8" },
} as const;
const sideTheme = (i: number) => (i >= 1 && i <= 3 ? "warm" : "far");
const END_MARK = "#3a7fb8";
const END_BELT_MARK = "#4a8fd8";
const SPOT = ["north end", "north of the net", "at the net", "south of the net", "south end"];
const ENDSPOT = ["west", "middle", "east"];

export type Panel = { id: number; kind: "wall" | "end" | "belt"; wall: string; s: number; n: number; i: number; name: string; theme: string; fill: string; mark: string };

export const PANELS: Panel[] = [];
for (const [w, s] of [["East", 1], ["West", -1]] as const)
  for (let n = 1; n <= 5; n++) {
    const i = s > 0 ? n - 1 : 5 - n, th = sideTheme(i), T = THEMES[th];
    PANELS.push({ id: PANELS.length + 1, kind: "wall", wall: w.toLowerCase(), s, n, i, name: `${w} wall, panel ${n}: ${SPOT[n - 1]}`, theme: th, fill: (i % 2 ? T.b : T.a)[0], mark: T.mark });
  }
for (const [w, s] of [["North", -1], ["South", 1]] as const)
  for (let n = 1; n <= 3; n++) {
    const i = s > 0 ? 3 - n : n - 1, T = THEMES.far;
    PANELS.push({ id: PANELS.length + 1, kind: "end", wall: w.toLowerCase(), s, n, i, name: `${w} end wall, panel ${n}: ${ENDSPOT[n - 1]}`, theme: "far", fill: (i % 2 ? T.b : T.a)[0], mark: END_MARK });
  }
for (let n = 1; n <= 5; n++) {
  const T = THEMES.belt;
  PANELS.push({ id: PANELS.length + 1, kind: "belt", wall: "west", s: -1, n, i: n - 1, name: `West stand belt, panel ${n}`, theme: "belt", fill: (n % 2 ? T.a : T.b)[0], mark: T.mark });
}
for (let n = 1; n <= 5; n++) {
  const T = THEMES.belt;
  PANELS.push({ id: PANELS.length + 1, kind: "belt", wall: "east", s: 1, n, i: n - 1, name: `East stand belt, panel ${n}`, theme: "belt", fill: (n % 2 ? T.a : T.b)[0], mark: T.mark });
}
for (const [w, s] of [["North", -1], ["South", 1]] as const)
  for (let n = 1; n <= 3; n++) {
    const T = THEMES.beltFar;
    PANELS.push({ id: PANELS.length + 1, kind: "belt", wall: w.toLowerCase(), s, n, i: n - 1, name: `${w} stand belt, panel ${n}: ${ENDSPOT[n - 1]}`, theme: "far", fill: T.a[0], mark: END_BELT_MARK });
  }

export const panelName = (id: number) => PANELS.find((p) => p.id === id)?.name ?? `Panel ${id}`;

/** A mat's word: its colour, and its size in metres (the King of the Court logo box's shape). */
export const FLOOR_WORD = { col: "#ffe6cf", w: 3.75, d: 1.08 };
