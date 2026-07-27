import test from 'node:test';
import assert from 'node:assert/strict';

import { grouper } from '../src/dedupe.js';
import { canonicalUrl } from '../src/collect.js';

let compteur = 0;
const art = (titre, options = {}) => {
  compteur += 1;
  const lien = options.lien || `https://exemple${compteur}.fr/a`;
  return {
    id: `a${compteur}`,
    titre,
    lien,
    lienCanonique: canonicalUrl(lien),
    editeur: options.editeur || `Journal ${compteur}`,
    date: options.date || new Date('2026-07-22T10:00:00Z'),
    resume: options.resume ?? 'résumé',
    image: options.image || null,
    pays: options.pays === null ? null : options.pays || { code: 'FR', nom: 'France' },
    source: {
      id: 's',
      nom: 'S',
      origine: options.origine || 'media',
      poids: options.poids ?? 2,
      type: null,
      profil: null,
    },
  };
};

test('deux liens identiques au traçage près fusionnent', () => {
  const clusters = grouper([
    art('Synagogue attaquée à Rouen', { lien: 'https://lemonde.fr/a?utm_source=rss', editeur: 'Le Monde' }),
    art('Synagogue attaquée à Rouen', { lien: 'https://www.lemonde.fr/a', editeur: 'Le Monde' }),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].taille, 2);
});

test('deux formulations proches du même sujet fusionnent', () => {
  const clusters = grouper([
    art('Attaque contre la synagogue de Rouen', { editeur: 'AFP' }),
    art('Rouen : la synagogue attaquée dans la nuit', { editeur: 'Ouest-France' }),
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].editeurs.sort(), ['AFP', 'Ouest-France']);
  assert.equal(clusters[0].doublons.length, 1);
});

test('deux sujets distincts restent séparés', () => {
  const clusters = grouper([
    art('Attaque contre la synagogue de Rouen'),
    art('Le musée juif de Berlin inaugure une exposition'),
  ]);
  assert.equal(clusters.length, 2);
});

test('le même sujet dans deux pays reste séparé — c’est le propos de la revue', () => {
  const clusters = grouper([
    art('Antisemitismus nimmt zu', { pays: { code: 'DE', nom: 'Allemagne' } }),
    art('Antisemitismus nimmt zu', { pays: { code: 'AT', nom: 'Autriche' } }),
  ]);
  assert.equal(clusters.length, 2);
});

test('un titre trop court n’est pas fusionné à l’aveugle', () => {
  const clusters = grouper([art('Shabbat'), art('Shalom')]);
  assert.equal(clusters.length, 2);
});

test('le représentant préfère un lien direct à une redirection Google News', () => {
  const [cluster] = grouper([
    art('Attaque contre la synagogue de Rouen', {
      origine: 'google-news',
      editeur: 'Google',
      lien: 'https://news.google.com/rss/articles/AAA',
    }),
    art('Attaque contre la synagogue de Rouen', {
      origine: 'media',
      editeur: 'Ouest-France',
      lien: 'https://ouest-france.fr/rouen',
    }),
  ]);
  assert.equal(cluster.principal.editeur, 'Ouest-France');
  assert.equal(cluster.editeurs[0], 'Ouest-France');
});

test('à origine égale, le représentant est la source la mieux notée', () => {
  const [cluster] = grouper([
    art('Attaque contre la synagogue de Rouen', { editeur: 'Petit site', poids: 1 }),
    art('Attaque contre la synagogue de Rouen', { editeur: 'Le Monde', poids: 3 }),
  ]);
  assert.equal(cluster.principal.editeur, 'Le Monde');
});

test('un article sans lien canonique ne fait pas tomber le regroupement', () => {
  const orphelin = art('Sans lien');
  orphelin.lienCanonique = null;
  const clusters = grouper([orphelin, art('Autre chose entièrement différente ici')]);
  assert.equal(clusters.length, 2);
});
