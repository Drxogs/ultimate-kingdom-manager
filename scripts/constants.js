export const MODULE_ID = "ultimate-kingdom-manager-next";
export const FLAG_SCOPE = MODULE_ID;

export const SEATS = ["ruler", "counselor", "general", "emissary", "magister", "treasurer", "viceroy", "warden"];

/** Each leadership seat owns one realm stat, fed by two kingdom skills. */
export const REALM_STATS = {
  loyalty: { seat: "ruler", skills: ["politics", "intrigue"] },
  culture: { seat: "counselor", skills: ["arts", "folklore"] },
  military: { seat: "general", skills: ["warfare", "defense"] },
  relations: { seat: "emissary", skills: ["statecraft", "boating"] },
  arcane: { seat: "magister", skills: ["magic", "scholarship"] },
  economy: { seat: "treasurer", skills: ["trade", "industry"] },
  community: { seat: "viceroy", skills: ["agriculture", "engineering"] },
  stability: { seat: "warden", skills: ["wilderness", "exploration"] }
};

export const SKILL_TO_STAT = Object.fromEntries(
  Object.entries(REALM_STATS).flatMap(([stat, def]) => def.skills.map((skill) => [skill, stat]))
);

export const POINTS_PER_RANK = 20;

export const DEGREE_POINTS = {
  criticalSuccess: 3,
  success: 2,
  failure: 0,
  criticalFailure: -1
};

export const MISSED_PROBLEM_POINTS = -2;

/** Average value of one resource die, by number of faces. */
export const DIE_AVERAGE = { 4: 2.5, 6: 3.5, 8: 4.5, 10: 5.5, 12: 6.5 };

export const COMMODITY_BP = { lumber: 2, stone: 2, ore: 2, food: 2, luxuries: 4 };

export const CARD_DEADLINE_DAYS = 30;

export const STORY_FOLDER_NAME = "Kingdom Manager: Story (GM)";

export const STORY_CATEGORIES = ["regions", "locations", "events", "quests", "characters", "structures"];

export const KINGMAKER_JOURNALS = {
  gazetteers: ["5QajqjVS7Dm8u7hi", "lMIawppop9uCHRXq", "GRbTr3VTyhezOEhW", "btt2UVnNmyuPWfHF"],
  events: "dAtoyQhSfSBvjr2W",
  quests: "OnxXPMl0iaK9lUp1",
  characters: "PoopszF8pbV8RtX8",
  structures: "BIu4C1T1RR17QNwl"
};

export const KINGMAKER_JOURNAL_NAMES = {
  events: "Appendix 2c: Kingdom Events",
  quests: "Appendix 2d: Quests",
  characters: "Appendix 5: Characters",
  structures: "Appendix 2b: Settlements"
};

/** Standard DC by level (Core Rulebook table 10-5). */
export const LEVEL_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40];

export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** Character skills a leader can use when handling a card personally. */
export const PERSONAL_SKILLS = {
  agriculture: ["nature", "farming-lore"],
  arts: ["performance", "crafting"],
  boating: ["athletics", "sailing-lore"],
  defense: ["athletics", "intimidation"],
  engineering: ["crafting", "engineering-lore"],
  exploration: ["survival"],
  folklore: ["religion", "society"],
  industry: ["crafting"],
  intrigue: ["deception", "thievery"],
  magic: ["arcana", "nature", "occultism", "religion"],
  politics: ["diplomacy", "society"],
  scholarship: ["society"],
  statecraft: ["diplomacy", "society"],
  trade: ["diplomacy", "mercantile-lore"],
  warfare: ["warfare-lore", "intimidation"],
  wilderness: ["survival", "nature"]
};

export const SKILL_ABILITY = {
  agriculture: "stability",
  arts: "culture",
  boating: "economy",
  defense: "stability",
  engineering: "stability",
  exploration: "economy",
  folklore: "culture",
  industry: "economy",
  intrigue: "loyalty",
  magic: "culture",
  politics: "loyalty",
  scholarship: "culture",
  statecraft: "loyalty",
  trade: "economy",
  warfare: "loyalty",
  wilderness: "stability"
};

export const RUINS = ["corruption", "crime", "decay", "strife"];

export const RUIN_ABILITY = { corruption: "culture", crime: "economy", decay: "stability", strife: "loyalty" };

export const ROUTINE_POINTS = 0.5;
export const ROUTINE_ADVISOR_BONUS = 0.25;
export const FOUNDING_PICKS = 2;

export const HIRED_ADVISOR = "hired";
export const HIRED_PENALTY = -2;
export const HIRED_UPKEEP = 1;
export const ATTITUDES = ["hostile", "unfriendly", "indifferent", "friendly", "helpful"];
