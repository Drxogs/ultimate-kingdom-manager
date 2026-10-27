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
    unrest: { value: 0 },
    resources: { fame: { value: 0, max: 3 } },
    abilities: { culture: ability(), economy: ability(), stability: ability(), loyalty: ability() },
    leadership: {},
    size: 1
  };
}

export function getRealm() {
  const stored = getParty()?.getFlag(FLAG_SCOPE, FLAG_KEY);
  const realm = foundry.utils.mergeObject(defaultRealm(), stored ?? {}, { inplace: false });
  realm.kingdom = { ...defaultKingdomData(), ...(stored?.kingdom ?? {}) };
  return realm;
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
    const realm = getRealm();
    inFlight = realm;
    try {
      await mutator(realm);
    } finally {
      inFlight = null;
    }
    if (realm.log.length > LOG_LIMIT) realm.log = realm.log.slice(-LOG_LIMIT);
    await party.setFlag(FLAG_SCOPE, FLAG_KEY, realm);
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
