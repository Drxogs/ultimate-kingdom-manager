import { MODULE_ID } from "../constants.js";
import { NONE, PINNACLE, trackStage } from "../realm/tracks.js";
import { ART_SIZES } from "./panorama-art.js";

/*
 * The settlement panorama: a far-off landscape view of a settlement, drawn as SVG from its tracks.
 * It starts as an empty field with a ring of huts round a tiny fire; by metropolis, spires and a
 * palace fill the frame. Proof-of-concept art: each track's stage is one small drawing at its own
 * spot, so commissioned pictures can replace these one at a time later.
 */

const W = 860;
const H = 230;
const GROUND = 178;
/** The sky above this is cropped off; the top of the tallest spire still fits. */
const TOP = 50;

const C = {
  wood: "#9c8466",
  thatch: "#c8a96a",
  roof: "#8a5a3c",
  roof2: "#6f4a35",
  wall: "#e8dcc4",
  wall2: "#d8c9a8",
  stone: "#b8b2a6",
  stoneDark: "#8f887c",
  slate: "#5b6f86",
  gold: "#c9a24a",
  fire: "#e2702d",
  smoke: "#a9b0b3",
  cloth: "#a8322b",
  green: "#3f7a3a"
};

const TERRAIN = {
  plains: { sky: "#cfe3ee", far: "#a9c3b0", mid: "#b9cf95", near: "#a8c47f" },
  forest: { sky: "#cbdfe6", far: "#7f9f82", mid: "#7fa36a", near: "#8fb36f", trees: "#4f7a4a" },
  hills: { sky: "#d3e2ea", far: "#9fb79a", mid: "#aec58a", near: "#a3bd78", hilly: true },
  mountains: { sky: "#d7e3ec", far: "#9aa6ae", mid: "#a9bf8e", near: "#9fbb7a", peaks: "#8b97a0", snow: "#f1f4f6" },
  swamp: { sky: "#cdd9d4", far: "#93a68f", mid: "#9aae7e", near: "#8ea36f", pools: "#7f9fa3" }
};

function terrainKey(terrain) {
  const t = String(terrain ?? "").toLowerCase();
  if (t.includes("forest") || t.includes("wood")) return "forest";
  if (t.includes("mountain")) return "mountains";
  if (t.includes("hill")) return "hills";
  if (t.includes("swamp") || t.includes("marsh") || t.includes("bog")) return "swamp";
  return "plains";
}

