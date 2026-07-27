/**
 * Assemblage de la revue.
 *
 * Enchaînement : collecte -> pertinence -> dédoublonnage -> sélection ->
 * traduction -> mise en rubriques. La traduction vient après la sélection,
 * délibérément : traduire ce qu'on ne publiera pas coûte cher pour rien.
 */

import { loadConfig, buildEuropeanFeeds, buildGlobalFeeds, dedupeFeeds } from './sources.js';
import { collect } from './collect.js';
import { collectBooks } from './books.js';
import { buildAnalyzer } from './relevance.js';
import { grouper, radicauxGeneriques } from './dedupe.js';
import { Traducteur, traduireArticles } from './translate/index.js';
import { hebrewContext } from './hebrew.js';
import { resolveWindow, daysBetween, editionSlug, formatRange } from './util/dates.js';

/** Note d'un groupe d'articles. Sert au classement, jamais au filtrage. */
function noter(cluster, fenetre, maintenant) {
  const article = cluster.principal;
  const pertinence = article.pertinence?.score || 0;

  const jours = article.date ? daysBetween(maintenant, article.date) : 3;
  const duree = Math.max(1, daysBetween(fenetre.end, fenetre.start));
  const fraicheur = Math.max(0, 1 - jours / duree);

  return (
    1.2 * Math.min(pertinence, 12) +
    1.5 * (article.source.poids || 1) +
    1.6 * Math.min(cluster.taille - 1, 4) +
    2.0 * fraicheur +
    (article.image ? 0.3 : 0) +
    (article.resume ? 0.4 : 0) +
    (article.source.origine === 'media' ? 0.6 : 0)
  );
}

/**
 * Projection d'un groupe vers l'objet publié.
 *
 * Le nombre de reprises se compte en **éditeurs distincts**, pas en membres du
 * groupe : un même article remonté par la requête « actualité » et par la
 * requête « antisémitisme » du même pays n'a été repris par personne.
 */
function versEntree(cluster) {
  const a = cluster.principal;
  const autresEditeurs = cluster.editeurs.slice(1);
  return {
    titre: a.titre,
    titreOriginal: a.titreOriginal ?? a.titre,
    resume: a.resume,
    resumeOriginal: a.resumeOriginal ?? a.resume,
    traduit: Boolean(a.traduit),
    lien: a.lien,
    editeur: a.editeur,
    auteur: a.auteur,
    date: a.date ? a.date.toISOString() : null,
    datePrecision: a.datePrecision || (a.date ? 'jour' : null),
    langue: a.langue,
    image: a.image,
    audio: a.audio,
    isbn: a.isbn || null,
    etiquettes: a.etiquettes || [],
    type: a.type,
    pays: a.pays,
    score: Math.round((a.score || 0) * 100) / 100,
    reprises: autresEditeurs.slice(0, 6),
    nbReprises: autresEditeurs.length,
    source: { id: a.source.id, nom: a.source.nom, origine: a.source.origine },
  };
}

/**
 * Génère la revue complète.
 *
 * @param {object} options
 * @param {string[]} [options.pays]        codes ISO à couvrir
 * @param {string[]} [options.profils]     profils de requête Google News
 * @param {number}   [options.parPays]     nombre d'articles retenus par pays
 * @param {number}   [options.aLaUne]      taille de la sélection transversale
 * @param {number}   [options.pertinenceMin] seuil de pertinence
 * @param {string}   [options.traduction]  fournisseur de traduction
 */
