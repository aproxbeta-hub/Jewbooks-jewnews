#!/usr/bin/env node
/**
 * jewnews — veille de presse hebdomadaire, pays par pays.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { genererRevue } from '../src/digest.js';
import { loadConfig, buildEuropeanFeeds, buildGlobalFeeds, dedupeFeeds, PROFILS } from '../src/sources.js';
import { collect } from '../src/collect.js';
import { Cache } from '../src/cache.js';
import { FORMATS, renderEmail } from '../src/render/index.js';
import { envoyerRevue, parseDestinataires } from '../src/mail.js';

const AIDE = `
jewnews — revue de presse hebdomadaire : Europe pays par pays, parutions mondiales.

  jewnews revue [options]        établit la revue et écrit les fichiers
  jewnews sources [options]      liste les sources, ou les teste avec --check
  jewnews aide                   affiche cette aide

PÉRIODE
  --jours <n>              fenêtre glissante, en jours (défaut : 7)
  --semaine                semaine en cours, du dimanche au samedi
  --semaine-du <date>      semaine contenant cette date (AAAA-MM-JJ)
  --depuis <date>          borne de début explicite
  --jusqu-a <date>         borne de fin explicite

PÉRIMÈTRE
  --pays <codes>           codes ISO séparés par des virgules (FR,DE,PL…)
                           défaut : tous les pays européens configurés
  --profils <liste>        ${Object.keys(PROFILS).join(', ')}
                           défaut : actualite,antisemitisme
  --sans-google-news       n'interroger que les médias communautaires
  --sans-medias            n'interroger que les requêtes Google News
  --sans-google-books      ne pas interroger l'API Google Books

SÉLECTION
  --par-pays <n>           articles retenus par pays (défaut : 6)
  --a-la-une <n>           taille de la sélection transversale (défaut : 8)
  --livres <n>             parutions retenues (défaut : 25)
  --podcasts <n>           épisodes retenus (défaut : 10)
  --evenements <n>         événements retenus (défaut : 12)
  --pertinence-min <n>     seuil de pertinence juive (défaut : 3)

TRADUCTION
  --traduction <nom>       aucun | anthropic | deepl | libretranslate
                           défaut : aucun
                           clés lues dans ANTHROPIC_API_KEY, DEEPL_API_KEY,
                           LIBRETRANSLATE_URL

SORTIE
  --format <liste>         html, md, json, email, texte (défaut : html,md)
  --sortie <dossier>       dossier de destination (défaut : dist)
  --stdout                 écrire sur la sortie standard au lieu de fichiers
  --calendrier             ajouter le repère du calendrier hébraïque
  --israel                 calendrier selon le rite d'Israël

ENVOI PAR COURRIEL
  --email <adresses>       destinataires, séparés par des virgules
  --de <adresse>           expéditeur (défaut : JEWNEWS_FROM, sinon le
                           premier destinataire)
  --transport <nom>        smtp (défaut) ou resend
  --sujet <texte>          objet du message (défaut : engendré)
  --sans-fichiers          n'écrire aucun fichier, se contenter d'envoyer
  --essai-a-vide           tout préparer et afficher, sans rien envoyer
                           SMTP   : SMTP_URL, ou SMTP_HOST/PORT/USER/PASS
                           Resend : RESEND_API_KEY

TECHNIQUE
  --concurrence <n>        requêtes simultanées (défaut : 8)
  --delai <ms>             délai maximal par requête (défaut : 20000)
  --sans-cache             ignorer et ne pas écrire le cache
  --vider-cache            vider le cache avant de commencer
  --silencieux             pas de journal de progression

EXEMPLES
  jewnews revue --semaine --traduction anthropic
  jewnews revue --semaine --email moi@exemple.fr --sans-fichiers
  jewnews revue --pays FR,DE,PL,HU --jours 14 --format md --stdout
  jewnews sources --check --pays IT
`;

/** Analyse minimale de la ligne de commande : --clé valeur et --drapeau. */
function parseArgs(argv) {
  const options = {};
  const positionnels = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionnels.push(arg);
      continue;
    }
    const [nom, valeurInline] = arg.slice(2).split('=');
    const suivant = argv[i + 1];
    if (valeurInline !== undefined) {
      options[nom] = valeurInline;
    } else if (suivant && !suivant.startsWith('--')) {
      options[nom] = suivant;
      i += 1;
    } else {
      options[nom] = true;
    }
  }
  return { options, positionnels };
}

