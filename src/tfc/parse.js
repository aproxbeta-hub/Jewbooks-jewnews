/**
 * Lecture des deux sortes de pages : les listes, qui donnent des URL de
 * fiches, et les fiches, dont on tire la raison sociale et le courriel.
 *
 * Chaque champ est cherché par une pile de stratégies, de la plus sûre à la
 * plus approximative, et l'on retient la première qui aboutit. La stratégie
 * gagnante est conservée dans `origines` : quand on ajuste le scraper sur le
 * site réel, savoir *d'où* vient une valeur vaut mieux que la valeur seule.
 */

import { collapseWhitespace } from '../util/text.js';
import {
  liens, meta, texteDe, jsonLd, jsonEmbarque, parcourir,
  urlAbsolue, urlCanonique, champEtiquete,
} from './html.js';
import { extraireEmails } from './emails.js';

const TYPES_SOCIETE = /organization|corporation|localbusiness|company|productioncompany|person/i;

/** Nœuds JSON-LD décrivant une entité, dans l'ordre du document. */
function noeudsSociete(html) {
  return jsonLd(html).filter((noeud) => {
    const type = noeud['@type'];
    const liste = Array.isArray(type) ? type.join(' ') : String(type || '');
    return TYPES_SOCIETE.test(liste);
  });
}

