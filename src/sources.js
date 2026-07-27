/**
 * Construction de la liste des flux à interroger.
 *
 * Deux familles de sources cohabitent :
 *
 *  - les **médias communautaires**, peu nombreux mais denses en information ;
 *  - les **requêtes Google News**, une par pays et par langue, qui donnent
 *    accès à la presse locale et nationale de chaque pays européen. C'est le
 *    seul moyen réaliste de couvrir quarante pays sans maintenir à la main un
 *    annuaire de plusieurs milliers de titres régionaux.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SOURCES_DIR = path.join(HERE, '..', 'sources');

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/** Charge les trois fichiers de configuration. */
export async function loadConfig({ dir = SOURCES_DIR } = {}) {
  const [langues, europe, monde] = await Promise.all([
    readJson(path.join(dir, 'langues.json')),
    readJson(path.join(dir, 'europe.json')),
    readJson(path.join(dir, 'monde.json')),
  ]);
  return { langues: langues.langues, pays: europe.pays, monde };
}

/** Met un terme entre guillemets s'il contient une espace. */
const quote = (term) => (/\s/.test(term) ? `"${term}"` : term);

/**
 * Assemble une requête Google News : un groupe OR de termes, éventuellement
 * croisé avec un second groupe, plus la fenêtre temporelle.
 */
export function buildQuery(groupA, groupB, days) {
  const a = `(${groupA.map(quote).join(' OR ')})`;
  const b = groupB?.length ? ` (${groupB.map(quote).join(' OR ')})` : '';
  const when = days ? ` when:${Math.max(1, Math.ceil(days))}d` : '';
  return `${a}${b}${when}`;
}

export function googleNewsUrl(query, { hl, gl, ceid }) {
  const params = new URLSearchParams({ q: query, hl, gl, ceid });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/** Profils de requête disponibles pour la veille pays. */
export const PROFILS = {
  actualite: {
    label: 'actualité communautaire',
    groupes: (vocab) => [vocab.noyau, null],
  },
  antisemitisme: {
    label: 'antisémitisme et mémoire',
    groupes: (vocab) => [vocab.antisemitisme, null],
  },
  culture: {
    label: 'culture et vie intellectuelle',
    groupes: (vocab) => [vocab.noyau, vocab.culture],
  },
  livres: {
    label: 'parutions',
    groupes: (vocab) => [vocab.noyau, vocab.livres],
  },
};

/**
 * Liste des flux pour la veille européenne.
 *
 * @param {object}   config          issu de loadConfig()
 * @param {object}   options
 * @param {string[]} options.profils profils de requête à générer
 * @param {number}   options.days    fenêtre, injectée dans `when:Nd`
 * @param {string[]} [options.pays]  codes ISO à retenir (défaut : tous les actifs)
 * @param {boolean}  [options.googleNews] false pour n'utiliser que les médias
 * @param {boolean}  [options.medias]     false pour n'utiliser que Google News
 */
export function buildEuropeanFeeds(config, options = {}) {
  const {
    profils = ['actualite', 'antisemitisme'],
    days = 7,
    pays: filtre,
    googleNews = true,
    medias = true,
  } = options;

  const wanted = filtre?.length ? new Set(filtre.map((code) => code.toUpperCase())) : null;
  const feeds = [];

  for (const pays of config.pays) {
    if (pays.actif === false && !wanted?.has(pays.code)) continue;
    if (wanted && !wanted.has(pays.code)) continue;

    const contexte = { code: pays.code, nom: pays.nom, region: pays.region || null };

    if (googleNews) {
      for (const edition of pays.editions || []) {
        const vocab = config.langues[edition.langue];
        if (!vocab) {
          throw new Error(
            `Langue « ${edition.langue} » (${pays.nom}) absente de sources/langues.json`,
          );
        }
        for (const profil of profils) {
          const spec = PROFILS[profil];
          if (!spec) throw new Error(`Profil de requête inconnu : « ${profil} »`);
          const [groupA, groupB] = spec.groupes(vocab);
          if (!groupA?.length) continue;
          const query = buildQuery(groupA, groupB, days);
          feeds.push({
            id: `gn-${pays.code.toLowerCase()}-${edition.langue}-${profil}`,
            nom: `${pays.nom} — presse ${vocab.nom} (${spec.label})`,
            url: googleNewsUrl(query, edition),
            langue: edition.langue,
            poids: pays.poids ?? 1.5,
            origine: 'google-news',
            profil,
            pays: contexte,
            type: profil === 'livres' ? 'livre' : null,
          });
        }
      }
    }

    if (medias) {
      for (const media of pays.medias || []) {
        if (media.actif === false) continue;
        feeds.push({
          id: media.id,
          nom: media.nom,
          url: media.url,
          langue: media.langue,
          poids: media.poids ?? pays.poids ?? 1.5,
          origine: 'media',
          profil: null,
          pays: contexte,
          type: media.type || null,
        });
      }
    }
  }

  return feeds;
}

/** Flux mondiaux : livres, podcasts, événements. */
export function buildGlobalFeeds(config, options = {}) {
  const { days = 7, rubriques = ['livres', 'podcasts', 'evenements'], googleNews = true } = options;
  const feeds = [];

  for (const rubrique of rubriques) {
    for (const source of config.monde[rubrique] || []) {
      if (source.actif === false) continue;
      feeds.push({
        id: source.id,
        nom: source.nom,
        url: source.url,
        langue: source.langue,
        poids: source.poids ?? 1.5,
        origine: 'monde',
        profil: rubrique,
        pays: null,
        type: source.type || null,
      });
    }
  }

  if (googleNews && rubriques.includes('livres')) {
    for (const edition of config.monde.requetesLivres || []) {
      const vocab = config.langues[edition.langue];
      if (!vocab) continue;
      feeds.push({
        id: `gn-livres-${edition.ceid.replace(':', '-').toLowerCase()}`,
        nom: `Parutions — presse ${vocab.nom} (${edition.gl})`,
        url: googleNewsUrl(buildQuery(vocab.noyau, vocab.livres, days), edition),
        langue: edition.langue,
        poids: 1.5,
        origine: 'google-news',
        profil: 'livres',
        pays: null,
        type: 'livre',
      });
    }
  }

  return feeds;
}

/** Retire les doublons d'URL, en gardant la source de plus fort poids. */
export function dedupeFeeds(feeds) {
  const byUrl = new Map();
  for (const feed of feeds) {
    const existing = byUrl.get(feed.url);
    if (!existing || (feed.poids ?? 0) > (existing.poids ?? 0)) byUrl.set(feed.url, feed);
  }
  return [...byUrl.values()];
}
