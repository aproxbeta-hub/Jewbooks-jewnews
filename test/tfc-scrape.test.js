import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { compiler, CONFIG_DEFAUT, fusionner, chargerConfig } from '../src/tfc/config.js';
import { scraper, analyserFichiers, Limiteur } from '../src/tfc/scrape.js';
import { depuisPlan, depuisListe, locs, estIndexDePlans } from '../src/tfc/discover.js';

const RACINE = 'https://annuaire.test';
const config = compiler({ ...CONFIG_DEFAUT, racine: RACINE, delaiMs: 0, concurrence: 2 });

const fiche = (nom, email, pays) => `
  <html><head><title>${nom} | The Film Catalogue</title></head>
  <body><h1>${nom}</h1>
    <dl><dt>Country</dt><dd>${pays}</dd></dl>
    <a href="mailto:${email}">Écrire</a>
  </body></html>`;

const SITE = {
  [`${RACINE}/robots.txt`]: 'User-agent: *\nDisallow: /companies/gamma\nSitemap: https://annuaire.test/sitemap.xml',
  [`${RACINE}/sitemap.xml`]: `<?xml version="1.0"?><sitemapindex>
      <sitemap><loc>https://annuaire.test/sitemap-societes.xml</loc></sitemap>
    </sitemapindex>`,
  [`${RACINE}/sitemap-societes.xml`]: `<?xml version="1.0"?><urlset>
      <url><loc>https://annuaire.test/companies/alpha</loc></url>
      <url><loc>https://annuaire.test/companies/beta</loc></url>
      <url><loc>https://annuaire.test/companies/gamma</loc></url>
      <url><loc>https://annuaire.test/films/un-film</loc></url>
      <url><loc>https://ailleurs.test/companies/intrus</loc></url>
    </urlset>`,
  [`${RACINE}/companies/alpha`]: fiche('Alpha Films', 'sales@alpha-films.fr', 'France'),
  [`${RACINE}/companies/beta`]: fiche('Beta Sales', 'anna@beta-sales.de', 'Germany'),
  [`${RACINE}/companies/gamma`]: fiche('Gamma', 'x@gamma.it', 'Italy'),
  [`${RACINE}/companies`]: `<a href="/companies/alpha">Alpha Films</a><a href="/companies?page=2">2</a>`,
  [`${RACINE}/companies?page=2`]: `<a href="/companies/beta">Beta Sales</a>`,
};

/** Client HTTP de substitution : le site tient dans un objet. */
function client(journal = []) {
  return async (url) => {
    journal.push(url);
    const corps = SITE[url];
    if (corps === undefined) {
      const erreur = new Error(`HTTP 404 ${url}`);
      erreur.status = 404;
      throw erreur;
    }
    return { status: 200, body: corps, notModified: false, url };
  };
}

test('locs et estIndexDePlans lisent un plan de site', () => {
  assert.deepEqual(locs('<url><loc>https://a.test/x</loc></url><url><loc><![CDATA[https://a.test/y]]></loc></url>'), [
    'https://a.test/x',
    'https://a.test/y',
  ]);
  assert.ok(estIndexDePlans(SITE[`${RACINE}/sitemap.xml`]));
  assert.ok(!estIndexDePlans(SITE[`${RACINE}/sitemap-societes.xml`]));
});

test('depuisPlan suit l’index et ne garde que les fiches du domaine', async () => {
  const { urls, plansLus } = await depuisPlan(client(), config, {});
  assert.deepEqual(urls, [`${RACINE}/companies/alpha`, `${RACINE}/companies/beta`, `${RACINE}/companies/gamma`]);
  assert.equal(plansLus.length, 2);
});

test('depuisListe suit la pagination et s’arrête quand elle ne rapporte plus rien', async () => {
  const vues = [];
  const { urls, fiches } = await depuisListe(client(vues), config, {});
  assert.deepEqual(urls, [`${RACINE}/companies/alpha`, `${RACINE}/companies/beta`]);
  assert.equal(fiches[0].nom, 'Alpha Films');
  // La page 3, tentée par convention, n'existe pas : la découverte s'arrête là.
  assert.ok(vues.includes(`${RACINE}/companies?page=3`));
});

test('scraper collecte noms et courriels, et respecte robots.txt', async () => {
  const { societes, stats } = await scraper({ config, client: client(), delaiMs: 0 });
  assert.deepEqual(societes.map((s) => s.nom), ['Alpha Films', 'Beta Sales']);
  assert.deepEqual(societes.map((s) => s.email), ['sales@alpha-films.fr', 'anna@beta-sales.de']);
  assert.equal(societes[0].pays, 'France');
  assert.equal(stats.refus, 1, 'la fiche interdite par robots.txt n’est pas récupérée');
  assert.equal(stats.avecEmail, 2);
});

test('scraper --sans-robots ne s’interdit plus rien', async () => {
  const { societes } = await scraper({ config, client: client(), respecterRobots: false, delaiMs: 0 });
  assert.equal(societes.length, 3);
});

