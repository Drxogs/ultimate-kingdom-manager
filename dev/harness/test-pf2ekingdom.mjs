import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);

// A v0.22 world: PF2e's kingdom on the party, the old realm under the old flag scope, old settings in storage.
const campaign = {
  active: true, name: "Monkeyton", img: "x.webp", capital: "Monkeyton", size: 1, level: 3,
  unrest: { value: 12, anarchyThreshold: 20 }, resources: { fame: { value: 3, max: 3 } },
  abilities: { culture: { ruin: { value: 2, max: 10 }, penalty: 0 }, economy: { ruin: { value: 2, max: 10 }, penalty: 0 }, loyalty: { ruin: { value: 3, max: 10 }, penalty: -1 }, stability: { ruin: { value: 1, max: 12 }, penalty: 0 } },
  leadership: { ruler: { uuid: "Actor.wes" }, warden: { uuid: "Actor.bob" }, counselor: { uuid: "Actor.clorg" }, viceroy: { uuid: null } }
};
env.party._source = { system: { campaign } };
env.party.flags = { "ultimate-kingdom-manager": { realm: {
  version: 1, treasury: 77, stats: { loyalty: { points: 80, rank: 2 }, relations: { points: 60, rank: 2 }, stability: { points: 61, rank: 2 }, community: { points: 60, rank: 2 }, economy: { points: 60, rank: 2 } },
  cards: [{ id: "c1", eventId: "boomtown", name: "Boomtown", seat: "ruler", kind: "opportunity", status: "open", target: {} }, { id: "c2", eventId: "x", name: "Old warden card", seat: "warden", kind: "problem", status: "open", target: {} }],
  settlements: [{ id: "m", name: "Monkeyton", type: "town", capital: true, buildings: [{ slug: "shrine" }, { slug: "tavern-popular" }, { slug: "houses" }, { slug: "town-hall" }, { slug: "founders-hall" }] }],
  founding: { stats: ["loyalty", "economy"] }, log: []
} } };
const stored = [
  { key: "ultimate-kingdom-manager.seatAssignments", value: JSON.stringify({ warden: { companion: "svetlana", supervisor: "Actor.wes" }, treasurer: { companion: "jubilost" } }) },
  { key: "ultimate-kingdom-manager.tapTreasury", value: JSON.stringify("allowed") }
];
game.settings.storage = { get: () => stored };
globalThis.foundry.utils.deepClone = (o) => structuredClone(o);

const L = await import(`${R}/realm/pf2e-kingdom.js`);
const { getRealm } = await import(`${R}/realm/state.js`);
const { getKingdom } = await import(`${R}/integrations/party.js`);

const k = L.kingdomFromPf2e(campaign);
ok(k.unrest.value === 12 && k.resources.fame.value === 3 && k.abilities.loyalty.penalty === -1 && k.abilities.stability.ruin.max === 12, "PF2e numbers read: Unrest, Fame, Ruin, penalties, thresholds");
ok(!k.leadership.viceroy && k.leadership.warden.uuid === "Actor.bob", "leadership kept, empty roles dropped");
ok(L.kingdomFromPf2e({ active: false }) === null, "no built kingdom, nothing to read");

// Startup import: only when this realm has never had its own numbers.
ok(!(await L.importPf2eKingdom()), "a realm that already has its kingdom isn't overwritten");
env.flags["ultimate-kingdom-manager-next.realm"].kingdom.active = false;
ok(await L.importPf2eKingdom(), "a realm without numbers takes them from PF2e once");
ok(getKingdom().unrest.value === 12 && getRealm().kingdomImported, "imported");
ok(!(await L.importPf2eKingdom()), "and only once");

// GM: set the numbers by hand.
const G = await import(`${R}/realm/gm.js`);
await G.gmAction({ op: "adjust", userId: "gm", data: { treasury: "40", unrest: "3", fame: "9", crime: { value: "4", max: "12", penalty: "1" } } });
const kk = getRealm().kingdom;
ok(getRealm().treasury === 40 && kk.unrest.value === 3 && kk.resources.fame.value === 3, "treasury, Unrest and Fame (capped at its max) set");
ok(kk.abilities.economy.ruin.value === 4 && kk.abilities.economy.ruin.max === 12 && kk.abilities.economy.penalty === -1, "a Ruin's value, threshold and penalty set");
