import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { renderPanorama, pxSprite, pxView } = await import(`${R}/apps/panorama.js`);
const { ART_SIZES } = await import(`${R}/apps/panorama-art.js`);
const fs = await import("node:fs");
void env;

const files = fs.readdirSync("/home/claude/ukm-repo/art/panorama").filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
ok(files.length === Object.keys(ART_SIZES).length && files.every((f) => ART_SIZES[f]), `size table matches art folder (${files.length})`);

const village = { id: "v1", name: "Oleg's", tracks: { homes: 0 }, pinnacles: [] };
const city = { id: "c1", name: "Big <City>", tracks: { homes: 2 }, pinnacles: [], waterside: true };
ok(pxView(village).zoom === 2 && pxView({ tracks: { homes: 1 } }).zoom === 1.6 && pxView(city).zoom === 1, "villages 2x, towns 1.6x, cities 1x");

const v = renderPanorama(village, { terrain: "forest" });
const c = renderPanorama(city, { terrain: "Mountain" });
ok(v.includes("art/panorama/bg-forest.png") && !v.includes("water.png"), "village: forest background, no river");
ok(v.includes('data-zoom="2"') && v.includes("left:-50%;top:-73.3333%;width:200%;height:200%"), "village stage drawn at 2x, cropped to the middle");
ok(c.includes("left:0%;top:0%;width:100%;height:100%"), "city stage drawn whole");
ok(v.includes("<svg"), "old drawing kept underneath as fallback");

ok(c.includes("bg-mountains.png") && c.includes("water.png"), "city: mountain background and river");
ok(c.includes('aria-label="Big &#60;City&#62;"'), "label escaped");
ok(renderPanorama(city, {}).includes("bg-plains.png"), "unknown terrain falls back to plains");

const s = pxSprite("faith-2", 100, 92);
const [fw, fh] = ART_SIZES["faith-2"];
ok(s.includes("left:17.3611%") && s.includes(`top:${+(((92 - fh) / 120) * 100).toFixed(4)}%`) && s.includes(`width:${+((fw / 576) * 100).toFixed(4)}%`), "sprite stands on its bottom edge at grid position");
ok(pxSprite("nope", 0, 0) === "", "unknown sprite draws nothing");

const { pxPlot } = await import(`${R}/apps/panorama.js`);
const busy = { id: "t1", tracks: { homes: 2, faith: 2, governance: 3, commerce: 1, army: 0, food: 3, learning: 2, industry: 1, watch: 2, publicworks: 2, performance: 1 } };
const b = renderPanorama(busy, { terrain: "plains" });
ok(["faith-2", "governance-3", "commerce-1", "army-0", "food-3", "publicworks-2"].every((n) => b.includes(`/${n}.png`)), "every built track drawn at its stage");
ok(b.indexOf("governance-3") < b.indexOf("faith-2") && b.indexOf("faith-2") < b.indexOf("commerce-1"), "far rows drawn before near rows");
ok(!renderPanorama({ id: "e", tracks: { homes: 0 } }).includes("faith-"), "unbuilt tracks not drawn");
const gp = pxPlot(busy, "governance", 3), cp = pxPlot(busy, "commerce", 1);
ok(gp.y < cp.y && cp.y <= 92, `back rows stand highest (${gp.y}), near rows just behind the front houses (${cp.y})`);
const vx = pxPlot({ tracks: { homes: 0 } }, "army", 0).x;
ok(vx >= 144 && vx + 20 <= 432, `village buildings inside the 2x crop (army at ${vx})`);
const tx = pxPlot({ tracks: { homes: 1 } }, "industry", 2).x, tg = pxPlot({ tracks: { homes: 1 } }, "governance", 2);
ok(tx + 32 <= 288 + 180 && tg.y - 48 >= 26, `town buildings inside the 1.6x crop (industry right edge ${tx + 32}, governance top ${tg.y - 48})`);
const mx = pxPlot({ tracks: { homes: 3 } }, "industry", 3).x;
ok(mx >= 0 && mx + 48 <= 576, `metropolis buildings inside the frame (industry at ${mx})`);

const { pxHomes } = await import(`${R}/apps/panorama.js`);
const count = (h) => (h.match(/ukm-px-home/g) ?? []).length;
const hv = pxHomes({ id: "h", tracks: { homes: 0 } }), hm = pxHomes({ id: "h", tracks: { homes: 3 } });
ok(count(hv) >= 2 && count(hv) <= 8 && hv.includes("homes-0-a"), `village: a row of huts (${count(hv)})`);
const wide = { left: 100, right: 476 };
const cnt = (h) => count(pxHomes({ id: "h", tracks: { homes: h } }, wide));
ok(cnt(3) > cnt(1) && cnt(2) > cnt(1) && cnt(1) > cnt(0), `bigger places, more houses over the same width (${[0, 1, 2, 3].map(cnt).join(", ")})`);
ok(pxHomes({ id: "h", tracks: { homes: 2 } }) === pxHomes({ id: "h", tracks: { homes: 2 } }), "same settlement, same houses");
ok(pxHomes({ id: "h", tracks: { homes: 2 } }) !== pxHomes({ id: "k", tracks: { homes: 2 } }), "different settlements, different houses");
ok(pxHomes({ id: "h", tracks: {} }) === "", "no Homes, no houses");
const hb = renderPanorama({ id: "q", tracks: { homes: 2, governance: 2, commerce: 2 } });
ok(hb.indexOf("commerce-2") < hb.indexOf("ukm-px-home") && hb.indexOf("governance-2") < hb.indexOf("ukm-px-home"), "houses drawn over every building");
const hw = renderPanorama({ id: "q", tracks: { homes: 0, walls: 0, food: 0, army: 0 } });
ok(hw.lastIndexOf("ukm-px-home") < hw.indexOf("walls-0-tile") && hw.indexOf("food-0") < hw.indexOf("ukm-px-home"), "village: campfire behind the huts, palisade in front");
const lefts = [...hm.matchAll(/left:([\d.-]+)%/g)].map((m) => Number(m[1]));
ok(lefts.every((l) => l >= 0 && l <= 100), "metropolis houses stay in frame");

