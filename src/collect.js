/**
 * Récupération et normalisation des articles.
 *
 * Sortie : une liste plate d'objets « article » homogènes, quel que soit le
 * format d'origine, plus un rapport par source. Le rapport est un livrable à
 * part entière : une veille dont trois pays sont muets sans le dire est pire
 * qu'une veille incomplète assumée.
 */

import { parseFeed } from './rss.js';
import { fetchText } from './fetch.js';
import { mapPool } from './util/pool.js';
import { parseDate, isWithin } from './util/dates.js';
import { excerpt, collapseWhitespace, htmlToText } from './util/text.js';

/** Paramètres de suivi supprimés des URLs avant comparaison. */
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_[ce]id|igshid|ref|ref_src|s_cid|cmpid|at_medium|at_campaign|_ga|spm|xtor)/i;

/**
 * Forme canonique d'une URL, utilisée pour le dédoublonnage.
 * Deux liens qui ne diffèrent que par leur traçage sont le même article.
 */
export function canonicalUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.protocol = 'https:';
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    let out = parsed.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    if (parsed.pathname !== '/' && out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return url;
  }
}

/** Nom de domaine lisible, faute de mieux comme nom d'éditeur. */
export function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Google News encode le titre sous la forme « Titre réel - Éditeur ».
 * On récupère l'éditeur, qui est l'information intéressante pour une veille
 * pays par pays : c'est lui, le journal local.
 */
export function splitGoogleNewsTitle(title, sourceName) {
  if (!title) return { titre: title, editeur: sourceName || null };
  if (sourceName) {
    const suffix = ` - ${sourceName}`;
    if (title.endsWith(suffix)) {
      return { titre: title.slice(0, -suffix.length).trim(), editeur: sourceName };
    }
  }
  const index = title.lastIndexOf(' - ');
  if (index > 20 && title.length - index < 60) {
    return { titre: title.slice(0, index).trim(), editeur: title.slice(index + 3).trim() };
  }
  return { titre: title, editeur: sourceName || null };
}

/** Le résumé Google News n'est qu'une liste de liens : inexploitable. */
function cleanSummary(item, origine) {
  if (origine === 'google-news') {
    const text = htmlToText(item.summaryHtml || '');
    // Ne reste que le titre et le nom du journal, répétés : on préfère rien.
    return text.length > 160 ? excerpt(text, 400) : '';
  }
  return excerpt(collapseWhitespace(item.summary || item.content || ''), 400);
}

/** Transforme une entrée de flux en article normalisé. */
export function normalizeItem(item, feed) {
  const origine = feed.origine;
  const { titre, editeur } = origine === 'google-news'
    ? splitGoogleNewsTitle(item.title, item.source)
    : { titre: item.title, editeur: feed.nom };

  const lien = item.link || null;
  const date = parseDate(item.publishedRaw) || parseDate(item.updatedRaw);

  return {
    id: `${feed.id}::${item.guid || lien || titre}`,
    titre: collapseWhitespace(titre) || '(sans titre)',
    lien,
    lienCanonique: canonicalUrl(lien),
    guid: item.guid || lien || titre,
    date,
    resume: cleanSummary(item, origine),
    auteur: item.author || null,
    image: item.image || null,
    audio: item.audio || null,
    categories: item.categories || [],
    langue: feed.langue,
    editeur: editeur || hostname(lien) || feed.nom,
    pays: feed.pays || null,
    source: {
      id: feed.id,
      nom: feed.nom,
      origine,
      poids: feed.poids ?? 1.5,
      type: feed.type || null,
      profil: feed.profil || null,
    },
  };
}

/**
 * Interroge tous les flux et renvoie articles + rapport.
 *
 * @param {Array}  feeds
 * @param {object} options
 * @param {import('./cache.js').Cache} options.cache
 * @param {{start:Date,end:Date}} [options.window] filtre de date appliqué ici
 */
export async function collect(feeds, options = {}) {
  const {
    cache,
    window: fenetre,
    concurrency = 8,
    timeout = 20000,
    retries = 2,
    onProgress,
    toleranceJours = 0,
  } = options;

  const bornes = fenetre
    ? {
        start: new Date(fenetre.start.getTime() - toleranceJours * 86400000),
        end: new Date(fenetre.end.getTime() + 86400000), // dates futures légères tolérées
      }
    : null;

  const results = await mapPool(
    feeds,
    concurrency,
    async (feed) => {
      const cached = await cache?.get('http', feed.url);
      const response = await fetchText(feed.url, {
        timeout,
        retries,
        etag: cached?.etag,
        lastModified: cached?.lastModified,
      });

      let body = response.body;
      if (response.notModified) {
        if (!cached?.body) return { feed, statut: 'inchange', articles: [], total: 0 };
        body = cached.body;
      } else {
        await cache?.set('http', feed.url, {
          etag: response.etag,
          lastModified: response.lastModified,
          body,
          fetchedAt: new Date().toISOString(),
        });
      }

      const parsed = parseFeed(body);
      const articles = [];
      let horsFenetre = 0;
      let sansDate = 0;

      for (const item of parsed.items) {
        const article = normalizeItem(item, feed);
        if (!article.lien) continue;
        if (bornes) {
          if (!article.date) {
            // Sans date, on garde : les flux d'éditeurs et de musées en manquent
            // souvent, et les exclure viderait les rubriques Livres et Événements.
            sansDate += 1;
          } else if (!isWithin(article.date, bornes)) {
            horsFenetre += 1;
            continue;
          }
        }
        articles.push(article);
      }

      return {
        feed,
        statut: response.notModified ? 'inchange' : 'ok',
        format: parsed.format,
        articles,
        total: parsed.items.length,
        horsFenetre,
        sansDate,
      };
    },
    onProgress,
  );

  const articles = [];
  const rapport = [];

  results.forEach((result, index) => {
    const feed = feeds[index];
    if (result.ok) {
      articles.push(...result.value.articles);
      rapport.push({
        id: feed.id,
        nom: feed.nom,
        url: feed.url,
        pays: feed.pays?.code || null,
        origine: feed.origine,
        statut: result.value.statut,
        retenus: result.value.articles.length,
        total: result.value.total,
        horsFenetre: result.value.horsFenetre,
        sansDate: result.value.sansDate,
      });
    } else {
      rapport.push({
        id: feed.id,
        nom: feed.nom,
        url: feed.url,
        pays: feed.pays?.code || null,
        origine: feed.origine,
        statut: 'echec',
        erreur: result.error?.message || String(result.error),
        retenus: 0,
        total: 0,
      });
    }
  });

  return { articles, rapport };
}
