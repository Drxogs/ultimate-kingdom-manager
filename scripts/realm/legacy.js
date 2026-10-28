import { MODULE_ID } from "../constants.js";
import { getParty } from "../integrations/party.js";
import { getSetting, setSetting, SETTINGS } from "../settings.js";
import { isLeader } from "./leader.js";
import { addLog, getRealm, updateRealm } from "./state.js";

/*
 * Bringing a kingdom over from v0.22 (and earlier). v0.22 kept the kingdom's numbers on PF2e's kingdom
 * sheet (the party's campaign data) and its own realm under the "ultimate-kingdom-manager" flag scope.
 * The redesign keeps the numbers itself; nothing here changes or deletes the old data.
 */

const OLD_ID = "ultimate-kingdom-manager";
const ABILITIES = ["culture", "economy", "stability", "loyalty"];

/** PF2e's kingdom (party campaign data) as our kingdom numbers, or null if there's no built kingdom. */
export function kingdomFromPf2e(campaign) {
  if (!campaign?.active) return null;
  const abilities = {};
  for (const key of ABILITIES) {
    const a = campaign.abilities?.[key] ?? {};
    abilities[key] = { ruin: { value: Number(a.ruin?.value) || 0, max: Number(a.ruin?.max) || 10 }, penalty: Number(a.penalty) || 0 };
  }
  const leadership = {};
  for (const [role, lead] of Object.entries(campaign.leadership ?? {})) if (lead?.uuid) leadership[role] = { uuid: lead.uuid };
  return {
    active: true,
    name: campaign.name ?? "",
    img: campaign.img ?? null,
    level: Number(campaign.level) || 1,
    capital: campaign.capital ?? null,
    unrest: { value: Number(campaign.unrest?.value) || 0 },
    resources: { fame: { value: Number(campaign.resources?.fame?.value) || 0, max: Number(campaign.resources?.fame?.max) || 3 } },
    abilities,
    leadership,
    size: Number(campaign.size) || 1
  };
}

function pf2eCampaign(party = getParty()) {
  return party?._source?.system?.campaign ?? null;
}

/**
 * Once, on the GM's window: a realm that has never had its own kingdom numbers takes them from PF2e's
 * kingdom sheet (a world coming from v0.22). Runs before the six-seat migration so the old Ruler
 * becomes the ruler.
 */
export async function importPf2eKingdom() {
  if (!isLeader()) return false;
  const realm = getRealm();
  if (realm.kingdom?.active || realm.kingdomImported) return false;
  const kingdom = kingdomFromPf2e(pf2eCampaign());
  if (!kingdom) return false;
  await updateRealm((r) => {
    r.kingdom = { ...r.kingdom, ...kingdom, ruler: r.kingdom?.ruler ?? null };
    r.kingdomImported = true;
    addLog(r, { type: "kingdom-imported", text: kingdom.name });
  });
  return true;
}

/** World settings the old module saved, read straight from storage (the old module needn't be enabled). */
function oldSetting(key) {
  try {
    const doc = game.settings.storage.get("world")?.find?.((s) => s.key === `${OLD_ID}.${key}`);
    if (!doc) return undefined;
    const value = doc.value;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
}

const COPY_SETTINGS = ["seatAssignments", "companionAttitudes", "knownAdvisors", "customAdvisors", "tapTreasury", "council", "audiences", "deskMatters", "pinResolved", "clock"];

/** The test build only: is there a v0.22 kingdom in this world to bring over? */
export function legacyAvailable() {
  if (MODULE_ID === OLD_ID) return false;
  return !!getParty()?.flags?.[OLD_ID]?.realm;
}

/**
 * GM, test build: copy the v0.22 kingdom (its realm, its settings and PF2e's kingdom numbers) into this
 * module's own data, replacing what's here. The old data stays as it was, so v0.22 still works.
 * The six-seat and settlement-track migrations then run as for any older realm.
 */
export async function importLegacyKingdom() {
  if (!game.user.isGM || !isLeader()) return { ok: false, reason: "NotGM" };
  const party = getParty();
  const old = party?.flags?.[OLD_ID]?.realm;
  if (!old) return { ok: false, reason: "NoLegacy" };
  const kingdom = kingdomFromPf2e(pf2eCampaign(party));
  await updateRealm((r) => {
    const keep = r.kingdom;
    for (const key of Object.keys(r)) delete r[key];
    Object.assign(r, foundry.utils.deepClone(old));
    r.kingdom = kingdom ? { ...keep, ...kingdom, ruler: null } : keep;
    r.kingdomImported = true;
    delete r.seatsVersion;
    r.log ??= [];
    addLog(r, { type: "kingdom-imported", text: kingdom?.name ?? "" });
  });
  for (const key of COPY_SETTINGS) {
    const value = oldSetting(key);
    if (value !== undefined && SETTINGS[key]) await setSetting(SETTINGS[key], value);
  }
  if (getSetting(SETTINGS.setupComplete) === false) await setSetting(SETTINGS.setupComplete, true);
  const { migrateSixSeats } = await import("./state.js");
  const { repairSettlements } = await import("./settlements.js");
  await migrateSixSeats();
  await repairSettlements();
  return { ok: true };
}
