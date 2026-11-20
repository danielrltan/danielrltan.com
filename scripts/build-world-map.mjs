// Builds src/stats/world.json: the /stats country map, pre-projected so the page
// needs no map library. Natural Earth 110m shapes (world-atlas, public domain),
// Natural Earth I projection, Antarctica dropped, paths keyed by ISO alpha-2.
// Countries too small for 110m become dots (50m centroids, plus a few overseas
// regions that sit inside France's shape).
// Run once from a scratch dir that has the tools (not repo deps):
//   npm i world-atlas@2.0.2 d3-geo@3.1.1 topojson-client@3.1.0
//   NODE_PATH=$PWD/node_modules node <repo>/scripts/build-world-map.mjs <repo>/src/stats/world.json
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(path.join(process.env.NODE_PATH ?? process.cwd(), "x.js"));
const { geoNaturalEarth1, geoPath } = require("d3-geo");
const { feature } = require("topojson-client");
const t110 = require("world-atlas/countries-110m.json");
const t50 = require("world-atlas/countries-50m.json");

// ISO 3166 numeric -> alpha-2. Features without an id are matched by name.
const NUM = {
  "004": "AF", "008": "AL", "010": "AQ", "012": "DZ", "016": "AS", "020": "AD", "024": "AO", "028": "AG", "031": "AZ", "032": "AR",
  "036": "AU", "040": "AT", "044": "BS", "048": "BH", "050": "BD", "051": "AM", "052": "BB", "056": "BE", "060": "BM", "064": "BT",
  "068": "BO", "070": "BA", "072": "BW", "076": "BR", "084": "BZ", "086": "IO", "090": "SB", "092": "VG", "096": "BN", "100": "BG",
  "104": "MM", "108": "BI", "112": "BY", "116": "KH", "120": "CM", "124": "CA", "132": "CV", "136": "KY", "140": "CF", "144": "LK",
  "148": "TD", "152": "CL", "156": "CN", "158": "TW", "170": "CO", "174": "KM", "178": "CG", "180": "CD", "184": "CK", "188": "CR",
  "191": "HR", "192": "CU", "196": "CY", "203": "CZ", "204": "BJ", "208": "DK", "212": "DM", "214": "DO", "218": "EC", "222": "SV",
  "226": "GQ", "231": "ET", "232": "ER", "233": "EE", "234": "FO", "238": "FK", "239": "GS", "242": "FJ", "246": "FI", "248": "AX",
  "250": "FR", "258": "PF", "260": "TF", "262": "DJ", "266": "GA", "268": "GE", "270": "GM", "275": "PS", "276": "DE", "288": "GH",
  "296": "KI", "300": "GR", "304": "GL", "308": "GD", "316": "GU", "320": "GT", "324": "GN", "328": "GY", "332": "HT", "334": "HM",
  "336": "VA", "340": "HN", "344": "HK", "348": "HU", "352": "IS", "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE",
  "376": "IL", "380": "IT", "384": "CI", "388": "JM", "392": "JP", "398": "KZ", "400": "JO", "404": "KE", "408": "KP", "410": "KR",
  "414": "KW", "417": "KG", "418": "LA", "422": "LB", "426": "LS", "428": "LV", "430": "LR", "434": "LY", "438": "LI", "440": "LT",
  "442": "LU", "446": "MO", "450": "MG", "454": "MW", "458": "MY", "462": "MV", "466": "ML", "470": "MT", "478": "MR", "480": "MU",
  "484": "MX", "492": "MC", "496": "MN", "498": "MD", "499": "ME", "500": "MS", "504": "MA", "508": "MZ", "512": "OM", "516": "NA",
  "520": "NR", "524": "NP", "528": "NL", "531": "CW", "533": "AW", "534": "SX", "540": "NC", "548": "VU", "554": "NZ", "558": "NI",
  "562": "NE", "566": "NG", "570": "NU", "574": "NF", "578": "NO", "580": "MP", "583": "FM", "584": "MH", "585": "PW", "586": "PK",
  "591": "PA", "598": "PG", "600": "PY", "604": "PE", "608": "PH", "612": "PN", "616": "PL", "620": "PT", "624": "GW", "626": "TL",
  "630": "PR", "634": "QA", "642": "RO", "643": "RU", "646": "RW", "652": "BL", "654": "SH", "659": "KN", "660": "AI", "662": "LC",
  "663": "MF", "666": "PM", "670": "VC", "674": "SM", "678": "ST", "682": "SA", "686": "SN", "688": "RS", "690": "SC", "694": "SL",
  "702": "SG", "703": "SK", "704": "VN", "705": "SI", "706": "SO", "710": "ZA", "716": "ZW", "724": "ES", "728": "SS", "729": "SD",
  "732": "EH", "740": "SR", "748": "SZ", "752": "SE", "756": "CH", "760": "SY", "762": "TJ", "764": "TH", "768": "TG", "776": "TO",
  "780": "TT", "784": "AE", "788": "TN", "792": "TR", "795": "TM", "796": "TC", "800": "UG", "804": "UA", "807": "MK", "818": "EG",
  "826": "GB", "831": "GG", "832": "JE", "833": "IM", "834": "TZ", "840": "US", "850": "VI", "854": "BF", "858": "UY", "860": "UZ",
  "862": "VE", "876": "WF", "882": "WS", "887": "YE", "894": "ZM",
};
const BY_NAME = { "N. Cyprus": "CY", Somaliland: "SO", Kosovo: "XK" };
// [cc, lon, lat]: regions DB-IP reports on their own but world-atlas folds into France.
const EXTRA = [["GF", -53.1, 3.9], ["GP", -61.55, 16.25], ["MQ", -61.0, 14.65], ["RE", 55.5, -21.1], ["YT", 45.15, -12.8], ["GI", -5.35, 36.14]];

