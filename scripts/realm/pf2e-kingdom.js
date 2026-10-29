import { getParty } from "../integrations/party.js";
import { isLeader } from "./leader.js";
import { addLog, getRealm, updateRealm } from "./state.js";

/*
 * A world that already ran a kingdom on PF2e's own kingdom sheet (the party's campaign data): its
 * numbers are read once, the first time the GM loads. The sheet itself isn't changed.
 */

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
