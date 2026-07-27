import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadConfig,
  buildQuery,
  googleNewsUrl,
  buildEuropeanFeeds,
  buildGlobalFeeds,
  dedupeFeeds,
  PROFILS,
} from '../src/sources.js';

const config = await loadConfig();

test('la configuration se charge et couvre le continent', () => {
  assert.ok(config.pays.length >= 35, `${config.pays.length} pays configurés`);
  assert.ok(Object.keys(config.langues).length >= 25);
  for (const code of ['FR', 'DE', 'PL', 'HU', 'IT', 'GB', 'GR', 'UA', 'LT', 'RS']) {
    assert.ok(config.pays.some((p) => p.code === code), `${code} manquant`);
  }
});

test('chaque édition de pays référence une langue connue', () => {
  for (const pays of config.pays) {
    assert.ok(pays.editions?.length, `${pays.nom} sans édition`);
    for (const edition of pays.editions) {
      assert.ok(config.langues[edition.langue], `langue « ${edition.langue} » (${pays.nom}) inconnue`);
      assert.ok(edition.hl && edition.gl && edition.ceid, `paramètres Google News incomplets (${pays.nom})`);
    }
  }
});

test('chaque langue fournit les quatre groupes de vocabulaire', () => {
  for (const [code, vocab] of Object.entries(config.langues)) {
    for (const groupe of ['noyau', 'antisemitisme', 'culture', 'livres']) {
      assert.ok(Array.isArray(vocab[groupe]) && vocab[groupe].length, `${code}.${groupe} vide`);
    }
  }
});

test('les identifiants de flux sont uniques', () => {
  const feeds = [
    ...buildEuropeanFeeds(config, { days: 7 }),
    ...buildGlobalFeeds(config, { days: 7 }),
  ];
  const vus = new Set();
  for (const feed of feeds) {
    assert.ok(!vus.has(feed.id), `identifiant dupliqué : ${feed.id}`);
    vus.add(feed.id);
  }
});

test('buildQuery met les expressions entre guillemets et pose la fenêtre', () => {
  const query = buildQuery(['juif', 'communauté juive'], ['livre'], 7);
  assert.equal(query, '(juif OR "communauté juive") (livre) when:7d');
});

test('buildQuery sans second groupe ni fenêtre', () => {
  assert.equal(buildQuery(['Juden'], null, 0), '(Juden)');
});

test('googleNewsUrl encode la requête et les paramètres d’édition', () => {
  const url = new URL(googleNewsUrl('(Żydzi) when:7d', { hl: 'pl', gl: 'PL', ceid: 'PL:pl' }));
  assert.equal(url.hostname, 'news.google.com');
  assert.equal(url.pathname, '/rss/search');
  assert.equal(url.searchParams.get('q'), '(Żydzi) when:7d');
  assert.equal(url.searchParams.get('ceid'), 'PL:pl');
});

test('buildEuropeanFeeds : un flux par pays, langue et profil', () => {
  const feeds = buildEuropeanFeeds(config, {
    pays: ['BE'],
    profils: ['actualite', 'antisemitisme'],
    days: 7,
    medias: false,
  });
  // La Belgique a deux éditions (fr et nl) et deux profils.
  assert.equal(feeds.length, 4);
  assert.ok(feeds.every((f) => f.pays.code === 'BE'));
  assert.deepEqual([...new Set(feeds.map((f) => f.langue))].sort(), ['fr', 'nl']);
});

test('buildEuropeanFeeds : --pays filtre réellement', () => {
  const feeds = buildEuropeanFeeds(config, { pays: ['PL'], days: 7 });
  assert.ok(feeds.length > 0);
  assert.ok(feeds.every((f) => f.pays.code === 'PL'));
});

test('buildEuropeanFeeds : --sans-google-news ne laisse que les médias', () => {
  const feeds = buildEuropeanFeeds(config, { pays: ['FR'], days: 7, googleNews: false });
  assert.ok(feeds.length > 0);
  assert.ok(feeds.every((f) => f.origine === 'media'));
});

test('buildEuropeanFeeds refuse un profil inconnu', () => {
  assert.throws(
    () => buildEuropeanFeeds(config, { pays: ['FR'], profils: ['ragots'], days: 7 }),
    /Profil de requête inconnu/,
  );
});

test('tous les profils déclarés produisent une requête', () => {
  for (const profil of Object.keys(PROFILS)) {
    const feeds = buildEuropeanFeeds(config, { pays: ['DE'], profils: [profil], days: 7, medias: false });
    assert.equal(feeds.length, 1, profil);
    assert.ok(feeds[0].url.includes('news.google.com'));
  }
});

test('buildGlobalFeeds fournit livres, podcasts et événements', () => {
  const feeds = buildGlobalFeeds(config, { days: 7 });
  const profils = new Set(feeds.map((f) => f.profil));
  assert.ok(profils.has('livres'));
  assert.ok(profils.has('podcasts'));
  assert.ok(profils.has('evenements'));
  assert.ok(feeds.some((f) => f.type === 'livre'));
});

test('buildGlobalFeeds sans Google News ne laisse que des flux d’éditeurs', () => {
  const feeds = buildGlobalFeeds(config, { days: 7, googleNews: false });
  assert.ok(feeds.length > 0);
  assert.ok(
    feeds.every((f) => !f.url.includes('news.google.com')),
    'aucune requête Google News ne doit subsister',
  );
});

test('dedupeFeeds garde la source de plus fort poids', () => {
  const feeds = dedupeFeeds([
    { id: 'a', url: 'https://x/f', poids: 1 },
    { id: 'b', url: 'https://x/f', poids: 3 },
    { id: 'c', url: 'https://y/f', poids: 2 },
  ]);
  assert.equal(feeds.length, 2);
  assert.ok(feeds.some((f) => f.id === 'b'));
  assert.ok(!feeds.some((f) => f.id === 'a'));
});

test('les sources inactives sont écartées sans --pays explicite', () => {
  const feeds = buildEuropeanFeeds(config, { pays: ['CH'], days: 7, googleNews: false });
  assert.ok(!feeds.some((f) => f.id === 'ch-tachles'));
});
