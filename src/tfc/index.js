/** Point d'entrée du collecteur d'annuaire. */

export { CONFIG_DEFAUT, chargerConfig, compiler, fusionner } from './config.js';
export { scraper, analyserFichiers, creerRecuperateur, chargerRobots, Limiteur } from './scrape.js';
export { parseListe, parseFiche, nettoyerNom } from './parse.js';
export { extraireEmails, decoderCfEmail, desobfusquer, normaliserEmail, estEmailPlausible, estGenerique } from './emails.js';
export { depuisPlan, depuisListe, locs, estIndexDePlans } from './discover.js';
export { parseRobots, autorise, delaiPour, groupePour } from './robots.js';
export { versCsv, versJson, versNdjson, versTexte, rendreDiagnostic, cellule, COLONNES, FORMATS } from './output.js';
export { balises, liens, meta, texteDe, jsonLd, jsonEmbarque, champEtiquete, lignes, urlAbsolue, urlCanonique } from './html.js';
