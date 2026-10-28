export function secondsPerDay() {
  const days = game.time.calendar?.days;
  if (!days) return 86400;
  return days.hoursPerDay * days.minutesPerHour * days.secondsPerMinute;
}

export function dayNumber(worldTime = game.time.worldTime) {
  return Math.floor(worldTime / secondsPerDay());
}

export function weekNumber(worldTime = game.time.worldTime) {
  return Math.floor(dayNumber(worldTime) / 7);
}

export function monthKey(worldTime = game.time.worldTime) {
  const c = game.time.calendar?.timeToComponents?.(worldTime);
  if (!c) return `m${Math.floor(dayNumber(worldTime) / 30)}`;
  return `${c.year}-${c.month}`;
}

export function daysUntil(worldTime, now = game.time.worldTime) {
  return Math.ceil((worldTime - now) / secondsPerDay());
}

/**
 * An in-game date. With PF2e's world clock (Golarion, e.g. "19 Calistril 4727 AR") when it's there,
 * since Foundry's own calendar shows Earth months and years that look like real dates.
 */
export function formatDate(worldTime) {
  const golarion = pf2eDate(worldTime);
  if (golarion) return golarion;
  const calendar = game.time.calendar;
  const c = calendar?.timeToComponents?.(worldTime);
  if (!c) return `Day ${dayNumber(worldTime) + 1}`;
  const month = calendar.months?.values?.[c.month];
  const monthName = month ? game.i18n.localize(month.name) : `${c.month + 1}`;
  return `${c.dayOfMonth + 1} ${monthName} ${c.year}`;
}

function pf2eDate(worldTime) {
  try {
    const clock = game.pf2e?.worldClock;
    const theme = clock?.dateTheme;
    const config = theme ? CONFIG.PF2E?.worldClock?.[theme] : null;
    const start = clock?.worldCreatedOn;
    if (!config || typeof start?.plus !== "function") return null;
    const when = start.plus({ seconds: worldTime });
    const englishMonth = when.setLocale("en-US").monthLong;
    const monthKey = config.Months?.[englishMonth];
    const month = monthKey ? game.i18n.localize(monthKey) : when.monthLong;
    const era = config.Era ? game.i18n.localize(config.Era) : "";
    return `${when.day} ${month} ${when.year + (config.yearOffset ?? 0)}${era ? ` ${era}` : ""}`;
  } catch {
    return null;
  }
}
