# Riviera Tower — Project Pilot (mom-tracker)

Application web de pilotage du chantier Riviera Tower : actions / MOM (minutes of meeting),
tenders et chaîne de soumission, plannings par zone, rapports imprimables, suivi acier.
Propriétaire et administrateur de l'app : **HORN, Philippe** (`APP_ADMIN` dans `app-core.js`).

- Langue de travail avec l'utilisateur : **français**.
- Langue du code, des commentaires et de l'interface : **anglais** (garder ce choix).

## Architecture — aucune étape de build

- `index.html` charge React 18 (UMD), Babel standalone, SheetJS (`xlsx`) et Firebase depuis des CDN.
- Il récupère ensuite les fichiers JS **dans cet ordre fixe** (`APP_PARTS`), les concatène et fait
  **une seule** transformation Babel (JSX) puis un `eval` :

  `app-core.js` → `app-tenders.js` → `app-schedule.js` → `app-zone.js` → `app-reports.js` → `app-steel.js` → `app-inventory.js` → `app-concrete.js` → `app-manpower.js` → `app-mount.js`

- Tous les fichiers partagent **une seule portée globale** : une fonction définie dans `app-core.js`
  est utilisable partout, sans `import`/`export`. Attention aux collisions de noms entre fichiers.
- `app-mount.js` doit rester **le dernier** (il rend `App`).
- Pour ajouter un nouveau fichier : l'ajouter à `APP_PARTS` dans `index.html`, avant `app-mount.js`.
- En cas d'erreur de syntaxe, `index.html` affiche « BABEL ERROR » avec le nom du fichier fautif.

| Fichier | Contenu |
|---|---|
| `app-core.js` | Constantes, clés de stockage, helpers dates/permissions, composants partagés, `App` |
| `app-tenders.js` | Tender sheet, chaîne de soumission, matériaux, shop drawings, contrats, packages. **Interface renommée** : onglet « Tenders » = **Package**, anciens « Packages » (`pp_packages`) = **Department** — clés et code inchangés (`tender`, `package`). Fiche en onglets : Submissions (chaque document édité à un seul endroit) / Contract & addendums / Flow & history (lecture seule) / Actions & notes. Référence d'un document demandée à chaque soumission (`recordDocSubmission`, modale `ppPrompt`) |
| `app-schedule.js` | Grille de planning par zone, chemin critique, documents, impression, vue mobile |
| `app-zone.js` | Espace zone : actions, rooms, KPIs |
| `app-reports.js` | Rapports imprimables, MOM, timeline, dashboard, trackers |
| `app-steel.js` | Suivi acier (barres + treillis) : dockets, bilans site / transformateur / JV (stocké en kg, affiché en tonnes) |
| `app-inventory.js` | Inventaire (items critiques) : catalogue, PO, dockets de livraison, sorties de stock (zone / localisation / usage), comptages mensuels → consommation réelle, moyenne mensuelle, où c'est consommé |
| `app-concrete.js` | Béton : types, WBS avec quantités théoriques par type, coulages réels (par type et par fournisseur), courbe cumulée prévu / coulé, perte ou gain de béton UNIQUEMENT au cut-off sur % d’avancement saisi à la main (aucun avancement automatique), split d'un WBS (ex. « travaux à date ») en WBS détaillés, cut-off cost control (% d'avancement par WBS → budget débloqué vs réel, remain to be spent théorique / réel ajustable, EAC), liens WBS ↔ activités des plannings de zone (dates prévues ; % du planning affiché pour référence seulement) |
| `app-manpower.js` | Manpower : une entrée par semaine (`pp_manpower`) — heures approuvées, planifiées et réelles, les réelles par entreprise des ouvriers (saisies ou collées depuis l'app de pointage) ; vue d'ensemble, courbe hebdo / cumulée, tableau des semaines, entreprises, export CSV |
| `app-mount.js` | Montage React |

## Téléphone (≤ 768 px)

- `usePhone()` / `isPhone()` (`app-core.js`) ; `window._ppPhone`. Le rail de gauche et la barre de droite sont masqués,
  remplacés par `PhoneNav` : barre du bas (4 onglets épinglés, ★ dans le menu, stockés en localStorage `pp_phone_pins`) + menu de tous les onglets groupés.
- CSS dans `index.html` (`@media(max-width:768px)`) : classes utilitaires `phone-hide`, `phone-scroll`, `md-wrap`/`md-side`
  (liste + fiche → une seule à la fois), `tbl-cards` (une carte par ligne, libellé de chaque cellule via `data-l`).
  Les tableaux `.tbl` défilent horizontalement, 1re colonne figée. Champs à 16 px (pas de zoom iOS).
- Planning de zone : vue téléphone « semaines à venir » (2/4/8), section « Behind schedule », % d'avancement par semaine.
  La grille complète reste sur ordinateur.

## Données — Firebase Firestore

- Projet Firebase `rt-mom`, collection `mom_data`. Chaque clé `pp_*` (voir `KEYS` et `KEYS_*` dans
  `app-core.js`) est **un seul document** contenant du JSON sérialisé dans le champ `value`.
- Accès via `window._db.get/set`, `window._dbUpdate` (transaction lecture-modification-écriture),
  `window._dbListen` (temps réel), enveloppés par `cloudStore` dans `app-core.js`.
- **Limite Firestore : 1 MiB par document.** L'app avertit à 700 KB (`_noteDocSize`).
  `console.table(_ppDocSizes)` dans la console montre la taille de chaque clé.
  Ne jamais faire grossir un document sans y penser ; les fichiers joints restent sur SharePoint (on ne stocke que le lien).
- Plusieurs personnes éditent en même temps : `pp_tasks` est fusionné champ par champ (diff base → next
  rejoué sur la copie serveur). Ne pas remplacer ce mécanisme par une écriture brute du tableau entier.
- Changer la forme des données stockées = rester compatible avec les données existantes
  (ex. `zoneOwners[zone]` peut être une chaîne (ancien format) ou un tableau).
- La config Firebase dans `index.html` n'est pas un secret ; la sécurité dépend des règles Firestore.

## Permissions

- `isAppAdmin(name)` : comparaison tolérante des noms (`_normName` : accents, virgules, ordre des mots).
- `isReadOnly()` / `blockIfReadOnly()` / `mayDelete()` : vérifications centralisées. Toute nouvelle action
  qui modifie des données doit passer par ces helpers.
- `canEditZoneSchedule` : admin ou chef de zone.

## Conventions de code

- Style existant : ES5/ES2015 mélangés, `function(){}` plutôt que flèches dans la plupart du code,
  JSX compilé par Babel dans le navigateur. Imiter le code voisin.
- Couleurs / typo : utiliser les variables CSS de `:root` dans `index.html` (`--gold` est une couleur
  de fond ; pour du texte doré utiliser `--gold-ink`).
- Rapports imprimables : HTML autonome ouvert dans un nouvel onglet, imprimé via le navigateur.
- Les fichiers sont gros (jusqu'à ~430 KB) : chercher avec grep plutôt que tout lire.

## Tester

Pas de tests automatisés. Pour vérifier une modification :
- Syntaxe : concaténer les fichiers dans l'ordre de `APP_PARTS` et les passer à Babel
  (preset `react`), comme le fait `index.html`.
- Lancer localement : `python3 -m http.server` à la racine puis ouvrir `index.html`
  (les données viennent du Firestore de production — attention aux écritures).

## Git

- `main` = version en production. Travailler sur une branche, puis pull request vers `main`.
