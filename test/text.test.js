import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeEntities,
  htmlToText,
  excerpt,
  normalizeTitle,
  significantTokens,
  jaccard,
  dice,
  trigrams,
  escapeHtml,
} from '../src/util/text.js';

test('decodeEntities gère les entités nommées, composées et numériques', () => {
  assert.equal(decodeEntities('Vorf&auml;lle'), 'Vorfälle');
  assert.equal(decodeEntities('&Eacute;tat h&eacute;breu'), 'État hébreu');
  assert.equal(decodeEntities('Krak&oacute;w'), 'Kraków');
  assert.equal(decodeEntities('Stra&szlig;e'), 'Straße');
  assert.equal(decodeEntities('&#8220;paix&#8221;'), '“paix”');
  assert.equal(decodeEntities('&#x00E9;t&eacute;'), 'été');
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
});

test('decodeEntities laisse intacte une entité inconnue', () => {
  assert.equal(decodeEntities('&frobnicate; ok'), '&frobnicate; ok');
});

test('htmlToText traite le HTML échappé des flux Atom', () => {
  assert.equal(
    htmlToText('&lt;p&gt;A fel&uacute;j&iacute;tott &eacute;p&uuml;let&lt;/p&gt;'),
    'A felújított épület',
  );
});

test('htmlToText supprime scripts et styles, pas leur voisinage', () => {
  const html = '<p>Avant</p><script>alert(1)</script><style>p{}</style><p>Après</p>';
  assert.equal(htmlToText(html), 'Avant Après');
});

test('excerpt coupe sur une frontière de mot', () => {
  const texte = 'La communauté juive de Thessalonique commémore la déportation de 1943 chaque année.';
  const court = excerpt(texte, 40);
  assert.ok(court.length <= 41, court);
  assert.ok(court.endsWith('…'));
  assert.ok(!court.includes('  '));
  assert.equal(excerpt('court', 40), 'court');
});

test('normalizeTitle retire accents et ponctuation, garde les chiffres', () => {
  assert.equal(normalizeTitle('Antisémitisme : +12 % en 2026 !'), 'antisemitisme 12 en 2026');
});

test('normalizeTitle préserve les alphabets non latins', () => {
  assert.equal(normalizeTitle('Синагога в Варшаве'), 'синагога в варшаве');
});

test('significantTokens écarte les mots vides des deux langues', () => {
  const tokens = significantTokens('The new synagogue of the city');
  assert.ok(tokens.has('synagogue'));
  assert.ok(!tokens.has('the'));
  assert.ok(!tokens.has('of'));
});

test('jaccard et dice se comportent comme attendu aux bornes', () => {
  const a = significantTokens('synagogue attaquée à Rouen');
  assert.equal(jaccard(a, a), 1);
  assert.equal(jaccard(a, new Set()), 0);
  assert.equal(dice(trigrams('abc'), trigrams('abc')), 1);
});

test('escapeHtml neutralise les chevrons et les guillemets', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});
