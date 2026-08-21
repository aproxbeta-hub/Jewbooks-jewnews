import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAttributes, balises, texteDe, meta, liens, urlAbsolue, urlCanonique,
  jsonLd, jsonEmbarque, champEtiquete, lignes, parcourir,
} from '../src/tfc/html.js';

test('parseAttributes lit les guillemets simples, doubles et absents', () => {
  const attrs = parseAttributes(` href="/a/b" class='carte vedette' data-id=42 hidden`);
  assert.equal(attrs.href, '/a/b');
  assert.equal(attrs.class, 'carte vedette');
  assert.equal(attrs['data-id'], '42');
  assert.equal(attrs.hidden, '');
});

test('parseAttributes décode les entités des valeurs', () => {
  assert.equal(parseAttributes(' title="Caf&eacute; &amp; Cie"').title, 'Café & Cie');
});

test('balises parcourt les occurrences et rend leur intérieur', () => {
  const trouves = [...balises('<li class="a">Un</li><li>Deux</li>', 'li')];
  assert.equal(trouves.length, 2);
  assert.equal(trouves[0].attrs.class, 'a');
  assert.equal(trouves[1].interieur, 'Deux');
});

test('texteDe ignore une première balise vide', () => {
  assert.equal(texteDe('<h1><img src="x"></h1><h1>Studio Bel&eacute;m</h1>', 'h1'), 'Studio Belém');
});

test('meta cherche sur name, property et itemprop', () => {
  const html = `<meta property="og:title" content="Alpha Films"><meta name="description" content="Ventes">`;
  assert.equal(meta(html, 'og:title'), 'Alpha Films');
  assert.equal(meta(html, 'description'), 'Ventes');
  assert.equal(meta(html, 'absent'), '');
});

test('liens rend href, texte et attributs', () => {
  const trouves = liens('<a href="/companies/alpha" rel="next"><span>Alpha</span> Films</a><a>sans href</a>');
  assert.equal(trouves.length, 1);
  assert.equal(trouves[0].href, '/companies/alpha');
  assert.equal(trouves[0].texte, 'Alpha Films');
  assert.equal(trouves[0].attrs.rel, 'next');
});

test('urlAbsolue résout et écarte ce qui ne se récupère pas', () => {
  assert.equal(urlAbsolue('/a', 'https://x.test/b/c'), 'https://x.test/a');
  assert.equal(urlAbsolue('mailto:a@b.fr', 'https://x.test/'), null);
  assert.equal(urlAbsolue('#ancre', 'https://x.test/'), null);
  assert.equal(urlAbsolue('javascript:void(0)', 'https://x.test/'), null);
});

test('urlCanonique retire fragment, barre finale et pistage', () => {
  assert.equal(
    urlCanonique('https://x.test/companies/alpha/?utm_source=news&page=2#bas'),
    'https://x.test/companies/alpha?page=2',
  );
});

test('jsonLd aplatit tableaux et @graph', () => {
  const html = `
    <script type="application/ld+json">[{"@type":"WebPage"},{"@type":"Organization","name":"Alpha"}]</script>
    <script type="application/ld+json">{"@graph":[{"@type":"LocalBusiness","name":"Beta"}]}</script>`;
  const noms = jsonLd(html).map((n) => n.name).filter(Boolean);
  assert.deepEqual(noms, ['Alpha', 'Beta']);
});

test('jsonLd survit à une virgule finale et à du CDATA', () => {
  const html = `<script type="application/ld+json">//<![CDATA[
    {"@type":"Organization","name":"Gamma",}
  //]]></script>`;
  assert.equal(jsonLd(html)[0]?.name, 'Gamma');
});

test('jsonEmbarque lit __NEXT_DATA__ et window.__NUXT__', () => {
  const html = `
    <script id="__NEXT_DATA__" type="application/json">{"props":{"company":{"name":"Delta"}}}</script>
    <script>window.__NUXT__ = {"data":{"email":"a@b.fr"}};</script>`;
  const blocs = jsonEmbarque(html);
  assert.equal(blocs.length, 2);
  assert.equal(blocs[0].props.company.name, 'Delta');
  assert.equal(blocs[1].data.email, 'a@b.fr');
});

test('parcourir collecte en profondeur sans boucler sur les cycles', () => {
  const racine = { a: { b: 'trouvé' } };
  racine.a.moi = racine;
  const out = parcourir(racine, (valeur) => (valeur === 'trouvé' ? valeur : undefined));
  assert.deepEqual(out, ['trouvé']);
});

test('lignes ramène le balisage à des lignes lisibles', () => {
  const html = '<dl><dt>Country</dt><dd>France</dd></dl><script>var x=1</script>';
  assert.deepEqual(lignes(html), ['Country', 'France']);
});

test('champEtiquete lit la valeur sur la même ligne ou la suivante', () => {
  assert.equal(champEtiquete('<dl><dt>Country</dt><dd>France</dd></dl>', ['Country']), 'France');
  assert.equal(champEtiquete('<p>Country: Germany</p>', ['Country']), 'Germany');
  assert.equal(champEtiquete('<p>Pays&nbsp;: Belgique</p>', ['Pays', 'Country']), 'Belgique');
  assert.equal(champEtiquete('<p>rien</p>', ['Country']), '');
});
