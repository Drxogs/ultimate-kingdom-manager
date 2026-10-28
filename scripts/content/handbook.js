import { FLAG_SCOPE, MODULE_ID, REALM_STATS, SEATS } from "../constants.js";
import { describeEffect } from "../realm/effects.js";
import { structureCatalog } from "../realm/projects.js";
import { getAmbition, getCompanions, getProjects, getRankUpScene, getSeatAbilities } from "./data.js";
import { isLeader } from "../realm/leader.js";
import { KINGMAKER_SHEET, kingmakerSheetAvailable } from "./story-import.js";

const FOLDER_NAME = "Kingdom Manager: Handbook";
const BOOKS = {
  player: { name: "Player's Handbook", ownership: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
  gm: { name: "GM's Handbook", ownership: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
};

const esc = (s) => Handlebars.escapeExpression(s ?? "");
const t = (key) => game.i18n.localize(key);

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function effects(list) {
  const lines = (list ?? []).map(describeEffect).filter(Boolean);
  return lines.length ? esc(lines.join("; ")) : "—";
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function rankUpsPage() {
  const parts = ["<p>When a realm stat ranks up, its seat chooses one of three rewards. The effects grow with the new rank.</p>"];
  for (const [stat, def] of Object.entries(REALM_STATS)) {
    const scene = getRankUpScene(stat);
    if (!scene) continue;
    parts.push(`<h2>${esc(t(`UKM.Stat.${stat}`))} (${esc(t(`UKM.Seat.${def.seat}`))}): ${esc(scene.title)}</h2><p><em>${esc(scene.scene)}</em></p>`);
    parts.push(
      table(
        ["Choice", "Ranks 1–3", "Ranks 4–7", "Ranks 8–10"],
        scene.options.map((o) => [`<strong>${esc(o.label)}</strong><br>${esc(o.text)}`, effects(o.effects.low), effects(o.effects.mid), effects(o.effects.high)])
      )
    );
  }
  parts.push("<p>A Stability rank-up also lowers Unrest by 1, whatever is chosen.</p>");
  return { name: "Rank-Up Choices", html: parts.join("") };
}

const WHERE = {
  frontier: "An unclaimed hex next to the realm",
  "claimed-no-road": "A claimed hex without a road",
  "claimed-no-farm": "A claimed hex without farmland or a settlement",
  "claimed-no-camp": "A claimed hex without a work site or settlement",
  "claimed-not-fortified": "A claimed hex that isn't fortified yet",
  none: "Anywhere; once a month",
  settlement: "One of the realm's settlements"
};

function projectsPage() {
  const rows = getProjects().map((p) => [
    `<strong>${esc(p.name)}</strong><br>${esc(p.hook)}`,
    esc(t(`UKM.Seat.${p.seat}`)),
    esc(p.skill.map((s) => t(`UKM.Skill.${s}`)).join(", ")),
    esc(WHERE[p.target] ?? ""),
    p.costWeeks ? `${p.costWeeks} week${p.costWeeks === 1 ? "" : "s"} of base income` : "The structure's cost",
    `${p.workDays} days`
  ]);
  const parts = [table(["Project", "Desk", "Skill", "Where", "Cost", "Work"], rows)];
  const catalog = structureCatalog();
  if (catalog.length) {
    parts.push("<h2>Structures</h2><p>Only structures at or below the kingdom's level can be built.</p>");
    parts.push(
      table(
        ["Structure", "Level", "Cost", "Skill"],
        catalog.map((s) => [esc(s.name), s.level ?? "—", s.bp ? `${s.bp} BP` : "—", s.skill ? esc(t(`UKM.Skill.${s.skill}`)) : "—"])
      )
    );
  }
  return { name: "Project Reference", html: parts.join("") };
}

function companionsPage() {
  const parts = [
    "<p>Each seat can be held by a player character, advised by someone who suits it, or given to a hired advisor. An advisor in a seat always gives that desk's advisor rolls a status bonus (+1, +2 from level 8, +3 from level 16).</p>" +
      "<p>Every seat has a special ability. It appears under that desk's Start project button while a friendly advisor holds the seat. Only the advisor can do it; it takes a week and then can't be used again for 30 days.</p>"
  ];
  parts.push("<p>Advisors are companions and people of the Stolen Lands you meet along the way. Once the party knows someone, the GM can seat them as the advisor of a seat that suits them.</p>");
  const abilities = getSeatAbilities();
  for (const seat of SEATS) {
    const s = abilities[seat];
    if (!s) continue;
    const notes = [
      `${t("UKM.Handbook.Skill")}: ${s.skill.map((x) => t(`UKM.Skill.${x}`)).join(" or ")}`,
      s.cost ? game.i18n.format("UKM.Handbook.Costs", { cost: s.cost }) : ""
    ].filter(Boolean);
    parts.push(`<h2>${esc(t(`UKM.Seat.${seat}`))}: ${esc(s.name)}</h2><p>${esc(String(s.hook).replaceAll("{advisor}", t("UKM.Ability.TheAdvisor")))}</p><p><em>${esc(notes.join(" · "))}</em></p>`);
    parts.push(
      `<ul>${["criticalSuccess", "success", "failure", "criticalFailure"]
        .map((d) => `<li><strong>${esc(t(`UKM.Degree.${d}`))}:</strong> ${effects(s.outcomes[d])}</li>`)
        .join("")}</ul>`
    );
  }
  return { name: "Companion Abilities", html: parts.join("") };
}

function ambitionsPage() {
  const rows = SEATS.map((seat) => {
    const a = getAmbition(seat);
    if (!a) return null;
    const steps = a.tiers.map((tier) =>
      `${esc(game.i18n.format(`UKM.Ambition.Goal.${tier.goal.type}`, { n: tier.goal.n, stat: tier.goal.stat ? t(`UKM.Stat.${tier.goal.stat}`) : "" }))}<br><em>${effects(tier.reward)}</em>`
    );
    return [`<strong>${esc(a.title)}</strong><br>${esc(t(`UKM.Seat.${seat}`))}`, ...steps];
  }).filter(Boolean);
  return {
    name: "Seat Ambitions",
    html: "<p>Each seat works through three goals in order. Reaching one pays its reward and is announced in chat.</p>" + table(["Ambition", "Step 1", "Step 2", "Step 3"], rows)
  };
}

const GENERATED = { rankups: rankUpsPage, projects: projectsPage, companions: companionsPage, ambitions: ambitionsPage };

async function loadIndex() {
  const response = await fetch(`modules/${MODULE_ID}/handbook/index.json`);
  return response.ok ? (await response.json()).pages ?? [] : [];
}

async function pageContent(entry) {
  if (entry.generated) return GENERATED[entry.generated]?.() ?? null;
  const response = await fetch(`modules/${MODULE_ID}/handbook/${entry.file}`);
  return response.ok ? { name: entry.name, html: await response.text() } : null;
}

async function ensureFolder() {
  const existing = game.folders.find((f) => f.type === "JournalEntry" && f.getFlag(FLAG_SCOPE, "handbook"));
  if (existing) return existing;
  return Folder.create({ name: FOLDER_NAME, type: "JournalEntry", color: "#2f4a6b", flags: { [FLAG_SCOPE]: { handbook: true } } });
}

async function ensureJournal(folder, book) {
  const sheetClass = kingmakerSheetAvailable() ? KINGMAKER_SHEET : null;
  const existing = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "handbook") === book);
  if (existing) {
    if (sheetClass && existing.getFlag("core", "sheetClass") !== sheetClass) await existing.setFlag("core", "sheetClass", sheetClass);
    return existing;
  }
  return JournalEntry.create({
    name: BOOKS[book].name,
    folder: folder.id,
    ownership: { default: BOOKS[book].ownership },
    flags: { [FLAG_SCOPE]: { handbook: book }, ...(sheetClass ? { core: { sheetClass } } : {}) }
  });
}

/**
 * Keep the in-game handbooks in step with the module. Pages the GM has
 * edited are left as they are.
 */
export async function ensureHandbook() {
  if (!isLeader()) return;
  const index = await loadIndex();
  if (!index.length) return;
  const folder = await ensureFolder();
  for (const book of Object.keys(BOOKS)) {
    const journal = await ensureJournal(folder, book);
    const keys = new Set(index.filter((e) => e.book === book).map((e) => e.key));
    const existing = new Map();
    const stale = [];
    for (const page of journal.pages.contents.slice().sort((a, b) => a.sort - b.sort)) {
      const key = page.getFlag(FLAG_SCOPE, "handbookKey");
      if (!key) continue;
      const saved = page.getFlag(FLAG_SCOPE, "saved");
      const edited = saved !== undefined && hashText(page.text?.content ?? "") !== saved;
      if ((!keys.has(key) || existing.has(key)) && !edited) stale.push(page.id);
      else if (!existing.has(key)) existing.set(key, page);
    }
    if (stale.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", stale);
    const toCreate = [];
    const toUpdate = [];
    const entries = index.filter((e) => e.book === book);
    for (const [i, entry] of entries.entries()) {
      const content = await pageContent(entry);
      if (!content) continue;
      const hash = hashText(content.html);
      const sort = (i + 1) * 100;
      const page = existing.get(entry.key);
      if (!page) {
        toCreate.push({
          name: content.name,
          type: "text",
          sort,
          title: { show: true, level: 1 },
          text: { content: content.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
          flags: { [FLAG_SCOPE]: { handbookKey: entry.key, hash } }
        });
        continue;
      }
      const saved = page.getFlag(FLAG_SCOPE, "saved");
      const edited = saved !== undefined && hashText(page.text?.content ?? "") !== saved;
      if (!edited && page.getFlag(FLAG_SCOPE, "hash") !== hash) {
        toUpdate.push({ _id: page.id, name: content.name, sort, "text.content": content.html, [`flags.${FLAG_SCOPE}.hash`]: hash });
      }
    }
    const written = [];
    if (toCreate.length) written.push(...(await journal.createEmbeddedDocuments("JournalEntryPage", toCreate)));
    if (toUpdate.length) written.push(...(await journal.updateEmbeddedDocuments("JournalEntryPage", toUpdate)));
    const stamps = written.map((p) => ({ _id: p.id, [`flags.${FLAG_SCOPE}.saved`]: hashText(p.text?.content ?? "") }));
    if (stamps.length) await journal.updateEmbeddedDocuments("JournalEntryPage", stamps);
  }
}

export function openHandbook(book = game.user.isGM ? "gm" : "player") {
  const journal = game.journal.find((j) => j.getFlag(FLAG_SCOPE, "handbook") === book) ?? game.journal.find((j) => j.getFlag(FLAG_SCOPE, "handbook") === "player");
  if (!journal) {
    ui.notifications.warn(game.i18n.localize("UKM.Handbook.Missing"));
    return;
  }
  journal.sheet.render(true);
}
