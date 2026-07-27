/**
 * Rendu pour la boîte de réception.
 *
 * Volontairement distinct du rendu web. Les clients de messagerie ne sont pas
 * des navigateurs : Gmail supprime les variables CSS et une partie des
 * `@media`, Outlook ignore la mise en page moderne, et beaucoup de clients
 * réécrivent les couleurs en mode sombre. On s'en tient donc à des styles
 * **en ligne**, une seule colonne, aucune image de mise en page, et un texte
 * lisible même si toute la feuille de style saute.
 *
 * Produit aussi une version texte : c'est elle que lisent les aperçus de
 * notification et les clients qui refusent le HTML.
 */

import { escapeHtml } from '../util/text.js';
import { formatShortDate, formatLongDate } from '../util/dates.js';

const ENCRE = '#16150f';
const DOUX = '#5f5c51';
const TRAIT = '#ddd8ca';
const ACCENT = '#7a1f1f';
const FOND = '#faf9f6';

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
  if (montrerPays && article.pays) meta.push(`<strong style="color:${ACCENT}">${escapeHtml(article.pays.nom)}</strong>`);
  if (article.editeur) meta.push(escapeHtml(article.editeur));
  const date = dateCourte(article.date, article.datePrecision);
  if (date) meta.push(escapeHtml(date));
  if (article.auteur) meta.push(escapeHtml(article.auteur));
  if (article.isbn) meta.push(`ISBN ${escapeHtml(article.isbn)}`);

  const secondaire = [];
  if (article.traduit && article.titreOriginal && article.titreOriginal !== article.titre) {
    secondaire.push(`VO&nbsp;: «&nbsp;${escapeHtml(article.titreOriginal)}&nbsp;»`);
  }
  if (article.nbReprises) {
    secondaire.push(`repris par ${escapeHtml(article.reprises.join(', '))}`);
  }
  if (article.audio?.url) {
    secondaire.push(`<a href="${escapeHtml(article.audio.url)}" style="color:${ACCENT}">écouter</a>`);
  }

  return `<div style="margin:0 0 18px;padding:0 0 0 12px;border-left:2px solid ${TRAIT}">
  <div style="font-size:16px;line-height:1.35;margin:0 0 4px">
    <a href="${escapeHtml(article.lien)}" style="color:${ENCRE};text-decoration:none;font-weight:600">${escapeHtml(article.titre)}</a>
  </div>
  <div style="font-size:12px;color:${DOUX};margin:0 0 4px">${meta.join(' &middot; ')}</div>
  ${article.resume ? `<div style="font-size:14px;line-height:1.45;color:${ENCRE};margin:0 0 4px">${escapeHtml(article.resume)}</div>` : ''}
  ${secondaire.length ? `<div style="font-size:11px;color:${DOUX};font-style:italic">${secondaire.join(' &middot; ')}</div>` : ''}
</div>`;
}

function sectionHtml(titre, articles, options = {}) {
  if (!articles?.length) return '';
  return `<h2 style="font-size:15px;margin:26px 0 12px;padding:0 0 4px;border-bottom:1px solid ${TRAIT};color:${ENCRE}">
  ${escapeHtml(titre)} <span style="font-weight:400;color:${DOUX};font-size:12px">(${articles.length})</span>
</h2>
${articles.map((a) => articleHtml(a, options)).join('\n')}`;
}

function grandTitre(texte) {
  return `<h2 style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${ACCENT};margin:34px 0 4px;padding:0 0 4px;border-bottom:2px solid ${ACCENT}">${escapeHtml(texte)}</h2>`;
}

/** Objet du message : informatif dès la liste des messages. */
export function sujetEmail(revue) {
  const { stats, fenetre } = revue.meta;
  return `Revue de presse — ${fenetre.libelle} · ${stats.paysCouverts} pays, ${stats.sujets} sujets`;
}

