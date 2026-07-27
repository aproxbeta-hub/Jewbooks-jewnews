import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDate,
  jewishWeek,
  resolveWindow,
  isWithin,
  formatRange,
  editionSlug,
} from '../src/util/dates.js';

test('parseDate accepte RFC 822, ISO et les variantes fréquentes', () => {
  assert.equal(parseDate('Wed, 22 Jul 2026 09:14:00 +0200').toISOString(), '2026-07-22T07:14:00.000Z');
  assert.equal(parseDate('2026-07-23T07:30:00Z').toISOString(), '2026-07-23T07:30:00.000Z');
  assert.equal(parseDate('2026-07-23 07:30:00Z').toISOString(), '2026-07-23T07:30:00.000Z');
});

test('parseDate renvoie null plutôt qu’une date invalide', () => {
  assert.equal(parseDate('bientôt'), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(new Date('nawak')), null);
});

test('jewishWeek va du dimanche au samedi', () => {
  // 22 juillet 2026 est un mercredi.
  const { start, end } = jewishWeek(new Date(2026, 6, 22, 15, 0, 0));
  assert.equal(start.getDay(), 0);
  assert.equal(end.getDay(), 6);
  assert.equal(start.getDate(), 19);
  assert.equal(end.getDate(), 25);
  assert.equal(start.getHours(), 0);
  assert.equal(end.getHours(), 23);
});

test('resolveWindow : --semaine-du ancre la semaine sur la date fournie', () => {
  const fenetre = resolveWindow({ weekOf: '2026-07-22' });
  assert.equal(fenetre.label, 'semaine');
  assert.equal(fenetre.start.getDay(), 0);
});

test('resolveWindow : fenêtre glissante par défaut', () => {
  const maintenant = new Date('2026-07-27T12:00:00Z');
  const fenetre = resolveWindow({ days: 10 }, maintenant);
  assert.equal(fenetre.end.getTime(), maintenant.getTime());
  assert.equal((fenetre.end - fenetre.start) / 86400000, 10);
});

test('resolveWindow refuse un intervalle inversé', () => {
  assert.throws(() => resolveWindow({ since: '2026-07-20', until: '2026-07-10' }), /précéder/);
});

test('resolveWindow signale une date illisible', () => {
  assert.throws(() => resolveWindow({ since: 'la semaine dernière' }), /illisible/);
});

test('isWithin borne des deux côtés', () => {
  const fenetre = { start: new Date('2026-07-19'), end: new Date('2026-07-25') };
  assert.ok(isWithin(new Date('2026-07-20'), fenetre));
  assert.ok(!isWithin(new Date('2026-07-26'), fenetre));
  assert.ok(!isWithin(null, fenetre));
});

test('formatRange factorise mois et année', () => {
  assert.equal(formatRange(new Date(2026, 6, 19), new Date(2026, 6, 25)), 'du 19 au 25 juillet 2026');
  assert.match(formatRange(new Date(2026, 6, 28), new Date(2026, 7, 3)), /28 juillet au 3 août 2026/);
});

test('editionSlug est stable et triable', () => {
  assert.equal(editionSlug(new Date(2026, 6, 5)), '2026-07-05');
});
