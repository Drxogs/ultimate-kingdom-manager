import { getKingdom } from "../integrations/party.js";
import { isLeader } from "./leader.js";

/** How many kingdom skills the party trains at founding, whatever the party's size. */
export const FOUNDING_TRAINED = 4;

/**
 * This module doesn't use invested leaders: seats come from Setup and training from the party's
 * founding picks. Any role ticked as invested on the kingdom sheet is unticked again.
 */
export async function clearInvested() {
  if (!isLeader()) return;
  const kingdom = getKingdom();
  if (!kingdom) return;
  const update = {};
  for (const [role, data] of Object.entries(kingdom.leadership ?? {})) {
    if (data?.invested) update[`leadership.${role}.invested`] = false;
  }
  if (Object.keys(update).length) await kingdom.update(update);
}

/** Train the party's founding skills. Never lowers a skill already trained higher. */
export async function trainFoundingSkills(skills) {
  const kingdom = getKingdom();
  if (!kingdom) return;
  const picks = [...new Set(skills.filter(Boolean))].slice(0, FOUNDING_TRAINED);
  const update = {};
  for (const skill of picks) {
    if ((kingdom.build?.skills?.[skill]?.rank ?? 0) < 1) update[`build.skills.${skill}.rank`] = 1;
  }
  if (Object.keys(update).length) await kingdom.update(update);
}
