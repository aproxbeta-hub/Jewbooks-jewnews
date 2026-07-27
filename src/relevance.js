/**
 * Pertinence et étiquetage multilingues.
 *
 * Les requêtes Google News filtrent déjà sur des mots-clés, mais grossièrement :
 * une dépêche sportive peut remonter parce qu'un club s'appelle Maccabi, et un
 * flux de presse généraliste ne filtre rien du tout. On recalcule donc la
 * pertinence localement, dans toutes les langues à la fois — un article polonais
 * peut très bien être rédigé en anglais.
 */

import { deaccent } from './util/text.js';

/** Normalisation commune aux termes du vocabulaire et aux textes analysés. */
const fold = (text) => deaccent(String(text || '')).toLowerCase();

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Nombre maximal de lettres de flexion tolérées après une racine. */
const SUFFIXE_MAX = 6;

/**
 * Une alternation par groupe de vocabulaire.
 *
 * Deux régimes de comparaison cohabitent :
 *  - `terms` : mots pleins, frontières strictes des deux côtés ;
 *  - `stems` : racines, frontière stricte à gauche seulement, suivies d'au plus
 *    six lettres. Sans cela la veille manquerait l'essentiel de l'Europe
 *    centrale et orientale — « Żydach », « zsinagógát » ou « juutalaisten » ne
 *    ressemblent pas aux formes de dictionnaire.
 *
 * Les frontières sont des lookarounds sur les propriétés Unicode : `\b` est
 * inutilisable dès qu'on quitte l'alphabet latin.
 */
