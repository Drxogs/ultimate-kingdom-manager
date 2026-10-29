import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
env.settings.set("seatAssignments", {});
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const S = await import(`${R}/realm/settlements.js`);
const T = await import(`${R}/realm/tracks.js`);
const P = await import(`${R}/realm/projects.js`);
const RS = await import(`${R}/realm/resolve.js`);
const G = await import(`${R}/realm/gm.js`);
const RY = await import(`${R}/realm/royal.js`);
const { weeklyIncome } = await import(`${R}/realm/rules.js`);
const { getRealm, updateRealm } = await import(`${R}/realm/state.js`);
const { EffectContext } = await import(`${R}/realm/effects.js`);
const { getKingdom } = await import(`${R}/integrations/party.js`);
const { renderPanorama } = await import(`${R}/apps/panorama.js`);

await S.foundCapital({ name: "Monkeyton", userId: "gm" });
const capId = () => getRealm().settlements.find((s) => s.capital).id;
const cap = () => getRealm().settlements.find((s) => s.capital);
const lvl = getKingdom().level;
ok(lvl === 3, `kingdom level ${lvl}`);

// Caps: other tracks go one past Homes; Homes needs the kingdom level.
let step = T.nextStep(cap(), "faith", { kingdomLevel: lvl });
ok(step.stage === 1 && step.bp === 8 && step.days === 7, "village can raise Faith to +1 (8 BP, 7 days)");
await G.gmAction({ op: "trackStage", settlementId: capId(), trackId: "faith", stage: 1, userId: "gm" });
step = T.nextStep(cap(), "faith", { kingdomLevel: lvl });
ok(step.blocked === "NeedsHomes", "Faith +2 waits for Homes");
ok(T.nextStep(cap(), "homes", { kingdomLevel: 1 }).blocked === "NeedsLevel", "Tenements need kingdom level 3");
step = T.nextStep(cap(), "homes", { kingdomLevel: lvl });
ok(step.stage === 1 && !step.blocked, "level 3: Tenements can be built");
ok(T.nextStep(cap(), "governance", { kingdomLevel: 20 }).stage === 0, "unbuilt track starts at its starter");

// Develop a track as a project: card on the track's seat, paid, then completed.
await updateRealm((realm) => (realm.treasury = 200));
const before = getRealm().treasury;
let r = await P.startProject({ type: "develop-settlement", settlementId: capId(), track: "homes", userId: "gm" }, { canActForSeat: RS.canActForSeat });
const card = getRealm().cards.find((c) => c.project?.track?.id === "homes");
ok(r.ok && card?.seat === "viceroy" && getRealm().treasury === before - 8, `Tenements start on the Viceroy desk for 8 BP (${JSON.stringify(r)})`);
ok(card?.project.track.skills.join() === "agriculture,wilderness,exploration", "uses Community skills");
r = await P.startProject({ type: "develop-settlement", settlementId: capId(), track: "homes", userId: "gm" }, { canActForSeat: RS.canActForSeat });
ok(!r.ok && r.reason === "TrackWorking", "can't start the same track twice");
ok(P.projectsForSeat("viceroy").every((d) => d.target !== "settlement"), "develop isn't in the Start project list");
await updateRealm((realm) => {
  const c = realm.cards.find((x) => x.id === card.id);
  const ctx = new EffectContext({ realm, card: c, event: null });
  P.completeProject(ctx);
  c.status = "resolved";
});
ok(T.trackStage(cap(), "homes") === 1 && cap().type === "town", "done: Homes +1 and the village is a town");
ok(S.settlementState(cap()).consumption === 2 - 0, "a town eats 2 food (no food savings at Campfire)");
const missing = T.missingNeeds(cap()).map((m) => m.trackId).sort().join();
ok(missing === "food,watch", `a town is missing Public House and a watch starter (${missing})`);

// Bonuses: each track's top stage to its skills.
const bonus = T.trackBonuses(cap());
ok(!bonus.agriculture && bonus.folklore === 1 && !bonus.arts, `Homes gives no bonus; Faith gives only Folklore (${JSON.stringify(bonus)})`);

