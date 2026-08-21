/**
 * Orchestration : découverte, récupération, analyse.
 *
 * La couche réseau est injectable (`recuperer`) pour deux raisons : les tests
 * tournent hors ligne, et le jour où l'environnement d'exécution impose son
 * propre client HTTP, seul l'appelant change.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { fetchText } from '../fetch.js';
import { mapPool } from '../util/pool.js';
import { parseRobots, autorise, delaiPour, ROBOTS_VIDE } from './robots.js';
import { depuisPlan, depuisListe } from './discover.js';
import { parseFiche } from './parse.js';
import { urlCanonique } from './html.js';

const AGENT = 'jewnews-tfc/1.0 (+https://github.com/aproxbeta-hub/Jewbooks-jewnews)';
const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** Espace les départs de requêtes d'au moins `delaiMs`, quelle que soit la concurrence. */
export class Limiteur {
  constructor(delaiMs = 0) {
    this.delaiMs = Math.max(0, delaiMs);
    this.prochain = 0;
  }

  async attendre() {
    if (!this.delaiMs) return;
    const maintenant = Date.now();
    const creneau = Math.max(maintenant, this.prochain);
    this.prochain = creneau + this.delaiMs;
    const attente = creneau - maintenant;
    if (attente > 0) await new Promise((resolve) => { setTimeout(resolve, attente); });
  }
}

/**
 * Construit la fonction de récupération : robots.txt, limitation de débit,
 * cache conditionnel. Elle renvoie toujours un objet, jamais une exception
 * pour un simple refus de robots.txt — c'est une décision, pas une panne.
 */
export function creerRecuperateur(options = {}) {
  const {
    config,
    cache = null,
    robots = ROBOTS_VIDE,
    limiteur = new Limiteur(0),
    delaiRequeteMs = 20000,
    respecterRobots = true,
    client = fetchText,
    journal = () => {},
    stats = {},
  } = options;

  stats.requetes = stats.requetes || 0;
  stats.cache = stats.cache || 0;
  stats.refus = stats.refus || 0;

  return async function recuperer(url) {
    const cible = new URL(url);
    if (respecterRobots && !autorise(robots, cible.pathname + cible.search, AGENT)) {
      stats.refus += 1;
      journal(`robots.txt interdit ${cible.pathname}`);
      return { url, body: null, status: 0, refuse: true };
    }

    const memorise = cache ? await cache.get('tfc', url) : undefined;
    await limiteur.attendre();
    stats.requetes += 1;

    const reponse = await client(url, {
      accept: ACCEPT_HTML,
      timeout: delaiRequeteMs,
      headers: { 'user-agent': AGENT },
      etag: memorise?.etag,
      lastModified: memorise?.lastModified,
    });

    if (reponse.notModified && memorise?.body) {
      stats.cache += 1;
      return { url, body: memorise.body, status: 304, depuisCache: true };
    }
    if (cache && reponse.body) {
      await cache.set('tfc', url, {
        body: reponse.body,
        etag: reponse.etag,
        lastModified: reponse.lastModified,
        fetchedAt: new Date().toISOString(),
      });
    }
    return { url: reponse.url || url, body: reponse.body, status: reponse.status };
  };
}

/** Charge robots.txt ; son absence n'est pas une erreur. */
export async function chargerRobots(recuperer, config) {
  try {
    const reponse = await recuperer(new URL('/robots.txt', config.racine).toString());
    return reponse.body ? parseRobots(reponse.body) : ROBOTS_VIDE;
  } catch {
    return ROBOTS_VIDE;
  }
}

/** Une société mérite-t-elle d'être retenue ? */
function retenir(societe, { emailObligatoire }) {
  if (!societe) return false;
  if (emailObligatoire && !societe.email) return false;
  return Boolean(societe.nom || societe.email);
}

/**
 * Collecte complète.
 *
 * @param {Object} options
 * @param {Object} options.config       configuration compilée
 * @param {number} [options.limite]     nombre maximal de fiches
 * @param {string} [options.voie]       'auto' | 'plan' | 'liste'
 * @param {string[]} [options.urls]     fiches imposées, la découverte est sautée
 * @returns {Promise<{societes:Array, erreurs:Array, stats:Object}>}
 */
