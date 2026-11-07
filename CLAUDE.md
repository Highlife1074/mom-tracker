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

  `app-core.js` → `app-tenders.js` → `app-schedule.js` → `app-zone.js` → `app-reports.js` → `app-steel.js` → `app-inventory.js` → `app-concrete.js` → `app-manpower.js` → `app-procplan.js` → `app-mount.js`

- Tous les fichiers partagent **une seule portée globale** : une fonction définie dans `app-core.js`
  est utilisable partout, sans `import`/`export`. Attention aux collisions de noms entre fichiers.
- `app-mount.js` doit rester **le dernier** (il rend `App`).
- Pour ajouter un nouveau fichier : l'ajouter à `APP_PARTS` dans `index.html`, avant `app-mount.js`.
- En cas d'erreur de syntaxe, `index.html` affiche « BABEL ERROR » avec le nom du fichier fautif.
- **Cache de compilation** : le code compilé par Babel est gardé en IndexedDB (`pp_babel_cache`) sous une empreinte
  du source (`srcHash`) ; les ouvertures suivantes sautent Babel (~3 s) jusqu'à ce qu'un fichier change. Fichiers
  récupérés en `cache:"no-cache"` (revalidation serveur, toujours la dernière version). Cache illisible ou en échec →
  vidé, rechargement, compilation normale.

