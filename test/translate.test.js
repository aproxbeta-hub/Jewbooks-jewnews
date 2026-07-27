import test from 'node:test';
import assert from 'node:assert/strict';

import { Traducteur, traduireArticles } from '../src/translate/index.js';
import { creerProvider } from '../src/translate/providers.js';
import { Cache } from '../src/cache.js';

/** Fournisseur de test : préfixe chaque texte et compte ses appels. */
function providerFactice({ echoue = false, lots = 3 } = {}) {
  const journal = { appels: 0, textes: 0 };
  return {
    journal,
    provider: {
      nom: 'factice',
      lots,
      async traduire(textes) {
        journal.appels += 1;
        journal.textes += textes.length;
        if (echoue) throw new Error('service indisponible');
        return textes.map((t) => `[fr] ${t}`);
      },
    },
  };
}

/** Traducteur branché sur un provider injecté. */
function traducteurAvec(provider, cache) {
  const traducteur = new Traducteur({ provider: 'aucun', cache });
  traducteur.provider = provider;
  return traducteur;
}

test('le fournisseur « aucun » laisse les textes intacts', async () => {
  const traducteur = new Traducteur({ provider: 'aucun' });
  assert.equal(traducteur.actif, false);
  assert.deepEqual(await traducteur.traduireLot(['Juden in Berlin'], 'de'), ['Juden in Berlin']);
});

test('un fournisseur inconnu est refusé avec la liste des choix', () => {
  assert.throws(() => creerProvider('babelfish'), /Fournisseur de traduction inconnu/);
});

test('le français n’est jamais envoyé au traducteur', async () => {
  const { provider, journal } = providerFactice();
  const traducteur = traducteurAvec(provider);
  const sortie = await traducteur.traduireLot(['Bonjour'], 'fr');
  assert.deepEqual(sortie, ['Bonjour']);
  assert.equal(journal.appels, 0);
});

test('les textes sont envoyés par lots', async () => {
  const { provider, journal } = providerFactice({ lots: 2 });
  const traducteur = traducteurAvec(provider);
  const sortie = await traducteur.traduireLot(['a', 'b', 'c', 'd', 'e'], 'de');
  assert.equal(sortie.length, 5);
  assert.equal(sortie[0], '[fr] a');
  assert.equal(journal.appels, 3); // 2 + 2 + 1
});

test('une panne du traducteur renvoie l’original et se signale', async () => {
  const { provider } = providerFactice({ echoue: true });
  const traducteur = traducteurAvec(provider);
  const sortie = await traducteur.traduireLot(['Juden in Berlin'], 'de');
  assert.deepEqual(sortie, ['Juden in Berlin']);
  assert.equal(traducteur.stats.echecs, 1);
  assert.match(traducteur.erreurs[0], /indisponible/);
});

test('le cache évite de retraduire deux fois le même texte', async () => {
  const cache = new Cache('.cache-test', true);
  cache.enabled = true;
  // On force un cache en mémoire sans toucher au disque.
  cache.namespaces.set('traductions', {});

  const { provider, journal } = providerFactice();
  const premier = traducteurAvec(provider, cache);
  await premier.traduireLot(['Juden in Berlin'], 'de');
  assert.equal(journal.textes, 1);

  const second = traducteurAvec(provider, cache);
  const sortie = await second.traduireLot(['Juden in Berlin'], 'de');
  assert.deepEqual(sortie, ['[fr] Juden in Berlin']);
  assert.equal(journal.textes, 1, 'le second appel doit venir du cache');
  assert.equal(second.stats.cache, 1);
});

test('traduireArticles conserve toujours la version originale', async () => {
  const { provider } = providerFactice();
  const traducteur = traducteurAvec(provider);
  const articles = [
    { titre: 'Juden in Berlin', resume: 'Ein Bericht.', langue: 'de' },
    { titre: 'Les juifs de Lyon', resume: 'Un reportage.', langue: 'fr' },
  ];
  await traduireArticles(articles, traducteur);

  assert.equal(articles[0].titre, '[fr] Juden in Berlin');
  assert.equal(articles[0].titreOriginal, 'Juden in Berlin');
  assert.equal(articles[0].traduit, true);

  assert.equal(articles[1].titre, 'Les juifs de Lyon');
  assert.equal(articles[1].titreOriginal, 'Les juifs de Lyon');
  assert.equal(articles[1].traduit, false);
});

test('traduireArticles regroupe par langue', async () => {
  const { provider, journal } = providerFactice({ lots: 100 });
  const traducteur = traducteurAvec(provider);
  const articles = [
    { titre: 'a', resume: '', langue: 'de' },
    { titre: 'b', resume: '', langue: 'de' },
    { titre: 'c', resume: '', langue: 'pl' },
  ];
  await traduireArticles(articles, traducteur);
  // Un appel pour les titres allemands, un pour les titres polonais.
  // Les résumés vides ne déclenchent aucun appel.
  assert.equal(journal.appels, 2);
});

test('le fournisseur Anthropic exige une clé et le dit clairement', () => {
  const sauvegarde = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.throws(() => creerProvider('anthropic'), /ANTHROPIC_API_KEY/);
  } finally {
    if (sauvegarde !== undefined) process.env.ANTHROPIC_API_KEY = sauvegarde;
  }
});
