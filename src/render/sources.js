/**
 * Tableau de bord des sources.
 *
 * Une page autonome où **chaque source est un lien vivant**. Pour la veille
 * Google News, deux liens par requête : « voir les résultats » ouvre
 * l'interface Google News et affiche les articles réels du jour dans la langue
 * du pays ; « flux » donne l'URL RSS que l'outil interroge.
 *
 * Son intérêt est de pouvoir juger la couverture sans rien exécuter : on
 * clique sur la Pologne, on lit ce qui remonte, on corrige le vocabulaire dans
 * sources/langues.json si le résultat déçoit.
 */

import { escapeHtml } from '../util/text.js';
import { formatLongDate } from '../util/dates.js';

const PROFIL_LABEL = {
  actualite: 'Actualité communautaire',
  antisemitisme: 'Antisémitisme et mémoire',
  culture: 'Culture et vie intellectuelle',
  livres: 'Parutions',
};

const STYLE = `
:root {
  color-scheme: light dark;
  --fond:#fbfaf7; --carte:#fff; --encre:#16150f; --doux:#5d5a4f;
  --trait:#e0dcd0; --accent:#7a1f1f; --accent-doux:#f2eae6;
}
@media (prefers-color-scheme: dark) {
  :root { --fond:#14140f; --carte:#1c1c17; --encre:#ece9df; --doux:#a09c8e;
          --trait:#33322a; --accent:#d98b7a; --accent-doux:#2a2019; }
}
:root[data-theme="dark"] { --fond:#14140f; --carte:#1c1c17; --encre:#ece9df; --doux:#a09c8e; --trait:#33322a; --accent:#d98b7a; --accent-doux:#2a2019; }
:root[data-theme="light"] { --fond:#fbfaf7; --carte:#fff; --encre:#16150f; --doux:#5d5a4f; --trait:#e0dcd0; --accent:#7a1f1f; --accent-doux:#f2eae6; }
* { box-sizing:border-box; }
body { margin:0; background:var(--fond); color:var(--encre); font-size:16px; line-height:1.5;
  font-family:"Iowan Old Style",Palatino,Georgia,"Times New Roman",serif; }
.page { max-width:56rem; margin:0 auto; padding:2.5rem 1.25rem 5rem; }
header { border-bottom:3px double var(--trait); padding-bottom:1.4rem; margin-bottom:1.6rem; }
h1 { font-size:clamp(1.6rem,4.5vw,2.3rem); margin:0 0 .4rem; line-height:1.15; }
.surtitre { font-family:ui-sans-serif,system-ui,sans-serif; text-transform:uppercase;
  letter-spacing:.14em; font-size:.7rem; color:var(--accent); font-weight:600; margin:0 0 .6rem; }
.chapo { color:var(--doux); margin:.2rem 0; }
.chiffres { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.78rem; color:var(--doux); margin-top:.8rem; }
.mode-emploi { background:var(--accent-doux); border-left:3px solid var(--accent); padding:.9rem 1.1rem;
  margin:0 0 2rem; font-size:.88rem; border-radius:0 4px 4px 0; }
.mode-emploi p { margin:.3rem 0; }
nav { background:var(--carte); border:1px solid var(--trait); border-radius:6px; padding:.9rem 1rem; margin-bottom:2rem; }
nav h2 { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.7rem; text-transform:uppercase;
  letter-spacing:.12em; color:var(--doux); margin:0 0 .55rem; }
nav ul { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:.3rem .4rem; }
nav a { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.8rem; text-decoration:none;
  color:var(--encre); border:1px solid var(--trait); border-radius:999px; padding:.15rem .55rem; background:var(--fond); }
nav a:hover { border-color:var(--accent); color:var(--accent); }
.pays { background:var(--carte); border:1px solid var(--trait); border-radius:6px;
  padding:1rem 1.1rem; margin:0 0 1rem; scroll-margin-top:1rem; }
.pays > h2 { font-size:1.1rem; margin:0 0 .1rem; display:flex; align-items:baseline; gap:.5rem; flex-wrap:wrap; }
.pays > h2 .region { font-size:.74rem; font-weight:400; color:var(--doux);
  font-family:ui-sans-serif,system-ui,sans-serif; text-transform:uppercase; letter-spacing:.1em; }
.groupe-titre { font-family:ui-sans-serif,system-ui,sans-serif; text-transform:uppercase;
  letter-spacing:.12em; font-size:.72rem; color:var(--accent); margin:2.6rem 0 1rem;
  padding-bottom:.3rem; border-bottom:2px solid var(--accent); }
.requete { margin:.85rem 0 0; padding-left:.85rem; border-left:2px solid var(--trait); }
.requete:hover { border-left-color:var(--accent); }
.requete .quoi { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.78rem;
  font-weight:600; color:var(--encre); margin:0 0 .2rem; }
.requete .quoi .langue { font-weight:400; color:var(--doux); }
.termes { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.74rem;
  color:var(--doux); margin:0 0 .35rem; word-break:break-word; line-height:1.5; }
.liens { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.78rem; }
.liens a { color:var(--accent); text-decoration:none; border-bottom:1px solid transparent; }
.liens a:hover { border-bottom-color:var(--accent); }
.liens .voir { font-weight:600; }
.liens .sep { color:var(--doux); margin:0 .45rem; }
.medias { margin:.9rem 0 0; padding-top:.7rem; border-top:1px dashed var(--trait); }
.medias h3 { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.7rem; text-transform:uppercase;
  letter-spacing:.1em; color:var(--doux); margin:0 0 .45rem; }
.media { margin:0 0 .45rem; font-size:.9rem; }
.media a.nom { color:var(--encre); text-decoration:none; font-weight:600; border-bottom:1px solid var(--trait); }
.media a.nom:hover { color:var(--accent); border-bottom-color:var(--accent); }
.media .flux { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.74rem; color:var(--doux); }
.media .flux a { color:var(--doux); }
.aucun { font-size:.82rem; color:var(--doux); font-style:italic; margin:.9rem 0 0;
  padding-top:.7rem; border-top:1px dashed var(--trait); }
footer { margin-top:3rem; padding-top:1.2rem; border-top:3px double var(--trait);
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:.78rem; color:var(--doux); }
footer code { background:var(--accent-doux); padding:.1em .35em; border-radius:3px; font-size:.92em; }
@media print { nav { display:none; } .pays { break-inside:avoid; } }
`;