| Fichier | Contenu |
|---|---|
| `app-core.js` | Constantes, clés de stockage, helpers dates/permissions, composants partagés, `App` |
| `app-tenders.js` | Tender sheet, chaîne de soumission, matériaux, shop drawings, contrats, packages. **Interface renommée** : onglet « Tenders » = **Package**, anciens « Packages » (`pp_packages`) = **Department** — clés et code inchangés (`tender`, `package`). Fiche en onglets : Submissions (chaque document édité à un seul endroit) / Contract & addendums / Flow & history (lecture seule) / Actions & notes. Référence d'un document demandée à chaque soumission (`recordDocSubmission`, modale `ppPrompt`). Colonne « Stage » de la liste (après Submissions, `tenderStage` / `TenderStageCell`) : étape en cours, qui l'a (nous / interne / client / sous-traitant), depuis combien de jours, et étape suivante, calculées depuis les données saisies ; la colonne « Next Step » (Follow-up) reste le texte libre. Impression de la liste : fenêtre `TenderPrintModal` (sections Finance / Dates / Submission steps / Follow-up / timelines / cartes / légendes, A4 ou A3), `tenderPrint` masque les colonnes et zoome le tableau à la largeur de la page ; choix en localStorage `pp_tender_print`. Étape **Kick off meeting** (`kickoff` dans `TENDER_STEPS`, `kickoffState`) : section dédiée dans Submissions (date prévue → action « Hold the kick off meeting », date tenue → action close), colonne de la liste et pastille « Kick off » de la colonne Submissions ; WMS / ITP / Kick off en N/A = vert dans la liste. **Purchases** (`td.purchases`, `PurchasesPanel` dans Submissions, sous Materials) : achats directs de matériaux spécifiques, en plus ou à la place de la sous-traitance, plusieurs par Package ; chaque achat = fournisseurs consultés (`quotes`, un retenu `chosen`), matériaux liés (`materialIds`, le MAR reste sur le matériau), PO, livraison ; **ACC ou Aconex, jamais les deux** (`purchaseRoute`, même règle que la sous-traitance) : sous `purchaseAccMin` (25 000 €) interne seulement, puis ACC, à partir de `purchaseAconexMin` (200 000 €) Aconex ; forçable (`p.route`, l'ancien `need:{…:"yes"}` est lu comme voie forcée) ; ce sont des documents de `tenderDocs` (kinds `pacc` / `paconex`, groupe « Purchases ») : révisions, retards (horloge ACC en jours ouvrés), actions auto, Flow & history. **Voie d'approbation client de la sous-traitance** (`tenderApprovalRoute` / `tenderRouteLabel` / `ApprovalRouteCell`) : selon le montant (ACC proposé, sinon offre attribuée, sinon moins-disant, sinon budget) — sous `subAccMin` (25 000 €) approbation interne seulement (pas de document client, la phase contrat démarre dès qu'un soumissionnaire est attribué), de 25 000 à `subAconexMin` (200 000 €) ACC, au-delà Aconex ; forçable par Package (`td.approvalRoute`) ; reste UN seul document (`stepDates.acc` / `cycles.acc`), seul son nom change |
| `app-schedule.js` | Grille de planning par zone, chemin critique, documents, impression, vue mobile. **Liens par instruction** (bouton « ✎ Links from text », `SchedInstructionModal`) : phrase libre FR/EN (« X lié à Y », après, suit, dépend de, avant, puis, →, « + 2 semaines ») découpée en clauses « X starts after Y » (`siParseInstruction`), rapprochées des lignes par correspondance floue + petit dictionnaire FR→EN (`siMatch`, aucun service d'IA) ; une salle / section = bloc (en successeur : sa 1re tâche reçoit le lien et toute la salle se décale ; en prédécesseur : sa tâche qui finit en dernier) ; proposition à valider (lignes corrigeables, séquence résultante, tâches déplacées), puis UNE écriture (`siApplyLinks`, Ctrl+Z) ; dernier texte en localStorage `pp_sched_instr`. **Health check** (bouton « Health check · NN % » dans Analyse & view, `SCHED_HEALTH_CHECKS` / `schedHealth`, calculé une fois par rendu dans `_rm.health`, seulement quand la barre Analyse ou le panneau est ouvert) : contrôles qualité du planning dans l'esprit des 14 points DCMA — à corriger (sans barre, barres hors grille, lien en conflit, en retard, achat en retard), à venir (hors séquence, réel dans le futur, Package non attribué / sans entreprise à moins de 8 semaines du début), structure (isolée, écart > 4 sem., > 8 semaines ouvrées) ; score = % de tâches sans point rouge ou orange ; clic sur une tâche → `goToRow` (ouvre pièce / section / filtre, panneau latéral, surlignage, défilement). Aucune donnée modifiée. Suppression d'une tâche (une ou plusieurs) : ses successeurs suivent son propre prédécesseur (`rechainAfterDelete`, A → B → C moins B = A → C). « Duplicate with its tasks » crée une Room propre à la copie (pièces ⇄ catégories restent 1:1). Un compte en lecture seule ne crée/ferme jamais les actions automatiques « Procurement late » |
| `app-zone.js` | Espace zone : actions, rooms, KPIs |
| `app-reports.js` | Rapports imprimables, MOM, timeline, dashboard, trackers |
| `app-steel.js` | Suivi acier (barres + treillis) : dockets, bilans site / transformateur / JV (stocké en kg, affiché en tonnes) |
| `app-inventory.js` | Inventaire (items critiques) : catalogue, PO, dockets de livraison, sorties de stock (zone / localisation / usage), comptages mensuels → consommation réelle, moyenne mensuelle, où c'est consommé |
| `app-concrete.js` | Béton : types, WBS avec quantités théoriques par type, coulages réels (par type et par fournisseur), courbe cumulée prévu / coulé (bouton « Planned = real (past) » : prévu du passé = coulé, reste théorique − coulé de chaque WBS réparti de demain à sa fin ; choix en localStorage `pp_con_pastreal`), perte ou gain de béton UNIQUEMENT au cut-off sur % d’avancement saisi à la main (aucun avancement automatique), split d'un WBS (ex. « travaux à date ») en WBS détaillés, cut-off cost control (% d'avancement par WBS → budget débloqué vs réel, remain to be spent théorique / réel ajustable, EAC), liens WBS ↔ activités des plannings de zone (dates prévues ; % du planning affiché pour référence seulement) ; **import Excel** du registre des bons de livraison (`ConImportModal` : feuille au choix, ex. SUPERSTRUCTURE, **uniquement les lignes Zone (col. B) = EXTERNAL** — TOWER / PODIUM / DWALL jamais importés, constante `CON_IMP_ZONE` ; chaque « Description » du classeur est rattachée à un WBS existant ou à un nouveau WBS créé dans la fenêtre — même nom = même WBS —, types de béton rapprochés ou créés ; **la colonne Theo Qty du classeur n'est JAMAIS importée** — le théorique se saisit uniquement dans l'app (vue Overview « Theoretical per WBS » ou WBS & variances, en ligne) ; coulages groupés par jour × WBS, bons déjà importés ignorés via `importNotes` ; correspondances mémorisées en localStorage `pp_con_wbsmap`) |
| `app-manpower.js` | Manpower : trois séries **Budget** (plusieurs **lignes budgétaires** WBS budget + € + **Awarded €** (sous-traitance attribuée, déduite) + awarded to + note, **net** = € − awarded, somme des nets ÷ taux horaire commun, réparti uniformément sur les jours ouvrés Lun–Sam entre début et fin ; `pp_manpower_meta`, enregistrement `kind:"budget"` {lines:[{wbs, amount, awarded, awardedTo, note}], amount = Σ (ancien format = une seule ligne sans WBS), rate, start, end, byWeek} ; filtre WBS = lignes budgétaires de ce WBS ; modifiable par l'admin seul, bouton admin « Budget = real on the past » qui fige `byWeek` = réel jusqu'au cut-off) / **Planned** (= ancien « budget » du plan ; bouton admin « Planned = real on the past » (`mpAlignPlan`) : effectif de chaque ligne de plan = réel du WBS ÷ h/worker sur les semaines ≤ cut-off, lignes créées pour les WBS sans ligne, annulable via l'enregistrement `kind:"planAlign"` de `pp_manpower_meta`) / **Real** ; notes de l'Overview (`kind:"note"` dans `pp_manpower_meta`) ; rapport imprimable (`mpOpenReport`, via `openReport`) ; **plan** (`pp_manpower_plan`, lignes corps d'état × workers × semaines × h/worker/semaine, histogramme ajustable semaine par semaine via `byWeek`) → heures **planned** par semaine / mois / total ; **réel** (`pp_manpower`, une entrée par semaine, heures par entreprise **et par activité** — l'activité = nom d'une ligne de plan, saisies ou collées « entreprise ⇥ activité ⇥ heures ») ; écarts par semaine, mois (semaine répartie sur Lun–Sam), entreprise, activité ; cut-off = dernière semaine saisie, reste à faire, prévision à terminaison ; export CSV ; **import Excel/CSV** (`MpImportModal` : une ligne par semaine + colonnes entreprises ou activités, ou Semaine·Entreprise·Activité·Heures, ou **matrice** export pointage, à renvoyer chaque semaine : nouvelles semaines ajoutées, semaines inchangées ignorées, semaines modifiées → choix ancien / nouveau par semaine (une ligne par activité sous « Zoning / Activity », une colonne par semaine `2026-13`, lignes/colonnes « Total » ignorées) ; semaines en numéro avec choix de l'année ou en date ; correspondance des activités du fichier → activité existante / création d'une ligne de plan à 0 worker / sans activité / ignorer, mémorisée en localStorage `pp_mp_actmap` ; le nom d'activité du fichier est conservé sur chaque ligne réelle dans `src`, à côté du WBS de l'app `activity`) ; filtres WBS (app) / activité du fichier sur toutes les vues (`mpFilter`), onglet Activities groupable par WBS ou par activité du fichier. `approved` (ancien champ) sert de budget manuel si aucune ligne de plan ne couvre la semaine |
| `app-procplan.js` | **Procurement plan** (vue `procplan`, « Proc. plan ») : tous les Packages du projet listés dès le départ ; type `td.procType` (subcontract / supply_install / equipment / material, absent = subcontract), date de besoin = `td.startOnSite` (Target start) : **issue du planning** dès qu'une tâche de planning est liée au Package (`tenderScheduleStart`, la plus tôt de toutes les zones ; lecture seule dans la fiche, dans Proc. plan et ignorée au collage Excel ; la date 🗓 (`SchedStartDate` / `openScheduleStart`, aussi dans la liste des Packages et WMS/ITP) ouvre la tâche dans le planning : zone, ligne surlignée, panneau ouvert, grille défilée jusqu'à la tâche), saisie à la main seulement sans tâche liée, délais par étape (`PP_STEPS` : tender docs, bidding, evaluation, approval, contract, submittals, fab, transport, buffer) depuis les modèles par type (`pp_durations.procTemplates`, éditeur `ProcPlanTemplatesEditor` dans Settings › Durations, défauts `PP_DEFAULT_TEMPLATES`) ou surchargés par Package (`td.planLeads`, carte `ProcPlanCard` en haut de Submissions) ; fab = plus long délai des matériaux si non surchargé, approbation = 7 j si voie interne ; `ppPlan` calcule à rebours la date LIMITE de chaque jalon, les compare au réel (`ppActuals`) → prochain jalon, jours restants, statut late / soon / ok ; **le passé est le passé** : besoin sur site déjà passé = « Started », jamais en retard — **sauf** s'il reste des tâches de planning liées pas encore démarrées (aucune semaine réelle, début ≥ aujourd'hui) : la plus tôt devient la date de besoin (`tenderNeedDate` / `tenderScheduleNextStart`, `p.needNext`, mention « next task » dans la liste) ; même règle pour le filtre « Late delivery » de la liste (`tenderWillStartLate`) ; impression « 🖨 Print » (`ppOpenReport`, via `openReport`, A4 paysage) des lignes affichées avec les filtres en cours ; collage Excel `ProcPlanPasteModal` (Package ⇥ Department ⇥ Type ⇥ Budget ⇥ Need on site, même nom = mise à jour). Tuiles KPI cliquables (`PP_KPIS` / `ppKpiOf` : Late, Due ≤ 14 d, On track, Not launched, Started, No need date, avec budget) comptées après les filtres type / département / recherche ; tri par colonne (`ppSortRows`, vides toujours en dernier) ; regroupement par département (`ppGroups`, localStorage `pp_procplan_group`) ; vue **Table / Timeline** (localStorage `pp_procplan_view`) : Gantt de la chaîne d'achat (`ProcPlanGantt`, modèle commun `ppGanttModel` en %, CSS `PP_GANTT_CSS`) — une barre par étape entre ses deux dates au plus tard, ◆ jalons atteints, drapeau besoin sur site, ▲ livraison prévue, ligne Today ; l'impression suit la vue (tableau ou timeline, `ppGanttHtml`) ; export Excel des lignes affichées (`ppExportXlsx`, dates en numéros de jour Excel). Quatre colonnes d'actions ouvertes liées au Package (`tenderRef`), une par catégorie (`PpActionsCell` / `PP_ACT_KINDS`, index `ppActionsIndex` une fois par rendu) : **Next steps** (manuelles sans tag ci-dessous + texte « Next Step » du Package), **Blocking points** (manuelles, tag « Blocking Point »), **Management info** (manuelles, tag « Top Management » : information de la hiérarchie), **Automatic** (créées par l'app, `addedBy:"System"` / `autoKey` — « Procurement late », flux documents, préparation SD/MAR —, lecture seule) ; manuelle = `ppIsManualAction` ; Blocking + Top Management = Blocking ; case à cocher = action close, « + add » crée l'action avec le tag de la catégorie (même objet partagé que partout) ; aussi dans l'impression et l'Excel. **Démarrage ≤ 21 jours** (`ppStartsSoon`, `PP_SOON_DAYS`, besoin entre aujourd'hui et +21 j, non livré) : ligne surlignée orange (tableau, timeline, impression), « starts on site in N d », tuile KPI « Starts ≤ 21 d » filtrante. **Purchases** : pour un Package material / equipment, les dates de PO de tous les achats valent jalon Contract / PO, et toutes les livraisons (`deliveryDone`) valent Delivered (`ppActuals`, `p.deliveredOn`) |
| `app-mount.js` | Montage React |

