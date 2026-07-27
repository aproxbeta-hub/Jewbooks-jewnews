/**
 * Expédition de la revue.
 *
 * Deux transports, au choix :
 *  - `smtp`   : n'importe quel serveur, y compris Gmail avec un mot de passe
 *               d'application. Le plus simple quand on a déjà une boîte.
 *  - `resend` : API HTTP, utile depuis un environnement où le port 587 est
 *               fermé — c'est le cas de beaucoup de CI, dont GitHub Actions.
 *
 * Le corps du message est déjà rendu par src/render/email.js ; ce module ne
 * s'occupe que de l'acheminement.
 */

import { postJson } from './fetch.js';

/** Découpe « a@x.fr, b@y.fr » en liste, en tolérant les points-virgules. */
export function parseDestinataires(valeur) {
  if (Array.isArray(valeur)) return valeur.filter(Boolean);
  return String(valeur || '')
    .split(/[,;]/)
    .map((adresse) => adresse.trim())
    .filter(Boolean);
}

/** Contrôle de forme minimal : détecter une faute de frappe, pas valider la RFC. */
export function adresseValide(adresse) {
  const extraite = /<([^>]+)>\s*$/.exec(adresse);
  const brute = (extraite ? extraite[1] : adresse).trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(brute);
}

/**
 * Transport SMTP, par nodemailer.
 * Configuration : `SMTP_URL` (ex. smtps://user:motdepasse@smtp.gmail.com:465)
 * ou le quatuor SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
 */
async function transportSmtp(options = {}) {
  const { default: nodemailer } = await import('nodemailer');

  const url = options.url || process.env.SMTP_URL;
  const host = options.host || process.env.SMTP_HOST;
  if (!url && !host) {
    throw new Error(
      'Transport SMTP : définissez SMTP_URL, ou SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.',
    );
  }

  const transporteur = url
    ? nodemailer.createTransport(url)
    : nodemailer.createTransport({
        host,
        port: Number(options.port || process.env.SMTP_PORT || 587),
        // 465 est implicitement TLS ; 587 passe par STARTTLS.
        secure: Number(options.port || process.env.SMTP_PORT || 587) === 465,
        auth: (options.user || process.env.SMTP_USER)
          ? {
              user: options.user || process.env.SMTP_USER,
              pass: options.pass || process.env.SMTP_PASS,
            }
          : undefined,
      });

  return {
    nom: 'smtp',
    async envoyer(message) {
      const info = await transporteur.sendMail({
        from: message.de,
        to: message.a,
        subject: message.sujet,
        text: message.texte,
        html: message.html,
        replyTo: message.repondreA || undefined,
      });
      return { id: info.messageId, accepte: info.accepted?.length ?? 0, refuse: info.rejected || [] };
    },
    async fermer() {
      transporteur.close?.();
    },
  };
}

/** Transport Resend (API HTTP). Configuration : `RESEND_API_KEY`. */
async function transportResend(options = {}) {
  const cle = options.cle || process.env.RESEND_API_KEY;
  if (!cle) throw new Error('Transport Resend : définissez RESEND_API_KEY.');

  return {
    nom: 'resend',
    async envoyer(message) {
      const reponse = await postJson(
        'https://api.resend.com/emails',
        {
          from: message.de,
          to: message.a,
          subject: message.sujet,
          html: message.html,
          text: message.texte,
          ...(message.repondreA ? { reply_to: message.repondreA } : {}),
        },
        { headers: { authorization: `Bearer ${cle}` }, timeout: 60000 },
      );
      return { id: reponse?.id || null, accepte: message.a.length, refuse: [] };
    },
    async fermer() {},
  };
}

/** Transport de test : n'envoie rien, mémorise le message. */
export function transportMemoire() {
  const envoyes = [];
  return {
    nom: 'memoire',
    envoyes,
    async envoyer(message) {
      envoyes.push(message);
      return { id: `memoire-${envoyes.length}`, accepte: message.a.length, refuse: [] };
    },
    async fermer() {},
  };
}

const TRANSPORTS = { smtp: transportSmtp, resend: transportResend };

export async function creerTransport(nom, options = {}) {
  const fabrique = TRANSPORTS[String(nom || 'smtp').toLowerCase()];
  if (!fabrique) {
    throw new Error(
      `Transport inconnu : « ${nom} ». Disponibles : ${Object.keys(TRANSPORTS).join(', ')}`,
    );
  }
  return fabrique(options);
}

/**
 * Envoie la revue.
 *
 * @param {object} message  { de, a, sujet, html, texte, repondreA }
 * @param {object} options  { transport } — nom, ou objet déjà construit
 */
export async function envoyerRevue(message, options = {}) {
  const destinataires = parseDestinataires(message.a);
  if (!destinataires.length) throw new Error('Aucun destinataire : précisez --email adresse@exemple.fr');

  const invalides = destinataires.filter((adresse) => !adresseValide(adresse));
  if (invalides.length) {
    throw new Error(`Adresse destinataire mal formée : ${invalides.join(', ')}`);
  }

  const de = message.de || process.env.JEWNEWS_FROM || destinataires[0];
  if (!adresseValide(de)) throw new Error(`Adresse d'expéditeur mal formée : ${de}`);

  const transport =
    typeof options.transport === 'object' && options.transport !== null
      ? options.transport
      : await creerTransport(options.transport, options);

  try {
    const resultat = await transport.envoyer({ ...message, a: destinataires, de });
    return { ...resultat, transport: transport.nom, destinataires };
  } finally {
    await transport.fermer?.();
  }
}
