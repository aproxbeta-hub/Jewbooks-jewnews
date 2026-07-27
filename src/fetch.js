/**
 * Couche HTTP : délai maximal, réessais avec repli exponentiel, requêtes
 * conditionnelles. Pensée pour des serveurs de presse capricieux — un flux
 * qui tombe ne doit jamais faire échouer la revue entière.
 */

const USER_AGENT =
  'jewnews/1.0 (revue de presse hebdomadaire; +https://github.com/aproxbeta-hub/Jewbooks-jewnews)';

/** Codes sur lesquels un réessai a une chance d'aboutir. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

export class HttpError extends Error {
  constructor(status, statusText, url) {
    super(`HTTP ${status} ${statusText || ''}`.trim());
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Récupère une URL en texte.
 *
 * @returns {Promise<{status:number, body:string|null, etag?:string,
 *                    lastModified?:string, url:string, notModified:boolean}>}
 *          `notModified` vaut true sur un 304 : l'appelant réutilise son cache.
 */
export async function fetchText(url, options = {}) {
  const {
    timeout = 20000,
    retries = 2,
    etag,
    lastModified,
    headers = {},
    accept = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
  } = options;

  const requestHeaders = {
    'user-agent': USER_AGENT,
    accept,
    'accept-language': 'fr,en;q=0.8,*;q=0.5',
    ...headers,
  };
  if (etag) requestHeaders['if-none-match'] = etag;
  if (lastModified) requestHeaders['if-modified-since'] = lastModified;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });

      if (response.status === 304) {
        return { status: 304, body: null, notModified: true, url: response.url || url };
      }
      if (!response.ok) {
        const error = new HttpError(response.status, response.statusText, url);
        if (RETRYABLE.has(response.status) && attempt < retries) {
          lastError = error;
          continue;
        }
        throw error;
      }
      return {
        status: response.status,
        body: await response.text(),
        notModified: false,
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
        contentType: response.headers.get('content-type') || undefined,
        url: response.url || url,
      };
    } catch (error) {
      lastError = error;
      // Une erreur applicative (4xx non réessayable) est définitive.
      if (error instanceof HttpError && !RETRYABLE.has(error.status)) throw error;
      if (attempt === retries) break;
    }
  }
  throw lastError || new Error(`Échec de la requête vers ${url}`);
}

/** Variante JSON, pour les API (Google Books, iTunes, traducteurs). */
export async function fetchJson(url, options = {}) {
  const response = await fetchText(url, {
    accept: 'application/json',
    ...options,
  });
  if (!response.body) return null;
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error(`Réponse JSON illisible depuis ${url} : ${error.message}`);
  }
}

/** POST JSON -> JSON, utilisé par les fournisseurs de traduction. */
export async function postJson(url, payload, options = {}) {
  const { timeout = 60000, headers = {}, retries = 2 } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(800 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new HttpError(response.status, `${response.statusText} ${text.slice(0, 300)}`, url);
        if (RETRYABLE.has(response.status) && attempt < retries) {
          lastError = error;
          continue;
        }
        throw error;
      }
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && !RETRYABLE.has(error.status)) throw error;
      if (attempt === retries) break;
    }
  }
  throw lastError;
}
