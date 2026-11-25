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
ok(s.includes("left:17.3611%") && s.includes("top:36.6667%") && s.includes("width:5.5556%"), "sprite stands on its bottom edge at grid position");
ok(pxSprite("nope", 0, 0) === "", "unknown sprite draws nothing");

const { pxPlot } = await import(`${R}/apps/panorama.js`);
const busy = { id: "t1", tracks: { homes: 2, faith: 2, governance: 3, commerce: 1, army: 0, food: 3, learning: 2, industry: 1, watch: 2, publicworks: 2, performance: 1 } };
const b = renderPanorama(busy, { terrain: "plains" });
ok(["faith-2", "governance-3", "commerce-1", "army-0", "food-3", "publicworks-2"].every((n) => b.includes(`/${n}.png`)), "every built track drawn at its stage");
ok(b.indexOf("governance-3") < b.indexOf("faith-2") && b.indexOf("faith-2") < b.indexOf("commerce-1"), "far rows drawn before near rows");
ok(!renderPanorama({ id: "e", tracks: { homes: 0 } }).includes("faith-"), "unbuilt tracks not drawn");
const gp = pxPlot(busy, "governance", 3), cp = pxPlot(busy, "commerce", 1);
ok(gp.y < 92 && cp.y > 92, `back row raised (${gp.y}), near row lowered (${cp.y})`);
const vx = pxPlot({ tracks: { homes: 0 } }, "army", 0).x;
ok(vx >= 144 && vx + 20 <= 432, `village buildings inside the 2x crop (army at ${vx})`);
const tx = pxPlot({ tracks: { homes: 1 } }, "industry", 2).x, tg = pxPlot({ tracks: { homes: 1 } }, "governance", 2);
ok(tx + 32 <= 288 + 180 && tg.y - 48 >= 26, `town buildings inside the 1.6x crop (industry right edge ${tx + 32}, governance top ${tg.y - 48})`);
const mx = pxPlot({ tracks: { homes: 3 } }, "industry", 3).x;
ok(mx >= 0 && mx + 48 <= 576, `metropolis buildings inside the frame (industry at ${mx})`);

const { pxHomes } = await import(`${R}/apps/panorama.js`);
const count = (h) => (h.match(/ukm-px-home/g) ?? []).length;
const hv = pxHomes({ id: "h", tracks: { homes: 0 } }), hm = pxHomes({ id: "h", tracks: { homes: 3 } });
ok(count(hv) >= 2 && count(hv) <= 6 && hv.includes("homes-0-a"), `village: a few huts (${count(hv)})`);
ok(count(hm) > count(pxHomes({ id: "h", tracks: { homes: 2 } })) && count(pxHomes({ id: "h", tracks: { homes: 2 } })) > count(pxHomes({ id: "h", tracks: { homes: 1 } })), `bigger places, more houses (metropolis ${count(hm)})`);
ok(pxHomes({ id: "h", tracks: { homes: 2 } }) === pxHomes({ id: "h", tracks: { homes: 2 } }), "same settlement, same houses");
ok(pxHomes({ id: "h", tracks: { homes: 2 } }) !== pxHomes({ id: "k", tracks: { homes: 2 } }), "different settlements, different houses");
ok(pxHomes({ id: "h", tracks: {} }) === "", "no Homes, no houses");
const hb = renderPanorama({ id: "q", tracks: { homes: 2, governance: 2, commerce: 2 } });
ok(hb.indexOf("governance-2") < hb.indexOf("ukm-px-home") && hb.indexOf("ukm-px-home") < hb.indexOf("commerce-2"), "houses between the back and near rows");
const lefts = [...hm.matchAll(/left:([\d.-]+)%/g)].map((m) => Number(m[1]));
ok(lefts.every((l) => l >= 0 && l <= 100), "metropolis houses stay in frame");
