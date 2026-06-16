# Chromium URL Feature Scraper

Ce projet Node.js explore du code Chromium à partir d'une URL `source.chromium.org`, puis génère automatiquement :

- une documentation lisible
- un rapport JSON
- des comparaisons entre versions
- une vue des versions majeures proches
- des suggestions intelligentes pour continuer l'exploration

Il inclut aussi une interface web locale pour tout faire sans passer par la ligne de commande.

## Comment ça marche

Tu donnes une URL Chromium, par exemple :

`https://source.chromium.org/chromium/chromium/src/+/refs/tags/148.0.7778.261:sandbox/policy/switches.cc`

L'outil :

1. extrait le dépôt, la révision et le chemin du fichier depuis l'URL
2. reconstruit les URLs Gitiles correspondantes sur `chromium.googlesource.com`
3. récupère le code brut du fichier
4. récupère la liste des fichiers du même dossier
5. extrait des signaux simples du code :
   - `#include`
   - classes
   - fonctions
   - constantes
   - commentaires
   - gardes de compilation plateforme
   - namespaces
6. produit une documentation qui mélange :
   - structure du fichier
   - indices sémantiques vus dans le code
   - contexte local du module
7. peut aussi comparer deux versions ou plusieurs versions voisines

## Interface web locale

Lancer l'application :

```bash
npm run web
```

Puis ouvrir :

```text
http://localhost:3211
```

Depuis l'interface, tu peux :

- rechercher un sujet comme `sandbox`, `webrtc` ou `autofill`
- scraper une URL Chromium
- comparer deux versions d'un même fichier
- comparer automatiquement une URL taggée avec des versions majeures proches
- suivre les suggestions intelligentes proposées après une analyse

## Ligne de commande

Afficher l'aide :

```bash
npm run scrape
```

Scraper une URL :

```bash
node src/index.js --url "https://source.chromium.org/.../file.cc" --output output/url
```

Comparer deux versions :

```bash
node src/index.js --url "https://source.chromium.org/.../old.cc" --compare-url "https://source.chromium.org/.../new.cc" --output output/compare
```

Démo locale avec fixtures :

```bash
npm run scrape:fixture
```

## Ce que la documentation générée contient

Pour un fichier seul :

- une vue d'ensemble
- le rôle probable du fichier
- ce que le scraping met en évidence
- ce que le code montre réellement
- les fichiers du même dossier à lire ensuite
- une conclusion exploitable

Pour une comparaison :

- un résumé global du diff
- une interprétation technique
- ce que les changements montrent réellement
- un échantillon de changements
- une conclusion exploitable

Pour les versions proches :

- un résumé de stabilité
- les versions comparées
- une lecture de l'évolution du fichier

## Fichiers générés

Mode URL :

- `output/.../chromium-url-report.json`
- `output/.../chromium-url-documentation.md`

Mode comparaison :

- `output/.../chromium-url-comparison.json`
- `output/.../chromium-url-comparison.md`

Mode versions proches :

- `output/.../chromium-nearby-versions.json`
- `output/.../chromium-nearby-versions.md`

Mode local :

- `output/.../permissions-policy-report.json`
- `output/.../permissions-policy-documentation.md`

## Structure du projet

- `src/index.js` : logique d'analyse, comparaison et génération de documentation
- `src/server.js` : serveur HTTP local et API
- `web/` : interface HTML, CSS et JavaScript
- `fixtures/chromium-sample` : mini exemple local
- `output/` : rapports générés
