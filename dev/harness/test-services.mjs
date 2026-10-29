import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData, getServices } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const SV = await import(`${R}/realm/services.js`);
const CO = await import(`${R}/realm/council.js`);
const S = await import(`${R}/realm/settlements.js`);
const G = await import(`${R}/realm/gm.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { getKingdom } = await import(`${R}/integrations/party.js`);
const { companionAttitude } = await import(`${R}/realm/rules.js`);

ok(getServices().length === 8, `8 services (${getServices().length})`);
await S.foundCapital({ name: "Monkeyton", userId: "gm" });
const capId = getRealm().settlements[0].id;
await updateRealm((r) => (r.treasury = 500));

// Locked until the track is built.
let view = SV.servicesView();
const cleanse = () => SV.servicesView().find((s) => s.id === "cleanse-affliction");
ok(cleanse().blocked && !cleanse().canAsk, `Cleanse Affliction needs a Temple (${cleanse().blocked})`);
ok(!view.some((s) => s.id === "raise-the-fallen"), "raising the dead is hidden while the setting is off");
await G.gmAction({ op: "trackStage", settlementId: capId, trackId: "faith", stage: 2, userId: "gm" });
ok(cleanse().canAsk, "Temple built: Cleanse Affliction can be asked for");

// The GM (or ruler) pays straight away.
const pc = env.party.members[0];
const before = getRealm().treasury;
const cost = cleanse().cost;
let r = await SV.requestService({ serviceId: "cleanse-affliction", details: { actorUuid: pc.uuid, note: "goblin pox" }, userId: "gm" });
ok(r.ok && !r.pending && getRealm().treasury === before - cost, `paid ${cost} BP at once (${JSON.stringify(r)})`);
const task = getRealm().gmTasks.at(-1)?.text ?? "";
ok(task.includes("Wes") && task.includes("goblin pox") && task.includes("rank 2"), `GM task: ${task}`);
ok(env.messages.at(-1)?.content.includes("Cleanse Affliction"), "chat post");

// Anyone else asks; it waits for the ruler on the council.
const player = { id: "p1", name: "Player", isGM: false, character: pc, getFlag: () => null };
game.users.push(player);
r = await SV.requestService({ serviceId: "cleanse-affliction", details: { actorUuid: pc.uuid, note: "curse" }, userId: "p1" });
const prop = CO.proposals().find((p) => p.request?.type === "service" && p.status === "open");
ok(r.ok && r.pending && prop?.cost === cost, `a player's request waits on the council (${JSON.stringify(r)})`);
ok(cleanse().pending && !cleanse().canAsk, "shown as waiting");
const t0 = getRealm().treasury;
r = await CO.fundProposal({ proposalId: prop.id, userId: "gm" });
ok(r.ok && getRealm().treasury === t0 - cost && CO.proposals().find((p) => p.id === prop.id).status === "funded", "the ruler approves: paid and done");

// Details are checked.
r = await SV.requestService({ serviceId: "cleanse-affliction", details: { actorUuid: "Actor.nobody" }, userId: "gm" });
ok(!r.ok && r.reason === "ServiceTarget", "must name a party member");

// Teleport needs level 11; Archives have a 30-day cooldown and need a subject.
ok(SV.servicesView().find((s) => s.id === "teleport").blocked.includes("11"), "teleport waits for level 11");
await G.gmAction({ op: "trackStage", settlementId: capId, trackId: "learning", stage: 1, userId: "gm" });
r = await SV.requestService({ serviceId: "archive-research", details: { note: "" }, userId: "gm" });
ok(!r.ok, "archives need a subject");
r = await SV.requestService({ serviceId: "archive-research", details: { note: "the Stag Lord" }, userId: "gm" });
ok(r.ok, "archives research the Stag Lord");
ok(SV.servicesView().find((s) => s.id === "archive-research").blocked?.includes("30"), "archives: again in 30 days");

// Raise the fallen: setting, level 12, a Cathedral.
env.settings.set("raiseDead", true);
ok(SV.servicesView().some((s) => s.id === "raise-the-fallen"), "setting on: raising the dead is listed");
ok(SV.servicesView().find((s) => s.id === "raise-the-fallen").blocked, "but needs level 12 and a Cathedral");

// Feast warms a companion one step, then not again for 90 days.
await G.gmAction({ op: "trackStage", settlementId: capId, trackId: "governance", stage: 1, userId: "gm" });
env.settings.set("companionAttitudes", { oleg: "indifferent" });
r = await SV.requestService({ serviceId: "royal-feast", details: { companionId: "oleg" }, userId: "gm" });
ok(r.ok && companionAttitude("oleg") === "friendly", `feast: Oleg indifferent -> ${companionAttitude("oleg")}`);
ok(!SV.feastTargets(getServices().find((s) => s.id === "royal-feast")).some((c) => c.id === "oleg"), "Oleg can't be feasted again for 90 days");

// Too costly.
await updateRealm((rr) => (rr.treasury = 1));
ok(cleanse().blocked && !cleanse().canAsk, "can't ask when the treasury can't pay");
ok(SV.serviceRank(12) === 6 && SV.serviceRank(13) === 7, "spell rank is half the level, rounded up");