const lien = (url, texte, classe = '') =>
  `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${classe ? ` class="${classe}"` : ''}>${escapeHtml(texte)}</a>`;

/** Une requête Google News, avec ses deux liens et son vocabulaire. */
function requeteHtml(feed) {
  const termes = (feed.termes || []).join(' · ');
  return `<div class="requete">
  <p class="quoi">${escapeHtml(PROFIL_LABEL[feed.profil] || feed.profil || 'Requête')}
    <span class="langue">— ${escapeHtml(feed.edition?.ceid || feed.langue || '')}</span></p>
  ${termes ? `<p class="termes">${escapeHtml(termes)}</p>` : ''}
  <p class="liens">
    ${lien(feed.recherche || feed.url, 'Voir les résultats du jour', 'voir')}
    <span class="sep">·</span>${lien(feed.url, 'flux RSS')}
  </p>
</div>`;
}

/** Un média communautaire : lien vers le site et vers son flux. */
function mediaHtml(feed) {
  return `<div class="media">
  ${lien(feed.site || feed.url, feed.nom, 'nom')}
  <span class="flux"> — ${lien(feed.url, 'flux')}</span>
</div>`;
}

function paysHtml(pays) {
  const requetes = pays.feeds.filter((f) => f.origine === 'google-news');
  const medias = pays.feeds.filter((f) => f.origine !== 'google-news');

  return `<section class="pays" id="p-${escapeHtml(pays.code.toLowerCase())}">
  <h2>${escapeHtml(pays.nom)}${pays.region ? `<span class="region">${escapeHtml(pays.region)}</span>` : ''}</h2>
  ${requetes.map(requeteHtml).join('\n')}
  ${
    medias.length
      ? `<div class="medias"><h3>Médias communautaires</h3>${medias.map(mediaHtml).join('\n')}</div>`
      : '<p class="aucun">Aucun média communautaire déclaré : la couverture repose entièrement sur la presse généraliste ci-dessus.</p>'
  }
</section>`;
}

