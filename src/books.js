/**
 * Parutions mondiales via l'API Google Books.
 *
 * Les flux d'éditeurs et de revues littéraires couvrent bien le monde
 * anglophone et mal le reste. Google Books, interrogé par sujet et trié par
 * nouveauté, rattrape les parutions allemandes, italiennes, espagnoles ou
 * françaises qu'aucun flux ne signale.
 *
 * Réserve importante : le champ `publishedDate` de Google Books est souvent
 * imprécis (« 2026 », « 2026-07 »). On distingue donc explicitement les dates
 * exactes des dates approximatives, et la revue le signale au lecteur.
 */

import { fetchJson } from './fetch.js';
import { mapPool } from './util/pool.js';
import { excerpt } from './util/text.js';

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

/**
 * Analyse une date Google Books.
 * @returns {{date: Date|null, precision: 'jour'|'mois'|'annee'|null}}
 */
export function parsePublishedDate(value) {
  if (!value) return { date: null, precision: null };
  const raw = String(value).trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    return { date: new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])), precision: 'jour' };
  }
  match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (match) {
    return { date: new Date(Date.UTC(+match[1], +match[2] - 1, 1)), precision: 'mois' };
  }
  match = /^(\d{4})$/.exec(raw);
  if (match) return { date: new Date(Date.UTC(+match[1], 0, 1)), precision: 'annee' };
  const libre = new Date(raw);
  return Number.isNaN(libre.getTime()) ? { date: null, precision: null } : { date: libre, precision: 'jour' };
}

/** Le volume tombe-t-il dans la fenêtre, compte tenu de sa précision ? */
export function dansLaFenetre({ date, precision }, fenetre) {
  if (!date) return false;
  if (precision === 'jour') return date >= fenetre.start && date <= fenetre.end;
  if (precision === 'mois') {
    // On accepte un mois qui recouvre la fenêtre : une parution datée
    // « 2026-07 » peut parfaitement être celle de la semaine en cours.
    const finDuMois = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59));
    return finDuMois >= fenetre.start && date <= fenetre.end;
  }
  return false; // une date à l'année près n'est pas une actualité de la semaine
}

function versArticle(volume, requete, langue) {
  const info = volume.volumeInfo || {};
  const { date, precision } = parsePublishedDate(info.publishedDate);
  const isbn = (info.industryIdentifiers || []).find((id) => id.type === 'ISBN_13' || id.type === 'ISBN_10');
  const lien = info.canonicalVolumeLink || info.infoLink || null;
  const titre = [info.title, info.subtitle].filter(Boolean).join(' — ');

  return {
    id: `google-books::${volume.id}`,
    titre: titre || '(sans titre)',
    lien,
    lienCanonique: lien,
    guid: volume.id,
    date,
    datePrecision: precision,
    resume: excerpt(info.description || '', 400),
    auteur: (info.authors || []).join(', ') || null,
    image: (info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:') || null,
    audio: null,
    categories: info.categories || [],
    langue: info.language || langue || null,
    editeur: info.publisher || null,
    isbn: isbn?.identifier || null,
    pages: info.pageCount || null,
    pays: null,
    source: {
      id: 'google-books',
      nom: 'Google Books',
      origine: 'google-books',
      poids: 1.5,
      type: 'livre',
      profil: 'livres',
    },
    requete,
  };
}

/**
 * Interroge Google Books et renvoie les parutions de la fenêtre.
 * L'API est publique et sans clé ; une clé (GOOGLE_BOOKS_API_KEY) relève
 * seulement les quotas.
 */
export async function collectBooks(config, { window: fenetre, concurrency = 4, timeout = 20000 } = {}) {
  const params = config?.monde?.googleBooks;
  if (!params || params.actif === false) return { livres: [], rapport: [] };

  const cle = process.env.GOOGLE_BOOKS_API_KEY;
  const combinaisons = [];
  for (const requete of params.requetes || []) {
    for (const langue of params.langues || [null]) {
      combinaisons.push({ requete, langue });
    }
  }

  const resultats = await mapPool(combinaisons, concurrency, async ({ requete, langue }) => {
    const query = new URLSearchParams({
      q: requete,
      orderBy: 'newest',
      printType: 'books',
      maxResults: String(Math.min(40, params.maxParRequete || 40)),
    });
    if (langue) query.set('langRestrict', langue);
    if (cle) query.set('key', cle);

    const reponse = await fetchJson(`${ENDPOINT}?${query.toString()}`, { timeout, retries: 1 });
    const volumes = reponse?.items || [];
    const retenus = volumes
      .map((volume) => versArticle(volume, requete, langue))
      .filter((livre) => livre.lien && dansLaFenetre({ date: livre.date, precision: livre.datePrecision }, fenetre));
    return { requete, langue, total: volumes.length, retenus };
  });

  const livres = [];
  const rapport = [];
  const vus = new Set();

  resultats.forEach((resultat, index) => {
    const { requete, langue } = combinaisons[index];
    if (!resultat.ok) {
      rapport.push({
        id: `google-books:${requete}:${langue || 'toutes'}`,
        nom: `Google Books — ${requete}${langue ? ` (${langue})` : ''}`,
        url: ENDPOINT,
        origine: 'google-books',
        statut: 'echec',
        erreur: resultat.error?.message || String(resultat.error),
        retenus: 0,
        total: 0,
      });
      return;
    }
    let nouveaux = 0;
    for (const livre of resultat.value.retenus) {
      if (vus.has(livre.guid)) continue;
      vus.add(livre.guid);
      livres.push(livre);
      nouveaux += 1;
    }
    rapport.push({
      id: `google-books:${requete}:${langue || 'toutes'}`,
      nom: `Google Books — ${requete}${langue ? ` (${langue})` : ''}`,
      url: ENDPOINT,
      origine: 'google-books',
      statut: 'ok',
      retenus: nouveaux,
      total: resultat.value.total,
    });
  });

  return { livres, rapport };
}