/** Retire le nom de l'annuaire accolé au titre de la page. */
export function nettoyerNom(brut, suffixes = []) {
  let nom = collapseWhitespace(brut || '');
  for (const suffixe of suffixes) {
    const echappe = suffixe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    nom = nom
      .replace(new RegExp(`\\s*[|\\-–—:·]\\s*${echappe}\\s*$`, 'i'), '')
      .replace(new RegExp(`^\\s*${echappe}\\s*[|\\-–—:·]\\s*`, 'i'), '');
  }
  return collapseWhitespace(nom.replace(/^["'«»\s]+|["'«»\s]+$/g, ''));
}

/** Première valeur non vide d'une liste de stratégies `[origine, fonction]`. */
function premiere(strategies) {
  for (const [origine, produire] of strategies) {
    let valeur;
    try {
      valeur = produire();
    } catch {
      valeur = '';
    }
    if (valeur) return { valeur, origine };
  }
  return { valeur: '', origine: '' };
}

/** Chaîne exploitable depuis une valeur JSON-LD (`"FR"` ou `{name:"France"}`). */
function texteJsonLd(valeur) {
  if (!valeur) return '';
  if (typeof valeur === 'string') return collapseWhitespace(valeur);
  if (Array.isArray(valeur)) return texteJsonLd(valeur[0]);
  if (typeof valeur === 'object') return texteJsonLd(valeur.name || valeur['@id'] || valeur.addressCountry || '');
  return '';
}

/**
 * Liens de fiches et pages de liste suivantes.
 *
 * @param {string} html
 * @param {{url:string, config:Object}} contexte
 * @returns {{fiches:Array<{url:string,nom:string}>, pages:string[]}}
 */
export function parseListe(html, { url, config }) {
  const fiches = new Map();
  const pages = new Set();

  for (const lien of liens(html)) {
    const absolue = urlAbsolue(lien.href, url);
    if (!absolue) continue;
    const cible = new URL(absolue);
    if (cible.host !== config.hoteRacine) continue;
    const chemin = cible.pathname;

    if (config.reFiche.test(chemin)) {
      const propre = urlCanonique(absolue);
      const connu = fiches.get(propre);
      // Le texte du lien est souvent la raison sociale : on garde le plus long,
      // les vignettes produisant parfois un lien vide autour d'une image.
      if (!connu || lien.texte.length > connu.nom.length) fiches.set(propre, { url: propre, nom: lien.texte });
      continue;
    }

    const estPagination =
      (config.reListe.test(chemin) && cible.searchParams.has(config.parametrePage)) ||
      /\/page\/\d+\/?$/i.test(chemin) ||
      (lien.attrs.rel || '').toLowerCase() === 'next';
    if (estPagination) pages.add(urlCanonique(absolue));
  }

  const suivante = meta(html, 'next') || '';
  const relNext = /<link\b[^>]*rel=["']?next["']?[^>]*>/i.exec(String(html || ''));
  if (relNext) {
    const href = /href=["']([^"']+)["']/i.exec(relNext[0]);
    const absolue = href && urlAbsolue(href[1], url);
    if (absolue) pages.add(urlCanonique(absolue));
  }
  if (suivante) {
    const absolue = urlAbsolue(suivante, url);
    if (absolue) pages.add(urlCanonique(absolue));
  }

  return { fiches: [...fiches.values()], pages: [...pages] };
}

/**
 * Raison sociale, courriel et champs annexes d'une fiche.
 *
 * @param {string} html
 * @param {{url:string, config:Object}} contexte
 */
export function parseFiche(html, { url, config }) {
  const source = String(html || '');
  const entites = noeudsSociete(source);
  const entite = entites[0] || {};
  const embarque = jsonEmbarque(source);

  const nom = premiere([
    ['json-ld', () => collapseWhitespace(texteJsonLd(entite.name))],
    ['json', () => {
      const trouves = embarque.flatMap((racine) =>
        parcourir(racine, (valeur, cle) =>
          typeof valeur === 'string' && /^(company_?name|companyName|legalName|title|name)$/i.test(String(cle)) && valeur.trim()
            ? collapseWhitespace(valeur)
            : undefined,
        ),
      );
      return trouves[0] || '';
    }],
    ['og', () => meta(source, 'og:title') || meta(source, 'twitter:title')],
    ['h1', () => texteDe(source, 'h1')],
    ['titre', () => texteDe(source, 'title')],
  ]);

  const courriels = extraireEmails(source, { domaineSite: config.hoteRacine });

  const siteWeb = premiere([
    ['json-ld', () => {
      const candidats = [entite.url, ...(Array.isArray(entite.sameAs) ? entite.sameAs : [entite.sameAs])];
      return candidats.map((c) => texteJsonLd(c)).find((c) => estSiteExterne(c, config)) || '';
    }],
    ['etiquette', () => {
      const brut = champEtiquete(source, config.etiquettes.siteWeb);
      if (!brut) return '';
      const propre = /^https?:\/\//i.test(brut) ? brut : `https://${brut.replace(/^\/+/, '')}`;
      return estSiteExterne(propre, config) ? propre : '';
    }],
    ['lien', () => {
      for (const lien of liens(source)) {
        const absolue = urlAbsolue(lien.href, url);
        if (estSiteExterne(absolue, config)) return absolue;
      }
      return '';
    }],
  ]);

  const pays = premiere([
    ['json-ld', () => texteJsonLd(entite.address?.addressCountry || entite.address) || texteJsonLd(entite.location)],
    ['etiquette', () => champEtiquete(source, config.etiquettes.pays)],
  ]);

  const telephone = premiere([
    ['json-ld', () => texteJsonLd(entite.telephone)],
    ['lien', () => {
      const tel = liens(source).find((lien) => /^tel:/i.test(lien.href));
      return tel ? collapseWhitespace(decodeURIComponent(tel.href.slice(4))) : '';
    }],
    ['etiquette', () => champEtiquete(source, config.etiquettes.telephone)],
  ]);

  const contact = champEtiquete(source, config.etiquettes.contact);

  return {
    url: urlCanonique(url),
    nom: nettoyerNom(nom.valeur, config.suffixesTitre),
    email: courriels[0]?.email || '',
    emails: courriels.map((c) => c.email),
    contact: contact && contact.length <= 120 ? contact : '',
    pays: pays.valeur.length <= 80 ? pays.valeur : '',
    siteWeb: siteWeb.valeur,
    telephone: telephone.valeur.length <= 40 ? telephone.valeur : '',
    origines: {
      nom: nom.origine,
      email: courriels[0]?.origine || '',
      pays: pays.origine,
      siteWeb: siteWeb.origine,
      telephone: telephone.origine,
    },
  };
}

/** Un lien mène-t-il au site propre de la société, et non à l'annuaire ou à un réseau ? */
function estSiteExterne(url, config) {
  if (!url) return false;
  let hote;
  try {
    hote = new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (hote === config.hoteRacine.toLowerCase().replace(/^www\./, '')) return false;
  return !config.reseaux.some((reseau) => hote === reseau || hote.endsWith(`.${reseau}`));
}
