/**
 * Read-only access to the official Kingmaker module (pf2e-kingmaker).
 * Everything that touches its runtime lives here, so an update to that
 * module only ever needs changes in this file.
 */

const KINGMAKER_ID = "pf2e-kingmaker";

export function isKingmakerActive() {
  return !!game.modules.get(KINGMAKER_ID)?.active && !!globalThis.kingmaker?.CONST;
}

function km() {
  return isKingmakerActive() ? globalThis.kingmaker : null;
}

/** Static hex definitions are keyed "i.j"; saved hex state is keyed 1000 * i + j. */
export function offsetToStateKey(offsetKey) {
  const [i, j] = String(offsetKey).split(".").map(Number);
  if (!Number.isInteger(i) || !Number.isInteger(j)) return null;
  return String(1000 * i + j);
}

export function stateKeyToOffset(stateKey) {
  const n = Number(stateKey);
  if (!Number.isInteger(n)) return null;
  return { i: Math.floor(n / 1000), j: n % 1000 };
}

export function getZones() {
  const zones = km()?.CONST.ZONES ?? {};
  return Object.values(zones)
    .filter((z) => z.id !== "NA")
    .map((z) => ({
      id: z.id,
      label: game.i18n.localize(z.label),
      level: z.level,
      terrain: z.terrain,
      travel: z.travel
    }))
    .sort((a, b) => a.level - b.level);
}

export function getZone(zoneId) {
  return getZones().find((z) => z.id === zoneId) ?? null;
}

/** Static data for every hex on the region map. */
export function getHexDefinitions() {
  const hexes = km()?.CONST.HEXES ?? {};
  return Object.entries(hexes).map(([offsetKey, data]) => ({
    offsetKey,
    key: offsetToStateKey(offsetKey),
    zone: data.zone,
    terrain: data.terrain ?? null,
    travel: data.travel ?? null,
    discovery: data.discoveryTrait ?? null,
    resource: !!data.resourceTrait,
    page: data.page ?? null,
    defaults: data.state ?? null
  }));
}

/** Current saved state for one hex, merged over its defaults. Never written by this module. */
export function getHexState(stateKey) {
  const saved = km()?.state?.hexes?.[stateKey] ?? {};
  return foundry.utils.deepClone(saved);
}

/** All hex state entries with valid keys. Stray entries (e.g. "NaN") are skipped. */
export function getAllHexStates() {
  const hexes = km()?.state?.hexes ?? {};
  return Object.entries(hexes)
    .filter(([key]) => Number.isInteger(Number(key)))
    .map(([key, state]) => ({ key, ...foundry.utils.deepClone(state) }));
}

export function getClaimedHexes() {
  return getAllHexStates().filter((h) => h.claimed);
}

export function hasFeature(hexState, type) {
  return (hexState.features ?? []).some((f) => f.type === type);
}

/** Which commodity each kind of work site works. */
export const CAMP_COMMODITY = { lumber: "lumber", quarry: "stone", mine: "ore" };

/**
 * Everything the map holds in the realm's claimed hexes, for the Realm tab: farms, roads, camps,
 * commodities (worked or not) and any other hex features, counted.
 */
export function landSummary() {
  const claimed = getClaimedHexes();
  const camps = {};
  const commodities = {};
  const idle = {};
  const features = {};
  for (const h of claimed) {
    if (h.camp) camps[h.camp] = (camps[h.camp] ?? 0) + 1;
    if (h.commodity) {
      commodities[h.commodity] = (commodities[h.commodity] ?? 0) + 1;
      if (!h.camp || CAMP_COMMODITY[h.camp] !== h.commodity) idle[h.commodity] = (idle[h.commodity] ?? 0) + 1;
    }
    for (const f of h.features ?? []) if (f?.type) features[f.type] = (features[f.type] ?? 0) + 1;
  }
  return { hexes: claimed.length, camps, commodities, idle, features };
}

export function summarizeRealm() {
  const claimed = getClaimedHexes();
  const count = (type) => claimed.filter((h) => hasFeature(h, type)).length;
  const camps = (type) => claimed.filter((h) => h.camp === type);
  return {
    size: claimed.length,
    farmlands: count("farmland"),
    roads: count("road"),
    workSites: ["quarry", "mine", "lumber"].reduce((acc, type) => {
      const sites = camps(type);
      acc[type] = { total: sites.length, onResource: sites.filter((h) => !!h.commodity).length };
      return acc;
    }, {}),
    settlements: claimed.filter((h) =>
      ["village", "town", "city", "metropolis"].some((t) => hasFeature(h, t))
    ).length
  };
}

export function getRegionScene() {
  return km()?.region?.scene ?? null;
}

/** Pan the region map to a hex and open the module's hex HUD for it. */
export async function focusHex(stateKey) {
  const region = km()?.region;
  const scene = region?.scene;
  if (!scene) return;
  if (canvas.scene?.id !== scene.id) await scene.view();
  const hex = region.hexes?.get?.(Number(stateKey));
  const center = hex?.center;
  if (center) await canvas.animatePan({ x: center.x, y: center.y, scale: Math.max(canvas.stage.scale.x, 0.6) });
  if (hex && region.hud?.activate) await region.hud.activate(hex);
}

export function getHexCenter(stateKey) {
  const hex = km()?.region?.hexes?.get?.(Number(stateKey));
  return hex?.center ? { x: hex.center.x, y: hex.center.y } : null;
}

/** Called whenever the GM edits the region map. */
export function onRegionChange(callback) {
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === `${KINGMAKER_ID}.state`) callback();
  });
  Hooks.on("closeKingmakerHexEdit", () => callback());
}

export function onHexHud(callback) {
  Hooks.on("renderKingmakerHexHUD", (app, html) => callback(app, html));
}

const ART_ALIASES = { specializedartisan: "specialartisan", theater: "theatre", cemetary: "cemetery" };

/** The Kingmaker module's building art for a structure: lot-sized tiles, sometimes in several variants. */
export function structureArt(source, name) {
  const list = km()?.CONST?.STRUCTURES ?? [];
  const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const wanted = norm(name);
  const found =
    (source && list.find((s) => s.journal?.includes(source))) ??
    list.find((s) => norm(s.label) === (ART_ALIASES[wanted] ?? wanted));
  const art = found?.art;
  return art?.enhanced?.length ? [...art.enhanced] : [...(art?.original ?? [])];
}
