import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePublishedDate, dansLaFenetre, collectBooks } from '../src/books.js';

const fenetre = { start: new Date('2026-07-19T00:00:00Z'), end: new Date('2026-07-25T23:59:59Z') };

test('parsePublishedDate reconnaît les trois précisions de Google Books', () => {
  assert.deepEqual(parsePublishedDate('2026-07-22'), {
    date: new Date(Date.UTC(2026, 6, 22)),
    precision: 'jour',
  });
  assert.equal(parsePublishedDate('2026-07').precision, 'mois');
  assert.equal(parsePublishedDate('2026').precision, 'annee');
  assert.deepEqual(parsePublishedDate(''), { date: null, precision: null });
});

test('une date exacte est retenue si elle tombe dans la fenêtre', () => {
  assert.ok(dansLaFenetre(parsePublishedDate('2026-07-22'), fenetre));
  assert.ok(!dansLaFenetre(parsePublishedDate('2026-07-02'), fenetre));
});

test('une date au mois près est retenue si le mois recouvre la fenêtre', () => {
  assert.ok(dansLaFenetre(parsePublishedDate('2026-07'), fenetre));
  assert.ok(!dansLaFenetre(parsePublishedDate('2026-05'), fenetre));
});

test('une date à l’année près n’est jamais une actualité de la semaine', () => {
  assert.ok(!dansLaFenetre(parsePublishedDate('2026'), fenetre));
});

const REPONSE = {
  items: [
    {
      id: 'vol1',
      volumeInfo: {
        title: 'Les Juifs de Salonique',
        subtitle: 'une histoire',
        authors: ['Esther Benbassa'],
        publisher: 'Seuil',
        publishedDate: '2026-07-22',
        description: 'Une histoire de la communauté séfarade de Salonique.',
        categories: ['History'],
        language: 'fr',
        canonicalVolumeLink: 'https://books.google.com/vol1',
        imageLinks: { thumbnail: 'http://books.google.com/img1' },
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781234567897' }],
        pageCount: 320,
      },
    },
    {
      id: 'vol2',
      volumeInfo: {
        title: 'Trop vieux',
        publishedDate: '2019-03-01',
        canonicalVolumeLink: 'https://books.google.com/vol2',
      },
    },
  ],
};

test('collectBooks filtre sur la fenêtre et normalise les volumes', async () => {
  const original = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = async () => {
    appels += 1;
    return new Response(JSON.stringify(REPONSE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const config = {
      monde: { googleBooks: { actif: true, requetes: ['subject:"Jewish"'], langues: ['fr'], maxParRequete: 40 } },
    };
    const { livres, rapport } = await collectBooks(config, { window: fenetre });

    assert.equal(appels, 1);
    assert.equal(livres.length, 1);
    const [livre] = livres;
    assert.equal(livre.titre, 'Les Juifs de Salonique — une histoire');
    assert.equal(livre.auteur, 'Esther Benbassa');
    assert.equal(livre.editeur, 'Seuil');
    assert.equal(livre.isbn, '9781234567897');
    assert.equal(livre.source.type, 'livre');
    assert.ok(livre.image.startsWith('https://'), 'la vignette doit passer en HTTPS');
    assert.equal(rapport[0].statut, 'ok');
    assert.equal(rapport[0].total, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('un même volume trouvé par deux requêtes n’apparaît qu’une fois', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(REPONSE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  try {
    const config = {
      monde: {
        googleBooks: {
          actif: true,
          requetes: ['subject:"Jewish"', 'subject:"Judaism"'],
          langues: ['fr'],
        },
      },
    };
    const { livres } = await collectBooks(config, { window: fenetre });
    assert.equal(livres.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('une panne de Google Books est rapportée sans faire échouer la revue', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('boom', { status: 500, statusText: 'Server Error' });
  try {
    const config = { monde: { googleBooks: { actif: true, requetes: ['subject:"Jewish"'], langues: [null] } } };
    const { livres, rapport } = await collectBooks(config, { window: fenetre });
    assert.equal(livres.length, 0);
    assert.equal(rapport[0].statut, 'echec');
    assert.match(rapport[0].erreur, /500/);
  } finally {
    globalThis.fetch = original;
  }
});

test('googleBooks désactivé ne déclenche aucun appel', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ne doit pas être appelé'); };
  try {
    const { livres } = await collectBooks({ monde: { googleBooks: { actif: false } } }, { window: fenetre });
    assert.deepEqual(livres, []);
  } finally {
    globalThis.fetch = original;
  }
});
