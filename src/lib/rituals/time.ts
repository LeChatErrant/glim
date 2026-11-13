/** Days of the week as Hue names them, Monday first (the order shown in the app). */
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const WEEKDAYS: Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
export const EVERY_DAY: Day[] = [...DAYS];

/** A time of day in minutes after midnight. */
export type Clock = number;

export const clock = (h: number, m = 0): Clock => h * 60 + m;
export const fmtClock = (c: Clock) => `${Math.floor(((c + 1440) % 1440) / 60)}:${String(((c % 60) + 60) % 60).padStart(2, '0')}`;

/** Monday = 0 … Sunday = 6 (JS dates start on Sunday). */
const dayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** "Weekdays", "Every day", "Weekends", "Mon, Wed, Fri", "Once". */
export function daysLabel(days: Day[]) {
  const set = new Set(days);
  if (!set.size) return 'Once';
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && WEEKDAYS.every((d) => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has('saturday') && set.has('sunday')) return 'Weekends';
  return DAYS.filter((d) => set.has(d))
    .map((d) => DAY_NAMES[DAYS.indexOf(d)].slice(0, 3))
    .join(', ');
}

/**
 * The next time `at` comes on one of `days` (no days = the next `at`, today or tomorrow), after
 * `now`. Returns a Date.
 */
export function nextAt(at: Clock, days: Day[], now = new Date()): Date {
  for (let k = 0; k <= 7; k++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, Math.floor(at / 60), at % 60);
    if (d <= now) continue;
    if (!days.length || days.includes(DAYS[dayIndex(d)])) return d;
  }
  return new Date(now.getTime() + 7 * 864e5);
}

/** "Today 22:30", "Tomorrow 7:00", "Friday 7:00". */
export function whenLabel(d: Date, now = new Date()) {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 864e5);
  const t = fmtClock(d.getHours() * 60 + d.getMinutes());
  if (days === 0) return `Today ${t}`;
  if (days === 1) return `Tomorrow ${t}`;
  return `${DAY_NAMES[dayIndex(d)]} ${t}`;
}

/** "tomorrow at 7:00", "today at 22:30", "Friday at 7:00" (to follow a ritual's name). */
export function whenPhrase(d: Date, now = new Date()) {
  const [day, t] = whenLabel(d, now).split(' ');
  return `${day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day} at ${t}`;
}
