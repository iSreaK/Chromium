# Chromium URL Feature Scraper

Ce projet fournit un script Node.js pour scraper du code Chromium à partir d'une URL `source.chromium.org`, puis générer automatiquement une documentation et un résumé des changements entre versions.

Il inclut maintenant une **interface web locale** pour éviter de tout saisir en ligne de commande.

## Idée du TP

Au lieu de cloner tout Chromium, on donne une URL comme :

`https://source.chromium.org/chromium/chromium/src/+/refs/tags/148.0.7778.261:sandbox/policy/switches.cc`

Le script :

- extrait les métadonnées du fichier
- récupère le contenu brut du fichier depuis `chromium.googlesource.com`
- récupère la liste des fichiers voisins dans le dossier
- extrait des symboles utiles du code
- génère un rapport JSON
- génère une documentation Markdown
- peut comparer deux versions d'un même fichier

## Pourquoi cette approche est bien pour un TP

- pas besoin de cloner l'intégralité du dépôt Chromium
- on peut viser un fichier très précis
- on peut montrer plusieurs versions d'un même fichier
- on peut produire une documentation automatique à partir d'URLs réelles

## Commandes

### Afficher l'aide

```bash
npm run scrape
```

### Lancer l'interface web locale

```bash
npm run web
```

Puis ouvrir :

```text
http://localhost:3211
```

### Démo locale avec fixtures

```bash
npm run scrape:fixture
```

### Scraper une URL Chromium

```bash
npm run scrape:url
```

### Comparer deux versions

```bash
npm run scrape:compare
```

### Utilisation personnalisée

```bash
node src/index.js --url "https://source.chromium.org/.../file.cc" --output output/url
node src/index.js --url "https://source.chromium.org/.../old.cc" --compare-url "https://source.chromium.org/.../new.cc" --output output/compare
```

## Interface web

L'interface locale permet :

- de coller une URL Chromium
- de lancer le scraping sans utiliser le terminal
- de comparer deux versions d'un même fichier
- de visualiser les métriques et un aperçu du code
- d'ouvrir les fichiers Markdown et JSON générés localement

## Sorties générées

### Mode URL

- `output/.../chromium-url-report.json`
- `output/.../chromium-url-documentation.md`

### Mode comparaison

- `output/.../chromium-url-comparison.json`
- `output/.../chromium-url-comparison.md`

### Mode local

- `output/.../permissions-policy-report.json`
- `output/.../permissions-policy-documentation.md`

## Exemple déjà validé

Le script a été testé sur :

- `sandbox/policy/switches.cc`
- tag `148.0.7778.261`
- comparaison avec `main`

Le scraper détecte correctement :

- le chemin du fichier
- le tag ou la révision
- les fichiers voisins du dossier
- les `#include`
- les constantes
- les commentaires utiles

## Structure du projet

- `src/index.js` : script principal
- `src/server.js` : serveur HTTP local
- `web/` : interface HTML, CSS et JavaScript
- `fixtures/chromium-sample` : mini exemple local
- `output/` : rapports générés
- `TP_PLAN.md` : plan d'action pour le rendu
