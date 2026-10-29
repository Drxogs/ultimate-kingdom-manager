import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getEvents } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const RS = await import(`${R}/realm/resolve.js`);
const deck = await import(`${R}/realm/deck.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const S = await import(`${R}/realm/settlements.js`);
await S.foundCapital({ name: "Monkeyton", userId: "gm" });
const one = getEvents().find((e) => !e.continuous && e.placement?.type === "kingdom" && e.kind === "problem");
const ongoing = getEvents().find((e) => e.continuous?.endOn?.includes("criticalSuccess") && !e.continuous.endOn.includes("success") && e.placement?.type === "kingdom");
for (const [ev, label] of [[one, "one-off"], [ongoing, "ongoing"]]) {
  let id;
  await updateRealm((r) => { const c = deck.createCard(ev); id = c.id; r.cards.push(c); });
  await RS.escalateCard({ cardId: id, userId: "gm" });
  await RS.recordOutcome(id, "success");
  const card = getRealm().cards.find((c) => c.id === id);
  const msg = env.messages.at(-1)?.content ?? "";
  if (label === "one-off") ok(card.status === "resolved", `${ev.name}: a one-off card taken to the party and recorded as a success is resolved (${card.status})`);
  else ok(card.status === "open" && msg.includes("until a critical success"), `${ev.name}: an ongoing card comes back and chat says what ends it (${card.status})`);
}
console.log(RS.endsText(getEvents().find((e) => e.continuous?.endOn?.includes("failure:twiceInARow"))));

// An ongoing card rests after each try, so it comes back about once a month.
{
  const card = getRealm().cards.find((c) => c.eventId === ongoing.id && c.status === "open");
  ok(RS.isResting(card), "an ongoing card rests after a try");
  const r = await RS.assignCard({ cardId: card.id, type: "advisor", userId: "gm" });
  ok(!r.ok && r.reason === "Resting", `can't work it again while it rests (${JSON.stringify(r)})`);
  const days = (card.deadline - env.time) / 86400;
  ok(days >= RS.ONGOING_REST_DAYS + 14, `deadline leaves two weeks after the rest (${days})`);
}
env.advance(RS.ONGOING_REST_DAYS + 1);
{
  const card = getRealm().cards.find((c) => c.eventId === ongoing.id && c.status === "open");
  ok(!RS.isResting(card), "after the rest it can be worked again");
}
