/**
 * Cache disque. Deux usages :
 *  - HTTP conditionnel (ETag / Last-Modified) pour ne pas retélécharger un flux
 *    inchangé, ce qui est la politesse minimale quand on interroge 80 éditeurs ;
 *  - mémorisation des traductions, qui sont payantes et parfaitement stables.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const hash = (value) => createHash('sha1').update(String(value)).digest('hex').slice(0, 24);

export class Cache {
  /**
   * @param {string} dir      répertoire de stockage
   * @param {boolean} enabled quand false, toutes les opérations sont neutres
   */
  constructor(dir = '.cache', enabled = true) {
    this.dir = dir;
    this.enabled = enabled;
    this.namespaces = new Map();
    this.dirty = new Set();
  }

  #file(namespace) {
    return path.join(this.dir, `${namespace}.json`);
  }

  async #load(namespace) {
    if (this.namespaces.has(namespace)) return this.namespaces.get(namespace);
    let data = {};
    if (this.enabled) {
      try {
        data = JSON.parse(await readFile(this.#file(namespace), 'utf8'));
      } catch {
        data = {}; // absent ou corrompu : on repart d'un cache vide
      }
    }
    this.namespaces.set(namespace, data);
    return data;
  }

  async get(namespace, key) {
    if (!this.enabled) return undefined;
    const data = await this.#load(namespace);
    return data[hash(key)];
  }

  async set(namespace, key, value) {
    if (!this.enabled) return;
    const data = await this.#load(namespace);
    data[hash(key)] = value;
    this.dirty.add(namespace);
  }

  /** Supprime les entrées dont `fetchedAt` dépasse `maxAgeMs`. */
  async prune(namespace, maxAgeMs) {
    if (!this.enabled) return 0;
    const data = await this.#load(namespace);
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [key, entry] of Object.entries(data)) {
      const stamp = entry && typeof entry === 'object' ? entry.fetchedAt : null;
      if (stamp && new Date(stamp).getTime() < cutoff) {
        delete data[key];
        removed += 1;
      }
    }
    if (removed) this.dirty.add(namespace);
    return removed;
  }

  /** Écrit sur disque les espaces de noms modifiés. */
  async flush() {
    if (!this.enabled || !this.dirty.size) return;
    await mkdir(this.dir, { recursive: true });
    await Promise.all(
      [...this.dirty].map((namespace) =>
        writeFile(this.#file(namespace), JSON.stringify(this.namespaces.get(namespace)), 'utf8'),
      ),
    );
    this.dirty.clear();
  }

  async clear() {
    this.namespaces.clear();
    this.dirty.clear();
    await rm(this.dir, { recursive: true, force: true });
  }
}