export async function scraper(options = {}) {
  const {
    config,
    limite = Infinity,
    voie = 'auto',
    urls: imposees = null,
    concurrence = config.concurrence,
    delaiMs = config.delaiMs,
    cache = null,
    client = fetchText,
    respecterRobots = config.respecterRobots,
    emailObligatoire = false,
    journal = () => {},
    onProgres = null,
  } = options;

  const stats = { requetes: 0, cache: 0, refus: 0, fiches: 0, avecEmail: 0 };
  const limiteur = new Limiteur(delaiMs);
  const base = { config, cache, limiteur, client, journal, stats, respecterRobots, delaiRequeteMs: config.delaiRequeteMs };

  // robots.txt se lit sans se soumettre à lui-même.
  const recuperateurBrut = creerRecuperateur({ ...base, respecterRobots: false });
  const robots = respecterRobots ? await chargerRobots(recuperateurBrut, config) : ROBOTS_VIDE;
  const declare = delaiPour(robots, AGENT);
  if (declare && declare > limiteur.delaiMs) {
    journal(`robots.txt demande ${declare} ms entre deux requêtes : on s'y tient`);
    limiteur.delaiMs = declare;
  }

  const recuperer = creerRecuperateur({ ...base, robots });
  const erreurs = [];
  const noms = new Map();
  let cibles = [];

  if (imposees?.length) {
    cibles = imposees.map((url) => urlCanonique(url));
  } else {
    if (voie === 'auto' || voie === 'plan') {
      const plan = await depuisPlan(recuperer, config, { limite, journal });
      cibles = plan.urls;
      erreurs.push(...plan.erreurs.map((e) => ({ ...e, etape: 'plan' })));
      journal(`plan du site : ${cibles.length} fiche(s)`);
    }
    if ((voie === 'auto' && !cibles.length) || voie === 'liste') {
      const liste = await depuisListe(recuperer, config, { limite, journal });
      // Le texte des liens de liste donne un nom de repli, précieux quand la
      // fiche elle-même est avare.
      liste.fiches.forEach((fiche) => { if (fiche.nom) noms.set(fiche.url, fiche.nom); });
      cibles = [...new Set([...cibles, ...liste.urls])];
      erreurs.push(...liste.erreurs.map((e) => ({ ...e, etape: 'liste' })));
      journal(`pages de liste : ${liste.urls.length} fiche(s)`);
    }
  }

  cibles = [...new Set(cibles)].slice(0, Number.isFinite(limite) ? limite : undefined);

  const resultats = await mapPool(cibles, concurrence, async (url) => {
    const reponse = await recuperer(url);
    if (!reponse.body) return null;
    const societe = parseFiche(reponse.body, { url, config });
    if (!societe.nom && noms.has(url)) {
      societe.nom = noms.get(url);
      societe.origines.nom = 'liste';
    }
    return societe;
  }, onProgres || undefined);

  const societes = [];
  const vues = new Set();
  resultats.forEach((resultat, index) => {
    if (!resultat.ok) {
      erreurs.push({ url: cibles[index], etape: 'fiche', message: resultat.error.message });
      return;
    }
    const societe = resultat.value;
    if (!retenir(societe, { emailObligatoire })) return;
    // Une même société peut avoir deux URL (slug renommé) : la clé est son
    // courriel quand il existe, son nom sinon.
    const cle = societe.email || societe.nom.toLowerCase();
    if (vues.has(cle)) return;
    vues.add(cle);
    societes.push(societe);
  });

  stats.fiches = societes.length;
  stats.avecEmail = societes.filter((societe) => societe.email).length;
  societes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return { societes, erreurs, stats };
}

/**
 * Analyse des pages déjà enregistrées sur le disque.
 *
 * Utile quand le réseau est fermé, et c'est aussi la façon la plus sûre
 * d'ajuster les sélecteurs : on enregistre une fiche depuis son navigateur,
 * on la relit ici autant de fois qu'il le faut, sans toucher au serveur.
 */
export async function analyserFichiers(chemins, config) {
  const societes = [];
  const erreurs = [];
  for (const chemin of chemins) {
    try {
      const html = await readFile(chemin, 'utf8');
      const url = new URL(`/${path.basename(chemin, path.extname(chemin))}`, config.racine).toString();
      const societe = parseFiche(html, { url, config });
      societes.push({ ...societe, fichier: chemin });
    } catch (error) {
      erreurs.push({ url: chemin, etape: 'fichier', message: error.message });
    }
  }
  return { societes, erreurs, stats: { fiches: societes.length, avecEmail: societes.filter((s) => s.email).length } };
}
