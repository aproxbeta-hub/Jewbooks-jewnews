# jewnews

Outil de veille de presse hebdomadaire pour une revue consacrée aux Juifs et à
l'Europe. Il produit, chaque semaine, un document unique qui rassemble :

- **l'Europe pays par pays** — ce que la presse locale et nationale de chaque
  pays européen a écrit sur les Juifs, dans la langue du pays, **traduit en
  français**, avec le lien vers l'article d'origine ;
- **les parutions mondiales** — livres, essais, traductions, sans limite
  géographique ;
- **les podcasts** et **les événements** (expositions, colloques, festivals).

Sortie en HTML autonome (à lire ou à imprimer), en Markdown (à découper), en
JSON (à réinjecter ailleurs) — ou **directement dans votre boîte, tous les
dimanches matin**.

```
jewnews revue --semaine --traduction anthropic --email moi@exemple.fr
```

---

## Installation

```bash
git clone <ce dépôt>
cd Jewbooks-jewnews
npm install
node bin/jewnews.js aide
```

Node 20 ou plus. Trois dépendances : `@hebcal/core` et ses locales pour le
repère calendaire optionnel, `nodemailer` pour l'envoi SMTP. L'analyse de flux,
la traduction, le dédoublonnage et le rendu n'utilisent rien d'autre que la
bibliothèque standard.

## Comment la couverture européenne est obtenue

Un annuaire manuel des journaux régionaux de quarante pays serait impossible à
tenir à jour. L'outil combine donc deux sources :

1. **Une requête Google News par pays et par langue.** Pour chaque pays,
   `sources/europe.json` déclare l'édition Google News à interroger
   (`hl`/`gl`/`ceid`) et `sources/langues.json` fournit le vocabulaire local.
   La requête polonaise cherche `żydowski OR Żydzi OR synagoga…`, la hongroise
   `zsidó OR zsinagóga OR antiszemitizmus…`, et ainsi de suite. C'est ce qui
   fait remonter la presse locale : une dépêche de la *Gazeta Krakowska* ou du
   *Debreceni Napló* qu'aucun flux communautaire ne relaierait.
2. **Les médias communautaires**, quand ils publient un flux : *Jüdische
   Allgemeine*, *Szombat*, *Pagine Ebraiche*, *NIW*, *Şalom*, *K.* …

Deux profils de requête sont lancés par défaut, `actualite` (vie juive) et
`antisemitisme` (antisémitisme, mémoire, Shoah). Deux autres sont disponibles :
`culture` et `livres`.

**Pays couverts** : Allemagne, Albanie, Autriche, Belgique (fr et nl),
Biélorussie, Bosnie-Herzégovine, Bulgarie, Chypre, Croatie, Danemark, Espagne,
Estonie, Finlande, France, Grèce, Hongrie, Irlande, Islande, Italie, Lettonie,
Lituanie, Luxembourg, Macédoine du Nord, Malte, Moldavie, Monténégro, Norvège,
Pays-Bas, Pologne, Portugal, République tchèque, Roumanie, Royaume-Uni,
Russie, Serbie, Slovaquie, Slovénie, Suède, Suisse (de et fr), Turquie,
Ukraine. Les micro-États (Andorre, Liechtenstein, Monaco, Saint-Marin,
Vatican) sont volontairement absents : Google News n'a pas d'édition pour eux.

## Traduction

Rien n'est traduit par défaut. Choisissez un fournisseur :

| `--traduction`  | Variable d'environnement                    | Remarque                             |
|-----------------|---------------------------------------------|--------------------------------------|
| `aucun`         | —                                           | par défaut, titres en langue d'origine |
| `anthropic`     | `ANTHROPIC_API_KEY`                         | par lots, registre de presse         |
| `deepl`         | `DEEPL_API_KEY`                             | clé finissant par `:fx` = offre gratuite |
| `libretranslate`| `LIBRETRANSLATE_URL` (+ `LIBRETRANSLATE_API_KEY`) | instance auto-hébergée         |

