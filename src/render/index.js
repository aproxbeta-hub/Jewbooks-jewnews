import { renderMarkdown } from './markdown.js';
import { renderHtml } from './html.js';
import { renderEmail, renderEmailHtml, renderEmailTexte, sujetEmail } from './email.js';

/** Rendu JSON : la revue brute, pour alimenter un CMS ou un autre outil. */
export const renderJson = (revue) => `${JSON.stringify(revue, null, 2)}\n`;

export const FORMATS = {
  html: { extension: 'html', rendre: renderHtml },
  md: { extension: 'md', rendre: renderMarkdown },
  markdown: { extension: 'md', rendre: renderMarkdown },
  json: { extension: 'json', rendre: renderJson },
  email: { extension: 'email.html', rendre: renderEmailHtml },
  texte: { extension: 'txt', rendre: renderEmailTexte },
};

export { renderMarkdown, renderHtml, renderEmail, renderEmailHtml, renderEmailTexte, sujetEmail };