/** Corps HTML du message. */
export function renderEmailHtml(revue) {
  const { meta } = revue;

  const sommaire = revue.pays
    .map((p) => `${escapeHtml(p.nom)}&nbsp;(${p.articles.length})`)
    .join(' &middot; ');

  const echecs = revue.rapport.filter((l) => l.statut === 'echec');
  const t = meta.traduction;

  const corps = [
    sectionHtml('À la une', revue.aLaUne, { montrerPays: true }),
    revue.pays.length ? grandTitre('Europe, pays par pays') : '',
    ...revue.pays.map((p) => sectionHtml(p.region ? `${p.nom} · ${p.region}` : p.nom, p.articles)),
    revue.livres.length || revue.podcasts.length || revue.evenements.length
      ? grandTitre('Livres, podcasts et événements')
      : '',
    sectionHtml('Parutions', revue.livres),
    sectionHtml('Podcasts', revue.podcasts),
    sectionHtml('Événements', revue.evenements),
  ]
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(sujetEmail(revue))}</title></head>
<body style="margin:0;padding:0;background:${FOND}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">
${escapeHtml(`${meta.stats.sujets} sujets · ${meta.stats.paysCouverts} pays · ${revue.livres.length} parutions`)}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FOND}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid ${TRAIT};border-radius:4px">
<tr><td style="padding:28px 26px;font-family:Georgia,'Times New Roman',serif;color:${ENCRE}">

  <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${ACCENT};font-family:Arial,Helvetica,sans-serif;font-weight:bold;margin:0 0 8px">
    Veille européenne &middot; parutions mondiales
  </div>
  <h1 style="font-size:26px;line-height:1.2;margin:0 0 8px;color:${ENCRE}">
    Revue de presse<br><span style="font-size:19px;font-weight:400;color:${DOUX}">${escapeHtml(meta.fenetre.libelle)}</span>
  </h1>
  ${
    revue.calendrier
      ? `<div style="font-size:13px;color:${DOUX};font-style:italic;margin:0 0 10px">${escapeHtml(revue.calendrier.debut)} – ${escapeHtml(revue.calendrier.fin)}${
          revue.calendrier.parachot.length
            ? ` · paracha ${escapeHtml(revue.calendrier.parachot.map((p) => p.nom).join(', '))}`
            : ''
        }</div>`
      : ''
  }
  <div style="font-size:12px;color:${DOUX};font-family:Arial,Helvetica,sans-serif;line-height:1.6;border-top:1px solid ${TRAIT};border-bottom:1px solid ${TRAIT};padding:8px 0;margin:12px 0 0">
    ${meta.stats.sujets} sujets &middot; ${meta.stats.articlesCollectes} articles dépouillés &middot; ${meta.stats.fluxOk}/${meta.stats.flux} flux<br>
    ${sommaire || 'aucun pays couvert'}
  </div>

  ${corps || `<p style="color:${DOUX};font-style:italic">Aucun sujet retenu pour cette période.</p>`}

  <div style="margin:32px 0 0;padding:14px 0 0;border-top:2px solid ${TRAIT};font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${DOUX};line-height:1.6">
    Traduction&nbsp;: ${escapeHtml(t.provider)}${t.traduits ? ` — ${t.traduits} segments, ${t.cache} en cache` : ''}${t.echecs ? `, ${t.echecs} en échec` : ''}.
    ${echecs.length ? `<br>${echecs.length} source(s) en échec&nbsp;: ${escapeHtml(echecs.slice(0, 8).map((e) => e.nom).join(', '))}${echecs.length > 8 ? '…' : ''}` : ''}
    ${revue.paysSansRemontee.length ? `<br>Sans remontée&nbsp;: ${escapeHtml(revue.paysSansRemontee.map((p) => p.nom).join(', '))}.` : ''}
    <br>Édition ${escapeHtml(meta.edition)}, établie le ${escapeHtml(formatLongDate(new Date(meta.genereLe)))} par jewnews.
  </div>

</td></tr></table>
</td></tr></table>
</body></html>
`;
}

/** Version texte, envoyée en alternative du HTML. */
export function renderEmailTexte(revue) {
  const lignes = [];
  const regle = (caractere) => caractere.repeat(64);

  lignes.push(`REVUE DE PRESSE — ${revue.meta.fenetre.libelle.toUpperCase()}`);
  lignes.push(regle('='));
  const { stats } = revue.meta;
  lignes.push(`${stats.sujets} sujets · ${stats.paysCouverts} pays · ${stats.fluxOk}/${stats.flux} flux`);
  if (revue.calendrier) {
    const paracha = revue.calendrier.parachot.map((p) => p.nom).join(', ');
    lignes.push(`${revue.calendrier.debut} – ${revue.calendrier.fin}${paracha ? ` · paracha ${paracha}` : ''}`);
  }
  lignes.push('');

  const bloc = (titre, articles, montrerPays = false) => {
    if (!articles?.length) return;
    lignes.push(titre.toUpperCase());
    lignes.push(regle('-'));
    for (const a of articles) {
      const meta = [
        montrerPays && a.pays ? a.pays.nom : null,
        a.editeur,
        dateCourte(a.date, a.datePrecision),
      ].filter(Boolean);
      lignes.push(`• ${a.titre}`);
      if (meta.length) lignes.push(`  ${meta.join(' · ')}`);
      if (a.resume) lignes.push(`  ${a.resume}`);
      if (a.traduit && a.titreOriginal !== a.titre) lignes.push(`  VO : « ${a.titreOriginal} »`);
      lignes.push(`  ${a.lien}`);
      lignes.push('');
    }
  };

  bloc('À la une', revue.aLaUne, true);
  if (revue.pays.length) {
    lignes.push('');
    lignes.push('EUROPE, PAYS PAR PAYS');
    lignes.push(regle('='));
    lignes.push('');
    for (const pays of revue.pays) bloc(pays.nom, pays.articles);
  }
  if (revue.livres.length || revue.podcasts.length || revue.evenements.length) {
    lignes.push('');
    lignes.push('LIVRES, PODCASTS ET ÉVÉNEMENTS');
    lignes.push(regle('='));
    lignes.push('');
    bloc('Parutions', revue.livres);
    bloc('Podcasts', revue.podcasts);
    bloc('Événements', revue.evenements);
  }

  const echecs = revue.rapport.filter((l) => l.statut === 'echec');
  lignes.push(regle('-'));
  lignes.push(`Traduction : ${revue.meta.traduction.provider}.`);
  if (echecs.length) lignes.push(`${echecs.length} source(s) en échec.`);
  if (revue.paysSansRemontee.length) {
    lignes.push(`Sans remontée : ${revue.paysSansRemontee.map((p) => p.nom).join(', ')}.`);
  }
  lignes.push(`Édition ${revue.meta.edition} — jewnews.`);

  return `${lignes.join('\n')}\n`;
}

/** Le message complet, prêt pour le transport. */
export function renderEmail(revue) {
  return {
    sujet: sujetEmail(revue),
    html: renderEmailHtml(revue),
    texte: renderEmailTexte(revue),
  };
}