Trois garanties :

- **le texte original est toujours conservé** et affiché sous la traduction,
  pour que la rédaction puisse vérifier ;
- **les traductions sont mises en cache** sur disque : d'une semaine à l'autre,
  seuls les nouveaux articles sont facturés ;
- **une panne du traducteur ne fait pas échouer la revue** : le titre reste en
  langue d'origine et l'incident figure dans les notes de collecte.

Seuls les articles effectivement retenus sont traduits, jamais l'intégralité de
la collecte.

Pour Anthropic, le modèle est `claude-sonnet-5` ; changez-le avec
`JEWNEWS_ANTHROPIC_MODEL`.

## Recevoir la revue par courriel

### En une commande

```bash
export SMTP_URL='smtps://vous%40gmail.com:MOTDEPASSEAPP@smtp.gmail.com:465'
jewnews revue --semaine --traduction anthropic \
  --email vous@gmail.com --sans-fichiers
```

Avec Gmail, `MOTDEPASSEAPP` est un **mot de passe d'application** (compte
Google > Sécurité > Validation en deux étapes > Mots de passe des
applications), pas le mot de passe du compte. L'arobase de l'identifiant
s'écrit `%40` à l'intérieur d'une URL.

Pour vérifier avant d'envoyer quoi que ce soit :

```bash
jewnews revue --semaine --email vous@gmail.com --essai-a-vide
```

Le message est un multipart HTML + texte. Le HTML est **écrit spécialement
pour les clients de messagerie** : styles en ligne, une seule colonne, aucune
variable CSS ni requête média — Gmail et Outlook les suppriment. Le rendu web
(`--format html`) reste plus riche, mais ne survivrait pas à la boîte de
réception.

