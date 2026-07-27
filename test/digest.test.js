import test from 'node:test';
import assert from 'node:assert/strict';

import { genererRevue } from '../src/digest.js';
import { renderHtml, renderMarkdown, renderJson } from '../src/render/index.js';
import { Cache } from '../src/cache.js';

const MAINTENANT = new Date('2026-07-26T09:00:00Z');
const DATE_RSS = 'Wed, 22 Jul 2026 09:14:00 GMT';

/** Flux Google News synthétique, propre à un pays. */
const googleNews = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title>
${items
  .map(
    ({ titre, editeur, lien }) => `<item>
  <title>${titre} - ${editeur}</title>
  <link>https://news.google.com/rss/articles/${lien}</link>
  <guid>${lien}</guid>
  <pubDate>${DATE_RSS}</pubDate>
  <source url="https://${editeur.toLowerCase().replace(/\s/g, '')}.example">${editeur}</source>
</item>`,
  )
  .join('\n')}
</channel></rss>`;

const PAR_PAYS = {
  FR: googleNews([
    { titre: 'La synagogue de Rouen visée par un incendie', editeur: 'Ouest-France', lien: 'fr1' },
    { titre: 'Incendie à la synagogue de Rouen : enquête ouverte', editeur: 'Le Monde', lien: 'fr2' },
    { titre: 'Le CRIF alerte sur les actes antisémites', editeur: 'Libération', lien: 'fr3' },
  ]),
  DE: googleNews([
    { titre: 'Antisemitismus an Berliner Schulen nimmt zu', editeur: 'Der Spiegel', lien: 'de1' },
    { titre: 'Jüdische Gemeinde München eröffnet Zentrum', editeur: 'SZ', lien: 'de2' },
  ]),
  PL: googleNews([
    { titre: 'Nowa wystawa o Żydach w Krakowie', editeur: 'Gazeta Krakowska', lien: 'pl1' },
  ]),
};

/** Réponse aux requêtes « parutions » (deux groupes de termes croisés). */
const REQUETE_LIVRES = googleNews([
  { titre: 'Parution : « Les Juifs de Vienne », un essai remarqué', editeur: 'Le Figaro', lien: 'liv1' },
]);

const MEDIA_FR = `<?xml version="1.0"?><rss version="2.0"><channel><title>K.</title>
<item><title>Ce que l'Europe fait des Juifs</title>
<link>https://k-larevue.com/essai-europe</link>
<pubDate>${DATE_RSS}</pubDate>
<description>Un essai sur la place des Juifs dans l'Europe contemporaine.</description></item>
</channel></rss>`;

const LIVRES = `<?xml version="1.0"?><rss version="2.0"><channel><title>Jewish Book Council</title>
<item><title>New book: The Vilna Circle</title>
<link>https://jewishbookcouncil.org/vilna-circle</link>
<pubDate>${DATE_RSS}</pubDate>
<description>A memoir published this month by Yale University Press.</description></item>
</channel></rss>`;

const PODCAST = `<?xml version="1.0"?><rss version="2.0"><channel><title>Unorthodox</title>
<item><title>Episode 412: The Yiddish Revival</title>
<link>https://tabletmag.com/unorthodox/412</link>
<pubDate>${DATE_RSS}</pubDate>
<description>A conversation about Yiddish today.</description>
<enclosure url="https://cdn.example/412.mp3" length="1" type="audio/mpeg"/></item>
</channel></rss>`;

const EVENEMENT = `<?xml version="1.0"?><rss version="2.0"><channel><title>mahj</title>
<item><title>Exposition : Chagall et la Bible</title>
<link>https://mahj.org/chagall</link>
<pubDate>${DATE_RSS}</pubDate>
<description>Une exposition au musée d'art et d'histoire du Judaïsme.</description></item>
</channel></rss>`;

const GOOGLE_BOOKS = JSON.stringify({
  items: [
    {
      id: 'vol1',
      volumeInfo: {
        title: 'Une histoire des Juifs d’Europe centrale',
        authors: ['Anna Kovács'],
        publisher: 'Gallimard',
        publishedDate: '2026-07-22',
        description: 'Synthèse récente.',
        language: 'fr',
        canonicalVolumeLink: 'https://books.google.com/vol1',
      },
    },
  ],
});

/** Sert les fixtures selon l'URL demandée ; tout le reste répond 404. */
function stubReseau() {
  const original = globalThis.fetch;
  const vus = [];
  globalThis.fetch = async (url) => {
    const brut = String(url);
    vus.push(brut);
    const json = (corps) =>
      new Response(corps, { status: 200, headers: { 'content-type': 'application/json' } });
    const xml = (corps) =>
      new Response(corps, { status: 200, headers: { 'content-type': 'application/xml' } });

    if (brut.includes('googleapis.com/books')) return json(GOOGLE_BOOKS);
    if (brut.includes('news.google.com')) {
      const parametres = new URL(brut).searchParams;
      const requete = parametres.get('q') || '';
      // Les requêtes « parutions » croisent deux groupes de termes ; les
      // requêtes de veille pays n'en ont qu'un. On les sert différemment,
      // sinon la même dépêche remonterait dans les deux rubriques.
      if (/\)\s*\(/.test(requete)) return xml(REQUETE_LIVRES);
      const gl = parametres.get('gl');
      return PAR_PAYS[gl] ? xml(PAR_PAYS[gl]) : xml(googleNews([]));
    }
    if (brut.includes('k-larevue.com')) return xml(MEDIA_FR);
    if (brut.includes('jewishbookcouncil')) return xml(LIVRES);
    if (brut.includes('megaphone.fm/unorthodox')) return xml(PODCAST);
    if (brut.includes('mahj.org')) return xml(EVENEMENT);
    return new Response('introuvable', { status: 404, statusText: 'Not Found' });
  };
  return { vus, restore: () => { globalThis.fetch = original; } };
}

const options = {
  cache: new Cache('.cache-test', false),
  pays: ['FR', 'DE', 'PL'],
  days: 7,
  maintenant: MAINTENANT,
  concurrency: 4,
  traduction: 'aucun',
};

test('la revue se construit de bout en bout', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue(options);
  } finally {
    restore();
  }

  // Trois pays demandés, trois pays servis.
  assert.deepEqual(revue.pays.map((p) => p.code).sort(), ['DE', 'FR', 'PL']);
  assert.ok(revue.meta.stats.sujets > 0);
  assert.equal(revue.meta.fenetre.jours, 7);
  assert.equal(revue.meta.edition, '2026-07-19');

  // Les deux dépêches françaises sur Rouen ne font qu'un sujet.
  const france = revue.pays.find((p) => p.code === 'FR');
  const rouen = france.articles.filter((a) => /Rouen/i.test(a.titre));
  assert.equal(rouen.length, 1, 'les doublons sur Rouen doivent fusionner');
  assert.equal(rouen[0].nbReprises, 1);
  assert.ok(rouen[0].reprises.length >= 1);

  // Les reprises se comptent en éditeurs distincts : le même article remonté
  // par deux requêtes du même pays n'a été « repris » par personne.
  assert.deepEqual(rouen[0].reprises, ['Le Monde']);

  // Deux sujets allemands distincts restent distincts.
  const allemagne = revue.pays.find((p) => p.code === 'DE');
  assert.equal(allemagne.articles.length, 2);

  // L'éditeur réel est conservé, pas « Google News ».
  assert.ok(france.articles.every((a) => a.editeur && !/google/i.test(a.editeur)));
});

test('les rubriques mondiales sont alimentées', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue(options);
  } finally {
    restore();
  }

  assert.ok(revue.livres.length >= 1, 'aucune parution');
  assert.ok(revue.podcasts.some((p) => /Yiddish Revival/.test(p.titre)), 'podcast absent');
  assert.ok(revue.evenements.some((e) => /Chagall/.test(e.titre)), 'événement absent');
  // Le volume Google Books est bien passé par la rubrique Livres.
  assert.ok(revue.livres.some((l) => /Europe centrale/.test(l.titre)));
});

test('« À la une » panache les pays', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue({ ...options, aLaUne: 3 });
  } finally {
    restore();
  }
  assert.ok(revue.aLaUne.length <= 3);
  const pays = revue.aLaUne.map((a) => a.pays.code);
  assert.equal(new Set(pays).size, pays.length, 'un même pays ne doit pas monopoliser la une');
});

test('sans traduction, titre et original coïncident', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue(options);
  } finally {
    restore();
  }
  const allemagne = revue.pays.find((p) => p.code === 'DE');
  for (const article of allemagne.articles) {
    assert.equal(article.traduit, false);
    assert.equal(article.titre, article.titreOriginal);
  }
  assert.equal(revue.meta.traduction.provider, 'aucun');
});

test('les sources injoignables sont rapportées, pas silencieuses', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue(options);
  } finally {
    restore();
  }
  const echecs = revue.rapport.filter((l) => l.statut === 'echec');
  assert.ok(echecs.length > 0, 'les fixtures ne servent pas tous les flux : il doit y avoir des échecs');
  assert.equal(revue.meta.stats.fluxEnEchec, echecs.length);
  assert.ok(echecs.every((e) => e.erreur));
});

test('--par-pays borne réellement le nombre d’articles', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue({ ...options, parPays: 1 });
  } finally {
    restore();
  }
  assert.ok(revue.pays.every((p) => p.articles.length <= 1));
});

test('les trois rendus produisent une sortie exploitable', async () => {
  const { restore } = stubReseau();
  let revue;
  try {
    revue = await genererRevue({ ...options, calendrier: true });
  } finally {
    restore();
  }

  const html = renderHtml(revue);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="fr">/);
  assert.ok(html.includes('Revue de presse'));
  assert.ok(html.includes('Allemagne'));
  assert.ok(html.includes('id="pays-fr"'));
  assert.ok(!html.includes('undefined'), 'le HTML ne doit pas contenir « undefined »');
  assert.ok(!/<script/i.test(html), 'le HTML doit rester sans script');
  // Le repère hébraïque demandé apparaît bien.
  assert.match(html, /Av 5786|Tamouz 5786/);

  const md = renderMarkdown(revue);
  assert.match(md, /^# Revue de presse/);
  assert.ok(md.includes('## À la une'));
  assert.ok(!md.includes('undefined'));

  const json = JSON.parse(renderJson(revue));
  assert.equal(json.meta.edition, revue.meta.edition);
  assert.ok(Array.isArray(json.pays));
});

test('le HTML échappe les caractères actifs venus des flux', async () => {
  const revue = {
    meta: {
      genereLe: MAINTENANT.toISOString(),
      edition: '2026-07-19',
      fenetre: { libelle: 'du 19 au 25 juillet 2026', jours: 7 },
      traduction: { provider: 'aucun', traduits: 0, cache: 0, echecs: 0, erreurs: [] },
      stats: { flux: 1, fluxOk: 1, fluxEnEchec: 0, articlesCollectes: 1, articlesEcartes: 0, sujets: 1, paysCouverts: 1 },
    },
    calendrier: null,
    aLaUne: [],
    pays: [
      {
        code: 'FR',
        nom: 'France',
        region: null,
        articles: [
          {
            titre: '<script>alert("xss")</script>',
            titreOriginal: '<script>alert("xss")</script>',
            resume: 'Guillemets " et chevrons <>',
            traduit: false,
            lien: 'https://exemple.fr/a?a=1&b=2',
            editeur: 'A & B',
            date: MAINTENANT.toISOString(),
            etiquettes: [],
            reprises: [],
            nbReprises: 0,
            pays: { code: 'FR', nom: 'France' },
          },
        ],
      },
    ],
    livres: [],
    podcasts: [],
    evenements: [],
    paysSansRemontee: [],
    rapport: [],
  };

  const html = renderHtml(revue);
  assert.ok(!html.includes('<script>alert'), 'le script ne doit jamais être injecté tel quel');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('https://exemple.fr/a?a=1&amp;b=2'));
});
