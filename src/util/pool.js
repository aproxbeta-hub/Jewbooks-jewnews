/**
 * Exécution concurrente bornée. Une veille qui interroge 80 flux ne doit ni
 * les appeler un par un, ni ouvrir 80 connexions simultanées.
 */

/**
 * Applique `worker` à chaque élément avec au plus `limit` tâches en vol.
 * Les résultats sont renvoyés dans l'ordre des entrées. Un worker qui rejette
 * n'interrompt pas les autres : l'entrée correspondante vaut
 * `{ ok: false, error }`, les autres `{ ok: true, value }`.
 */
export async function mapPool(items, limit, worker, onProgress) {
  const list = [...items];
  const results = new Array(list.length);
  const concurrency = Math.max(1, Math.min(limit || 1, list.length));
  let cursor = 0;
  let done = 0;

  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      try {
        results[index] = { ok: true, value: await worker(list[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
      done += 1;
      onProgress?.(done, list.length, list[index]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

/** Découpe un tableau en tranches de taille `size`. */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
