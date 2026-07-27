import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalyzer } from '../src/relevance.js';
import { loadConfig } from '../src/sources.js';

const config = await loadConfig();
const analyseur = buildAnalyzer(config.langues);

const article = (titre, extra = {}) => ({ titre, resume: '', categories: [], ...extra });

test('un titre juif est reconnu dans chaque langue de la veille', () => {
  const exemples = [
    ['fr', 'La communauté juive de Lyon inaugure une synagogue'],
    ['de', 'Antisemitismus an Berliner Schulen nimmt zu'],
    ['pl', 'Nowa wystawa o Żydach w Krakowie'],
    ['hu', 'Zsinagógát avattak Debrecenben'],
    ['el', 'Η εβραϊκή κοινότητα της Θεσσαλονίκης τιμά τη μνήμη'],
    ['it', 'La comunità ebraica di Roma protesta'],
    ['uk', 'У Києві вшанували пам’ять жертв Голокосту'],
    ['tr', 'İstanbul sinagogunda anma töreni'],
    ['sv', 'Judiska församlingen i Malmö larmar'],
    ['lt', 'Vilniuje atidaryta paroda apie žydų paveldą'],
    ['nl', 'Joodse gemeenschap in Amsterdam luidt de noodklok'],
    ['ro', 'Comunitatea evreiască din Iași comemorează pogromul'],
    ['cs', 'Židovská obec v Praze otevřela archiv'],
    ['el', 'Βεβήλωση εβραϊκού νεκροταφείου στη Λάρισα'],
  ];
  for (const [langue, titre] of exemples) {
    const { score } = analyseur.pertinence(article(titre, { langue }));
    assert.ok(score >= 3, `${langue} : « ${titre} » noté ${score}`);
  }
});

test('le vocabulaire appliqué est celui de la langue du flux', () => {
  // « rabbit » est l’accusatif hongrois de « rabbi » — et un lapin en anglais.
  const hongrois = analyseur.pertinence(article('A rabbit meghívták a városházára', { langue: 'hu' }));
  const anglais = analyseur.pertinence(article('A rabbit escaped from the city hall', { langue: 'en' }));
  assert.ok(hongrois.score > 0);
  assert.equal(anglais.score, 0);
});

test('les formes fléchies sont reconnues, pas seulement les formes de dictionnaire', () => {
  const flechis = [
    ['pl', 'locatif pluriel', 'Wystawa o Żydach w Krakowie'],
    ['pl', 'adjectif', 'Gmina żydowska w Łodzi obchodzi rocznicę'],
    ['hu', 'accusatif', 'Zsinagógát avattak Debrecenben'],
    ['fi', 'génitif pluriel', 'Juutalaisten yhteisö Helsingissä'],
    ['lt', 'génitif', 'Paroda apie žydų paveldą Vilniuje'],
    ['ru', 'adjectif', 'Еврейская община Москвы отметила праздник'],
    ['cs', 'nominatif pluriel', 'Židé v Praze si připomněli oběti'],
    ['de', 'composé', 'Judenhass in deutschen Stadien nimmt zu'],
    ['lv', 'génitif', 'Rīgā atklāj izstādi par ebreju kopienu'],
  ];
  for (const [langue, cas, titre] of flechis) {
    const { score } = analyseur.pertinence(article(titre, { langue }));
    assert.ok(score >= 3, `${langue} (${cas}) : « ${titre} » noté ${score}`);
  }
});

test('la tolérance de suffixe ne crée pas de faux positifs hors de sa langue', () => {
  const pieges = [
    ['en', 'A rabbit escaped from the city hall'],
    ['de', 'Jodler-Festival im Berner Oberland'],
    ['sv', 'Judo-SM avgörs i Malmö i helgen'],
    ['fr', 'Le rejuifsage industriel, un néologisme absurde'],
  ];
  for (const [langue, titre] of pieges) {
    assert.equal(analyseur.pertinence(article(titre, { langue })).score, 0, `${langue} : ${titre}`);
  }
});

test('un titre sans rapport est écarté', () => {
  const horsSujet = [
    ['fr', 'Le championnat de football reprend dimanche'],
    ['de', 'Neue Straßenbahnlinie in Dresden eröffnet'],
    ['pl', 'Prognoza pogody na weekend'],
    ['hu', 'Új uszoda nyílik Szegeden'],
  ];
  for (const [langue, titre] of horsSujet) {
    assert.equal(analyseur.pertinence(article(titre, { langue })).score, 0, titre);
  }
});

test('le titre pèse plus lourd que le résumé', () => {
  const dansLeTitre = analyseur.pertinence(article('Synagogue attaquée à Rouen', { langue: 'fr' })).score;
  const dansLeCorps = analyseur.pertinence(
    article('Fait divers à Rouen', { langue: 'fr', resume: 'Une synagogue a été visée.' }),
  ).score;
  assert.ok(dansLeTitre > dansLeCorps, `${dansLeTitre} vs ${dansLeCorps}`);
});

test('la frontière gauche est stricte : pas de match en milieu de mot', () => {
  assert.equal(analyseur.pertinence(article('Un dejuifsage imaginaire', { langue: 'fr' })).score, 0);
  assert.ok(analyseur.pertinence(article('Les juifs de Salonique', { langue: 'fr' })).score > 0);
});

test('typeDeContenu distingue livre, podcast, événement et actualité', () => {
  assert.equal(
    analyseur.typeDeContenu(
      article('Un nouveau livre sur les juifs de Vienne, aux éditions Grasset', { langue: 'fr' }),
    ),
    'livre',
  );
  assert.equal(
    analyseur.typeDeContenu(article('Episode 412: The Yiddish Revival', { audio: { url: 'x' } })),
    'podcast',
  );
  assert.equal(
    analyseur.typeDeContenu(
      article('Exposition et colloque au musée juif de Berlin', { resume: 'Une exposition.' }),
    ),
    'evenement',
  );
  assert.equal(analyseur.typeDeContenu(article('Synagogue attaquée à Rouen')), 'actualite');
});

test('le type imposé par la source prime sur la détection', () => {
  const item = article('Un titre parfaitement neutre', { source: { type: 'evenement' } });
  assert.equal(analyseur.typeDeContenu(item), 'evenement');
});

test('les étiquettes reflètent le contenu', () => {
  const tags = analyseur.etiquettes(article('Acte antisémite devant la synagogue de Malmö', { langue: 'fr' }));
  assert.ok(tags.includes('antisémitisme'));
  assert.ok(!tags.includes('Israël'));
  assert.ok(
    analyseur.etiquettes(article('Netanyahou reçu à Berlin, Israël au menu', { langue: 'fr' }))
      .includes('Israël'),
  );
});
