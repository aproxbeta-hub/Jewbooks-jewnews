import test from 'node:test';
import assert from 'node:assert/strict';

import { renderSourcesHtml } from '../src/render/sources.js';
import { loadConfig, buildEuropeanFeeds, buildGlobalFeeds, dedupeFeeds } from '../src/sources.js';

const config = await loadConfig();
const feeds = dedupeFeeds([
  ...buildEuropeanFeeds(config, { days: 7 }),
  ...buildGlobalFeeds(config, { days: 7 }),
]);
const html = renderSourcesHtml(feeds, { jours: 7, genereLe: new Date('2026-07-26T09:00:00Z') });

/** Tous les href de la page. */
const liens = [...html.matchAll(/href="([^"]+)"/g)].map((m) =>
  m[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"'),
);
const externes = liens.filter((l) => l.startsWith('http'));

test('la page est un document HTML autonome', () => {
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="fr">/);
  assert.ok(!html.includes('undefined'));
  assert.ok(!/<script/i.test(html));
});

test('chaque source de la configuration a bien un lien', () => {
  // Deux liens par requête Google News (résultats + RSS), un par flux.
  const requetes = feeds.filter((f) => f.origine === 'google-news');
  const autres = feeds.filter((f) => f.origine !== 'google-news');
  assert.ok(
    externes.length >= requetes.length * 2 + autres.length,
    `${externes.length} liens pour ${requetes.length} requêtes et ${autres.length} flux`,
  );
});

test('tous les liens externes sont des URL absolues valides', () => {
  for (const url of externes) {
    assert.doesNotThrow(() => new URL(url), `URL invalide : ${url}`);
    assert.match(url, /^https:\/\//, `lien non sécurisé : ${url}`);
  }
});

test('les liens externes s’ouvrent dans un onglet sûr', () => {
  const ancres = [...html.matchAll(/<a href="https:[^>]*>/g)].map((m) => m[0]);
  assert.ok(ancres.length > 0);
  for (const ancre of ancres) {
    assert.ok(ancre.includes('target="_blank"'), ancre);
    assert.ok(ancre.includes('rel="noopener noreferrer"'), ancre);
  }
});

test('chaque requête offre les résultats lisibles et le flux RSS', () => {
  const recherches = externes.filter((l) => l.includes('news.google.com/search?'));
  const flux = externes.filter((l) => l.includes('news.google.com/rss/search?'));
  assert.equal(recherches.length, flux.length, 'un lien de résultats par flux');
  assert.ok(recherches.length >= 80, `${recherches.length} requêtes seulement`);
});

test('les requêtes portent la langue et l’édition du pays', () => {
  const trouve = (gl) =>
    externes.find((l) => l.includes('news.google.com/search?') && l.includes(`gl=${gl}`));

  const pologne = new URL(trouve('PL'));
  assert.equal(pologne.searchParams.get('hl'), 'pl');
  assert.equal(pologne.searchParams.get('ceid'), 'PL:pl');
  assert.match(pologne.searchParams.get('q'), /Żydzi|żydowski/);
  assert.match(pologne.searchParams.get('q'), /when:7d/);

  const grece = new URL(trouve('GR'));
  assert.match(grece.searchParams.get('q'), /Εβραίοι|εβραϊκή/);

  const hongrie = new URL(trouve('HU'));
  assert.match(hongrie.searchParams.get('q'), /zsidó|zsinagóga/);
});

test('la Belgique apparaît dans ses deux langues', () => {
  const belges = externes.filter((l) => l.includes('news.google.com/search?') && l.includes('gl=BE'));
  const ceids = new Set(belges.map((l) => new URL(l).searchParams.get('ceid')));
  assert.deepEqual([...ceids].sort(), ['BE:fr', 'BE:nl']);
});

test('tous les pays configurés ont une section et une entrée de sommaire', () => {
  for (const pays of config.pays.filter((p) => p.actif !== false)) {
    assert.ok(html.includes(`id="p-${pays.code.toLowerCase()}"`), `section manquante : ${pays.nom}`);
    assert.ok(html.includes(`href="#p-${pays.code.toLowerCase()}"`), `sommaire : ${pays.nom}`);
  }
});

test('un pays sans média communautaire le dit au lieu de laisser un vide', () => {
  // L'Estonie n'en déclare aucun.
  const section = html.slice(html.indexOf('id="p-ee"'));
  const fin = section.indexOf('</section>');
  assert.match(section.slice(0, fin), /Aucun média communautaire déclaré/);
});

test('les médias pointent vers leur site et vers leur flux', () => {
  assert.ok(externes.includes('https://www.szombat.org/feed'), 'flux Szombat');
  assert.ok(
    externes.some((l) => l.startsWith('https://www.szombat.org') && !l.includes('/feed')),
    'site Szombat',
  );
});

test('les rubriques mondiales sont présentes', () => {
  assert.ok(html.includes('>Parutions<'));
  assert.ok(html.includes('>Podcasts<'));
  assert.ok(html.includes('>Événements<'));
});

test('la fenêtre demandée se retrouve dans les requêtes', () => {
  const quinze = renderSourcesHtml(
    buildEuropeanFeeds(config, { days: 15, pays: ['FR'], medias: false }),
    { jours: 15 },
  );
  assert.ok(quinze.includes('when%3A15d') || quinze.includes('when:15d'));
  assert.ok(!quinze.includes('when%3A7d'));
});