function seeded(seedText) {
  let seed = 7;
  for (const ch of String(seedText)) seed = (seed * 31 + ch.charCodeAt(0)) % 233280;
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/* ---------- small drawing helpers (each returns SVG markup) ---------- */

const rect = (x, y, w, h, fill) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`;
const poly = (points, fill) => `<polygon points="${points.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" fill="${fill}"/>`;
const circle = (x, y, r, fill) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}"/>`;

function hut(x, y, s) {
  return rect(x - 2 * s, y - 2 * s, 4 * s, 2 * s, C.wood) + poly([[x - 2.7 * s, y - 2 * s], [x, y - 4.4 * s], [x + 2.7 * s, y - 2 * s]], C.thatch);
}

function house(x, y, w, h, wall = C.wall, roof = C.roof) {
  return rect(x, y - h, w, h, wall) + poly([[x - 0.6, y - h], [x + w / 2, y - h - w * 0.5], [x + w + 0.6, y - h]], roof);
}

function tower(x, y, w, h, top = C.slate, body = C.stone) {
  return rect(x - w / 2, y - h, w, h, body) + poly([[x - w / 2 - 1, y - h], [x, y - h - w * 1.8], [x + w / 2 + 1, y - h]], top);
}

function flag(x, y, h, color = C.cloth) {
  return rect(x, y - h, 0.9, h, C.stoneDark) + poly([[x + 0.9, y - h], [x + 6, y - h + 2], [x + 0.9, y - h + 4]], color);
}

function fire(x, y, s = 1) {
  return circle(x, y - 1, 1.6 * s, C.fire) + `<path d="M${x} ${y - 2} q1 -4 0 -7 q-1 -3 1 -6" fill="none" stroke="${C.smoke}" stroke-width="0.8"/>`;
}

/* ---------- terrain ---------- */

function terrain(key, rnd, waterside) {
  const t = TERRAIN[key];
  let out = rect(0, 0, W, H, t.sky);
  if (t.peaks) {
    out += poly([[0, 124], [90, 68], [170, 110], [260, 60], [360, 114], [470, 72], [560, 116], [660, 64], [760, 106], [860, 74], [860, 150], [0, 150]], t.peaks);
    for (const [x, y] of [[90, 68], [260, 60], [470, 72], [660, 64]]) out += poly([[x - 14, y + 14], [x, y], [x + 14, y + 14]], t.snow);
  }
  out += `<path d="M0 ${t.hilly ? 128 : 140} Q120 ${t.hilly ? 92 : 112} 240 132 T480 ${t.hilly ? 110 : 126} T720 118 T860 134 L860 ${H} L0 ${H}Z" fill="${t.far}"/>`;
  if (t.trees) {
    for (let x = 0; x < W; x += 7 + rnd() * 6) {
      const y = 132 + Math.sin(x / 70) * 8 + rnd() * 4;
      out += poly([[x - 4, y + 6], [x, y - 7 - rnd() * 5], [x + 4, y + 6]], t.trees);
    }
  }
  out += `<path d="M0 156 Q160 ${t.hilly ? 136 : 146} 330 158 T660 150 T860 156 L860 ${H} L0 ${H}Z" fill="${t.mid}"/>`;
  out += `<path d="M0 182 Q200 172 430 180 T860 176 L860 ${H} L0 ${H}Z" fill="${t.near}"/>`;
  if (t.pools) for (let i = 0; i < 9; i++) out += `<ellipse cx="${(rnd() * W).toFixed(1)}" cy="${(190 + rnd() * 30).toFixed(1)}" rx="${(14 + rnd() * 24).toFixed(1)}" ry="${(2 + rnd() * 2).toFixed(1)}" fill="${t.pools}"/>`;
  if (waterside) out += `<path d="M0 214 Q220 196 430 206 T860 198 L860 ${H} L0 ${H}Z" fill="#8fb8cf"/><path d="M0 222 Q240 210 430 216 T860 210" fill="none" stroke="#b9d5e4" stroke-width="1.2"/>`;
  return out;
}

/* ---------- the tracks ---------- */

/** Where each track sits, as a fraction of the town's spread (−1 left … 1 right) and a depth row. */
const PLOTS = {
  faith: { x: -0.55, back: 1 },
  governance: { x: 0.05, back: 2 },
  learning: { x: 0.5, back: 2 },
  performance: { x: 0.72, back: 0 },
  commerce: { x: -0.08, back: -1 },
  industry: { x: 0.92, back: 1 },
  watch: { x: -0.32, back: -1 },
  army: { x: -0.9, back: 0 },
  publicworks: { x: 0.3, back: -1 },
  food: { x: 0.14, back: 0 }
};

function drawHomes(stage, cx, spread, rnd) {
  if (stage === NONE) return "";
  if (stage === 0) {
    let out = fire(cx, GROUND + 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out += hut(cx + Math.cos(a) * 15, GROUND + 2 + Math.sin(a) * 4, 1.1);
    }
    return out;
  }
  const rows = [0, 3, 5, 7][stage];
  const tint = stage === 1 ? [C.wall2, C.wood] : [C.wall, C.wall2];
  let out = "";
  for (let r = 0; r < rows; r++) {
    const y = GROUND + 8 - r * 5;
    const half = spread * (1 - r / (rows + 2));
    for (let x = cx - half; x < cx + half; x += 4 + rnd() * 4) {
      if (rnd() < 0.8) out += house(x, y + rnd() * 2, 3 + rnd() * 3, 3 + rnd() * 2 + (stage > 2 ? rnd() * 3 : 0), tint[Math.floor(rnd() * 2)], rnd() < 0.3 ? C.roof2 : C.roof);
    }
  }
  return out;
}

function drawWalls(stage, cx, spread) {
  if (stage === NONE) return "";
  const left = cx - spread - 8;
  const right = cx + spread + 8;
  const base = GROUND + 11;
  if (stage === 0) {
    let out = "";
    for (let x = left; x <= right; x += 3) out += poly([[x, base], [x + 1, base - 5], [x + 2, base]], C.wood);
    return out;
  }
  // A wall across the front of the town: earth bank, then stone, then a double wall with a keep.
  const h = [0, 2.5, 4.5, 6.5][stage];
  const color = stage === 1 ? "#8d7a55" : C.stone;
  let out = stage === 1 ? `<path d="M${left} ${base} Q${cx} ${base - 2 * h} ${right} ${base}Z" fill="${color}"/>` : rect(left, base - h, right - left, h, color);
  if (stage >= 2) {
    for (let x = left; x < right; x += 4) out += rect(x, base - h - 1.2, 2, 1.2, color);
    for (const x of [left, right, cx - spread * 0.5, cx + spread * 0.5]) out += tower(x, base, 5, h + 7, C.slate, color);
  }
  if (stage === 3) out += tower(cx - spread * 0.8, GROUND - 6, 9, 24, C.slate, C.stone) + flag(cx - spread * 0.8, GROUND - 46, 8);
  return out;
}

function drawTrack(trackId, stage, x, y) {
  const s = stage;
  switch (trackId) {
    case "faith":
      if (s === 0) return rect(x, y - 6, 1.2, 6, C.wood) + circle(x + 0.6, y - 7, 1.4, C.gold);
      if (s === 1) return house(x - 4, y, 8, 6, C.wall2, C.roof2) + tower(x + 3, y, 3, 8, C.roof2, C.wall2);
      if (s === 2) return rect(x - 10, y - 12, 20, 12, C.stone) + poly([[x - 11, y - 12], [x, y - 20], [x + 11, y - 12]], C.stoneDark) + tower(x + 8, y, 5, 18);
      return rect(x - 16, y - 18, 32, 18, C.stone) + tower(x - 12, y - 4, 7, 26) + tower(x + 12, y - 4, 7, 26) + tower(x, y, 9, 40) + circle(x, y - 12, 2.5, C.gold);
    case "governance":
      if (s === 0) return rect(x - 3, y - 2, 6, 2, C.wood);
      if (s === 1) return rect(x - 12, y - 6, 24, 6, C.wood) + poly([[x - 13, y - 6], [x, y - 11], [x + 13, y - 6]], C.thatch);
      if (s === 2) return house(x - 10, y, 20, 12, C.stone, C.slate) + tower(x, y - 12, 5, 12, C.slate, C.stone);
      return rect(x - 26, y - 26, 52, 26, C.wall) + tower(x - 22, y - 2, 9, 34) + tower(x + 22, y - 2, 9, 34) + tower(x, y - 26, 12, 22) + flag(x, y - 70, 10, C.gold);
    case "learning":
      if (s === 0) return hut(x, y, 1.3) + circle(x + 4, y - 2, 1, "#6a8f5a");
      if (s === 1) return house(x - 6, y, 12, 9, C.wall2, C.slate);
      if (s === 2) return house(x - 10, y, 20, 12, C.wall, C.slate) + tower(x + 10, y, 5, 22);
      return tower(x - 10, y, 8, 34, "#4a5f9a") + tower(x + 6, y, 7, 28, "#4a5f9a") + rect(x - 16, y - 12, 32, 12, C.stone);
    case "performance":
      if (s === 0) return circle(x, y - 1, 1.2, C.fire) + circle(x - 3, y, 1, C.wood) + circle(x + 3, y, 1, C.wood);
      if (s === 1) return rect(x, y - 10, 1, 10, C.wood) + poly([[x - 6, y], [x + 0.5, y - 10], [x + 7, y]], "#d9c26a");
      if (s === 2) return house(x - 9, y, 18, 10, C.wall, C.cloth);
      return `<ellipse cx="${x}" cy="${y - 8}" rx="18" ry="9" fill="${C.stone}"/><ellipse cx="${x}" cy="${y - 10}" rx="12" ry="5" fill="${C.wall2}"/>` + flag(x, y - 17, 8, C.gold);
    case "commerce":
      if (s === 0) return rect(x - 5, y - 5, 10, 5, C.wood) + poly([[x - 6, y - 5], [x, y - 8], [x + 6, y - 5]], C.thatch);
      if (s === 1) return [0, 7, 14].map((d) => rect(x - 10 + d, y - 4, 5, 4, C.wall2) + poly([[x - 11 + d, y - 4], [x - 7.5 + d, y - 7], [x - 4 + d, y - 4]], C.cloth)).join("");
      if (s === 2) return rect(x - 16, y - 8, 32, 8, C.wall2) + poly([[x - 17, y - 8], [x, y - 14], [x + 17, y - 8]], "#b36a3a");
      return rect(x - 20, y - 12, 40, 12, C.wall) + `<path d="M${x - 20} ${y - 12} Q${x} ${y - 30} ${x + 20} ${y - 12}Z" fill="#9fc3d6"/>`;
    case "industry":
      if (s === 0) return rect(x - 4, y - 2, 8, 2, C.wood) + rect(x - 3, y - 4, 6, 2, C.wood);
      if (s === 1) return house(x - 6, y, 12, 6, C.wood, C.roof2) + rect(x + 4, y - 12, 2, 6, C.stoneDark);
      if (s === 2) return [0, 9].map((d) => house(x - 9 + d, y, 8, 7, C.wall2, C.roof2)).join("") + rect(x + 6, y - 16, 2, 9, C.stoneDark);
      return rect(x - 14, y - 12, 28, 12, C.stoneDark) + rect(x - 8, y - 26, 3, 14, "#555") + rect(x + 4, y - 24, 3, 12, "#555") + circle(x - 6, y - 29, 3, C.smoke) + circle(x + 6, y - 27, 3, C.smoke);
    case "watch":
      if (s === 0) return rect(x, y - 7, 0.8, 7, C.wood) + circle(x + 0.4, y - 7.5, 1.1, "#f0d070");
      if (s === 1) return house(x - 4, y, 8, 6, C.wood, C.roof2);
      if (s === 2) return house(x - 6, y, 12, 8, C.stone, C.slate) + rect(x + 6, y - 6, 4, 6, C.stoneDark);
      return rect(x - 12, y - 12, 24, 12, C.stone) + poly([[x - 13, y - 12], [x, y - 20], [x + 13, y - 12]], C.slate) + [-8, -2, 4, 10].map((d) => rect(x + d - 1, y - 11, 1.5, 10, C.wall)).join("");
    case "army":
      if (s === 0) return [-5, 0, 5].map((d) => rect(x + d, y - 4, 0.6, 4, C.wood)).join("");
      if (s === 1) return [-6, 2].map((d) => house(x + d, y, 7, 4, C.wall2, C.roof2)).join("");
      if (s === 2) return rect(x - 12, y - 8, 24, 8, C.stone) + house(x - 8, y - 8, 16, 5, C.wall2, C.roof2) + flag(x + 10, y - 8, 7);
      return rect(x - 16, y - 14, 32, 14, C.stone) + tower(x - 12, y - 14, 6, 10) + tower(x + 12, y - 14, 6, 10) + flag(x, y - 26, 10, C.cloth);
    case "publicworks":
      if (s === 0) return circle(x, y - 1, 2, C.stoneDark) + rect(x - 2.5, y - 4, 5, 0.8, C.wood);
      if (s === 1) return `<path d="M${x - 20} ${y + 1} L${x + 20} ${y - 1}" stroke="${C.stone}" stroke-width="2"/>`;
      if (s === 2) return [0, 9, 18, 27].map((d) => rect(x - 18 + d, y - 12, 2, 12, C.stone) + `<path d="M${x - 16 + d} ${y - 12} Q${x - 12 + d} ${y - 6} ${x - 9 + d} ${y - 12}" fill="none" stroke="${C.stone}" stroke-width="2"/>`).join("") + rect(x - 18, y - 14, 38, 2, C.stone);
      return [-14, -4, 6, 16].map((d) => rect(x + d, y - 10, 0.8, 10, "#555") + circle(x + d + 0.4, y - 10.5, 1.3, "#f6e27a")).join("");
    case "food":
      if (s === 0) return fire(x, y, 0.8);
      if (s === 1) return house(x - 4, y, 8, 5, C.wood, C.thatch);
      if (s === 2) return house(x - 6, y, 12, 8, C.wall2, C.roof) + rect(x + 6, y - 6, 3, 1.5, C.gold);
      return house(x - 9, y, 18, 11, C.wall, C.roof2) + house(x - 4, y - 11, 8, 5, C.wall, C.roof2) + rect(x + 9, y - 8, 4, 2, C.gold);
    default:
      return "";
  }
}

/** Pinnacles stand on the edges of the view, big, with a gold banner. */
function drawPinnacle(trackId, x, y) {
  return drawTrack(trackId, 3, x, y).replace(/<\/?g[^>]*>/g, "") + flag(x, y - 48, 12, C.gold);
}

/**
 * The SVG for one settlement.
 * settlement: the realm record (tracks, pinnacles, waterside, id); terrain: the hex's terrain if known.
 */
function renderPanoramaSvg(settlement, { terrain: terrainName = null, title = "" } = {}) {
  const rnd = seeded(settlement.id ?? settlement.name ?? "x");
  const key = terrainKey(terrainName);
  const homes = trackStage(settlement, "homes");
  const spread = [24, 24, 55, 120, 260][homes + 1];
  // Nearer for small places, so a town reads as a town; the metropolis fills the frame.
  const zoom = [1.8, 1.8, 1.7, 1.4, 1.15][homes + 1];
  const cx = W / 2;
  let art = terrain(key, rnd, !!settlement.waterside);
  let town = "";
  // Far things first (back rows), then homes, then the near rows and the walls.
  const plotted = Object.entries(PLOTS)
    .map(([trackId, plot]) => ({ trackId, plot, stage: trackStage(settlement, trackId) }))
    .filter((p) => p.stage !== NONE)
    .sort((a, b) => b.plot.back - a.plot.back);
  const place = ({ plot }) => ({ x: cx + plot.x * (spread + 12), y: GROUND - plot.back * 6 + (homes <= 0 ? 4 : 0) });
  for (const p of plotted.filter((q) => q.plot.back > 0)) {
    const { x, y } = place(p);
    town += drawTrack(p.trackId, p.stage, x, y);
  }
  town += drawHomes(homes, cx, spread, rnd);
  for (const p of plotted.filter((q) => q.plot.back <= 0)) {
    const { x, y } = place(p);
    town += drawTrack(p.trackId, p.stage, x, y);
  }
  town += drawWalls(trackStage(settlement, "walls"), cx, spread);
  art += `<g transform="translate(${cx} ${GROUND}) scale(${zoom}) translate(${-cx} ${-GROUND})">${town}</g>`;
  (settlement.pinnacles ?? []).forEach((trackId, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side < 0 ? 70 + i * 40 : W - 70 - i * 40;
    art += drawPinnacle(trackId, x, GROUND + 2);
  });
  return `<svg class="ukm-panorama-svg" viewBox="0 ${TOP} ${W} ${H - TOP}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${art}</svg>`;
}

/*
 * The pixel-art panorama. Sprites from art/panorama sit on a 576 x 120 grid, one art pixel per grid
 * pixel, ground line at y 92, each standing on its bottom edge. Every sprite is a CSS background on an
 * absolutely placed box sized in percent of the grid, so the whole picture scales with the sheet and
 * stays pixel-sharp. The old SVG drawing sits underneath: if the art files are missing, the boxes stay
 * empty and the drawing shows through.
 */
const PX_W = 576;
const PX_H = 120;
export const PX_GROUND = 92;
/** Close-ups by Homes stage (none, huts, tenements, ...): how much to enlarge and the top row shown. */
const PX_VIEW = [{ zoom: 2, top: 44 }, { zoom: 2, top: 44 }, { zoom: 1.6, top: 26 }, { zoom: 1, top: 0 }, { zoom: 1, top: 0 }];
const artUrl = (name) => `modules/${MODULE_ID}/art/panorama/${name}.png`;
const pct = (v, of) => `${+((v / of) * 100).toFixed(4)}%`;

/** One sprite box. x and y are grid pixels: x is the left edge, y the bottom edge. */
export function pxSprite(name, x, y, { flip = false, cls = "" } = {}) {
  const size = ART_SIZES[name];
  if (!size) return "";
  const [w, h] = size;
  const style = [
    `left:${pct(Math.round(x), PX_W)}`,
    `top:${pct(Math.round(y) - h, PX_H)}`,
    `width:${pct(w, PX_W)}`,
    `height:${pct(h, PX_H)}`,
    `background-image:url('${artUrl(name)}')`
  ];
  if (flip) style.push("transform:scaleX(-1)");
  return `<i class="ukm-px${cls ? ` ${cls}` : ""}" style="${style.join(";")}"></i>`;
}

/** Villages are shown at 2x, towns at 1.6x, cities and metropolises whole. */
export function pxView(settlement) {
  return PX_VIEW[trackStage(settlement, "homes") + 1] ?? PX_VIEW[0];
}

/** The far layer: the terrain's background and, for a waterside settlement, the river along the bottom. */
function pxBackdrop(settlement, key) {
  let out = pxSprite(`bg-${key}`, 0, PX_H, { cls: "ukm-px-bg" });
  if (settlement.waterside) out += pxSprite("water", 0, PX_H, { cls: "ukm-px-water" });
  return out;
}

/** How far either side of the middle the track buildings spread, by Homes stage (none, huts..boroughs). */
const PX_SPREAD = [56, 56, 110, 170, 236];
/** Rows up from the ground line for each plot depth: back rows stand higher so they show over the houses. */
const PX_DEPTH = { 2: 12, 1: 6, 0: 0, [-1]: -4 };
/** Back rows stand higher still in big places, where the houses are taller and deeper. */
const PX_DEPTH_SCALE = [1, 1, 1, 1.3, 1.6];

/** Where a track's building stands: its left edge and ground row on the grid. */
export function pxPlot(settlement, trackId, stage) {
  const plot = PLOTS[trackId];
  const homes = trackStage(settlement, "homes");
  const [w] = ART_SIZES[`${trackId}-${stage}`] ?? [0];
  const cx = PX_W / 2 + plot.x * PX_SPREAD[homes + 1];
  const depth = (PX_DEPTH[plot.back] ?? 0) * (plot.back > 0 ? PX_DEPTH_SCALE[homes + 1] : 1);
  return { x: Math.round(cx - w / 2), y: PX_GROUND - Math.round(depth) };
}

/**
 * House rows by Homes stage (huts, tenements, neighborhoods, boroughs): how many rows, how far they reach
 * (share of the spread), rows between them, pixels each house overlaps the next (negative leaves a gap)
 * and the chance of an empty plot, which grows toward the ends of a row.
 */
const PX_HOMES = [
  { rows: 1, rise: 0, overlap: 1, gap: 0.12 },
  { rows: 2, rise: 5, overlap: 1, gap: 0.1 },
  { rows: 3, rise: 6, overlap: 3, gap: 0.08 },
  { rows: 3, rise: 8, overlap: 2, gap: 0.05 }
];

/**
 * The houses: rows of the Homes stage's house sprites across the town's whole width, seeded per
 * settlement so a place keeps its look. The front row never breaks, so everything standing behind it
 * (raised back-row buildings, the keep, pinnacles) sits on rooftops rather than floating. Back rows
 * leave room in front of the big buildings so they show.
 */
export function pxHomes(settlement, { left = PX_W / 2 - 40, right = PX_W / 2 + 40, keepClear = [] } = {}) {
  const homes = Math.min(trackStage(settlement, "homes"), 3);
  if (homes === NONE) return "";
  const shape = PX_HOMES[homes];
  const rnd = seeded(`${settlement.id ?? settlement.name ?? "x"}:px-homes`);
  const names = Object.keys(ART_SIZES).filter((n) => n.startsWith(`homes-${homes}-`));
  const mid = PX_W / 2;
  let out = "";
  // Back rows first; each stands a little higher and stops a little short of the ends.
  for (let r = shape.rows - 1; r >= 0; r--) {
    const from = Math.round(left + (mid - left) * 0.08 * r);
    const to = Math.round(right - (right - mid) * 0.08 * r);
    const y = PX_GROUND + 2 - r * shape.rise;
    let x = from - Math.floor(rnd() * 4);
    while (x < to) {
      const name = names[Math.floor(rnd() * names.length)];
      const [w] = ART_SIZES[name];
      const blocked = r > 0 && keepClear.some(([a, b]) => x + w / 2 > a && x + w / 2 < b);
      if (blocked || (r > 0 && rnd() < shape.gap)) {
        x += Math.round(w * 0.7);
        continue;
      }
      out += pxSprite(name, Math.min(x, to - w + 3), y + Math.floor(rnd() * 2), { cls: "ukm-px-home" });
      x += w - shape.overlap + (r > 0 || shape.overlap < 0 ? Math.floor(rnd() * 3) : 0);
    }
  }
  return out;
}

/** The track buildings: their markup in drawing order, with where each stands. */
function pxTracks(settlement) {
  return Object.keys(PLOTS)
    .map((trackId) => ({ trackId, stage: Math.min(trackStage(settlement, trackId), 3), back: PLOTS[trackId].back }))
    .filter((p) => p.stage !== NONE)
    .sort((a, b) => b.back - a.back)
    .map(({ trackId, stage, back }) => {
      const { x, y } = pxPlot(settlement, trackId, stage);
      const [w] = ART_SIZES[`${trackId}-${stage}`] ?? [0];
      return { back, x, w, html: pxSprite(`${trackId}-${stage}`, x, y, { cls: `ukm-px-${trackId}` }) };
    });
}

/** The wall's ground row: across the front of the town, in front of everything else. */
const PX_WALL_Y = PX_GROUND + 8;

/** The keep of a stage 3 wall, which stands with the back row on the left of the town. */
function pxKeep(settlement) {
  if (Math.min(trackStage(settlement, "walls"), 3) !== 3) return null;
  const homes = trackStage(settlement, "homes");
  const x = Math.round(PX_W / 2 - (PX_SPREAD[homes + 1] + 14) * 0.8 - 16);
  const y = PX_GROUND - Math.round(6 * PX_DEPTH_SCALE[homes + 1]);
  return { x, w: ART_SIZES["walls-3-keep"][0], html: pxSprite("walls-3-keep", x, y, { cls: "ukm-px-keep" }) };
}

/**
 * The walls by stage across the front of the town, from left to right: palisade, earth-and-timber wall
 * with end caps, stone wall with towers, citadel wall with taller towers.
 */
export function pxWalls(settlement, { left, right } = {}) {
  const stage = Math.min(trackStage(settlement, "walls"), 3);
  if (stage === NONE) return "";
  const half = PX_SPREAD[trackStage(settlement, "homes") + 1] + 14;
  left = Math.round(left ?? PX_W / 2 - half);
  right = Math.round(right ?? PX_W / 2 + half);
  const tile = `walls-${stage}-tile`;
  const [tw] = ART_SIZES[tile];
  let wall = "";
  for (let x = left; x < right; x += tw) wall += pxSprite(tile, Math.min(x, right - tw), PX_WALL_Y, { cls: "ukm-px-wall" });
  if (stage === 1) {
    wall += pxSprite("walls-1-cap-left", left - ART_SIZES["walls-1-cap-left"][0] + 2, PX_WALL_Y, { cls: "ukm-px-wall" });
    wall += pxSprite("walls-1-cap-right", right - 2, PX_WALL_Y, { cls: "ukm-px-wall" });
  }
  if (stage >= 2) {
    const tower = `walls-${stage}-tower`;
    const [ow] = ART_SIZES[tower];
    // A tower at each end and about every 120 pixels between.
    const gaps = Math.max(1, Math.round((right - left) / 120));
    for (let i = 0; i <= gaps; i++) {
      const x = left + ((right - left) * i) / gaps;
      wall += pxSprite(tower, x - ow / 2, PX_WALL_Y + 1, { cls: "ukm-px-tower" });
    }
  }
  return wall;
}

/** The landmarks: pinnacles stand toward the edges of the view, alternating left and right, at the town's ends. */
function pxPinnacleList(settlement) {
  const { zoom } = pxView(settlement);
  const edge = PX_W / 2 - PX_W / (2 * zoom);
  return (settlement.pinnacles ?? []).map((trackId, i) => {
    const name = `${trackId}-pinnacle`;
    if (!ART_SIZES[name]) return null;
    const [w] = ART_SIZES[name];
    const step = Math.floor(i / 2) * 60;
    const x = Math.round(i % 2 === 0 ? edge + 6 + step : PX_W - edge - 6 - w - step);
    return { x, w, html: pxSprite(name, x, PX_GROUND + 3, { cls: "ukm-px-pinnacle" }) };
  }).filter(Boolean);
}

export function pxPinnacles(settlement) {
  return pxPinnacleList(settlement).map((p) => p.html).join("");
}

/**
 * Lays the town out: the houses and the wall reach from the leftmost thing in town to the rightmost,
 * so nothing stands off on its own.
 */
export function pxTown(settlement) {
  const tracks = pxTracks(settlement);
  const keep = pxKeep(settlement);
  const pinnacles = pxPinnacleList(settlement);
  const things = [...tracks, ...pinnacles, ...(keep ? [keep] : [])];
  const { zoom } = pxView(settlement);
  const viewLeft = PX_W / 2 - PX_W / (2 * zoom);
  const homes = trackStage(settlement, "homes");
  const base = PX_SPREAD[homes + 1] * 0.6;
  let left = Math.min(PX_W / 2 - base, ...things.map((t) => t.x - 4));
  let right = Math.max(PX_W / 2 + base, ...things.map((t) => t.x + t.w + 4));
  left = Math.max(left, viewLeft + 2);
  right = Math.min(right, PX_W - viewLeft - 2);
  const keepClear = [...tracks.filter((t) => t.back > 0), ...pinnacles, ...(keep ? [keep] : [])]
    .map((t) => [t.x + 2, t.x + t.w - 2]);
  return {
    left,
    right,
    html: pinnacles.map((p) => p.html).join("") + (keep?.html ?? "")
      + tracks.filter((t) => t.back > 0).map((t) => t.html).join("")
      + pxHomes(settlement, { left, right, keepClear })
      + tracks.filter((t) => t.back <= 0).map((t) => t.html).join("")
      + pxWalls(settlement, { left: left + 2, right: right - 2 })
  };
}

/**
 * The panorama for one settlement.
 * settlement: the realm record (tracks, pinnacles, waterside, id); terrain: the hex's terrain if known.
 */
export function renderPanorama(settlement, { terrain: terrainName = null, title = "" } = {}) {
  const key = terrainKey(terrainName);
  const { zoom, top } = pxView(settlement);
  // The stage is the whole grid enlarged; shift it so the middle columns and the chosen rows fill the frame.
  const stage = `left:${pct(-(zoom - 1) * PX_W / 2, PX_W)};top:${pct(-top * zoom, PX_H)};width:${pct(zoom * PX_W, PX_W)};height:${pct(zoom * PX_H, PX_H)}`;
  const layers = pxBackdrop(settlement, key) + pxTown(settlement).html;
  const label = Handlebars.escapeExpression(title || settlement.name || "");
  return `<div class="ukm-panorama-px" role="img" aria-label="${label}" data-terrain="${key}" data-zoom="${zoom}">`
    + renderPanoramaSvg(settlement, { terrain: terrainName, title })
    + `<div class="ukm-px-stage" style="${stage}">${layers}</div></div>`;
}

export { PINNACLE };
