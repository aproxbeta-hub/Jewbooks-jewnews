import test from 'node:test';
import assert from 'node:assert/strict';

import { compiler, CONFIG_DEFAUT } from '../src/tfc/config.js';
import { parseListe, parseFiche, nettoyerNom } from '../src/tfc/parse.js';

const config = compiler({ ...CONFIG_DEFAUT, racine: 'https://annuaire.test' });
const URL_LISTE = 'https://annuaire.test/companies';

test('nettoyerNom retire le nom de l’annuaire, devant comme derrière', () => {
  assert.equal(nettoyerNom('Alpha Films | The Film Catalogue', config.suffixesTitre), 'Alpha Films');
  assert.equal(nettoyerNom('The Film Catalogue — Beta Sales', config.suffixesTitre), 'Beta Sales');
  assert.equal(nettoyerNom('  «Gamma»  ', config.suffixesTitre), 'Gamma');
});

test('parseListe retient les fiches et ignore le reste du site', () => {
  const html = `
    <a href="/companies/alpha-films">Alpha Films</a>
    <a href="/companies/alpha-films"><img src="/logo.png"></a>
    <a href="/films/le-film">Le film</a>
    <a href="https://ailleurs.test/companies/beta">Beta</a>
    <a href="/companies/beta-sales">Beta Sales</a>`;
  const { fiches } = parseListe(html, { url: URL_LISTE, config });
  assert.deepEqual(fiches.map((f) => f.url), [
    'https://annuaire.test/companies/alpha-films',
    'https://annuaire.test/companies/beta-sales',
  ]);
  // Le lien porteur du texte l'emporte sur celui qui n'entoure qu'une image.
  assert.equal(fiches[0].nom, 'Alpha Films');
});

test('parseListe repère la pagination sous ses trois formes', () => {
  const html = `
    <a href="/companies?page=2">2</a>
    <a href="/companies/page/3">3</a>
    <a href="/suite" rel="next">suivant</a>
    <link rel="next" href="/companies?page=4">`;
  const { pages } = parseListe(html, { url: URL_LISTE, config });
  assert.deepEqual(pages.sort(), [
    'https://annuaire.test/companies/page/3',
    'https://annuaire.test/companies?page=2',
    'https://annuaire.test/companies?page=4',
    'https://annuaire.test/suite',
  ].sort());
});

test('parseFiche préfère le JSON-LD quand il est là', () => {
  const html = `
    <title>Alpha Films | The Film Catalogue</title>
    <h1>Alpha</h1>
    <script type="application/ld+json">{
      "@type": "Organization",
      "name": "Alpha Films International",
      "email": "sales@alpha-films.fr",
      "telephone": "+33 1 23 45 67 89",
      "url": "https://alpha-films.fr",
      "address": {"@type": "PostalAddress", "addressCountry": "France"}
    }</script>`;
  const societe = parseFiche(html, { url: 'https://annuaire.test/companies/alpha', config });
  assert.equal(societe.nom, 'Alpha Films International');
  assert.equal(societe.email, 'sales@alpha-films.fr');
  assert.equal(societe.pays, 'France');
  assert.equal(societe.siteWeb, 'https://alpha-films.fr');
  assert.equal(societe.telephone, '+33 1 23 45 67 89');
  assert.equal(societe.origines.nom, 'json-ld');
});

test('parseFiche se rabat sur le balisage ordinaire', () => {
  const html = `
    <title>Beta Sales - The Film Catalogue</title>
    <h1>Beta Sales</h1>
    <dl>
      <dt>Country</dt><dd>Germany</dd>
      <dt>Website</dt><dd>beta-sales.de</dd>
      <dt>Contact</dt><dd>Anna Weber</dd>
    </dl>
    <a href="tel:+4930123456">+49 30 123456</a>
    <a href="mailto:anna@beta-sales.de">Écrire</a>
    <a href="https://facebook.com/betasales">Facebook</a>`;
  const societe = parseFiche(html, { url: 'https://annuaire.test/companies/beta', config });
  assert.equal(societe.nom, 'Beta Sales');
  assert.equal(societe.origines.nom, 'h1');
  assert.equal(societe.email, 'anna@beta-sales.de');
  assert.equal(societe.pays, 'Germany');
  assert.equal(societe.siteWeb, 'https://beta-sales.de');
  assert.equal(societe.telephone, '+4930123456'); // le href fait foi, mieux normalisé que le libellé
  assert.equal(societe.contact, 'Anna Weber');
});

test('parseFiche ne prend jamais un réseau social pour le site de la société', () => {
  const html = `<h1>Gamma</h1>
    <a href="https://www.linkedin.com/company/gamma">LinkedIn</a>
    <a href="https://twitter.com/gamma">X</a>
    <a href="https://annuaire.test/companies/gamma">Cette fiche</a>`;
  assert.equal(parseFiche(html, { url: 'https://annuaire.test/companies/gamma', config }).siteWeb, '');
});

test('parseFiche remonte toutes les adresses, la meilleure en tête', () => {
  const html = `<h1>Delta</h1>
    <p>presse@delta.fr</p>
    <a href="mailto:acquisitions@delta.fr">Acquisitions</a>`;
  const societe = parseFiche(html, { url: 'https://annuaire.test/companies/delta', config });
  assert.equal(societe.email, 'acquisitions@delta.fr');
  assert.equal(societe.emails.length, 2);
  assert.equal(societe.origines.email, 'mailto');
});

test('parseFiche tire le nom du titre quand il n’y a rien d’autre', () => {
  const societe = parseFiche('<title>Epsilon Films | The Film Catalogue</title>', {
    url: 'https://annuaire.test/companies/epsilon',
    config,
  });
  assert.equal(societe.nom, 'Epsilon Films');
  assert.equal(societe.origines.nom, 'titre');
  assert.equal(societe.email, '');
});
