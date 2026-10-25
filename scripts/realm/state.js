import { FLAG_SCOPE, MODULE_ID, REALM_STATS } from "../constants.js";
import { getParty } from "../integrations/party.js";

const FLAG_KEY = "realm";
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
    log: []
  };
}

export function getRealm() {
  const stored = getParty()?.getFlag(FLAG_SCOPE, FLAG_KEY);
  return foundry.utils.mergeObject(defaultRealm(), stored ?? {}, { inplace: false });
}

/**
 * Apply a change to the realm. Only the active GM writes; everyone else
 * receives the update through the actor and re-renders.
 */
export async function updateRealm(mutator) {
  if (!game.user.isActiveGM) throw new Error(`${MODULE_ID} | only the active GM can change the realm`);
  const party = getParty();
  if (!party) return null;
  const realm = getRealm();
  await mutator(realm);
  if (realm.log.length > LOG_LIMIT) realm.log = realm.log.slice(-LOG_LIMIT);
  await party.setFlag(FLAG_SCOPE, FLAG_KEY, realm);
  return realm;
}

export function addLog(realm, entry) {
  realm.log.push({ time: game.time.worldTime, ...entry });
}

export function newId() {
  return foundry.utils.randomID(12);
}
