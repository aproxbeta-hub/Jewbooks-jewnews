import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalUrl, splitGoogleNewsTitle, normalizeItem, collect } from '../src/collect.js';
import { parseFeed } from '../src/rss.js';
import { Cache } from '../src/cache.js';
import { RSS2, GOOGLE_NEWS, PODCAST } from './fixtures.js';

test('canonicalUrl efface le traçage et normalise l’hôte', () => {
  assert.equal(
    canonicalUrl('http://WWW.Exemple.fr/article?utm_source=rss&id=4&fbclid=zz#haut'),
    'https://exemple.fr/article?id=4',
  );
});

test('canonicalUrl rend identiques deux variantes du même lien', () => {
  const a = canonicalUrl('https://www.exemple.fr/a/b/?utm_medium=feed');
  const b = canonicalUrl('https://exemple.fr/a/b');
  assert.equal(a, b);
});

test('canonicalUrl ne casse pas sur une URL invalide', () => {
  assert.equal(canonicalUrl('pas une url'), 'pas une url');
  assert.equal(canonicalUrl(null), null);
});

test('splitGoogleNewsTitle isole le journal local', () => {
  assert.deepEqual(
    splitGoogleNewsTitle('Nowa wystawa o Żydach w Krakowie - Gazeta Krakowska', 'Gazeta Krakowska'),
    { titre: 'Nowa wystawa o Żydach w Krakowie', editeur: 'Gazeta Krakowska' },
  );
});

test('splitGoogleNewsTitle sans balise <source> retombe sur le suffixe', () => {
  const { titre, editeur } = splitGoogleNewsTitle('Une longue dépêche sur la synagogue - Le Soir', null);
  assert.equal(titre, 'Une longue dépêche sur la synagogue');
  assert.equal(editeur, 'Le Soir');
});

test('splitGoogleNewsTitle laisse tranquille un titre à tiret', () => {
  const { titre } = splitGoogleNewsTitle('Israël - Europe : le fil rompu', null);
  assert.equal(titre, 'Israël - Europe : le fil rompu');
});

const feedFictif = (extra = {}) => ({
  id: 'test',
  nom: 'Test',
  langue: 'de',
  poids: 2,
  origine: 'media',
  pays: { code: 'DE', nom: 'Allemagne', region: 'Europe centrale' },
  ...extra,
});

test('normalizeItem produit un article complet', () => {
  const [item] = parseFeed(RSS2).items;
  const article = normalizeItem(item, feedFictif());
  assert.equal(article.titre, 'Antisemitismus an Berliner Schulen nimmt zu');
  assert.equal(article.langue, 'de');
  assert.equal(article.pays.code, 'DE');
  assert.equal(article.editeur, 'Test');
  assert.equal(article.date.toISOString(), '2026-07-22T07:14:00.000Z');
  assert.ok(article.lienCanonique.startsWith('https://juedische-allgemeine.de/'));
  assert.ok(!article.lienCanonique.includes('utm_'));
});

test('normalizeItem retient l’éditeur réel pour Google News', () => {
  const [item] = parseFeed(GOOGLE_NEWS).items;
  const article = normalizeItem(item, feedFictif({ origine: 'google-news', langue: 'pl' }));
  assert.equal(article.editeur, 'Gazeta Krakowska');
  assert.equal(article.titre, 'Nowa wystawa o Żydach w Krakowie');
  // Le « résumé » Google News n’est qu’une répétition du titre : on l’écarte.
  assert.equal(article.resume, '');
});

test('normalizeItem conserve la pièce jointe audio', () => {
  const [item] = parseFeed(PODCAST).items;
  const article = normalizeItem(item, feedFictif({ langue: 'en', type: 'podcast' }));
  assert.equal(article.audio.url, 'https://cdn.example/412.mp3');
  assert.equal(article.source.type, 'podcast');
});

/** Remplace fetch par un servant de fixtures, le temps d’un test. */
function stubFetch(routes) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const cle = Object.keys(routes).find((motif) => String(url).includes(motif));
    if (!cle) return new Response('nope', { status: 404, statusText: 'Not Found' });
    const route = routes[cle];
    if (route instanceof Error) throw route;
    return new Response(route, { status: 200, headers: { 'content-type': 'application/xml' } });
  };
  return () => { globalThis.fetch = original; };
}

test('collect agrège les articles et rapporte chaque source', async () => {
  const restore = stubFetch({
    'ok.example': RSS2,
    'casse.example': new Error('ECONNRESET'),
  });
  try {
    const feeds = [
      feedFictif({ id: 'ok', url: 'https://ok.example/feed' }),
      feedFictif({ id: 'casse', url: 'https://casse.example/feed' }),
      feedFictif({ id: 'absent', url: 'https://introuvable.example/feed' }),
    ];
    const { articles, rapport } = await collect(feeds, {
      cache: new Cache('.cache-test', false),
      concurrency: 2,
      retries: 0,
    });

    assert.equal(articles.length, 2);
    assert.equal(rapport.length, 3);
    assert.equal(rapport.find((l) => l.id === 'ok').statut, 'ok');
    assert.equal(rapport.find((l) => l.id === 'casse').statut, 'echec');
    assert.match(rapport.find((l) => l.id === 'casse').erreur, /ECONNRESET/);
    assert.equal(rapport.find((l) => l.id === 'absent').statut, 'echec');
    assert.match(rapport.find((l) => l.id === 'absent').erreur, /404/);
  } finally {
    restore();
  }
});

test('collect applique la fenêtre temporelle mais garde les articles sans date', async () => {
  const restore = stubFetch({ 'ok.example': RSS2 });
  try {
    const feeds = [feedFictif({ id: 'ok', url: 'https://ok.example/feed' })];
    const vieille = { start: new Date('2020-01-01'), end: new Date('2020-01-08') };
    const { articles, rapport } = await collect(feeds, {
      cache: new Cache('.cache-test', false),
      window: vieille,
      retries: 0,
    });
    assert.equal(articles.length, 0);
    assert.equal(rapport[0].horsFenetre, 2);
  } finally {
    restore();
  }
});
