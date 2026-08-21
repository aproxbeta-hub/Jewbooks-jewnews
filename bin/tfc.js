#!/usr/bin/env node
/**
 * tfc — collecte des sociétés et de leurs courriels sur un annuaire de films.
 *
 * Cible par défaut : thefilmcatalogue.com. Le site n'ayant pas pu être
 * consulté au moment de l'écriture, chaque champ est cherché par plusieurs
 * stratégies et la configuration est externalisée : la commande
 * `tfc diagnostic <url>` dit, page réelle en main, laquelle a mordu.
 */

import { mkdir, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { Cache } from '../src/cache.js';
import { chargerConfig, compiler, CONFIG_DEFAUT } from '../src/tfc/config.js';
import { scraper, analyserFichiers, creerRecuperateur, chargerRobots, Limiteur } from '../src/tfc/scrape.js';
import { parseFiche } from '../src/tfc/parse.js';
import { versCsv, versJson, versNdjson, versTexte, rendreDiagnostic, FORMATS } from '../src/tfc/output.js';

const AIDE = `
tfc — annuaire de sociétés : raison sociale et courriel.

  tfc societes [options]         parcourt le site et écrit les fichiers
  tfc fichiers <chemins…>        analyse des pages HTML déjà enregistrées
  tfc diagnostic <url|fichier>   montre ce que chaque stratégie trouve
  tfc aide                       affiche cette aide

PÉRIMÈTRE
  --limite <n>             nombre maximal de fiches (défaut : sans limite)
  --voie <nom>             auto | plan | liste (défaut : auto)
                           auto  : le plan du site, les listes s'il est muet
                           plan  : sitemap.xml uniquement
                           liste : parcours des pages de liste uniquement
  --url <adresses>         fiches imposées, séparées par des virgules ;
                           la découverte est alors sautée
  --racine <url>           racine du site (défaut : ${CONFIG_DEFAUT.racine})
  --config <fichier>       configuration JSON qui surcharge les défauts
                           (chemins, motifs, étiquettes, réseaux exclus)
  --avec-email             n'écrire que les sociétés ayant un courriel

SORTIE
  --format <liste>         ${FORMATS.join(', ')} (défaut : csv,json)
  --sortie <dossier>       dossier de destination (défaut : dist)
  --nom <base>             base des noms de fichiers (défaut : societes)
  --stdout                 écrire sur la sortie standard
  --separateur <car>       séparateur CSV (défaut : « , » ; « ; » pour Excel FR)
  --bom                    préfixer le CSV du BOM UTF-8 attendu par Excel

POLITESSE
  --delai <ms>             délai entre deux requêtes (défaut : ${CONFIG_DEFAUT.delaiMs})
  --concurrence <n>        requêtes simultanées (défaut : ${CONFIG_DEFAUT.concurrence})
  --delai-requete <ms>     délai maximal par requête (défaut : ${CONFIG_DEFAUT.delaiRequeteMs})
  --sans-robots            ne pas lire robots.txt — à n'utiliser que sur un
                           site dont on a l'autorisation explicite

TECHNIQUE
  --cache <dossier>        dossier de cache (défaut : .cache)
  --sans-cache             ignorer et ne pas écrire le cache
  --vider-cache            vider le cache avant de commencer
  --silencieux             pas de journal de progression

EXEMPLES
  tfc societes --limite 50 --format texte --stdout
  tfc societes --avec-email --separateur ';' --bom --sortie dist
  tfc societes --voie liste --delai 2000 --concurrence 1
  tfc diagnostic https://www.thefilmcatalogue.com/companies/exemple
  tfc fichiers pages/*.html --format csv --stdout
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
  if (valeur === undefined || valeur === true) return defaut;
  const n = Number(valeur);
  if (!Number.isFinite(n)) throw new Error(`Valeur numérique attendue, reçu « ${valeur} »`);
  return n;
};

function journal(silencieux) {
  if (silencieux) return () => {};
  return (message) => process.stderr.write(`${message}\n`);
}

/** Configuration compilée, défauts + fichier + surcharges de la ligne de commande. */
async function preparerConfig(options) {
  const fichier = typeof options.config === 'string' ? options.config : null;
  const config = await chargerConfig(fichier);
  if (typeof options.racine === 'string') config.racine = options.racine;
  config.delaiMs = nombre(options.delai, config.delaiMs);
  config.concurrence = nombre(options.concurrence, config.concurrence);
  config.delaiRequeteMs = nombre(options['delai-requete'], config.delaiRequeteMs);
  config.respecterRobots = !options['sans-robots'];
  return compiler(config);
}

/** Écrit ou affiche les rendus demandés. */
async function ecrire(resultat, options, config) {
  const formats = liste(options.format) || ['csv', 'json'];
  for (const format of formats) {
    if (!FORMATS.includes(format)) {
      throw new Error(`Format inconnu : « ${format} ». Disponibles : ${FORMATS.join(', ')}`);
    }
  }

  const rendus = formats.map((format) => {
    switch (format) {
      case 'csv':
        return {
          extension: 'csv',
          contenu: versCsv(resultat.societes, {
            separateur: typeof options.separateur === 'string' ? options.separateur : ',',
            bom: Boolean(options.bom),
          }),
        };
      case 'json':
        return { extension: 'json', contenu: versJson(resultat, { source: config.racine }) };
      case 'ndjson':
        return { extension: 'ndjson', contenu: versNdjson(resultat.societes) };
      default:
        return { extension: 'txt', contenu: versTexte(resultat) };
    }
  });

  if (options.stdout) {
    for (const rendu of rendus) process.stdout.write(rendu.contenu);
    return;
  }
  const dossier = typeof options.sortie === 'string' ? options.sortie : 'dist';
  const base = typeof options.nom === 'string' ? options.nom : 'societes';
  await mkdir(dossier, { recursive: true });
  for (const rendu of rendus) {
    const fichier = path.join(dossier, `${base}.${rendu.extension}`);
    await writeFile(fichier, rendu.contenu, 'utf8');
    process.stderr.write(`✓ ${fichier}\n`);
  }
}

async function commandeSocietes(options) {
  const log = journal(options.silencieux);
  const config = await preparerConfig(options);
  const cache = new Cache(typeof options.cache === 'string' ? options.cache : '.cache', !options['sans-cache']);
  if (options['vider-cache']) await cache.clear();
  await cache.prune('tfc', 7 * 86400000);

  const resultat = await scraper({
    config,
    cache,
    limite: nombre(options.limite, Infinity),
    voie: typeof options.voie === 'string' ? options.voie : 'auto',
    urls: liste(options.url),
    emailObligatoire: Boolean(options['avec-email']),
    respecterRobots: config.respecterRobots,
    journal: log,
    onProgres: options.silencieux ? undefined : (fait, total) => process.stderr.write(`\r  ${fait}/${total} fiches`),
  });
  if (!options.silencieux) process.stderr.write('\r');
  await cache.flush();

  await ecrire(resultat, options, config);
  log(versTexte(resultat, { max: 0 }).trim());

  if (!resultat.societes.length) {
    log(
      "\nAucune société retenue. Deux causes possibles : le site est injoignable " +
        "depuis cet environnement, ou les motifs d'URL ne correspondent plus. " +
        'Lancez `tfc diagnostic <url d\'une fiche>` pour trancher.',
    );
    process.exitCode = 1;
  }
}

