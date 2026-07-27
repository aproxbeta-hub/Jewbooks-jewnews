/**
 * Pipeline de traduction vers le français.
 *
 * Contraintes de conception :
 *  - le cache est indispensable : entre deux éditions, l'essentiel des articles
 *    est déjà connu, et retraduire coûte du temps et de l'argent ;
 *  - une panne du traducteur ne doit jamais faire échouer la revue : on retombe
 *    sur le texte d'origine, et on le signale dans le rapport ;
 *  - le texte original est toujours conservé à côté de la traduction, pour que
 *    la rédaction puisse vérifier.
 */

import { creerProvider } from './providers.js';
import { chunk, mapPool } from '../util/pool.js';

/** Le français n'est pas traduit ; le reste l'est. */
const aTraduire = (langue) => Boolean(langue) && langue.toLowerCase().split('-')[0] !== 'fr';

export class Traducteur {
  /**
   * @param {object} options
   * @param {string} options.provider  aucun | anthropic | deepl | libretranslate
   * @param {import('../cache.js').Cache} [options.cache]
   * @param {number} [options.concurrency] lots traduits en parallèle
   */
  constructor(options = {}) {
    this.provider = creerProvider(options.provider, options);
    this.cache = options.cache;
    this.concurrency = options.concurrency ?? 3;
    this.stats = { demandes: 0, cache: 0, traduits: 0, echecs: 0 };
    this.erreurs = [];
  }

  get nom() {
    return this.provider.nom;
  }

  get actif() {
    return this.provider.nom !== 'aucun';
  }

  #cle(texte, langue) {
    return `${this.provider.nom}|${langue || 'auto'}|${texte}`;
  }

  /**
   * Traduit une liste de textes homogènes en langue.
   * Les entrées déjà en cache ne repartent pas sur le réseau.
   */
  async traduireLot(textes, langue) {
    this.stats.demandes += textes.length;
    if (!this.actif || !aTraduire(langue)) return [...textes];

    const resultat = new Array(textes.length);
    const manquants = [];

    for (let i = 0; i < textes.length; i += 1) {
      const texte = textes[i];
      if (!texte || !texte.trim()) {
        resultat[i] = texte;
        continue;
      }
      const enCache = await this.cache?.get('traductions', this.#cle(texte, langue));
      if (typeof enCache === 'string') {
        resultat[i] = enCache;
        this.stats.cache += 1;
      } else {
        manquants.push(i);
      }
    }

    if (!manquants.length) return resultat;

    const lots = chunk(manquants, this.provider.lots || 25);
    const sorties = await mapPool(lots, this.concurrency, async (indices) => {
      const source = indices.map((i) => textes[i]);
      return this.provider.traduire(source, { source: langue });
    });

    for (let l = 0; l < lots.length; l += 1) {
      const indices = lots[l];
      const sortie = sorties[l];
      if (!sortie.ok) {
        this.stats.echecs += indices.length;
        const message = sortie.error?.message || String(sortie.error);
        if (!this.erreurs.includes(message)) this.erreurs.push(message);
        for (const i of indices) resultat[i] = textes[i];
        continue;
      }
      indices.forEach((i, position) => {
        const traduit = sortie.value[position] ?? textes[i];
        resultat[i] = traduit;
        this.stats.traduits += 1;
        void this.cache?.set('traductions', this.#cle(textes[i], langue), traduit);
      });
    }

    return resultat;
  }
}

/**
 * Traduit titres et résumés d'une liste d'articles, en place.
 * Les textes sont groupés par langue : c'est plus économique, et cela permet
 * d'indiquer la langue source au fournisseur qui la gère.
 *
 * Chaque article reçoit `titreOriginal` / `resumeOriginal` (toujours) et
 * `traduit` (booléen).
 */
export async function traduireArticles(articles, traducteur, { onProgress } = {}) {
  for (const article of articles) {
    article.titreOriginal = article.titre;
    article.resumeOriginal = article.resume;
    article.traduit = false;
  }

  if (!traducteur?.actif) return articles;

  const parLangue = new Map();
  for (const article of articles) {
    if (!aTraduire(article.langue)) continue;
    const langue = article.langue.toLowerCase().split('-')[0];
    if (!parLangue.has(langue)) parLangue.set(langue, []);
    parLangue.get(langue).push(article);
  }

  let faits = 0;
  for (const [langue, lot] of parLangue) {
    const titres = await traducteur.traduireLot(lot.map((a) => a.titre), langue);
    const resumes = await traducteur.traduireLot(lot.map((a) => a.resume || ''), langue);
    lot.forEach((article, i) => {
      const titre = titres[i];
      const resume = resumes[i];
      article.traduit = titre !== article.titreOriginal || resume !== article.resumeOriginal;
      article.titre = titre || article.titre;
      article.resume = resume || article.resume;
    });
    faits += lot.length;
    onProgress?.(faits, articles.length, langue);
  }

  return articles;
}