function blocMondial(titre, feeds) {
  if (!feeds.length) return '';
  const requetes = feeds.filter((f) => f.origine === 'google-news');
  const autres = feeds.filter((f) => f.origine !== 'google-news');
  return `<section class="pays">
  <h2>${escapeHtml(titre)}</h2>
  ${requetes.map(requeteHtml).join('\n')}
  ${autres.length ? `<div class="medias"><h3>Flux</h3>${autres.map(mediaHtml).join('\n')}</div>` : ''}
</section>`;
}

/**
 * @param {Array}  feeds  issus de buildEuropeanFeeds + buildGlobalFeeds
 * @param {object} options { jours, genereLe }
 */
export function renderSourcesHtml(feeds, options = {}) {
  const { jours = 7, genereLe = new Date() } = options;

  const parPays = new Map();
  const mondiaux = { livres: [], podcasts: [], evenements: [] };

  for (const feed of feeds) {
    if (feed.pays) {
      if (!parPays.has(feed.pays.code)) parPays.set(feed.pays.code, { ...feed.pays, feeds: [] });
      parPays.get(feed.pays.code).feeds.push(feed);
    } else {
      (mondiaux[feed.profil] || mondiaux.livres).push(feed);
    }
  }

  const pays = [...parPays.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const nbRequetes = feeds.filter((f) => f.origine === 'google-news').length;
  const nbMedias = feeds.length - nbRequetes;

  const sommaire = `<nav>
  <h2>Aller à</h2>
  <ul>${pays
    .map((p) => `<li><a href="#p-${escapeHtml(p.code.toLowerCase())}">${escapeHtml(p.nom)}</a></li>`)
    .join('')}</ul>
</nav>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sources de la veille — jewnews</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header>
  <p class="surtitre">jewnews · tableau de bord</p>
  <h1>Les sources de la veille</h1>
  <p class="chapo">Toutes les requêtes et tous les flux interrogés chaque semaine, pays par pays.</p>
  <p class="chiffres">${pays.length} pays · ${nbRequetes} requêtes de presse · ${nbMedias} flux · fenêtre de ${jours} jours · établi le ${escapeHtml(formatLongDate(genereLe))}</p>
</header>

<div class="mode-emploi">
  <p><strong>Ces liens sont vivants.</strong> «&nbsp;Voir les résultats du jour&nbsp;» ouvre Google News dans la langue et l'édition du pays : ce sont les articles réels, en ce moment.</p>
  <p>C'est le moyen de juger la couverture sans rien exécuter. Si la Pologne remonte du bruit ou passe à côté d'un sujet, le vocabulaire se corrige dans <code>sources/langues.json</code>, et les liens de cette page se régénèrent avec <code>jewnews sources --html</code>.</p>
  <p>Les liens «&nbsp;flux&nbsp;» sont les URL RSS que l'outil interroge&nbsp;: un flux qui affiche une erreur dans le navigateur est un flux à corriger dans <code>sources/europe.json</code>.</p>
</div>

${sommaire}
<h2 class="groupe-titre">Europe, pays par pays</h2>
${pays.map(paysHtml).join('\n')}

<h2 class="groupe-titre">Sources mondiales</h2>
${blocMondial('Parutions', mondiaux.livres)}
${blocMondial('Podcasts', mondiaux.podcasts)}
${blocMondial('Événements', mondiaux.evenements)}

<footer>
  <p>Le <code>when:${jours}d</code> des requêtes borne les résultats à la fenêtre de la veille. En l'ôtant de l'URL, Google News renvoie tout son historique.</p>
  <p>Page engendrée par <code>jewnews sources --html</code>. Aucune donnée n'est collectée ici&nbsp;: ce ne sont que des liens.</p>
</footer>
</div>
</body>
</html>
`;
}
