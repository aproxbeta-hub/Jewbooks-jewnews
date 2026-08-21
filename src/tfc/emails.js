/**
 * Extraction d'adresses de courriel dans une page.
 *
 * Un annuaire professionnel ne publie presque jamais ses adresses en clair :
 * elles passent par un `mailto:`, par l'obfuscation Cloudflare, par des
 * entités numériques ou par le vieux « nom (at) societe (dot) com ». On
 * traite ces quatre formes, et on classe les trouvailles par fiabilité :
 * une adresse tirée d'un `mailto:` vaut mieux qu'une adresse aperçue dans un
 * paragraphe, qui peut appartenir au webmestre du site.
 */

import { decodeEntities, collapseWhitespace } from '../util/text.js';
import { balises, liens, jsonLd, jsonEmbarque, parcourir } from './html.js';

/**
 * Motif d'adresse. Volontairement plus étroit que la RFC 5322 : on cherche des
 * adresses publiées, pas à valider une saisie. Les lettres Unicode sont
 * admises dans le domaine (annuaires allemands, polonais…).
 */
const MOTIF_EMAIL =
  /[\p{L}0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}0-9!#$%&'*+/=?^_`{|}~-]+)*@[\p{L}0-9](?:[\p{L}0-9-]*[\p{L}0-9])?(?:\.[\p{L}0-9](?:[\p{L}0-9-]*[\p{L}0-9])?)+/gu;

/** Extensions de fichiers : « logo@2x.png » n'est pas une adresse. */
const EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|json|woff2?|ttf|eot|mp4|webm|pdf|zip)$/i;

/** Domaines de bruit : outillage du site, exemples de documentation. */
const DOMAINES_BRUIT = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'email.com',
  'sentry.io', 'sentry-cdn.com', 'wixpress.com', 'squarespace.com', 'wordpress.com',
  'schema.org', 'w3.org', 'googleapis.com', 'gstatic.com', 'cloudflare.com',
  'jquery.com', 'bootstrapcdn.com', 'gravatar.com',
]);

/** Parties locales qui trahissent un gabarit non rempli. */
const LOCALES_BRUIT = new Set(['email', 'e-mail', 'mail', 'your', 'youremail', 'name', 'user', 'username', 'someone', 'nom']);

/** Adresses de service, utiles mais moins bonnes qu'un contact nommé. */
const LOCALES_GENERIQUES = new Set([
  'info', 'contact', 'hello', 'office', 'sales', 'admin', 'mail', 'enquiries',
  'inquiries', 'general', 'welcome', 'bonjour', 'kontakt', 'infos', 'press',
]);

/** Décode le bourrage hexadécimal de Cloudflare (`data-cfemail`). */
export function decoderCfEmail(hex) {
  const suite = String(hex || '').trim();
  if (!/^[0-9a-f]{4,}$/i.test(suite) || suite.length % 2) return '';
  const cle = parseInt(suite.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < suite.length; i += 2) {
    out += String.fromCharCode(parseInt(suite.slice(i, i + 2), 16) ^ cle);
  }
  return /@/.test(out) ? out : '';
}

/**
 * Remet en forme les adresses écrites en toutes lettres.
 * « jean [at] studio (dot) fr » -> « jean@studio.fr ».
 */
export function desobfusquer(texte) {
  return decodeEntities(String(texte || ''))
    .replace(/\s*[[({<]\s*(?:@|at|arobase|chez|ät)\s*[\])}>]\s*/gi, '@')
    .replace(/\s+(?:@|at|arobase|chez)\s+/gi, '@')
    .replace(/\s*[[({<]\s*(?:\.|dot|point|punkt)\s*[\])}>]\s*/gi, '.')
    .replace(/\s+(?:dot|point|punkt)\s+/gi, '.');
}

