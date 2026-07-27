/**
 * Fenêtres temporelles et formatage des dates en français.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Analyse une date issue d'un flux (RFC 822, ISO 8601, variantes).
 * Renvoie null plutôt qu'une Invalid Date : un article sans date reste
 * exploitable, une date fausse pollue tout le classement.
 */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;

  let parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // « Mon, 27 Jul 2026 08:30:00 +0200 » avec un fuseau nommé non standard.
  const withoutNamedZone = raw.replace(/\s+\([^)]*\)\s*$/, '');
  parsed = new Date(withoutNamedZone);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // « 2026-07-27 08:30:00 » (espace au lieu de T).
  const isoish = withoutNamedZone.replace(' ', 'T');
  parsed = new Date(isoish);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Date du jour à minuit, dans le fuseau local du processus. */
export function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/**
 * Semaine « juive » contenant `date` : du dimanche 00:00 au samedi 23:59.
 * C'est le découpage naturel d'une revue hebdomadaire bouclée avant Chabbat.
 */
export function jewishWeek(date = new Date()) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay()); // getDay() : 0 = dimanche
  const end = endOfDay(new Date(start.getTime() + 6 * DAY_MS));
  return { start, end };
}

/** Fenêtre glissante des `days` derniers jours, bornée à maintenant. */
export function slidingWindow(days, now = new Date()) {
  return { start: new Date(now.getTime() - days * DAY_MS), end: now };
}

/** Résout les options de ligne de commande en une fenêtre { start, end }. */
export function resolveWindow({ since, until, week, weekOf, days } = {}, now = new Date()) {
  if (since || until) {
    const start = since ? parseDate(since) : new Date(now.getTime() - 7 * DAY_MS);
    const end = until ? endOfDay(parseDate(until)) : now;
    if (!start) throw new Error(`--depuis : date illisible « ${since} »`);
    if (!end) throw new Error(`--jusqu-a : date illisible « ${until} »`);
    if (start > end) throw new Error('--depuis doit précéder --jusqu-a');
    return { start, end, label: 'personnalisée' };
  }
  if (weekOf) {
    const anchor = parseDate(weekOf);
    if (!anchor) throw new Error(`--semaine-du : date illisible « ${weekOf} »`);
    return { ...jewishWeek(anchor), label: 'semaine' };
  }
  if (week) return { ...jewishWeek(now), label: 'semaine' };
  return { ...slidingWindow(days || 7, now), label: `${days || 7} derniers jours` };
}

export function isWithin(date, { start, end }) {
  if (!date) return false;
  return date >= start && date <= end;
}

export function daysBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

const FR_DATE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const FR_DATE_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const FR_DATE_NUM = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const FR_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const formatLongDate = (date) => FR_DATE.format(date);
export const formatShortDate = (date) => FR_DATE_SHORT.format(date);
export const formatNumericDate = (date) => FR_DATE_NUM.format(date);
export const formatTime = (date) => FR_TIME.format(date);

/** « du 19 au 25 juillet 2026 », en factorisant mois et année quand c'est possible. */
export function formatRange(start, end) {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `du ${start.getDate()} au ${formatShortDate(end)} ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `du ${formatShortDate(start)} au ${formatShortDate(end)} ${end.getFullYear()}`;
  }
  return `du ${formatShortDate(start)} ${start.getFullYear()} au ${formatShortDate(end)} ${end.getFullYear()}`;
}

/** Identifiant d'édition : « 2026-07-19 ». */
export function editionSlug(start) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}