test('scraper accepte des fiches imposées et saute la découverte', async () => {
  const vues = [];
  const { societes } = await scraper({
    config,
    client: client(vues),
    urls: [`${RACINE}/companies/beta`],
    respecterRobots: false,
    delaiMs: 0,
  });
  assert.deepEqual(societes.map((s) => s.nom), ['Beta Sales']);
  assert.ok(!vues.some((url) => url.includes('sitemap')));
});

test('scraper ne rend qu’une fois une société atteignable par deux URL', async () => {
  const doublon = { ...SITE };
  doublon[`${RACINE}/companies/alpha-bis`] = SITE[`${RACINE}/companies/alpha`];
  const { societes } = await scraper({
    config,
    client: async (url) => {
      if (doublon[url] === undefined) throw new Error(`HTTP 404 ${url}`);
      return { status: 200, body: doublon[url], notModified: false, url };
    },
    urls: [`${RACINE}/companies/alpha`, `${RACINE}/companies/alpha-bis`],
    respecterRobots: false,
    delaiMs: 0,
  });
  assert.equal(societes.length, 1);
});

test('scraper garde la trace des fiches en échec', async () => {
  const { societes, erreurs } = await scraper({
    config,
    client: client(),
    urls: [`${RACINE}/companies/alpha`, `${RACINE}/companies/inexistante`],
    respecterRobots: false,
    delaiMs: 0,
  });
  assert.equal(societes.length, 1);
  assert.equal(erreurs.length, 1);
  assert.equal(erreurs[0].etape, 'fiche');
});

test('scraper peut n’écrire que les sociétés pourvues d’un courriel', async () => {
  const sans = { ...SITE, [`${RACINE}/companies/delta`]: '<h1>Delta</h1><p>aucun contact</p>' };
  const { societes } = await scraper({
    config,
    client: async (url) => {
      if (sans[url] === undefined) throw new Error('HTTP 404');
      return { status: 200, body: sans[url], notModified: false, url };
    },
    urls: [`${RACINE}/companies/alpha`, `${RACINE}/companies/delta`],
    respecterRobots: false,
    emailObligatoire: true,
    delaiMs: 0,
  });
  assert.deepEqual(societes.map((s) => s.nom), ['Alpha Films']);
});

test('scraper suit le Crawl-delay annoncé par le site', async () => {
  const lent = {
    ...SITE,
    [`${RACINE}/robots.txt`]: 'User-agent: *\nCrawl-delay: 0.05',
  };
  const depart = Date.now();
  await scraper({
    config,
    client: async (url) => {
      if (lent[url] === undefined) throw new Error('HTTP 404');
      return { status: 200, body: lent[url], notModified: false, url };
    },
    urls: [`${RACINE}/companies/alpha`, `${RACINE}/companies/beta`, `${RACINE}/companies/gamma`],
    delaiMs: 0,
  });
  assert.ok(Date.now() - depart >= 100, 'trois fiches espacées de 50 ms tiennent au moins 100 ms');
});

test('Limiteur espace les départs sans les sérialiser plus qu’il ne faut', async () => {
  const limiteur = new Limiteur(30);
  const depart = Date.now();
  await Promise.all([limiteur.attendre(), limiteur.attendre(), limiteur.attendre()]);
  const ecoule = Date.now() - depart;
  assert.ok(ecoule >= 55, `attendu au moins 55 ms, obtenu ${ecoule}`);
  assert.ok(ecoule < 400, `attendu moins de 400 ms, obtenu ${ecoule}`);
});

test('analyserFichiers relit des pages enregistrées sur le disque', async () => {
  const dossier = await mkdtemp(path.join(tmpdir(), 'tfc-'));
  const chemin = path.join(dossier, 'alpha.html');
  await writeFile(chemin, SITE[`${RACINE}/companies/alpha`], 'utf8');
  const { societes, stats } = await analyserFichiers([chemin], config);
  assert.equal(societes[0].nom, 'Alpha Films');
  assert.equal(societes[0].email, 'sales@alpha-films.fr');
  assert.equal(societes[0].fichier, chemin);
  assert.equal(stats.avecEmail, 1);
});

test('fusionner et chargerConfig superposent les surcharges sans tout écraser', async () => {
  const fusion = fusionner(CONFIG_DEFAUT, { racine: 'https://autre.test', etiquettes: { pays: ['Land'] } });
  assert.equal(fusion.racine, 'https://autre.test');
  assert.deepEqual(fusion.etiquettes.pays, ['Land']);
  assert.deepEqual(fusion.etiquettes.siteWeb, CONFIG_DEFAUT.etiquettes.siteWeb);

  const dossier = await mkdtemp(path.join(tmpdir(), 'tfc-conf-'));
  const chemin = path.join(dossier, 'site.json');
  await writeFile(chemin, JSON.stringify({ motifFiche: '^/agences/[^/]+$' }), 'utf8');
  const charge = await chargerConfig(chemin);
  assert.equal(charge.motifFiche, '^/agences/[^/]+$');
  assert.equal(charge.racine, CONFIG_DEFAUT.racine);
});
