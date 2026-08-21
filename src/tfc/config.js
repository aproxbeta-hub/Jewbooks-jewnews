/**
 * Configuration du site cible.
 *
 * Elle est isolée du code parce qu'elle est la partie la plus fragile de tout
 * scraper : le jour où l'annuaire renomme `/companies` ou déplace ses fiches,
 * on corrige ce fichier — ou celui que l'on passe à `--config` — sans toucher
 * aux parseurs ni aux tests.
 */

import { readFile } from 'node:fs/promises';

export const CONFIG_DEFAUT = {
  nom: 'The Film Catalogue',
  racine: 'https://www.thefilmcatalogue.com',

  /** Pages d'où partir quand on ne passe pas par le plan du site. */
  departs: ['/companies', '/company', '/sales-agents'],

  /** Une URL de fiche société. Tout le reste est ignoré à la découverte. */
  motifFiche: '^/(?:companies|company|sales-agents)/[^/?#]+/?$',

  /** Une page de liste (pagination comprise). */
  motifListe: '^/(?:companies|company|sales-agents)/?$',

  /** Paramètre de pagination essayé quand aucun lien « suivant » n'est trouvé. */
  parametrePage: 'page',
  premierePage: 1,
  maxPages: 400,

  /** Étiquettes des champs sur une fiche, dans les langues probables. */
  etiquettes: {
    pays: ['Country', 'Countries', 'Pays', 'Location', 'Based in', 'Headquarters', 'Territory'],
    siteWeb: ['Website', 'Web site', 'Web', 'Site', 'Homepage', 'URL'],
    telephone: ['Phone', 'Telephone', 'Tel', 'Téléphone', 'Mobile', 'Cell'],
    adresse: ['Address', 'Adresse', 'Postal address'],
    contact: ['Contact', 'Contacts', 'Contact person', 'Sales contact', 'Main contact'],
    courriel: ['Email', 'E-mail', 'Mail', 'Courriel'],
  },

  /** Retirés du `<title>` pour retrouver la raison sociale. */
  suffixesTitre: ['The Film Catalogue', 'Film Catalogue', 'TFC'],

  /** Jamais retenus comme site web de la société. */
  reseaux: [
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
    'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'imdb.com',
    'wikipedia.org', 'google.com', 'apple.com', 'threads.net',
  ],

  /** Politesse : une requête toutes les N millisecondes, au plus C en vol. */
  delaiMs: 1200,
  concurrence: 2,
  delaiRequeteMs: 20000,
  respecterRobots: true,
};

/** Fusion superficielle, suffisante pour une configuration à un niveau d'objets. */
export function fusionner(base, ajout) {
  const out = { ...base };
  for (const [cle, valeur] of Object.entries(ajout || {})) {
    if (valeur === undefined) continue;
    out[cle] =
      valeur && typeof valeur === 'object' && !Array.isArray(valeur)
        ? fusionner(base[cle] || {}, valeur)
        : valeur;
  }
  return out;
}

/** Lit un fichier JSON de configuration et le fusionne avec les valeurs par défaut. */
export async function chargerConfig(chemin, base = CONFIG_DEFAUT) {
  if (!chemin) return { ...base };
  const contenu = await readFile(chemin, 'utf8');
  let donnees;
  try {
    donnees = JSON.parse(contenu);
  } catch (error) {
    throw new Error(`Configuration illisible (${chemin}) : ${error.message}`);
  }
  return fusionner(base, donnees);
}

/** Compile les motifs en expressions régulières, une fois pour toutes. */
export function compiler(config = CONFIG_DEFAUT) {
  return {
    ...config,
    reFiche: new RegExp(config.motifFiche, 'i'),
    reListe: new RegExp(config.motifListe, 'i'),
    hoteRacine: new URL(config.racine).host,
  };
}