Transports disponibles : `smtp` (défaut, n'importe quel serveur) et `resend`
(API HTTP, `RESEND_API_KEY`) — utile depuis un environnement où le port 587
est fermé, ce qui est le cas de nombreux CI.

### Tous les dimanches, sans machine allumée

Le dépôt contient `.github/workflows/revue-hebdo.yml` : GitHub établit et
envoie la revue chaque dimanche à 6 h UTC (8 h à Paris l'été). Rien à
héberger. Configuration unique, dans *Settings > Secrets and variables >
Actions* :

| | Nom | Valeur |
|---|---|---|
| Secret | `SMTP_URL` | `smtps://vous%40gmail.com:MOTDEPASSEAPP@smtp.gmail.com:465` |
| Secret | `ANTHROPIC_API_KEY` | pour la traduction (sans elle, titres en VO) |
| Variable | `JEWNEWS_EMAIL` | destinataires, séparés par des virgules |
| Variable | `JEWNEWS_FROM` | expéditeur (facultatif) |

L'onglet *Actions > Revue hebdomadaire > Run workflow* permet de déclencher un
numéro à la demande, de restreindre les pays, ou de faire un essai à vide sans
rien envoyer. Chaque édition est aussi archivée comme *artifact* pendant
90 jours — avec le tableau de bord des sources, régénéré à chaque fois : la
boîte de réception n'est pas la seule copie.

**Tant que `JEWNEWS_EMAIL` n'est pas définie, le travail réussit quand même** :
la revue est établie et déposée dans l'artifact, avec un avertissement visible
sur la page du run. Un échec hebdomadaire ne vous apprendrait rien et ne vous
laisserait rien à lire. Le récapitulatif du run indique dans tous les cas ce
qui a été envoyé, à qui, et combien de pays ont répondu.

Le cache des traductions est conservé d'une semaine à l'autre par le workflow,
donc seuls les nouveaux articles sont facturés.

### Ailleurs qu'avec GitHub

Une ligne de `crontab`, sur n'importe quelle machine allumée le dimanche :

```cron
0 8 * * 0 cd /chemin/vers/Jewbooks-jewnews && /usr/bin/node bin/jewnews.js revue \
  --semaine --traduction anthropic --email vous@exemple.fr --sans-fichiers --silencieux
```

## Utilisation

```bash
# La semaine en cours, du dimanche au samedi, traduite
jewnews revue --semaine --traduction anthropic

# Quinze jours sur quatre pays, en Markdown sur la sortie standard
jewnews revue --pays FR,DE,PL,HU --jours 14 --format md --stdout

# Une semaine précise, plus de place par pays
jewnews revue --semaine-du 2026-07-19 --par-pays 10 --sortie archives/

# Rien que les médias communautaires, sans Google News
jewnews revue --sans-google-news

# Vérifier que les flux répondent encore
jewnews sources --check

# Une page où chaque source est cliquable, pour juger la couverture
jewnews sources --html dist/sources.html
```

`sources --html` engendre un tableau de bord autonome où **chaque source est
un lien vivant**. Pour chaque pays et chaque requête, « Voir les résultats du
jour » ouvre Google News dans la langue et l'édition du pays : ce sont les
articles réels, en ce moment. C'est le moyen de juger la couverture — et de
corriger un vocabulaire qui remonte du bruit — sans rien exécuter.

Les fichiers sont écrits dans `dist/` sous le nom `revue-AAAA-MM-JJ.html`,
`.md`, `.json`. Voir `jewnews aide` pour la liste complète des options.

### Options principales

| Option | Effet |
|---|---|
| `--jours <n>` / `--semaine` / `--semaine-du <date>` / `--depuis` / `--jusqu-a` | période |
| `--pays FR,DE,PL` | restreindre le périmètre |
| `--profils actualite,antisemitisme,culture,livres` | requêtes lancées par pays |
| `--par-pays <n>` | articles retenus par pays (défaut 6) |
| `--pertinence-min <n>` | seuil de pertinence juive (défaut 3) |
| `--traduction <nom>` | fournisseur de traduction |
| `--format html,md,json,email,texte` | formats produits |
| `--email <adresses>` / `--transport smtp\|resend` / `--essai-a-vide` | envoi par courriel |
| `--sans-fichiers` | n'écrire aucun fichier, se contenter d'envoyer |
| `--calendrier` | ajoute le repère du calendrier hébraïque |
| `--sans-cache` / `--vider-cache` | gestion du cache disque |

Et pour la commande `sources` : `--check` teste les flux, `--html <fichier>`
engendre le tableau de bord cliquable, `--pays` et `--sans-google-news`
restreignent le périmètre comme pour `revue`.

## Ce qui se passe entre la collecte et la page

1. **Collecte** — tous les flux en parallèle (8 par défaut), avec requêtes
   conditionnelles `ETag`/`Last-Modified`, réessais à repli exponentiel et
   délai maximal. Une source qui tombe est signalée, jamais fatale.
2. **Pertinence** — chaque article est noté dans **la langue de son flux**. Les
   racines sont comparées par préfixe, faute de quoi la veille manquerait toute
   l'Europe centrale et orientale : « Żydach » ne ressemble pas à « Żydzi »,
   ni « juutalaisten » à « juutalaiset ». La comparaison est cantonnée à la
   langue du flux, sinon le hongrois *rabbit* (accusatif de « rabbi »)
   ferait remonter tous les lapins de la presse anglaise.
3. **Dédoublonnage** — d'abord par URL canonique (traçage retiré), puis par
   similarité de titre à l'intérieur d'un même pays. Le même sujet traité dans
   deux pays différents **reste séparé** : c'est justement ce qu'une revue
   européenne veut montrer. Le représentant choisi privilégie un lien direct
   sur une redirection Google News.
4. **Classement** — pertinence, poids de la source, nombre d'éditeurs distincts
   ayant repris le sujet, fraîcheur.
5. **Rubriques** — une source dédiée (éditeur, podcast, musée) va dans sa
   rubrique ; la presse d'un pays reste dans son pays quel que soit son sujet ;
   une parution repérée dans la presse est en outre reprise dans Livres.
6. **Traduction** puis **rendu**.

## Parutions

La rubrique Livres est alimentée par trois canaux : les flux spécialisés
(*Jewish Book Council*, *Jewish Review of Books*, *In geveb*…), une requête
Google News « parutions » dans six langues, et l'API Google Books interrogée
par sujet et triée par nouveauté (`subject:"Jewish"`, `subject:"Yiddish"`…).

Google Books date souvent au mois ou à l'année près. Les dates au mois sont
retenues et **signalées comme approximatives** ; celles à l'année sont
écartées, faute d'être une actualité de la semaine.

**Une clé `GOOGLE_BOOKS_API_KEY` est nécessaire en intégration continue.** Le
quota anonyme de l'API se calcule par adresse IP ; celle d'un runner GitHub
est partagée avec le monde entier et déjà épuisée, si bien que les trente
requêtes reviennent en HTTP 429. C'est ce qui a vidé la rubrique Parutions du
premier numéro. La clé est gratuite (console Google Cloud → API Books) et se
pose en secret du dépôt. En local, sans clé, ça passe généralement.

## Personnalisation

Tout se règle dans trois fichiers JSON, relus à chaque exécution :

- `sources/langues.json` — vocabulaire par langue. `noyau`, `antisemitisme`,
  `culture` et `livres` en mots pleins servent aux requêtes ; `racines` sert à
  la détection de pertinence et se compare par préfixe.
- `sources/europe.json` — pays, éditions Google News, médias communautaires,
  poids éditorial.
- `sources/monde.json` — livres, podcasts, événements, réglages Google Books.

Ajouter un média : une entrée dans le tableau `medias` du pays. Ajouter un
pays : un objet avec ses `editions` et, si sa langue est nouvelle, une entrée
dans `langues.json`. Les tests vérifient que chaque édition renvoie à une
langue déclarée et que chaque langue fournit les quatre groupes.

## Limites connues, à lire avant la première édition

- **Seize flux communautaires sur trente-quatre ne répondent pas** (vérifié le
  16 août 2026, workflow « Vérifier les sources »). Six refusent les clients
  automatiques ou ne servent pas de flux ; dix sont introuvables, et deux
  adresses ont été essayées pour chacun sans succès. Tous sont désactivés avec
  le motif en commentaire dans `sources/europe.json` et `sources/monde.json`.
  Deviner ces adresses à l'aveugle ne marche pas : il faut l'adresse exacte,
  que la rédaction obtiendra plus vite que n'importe quelle heuristique.
  Ce qui répond, en revanche, répond bien : K., Tribune Juive, JForum,
  Alliance, Jüdische Allgemeine, Belltower, Jewish News UK, Pagine Ebraiche,
  Shalom, Chidusz, Szombat, NIW, Jonet, Joods Actueel, Lechaim, Jewish Review
  of Books, Forward Culture, JTA, Unorthodox et le mahj.
- **Les liens Google News sont des redirections.** Ils fonctionnent dans un
  navigateur, mais le dédoublonnage préfère systématiquement un lien direct
  quand un média communautaire couvre le même sujet.
- **Google News plafonne ses résultats** (une centaine par requête). Sur un
  pays très actif, `--profils` supplémentaires donnent plus de rappel que
  l'élargissement de la fenêtre.
- **La détection de type reste heuristique.** Un article de presse annonçant
  un livre est classé « livre » ; un compte rendu d'exposition, « événement ».
  Les erreurs de rubrique sont attendues et sans gravité : rien n'est perdu,
  l'article reste dans la rubrique de son pays.
- **Aucune reprise de contenu.** L'outil ne stocke ni ne republie les articles :
  titre, chapô, éditeur, date et lien. La traduction porte sur ces seuls
  éléments.

## Tests

```bash
npm test
```

126 tests, sans accès réseau : le réseau est simulé par des fixtures, y compris
pour la génération de bout en bout d'une revue complète et pour l'expédition du
message (transport en mémoire).

## Licence

MIT.