/** Nettoie une adresse candidate (ponctuation collée, casse, mailto:). */
export function normaliserEmail(valeur) {
  let email = String(valeur || '').trim();
  email = email.replace(/^mailto:/i, '');
  const point = email.indexOf('?');
  if (point !== -1) email = email.slice(0, point);
  try {
    email = decodeURIComponent(email);
  } catch {
    // Séquence d'échappement invalide : on garde la forme brute.
  }
  email = collapseWhitespace(decodeEntities(email)).replace(/^[<"'\s]+|[>"'\s.,;:]+$/g, '');
  return email.toLowerCase();
}

/** Une adresse est-elle plausible pour de la prospection ? */
export function estEmailPlausible(email) {
  const valeur = String(email || '');
  if (!/^[^@\s]+@[^@\s]+$/.test(valeur)) return false;
  const [locale, domaine] = valeur.split('@');
  if (!locale || locale.length > 64 || /^[.-]|[.-]$|\.\./.test(locale)) return false;
  if (LOCALES_BRUIT.has(locale)) return false;
  if (/^\d+x$/.test(locale)) return false;
  if (!/^[\p{L}0-9.-]+$/u.test(domaine) || domaine.length > 253) return false;
  if (EXTENSIONS.test(domaine)) return false;
  const morceaux = domaine.split('.');
  if (morceaux.length < 2 || morceaux.some((m) => !m || m.startsWith('-') || m.endsWith('-'))) return false;
  const tld = morceaux.at(-1);
  if (!/^[\p{L}]{2,24}$/u.test(tld)) return false;
  const racine = morceaux.slice(-2).join('.');
  return !DOMAINES_BRUIT.has(racine) && !DOMAINES_BRUIT.has(domaine);
}

/** Une adresse de service (info@, contact@) plutôt qu'un contact nommé. */
export function estGenerique(email) {
  const locale = String(email || '').split('@')[0];
  return LOCALES_GENERIQUES.has(locale.replace(/[._-].*$/, '')) || LOCALES_GENERIQUES.has(locale);
}

/** Fiabilité décroissante des points de collecte. */
const RANGS = { mailto: 0, cloudflare: 1, 'json-ld': 2, json: 3, obfusque: 4, texte: 5 };

function ajouter(index, email, origine) {
  const propre = normaliserEmail(email);
  if (!estEmailPlausible(propre)) return;
  const rang = RANGS[origine] ?? 9;
  const connu = index.get(propre);
  if (!connu || rang < connu.rang) index.set(propre, { email: propre, origine, rang });
}

/**
 * Toutes les adresses d'une page, de la plus fiable à la moins fiable.
 *
 * @param {string} html
 * @param {{domaineSite?: string}} [options] domaine de l'annuaire lui-même,
 *        dont les adresses (support, webmestre) sont écartées.
 * @returns {Array<{email:string, origine:string}>}
 */
export function extraireEmails(html, options = {}) {
  const source = String(html || '');
  const index = new Map();

  for (const lien of liens(source)) {
    if (/^mailto:/i.test(lien.href)) ajouter(index, lien.href, 'mailto');
    // Cloudflare remplace l'adresse par une redirection portant le hexadécimal.
    const protege = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i.exec(lien.href);
    if (protege) ajouter(index, decoderCfEmail(protege[1]), 'cloudflare');
    if (lien.attrs['data-cfemail']) ajouter(index, decoderCfEmail(lien.attrs['data-cfemail']), 'cloudflare');
  }

  for (const nom of ['span', 'a', 'div', 'p']) {
    for (const { attrs } of balises(source, nom)) {
      if (attrs['data-cfemail']) ajouter(index, decoderCfEmail(attrs['data-cfemail']), 'cloudflare');
      if (attrs['data-email']) ajouter(index, attrs['data-email'], 'json');
    }
  }

  const depuisJson = (racines, origine) => {
    for (const racine of racines) {
      parcourir(racine, (valeur, cle) => {
        if (typeof valeur !== 'string') return undefined;
        if (!/mail/i.test(String(cle)) && !valeur.includes('@')) return undefined;
        return valeur;
      }).forEach((valeur) => {
        const trouvees = valeur.match(MOTIF_EMAIL);
        if (trouvees) trouvees.forEach((email) => ajouter(index, email, origine));
      });
    }
  };
  depuisJson(jsonLd(source), 'json-ld');
  depuisJson(jsonEmbarque(source), 'json');

  const texte = decodeEntities(source.replace(/<[^>]*>/g, ' '));
  for (const email of texte.match(MOTIF_EMAIL) || []) ajouter(index, email, 'texte');

  const remis = desobfusquer(texte);
  if (remis !== texte) {
    for (const email of remis.match(MOTIF_EMAIL) || []) ajouter(index, email, 'obfusque');
  }

  const domaineSite = String(options.domaineSite || '').toLowerCase().replace(/^www\./, '');
  return [...index.values()]
    .filter(({ email }) => !domaineSite || !email.endsWith(`@${domaineSite}`))
    .sort((a, b) => a.rang - b.rang || Number(estGenerique(a.email)) - Number(estGenerique(b.email)) || a.email.localeCompare(b.email))
    .map(({ email, origine }) => ({ email, origine }));
}