// Income and perks.
await G.gmAction({ op: "trackStage", settlementId: capId(), trackId: "commerce", stage: 2, userId: "gm" });
ok(weeklyIncome(getRealm()).tracks === 1, "a Bazaar adds 1 BP a week");
await G.gmAction({ op: "trackStage", settlementId: capId(), trackId: "industry", stage: 2, userId: "gm" });
ok(P.projectDiscount(cap()) === 10, "Workshops: 10% off projects here");
const q = P.developmentQuote(capId(), "food");
ok(q.cost === Math.round(8 * 0.9), `discounted cost (${q.cost})`);
ok(RY.usesPerMonth() === 1, "one royal use a month without a Palace");

// Pinnacles: need a metropolis, one per kingdom.
await updateRealm((realm) => {
  const s = realm.settlements.find((x) => x.capital);
  s.tracks.homes = 3;
  s.tracks.learning = 3;
  s.tracks.governance = 3;
  S.fitSize(s);
});
ok(cap().type === "metropolis", "Homes +3 makes a metropolis");
ok(RY.usesPerMonth() === 2, "a Palace adds a royal use");
step = T.nextStep(cap(), "learning", { kingdomLevel: 20, others: getRealm().settlements });
ok(step.stage === T.PINNACLE && step.bp === 120, "University: the pinnacle after +3");
await G.gmAction({ op: "trackStage", settlementId: capId(), trackId: "learning", stage: T.PINNACLE, userId: "gm" });
ok(T.hasPinnacle(cap(), "learning") && T.kingdomPerks(getRealm().settlements).points.arcane === 3, "pinnacle stacks with the top stage's perks");
await updateRealm((realm) => realm.settlements.push(S.newSettlement({ name: "Second", type: "metropolis" })));
const second = getRealm().settlements.find((s) => s.name === "Second");
ok(second.tracks.homes === 3, "map metropolis starts with Boroughs");
await updateRealm((realm) => (realm.settlements.find((s) => s.name === "Second").tracks.learning = 3));
ok(T.nextStep(getRealm().settlements.find((s) => s.name === "Second"), "learning", { kingdomLevel: 20, others: getRealm().settlements }).blocked === "PinnacleTaken", "only one University per kingdom");
ok(T.nextStep(cap(), "publicworks", { kingdomLevel: 20 }).stage === 0, "public works starts at its starter");
await G.gmAction({ op: "trackStage", settlementId: capId(), trackId: "learning", stage: 3, userId: "gm" });
ok(!T.hasPinnacle(cap(), "learning") && T.trackStage(cap(), "learning") === 3, "GM lowering a pinnacle takes it away");

// Monthly perks: a Magistrate's Court wears down Crime.
await G.gmAction({ op: "trackStage", settlementId: capId(), trackId: "watch", stage: 3, userId: "gm" });
await getKingdom().update({ "abilities.economy.ruin.value": 3 });
const { monthlyTrackPerks } = await import(`${R}/realm/clock.js`);
await monthlyTrackPerks();
ok(getKingdom().abilities.economy.ruin.value === 2, `monthly: Crime −1 (${getKingdom().abilities.economy.ruin.value})`);

// Migration from buildings.
const old = { id: "o", name: "Old", type: "town", buildings: [{ slug: "shrine" }, { slug: "tavern-dive" }, { slug: "marketplace" }, { slug: "houses" }] };
const tr = T.tracksFromBuildings(old, 5);
ok(tr.homes === 1 && tr.faith >= 0 && tr.commerce >= 1 && tr.food >= 1, `old town migrates (${JSON.stringify(tr)})`);
const slugs = T.legacySlugs([{ tracks: { publicworks: 3, faith: 2 } }]);
ok(slugs.includes("sewer-system") && slugs.includes("cemetery"), "legacy slugs for events");

// Panorama renders for every size.
for (const homes of [-1, 0, 1, 2, 3]) {
  const svg = renderPanorama({ id: "p", name: "P", tracks: { homes, faith: 3, walls: 2, food: 1 }, pinnacles: homes === 3 ? ["faith"] : [], waterside: true }, { terrain: "forest" });
  if (!svg.startsWith("<svg") || svg.includes("NaN") || svg.includes("undefined")) ok(false, `panorama homes ${homes}`);
}
ok(true, "panorama renders at every size");
