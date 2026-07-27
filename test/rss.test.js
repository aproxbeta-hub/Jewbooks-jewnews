import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFeed } from '../src/rss.js';
import { RSS2, ATOM, RDF, GOOGLE_NEWS, PODCAST, CASSE } from './fixtures.js';

test('RSS 2.0 : titre, lien, date, auteur, catégories, image', () => {
  const feed = parseFeed(RSS2);
  assert.equal(feed.format, 'rss');
  assert.equal(feed.title, 'Jüdische Allgemeine');
  assert.equal(feed.language, 'de');
  assert.equal(feed.items.length, 2);

  const [premier] = feed.items;
  assert.equal(premier.title, 'Antisemitismus an Berliner Schulen nimmt zu');
  assert.match(premier.link, /^https:\/\/www\.juedische-allgemeine\.de\/politik/);
  assert.equal(premier.author, 'Miriam Berger');
  assert.deepEqual(premier.categories, ['Politik', 'Antisemitismus']);
  assert.equal(premier.image, 'https://img.example/gross.jpg');
  assert.equal(premier.guid, 'ja-40912');
  assert.match(premier.summary, /Vorfälle steigt deutlich/);
});

test("RSS 2.0 : les entités du lien sont décodées (&amp; -> &)", () => {
  const [premier] = parseFeed(RSS2).items;
  assert.ok(premier.link.includes('utm_source=rss&utm_medium=feed'));
});

test('Atom : link[rel=alternate] et non link[rel=self]', () => {
  const feed = parseFeed(ATOM);
  assert.equal(feed.format, 'atom');
  assert.equal(feed.items.length, 1);
  const [entree] = feed.items;
  assert.equal(entree.link, 'https://www.szombat.org/hirek/zsinagoga-debrecen');
  assert.equal(entree.title, 'Zsinagógát avattak Debrecenben');
  assert.equal(entree.author, 'Kovács Anna');
  assert.match(entree.summary, /felújított épületet/);
});

test('RDF : dc:date sert de date de publication', () => {
  const feed = parseFeed(RDF);
  assert.equal(feed.format, 'rdf');
  assert.equal(feed.items[0].publishedRaw, '2026-07-21T10:00:00+03:00');
});

test('Podcast : la pièce jointe audio est reconnue', () => {
  const [episode] = parseFeed(PODCAST).items;
  assert.equal(episode.audio.url, 'https://cdn.example/412.mp3');
  assert.equal(episode.audio.type, 'audio/mpeg');
});

test('Google News : les deux entrées sont lues avec leur éditeur', () => {
  const feed = parseFeed(GOOGLE_NEWS);
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[0].source, 'Gazeta Krakowska');
  assert.equal(feed.items[1].source, 'TVN24');
});

test('Un document qui n’est pas un flux lève une erreur explicite', () => {
  assert.throws(() => parseFeed(CASSE), /ni à du RSS/);
});

test('Un flux vide lève une erreur plutôt que de renvoyer undefined', () => {
  assert.throws(() => parseFeed(''), /Flux vide/);
});

test('Une entrée sans titre ni lien est ignorée, les autres survivent', () => {
  const xml = `<rss><channel><title>t</title>
    <item><description>orpheline</description></item>
    <item><title>Valable</title><link>https://exemple.fr/a</link></item>
  </channel></rss>`;
  const feed = parseFeed(xml);
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, 'Valable');
});
