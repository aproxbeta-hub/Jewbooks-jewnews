import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extraireEmails, decoderCfEmail, desobfusquer, normaliserEmail,
  estEmailPlausible, estGenerique,
} from '../src/tfc/emails.js';

/** Encode une adresse comme le fait Cloudflare, pour bâtir un cas de test honnête. */
function chiffrerCf(email, cle = 0x2a) {
  let out = cle.toString(16).padStart(2, '0');
  for (const caractere of email) {
    out += (caractere.charCodeAt(0) ^ cle).toString(16).padStart(2, '0');
  }
  return out;
}

test('decoderCfEmail retrouve une adresse protégée', () => {
  assert.equal(decoderCfEmail(chiffrerCf('sales@alpha-films.fr')), 'sales@alpha-films.fr');
});

test('decoderCfEmail rejette une suite invalide', () => {
  assert.equal(decoderCfEmail('zz'), '');
  assert.equal(decoderCfEmail('2a4142'), ''); // décodé sans arobase
});

test('desobfusquer recompose les écritures en toutes lettres', () => {
  assert.equal(desobfusquer('jean [at] studio (dot) fr'), 'jean@studio.fr');
  assert.equal(desobfusquer('anna AT beta DOT de'), 'anna@beta.de');
  assert.equal(desobfusquer('luc (arobase) gamma [point] be'), 'luc@gamma.be');
});

test('normaliserEmail nettoie mailto, paramètres et ponctuation', () => {
  assert.equal(normaliserEmail('mailto:Sales@Alpha.FR?subject=Hello'), 'sales@alpha.fr');
  assert.equal(normaliserEmail('mailto:a%40b.fr'), 'a@b.fr');
  assert.equal(normaliserEmail('<contact@beta.de>,'), 'contact@beta.de');
});

test('estEmailPlausible écarte le bruit des gabarits et des ressources', () => {
  assert.ok(estEmailPlausible('sales@alpha-films.fr'));
  assert.ok(estEmailPlausible('jérôme@studio.paris'));
  assert.ok(!estEmailPlausible('logo@2x.png'));
  assert.ok(!estEmailPlausible('you@example.com'));
  assert.ok(!estEmailPlausible('email@domain.com'));
  assert.ok(!estEmailPlausible('sans-arobase.fr'));
  assert.ok(!estEmailPlausible('a@b'));
  assert.ok(!estEmailPlausible('.point@alpha.fr'));
});

test('estGenerique distingue une boîte de service d’un contact nommé', () => {
  assert.ok(estGenerique('info@alpha.fr'));
  assert.ok(estGenerique('sales.intl@alpha.fr'));
  assert.ok(!estGenerique('marie.dupont@alpha.fr'));
});

test('extraireEmails classe le mailto avant le texte courant', () => {
  const html = `
    <p>Écrivez à secretariat@alpha-films.fr</p>
    <a href="mailto:sales@alpha-films.fr">Ventes</a>`;
  const trouves = extraireEmails(html);
  assert.equal(trouves[0].email, 'sales@alpha-films.fr');
  assert.equal(trouves[0].origine, 'mailto');
  assert.deepEqual(trouves.map((t) => t.email).sort(), ['sales@alpha-films.fr', 'secretariat@alpha-films.fr']);
});

test('extraireEmails décode Cloudflare, sous ses deux formes', () => {
  const html = `
    <a href="/cdn-cgi/l/email-protection#${chiffrerCf('un@alpha.fr')}">courriel</a>
    <span data-cfemail="${chiffrerCf('deux@beta.de')}">[protégé]</span>`;
  const trouves = extraireEmails(html).map((t) => t.email);
  assert.ok(trouves.includes('un@alpha.fr'));
  assert.ok(trouves.includes('deux@beta.de'));
});

test('extraireEmails lit les entités numériques et les formes obfusquées', () => {
  const html = '<p>marie&#64;alpha.fr</p><p>paul [at] beta (dot) de</p>';
  const trouves = extraireEmails(html).map((t) => t.email);
  assert.ok(trouves.includes('marie@alpha.fr'));
  assert.ok(trouves.includes('paul@beta.de'));
});

test('extraireEmails puise dans le JSON-LD et le JSON embarqué', () => {
  const html = `
    <script type="application/ld+json">{"@type":"Organization","email":"ld@alpha.fr"}</script>
    <script id="__NEXT_DATA__" type="application/json">{"props":{"contactEmail":"next@beta.de"}}</script>`;
  const trouves = extraireEmails(html);
  assert.equal(trouves.find((t) => t.email === 'ld@alpha.fr').origine, 'json-ld');
  assert.equal(trouves.find((t) => t.email === 'next@beta.de').origine, 'json');
});

test('extraireEmails écarte les adresses de l’annuaire lui-même', () => {
  const html = '<a href="mailto:support@annuaire.test">aide</a><a href="mailto:vente@alpha.fr">ventes</a>';
  const trouves = extraireEmails(html, { domaineSite: 'www.annuaire.test' }).map((t) => t.email);
  assert.deepEqual(trouves, ['vente@alpha.fr']);
});

test('extraireEmails ne rend qu’une fois une adresse vue plusieurs fois', () => {
  const html = '<a href="mailto:a@alpha.fr">a</a><p>a@alpha.fr</p><a href="mailto:A@Alpha.fr">a</a>';
  assert.deepEqual(extraireEmails(html).map((t) => t.email), ['a@alpha.fr']);
});
