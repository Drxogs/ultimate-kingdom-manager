import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { renderPanorama, pxSprite, pxZoom } = await import(`${R}/apps/panorama.js`);
const { ART_SIZES } = await import(`${R}/apps/panorama-art.js`);
const fs = await import("node:fs");
void env;

const files = fs.readdirSync("/home/claude/ukm-repo/art/panorama").filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
ok(files.length === Object.keys(ART_SIZES).length && files.every((f) => ART_SIZES[f]), `size table matches art folder (${files.length})`);

const village = { id: "v1", name: "Oleg's", tracks: { homes: 0 }, pinnacles: [] };
const city = { id: "c1", name: "Big <City>", tracks: { homes: 2 }, pinnacles: [], waterside: true };
ok(pxZoom(village) === 2 && pxZoom(city) === 1, "villages zoom 2x, cities 1x");

const v = renderPanorama(village, { terrain: "forest" });
ok(v.includes("art/panorama/bg-forest.png") && !v.includes("water.png"), "village: forest background, no river");
ok(v.includes('data-zoom="2"') && v.includes("width:200%"), "village stage drawn at 2x");
ok(v.includes("<svg"), "old drawing kept underneath as fallback");

const c = renderPanorama(city, { terrain: "Mountain" });
ok(c.includes("bg-mountains.png") && c.includes("water.png"), "city: mountain background and river");
ok(c.includes('aria-label="Big &#60;City&#62;"'), "label escaped");
ok(renderPanorama(city, {}).includes("bg-plains.png"), "unknown terrain falls back to plains");

const s = pxSprite("faith-2", 100, 92);
ok(s.includes("left:17.3611%") && s.includes("top:36.6667%") && s.includes("width:5.5556%"), "sprite stands on its bottom edge at grid position");
ok(pxSprite("nope", 0, 0) === "", "unknown sprite draws nothing");
