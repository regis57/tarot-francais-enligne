# Tarot Français en ligne

Jeu de **Tarot français multijoueur** jouable dans un navigateur, à **4 ou 5 joueurs**, avec des robots pour compléter les tables. Serveur Node.js + Socket.IO, interface web sans aucune dépendance front-end, déploiement en une commande avec Docker.

Pensé pour tourner en auto-hébergement sur un NAS Synology, un Raspberry Pi ou n'importe quelle machine avec Docker.

---

## Fonctionnalités

- **Deux formats** : Tarot à 4 joueurs (18 cartes, chien de 6) et à 5 joueurs avec appel au Roi (15 cartes, chien de 3)
- **Mode solo** contre des robots, et **mode en ligne** avec salle d'attente (60 s, complétée par des robots)
- **Longueur de partie au choix** : 5, 10, 15 ou 20 donnes
- **Règles officielles appliquées côté serveur** (impossible de tricher depuis le navigateur) :
  - Enchères : Petite (×1), Garde (×2), Garde Sans le chien (×4), Garde Contre le chien (×6)
  - Chien dévoilé et écart contrôlé (Rois et bouts interdits, atouts seulement en dernier recours)
  - Obligation de fournir à la couleur, de couper et de surcouper
  - Excuse (ne remporte jamais le pli, reste à son camp sauf au dernier pli)
  - Objectifs selon les bouts : 56 / 51 / 41 / 36 points
  - **Petit au bout** : 10 points multipliés par le contrat
  - **Poignées** : 10 / 13 / 15 atouts à 4 joueurs, 8 / 10 / 13 à 5 joueurs (+20 / +30 / +40)
  - Appel au Roi et partenaire révélé quand la carte appelée tombe
- **Robots avec une vraie stratégie** : suivi des cartes jouées, détection des cartes maîtresses, protection des figures, Excuse jouée au bon moment, annonce automatique des poignées
- **Tableau des scores détaillé** accessible à tout moment : donne par donne, preneur, contrat, résultat, bonus et cumuls
- Interface responsive (ordinateur, tablette, téléphone) ; un joueur qui se déconnecte est remplacé par un robot

## Pile technique

| Composant | Rôle |
|---|---|
| Node.js 20 | Exécution du serveur |
| Express | Service des fichiers statiques |
| Socket.IO | Communication temps réel |
| HTML/CSS/JS natif | Interface, sans framework ni build |
| Docker Compose | Déploiement |

Toute la logique de jeu est dans `server.js` ; le navigateur n'est qu'un afficheur.

---

## Installation rapide (Docker)

```bash
git clone https://github.com/regis57/tarot-francais-enligne.git tarot
cd tarot
cp .env.example .env     # adaptez TAROT_DIR au chemin absolu du dossier
docker compose up -d
```

Le jeu est accessible sur `http://ADRESSE-DE-LA-MACHINE:3001`.

> `TAROT_DIR` doit contenir le **chemin absolu** du dossier du projet sur la machine hôte (par exemple `/volume1/docker/tarot` sur un Synology). Un chemin relatif échoue dans certains environnements, dont Container Manager de Synology.

## Sans Docker

```bash
npm install
npm start      # écoute sur le port 3000, ou sur $PORT
```

## Installation sur NAS Synology

Le guide pas à pas, pensé pour les débutants (File Station, Container Manager, pare-feu, redirection de port, DDNS, proxy inversé HTTPS) se trouve dans **[INSTALLATION.md](INSTALLATION.md)**.

## Configuration

Tout se règle dans `.env` (copié depuis `.env.example`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `TAROT_DIR` | `/volume1/docker/tarot` | Chemin absolu du projet sur l'hôte |
| `TAROT_PORT` | `3001` | Port exposé sur le réseau |
| `PORT` | `3000` | Port d'écoute interne du serveur Node |

## Mise derrière un proxy inversé

Le jeu utilise les WebSockets : le proxy doit transmettre les en-têtes `Upgrade` et `Connection`. Sur Synology DSM, cela se fait dans Portail de connexion → Proxy inversé → onglet **En-tête personnalisé** → Créer → **WebSocket**. Sans cela, la partie semble figée.

## Structure du projet

```
.
├── docker-compose.yml   # déploiement
├── .env.example         # configuration à copier en .env
├── package.json
├── server.js            # moteur de jeu complet (règles, robots, scores)
├── INSTALLATION.md      # guide détaillé NAS Synology
└── public/
    └── index.html       # interface (HTML + CSS + JS en un fichier)
```

## Vie privée et sécurité

Aucune donnée personnelle n'est collectée ni stockée : seul le prénom saisi au lancement circule, en mémoire, le temps de la partie. Pas de base de données, pas de cookie, pas de compte, aucun appel vers un service externe. Le dépôt ne contient aucune clé d'API, aucun identifiant ni mot de passe — les adresses figurant dans la documentation sont des exemples génériques à remplacer par les vôtres.

## Licence

**GNU AGPL-3.0-or-later** — voir [LICENSE](LICENSE).

Vous pouvez utiliser, modifier et redistribuer ce jeu librement. En contrepartie, toute version modifiée **mise à disposition sur un réseau** (un site web, un serveur de jeu accessible à d'autres) doit elle aussi rendre son code source disponible sous la même licence. Les améliorations profitent donc à tout le monde.

Pour un usage commercial sous des conditions différentes, une licence séparée peut être négociée avec l'auteur.
