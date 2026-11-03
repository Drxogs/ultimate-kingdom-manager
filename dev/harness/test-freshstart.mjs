import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { MODULE_ID } = await import(`${R}/constants.js`);
const { getParty } = await import(`${R}/integrations/party.js`);
const { freshStartFromOld, getRealm } = await import(`${R}/realm/state.js`);
const party = getParty();
party.unsetFlag ??= async (s, k) => { delete env.flags[`${s}.${k}`]; };
game.settings.settings = new Map([
  [`${MODULE_ID}.seatAssignments`, { namespace: MODULE_ID, key: "seatAssignments", scope: "world", default: {} }],
  [`${MODULE_ID}.setupComplete`, { namespace: MODULE_ID, key: "setupComplete", scope: "world", default: false }],
  [`${MODULE_ID}.someClient`, { namespace: MODULE_ID, key: "someClient", scope: "client", default: "x" }]
]);
ui.notifications ??= {}; ui.notifications.info = () => {};
const key = `${MODULE_ID}.realm`;
const current = env.flags[key];

// A redesign realm (has its own kingdom numbers) is left alone.
ok((await freshStartFromOld()) === false && env.flags[key] === current, "a 1.0 realm is kept");

// An old 0.x realm: no kingdom block, no seat version.
env.flags[key] = { version: 1, treasury: 77, cards: [{ id: "old" }], stats: {} };
env.settings.set("seatAssignments", { ruler: { companion: "jaethal" } });
env.settings.set("setupComplete", true);
env.settings.set("someClient", "kept");
ok((await freshStartFromOld()) === true, "an old realm is set aside");
ok(!env.flags[key], "the realm flag is cleared");
ok(env.flags[`${MODULE_ID}.realm-v0`]?.treasury === 77, "the old realm is kept as realm-v0");
ok(getRealm().treasury === 0 && getRealm().cards.length === 0, "the new realm starts empty");
ok(JSON.stringify(env.settings.get("seatAssignments")) === "{}" && env.settings.get("setupComplete") === false, "world settings back to defaults");
ok(env.settings.get("someClient") === "kept", "client settings untouched");
ok((await freshStartFromOld()) === false, "runs only once");