const liste = (valeur) =>
  typeof valeur === 'string' ? valeur.split(',').map((v) => v.trim()).filter(Boolean) : undefined;

const nombre = (valeur, defaut) => {
  if (valeur === undefined) return defaut;
  const n = Number(valeur);
  if (!Number.isFinite(n)) throw new Error(`Valeur numérique attendue, reçu « ${valeur} »`);
  return n;
};

function journal(silencieux) {
  if (silencieux) return () => {};
  let dernier = '';
  return (message) => {
    if (message === dernier) return;
    dernier = message;
    process.stderr.write(`${message}\n`);
  };
}

async function commandeRevue(options) {
  const silencieux = Boolean(options.silencieux);
  const log = journal(silencieux);

  const cache = new Cache(options.cache || '.cache', !options['sans-cache']);
  if (options['vider-cache']) await cache.clear();
  await cache.prune('http', 7 * 86400000);

  const formats = liste(options.format) || ['html', 'md'];
  for (const format of formats) {
    if (!FORMATS[format]) {
      throw new Error(`Format inconnu : « ${format} ». Disponibles : ${Object.keys(FORMATS).join(', ')}`);
    }
  }

  let derniereEtape = '';
  const revue = await genererRevue({
    cache,
    pays: liste(options.pays),
    profils: liste(options.profils),
    days: nombre(options.jours, 7),
    week: Boolean(options.semaine),
    weekOf: typeof options['semaine-du'] === 'string' ? options['semaine-du'] : undefined,
    since: typeof options.depuis === 'string' ? options.depuis : undefined,
    until: typeof options['jusqu-a'] === 'string' ? options['jusqu-a'] : undefined,
    parPays: nombre(options['par-pays'], 6),
    aLaUne: nombre(options['a-la-une'], 8),
    maxLivres: nombre(options.livres, 25),
    maxPodcasts: nombre(options.podcasts, 10),
    maxEvenements: nombre(options.evenements, 12),
    pertinenceMin: nombre(options['pertinence-min'], 3),
    traduction: typeof options.traduction === 'string' ? options.traduction : 'aucun',
    concurrency: nombre(options.concurrence, 8),
    timeout: nombre(options.delai, 20000),
    googleNews: !options['sans-google-news'],
    medias: !options['sans-medias'],
    googleBooks: !options['sans-google-books'],
    calendrier: Boolean(options.calendrier),
    israel: Boolean(options.israel),
    onProgress: (info) => {
      if (info.etape === 'collecte' && info.fait) {
        log(`  collecte ${info.fait}/${info.total} flux`);
      } else if (info.etape !== derniereEtape) {
        derniereEtape = info.etape;
        const suffixe = info.provider ? ` (${info.provider})` : '';
        log(`▸ ${info.etape}${suffixe}`);
      }
    },
  });

  await cache.flush();

  const rendus = formats.map((format) => ({
    format,
    extension: FORMATS[format].extension,
    contenu: FORMATS[format].rendre(revue),
  }));

  const destinataires = parseDestinataires(
    typeof options.email === 'string' ? options.email : '',
  );

  if (options.stdout) {
    for (const rendu of rendus) process.stdout.write(rendu.contenu);
  } else if (options['sans-fichiers']) {
    if (!destinataires.length) {
      throw new Error('--sans-fichiers sans --email : la revue ne serait envoyée nulle part.');
    }
  } else {
    const dossier = typeof options.sortie === 'string' ? options.sortie : 'dist';
    await mkdir(dossier, { recursive: true });
    const base = `revue-${revue.meta.edition}`;
    for (const rendu of rendus) {
      const fichier = path.join(dossier, `${base}.${rendu.extension}`);
      await writeFile(fichier, rendu.contenu, 'utf8');
      log(`✓ ${fichier}`);
    }
  }

  if (destinataires.length) {
    const message = renderEmail(revue);
    const sujet = typeof options.sujet === 'string' ? options.sujet : message.sujet;

    if (options['essai-a-vide']) {
      log(`\nEssai à vide — aucun message envoyé.`);
      log(`  destinataires : ${destinataires.join(', ')}`);
      log(`  expéditeur    : ${options.de || process.env.JEWNEWS_FROM || destinataires[0]}`);
      log(`  objet         : ${sujet}`);
      log(`  corps         : ${message.html.length} octets HTML, ${message.texte.length} octets texte`);
    } else {
      const resultat = await envoyerRevue(
        {
          a: destinataires,
          de: typeof options.de === 'string' ? options.de : undefined,
          sujet,
          html: message.html,
          texte: message.texte,
        },
        { transport: typeof options.transport === 'string' ? options.transport : 'smtp' },
      );
      log(`✉ envoyée à ${resultat.destinataires.join(', ')} via ${resultat.transport}`);
      if (resultat.refuse?.length) log(`  refusée pour : ${resultat.refuse.join(', ')}`);
    }
  }

  const { stats } = revue.meta;
  log(
    `\n${stats.sujets} sujets · ${stats.paysCouverts} pays · ` +
      `${stats.fluxOk}/${stats.flux} flux · ${revue.livres.length} parutions · ` +
      `${revue.podcasts.length} podcasts · ${revue.evenements.length} événements`,
  );
  if (stats.fluxEnEchec) {
    log(`${stats.fluxEnEchec} flux en échec — détail dans la section « Notes de collecte ».`);
  }
  if (!stats.sujets) {
    log(
      "Aucun sujet retenu. Vérifiez l'accès réseau (`jewnews sources --check`) " +
        'ou élargissez la fenêtre avec --jours.',
    );
  }
}

