/**
 * Rendu HTML autonome : un seul fichier, sans dépendance réseau, lisible en
 * clair comme en sombre et imprimable. C'est le format que la rédaction ouvre
 * le lundi matin, d'où le sommaire par pays en tête.
 */

import { escapeHtml } from '../util/text.js';
import { formatShortDate, formatLongDate } from '../util/dates.js';

const dateCourte = (iso, precision) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (precision === 'mois') {
    return `${new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date)} (approx.)`;
  }
  return formatShortDate(date);
};

function articleHtml(article, { montrerPays = false } = {}) {
  const meta = [];
  if (montrerPays && article.pays) meta.push(`<span class="pays">${escapeHtml(article.pays.nom)}</span>`);
  if (article.editeur) meta.push(escapeHtml(article.editeur));
  const date = dateCourte(article.date, article.datePrecision);
  if (date) meta.push(escapeHtml(date));
  if (article.auteur) meta.push(escapeHtml(article.auteur));

  const etiquettes = (article.etiquettes || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');

  const original =
    article.traduit && article.titreOriginal && article.titreOriginal !== article.titre
      ? `<p class="vo">Titre original : «&nbsp;${escapeHtml(article.titreOriginal)}&nbsp;»</p>`
      : '';

  const reprises = article.nbReprises
    ? `<p class="reprises">Également repris par ${article.nbReprises} titre(s)&nbsp;: ${escapeHtml(article.reprises.join(', '))}</p>`
    : '';

  const audio = article.audio?.url
    ? `<p class="audio"><a href="${escapeHtml(article.audio.url)}">Écouter l'épisode</a></p>`
    : '';

  const isbn = article.isbn ? `<span class="isbn">ISBN ${escapeHtml(article.isbn)}</span>` : '';

  return `<article class="item">
  <h3><a href="${escapeHtml(article.lien)}" rel="noopener noreferrer" target="_blank">${escapeHtml(article.titre)}</a></h3>
  <p class="meta">${meta.join('<span class="sep">·</span>')} ${isbn} ${etiquettes}</p>
  ${article.resume ? `<p class="resume">${escapeHtml(article.resume)}</p>` : ''}
  ${audio}
  ${original}
  ${reprises}
</article>`;
}

function sectionHtml(id, titre, articles, options = {}) {
  if (!articles?.length) return '';
  return `<section id="${escapeHtml(id)}" class="bloc">
  <h2>${escapeHtml(titre)}<span class="compte">${articles.length}</span></h2>
  ${articles.map((a) => articleHtml(a, options)).join('\n')}
</section>`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --fond: #fbfaf7;
  --fond-carte: #ffffff;
  --encre: #16150f;
  --encre-douce: #5d5a4f;
  --trait: #e0dcd0;
  --accent: #7a1f1f;
  --accent-doux: #f0e8e4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fond: #14140f;
    --fond-carte: #1c1c17;
    --encre: #ece9df;
    --encre-douce: #a09c8e;
    --trait: #33322a;
    --accent: #d98b7a;
    --accent-doux: #2a2019;
  }
}
:root[data-theme="dark"] {
  --fond: #14140f; --fond-carte: #1c1c17; --encre: #ece9df;
  --encre-douce: #a09c8e; --trait: #33322a; --accent: #d98b7a; --accent-doux: #2a2019;
}
:root[data-theme="light"] {
  --fond: #fbfaf7; --fond-carte: #ffffff; --encre: #16150f;
  --encre-douce: #5d5a4f; --trait: #e0dcd0; --accent: #7a1f1f; --accent-doux: #f0e8e4;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fond);
  color: var(--encre);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
  font-size: 17px;
  line-height: 1.55;
}
.page { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
header.une { border-bottom: 3px double var(--trait); padding-bottom: 1.5rem; margin-bottom: 2rem; }
h1 { font-size: clamp(1.7rem, 5vw, 2.5rem); line-height: 1.15; margin: 0 0 .4rem; letter-spacing: -.01em; }
.surtitre {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  text-transform: uppercase; letter-spacing: .14em; font-size: .7rem;
  color: var(--accent); margin: 0 0 .6rem; font-weight: 600;
}
.chapo { color: var(--encre-douce); margin: .3rem 0 0; font-style: italic; }
.chiffres {
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: .78rem;
  color: var(--encre-douce); margin-top: .9rem; line-height: 1.7;
}
nav.sommaire {
  background: var(--fond-carte); border: 1px solid var(--trait); border-radius: 6px;
  padding: 1rem 1.1rem; margin-bottom: 2.5rem;
}
nav.sommaire h2 {
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: .7rem;
  text-transform: uppercase; letter-spacing: .12em; color: var(--encre-douce);
  margin: 0 0 .6rem; border: 0; padding: 0;
}
nav.sommaire ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .35rem .5rem; }
nav.sommaire a {
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: .82rem;
  text-decoration: none; color: var(--encre); border: 1px solid var(--trait);
  border-radius: 999px; padding: .18rem .6rem; background: var(--fond);
}
nav.sommaire a:hover { border-color: var(--accent); color: var(--accent); }
nav.sommaire a .n { color: var(--encre-douce); font-size: .74em; margin-left: .3em; }
.bloc { margin: 0 0 2.75rem; scroll-margin-top: 1rem; }
.bloc > h2 {
  font-size: 1.15rem; margin: 0 0 1.1rem; padding-bottom: .35rem;
  border-bottom: 1px solid var(--trait); display: flex; align-items: baseline; gap: .5rem;
}
.compte {
  margin-left: auto; font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: .7rem; color: var(--encre-douce); font-weight: 400;
}
.groupe-titre {
  font-family: ui-sans-serif, system-ui, sans-serif; text-transform: uppercase;
  letter-spacing: .12em; font-size: .72rem; color: var(--accent);
  margin: 3rem 0 1.25rem; padding-bottom: .3rem; border-bottom: 2px solid var(--accent);
}
.item { margin: 0 0 1.35rem; padding-left: .9rem; border-left: 2px solid var(--trait); }
.item:hover { border-left-color: var(--accent); }
.item h3 { font-size: 1.04rem; margin: 0 0 .25rem; line-height: 1.3; font-weight: 600; }
.item h3 a { color: var(--encre); text-decoration: none; background-image: linear-gradient(var(--trait), var(--trait)); background-size: 100% 1px; background-repeat: no-repeat; background-position: 0 100%; }
.item h3 a:hover { color: var(--accent); background-image: linear-gradient(var(--accent), var(--accent)); }
.meta {
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: .76rem;
  color: var(--encre-douce); margin: 0 0 .35rem;
}
.meta .sep { margin: 0 .4em; opacity: .5; }
.meta .pays { color: var(--accent); font-weight: 600; }
.tag {
  display: inline-block; margin-left: .35rem; padding: .05rem .4rem;
  background: var(--accent-doux); color: var(--accent); border-radius: 3px;
  font-size: .68rem; letter-spacing: .02em;
}
.isbn { opacity: .75; }
.resume { margin: .25rem 0; color: var(--encre); }
.vo, .reprises, .audio {
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: .74rem;
  color: var(--encre-douce); margin: .3rem 0 0;
}
.vo { font-style: italic; }
.audio a { color: var(--accent); }
footer.colophon {
  margin-top: 3.5rem; padding-top: 1.25rem; border-top: 3px double var(--trait);
  font-family: ui-sans-serif, system-ui, sans-serif; font-size: .76rem; color: var(--encre-douce);
}
footer.colophon h2 { font-size: .72rem; text-transform: uppercase; letter-spacing: .12em; margin: 0 0 .5rem; }
footer.colophon ul { padding-left: 1.1rem; margin: .4rem 0; }
footer.colophon details { margin-top: .8rem; }
footer.colophon summary { cursor: pointer; }
footer.colophon table { width: 100%; border-collapse: collapse; margin-top: .6rem; font-size: .72rem; }
footer.colophon th, footer.colophon td { text-align: left; padding: .2rem .4rem; border-bottom: 1px solid var(--trait); vertical-align: top; }
.vide { color: var(--encre-douce); font-style: italic; }
@media print {
  body { background: #fff; color: #000; font-size: 11pt; }
  nav.sommaire, footer.colophon details { display: none; }
  .item { break-inside: avoid; }
  .item h3 a::after { content: " (" attr(href) ")"; font-size: .75em; font-weight: 400; word-break: break-all; }
}
`;

export function renderHtml(revue) {
  const { meta } = revue;
  const titre = `Revue de presse — ${meta.fenetre.libelle}`;

  const ancres = [
    revue.aLaUne.length ? { id: 'a-la-une', nom: 'À la une', n: revue.aLaUne.length } : null,
    ...revue.pays.map((p) => ({ id: `pays-${p.code.toLowerCase()}`, nom: p.nom, n: p.articles.length })),
    revue.livres.length ? { id: 'livres', nom: 'Parutions', n: revue.livres.length } : null,
    revue.podcasts.length ? { id: 'podcasts', nom: 'Podcasts', n: revue.podcasts.length } : null,
    revue.evenements.length ? { id: 'evenements', nom: 'Événements', n: revue.evenements.length } : null,
  ].filter(Boolean);

  const sommaire = `<nav class="sommaire">
  <h2>Sommaire</h2>
  <ul>${ancres
    .map((a) => `<li><a href="#${a.id}">${escapeHtml(a.nom)}<span class="n">${a.n}</span></a></li>`)
    .join('')}</ul>
</nav>`;

  const calendrier = revue.calendrier
    ? `<p class="chapo">${escapeHtml(revue.calendrier.debut)} – ${escapeHtml(revue.calendrier.fin)}${
        revue.calendrier.parachot.length
          ? ` · paracha ${escapeHtml(revue.calendrier.parachot.map((p) => p.nom).join(', '))}`
          : ''
      }</p>`
    : '';

  const paysHtml = revue.pays.length
    ? `<h2 class="groupe-titre">Europe, pays par pays</h2>\n${revue.pays
        .map((p) =>
          sectionHtml(
            `pays-${p.code.toLowerCase()}`,
            p.region ? `${p.nom} · ${p.region}` : p.nom,
            p.articles,
          ),
        )
        .join('\n')}`
    : '<p class="vide">Aucune remontée pour la période.</p>';

  const culturel =
    revue.livres.length || revue.podcasts.length || revue.evenements.length
      ? `<h2 class="groupe-titre">Livres, podcasts et événements</h2>
${sectionHtml('livres', 'Parutions', revue.livres)}
${sectionHtml('podcasts', 'Podcasts', revue.podcasts)}
${sectionHtml('evenements', 'Événements', revue.evenements)}`
      : '';

  const echecs = revue.rapport.filter((ligne) => ligne.statut === 'echec');
  const t = meta.traduction;

  const colophon = `<footer class="colophon">
  <h2>Notes de collecte</h2>
  <p>
    ${meta.stats.flux} flux interrogés, ${meta.stats.fluxEnEchec} en échec.
    ${meta.stats.articlesCollectes} articles collectés, ${meta.stats.articlesEcartes} écartés faute de pertinence,
    ${meta.stats.sujets} sujets après dédoublonnage.
    Traduction&nbsp;: ${escapeHtml(t.provider)}${t.traduits ? ` (${t.traduits} segments, ${t.cache} en cache)` : ''}${
      t.echecs ? `, ${t.echecs} en échec` : ''
    }.
  </p>
  ${
    revue.paysSansRemontee.length
      ? `<p>Sans remontée cette semaine&nbsp;: ${escapeHtml(revue.paysSansRemontee.map((p) => p.nom).join(', '))}.</p>`
      : ''
  }
  ${
    echecs.length
      ? `<details><summary>${echecs.length} source(s) en échec</summary>
    <table><thead><tr><th>Source</th><th>Erreur</th></tr></thead><tbody>
    ${echecs
      .map((e) => `<tr><td>${escapeHtml(e.nom)}</td><td>${escapeHtml(e.erreur || '')}</td></tr>`)
      .join('')}
    </tbody></table></details>`
      : ''
  }
  ${
    t.erreurs?.length
      ? `<details><summary>Avertissements de traduction</summary><ul>${t.erreurs
          .map((e) => `<li>${escapeHtml(e)}</li>`)
          .join('')}</ul></details>`
      : ''
  }
  <p>Édition ${escapeHtml(meta.edition)} — produite par jewnews le ${escapeHtml(
    formatLongDate(new Date(meta.genereLe)),
  )}.</p>
</footer>`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titre)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header class="une">
  <p class="surtitre">Veille européenne · parutions mondiales</p>
  <h1>${escapeHtml(titre)}</h1>
  <p class="chapo">Presse locale et nationale de ${meta.stats.paysCouverts} pays, traduite en français.</p>
  ${calendrier}
  <p class="chiffres">${meta.stats.sujets} sujets · ${meta.stats.articlesCollectes} articles dépouillés · ${
    meta.stats.fluxOk
  }/${meta.stats.flux} flux · établie le ${escapeHtml(formatLongDate(new Date(meta.genereLe)))}</p>
</header>
${sommaire}
${sectionHtml('a-la-une', 'À la une', revue.aLaUne, { montrerPays: true })}
${paysHtml}
${culturel}
${colophon}
</div>
</body>
</html>
`;
}
