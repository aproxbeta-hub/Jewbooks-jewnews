/**
 * Rendu Markdown : la version de travail de la revue, celle qu'on relit et
 * qu'on découpe pour alimenter une newsletter ou un chemin de fer.
 */

import { formatShortDate, formatLongDate } from '../util/dates.js';
import { escapeMarkdown } from '../util/text.js';

const dateCourte = (iso, precision) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (precision === 'mois') {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
  }
  return formatShortDate(date);
};

function ligneArticle(article, { montrerPays = false } = {}) {
  const titre = escapeMarkdown(article.titre);
  const lignes = [];

  const chapeau = [];
  if (montrerPays && article.pays) chapeau.push(`**${article.pays.nom}**`);
  if (article.editeur) chapeau.push(escapeMarkdown(article.editeur));
  const date = dateCourte(article.date, article.datePrecision);
  if (date) chapeau.push(article.datePrecision === 'mois' ? `${date} (date approximative)` : date);
  if (article.auteur) chapeau.push(escapeMarkdown(article.auteur));

  lignes.push(`- [${titre}](${article.lien})`);
  if (chapeau.length) lignes.push(`  ${chapeau.join(' · ')}`);
  if (article.resume) lignes.push(`  ${escapeMarkdown(article.resume)}`);
  if (article.traduit && article.titreOriginal && article.titreOriginal !== article.titre) {
    lignes.push(`  <sub>titre original : « ${escapeMarkdown(article.titreOriginal)} »</sub>`);
  }
  if (article.nbReprises > 0) {
    lignes.push(`  <sub>repris par ${article.nbReprises} autre(s) titre(s) : ${article.reprises.map(escapeMarkdown).join(', ')}</sub>`);
  }
  return lignes.join('\n');
}

function section(titre, articles, options = {}) {
  if (!articles?.length) return '';
  return `## ${titre}\n\n${articles.map((a) => ligneArticle(a, options)).join('\n\n')}\n`;
}

export function renderMarkdown(revue) {
  const { meta } = revue;
  const out = [];

  out.push(`# Revue de presse — ${meta.fenetre.libelle}`);
  out.push('');
  out.push(
    `*Veille européenne et parutions mondiales. Édition ${meta.edition}, ` +
      `établie le ${formatLongDate(new Date(meta.genereLe))}.*`,
  );
  out.push('');

  if (revue.calendrier) {
    const { debut, fin, parachot } = revue.calendrier;
    const paracha = parachot.length ? ` · paracha ${parachot.map((p) => p.nom).join(', ')}` : '';
    out.push(`> ${debut} – ${fin}${paracha}`);
    out.push('');
  }

  out.push(
    `**${meta.stats.sujets}** sujets retenus sur ${meta.stats.articlesCollectes} articles collectés, ` +
      `**${meta.stats.paysCouverts}** pays couverts, ${meta.stats.fluxOk}/${meta.stats.flux} flux interrogés avec succès.`,
  );
  out.push('');

  if (revue.aLaUne.length) {
    out.push('---');
    out.push('');
    out.push(section('À la une', revue.aLaUne, { montrerPays: true }));
  }

  if (revue.pays.length) {
    out.push('---');
    out.push('');
    out.push('# Europe, pays par pays');
    out.push('');
    for (const pays of revue.pays) {
      out.push(section(`${pays.nom}${pays.region ? ` — *${pays.region}*` : ''}`, pays.articles));
    }
  }

  if (revue.livres.length || revue.podcasts.length || revue.evenements.length) {
    out.push('---');
    out.push('');
    out.push('# Livres, podcasts et événements');
    out.push('');
    out.push(section('Parutions', revue.livres, { montrerPays: false }));
    out.push(section('Podcasts', revue.podcasts));
    out.push(section('Événements', revue.evenements));
  }

  out.push('---');
  out.push('');
  out.push('## Notes de collecte');
  out.push('');

  if (revue.paysSansRemontee.length) {
    out.push(
      `Aucune remontée cette semaine pour : ${revue.paysSansRemontee.map((p) => p.nom).join(', ')}.`,
    );
    out.push('');
  }

  const echecs = revue.rapport.filter((ligne) => ligne.statut === 'echec');
  if (echecs.length) {
    out.push(`Sources en échec (${echecs.length}) :`);
    out.push('');
    for (const echec of echecs) {
      out.push(`- ${escapeMarkdown(echec.nom)} — ${escapeMarkdown(echec.erreur || 'erreur inconnue')}`);
    }
    out.push('');
  }

  const t = meta.traduction;
  out.push(
    `Traduction : ${t.provider}${t.traduits ? ` — ${t.traduits} segments traduits, ${t.cache} depuis le cache` : ''}` +
      `${t.echecs ? `, ${t.echecs} en échec` : ''}.`,
  );
  if (t.erreurs?.length) {
    out.push('');
    for (const erreur of t.erreurs) out.push(`- ${escapeMarkdown(erreur)}`);
  }
  out.push('');

  return out.filter((bloc) => bloc !== '').join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
