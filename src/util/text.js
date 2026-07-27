/**
 * Utilitaires texte : décodage d'entités, nettoyage HTML, normalisation et
 * mesures de similarité. Aucune dépendance externe : les flux RSS sont du
 * XML « du monde réel », on reste tolérant plutôt que strict.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  sbquo: '‚',
  bdquo: '„',
  minus: '−',
  oelig: 'œ',
  OElig: 'Œ',
  aelig: 'æ',
  AElig: 'Æ',
  szlig: 'ß',
  oslash: 'ø',
  Oslash: 'Ø',
  aring: 'å',
  Aring: 'Å',
  eth: 'ð',
  ETH: 'Ð',
  thorn: 'þ',
  THORN: 'Þ',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
  dagger: '†',
  sect: '§',
  para: '¶',
  permil: '‰',
  times: '×',
  divide: '÷',
  micro: 'µ',
  iexcl: '¡',
  iquest: '¿',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  shy: '',
  zwj: '',
  zwnj: '',
  lrm: '',
  rlm: '',
};

// Entités accentuées (&auml;, &eacute;, &ntilde;…) : les composer vaut mieux
// que d'en tenir la liste à la main, et la presse européenne en est truffée.
{
  const MARQUES = {
    grave: '̀',
    acute: '́',
    circ: '̂',
    tilde: '̃',
    uml: '̈',
    ring: '̊',
    cedil: '̧',
  };
  for (const lettre of 'aeiouyncszAEIOUYNCSZ') {
    for (const [suffixe, marque] of Object.entries(MARQUES)) {
      const compose = `${lettre}${marque}`.normalize('NFC');
      // On n'enregistre que les combinaisons qui existent vraiment en Unicode.
      if (compose.length === 1) NAMED_ENTITIES[`${lettre}${suffixe}`] = compose;
    }
  }
}

/** Décode les entités XML/HTML les plus courantes, nommées et numériques. */
export function decodeEntities(input) {
  if (!input) return '';
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    // La casse est signifiante : &Eacute; vaut É, pas é. On ne se rabat sur la
    // forme minuscule que pour les entités historiques écrites en capitales
    // (&AMP;, &NBSP;), qui n'ont pas de variante accentuée.
    const exact = NAMED_ENTITIES[entity];
    if (exact !== undefined) return exact;
    const lower = NAMED_ENTITIES[entity.toLowerCase()];
    return lower === undefined || entity !== entity.toUpperCase() ? match : lower;
  });
}

/** Retire les balises HTML, en conservant des espaces là où il en faut. */
export function stripTags(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, '');
}

/** Réduit toute suite d'espaces (y compris insécables) à une espace simple. */
export function collapseWhitespace(text) {
  return String(text || '')
    .replace(/[\s ​]+/g, ' ')
    .trim();
}

/**
 * HTML brut d'un flux -> texte lisible.
 *
 * On décode avant de dé-baliser, puis on redécode. Les flux Atom en
 * `type="html"` livrent leur contenu échappé (`&lt;p&gt;`) : sans le premier
 * décodage, les balises ressortiraient telles quelles dans le résumé. Le
 * second décodage traite les entités qui étaient, elles, à l'intérieur du HTML.
 */
export function htmlToText(html) {
  return collapseWhitespace(decodeEntities(stripTags(decodeEntities(html))));
}

/**
 * Tronque sur une frontière de mot et suffixe une ellipse.
 * Ne coupe jamais au milieu d'un mot si un espace est disponible.
 */
export function excerpt(text, maxLength = 320) {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?…-]+$/, '')}…`;
}

/** Retire les diacritiques (é -> e) pour comparer des titres. */
export function deaccent(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const STOPWORDS = new Set([
  // français
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l', 'et', 'ou', 'a', 'au', 'aux',
  'en', 'dans', 'sur', 'pour', 'par', 'avec', 'sans', 'sous', 'que', 'qui', 'quoi', 'dont',
  'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'il', 'elle', 'ils',
  'elles', 'on', 'nous', 'vous', 'est', 'sont', 'ete', 'etre', 'avoir', 'plus', 'moins',
  'apres', 'avant', 'contre', 'entre', 'vers', 'chez', 'tout', 'tous', 'toute', 'toutes',
  'se', 'ne', 'pas', 'y', 'aussi', 'mais', 'donc', 'car', 's', 'n', 'c', 'j', 'm', 't',
  // anglais
  'the', 'of', 'and', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'is',
  'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those',
  'has', 'have', 'had', 'will', 'would', 'can', 'could', 'says', 'said', 'after', 'over',
  'new', 'about', 'into', 'than', 'then', 'but', 'not', 'his', 'her', 'their', 'they',
]);

/**
 * Forme comparable d'un titre : minuscules, sans accents, sans ponctuation.
 * On filtre sur les propriétés Unicode et non sur `a-z` : la veille couvre le
 * grec, le cyrillique et l'hébreu, qu'une classe latine effacerait entièrement.
 */
export function normalizeTitle(title) {
  return collapseWhitespace(
    deaccent(String(title || '').toLowerCase())
      .replace(/[’']/g, ' ')
      .replace(/[^\p{L}\p{N} ]+/gu, ' '),
  );
}

/** Ensemble des mots significatifs d'un titre (stopwords et mots d'1 lettre exclus). */
export function significantTokens(title) {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

/** Longueur de troncature des radicaux de comparaison. */
const RADICAL = 6;

/**
 * Mots significatifs tronqués à leur radical.
 *
 * « attaque » et « attaquée » désignent le même fait et doivent se comparer
 * comme tels ; il en va de même de « Żydzi » et « Żydach », ou de
 * « Gemeinde » et « Gemeinden ». Tronquer à six caractères est grossier mais
 * suffisant pour rapprocher deux titres qui parlent du même événement, et
 * assez long pour ne pas confondre deux sujets distincts.
 */
export function significantStems(title) {
  return new Set([...significantTokens(title)].map((word) => word.slice(0, RADICAL)));
}

/** Indice de Jaccard entre deux ensembles (0 = disjoints, 1 = identiques). */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Trigrammes de caractères, utilisés pour le coefficient de Dice. */
export function trigrams(text) {
  const padded = ` ${normalizeTitle(text).replace(/ /g, ' ')} `;
  const grams = new Set();
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Coefficient de Sørensen-Dice entre deux ensembles. */
export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** Identifiant lisible et stable dérivé d'un texte. */
export function slugify(text, maxLength = 60) {
  const slug = deaccent(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/, '') || 'sans-titre';
}

/** Échappement pour insertion sûre dans du HTML. */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Échappement des caractères actifs de Markdown dans du texte inline.
 * On se limite à ceux qui changent réellement le rendu hors contexte : les
 * parenthèses d'un nom de média (« Unorthodox (Tablet) ») n'ont pas à être
 * barrées de contre-obliques.
 */
export function escapeMarkdown(text) {
  return String(text ?? '').replace(/([\\`*_[\]<>])/g, '\\$1');
}
