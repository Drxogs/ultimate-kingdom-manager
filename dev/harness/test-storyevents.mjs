import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getStoryEvents, storyChapter, getEvent } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { SKILL_TO_STAT, SEATS } = await import(`${R}/constants.js`);
const { describeEffects } = await import(`${R}/realm/effects.js`);
const G = await import(`${R}/realm/gm.js`);
const S = await import(`${R}/realm/settlements.js`);
const { getRealm } = await import(`${R}/realm/state.js`);
const all = getStoryEvents();
ok(all.length === 18, `18 story events (${all.length})`);
const byCh = {};
for (const e of all) (byCh[storyChapter(e)] ??= []).push(e.name);
console.log(JSON.stringify(byCh));
for (const e of all) {
  const stages = e.stages ?? [{ skill: e.skill, outcomes: e.outcomes }];
  const bad = !storyChapter(e) || !SEATS.includes(e.seat) || !stages.every((s) => (s.skill ?? e.skill).every((k) => SKILL_TO_STAT[k])) || !stages.every((s) => ["criticalSuccess", "success", "failure", "criticalFailure"].every((d) => Array.isArray(s.outcomes[d])));
  if (bad) ok(false, `${e.id} is malformed`);
  for (const s of stages) for (const d of Object.values(s.outcomes)) describeEffects(d);
}
ok(true, "every story event has a chapter, seat, skills and four results");
const keep = getEvent("forgotten-keep-elves");
ok(keep?.name === "Elves at the Forgotten Keep" && keep.outcomes.success.some((x) => x.spawn === "new-subjects") && keep.seat, "a story event built on a deck event keeps its rules and adds its own");
await S.foundCapital({ name: "Monkeyton", userId: "gm" });
for (const e of all) await G.gmAction({ op: "storyEvent", eventId: e.id, userId: "gm" });
ok(getRealm().cards.filter((c) => all.some((e) => e.id === c.eventId)).length === all.length, "each one can be put on a desk");

// Grigori: Support builds week by week; at 15 his trial begins.
{
  const RS = await import(`${R}/realm/resolve.js`);
  const card = () => getRealm().cards.find((c) => c.eventId === "rabble-rouser" && c.status !== "resolved");
  await RS.recordOutcome(card().id, "success");
  ok(card().progress === 2 && !RS.isResting(card()), `a success: Support 2, back next week (${card().progress})`);
  for (let i = 0; i < 4; i++) await RS.recordOutcome(card().id, "criticalSuccess");
  ok(card().stage === 1 && card().progress === 0, `Support 18 ≥ 15: on to the trial (stage ${card().stage})`);
  const pending = getRealm().scheduled?.filter((s) => s.eventId === "public-scandal").length ?? 0;
  ok(pending >= 1, `the 4th week brought a Public Scandal (${pending})`);
  const { describeEffects } = await import(`${R}/realm/effects.js`);
  const ev = getStoryEvents().find((e) => e.id === "rabble-rouser");
  const line = describeEffects(ev.stages[1].outcomes.criticalSuccess).join("; ");
  ok(line.includes("Execution:") && line.includes("Pardon:"), `sentences are named: ${line}`);
  const troll = getRealm().cards.find((c) => c.eventId === "troll-sightings");
  await RS.endCard(troll.id);
  ok(getRealm().cards.find((c) => c.id === troll.id).status === "resolved", "the GM can end Troll Sightings");
}
