/**
 * Découverte des fiches à visiter.
 *
 * Deux voies, complémentaires et rarement bonnes toutes les deux :
 *  - le plan du site (sitemap.xml), qui donne des URL sans dépendre d'un
 *    quelconque balisage — c'est la voie la plus robuste, et la moins coûteuse
 *    pour le serveur ;
 *  - le parcours des pages de liste, qui reste nécessaire quand aucun plan
 *    n'est publié ou qu'il n'énumère pas les sociétés.
 *
 * Les deux renvoient la même forme, l'appelant les fusionne.
 */

import { urlAbsolue, urlCanonique } from './html.js';
import { parseListe } from './parse.js';

/** `<loc>` d'un sitemap ou d'un index de sitemaps. */
export function locs(xml) {
  const out = [];
  const motif = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = motif.exec(String(xml || ''))) !== null) {
    const valeur = m[1]
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
      .replace(/&amp;/g, '&')
      .trim();
    if (valeur) out.push(valeur);
  }
  return out;
}

/** Un document est-il un index renvoyant vers d'autres plans ? */
export function estIndexDePlans(xml) {
  return /<sitemapindex\b/i.test(String(xml || ''));
}

/**
 * Parcourt le plan du site et en retire les URL de fiches.
 *
 * @param {(url:string)=>Promise<{body:string|null}>} recuperer
 * @param {Object} config configuration compilée
 * @param {{plans?:string[], limite?:number, journal?:Function}} [options]
 * @returns {Promise<{urls:string[], plansLus:string[], erreurs:Array}>}
 */
export async function depuisPlan(recuperer, config, options = {}) {
  const { limite = Infinity, journal = () => {} } = options;
  const departs = options.plans?.length
    ? [...options.plans]
    : [new URL('/sitemap.xml', config.racine).toString(), new URL('/sitemap_index.xml', config.racine).toString()];

  const aVoir = [...departs];
  const vus = new Set();
  const urls = new Set();
  const plansLus = [];
  const erreurs = [];

  while (aVoir.length && urls.size < limite) {
    const plan = aVoir.shift();
    const propre = urlCanonique(plan);
    if (vus.has(propre)) continue;
    vus.add(propre);

    let corps;
    try {
      corps = (await recuperer(propre)).body;
    } catch (error) {
      erreurs.push({ url: propre, message: error.message });
      continue;
    }
    if (!corps) continue;
    plansLus.push(propre);
    journal(`plan lu : ${propre}`);

    const trouvees = locs(corps);
    if (estIndexDePlans(corps)) {
      // Un index peut en cacher un autre ; on empile sans distinguer.
      trouvees.forEach((url) => aVoir.push(url));
      continue;
    }
    for (const brute of trouvees) {
      const absolue = urlAbsolue(brute, config.racine);
      if (!absolue) continue;
      const cible = new URL(absolue);
      if (cible.host !== config.hoteRacine) continue;
      if (config.reFiche.test(cible.pathname)) urls.add(urlCanonique(absolue));
      if (urls.size >= limite) break;
    }
  }

  return { urls: [...urls], plansLus, erreurs };
}

/**
 * Parcourt les pages de liste et en retire les URL de fiches.
 *
 * La pagination est suivie par les liens trouvés ; si la page n'en propose
 * aucun, on tente le paramètre configuré (`?page=2`) et l'on s'arrête dès
 * qu'une page n'apporte plus aucune fiche inédite — deux pages stériles
 * d'affilée suffisent à conclure, une seule pouvant n'être qu'un trou.
 */
export async function depuisListe(recuperer, config, options = {}) {
  const { limite = Infinity, maxPages = config.maxPages, journal = () => {} } = options;
  const departs = options.departs?.length
    ? options.departs
    : config.departs.map((chemin) => new URL(chemin, config.racine).toString());

  const aVoir = departs.map((url) => urlCanonique(url));
  const vues = new Set();
  const fiches = new Map();
  const erreurs = [];
  let steriles = 0;

  while (aVoir.length && vues.size < maxPages && fiches.size < limite) {
    const page = aVoir.shift();
    if (vues.has(page)) continue;
    vues.add(page);

    let corps;
    try {
      corps = (await recuperer(page)).body;
    } catch (error) {
      erreurs.push({ url: page, message: error.message });
      continue;
    }
    if (!corps) continue;

    const { fiches: trouvees, pages } = parseListe(corps, { url: page, config });
    let inedites = 0;
    for (const fiche of trouvees) {
      if (fiches.has(fiche.url)) continue;
      fiches.set(fiche.url, fiche);
      inedites += 1;
    }
    journal(`liste ${page} : ${trouvees.length} fiche(s), ${inedites} inédite(s)`);

    if (!inedites) {
      steriles += 1;
      if (steriles >= 2) break;
    } else {
      steriles = 0;
    }

    const suivantes = pages.filter((url) => !vues.has(url));
    if (suivantes.length) {
      aVoir.push(...suivantes);
    } else if (inedites && config.parametrePage) {
      // Pas de lien de pagination : on essaie la page suivante par convention.
      const url = new URL(page);
      const actuelle = Number.parseInt(url.searchParams.get(config.parametrePage) || String(config.premierePage), 10);
      url.searchParams.set(config.parametrePage, String(actuelle + 1));
      const candidate = urlCanonique(url.toString());
      if (!vues.has(candidate)) aVoir.push(candidate);
    }
  }

  return { urls: [...fiches.keys()], fiches: [...fiches.values()], pagesLues: [...vues], erreurs };
}