function buildGroupMatcher(terms, stems = []) {
  const mots = [...new Set(terms.map(fold).filter(Boolean))].sort((a, b) => b.length - a.length);
  const racines = [...new Set(stems.map(fold).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!mots.length && !racines.length) return null;

  const alternatives = [
    ...racines.map((racine) => `${escapeRe(racine)}\\p{L}{0,${SUFFIXE_MAX}}`),
    ...mots.map(escapeRe),
  ];
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Termes transversaux, utiles quelle que soit la langue de l'article. */
const TERMES_ISRAEL = [
  'israel', 'israël', 'israeli', 'israelien', 'israélien', 'israelisch', 'israeliano',
  'israelí', 'izrael', 'ізраїль', 'израиль', 'ισραήλ', 'jerusalem', 'jérusalem',
  'tel aviv', 'knesset', 'tsahal', 'idf',
];

const TERMES_PODCAST = [
  'podcast', 'baladodiffusion', 'épisode', 'episode', 'folge', 'puntata', 'episodio',
  'odcinek', 'avsnitt', 'hlaðvarp', 'podkast', 'подкаст',
];

const TERMES_EVENEMENT = [
  'exposition', 'vernissage', 'colloque', 'conférence', 'rencontre', 'festival',
  'exhibition', 'lecture series', 'symposium', 'ausstellung', 'tagung', 'vortrag',
  'mostra', 'convegno', 'exposición', 'wystawa', 'konferencja', 'kiállítás',
  'utställning', 'näyttely', 'izložba', 'έκθεση', 'выставка', 'виставка',
];

const TERMES_LIVRE = [
  'book', 'books', 'novel', 'memoir', 'livre', 'roman', 'essai', 'parution',
  'buch', 'roman', 'sachbuch', 'libro', 'romanzo', 'saggio', 'libro', 'novela',
  'książka', 'powieść', 'könyv', 'kniha', 'bok', 'boek', 'βιβλίο', 'книга',
  'grāmata', 'knyga', 'raamat', 'kirja', 'kitap', 'carte', 'knjiga',
  'éditions', 'editions', 'verlag', 'publisher', 'wydawnictwo', 'nakladatelství',
];

/**
 * Racines valables quelle que soit la langue de l'article : cognates dont
 * aucune langue européenne ne fait un mot courant sans rapport. Toute racine
 * ambiguë hors de sa langue (le hongrois « rabbi- », dont l'accusatif est
 * « rabbit » ; le danois « jød- », qui attrape l'allemand « Jodler ») reste
 * cantonnée à son propre vocabulaire.
 */
const RACINES_UNIVERSELLES = [
  'jewish', 'jewry', 'judaism', 'judaizm', 'judaiz', 'judais', 'judentum',
  'synagog', 'sinagog', 'sunagoog', 'zsinagog', 'synagoog', 'sinagóg',
  'yiddish', 'jiddisch', 'jidysz', 'jidis', 'jiddis',
  'sefard', 'sephard', 'ashkenaz', 'aschkenas', 'aszkenaz', 'asjkenaz',
];

/** Mots pleins sûrs, toutes langues confondues. */
const MOTS_UNIVERSELS = [
  'juif', 'juifs', 'juive', 'juives', 'jew', 'jews', 'juden', 'joden',
  'ebrei', 'ebreo', 'ebraico', 'zydzi', 'zsido', 'zsidok', 'evrei', 'evreu',
  'judio', 'judios', 'judeu', 'judeus', 'kosher', 'koscher', 'casher', 'kacher',
];

/**
 * Construit l'analyseur à partir du vocabulaire par langue.
 *
 * La détection de pertinence est **sensible à la langue** : on applique le
 * vocabulaire de la langue du flux, plus un noyau universel. Fusionner les
 * trente vocabulaires en un seul filtre produirait des collisions
 * inter-langues à chaque édition.
 *
 * @param {object} langues section `langues` de sources/langues.json
 */
export function buildAnalyzer(langues) {
  const culture = [];
  const livres = [];
  const tousMots = { noyau: [], antisemitisme: [] };
  const toutesRacines = { noyau: [], antisemitisme: [] };
  const parLangue = new Map();

  for (const [code, vocab] of Object.entries(langues)) {
    culture.push(...(vocab.culture || []));
    livres.push(...(vocab.livres || []));
    tousMots.noyau.push(...(vocab.noyau || []));
    tousMots.antisemitisme.push(...(vocab.antisemitisme || []));
    toutesRacines.noyau.push(...(vocab.racines?.noyau || []));
    toutesRacines.antisemitisme.push(...(vocab.racines?.antisemitisme || []));

    parLangue.set(code, {
      noyau: buildGroupMatcher(
        [...(vocab.noyau || []), ...MOTS_UNIVERSELS],
        [...(vocab.racines?.noyau || []), ...RACINES_UNIVERSELLES],
      ),
      // Les termes de l'antisémitisme et de la Shoah sont des cognates dans
      // toute l'Europe : on les cherche dans toutes les langues à la fois.
      antisemitisme: buildGroupMatcher(tousMots.antisemitisme, toutesRacines.antisemitisme),
    });
  }

  // Recalculé après la boucle : les premières langues n'avaient pas encore vu
  // le vocabulaire des suivantes.
  const antisemitismeGlobal = buildGroupMatcher(tousMots.antisemitisme, toutesRacines.antisemitisme);
  for (const matchers of parLangue.values()) matchers.antisemitisme = antisemitismeGlobal;

  const repli = {
    noyau: buildGroupMatcher(tousMots.noyau, toutesRacines.noyau),
    antisemitisme: antisemitismeGlobal,
  };
  const universel = {
    noyau: buildGroupMatcher(MOTS_UNIVERSELS, RACINES_UNIVERSELLES),
    antisemitisme: antisemitismeGlobal,
  };

  const matchers = {
    culture: buildGroupMatcher(culture),
    livres: buildGroupMatcher([...livres, ...TERMES_LIVRE]),
    israel: buildGroupMatcher(TERMES_ISRAEL),
    podcast: buildGroupMatcher(TERMES_PODCAST),
    evenement: buildGroupMatcher([...culture, ...TERMES_EVENEMENT]),
  };

  /** Termes distincts trouvés par une expression donnée. */
  function chercher(text, matcher) {
    if (!matcher || !text) return [];
    matcher.lastIndex = 0;
    const found = new Set();
    for (const match of text.matchAll(matcher)) found.add(match[0]);
    return [...found];
  }

  /** Termes distincts d'un groupe transversal (culture, livres, Israël…). */
  function hits(text, group) {
    return chercher(text, matchers[group]);
  }

  /**
   * Jeu de matchers applicable à un article.
   * Langue connue -> vocabulaire de cette langue. Langue inconnue -> on
   * privilégie le rappel avec l'union de tous les vocabulaires.
   */
  function matchersPour(langue) {
    if (!langue) return repli;
    const code = String(langue).toLowerCase().split('-')[0];
    return parLangue.get(code) || (code ? universel : repli);
  }

  /**
   * Note de pertinence « juive » d'un article.
   * Le titre compte triple : c'est là que se joue le sujet réel.
   */
  function pertinence(article) {
    const titre = fold(article.titre);
    const corps = fold(`${article.resume || ''} ${(article.categories || []).join(' ')}`);
    const lexique = matchersPour(article.langue);

    const noyauTitre = chercher(titre, lexique.noyau);
    const noyauCorps = chercher(corps, lexique.noyau);
    const antisemTitre = chercher(titre, lexique.antisemitisme);
    const antisemCorps = chercher(corps, lexique.antisemitisme);
    const israelTitre = hits(titre, 'israel');
    const israelCorps = hits(corps, 'israel');

    const score =
      3 * noyauTitre.length +
      1 * Math.min(noyauCorps.length, 4) +
      3 * antisemTitre.length +
      1 * Math.min(antisemCorps.length, 4) +
      1.5 * israelTitre.length +
      0.5 * Math.min(israelCorps.length, 3);

    const motifs = [...new Set([...noyauTitre, ...antisemTitre, ...israelTitre])].slice(0, 6);
    return { score, motifs, direct: noyauTitre.length + antisemTitre.length > 0 };
  }

  /**
   * Type de contenu. Renvoie 'livre', 'podcast', 'evenement' ou 'actualite'.
   * Un `type` imposé par la source (musée, éditeur, podcast) prime toujours.
   */
  function typeDeContenu(article) {
    if (article.source?.type) return article.source.type;
    if (article.audio) return 'podcast';

    const titre = fold(article.titre);
    const corps = fold(article.resume);

    if (hits(titre, 'podcast').length) return 'podcast';

    const signauxLivre = hits(titre, 'livres').length * 2 + hits(corps, 'livres').length;
    const signauxEvent = hits(titre, 'evenement').length * 2 + hits(corps, 'evenement').length;

    if (signauxLivre >= 2 && signauxLivre >= signauxEvent) return 'livre';
    if (signauxEvent >= 2) return 'evenement';
    return 'actualite';
  }

  /** Étiquettes éditoriales, affichées telles quelles dans la revue. */
  function etiquettes(article) {
    const texte = `${fold(article.titre)} ${fold(article.resume)}`;
    const lexique = matchersPour(article.langue);
    const tags = [];
    if (chercher(texte, lexique.antisemitisme).length) tags.push('antisémitisme');
    if (hits(texte, 'israel').length) tags.push('Israël');
    if (hits(texte, 'culture').length) tags.push('culture');
    if (chercher(texte, lexique.noyau).length && !tags.includes('antisémitisme')) {
      tags.push('vie juive');
    }
    return tags.slice(0, 3);
  }

  return { pertinence, typeDeContenu, etiquettes, hits };
}
