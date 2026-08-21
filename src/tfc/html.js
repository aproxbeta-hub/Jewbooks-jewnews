/**
 * Outils HTML génériques, sans dépendance et volontairement tolérants.
 *
 * On ne construit pas d'arbre DOM : les pages visées sont écrites par un CMS
 * dont on ignore le détail, et un parseur strict échouerait sur la première
 * balise mal fermée. On extrait donc par motifs, en multipliant les points
 * d'entrée (JSON-LD, JSON embarqué, métadonnées, balises) pour qu'un
 * changement de gabarit ne fasse pas tomber toute la collecte d'un coup.
 */

import { decodeEntities, collapseWhitespace, stripTags } from '../util/text.js';

/** Découpe la liste d'attributs d'une balise ouvrante en objet. */
export function parseAttributes(tagInterior) {
  const attrs = {};
  const motif = /([:@a-zA-Z_][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = motif.exec(tagInterior)) !== null) {
    const nom = m[1].toLowerCase();
    const valeur = m[2] ?? m[3] ?? m[4] ?? '';
    if (!(nom in attrs)) attrs[nom] = decodeEntities(valeur);
  }
  return attrs;
}

/**
 * Parcourt les balises `nom` du document.
 *
 * @returns {Generator<{attrs:Object, interieur:string, brut:string}>}
 *          `interieur` est vide pour les balises auto-fermantes.
 */
export function* balises(html, nom) {
  if (!html) return;
  const ouvrante = new RegExp(`<${nom}\\b([^>]*)>`, 'gi');
  const source = String(html);
  let m;
  while ((m = ouvrante.exec(source)) !== null) {
    const attrs = parseAttributes(m[1]);
    const fermante = source.indexOf(`</${nom}`, ouvrante.lastIndex);
    const interieur = fermante === -1 ? '' : source.slice(ouvrante.lastIndex, fermante);
    yield { attrs, interieur, brut: m[0] };
  }
}

/** Texte visible de la première balise `nom` rencontrée. */
export function texteDe(html, nom) {
  for (const { interieur } of balises(html, nom)) {
    const texte = collapseWhitespace(decodeEntities(stripTags(interieur)));
    if (texte) return texte;
  }
  return '';
}

/** Contenu d'une métadonnée, cherchée sur `name`, `property` puis `itemprop`. */
export function meta(html, cle) {
  const voulu = String(cle).toLowerCase();
  for (const { attrs } of balises(html, 'meta')) {
    const nom = (attrs.name || attrs.property || attrs.itemprop || '').toLowerCase();
    if (nom === voulu && attrs.content) return collapseWhitespace(attrs.content);
  }
  return '';
}

/** Tous les liens du document, texte compris. */
export function liens(html) {
  const out = [];
  const motif = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = motif.exec(String(html || ''))) !== null) {
    const attrs = parseAttributes(m[1]);
    if (!attrs.href) continue;
    out.push({
      href: attrs.href.trim(),
      texte: collapseWhitespace(decodeEntities(stripTags(m[2]))),
      attrs,
    });
  }
  return out;
}

/** Résout `href` contre `base`, ou renvoie null si l'URL est inexploitable. */
export function urlAbsolue(href, base) {
  if (!href) return null;
  const brut = String(href).trim();
  if (!brut || brut.startsWith('#')) return null;
  if (/^(javascript|mailto|tel|data):/i.test(brut)) return null;
  try {
    const url = new URL(brut, base || undefined);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Retire fragment, barre oblique finale et paramètres de campagne. */
export function urlCanonique(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const param of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref)/i.test(param)) u.searchParams.delete(param);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return url;
  }
}