## Téléphone (≤ 768 px)

- `usePhone()` / `isPhone()` (`app-core.js`) ; `window._ppPhone`. Le rail de gauche et la barre de droite sont masqués,
  remplacés par `PhoneNav` : barre du bas (4 onglets épinglés, ★ dans le menu, stockés en localStorage `pp_phone_pins`) + menu de tous les onglets groupés.
- CSS dans `index.html` (`@media(max-width:768px)`) : classes utilitaires `phone-hide`, `phone-scroll`, `md-wrap`/`md-side`
  (liste + fiche → une seule à la fois), `tbl-cards` (une carte par ligne, libellé de chaque cellule via `data-l`).
  Les tableaux `.tbl` défilent horizontalement, 1re colonne figée. Champs à 16 px (pas de zoom iOS).
- Planning de zone : vue téléphone « semaines à venir » (2/4/8), section « Behind schedule », % d'avancement par semaine.
  La grille complète reste sur ordinateur.

## Performance

- Le planning de zone peut dépasser 200 lignes × 45 semaines (~9 500 cellules) : chaque re-rendu de `ScheduleView` coûte.
  Calculs par ligne (`procRisk`, `rowActions`, `prereqsOf`, `planColor`) mémorisés **pour un rendu** (`_rm`) ;
  style fixe des cellules de semaine en classe CSS `.sched-wk` (pas de style en ligne par cellule) ; flèches de liens
  mesurées seulement quand le planning / les lignes affichées changent ou que la table change de taille.
  Affichage en deux temps (`GRID_FIRST_ROWS` = 60) : à l'ouverture ou au changement de zone / planning, les 60
  premières lignes tout de suite, le reste juste après le premier affichage (`gridRows`) ; l'impression a sa propre
  table complète, le saut vers une tâche attend que sa ligne soit dessinée.
