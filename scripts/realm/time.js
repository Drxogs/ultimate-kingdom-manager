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

export function formatDate(worldTime) {
  const calendar = game.time.calendar;
  const c = calendar?.timeToComponents?.(worldTime);
  if (!c) return `Day ${dayNumber(worldTime) + 1}`;
  const month = calendar.months?.values?.[c.month];
  const monthName = month ? game.i18n.localize(month.name) : `${c.month + 1}`;
  return `${c.dayOfMonth + 1} ${monthName} ${c.year}`;
}
