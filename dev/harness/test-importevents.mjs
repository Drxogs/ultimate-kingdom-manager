import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const ok = (c, m) => console.log(c ? "ok  " : "FAIL", m);
const { preloadData, getEvents, getStoryEvents } = await import(`${R}/content/data.js`);
await preloadData();
// A Kingdom Events journal with a page for every deck event and for one story event.
const names = new Set([...getEvents().map((e) => e.name), "Cult of the Bloom"]);
const pages = [...names].map((n, i) => ({ id: `p${i}`, name: n }));
const journal = { name: "Kingdom Events", pages: { get: () => null, getName: (n) => pages.find((p) => p.name === n) ?? null, contents: pages } };
const prevGet = game.journal?.get, prevName = game.journal?.getName;
game.journal ??= [];
game.journal.get = () => null;
game.journal.getName = (n) => (n === "Appendix 2c: Kingdom Events" ? journal : null);
const { previewStoryImport } = await import(`${R}/content/story-import.js`);
const preview = previewStoryImport();
const eventMissing = preview.missing.filter((m) => m.startsWith("Kingdom Events"));
ok(eventMissing.length === 0, `no story events reported missing (${eventMissing.join("; ")})`);
ok(getStoryEvents().some((e) => e.name === "Cult of the Bloom"), "a story event with its own page is still there to import");