/** JSON.parse tolérant : commentaires HTML, CDATA et virgules finales. */
function jsonTolerant(texte) {
  const nettoye = String(texte || '')
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*(?:\/\/|\/\*)?\s*<!\[CDATA\[\s*(?:\*\/)?/, '')
    .replace(/(?:\/\/|\/\*)?\s*\]\]>\s*(?:\*\/)?\s*$/, '')
    .trim();
  if (!nettoye) return null;
  try {
    return JSON.parse(nettoye);
  } catch {
    try {
      return JSON.parse(nettoye.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

/**
 * Blocs JSON-LD du document, aplatis.
 *
 * Un même bloc peut contenir un tableau ou un `@graph` ; on renvoie les nœuds
 * un par un, ce qui évite à l'appelant d'avoir à connaître ces trois formes.
 */
export function jsonLd(html) {
  const out = [];
  const empiler = (valeur) => {
    if (!valeur || typeof valeur !== 'object') return;
    if (Array.isArray(valeur)) {
      valeur.forEach(empiler);
      return;
    }
    if (Array.isArray(valeur['@graph'])) valeur['@graph'].forEach(empiler);
    out.push(valeur);
  };
  for (const { attrs, interieur } of balises(html, 'script')) {
    if (!/ld\+json/i.test(attrs.type || '')) continue;
    empiler(jsonTolerant(decodeEntities(interieur)));
  }
  return out;
}

/**
 * JSON embarqué par les cadriciels applicatifs.
 *
 * Beaucoup de sites de catalogue sont rendus par Next.js ou Nuxt : quand c'est
 * le cas, la donnée propre est déjà là, sérialisée, et il serait absurde de la
 * relire depuis le HTML compilé.
 */
export function jsonEmbarque(html) {
  const out = [];
  for (const { attrs, interieur } of balises(html, 'script')) {
    const type = (attrs.type || '').toLowerCase();
    const id = (attrs.id || '').toLowerCase();
    if (id === '__next_data__' || (type === 'application/json' && id)) {
      const valeur = jsonTolerant(interieur);
      if (valeur) out.push(valeur);
    }
  }
  const nuxt = /window\.__(?:NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i.exec(
    String(html || ''),
  );
  if (nuxt) {
    const valeur = jsonTolerant(nuxt[1]);
    if (valeur) out.push(valeur);
  }
  return out;
}

/**
 * Parcours en profondeur d'une structure JSON.
 * `visiteur(valeur, cle)` peut renvoyer une valeur à collecter.
 */
export function parcourir(racine, visiteur, out = [], vus = new Set()) {
  if (racine === null || typeof racine !== 'object') return out;
  if (vus.has(racine)) return out;
  vus.add(racine);
  for (const [cle, valeur] of Object.entries(racine)) {
    const trouve = visiteur(valeur, cle, racine);
    if (trouve !== undefined && trouve !== null) out.push(trouve);
    if (valeur && typeof valeur === 'object') parcourir(valeur, visiteur, out, vus);
  }
  return out;
}

/**
 * Lignes de texte du document.
 *
 * Les fiches d'annuaire présentent leurs champs sous forme « Étiquette :
 * valeur », parfois en `<dt>/<dd>`, parfois en `<span>/<span>`. Plutôt que de
 * deviner le balisage, on ramène la page à des lignes et on lit les
 * étiquettes — ce qui survit à un changement de gabarit.
 */
export function lignes(html) {
  const texte = String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(dt|dd|li|p|div|tr|h[1-6]|section|article|td|th|span|label|strong|b)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(texte)
    .split('\n')
    .map((ligne) => collapseWhitespace(ligne))
    .filter(Boolean);
}

/**
 * Valeur associée à l'une des `etiquettes`, sur la même ligne ou la suivante.
 * La comparaison ignore la casse, les deux-points et les espaces.
 */
export function champEtiquete(html, etiquettes) {
  const voulues = etiquettes.map((e) => e.toLowerCase());
  const rangees = lignes(html);
  for (let i = 0; i < rangees.length; i += 1) {
    const ligne = rangees[i];
    for (const etiquette of voulues) {
      const meme = new RegExp(`^${etiquette.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[::]\\s*(.+)$`, 'i');
      const m = meme.exec(ligne);
      if (m && m[1].trim()) return collapseWhitespace(m[1]);
      const seule = ligne.replace(/[::]\s*$/, '').toLowerCase();
      if (seule === etiquette && rangees[i + 1] && rangees[i + 1].length <= 120) {
        return rangees[i + 1];
      }
    }
  }
  return '';
}
