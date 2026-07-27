import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDestinataires,
  adresseValide,
  envoyerRevue,
  creerTransport,
  transportMemoire,
} from '../src/mail.js';
import { renderEmail, renderEmailHtml, renderEmailTexte, sujetEmail } from '../src/render/email.js';

test('parseDestinataires accepte virgules, points-virgules et espaces', () => {
  assert.deepEqual(parseDestinataires('a@x.fr, b@y.fr ; c@z.fr'), ['a@x.fr', 'b@y.fr', 'c@z.fr']);
  assert.deepEqual(parseDestinataires(''), []);
  assert.deepEqual(parseDestinataires(['a@x.fr']), ['a@x.fr']);
});

test('adresseValide accepte la forme « Nom <adresse> »', () => {
  assert.ok(adresseValide('elie@exemple.fr'));
  assert.ok(adresseValide('Rédaction K. <redaction@exemple.fr>'));
  assert.ok(!adresseValide('elie@exemple'));
  assert.ok(!adresseValide('pas une adresse'));
  assert.ok(!adresseValide('a@@b.fr'));
});

test('un transport inconnu est refusé avec la liste des choix', async () => {
  await assert.rejects(() => creerTransport('pigeon'), /Transport inconnu/);
});

const revueMinimale = () => ({
  meta: {
    genereLe: '2026-07-26T09:00:00.000Z',
    edition: '2026-07-19',
    fenetre: { libelle: 'du 19 au 25 juillet 2026', jours: 7 },
    traduction: { provider: 'anthropic', traduits: 12, cache: 40, echecs: 0, erreurs: [] },
    stats: {
      flux: 90, fluxOk: 88, fluxEnEchec: 2,
      articlesCollectes: 300, articlesEcartes: 120, sujets: 42, paysCouverts: 2,
    },
  },
  calendrier: null,
  aLaUne: [],
  pays: [
    {
      code: 'DE',
      nom: 'Allemagne',
      region: 'Europe centrale',
      articles: [
        {
          titre: 'L’antisémitisme progresse dans les écoles berlinoises',
          titreOriginal: 'Antisemitismus an Berliner Schulen nimmt zu',
          resume: 'Le Sénat de Berlin alerte sur une hausse des signalements.',
          traduit: true,
          lien: 'https://spiegel.de/a?x=1&y=2',
          editeur: 'Der Spiegel',
          auteur: null,
          date: '2026-07-22T07:14:00.000Z',
          datePrecision: 'jour',
          etiquettes: ['antisémitisme'],
          reprises: ['taz'],
          nbReprises: 1,
          pays: { code: 'DE', nom: 'Allemagne' },
        },
      ],
    },
    { code: 'PL', nom: 'Pologne', region: null, articles: [] },
  ],
  livres: [],
  podcasts: [],
  evenements: [],
  paysSansRemontee: [{ code: 'IS', nom: 'Islande' }],
  rapport: [{ statut: 'echec', nom: 'ch-tachles', erreur: 'HTTP 404' }],
});

test('le sujet est informatif dès la liste des messages', () => {
  assert.equal(
    sujetEmail(revueMinimale()),
    'Revue de presse — du 19 au 25 juillet 2026 · 2 pays, 42 sujets',
  );
});

test('le HTML d’e-mail est en styles alignés, sans CSS moderne', () => {
  const html = renderEmailHtml(revueMinimale());
  assert.match(html, /^<!doctype html>/);
  // Ce qui casse chez Gmail et Outlook :
  assert.ok(!html.includes('var(--'), 'pas de variable CSS');
  assert.ok(!html.includes('@media'), 'pas de requête média');
  assert.ok(!html.includes('prefers-color-scheme'));
  assert.ok(!html.includes('display:flex'));
  assert.ok(!/<style/i.test(html), 'pas de feuille de style : tout est en ligne');
  assert.ok(html.includes('style="'), 'les styles doivent être alignés');
});

