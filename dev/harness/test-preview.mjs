import { env } from "./setup.mjs";
const R = "/home/claude/ukm-repo/scripts";
const { preloadData } = await import(`${R}/content/data.js`);
await preloadData();
const { rankUpChoices } = await import(`${R}/realm/ranks.js`);
for (const stat of ["relations", "economy"]) {
  const c = rankUpChoices({ stat, rank: 1 });
  console.log(stat, c.title, c.options.map((o) => `${o.label}: ${o.lines.join("; ")}${o.warning ? " ! " + o.warning : ""}`));
}
