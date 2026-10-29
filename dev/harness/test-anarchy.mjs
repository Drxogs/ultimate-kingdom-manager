import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const S = await import(`${R}/realm/standing.js`);
const k = game.actors.party.campaign;
k.unrest = { value: 5 };
S.noteUnrest();
k.unrest = { value: 20 }; // typed on the sheet
await S.announceAnarchy();
ok(env.messages.at(-1)?.content.includes("anarchy"), "hand-set Unrest 20 announces anarchy");
const n = env.messages.length;
await S.announceAnarchy();
ok(env.messages.length === n, "announced once");
k.unrest = { value: 12 };
await S.announceAnarchy();
ok(/order/i.test(env.messages.at(-1)?.content ?? ""), "dropping below 20 announces order");
