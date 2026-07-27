/**
 * Regroupement des doublons.
 *
 * Trois niveaux de doublon coexistent dans cette veille :
 *  1. le même lien remonté par deux requêtes du même pays (actualité et
 *     antisémitisme se recouvrent largement) ;
 *  2. la même dépêche reprise par plusieurs journaux d'un même pays ;
 *  3. le même sujet traité dans deux pays différents — celui-là, on le garde
 *     séparé : c'est précisément ce qu'une revue européenne veut montrer.
 */

import { significantTokens, significantStems, jaccard, trigrams, dice } from './util/text.js';

const SEUIL_JACCARD = 0.55;
const SEUIL_DICE = 0.68;
const SEUIL_INCLUSION = 0.5;
const DISTINCTIFS_MIN = 2;

/** Radicaux communs à deux ensembles. */
function communs(a, b) {
  const partages = [];
  for (const valeur of a) if (b.has(valeur)) partages.push(valeur);
  return partages;
}

/**
 * Deux titres décrivent-ils le même article ?
 *
 * Trois critères, du plus évident au plus subtil.
 *
 * Le troisième est celui qui compte en pratique. Deux rédactions couvrant le
 * même fait gardent le noyau de l'information et divergent sur l'angle :
 * « La synagogue de Rouen visée par un incendie, le parquet ouvre une enquête »
 * et « Incendie à la synagogue de Rouen : la piste criminelle privilégiée » ne
 * partagent que trois radicaux sur six ou sept. Le Jaccard, qui pénalise
 * l'ajout d'angle, les sépare à tort.
 *
 * On regarde donc l'inclusion du titre le plus court dans l'autre, mais en ne
 * comptant que les radicaux **distinctifs**. Dans ce corpus, « synagogue »,
 * « juif » ou « antisémitisme » sont présents partout : ils ne prouvent rien.
 * « Rouen » et « incendie », si. `generiques` porte le vocabulaire de veille,
 * précisément celui qu'il ne faut pas prendre pour un indice d'identité.
 */
export function memeSujet(a, b, generiques = new Set()) {
  const jac = jaccard(a.tokens, b.tokens);
  if (jac >= SEUIL_JACCARD) return true;

  // Dice sur trigrammes : rattrape les reformulations serrées.
  if (jac >= 0.34 && dice(a.grams, b.grams) >= SEUIL_DICE) return true;

  const partages = communs(a.tokens, b.tokens);
  const distinctifs = partages.filter((radical) => !generiques.has(radical));
  if (distinctifs.length < DISTINCTIFS_MIN) return false;

  const plusPetit = Math.min(a.tokens.size, b.tokens.size);
  return plusPetit > 0 && partages.length / plusPetit >= SEUIL_INCLUSION;
}

/**
 * Radicaux à ignorer comme preuve d'identité, dérivés du vocabulaire de veille.
 * @param {object} langues section `langues` de sources/langues.json
 */
export function radicauxGeneriques(langues) {
  const generiques = new Set();
  const ajouter = (terme) => {
    for (const mot of significantTokens(terme)) generiques.add(mot.slice(0, 6));
  };
  for (const vocab of Object.values(langues || {})) {
    for (const groupe of ['noyau', 'antisemitisme', 'culture', 'livres']) {
      for (const terme of vocab[groupe] || []) ajouter(terme);
    }
    for (const groupe of ['noyau', 'antisemitisme']) {
      for (const racine of vocab.racines?.[groupe] || []) ajouter(racine);
    }
  }
  return generiques;
}

/**
 * Regroupe les articles.
 * @param {object[]} articles
 * @param {{generiques?: Set<string>}} [options] radicaux sans valeur d'indice
 * @returns {Array<{principal:object, doublons:object[], editeurs:string[], taille:number}>}
 */
export function grouper(articles, { generiques = new Set() } = {}) {
  // Niveau 1 : lien canonique identique.
  const parLien = new Map();
  const sansLien = [];
  for (const article of articles) {
    const cle = article.lienCanonique;
    if (!cle) {
      sansLien.push([article]);
      continue;
    }
    const bucket = parLien.get(cle);
    if (bucket) bucket.push(article);
    else parLien.set(cle, [article]);
  }

  const preGroupes = [...parLien.values(), ...sansLien];

  // Niveau 2 : titres voisins, à l'intérieur d'un même pays.
  const parPays = new Map();
  for (const groupe of preGroupes) {
    const code = groupe[0].pays?.code || '__monde';
    if (!parPays.has(code)) parPays.set(code, []);
    parPays.get(code).push(groupe);
  }

  const clusters = [];
  for (const groupes of parPays.values()) {
    const locaux = [];
    for (const groupe of groupes) {
      const titre = groupe[0].titre;
      const empreinte = {
        tokens: significantStems(titre),
        mots: significantTokens(titre),
        grams: trigrams(titre),
      };
      // Un titre trop court ne porte pas assez d'information pour être comparé.
      const comparable = empreinte.mots.size >= 3;
      let fusionne = false;
      if (comparable) {
        for (const cluster of locaux) {
          if (cluster.comparable && memeSujet(empreinte, cluster.empreinte, generiques)) {
            cluster.membres.push(...groupe);
            fusionne = true;
            break;
          }
        }
      }
      if (!fusionne) locaux.push({ empreinte, comparable, membres: [...groupe] });
    }
    clusters.push(...locaux);
  }

  return clusters.map(({ membres }) => {
    const tries = [...membres].sort(comparerRepresentants);
    const principal = tries[0];
    const editeurs = [];
    for (const membre of tries) {
      const nom = membre.editeur;
      if (nom && !editeurs.includes(nom)) editeurs.push(nom);
    }
    return {
      principal,
      doublons: tries.slice(1),
      editeurs,
      taille: tries.length,
    };
  });
}

/**
 * Choix du représentant d'un groupe : on privilégie un article daté, avec un
 * résumé, publié par une source de poids, et un lien direct plutôt qu'une
 * redirection Google News.
 */
function comparerRepresentants(a, b) {
  const lienDirect = (x) => (x.source.origine === 'google-news' ? 0 : 1);
  const score = (x) =>
    lienDirect(x) * 4 +
    (x.date ? 2 : 0) +
    (x.resume ? 1.5 : 0) +
    (x.source.poids || 0) +
    (x.image ? 0.5 : 0);
  const delta = score(b) - score(a);
  if (delta !== 0) return delta;
  const dateA = a.date ? a.date.getTime() : 0;
  const dateB = b.date ? b.date.getTime() : 0;
  return dateB - dateA;
}
