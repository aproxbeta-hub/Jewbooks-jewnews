/**
 * Lecture de robots.txt.
 *
 * Interroger un annuaire quelques centaines de fois de suite n'est acceptable
 * qu'à deux conditions : respecter ce que le site déclare interdire, et
 * espacer les requêtes. Ce module traite la première ; `scrape.js` la seconde.
 */

/**
 * @typedef {{agents:string[], regles:Array<{autorise:boolean, motif:string}>, delai:number|null}} Groupe
 * @typedef {{groupes:Groupe[], sitemaps:string[]}} Robots
 */

/** Analyse un robots.txt. Les lignes incomprises sont ignorées, comme le veut l'usage. */
export function parseRobots(texte) {
  const groupes = [];
  const sitemaps = [];
  let courant = null;
  let dernierEtaitAgent = false;

  for (const ligneBrute of String(texte || '').split(/\r?\n/)) {
    const ligne = ligneBrute.replace(/#.*$/, '').trim();
    if (!ligne) continue;
    const separateur = ligne.indexOf(':');
    if (separateur === -1) continue;
    const champ = ligne.slice(0, separateur).trim().toLowerCase();
    const valeur = ligne.slice(separateur + 1).trim();

    if (champ === 'sitemap') {
      if (valeur) sitemaps.push(valeur);
      continue;
    }
    if (champ === 'user-agent') {
      // Plusieurs User-agent consécutifs partagent le même groupe de règles.
      if (!courant || !dernierEtaitAgent) {
        courant = { agents: [], regles: [], delai: null };
        groupes.push(courant);
      }
      courant.agents.push(valeur.toLowerCase());
      dernierEtaitAgent = true;
      continue;
    }
    if (!courant) continue;
    dernierEtaitAgent = false;
    if (champ === 'allow' || champ === 'disallow') {
      if (valeur || champ === 'disallow') courant.regles.push({ autorise: champ === 'allow', motif: valeur });
    } else if (champ === 'crawl-delay') {
      const delai = Number.parseFloat(valeur);
      if (Number.isFinite(delai) && delai >= 0) courant.delai = delai * 1000;
    }
  }
  return { groupes, sitemaps };
}

/** Traduit un motif robots (`*` et `$`) en expression régulière ancrée au début. */
function versRegex(motif) {
  const ancre = motif.endsWith('$');
  const corps = (ancre ? motif.slice(0, -1) : motif)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${corps}${ancre ? '$' : ''}`);
}

/** Groupe applicable à un agent : le plus spécifique, sinon `*`, sinon aucun. */
export function groupePour(robots, agent) {
  const cible = String(agent || '').toLowerCase();
  let meilleur = null;
  let generique = null;
  for (const groupe of robots.groupes || []) {
    for (const nom of groupe.agents) {
      if (nom === '*') {
        generique = generique || groupe;
      } else if (cible.includes(nom) && (!meilleur || nom.length > meilleur.longueur)) {
        meilleur = { groupe, longueur: nom.length };
      }
    }
  }
  return meilleur ? meilleur.groupe : generique;
}

/**
 * Le chemin est-il autorisé ?
 *
 * Règle du protocole : c'est le motif le plus long qui l'emporte, et une
 * égalité se tranche en faveur de l'autorisation. Un robots.txt absent ou
 * illisible vaut autorisation — c'est ce que fait tout robot sérieux.
 */
export function autorise(robots, chemin, agent) {
  const groupe = groupePour(robots, agent);
  if (!groupe) return true;
  let decision = true;
  let longueur = -1;
  for (const regle of groupe.regles) {
    if (!regle.motif) continue;
    if (!versRegex(regle.motif).test(chemin)) continue;
    if (regle.motif.length > longueur || (regle.motif.length === longueur && regle.autorise)) {
      decision = regle.autorise;
      longueur = regle.motif.length;
    }
  }
  return decision;
}

/** Délai déclaré pour cet agent, en millisecondes, ou null. */
export function delaiPour(robots, agent) {
  return groupePour(robots, agent)?.delai ?? null;
}

/** Robots permissif, utilisé quand le fichier est absent ou illisible. */
export const ROBOTS_VIDE = { groupes: [], sitemaps: [] };
