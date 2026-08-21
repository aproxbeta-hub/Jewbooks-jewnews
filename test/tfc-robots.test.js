import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRobots, autorise, delaiPour, groupePour } from '../src/tfc/robots.js';

const FICHIER = `
# annuaire
User-agent: *
Disallow: /admin
Disallow: /recherche
Allow: /admin/public
Crawl-delay: 2

User-agent: MechantBot
Disallow: /

Sitemap: https://exemple.test/sitemap.xml
Sitemap: https://exemple.test/sitemap-societes.xml
`;

test('parseRobots relève groupes, règles et plans du site', () => {
  const robots = parseRobots(FICHIER);
  assert.equal(robots.groupes.length, 2);
  assert.deepEqual(robots.sitemaps, [
    'https://exemple.test/sitemap.xml',
    'https://exemple.test/sitemap-societes.xml',
  ]);
  assert.equal(robots.groupes[0].delai, 2000);
});

test('parseRobots réunit des User-agent consécutifs dans un même groupe', () => {
  const robots = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x');
  assert.equal(robots.groupes.length, 1);
  assert.deepEqual(robots.groupes[0].agents, ['a', 'b']);
});

test('autorise applique le motif le plus long', () => {
  const robots = parseRobots(FICHIER);
  assert.ok(autorise(robots, '/companies/alpha', 'jewnews-tfc/1.0'));
  assert.ok(!autorise(robots, '/admin/secret', 'jewnews-tfc/1.0'));
  assert.ok(autorise(robots, '/admin/public/liste', 'jewnews-tfc/1.0'));
});

test('autorise retient le groupe le plus spécifique', () => {
  const robots = parseRobots(FICHIER);
  assert.ok(!autorise(robots, '/companies/alpha', 'MechantBot/2.0'));
});

test('autorise comprend * et $', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/b');
  assert.ok(!autorise(robots, '/notice.pdf', 'x'));
  assert.ok(autorise(robots, '/notice.pdf.html', 'x'));
  assert.ok(!autorise(robots, '/a/quelconque/b', 'x'));
});

test('un robots.txt vide ou absent laisse passer', () => {
  assert.ok(autorise(parseRobots(''), '/quoi/que/ce/soit', 'x'));
  assert.ok(autorise({ groupes: [], sitemaps: [] }, '/', 'x'));
});

test('Disallow vide vaut autorisation totale', () => {
  const robots = parseRobots('User-agent: *\nDisallow:');
  assert.ok(autorise(robots, '/companies/alpha', 'x'));
});

test('delaiPour et groupePour rendent le groupe applicable', () => {
  const robots = parseRobots(FICHIER);
  assert.equal(delaiPour(robots, 'jewnews-tfc/1.0'), 2000);
  assert.equal(delaiPour(robots, 'MechantBot'), null);
  assert.deepEqual(groupePour(robots, 'MechantBot').agents, ['mechantbot']);
});