/** Développe un chemin de dossier en la liste de ses pages HTML. */
async function fichiersHtml(chemins) {
  const out = [];
  for (const chemin of chemins) {
    const infos = await stat(chemin);
    if (infos.isDirectory()) {
      const entrees = await readdir(chemin);
      out.push(...entrees.filter((e) => /\.x?html?$/i.test(e)).map((e) => path.join(chemin, e)));
    } else {
      out.push(chemin);
    }
  }
  return out;
}

async function commandeFichiers(options, chemins) {
  if (!chemins.length) throw new Error('Indiquez au moins un fichier ou un dossier de pages HTML.');
  const config = await preparerConfig(options);
  const resultat = await analyserFichiers(await fichiersHtml(chemins), config);
  await ecrire(resultat, options, config);
  journal(options.silencieux)(versTexte(resultat, { max: 0 }).trim());
}

async function commandeDiagnostic(options, cibles) {
  if (!cibles.length) throw new Error("Indiquez l'URL d'une fiche, ou le chemin d'une page enregistrée.");
  const config = await preparerConfig(options);
  const cible = cibles[0];

  let html;
  let url = cible;
  if (/^https?:\/\//i.test(cible)) {
    const stats = {};
    const recuperer = creerRecuperateur({
      config,
      limiteur: new Limiteur(config.delaiMs),
      delaiRequeteMs: config.delaiRequeteMs,
      respecterRobots: config.respecterRobots,
      robots: config.respecterRobots
        ? await chargerRobots(creerRecuperateur({ config, respecterRobots: false, stats }), config)
        : undefined,
      journal: journal(options.silencieux),
      stats,
    });
    const reponse = await recuperer(cible);
    if (!reponse.body) throw new Error(reponse.refuse ? 'robots.txt interdit cette page.' : 'Page vide.');
    html = reponse.body;
    url = reponse.url;
  } else {
    html = await readFile(cible, 'utf8');
    url = new URL(`/${path.basename(cible, path.extname(cible))}`, config.racine).toString();
  }

  const societe = parseFiche(html, { url, config });
  process.stdout.write(rendreDiagnostic(html, societe, config));
}

async function main() {
  const { options, positionnels } = parseArgs(process.argv.slice(2));
  const commande = positionnels[0] || (options.aide || options.help ? 'aide' : 'societes');

  try {
    switch (commande) {
      case 'societes':
      case 'companies':
        if (options.aide || options.help) {
          process.stdout.write(AIDE);
          return;
        }
        await commandeSocietes(options);
        return;
      case 'fichiers':
        await commandeFichiers(options, positionnels.slice(1));
        return;
      case 'diagnostic':
        await commandeDiagnostic(options, positionnels.slice(1));
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
