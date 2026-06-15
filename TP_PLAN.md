# Plan d'action du TP

## Sujet

Créer un script Node.js qui prend une URL `source.chromium.org`, récupère automatiquement les informations du fichier Chromium ciblé, puis génère une documentation technique.

## Nouvelle approche retenue

Entrée :

- une URL vers un fichier Chromium

Exemple :

- `https://source.chromium.org/chromium/chromium/src/+/refs/tags/148.0.7778.261:sandbox/policy/switches.cc`

Sortie :

- un rapport JSON
- une documentation Markdown
- éventuellement un rapport de comparaison entre deux versions
- une interface web locale pour piloter l'analyse

## Objectifs pédagogiques

- montrer un scraping appliqué à une vraie base de code
- analyser un fichier précis sans cloner tout le dépôt
- visualiser les fichiers voisins d'un module
- identifier les symboles importants du code
- comparer l'évolution d'un fichier entre deux versions

## Étapes du projet

1. Recevoir une URL `source.chromium.org`.
2. Parser l'URL pour extraire :
   - le projet
   - la révision
   - le chemin du fichier
3. Convertir cette URL en URL exploitable sur `chromium.googlesource.com`.
4. Télécharger le contenu brut du fichier.
5. Télécharger la page du dossier pour lister les fichiers voisins.
6. Extraire automatiquement :
   - `#include`
   - constantes
   - fonctions
   - classes
   - enums
   - commentaires
7. Générer une documentation Markdown.
8. Ajouter un mode comparaison entre deux versions du même fichier.
9. Ajouter une interface web locale pour lancer l'analyse plus facilement.

## Livrables

- script principal : `src/index.js`
- serveur local : `src/server.js`
- interface web : `web/`
- documentation d'usage : `README.md`
- sorties JSON
- sorties Markdown
- exemples générés dans `output/`

## Démonstration possible pendant l'oral

1. lancer le script sur une URL Chromium
2. montrer le JSON généré
3. montrer la doc Markdown générée
4. relancer en mode comparaison
5. commenter les différences trouvées entre deux versions

## Intérêt technique

Cette solution est plus légère qu'un clone complet de Chromium et plus convaincante pour un TP, car elle combine :

- parsing d'URL
- récupération web
- extraction de code
- génération de documentation
- comparaison de versions
