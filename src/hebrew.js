/**
 * Repère calendaire hébraïque de l'édition (option `--calendrier`).
 * Facultatif : la revue est d'abord une veille de presse, mais dater une
 * édition dans les deux calendriers aide au classement des archives.
 */

import { HDate, HebrewCalendar, Locale, months } from '@hebcal/core';
import '@hebcal/locales';

const MOIS_FR = {
  [months.TISHREI]: 'Tichri',
  [months.CHESHVAN]: 'Hechvan',
  [months.KISLEV]: 'Kislev',
  [months.TEVET]: 'Tévet',
  [months.SHVAT]: 'Chevat',
  [months.ADAR_I]: 'Adar I',
  [months.ADAR_II]: 'Adar II',
  [months.NISAN]: 'Nissan',
  [months.IYYAR]: 'Iyar',
  [months.SIVAN]: 'Sivan',
  [months.TAMUZ]: 'Tamouz',
  [months.AV]: 'Av',
  [months.ELUL]: 'Eloul',
};

/** « 12 Av 5786 » — en Adar, hebcal distingue Adar I et Adar II. */
export function formatHebrewDate(date) {
  const hd = new HDate(date);
  const mois = MOIS_FR[hd.getMonth()] || Locale.gettext(hd.getMonthName(), 'fr') || hd.getMonthName();
  return `${hd.getDate()} ${mois} ${hd.getFullYear()}`;
}

/**
 * Éléments de calendrier pour une fenêtre donnée.
 * @param {{start: Date, end: Date}} fenetre
 * @param {{israel?: boolean}} options
 */
export function hebrewContext(fenetre, { israel = false } = {}) {
  const evenements = HebrewCalendar.calendar({
    start: fenetre.start,
    end: fenetre.end,
    sedrot: true,
    il: israel,
    locale: 'fr',
    noMinorFast: false,
  });

  const parachot = [];
  const fetes = [];

  for (const evenement of evenements) {
    const desc = evenement.getDesc();
    const rendu = evenement.render('fr');
    const date = evenement.getDate().greg();
    if (desc.startsWith('Parashat ')) {
      parachot.push({ nom: rendu.replace(/^Parachah\s+/i, ''), date });
    } else if (evenement.getFlags?.()) {
      fetes.push({ nom: rendu, date });
    }
  }

  return {
    debut: formatHebrewDate(fenetre.start),
    fin: formatHebrewDate(fenetre.end),
    parachot,
    fetes,
  };
}
