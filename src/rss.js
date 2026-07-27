/**
 * Analyseur de flux tolérant : RSS 2.0, RSS 1.0 (RDF) et Atom.
 *
 * On n'utilise pas de parseur XML strict à dessein. Les flux de presse sont
 * fréquemment mal formés (entités non échappées, HTML brut hors CDATA,
 * préfixes de namespace fantaisistes) et un parseur strict rendrait zéro
 * article là où un scanner tolérant en rend trente.
 */

import { decodeEntities, htmlToText, collapseWhitespace } from './util/text.js';

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** Retire l'enveloppe CDATA éventuelle. */
function unwrapCdata(value) {
  const match = CDATA.exec(value);
  return match ? match[1] : value;
}

/**
 * Contenu du premier élément portant l'un des noms donnés.
 * Les noms sont comparés sans préfixe de namespace (`dc:date` répond à `date`),
 * sauf si le nom demandé contient déjà un `:`.
 */
function pickRaw(xml, names) {
  for (const name of names) {
    const [prefix, local] = name.includes(':') ? name.split(':') : [null, name];
    const namePattern = prefix
      ? `${escapeRe(prefix)}:${escapeRe(local)}`
      : `(?:[A-Za-z0-9_.-]+:)?${escapeRe(local)}`;
    const re = new RegExp(`<${namePattern}(\\s[^>]*)?>([\\s\\S]*?)</${namePattern}\\s*>`, 'i');
    const match = re.exec(xml);
    if (match && match[2] !== undefined) {
      const value = unwrapCdata(match[2]);
      if (collapseWhitespace(value)) return value;
    }
    // Balise auto-fermante : pas de contenu mais des attributs exploitables.
    const selfClosing = new RegExp(`<${namePattern}(\\s[^>]*)?/>`, 'i').exec(xml);
    if (selfClosing) return '';
  }
  return null;
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Valeur texte nettoyée du premier élément trouvé. */
function pickText(xml, names) {
  const raw = pickRaw(xml, names);
  return raw === null ? null : collapseWhitespace(decodeEntities(raw));
}

/** Tous les éléments portant un nom donné, contenu brut. */
function pickAll(xml, name) {
  const namePattern = name.includes(':')
    ? name.split(':').map(escapeRe).join(':')
    : `(?:[A-Za-z0-9_.-]+:)?${escapeRe(name)}`;
  const re = new RegExp(`<${namePattern}(\\s[^>]*)?>([\\s\\S]*?)</${namePattern}\\s*>`, 'gi');
  const out = [];
  let match;
  while ((match = re.exec(xml)) !== null) out.push({ attrs: match[1] || '', body: unwrapCdata(match[2]) });
  return out;
}

/** Balises auto-fermantes ou non, renvoyées avec leurs attributs. */
function pickTags(xml, name) {
  const namePattern = name.includes(':')
    ? name.split(':').map(escapeRe).join(':')
    : `(?:[A-Za-z0-9_.-]+:)?${escapeRe(name)}`;
  const re = new RegExp(`<${namePattern}(\\s[^>]*?)?\\s*/?>`, 'gi');
  const out = [];
  let match;
  while ((match = re.exec(xml)) !== null) out.push(match[1] || '');
  return out;
}

/** Valeur d'un attribut dans une chaîne d'attributs. */
function attr(attrs, name) {
  const re = new RegExp(`\\b${escapeRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = re.exec(attrs || '');
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

/** Lien d'une entrée, en tenant compte des deux conventions RSS et Atom. */
function extractLink(block) {
  // Atom : <link rel="alternate" href="..."/>, sinon le premier <link href>.
  const linkTags = pickTags(block, 'link');
  let fallback = null;
  for (const attrs of linkTags) {
    const href = attr(attrs, 'href');
    if (!href) continue;
    const rel = (attr(attrs, 'rel') || 'alternate').toLowerCase();
    if (rel === 'alternate') return href;
    if (!fallback) fallback = href;
  }
  // RSS : <link>https://…</link>
  const text = pickText(block, ['link']);
  if (text && /^https?:\/\//i.test(text)) return text;
  if (fallback) return fallback;

  // Dernier recours : un guid qui se trouve être une URL.
  const guid = pickText(block, ['guid', 'id']);
  return guid && /^https?:\/\//i.test(guid) ? guid : null;
}

/** Première image utilisable : media:*, enclosure, puis <img> du contenu. */
function extractImage(block, contentHtml) {
  for (const tag of ['media:content', 'media:thumbnail']) {
    for (const attrs of pickTags(block, tag)) {
      const url = attr(attrs, 'url');
      const type = attr(attrs, 'type') || '';
      const medium = attr(attrs, 'medium') || '';
      if (url && (medium === 'image' || type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url))) {
        return url;
      }
    }
  }
  for (const attrs of pickTags(block, 'enclosure')) {
    const url = attr(attrs, 'url');
    if (url && (attr(attrs, 'type') || '').startsWith('image/')) return url;
  }
  const img = /<img[^>]+src\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(contentHtml || '');
  return img ? decodeEntities(img[2] ?? img[3] ?? img[4]) : null;
}

/** Pièce jointe audio, signature d'un épisode de podcast. */
function extractAudio(block) {
  for (const attrs of pickTags(block, 'enclosure')) {
    const url = attr(attrs, 'url');
    const type = attr(attrs, 'type') || '';
    if (url && (type.startsWith('audio/') || /\.(mp3|m4a|ogg|aac|wav)(\?|$)/i.test(url))) {
      return { url, type: type || null, length: attr(attrs, 'length') || null };
    }
  }
  for (const attrs of pickTags(block, 'media:content')) {
    const url = attr(attrs, 'url');
    const type = attr(attrs, 'type') || '';
    if (url && (type.startsWith('audio/') || (attr(attrs, 'medium') || '') === 'audio')) {
      return { url, type: type || null, length: null };
    }
  }
  return null;
}

function extractCategories(block) {
  const out = new Set();
  for (const { attrs, body } of pickAll(block, 'category')) {
    const term = attr(attrs, 'term');
    const value = collapseWhitespace(decodeEntities(term || body || ''));
    if (value && value.length < 80) out.add(value);
  }
  return [...out];
}

function extractAuthor(block) {
  const creator = pickText(block, ['dc:creator']);
  if (creator) return creator;
  const authorBlocks = pickAll(block, 'author');
  for (const { body } of authorBlocks) {
    const name = pickText(body, ['name']);
    if (name) return name;
    const plain = collapseWhitespace(decodeEntities(body.replace(/<[^>]*>/g, ' ')));
    // « redaction@exemple.fr (Prénom Nom) » — forme RSS historique.
    const parenthesised = /\(([^)]+)\)/.exec(plain);
    if (parenthesised) return collapseWhitespace(parenthesised[1]);
    if (plain && !plain.includes('@')) return plain;
  }
  return null;
}

/**
 * Analyse un document de flux.
 * @returns {{title:string|null, link:string|null, description:string|null,
 *            language:string|null, format:string, items:Array<object>}}
 */
export function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') {
    throw new Error('Flux vide');
  }
  const body = xml.replace(/^﻿/, '');
  const isAtom = /<feed[\s>]/i.test(body) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(body);
  const isRdf = /<rdf:RDF[\s>]/i.test(body);
  const format = isAtom ? 'atom' : isRdf ? 'rdf' : /<rss[\s>]/i.test(body) ? 'rss' : 'inconnu';

  const entryName = isAtom ? 'entry' : 'item';
  const entryRe = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${entryName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${entryName}\\s*>`, 'gi');

  // En-tête du flux : tout ce qui précède la première entrée.
  const firstEntry = body.search(entryRe);
  const header = firstEntry > 0 ? body.slice(0, firstEntry) : body;

  const items = [];
  let match;
  entryRe.lastIndex = 0;
  while ((match = entryRe.exec(body)) !== null) {
    const block = match[1];
    const contentHtml =
      pickRaw(block, ['content:encoded', 'content', 'description', 'summary', 'subtitle']) || '';
    const summaryHtml = pickRaw(block, ['description', 'summary', 'subtitle']) || contentHtml;
    const title = pickText(block, ['title']);
    const link = extractLink(block);
    if (!title && !link) continue; // entrée inexploitable

    items.push({
      title: title || null,
      link,
      guid: pickText(block, ['guid', 'id']) || link || title,
      publishedRaw:
        pickText(block, ['pubDate', 'dc:date', 'published', 'issued', 'updated', 'date']) || null,
      updatedRaw: pickText(block, ['updated', 'lastBuildDate']) || null,
      author: extractAuthor(block),
      summaryHtml,
      summary: htmlToText(summaryHtml),
      contentHtml,
      content: htmlToText(contentHtml),
      categories: extractCategories(block),
      image: extractImage(block, contentHtml || summaryHtml),
      audio: extractAudio(block),
      source: pickText(block, ['source']) || null,
    });
  }

  if (format === 'inconnu' && items.length === 0) {
    throw new Error("Le document ne ressemble ni à du RSS, ni à de l'Atom");
  }

  return {
    format,
    title: pickText(header, ['title']),
    link: (() => {
      const linkTags = pickTags(header, 'link');
      for (const attrs of linkTags) {
        const href = attr(attrs, 'href');
        const rel = (attr(attrs, 'rel') || 'alternate').toLowerCase();
        if (href && rel === 'alternate') return href;
      }
      return pickText(header, ['link']);
    })(),
    description: pickText(header, ['description', 'subtitle']),
    language: pickText(header, ['language', 'dc:language']),
    items,
  };
}