export async function genererRevue(options = {}) {
  const {
    cache,
    pays: filtrePays,
    profils = ['actualite', 'antisemitisme'],
    parPays = 6,
    aLaUne = 8,
    maxLivres = 25,
    maxPodcasts = 10,
    maxEvenements = 12,
    pertinenceMin = 3,
    traduction = 'aucun',
    concurrency = 8,
    timeout = 20000,
    googleNews = true,
    medias = true,
    googleBooks = true,
    calendrier = false,
    israel = false,
    onProgress = () => {},
    dir,
  } = options;

  const maintenant = options.maintenant || new Date();
  const fenetre = resolveWindow(options, maintenant);
  const jours = Math.max(1, Math.ceil(daysBetween(fenetre.end, fenetre.start)));

  const config = await loadConfig(dir ? { dir } : {});
  const analyseur = buildAnalyzer(config.langues);

  const feeds = dedupeFeeds([
    ...buildEuropeanFeeds(config, { profils, days: jours, pays: filtrePays, googleNews, medias }),
    ...buildGlobalFeeds(config, { days: jours, googleNews }),
  ]);

  onProgress({ etape: 'collecte', total: feeds.length });
  const { articles, rapport } = await collect(feeds, {
    cache,
    window: fenetre,
    concurrency,
    timeout,
    onProgress: (fait, total) => onProgress({ etape: 'collecte', fait, total }),
  });

  let rapportLivres = [];
  if (googleBooks) {
    onProgress({ etape: 'livres' });
    const resultat = await collectBooks(config, { window: fenetre, timeout });
    articles.push(...resultat.livres);
    rapportLivres = resultat.rapport;
  }

  // --- Pertinence et typage -------------------------------------------------
  onProgress({ etape: 'analyse', total: articles.length });
  const retenus = [];
  let ecartes = 0;
  for (const article of articles) {
    article.pertinence = analyseur.pertinence(article);
    article.type = analyseur.typeDeContenu(article);
    article.etiquettes = analyseur.etiquettes(article);

    // Une source dédiée (musée, éditeur, podcast, média communautaire) est
    // pertinente par construction : on ne lui applique pas le seuil.
    const dispensee =
      article.source.origine === 'media' ||
      article.source.origine === 'google-books' ||
      Boolean(article.source.type);

    if (!dispensee && article.pertinence.score < pertinenceMin) {
      ecartes += 1;
      continue;
    }
    retenus.push(article);
  }

  // --- Dédoublonnage --------------------------------------------------------
  onProgress({ etape: 'dedoublonnage', total: retenus.length });
  const clusters = grouper(retenus, { generiques: radicauxGeneriques(config.langues) });
  for (const cluster of clusters) {
    cluster.score = noter(cluster, fenetre, maintenant);
    cluster.principal.score = cluster.score;
  }
  clusters.sort((a, b) => b.score - a.score);

  // --- Répartition en rubriques --------------------------------------------
  //
  // Règle d'aiguillage, dans cet ordre :
  //  1. une source dédiée (éditeur, podcast, musée) va dans sa rubrique et
  //     nulle part ailleurs : c'est un catalogue ou un agenda, pas de la presse ;
  //  2. tout ce qui vient de la presse d'un pays reste dans ce pays, quel que
  //     soit son sujet — une exposition à Cracovie est une actualité polonaise ;
  //  3. une parution repérée dans la presse est en outre reprise dans la
  //     rubrique Livres, qui se veut mondiale.
  const parType = { livre: [], podcast: [], evenement: [], actualite: [] };
  const parPaysMap = new Map();

  for (const cluster of clusters) {
    const article = cluster.principal;
    const rubriqueForcee = article.source.type;

    if (rubriqueForcee && parType[rubriqueForcee]) {
      parType[rubriqueForcee].push(cluster);
      continue;
    }

    if (article.pays) {
      if (!parPaysMap.has(article.pays.code)) {
        parPaysMap.set(article.pays.code, { ...article.pays, clusters: [] });
      }
      parPaysMap.get(article.pays.code).clusters.push(cluster);
      if (article.type === 'livre') parType.livre.push(cluster);
      continue;
    }

    (parType[article.type] || parType.actualite).push(cluster);
  }

  const sectionsPays = [...parPaysMap.values()]
    .map((entree) => ({ ...entree, clusters: entree.clusters.slice(0, parPays) }))
    .sort((a, b) => {
      const delta = (b.clusters[0]?.score || 0) - (a.clusters[0]?.score || 0);
      return delta !== 0 ? delta : a.nom.localeCompare(b.nom, 'fr');
    });

  const livres = parType.livre.slice(0, maxLivres);
  const podcasts = parType.podcast.slice(0, maxPodcasts);
  const evenements = parType.evenement.slice(0, maxEvenements);

  // « À la une » : le meilleur de chaque pays, sans jamais deux fois le même pays
  // avant que tous les pays représentés aient eu leur tour.
  const une = [];
  const compteurs = new Map();
  for (const tour of [0, 1, 2]) {
    for (const section of sectionsPays) {
      const cluster = section.clusters[tour];
      if (!cluster) continue;
      if (une.length >= aLaUne) break;
      const deja = compteurs.get(section.code) || 0;
      if (deja > tour) continue;
      une.push(cluster);
      compteurs.set(section.code, deja + 1);
    }
    if (une.length >= aLaUne) break;
  }

  // --- Traduction (seulement ce qui sera publié) ----------------------------
  const publies = [
    ...sectionsPays.flatMap((section) => section.clusters),
    ...livres,
    ...podcasts,
    ...evenements,
  ];
  const uniques = [...new Set(publies.map((cluster) => cluster.principal))];

  const traducteur = new Traducteur({ provider: traduction, cache });
  onProgress({ etape: 'traduction', total: uniques.length, provider: traducteur.nom });
  await traduireArticles(uniques, traducteur, {
    onProgress: (fait, total, langue) => onProgress({ etape: 'traduction', fait, total, langue }),
  });

  // --- Sortie ---------------------------------------------------------------
  const rapportComplet = [...rapport, ...rapportLivres];
  const echecs = rapportComplet.filter((ligne) => ligne.statut === 'echec');
  const paysMuets = sectionsPays.length
    ? config.pays
        .filter((p) => p.actif !== false)
        .filter((p) => !filtrePays?.length || filtrePays.map((c) => c.toUpperCase()).includes(p.code))
        .filter((p) => !parPaysMap.has(p.code))
        .map((p) => ({ code: p.code, nom: p.nom }))
    : [];

  return {
    meta: {
      genereLe: maintenant.toISOString(),
      edition: editionSlug(fenetre.start),
      fenetre: {
        debut: fenetre.start.toISOString(),
        fin: fenetre.end.toISOString(),
        libelle: formatRange(fenetre.start, fenetre.end),
        jours,
      },
      traduction: {
        provider: traducteur.nom,
        ...traducteur.stats,
        erreurs: traducteur.erreurs,
      },
      profils,
      stats: {
        // On compte les lignes du rapport, pas les flux configurés : les
        // requêtes Google Books s'y ajoutent et fausseraient le ratio.
        flux: rapportComplet.length,
        fluxOk: rapportComplet.length - echecs.length,
        fluxEnEchec: echecs.length,
        articlesCollectes: articles.length,
        articlesEcartes: ecartes,
        sujets: clusters.length,
        paysCouverts: sectionsPays.length,
      },
    },
    calendrier: calendrier ? hebrewContext(fenetre, { israel }) : null,
    aLaUne: une.map(versEntree),
    pays: sectionsPays.map((section) => ({
      code: section.code,
      nom: section.nom,
      region: section.region,
      articles: section.clusters.map(versEntree),
    })),
    livres: livres.map(versEntree),
    podcasts: podcasts.map(versEntree),
    evenements: evenements.map(versEntree),
    paysSansRemontee: paysMuets,
    rapport: rapportComplet,
  };
}
