import { getStoryEvents } from "../content/data.js";

/*
 * Special cards look different in chat: a coloured edge and a small line with an icon above the title,
 * so trouble, projects, desk matters, audiences and story events stand out from the book's events.
 */
const STYLES = {
  trouble: { icon: "fa-triangle-exclamation", label: "UKM.Trouble.Tag" },
  project: { icon: "fa-hammer", label: "UKM.Chat.Project" },
  matter: { icon: "fa-scroll", label: "UKM.Card.Matter" },
  audience: { icon: "fa-comments", label: "UKM.Chat.Audience" },
  story: { icon: "fa-book-open", label: "UKM.Chat.Story" }
};

export function cardStyleKey(card) {
  if (!card) return null;
  if (card.trouble) return "trouble";
  if (card.kind === "project") return "project";
  if (card.kind === "audience") return "audience";
  if (card.matter) return "matter";
  if (getStoryEvents().some((e) => e.id === card.eventId)) return "story";
  return null;
}

/** Extra classes for the chat card's outer div, e.g. " ukm-chat-trouble". */
export function chatClass(card) {
  const key = cardStyleKey(card);
  return key ? ` ukm-chat-special ukm-chat-${key}` : "";
}

/** The small "⚠ Trouble" line above the title, or "". */
export function chatKicker(card) {
  const key = cardStyleKey(card);
  if (!key) return "";
  const s = STYLES[key];
  return `<p class="ukm-chat-kicker"><i class="fa-solid ${s.icon}"></i> ${game.i18n.localize(s.label)}</p>`;
}
