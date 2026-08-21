/**
 * Mises en forme de sortie : CSV pour le tableur, JSON pour la reprise
 * programmatique, NDJSON pour les gros volumes, texte pour l'œil.
 */

import { extraireEmails } from './emails.js';
import { liens, jsonLd, jsonEmbarque, meta, texteDe, urlAbsolue } from './html.js';

export const COLONNES = [
  { cle: 'nom', titre: 'nom' },
  { cle: 'email', titre: 'email' },
  { cle: 'contact', titre: 'contact' },
  { cle: 'pays', titre: 'pays' },
  { cle: 'siteWeb', titre: 'site_web' },
  { cle: 'telephone', titre: 'telephone' },
  { cle: 'url', titre: 'fiche' },
  { cle: 'emails', titre: 'emails_secondaires', transformer: (v) => (Array.isArray(v) ? v.slice(1).join(' ') : '') },
];

/**
 * Échappe une cellule CSV.
 *
 * Les valeurs commençant par `= + - @` sont préfixées d'une apostrophe : sans
 * cela, un tableur les interprète comme des formules, ce qui est un vecteur
 * d'exécution connu dès lors que le contenu vient d'une page tierce.
 */
export function cellule(valeur, separateur = ',') {
  let texte = valeur === null || valeur === undefined ? '' : String(valeur);
  if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  return /["\n\r]/.test(texte) || texte.includes(separateur) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

/**
 * Table CSV.
 * @param {{separateur?:string, colonnes?:Array, bom?:boolean}} [options]
 *        `bom` ajoute la marque d'ordre des octets qu'Excel réclame pour lire
 *        de l'UTF-8 sans massacrer les accents.
 */
export function versCsv(societes, options = {}) {
  const { separateur = ',', colonnes = COLONNES, bom = false } = options;
  const ligne = (valeurs) => valeurs.map((v) => cellule(v, separateur)).join(separateur);
  const corps = [ligne(colonnes.map((c) => c.titre))];
  for (const societe of societes) {
    corps.push(ligne(colonnes.map((c) => (c.transformer ? c.transformer(societe[c.cle], societe) : societe[c.cle] ?? ''))));
  }
  return `${bom ? '﻿' : ''}${corps.join('\n')}\n`;
}

/** Document JSON complet, métadonnées de collecte comprises. */
export function versJson(resultat, options = {}) {
  return `${JSON.stringify(
    {
      genere: options.date || new Date().toISOString(),
      source: options.source || '',
      stats: resultat.stats,
      societes: resultat.societes,
      erreurs: resultat.erreurs,
    },
    null,
    2,
  )}\n`;
}

/** Une société par ligne, pour enchaîner avec jq ou un import par lots. */
export function versNdjson(societes) {
  return societes.map((societe) => JSON.stringify(societe)).join('\n') + (societes.length ? '\n' : '');
}

/** Récapitulatif lisible en console. */
export function versTexte(resultat, options = {}) {
  const { societes, erreurs, stats } = resultat;
  const lignes = [];
  const largeur = Math.min(42, Math.max(4, ...societes.map((s) => s.nom.length), 4));
  const max = Number.isFinite(options.max) ? options.max : societes.length;
  for (const societe of societes.slice(0, max)) {
    const nom = societe.nom.padEnd(largeur).slice(0, largeur);
    lignes.push(`${nom}  ${societe.email || '—'}${societe.pays ? `  (${societe.pays})` : ''}`);
  }
  lignes.push('');
  lignes.push(
    `${stats.fiches ?? societes.length} société(s), ${stats.avecEmail ?? societes.filter((s) => s.email).length} avec courriel` +
      `${stats.requetes ? `, ${stats.requetes} requête(s)` : ''}${stats.refus ? `, ${stats.refus} refusée(s) par robots.txt` : ''}`,
  );
  if (erreurs?.length) {
    lignes.push(`${erreurs.length} erreur(s) :`);
    for (const erreur of erreurs.slice(0, 10)) lignes.push(`  ${erreur.etape || ''} ${erreur.url} — ${erreur.message}`);
    if (erreurs.length > 10) lignes.push(`  … et ${erreurs.length - 10} autres`);
  }
  return `${lignes.join('\n')}\n`;
}

/**
 * Rapport d'ajustement pour une page.
 *
 * Le scraper a été écrit sans avoir pu consulter le site : ce rapport dit,
 * page en main, quelles stratégies ont mordu et lesquelles sont restées
 * muettes. C'est ce qu'on lit pour corriger la configuration.
 */
export function rendreDiagnostic(html, societe, config) {
  const l = [];
  l.push(`URL          ${societe.url}`);
  l.push(`Nom          ${societe.nom || '— rien —'}  [${societe.origines.nom || 'aucune stratégie'}]`);
  l.push(`Courriel     ${societe.email || '— rien —'}  [${societe.origines.email || 'aucune stratégie'}]`);
  l.push(`Pays         ${societe.pays || '—'}  [${societe.origines.pays || '—'}]`);
  l.push(`Site         ${societe.siteWeb || '—'}  [${societe.origines.siteWeb || '—'}]`);
  l.push(`Téléphone    ${societe.telephone || '—'}  [${societe.origines.telephone || '—'}]`);
  l.push('');
  l.push('Signaux disponibles dans la page');
  l.push(`  JSON-LD            ${jsonLd(html).length} bloc(s) : ${jsonLd(html).map((n) => n['@type']).join(', ') || '—'}`);
  l.push(`  JSON embarqué      ${jsonEmbarque(html).length} bloc(s)`);
  l.push(`  og:title           ${meta(html, 'og:title') || '—'}`);
  l.push(`  <h1>               ${texteDe(html, 'h1') || '—'}`);
  l.push(`  <title>            ${texteDe(html, 'title') || '—'}`);
  const mailtos = liens(html).filter((lien) => /^mailto:/i.test(lien.href));
  l.push(`  liens mailto:      ${mailtos.length}`);
  const tous = extraireEmails(html, { domaineSite: config.hoteRacine });
  l.push(`  adresses trouvées  ${tous.length}`);
  for (const { email, origine } of tous) l.push(`    ${email}  [${origine}]`);
  const internes = liens(html)
    .map((lien) => urlAbsolue(lien.href, societe.url))
    .filter((url) => {
      if (!url) return false;
      const cible = new URL(url);
      return cible.host === config.hoteRacine && config.reFiche.test(cible.pathname);
    });
  l.push(`  liens de fiche     ${internes.length}${internes.length ? ` (ex. ${internes[0]})` : ''}`);
  return `${l.join('\n')}\n`;
}

export const FORMATS = ['csv', 'json', 'ndjson', 'texte'];