test('le HTML d’e-mail porte bien le contenu et la VO', () => {
  const html = renderEmailHtml(revueMinimale());
  assert.ok(html.includes('L’antisémitisme progresse dans les écoles berlinoises'));
  assert.ok(html.includes('Antisemitismus an Berliner Schulen nimmt zu'), 'la VO doit figurer');
  assert.ok(html.includes('Der Spiegel'));
  assert.ok(html.includes('Allemagne'));
  assert.ok(html.includes('repris par taz'));
  assert.ok(html.includes('https://spiegel.de/a?x=1&amp;y=2'), 'le lien doit être échappé');
  assert.ok(html.includes('Islande'), 'les pays muets sont signalés');
  assert.ok(!html.includes('undefined'));
});

test('la version texte est autonome et porte les liens', () => {
  const texte = renderEmailTexte(revueMinimale());
  assert.ok(texte.includes('REVUE DE PRESSE'));
  assert.ok(texte.includes('https://spiegel.de/a?x=1&y=2'));
  assert.ok(texte.includes('VO : « Antisemitismus an Berliner Schulen nimmt zu »'));
  assert.ok(!texte.includes('<'), 'aucune balise dans la version texte');
  assert.ok(!texte.includes('undefined'));
});

test('un pays sans article ne produit pas de section vide', () => {
  const html = renderEmailHtml(revueMinimale());
  assert.ok(!html.includes('>Pologne<'), 'la Pologne, sans article, ne doit pas avoir de titre');
});

test('une revue vide reste un message lisible', () => {
  const vide = revueMinimale();
  vide.pays = [];
  vide.meta.stats.sujets = 0;
  const html = renderEmailHtml(vide);
  assert.ok(html.includes('Aucun sujet retenu'));
  assert.ok(!html.includes('undefined'));
});

test('envoyerRevue transmet le message au transport', async () => {
  const transport = transportMemoire();
  const message = renderEmail(revueMinimale());
  const resultat = await envoyerRevue(
    { a: 'elie@exemple.fr, redaction@exemple.fr', de: 'veille@exemple.fr', ...message },
    { transport },
  );

  assert.equal(resultat.transport, 'memoire');
  assert.deepEqual(resultat.destinataires, ['elie@exemple.fr', 'redaction@exemple.fr']);
  assert.equal(transport.envoyes.length, 1);
  const envoye = transport.envoyes[0];
  assert.equal(envoye.de, 'veille@exemple.fr');
  assert.match(envoye.sujet, /^Revue de presse/);
  assert.ok(envoye.html.length > 100);
  assert.ok(envoye.texte.length > 100);
});

test('envoyerRevue refuse une liste vide', async () => {
  await assert.rejects(
    () => envoyerRevue({ a: '', sujet: 's', html: 'h', texte: 't' }, { transport: transportMemoire() }),
    /Aucun destinataire/,
  );
});

test('envoyerRevue refuse une adresse mal formée plutôt que d’échouer au dernier moment', async () => {
  await assert.rejects(
    () => envoyerRevue({ a: 'elie@exemple', sujet: 's', html: 'h', texte: 't' }, { transport: transportMemoire() }),
    /mal formée/,
  );
});

test('sans expéditeur explicite, le premier destinataire fait office', async () => {
  const transport = transportMemoire();
  await envoyerRevue({ a: 'elie@exemple.fr', sujet: 's', html: 'h', texte: 't' }, { transport });
  assert.equal(transport.envoyes[0].de, 'elie@exemple.fr');
});

test('le transport SMTP exige une configuration et le dit clairement', async () => {
  const sauvegarde = { url: process.env.SMTP_URL, host: process.env.SMTP_HOST };
  delete process.env.SMTP_URL;
  delete process.env.SMTP_HOST;
  try {
    await assert.rejects(() => creerTransport('smtp'), /SMTP_URL/);
  } finally {
    if (sauvegarde.url !== undefined) process.env.SMTP_URL = sauvegarde.url;
    if (sauvegarde.host !== undefined) process.env.SMTP_HOST = sauvegarde.host;
  }
});

test('le transport Resend exige sa clé', async () => {
  const sauvegarde = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    await assert.rejects(() => creerTransport('resend'), /RESEND_API_KEY/);
  } finally {
    if (sauvegarde !== undefined) process.env.RESEND_API_KEY = sauvegarde;
  }
});