- `tenderDocs(td)` et `calcProcurement(td)` mémorisés par objet Package (WeakMap, vidés si `pp_durations` ou le jour change) :
  ne jamais modifier un Package en place, toujours un nouvel objet ; ne jamais modifier le résultat renvoyé. `isValidDate` mémorise les chaînes ; `findDuplicateActions` gardé
  tant que `tasks` ne change pas.
- **Une seule règle « achat en retard »** (`procDeliveryState(livraison, besoin)` dans `app-tenders.js`) pour le planning
  (`procRisk`), la liste des Packages / Proc. flow (`tenderWillStartLate`), Proc. plan (`deliveryLate`) et les rapports :
  en retard si la livraison prévue tombe après le dimanche de la semaine du besoin, tendu si moins de 21 jours.
  Proc. plan : livraison après la date limite de livraison mais avant le besoin = `deliveryTight` (marge consommée, orange).
- **`calcProcurement`** : les durées Settings › Durations en jours ouvrés (approbation ACC, signature contrat, SD)
  passent par `addWorkingDays` (lun–ven, jours fériés, `extraHolidays`), comme l'horloge ACC des documents ; délai de
  fabrication = saisi (`leadTimeDays`) > délais du Package dans Proc. plan (`planLeads` fab + transport) > plus long
  matériau > modèle du type (fab + transport) > 30 j (`leadSource` « plan »). Une seule source de délais avec Proc. plan.
- Mesurer avant d'optimiser : profil Chrome / « long tasks » sur une copie locale avec les données en lecture seule.

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
- Dates `AAAA-MM-JJ` : jamais `new Date(iso)` (lu en UTC → la veille à l'ouest de Greenwich) ; utiliser `parseISODate`,
  `addCalDays`, `toISO` (heure locale).
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
