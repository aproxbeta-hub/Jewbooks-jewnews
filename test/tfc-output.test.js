import test from 'node:test';
import assert from 'node:assert/strict';

import { versCsv, versJson, versNdjson, versTexte, cellule, rendreDiagnostic } from '../src/tfc/output.js';
import { compiler, CONFIG_DEFAUT } from '../src/tfc/config.js';
import { parseFiche } from '../src/tfc/parse.js';

const config = compiler({ ...CONFIG_DEFAUT, racine: 'https://annuaire.test' });

const SOCIETES = [
  {
    nom: 'Alpha Films',
    email: 'sales@alpha.fr',
    emails: ['sales@alpha.fr', 'presse@alpha.fr'],
    contact: 'Marie Roux',
    pays: 'France',
    siteWeb: 'https://alpha.fr',
    telephone: '+33123456789',
    url: 'https://annuaire.test/companies/alpha',
  },
  {
    nom: 'Beta, Sales & Co',
    email: 'anna@beta.de',
    emails: ['anna@beta.de'],
    contact: '',
    pays: 'Germany',
    siteWeb: '',
    telephone: '',
    url: 'https://annuaire.test/companies/beta',
  },
];

test('versCsv rend un en-tête et une ligne par société', () => {
  const lignes = versCsv(SOCIETES).trim().split('\n');
  assert.equal(lignes.length, 3);
  assert.ok(lignes[0].startsWith('nom,email,contact,pays,site_web,telephone,fiche'));
  assert.ok(lignes[1].includes('Alpha Films,sales@alpha.fr,Marie Roux,France'));
});

test('versCsv protège les virgules, les guillemets et les sauts de ligne', () => {
  assert.equal(cellule('Beta, Sales & Co'), '"Beta, Sales & Co"');
  assert.equal(cellule('Il a dit "non"'), '"Il a dit ""non"""');
  assert.equal(cellule('deux\nlignes'), '"deux\nlignes"');
  assert.equal(cellule('Beta, Sales', ';'), 'Beta, Sales');
});

test('versCsv neutralise les formules de tableur', () => {
  assert.equal(cellule('=1+1'), "'=1+1");
  assert.equal(cellule('+33123456789'), "'+33123456789");
  assert.equal(cellule('@societe'), "'@societe");
});

test('versCsv accepte un autre séparateur et le BOM d’Excel', () => {
  const csv = versCsv(SOCIETES, { separateur: ';', bom: true });
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('Alpha Films;sales@alpha.fr'));
});

test('versCsv range les adresses suivantes dans une colonne à part', () => {
  const ligne = versCsv([SOCIETES[0]]).trim().split('\n')[1];
  assert.ok(ligne.endsWith('presse@alpha.fr'));
});

test('versJson porte les métadonnées de collecte', () => {
  const doc = JSON.parse(
    versJson({ societes: SOCIETES, erreurs: [], stats: { fiches: 2 } }, { date: '2026-01-01T00:00:00.000Z', source: 'https://annuaire.test' }),
  );
  assert.equal(doc.genere, '2026-01-01T00:00:00.000Z');
  assert.equal(doc.source, 'https://annuaire.test');
  assert.equal(doc.societes.length, 2);
});

test('versNdjson met une société par ligne, et rien si la liste est vide', () => {
  assert.equal(versNdjson(SOCIETES).trim().split('\n').length, 2);
  assert.equal(versNdjson([]), '');
});

test('versTexte récapitule et énumère les erreurs', () => {
  const texte = versTexte({
    societes: SOCIETES,
    erreurs: [{ etape: 'fiche', url: 'https://annuaire.test/companies/x', message: 'HTTP 500' }],
    stats: { fiches: 2, avecEmail: 2, requetes: 7, refus: 1 },
  });
  assert.ok(texte.includes('2 société(s), 2 avec courriel, 7 requête(s), 1 refusée(s) par robots.txt'));
  assert.ok(texte.includes('HTTP 500'));
});

test('rendreDiagnostic nomme la stratégie retenue pour chaque champ', () => {
  const html = '<h1>Alpha Films</h1><a href="mailto:sales@alpha.fr">Ventes</a>';
  const societe = parseFiche(html, { url: 'https://annuaire.test/companies/alpha', config });
  const rapport = rendreDiagnostic(html, societe, config);
  assert.ok(rapport.includes('Nom          Alpha Films  [h1]'));
  assert.ok(rapport.includes('Courriel     sales@alpha.fr  [mailto]'));
  assert.ok(rapport.includes('liens mailto:      1'));
});
