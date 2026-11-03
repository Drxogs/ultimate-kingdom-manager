import { FLAG_SCOPE, MODULE_ID, REALM_STATS } from "../constants.js";
import { getParty } from "../integrations/party.js";
import { isLeader } from "./leader.js";

const FLAG_KEY = "realm";
export const REALM_FLAG = FLAG_KEY;
const VERSION = 1;
const LOG_LIMIT = 300;

export function defaultRealm() {
  return {
    version: VERSION,
    treasury: 0,
    stats: Object.fromEntries(Object.keys(REALM_STATS).map((stat) => [stat, { points: 0, rank: 0 }])),
    incomeAdjustments: [],
    consumptionAdjustments: [],
    cards: [],
    projects: [],
    timedModifiers: [],
    fortunes: [],
    debt: { amount: 0, draws: 0 },
    tradeAgreements: [],
    scheduled: [],
    gmTasks: [],
    structures: [],
    settlements: [],
    levelModBoosts: {},
    founding: null,
    kingdom: defaultKingdomData(),
    log: []
  };
}

/** The kingdom's own numbers, kept by this module instead of the PF2e kingdom sheet. */
export function defaultKingdomData() {
  const ability = () => ({ ruin: { value: 0, max: 10 }, penalty: 0 });
  return {
    active: false,
    name: "",
    img: null,
    level: 1,
    capital: null,
    ruler: null,
    unrest: { value: 0 },
    resources: { fame: { value: 0, max: 3 } },
    abilities: { culture: ability(), economy: ability(), stability: ability(), loyalty: ability() },
    leadership: {},
    size: 1
  };
}

/** The stored realm over the defaults, as a copy that shares nothing with the actor's flag. */
function buildRealm(stored) {
  const copy = foundry.utils.deepClone(stored ?? {});
  const realm = foundry.utils.mergeObject(defaultRealm(), copy, { inplace: false });
  realm.kingdom = { ...defaultKingdomData(), ...(copy.kingdom ?? {}) };
  return realm;
}

/*
 * Reading the realm means copying the party actor's flag over the defaults, and one redraw of the
 * Kingdom Manager reads it dozens of times. So the copy is kept until the party actor changes
 * (invalidateRealm, called from the updateActor hook) or a different flag object turns up.
 * The copy is shared: read from it, but change the realm only through updateRealm.
 */
let cached = null;

export function invalidateRealm() {
  cached = null;
}

export function getRealm() {
  // While a change is being made, everything sees the realm as it's being changed.
  if (inFlight) return inFlight;
  const stored = getParty()?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (cached && cached.stored === stored) return cached.realm;
  const realm = buildRealm(stored);
  cached = { stored, realm };
  if (globalThis.__UKM_FREEZE__) deepFreeze(realm);
  return realm;
}

/** Tests only: make accidental writes to the shared copy throw. */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// The realm being changed right now, if any, so the kingdom can read and write it mid-change.
let inFlight = null;

export function realmInFlight() {
  return inFlight;
}

/**
 * Apply a change to the realm. Only the active GM writes; everyone else
 * receives the update through the actor and re-renders.
 */
let queue = Promise.resolve();

export function updateRealm(mutator) {
  if (!isLeader()) return Promise.reject(new Error(`${MODULE_ID} | only the active GM can change the realm`));
  const run = queue.then(async () => {
    const party = getParty();
    if (!party) return null;
    // Changes go to a fresh copy, never the shared one readers hold.
    const realm = buildRealm(party.getFlag(FLAG_SCOPE, FLAG_KEY));
    inFlight = realm;
    try {
      await mutator(realm);
    } finally {
      inFlight = null;
    }
    if (realm.log.length > LOG_LIMIT) realm.log = realm.log.slice(-LOG_LIMIT);
    await party.setFlag(FLAG_SCOPE, FLAG_KEY, realm);
    invalidateRealm();
    return realm;
  });
  queue = run.catch(() => null);
  return run;
}

export function addLog(realm, entry) {
  realm.log.push({ time: game.time.worldTime, ...entry });
}

export function newId() {
  return foundry.utils.randomID(12);
}

/**
 * Version 1.0 starts fresh. A world that ran the old 0.x module (before the redesign) has a realm
 * with no kingdom numbers of its own and no seat version; its shape doesn't fit the new rules, so
 * it is set aside on the party actor (flag "realm-v0", untouched, in case anyone wants it) and the
 * module's world settings go back to their defaults. Runs once on the GM's window.
 */
export async function freshStartFromOld() {
  const party = getParty();
  const stored = party?.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!stored || stored.kingdom) return false;
  await party.setFlag(FLAG_SCOPE, "realm-v0", stored);
  await party.unsetFlag(FLAG_SCOPE, FLAG_KEY);
  invalidateRealm();
  for (const setting of game.settings.settings.values()) {
    if (setting.namespace !== MODULE_ID || setting.scope !== "world") continue;
    await game.settings.set(MODULE_ID, setting.key, foundry.utils.deepClone(setting.default));
  }
  ui.notifications.info(game.i18n.localize("UKM.FreshStart"), { permanent: true });
  return true;
}