const code = (f) => (f.id ? NUM[f.id] : BY_NAME[f.properties.name]);
const land = feature(t110, t110.objects.countries).features.filter((f) => code(f) && code(f) !== "AQ");
// Integer units in a 1600-wide box, written as relative moves: about a third of
// the bytes of d3's absolute decimals, same look at card size.
const W = 1600;
const proj = geoNaturalEarth1().fitWidth(W, { type: "FeatureCollection", features: land });
const pathGen = geoPath(proj);
const H = Math.ceil(pathGen.bounds({ type: "FeatureCollection", features: land })[1][1]);
function rel(f) {
  let d = "", px = 0, py = 0, sx = 0, sy = 0, n = 0;
  const num = (v) => (v < 0 ? String(v) : (d.length && /\d$/.test(d) ? " " : "") + v);
  geoPath(proj, {
    moveTo(x, y) {
      x = Math.round(x); y = Math.round(y);
      d += "m" + num(x - px); d += num(y - py);
      px = sx = x; py = sy = y; n = 0;
    },
    lineTo(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x === px && y === py) return;
      if (!n++) d += "l";
      d += num(x - px); d += num(y - py);
      px = x; py = y;
    },
    closePath() { d += "z"; px = sx; py = sy; },
  })(f);
  return d;
}

const shapes = {};
for (const f of land) {
  const cc = code(f);
  shapes[cc] = (shapes[cc] ?? "") + rel(f);
}
const dots = [];
for (const f of feature(t50, t50.objects.countries).features) {
  const cc = code(f);
  if (!cc || cc === "AQ" || shapes[cc] || dots.some((d) => d[0] === cc)) continue;
  const [x, y] = pathGen.centroid(f);
  if (Number.isFinite(x)) dots.push([cc, Math.round(x), Math.round(y)]);
}
for (const [cc, lon, lat] of EXTRA) {
  const [x, y] = proj([lon, lat]);
  dots.push([cc, Math.round(x), Math.round(y)]);
}
const out = process.argv[2];
writeFileSync(out, JSON.stringify({ w: W, h: H, shapes, dots }));
console.log(out, Object.keys(shapes).length, "shapes", dots.length, "dots", H, "high");