const { pxWalls, pxPinnacles, pxTown } = await import(`${R}/apps/panorama.js`);
ok(pxWalls({ tracks: { homes: 1 } }) === "", "no walls, no wall");
const w0 = pxWalls({ tracks: { homes: 0, walls: 0 } });
ok(w0.includes("walls-0-tile") && !w0.includes("tower"), "palisade: tiles only");
const w1 = pxWalls({ tracks: { homes: 1, walls: 1 } });
ok(w1.includes("walls-1-cap-left") && w1.includes("walls-1-cap-right"), "stage 1: end caps");
const w2 = pxWalls({ tracks: { homes: 2, walls: 2 } });
ok((w2.match(/walls-2-tower/g) ?? []).length >= 3, "stage 2: towers along the wall");
const full = renderPanorama({ id: "m", tracks: { homes: 3, walls: 3, commerce: 3 }, pinnacles: ["faith", "publicworks", "walls"] });
ok(full.includes("walls-3-keep") && full.includes("walls-3-tower"), "stage 3: towers and a keep");
ok(full.lastIndexOf("walls-3-tile") > full.lastIndexOf("commerce-3"), "wall drawn in front of the town");
ok(full.indexOf("faith-pinnacle") < full.indexOf("ukm-px-home"), "pinnacles behind the houses");
const pins = pxPinnacles({ tracks: { homes: 3 }, pinnacles: ["faith", "publicworks", "walls", "army"] });
const pl = [...pins.matchAll(/left:([\d.-]+)%;top:[\d.-]+%;width:([\d.-]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
ok(pl.length === 4 && pl.every(([l, w]) => l >= 0 && l + w <= 100.01), "four pinnacles, all in frame");
const vp = pxPinnacles({ tracks: { homes: 0 }, pinnacles: ["food"] });
ok(Number(vp.match(/left:([\d.]+)%/)[1]) >= 25, "village pinnacle inside the 2x view");
ok(!pxPinnacles({ tracks: { homes: 3 }, pinnacles: ["nonsense"] }).includes("ukm-px"), "unknown pinnacle skipped");

// Nothing stands off on its own: houses and walls reach the furthest thing in town on both sides.
const boxes = (h, cls) => [...h.matchAll(new RegExp(`class="ukm-px ${cls}" style="left:([\\d.-]+)%;top:([\\d.-]+)%;width:([\\d.-]+)%;height:([\\d.-]+)%`, "g"))]
  .map((m) => ({ x: (Number(m[1]) / 100) * 576, w: (Number(m[3]) / 100) * 576, top: (Number(m[2]) / 100) * 120, h: (Number(m[4]) / 100) * 120 }));
const all3 = (n) => Object.fromEntries(["faith", "governance", "learning", "performance", "commerce", "industry", "watch", "army", "publicworks", "food"].map((t) => [t, n]));
for (const [label, s] of [
  ["metropolis + 4 pinnacles", { id: "z1", tracks: { homes: 3, walls: 3, ...all3(3) }, pinnacles: ["governance", "publicworks", "commerce", "walls"] }],
  ["city + 1 pinnacle", { id: "z2", tracks: { homes: 2, walls: 2, ...all3(2) }, pinnacles: ["learning"] }],
  ["town", { id: "z3", tracks: { homes: 1, walls: 1, ...all3(2) } }],
  ["village", { id: "z4", tracks: { homes: 0, walls: 0, ...all3(1) } }]
]) {
  const t = pxTown(s);
  const homesB = boxes(t.html, "ukm-px-home");
  const wallB = boxes(t.html, "ukm-px-wall");
  const things = boxes(t.html, "ukm-px-(?!home|wall|tower)[a-z]+");
  const hl = Math.min(...homesB.map((b) => b.x)), hr = Math.max(...homesB.map((b) => b.x + b.w));
  const wl = Math.min(...wallB.map((b) => b.x)), wr = Math.max(...wallB.map((b) => b.x + b.w));
  const tl = Math.min(...things.map((b) => b.x)), tr = Math.max(...things.map((b) => b.x + b.w));
  ok(hl <= tl + 6 && hr >= tr - 6, `${label}: houses reach the outermost buildings (${hl.toFixed(0)}-${hr.toFixed(0)} vs ${tl.toFixed(0)}-${tr.toFixed(0)})`);
  ok(wl <= tl + 8 && wr >= tr - 8, `${label}: wall reaches them too (${wl.toFixed(0)}-${wr.toFixed(0)})`);
  // Every raised building has a front-row house under its middle.
  const front = homesB.filter((b) => b.top + b.h >= 92);
  const raised = things.filter((b) => b.top + b.h < 92);
  const floating = raised.filter((b) => !front.some((f) => f.x <= b.x + b.w / 2 && f.x + f.w >= b.x + b.w / 2));
  ok(floating.length === 0, `${label}: nothing floating (${raised.length} raised)`);
}