async function commandeSources(options) {
  const config = await loadConfig();
  const jours = nombre(options.jours, 7);
  const googleNews = !options['sans-google-news'];
  const feeds = dedupeFeeds([
    ...buildEuropeanFeeds(config, {
      profils: liste(options.profils),
      days: jours,
      pays: liste(options.pays),
      googleNews,
      medias: !options['sans-medias'],
    }),
    // `googleNews` vaut aussi pour les requêtes « parutions » mondiales :
    // --sans-google-news ne doit laisser que des flux d'éditeurs.
    ...buildGlobalFeeds(config, { days: jours, googleNews }),
  ]);

  if (!options.check) {
    for (const feed of feeds) {
      const pays = feed.pays ? `[${feed.pays.code}] ` : '[--] ';
      process.stdout.write(`${pays}${feed.id.padEnd(28)} ${feed.nom}\n        ${feed.url}\n`);
    }
    process.stdout.write(`\n${feeds.length} flux configurés.\n`);
    return;
  }

  const cache = new Cache('.cache', false);
  const { rapport } = await collect(feeds, {
    cache,
    concurrency: nombre(options.concurrence, 8),
    timeout: nombre(options.delai, 20000),
    retries: 0,
    onProgress: options.silencieux
      ? undefined
      : (fait, total) => process.stderr.write(`\r  ${fait}/${total}`),
  });
  if (!options.silencieux) process.stderr.write('\r');

  const ok = rapport.filter((l) => l.statut !== 'echec');
  const echecs = rapport.filter((l) => l.statut === 'echec');

  for (const ligne of rapport) {
    const marque = ligne.statut === 'echec' ? '✗' : ligne.total ? '✓' : '·';
    const detail = ligne.statut === 'echec' ? ligne.erreur : `${ligne.total} entrées`;
    process.stdout.write(`${marque} ${ligne.id.padEnd(28)} ${detail}\n`);
  }
  process.stdout.write(`\n${ok.length} flux joignables, ${echecs.length} en échec.\n`);
  if (echecs.length) process.exitCode = 1;
}

async function main() {
  const { options, positionnels } = parseArgs(process.argv.slice(2));
  const commande = positionnels[0] || (options.aide || options.help ? 'aide' : 'revue');

  try {
    switch (commande) {
      case 'revue':
      case 'build':
        if (options.aide || options.help) {
          process.stdout.write(AIDE);
          return;
        }
        await commandeRevue(options);
        return;
      case 'sources':
        await commandeSources(options);
        return;
      case 'aide':
      case 'help':
        process.stdout.write(AIDE);
        return;
      default:
        process.stderr.write(`Commande inconnue : « ${commande} »\n${AIDE}`);
        process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`\nErreur : ${error.message}\n`);
    if (process.env.JEWNEWS_DEBUG) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  }
}

await main();
