# Tarot Français en ligne — Guide d'installation sur Synology DS218+

Le jeu s'installe en quelques minutes sur un NAS Synology (ou toute machine avec Docker). Il utilise par défaut le **port 3001**, ce qui lui permet de cohabiter avec d'autres services déjà présents sur la machine. Ce port se change dans le fichier `.env` (voir `.env.example`).

Le jeu propose : mode Solo contre les IA, mode En Ligne avec salle d'attente, Tarot à **4 joueurs** classique et à **5 joueurs avec appel au Roi**. Règles incluses : enchères (Petite, Garde, Garde Sans, Garde Contre), chien et écart, obligation de fournir / couper / surcouper, Excuse, Petit au bout, comptage officiel des points (56/51/41/36 selon les bouts).

---

## ÉTAPE 1 — Copier les fichiers sur le NAS

1. Ouvrez **DSM** dans votre navigateur (l'interface web de votre Synology).
2. Ouvrez **File Station**.
3. Allez dans le dossier partagé **docker** (Container Manager le crée automatiquement à son installation).
4. Dans `docker`, cliquez sur **Créer > Créer un dossier** et nommez-le exactement : `tarot`
5. Entrez dans `tarot` et déposez-y (glisser-déposer depuis votre PC) :
   - `docker-compose.yml`
   - `package.json`
   - `server.js`
6. Toujours dans `tarot`, créez un sous-dossier nommé `public` et déposez-y :
   - `index.html`

Vous devez obtenir cette arborescence :

```
docker/
└── tarot/
    ├── docker-compose.yml
    ├── package.json
    ├── server.js
    └── public/
        └── index.html
```

---

## ÉTAPE 2 — Lancer le jeu avec Container Manager

1. Ouvrez **Container Manager** (dans le menu principal DSM).
   *(Si votre DSM est ancien et affiche « Docker » à la place, la démarche est similaire.)*
2. Dans le menu de gauche, cliquez sur **Projet**.
3. Cliquez sur **Créer**.
4. Remplissez :
   - **Nom du projet** : `tarot`
   - **Chemin** : cliquez sur *Définir le chemin* et sélectionnez le dossier `/docker/tarot`
   - Container Manager détecte automatiquement le fichier `docker-compose.yml` existant → choisissez **« Utiliser le docker-compose.yml existant »**.
5. Cliquez sur **Suivant**, puis **Effectué**.
6. Le NAS télécharge Node.js et installe le jeu tout seul (1 à 3 minutes la première fois). Le projet doit passer au statut **« En cours d'exécution »** (vert).

---

## ÉTAPE 3 — Tester à la maison

Sur un ordinateur ou téléphone connecté à votre réseau (même box) :

1. Ouvrez un navigateur et tapez : `http://IP-DE-VOTRE-NAS:3001`
   (exemple : `http://192.168.0.10:3001`).
2. La page « Tarot Français » doit s'afficher. Entrez un prénom et testez le **mode Solo 4 joueurs** : c'est le plus simple pour vérifier que tout marche.

> Astuce : l'adresse IP de votre NAS est visible dans DSM > Panneau de configuration > Réseau > Interface réseau.

---

## ÉTAPE 4 — Pare-feu du NAS (seulement s'il est activé)

Si vous avez activé le pare-feu de DSM (par défaut il ne l'est pas) :

1. **Panneau de configuration > Sécurité > Pare-feu > Modifier les règles**.
2. **Créer** une règle : Ports personnalisés > **TCP 3001** > Autoriser.
3. Enregistrez. (Si d'autres services du NAS sont déjà accessibles de l'extérieur sans réglage de pare-feu, vous pouvez sauter cette étape.)

---

## ÉTAPE 5 — Rendre le jeu accessible depuis Internet (redirection de port)

Cette opération se passe sur votre **box Internet**, pas sur le NAS.

1. Connectez-vous à l'interface de votre box :
   - **Livebox (Orange)** : `http://192.168.0.1` → Réseau → NAT/PAT
   - **Freebox** : `http://mafreebox.freebox.fr` → Paramètres → Gestion des ports
   - **Box SFR** : `http://192.168.0.1` → Réseau v4 → NAT
2. Créez une règle de redirection :
   - **Port externe** : 3001
   - **Port interne** : 3001
   - **Protocole** : TCP
   - **Appareil / IP de destination** : votre NAS (choisissez-le dans la liste, ou tapez son IP, ex. celle relevee a l'etape 3)
3. Enregistrez.

> **Important** : assurez-vous que votre NAS a une **IP locale fixe** (réservation DHCP dans la box, ou IP statique dans DSM > Panneau de configuration > Réseau). Sinon la redirection peut « se perdre » après un redémarrage.

---

## ÉTAPE 6 — Côté DNS : une adresse facile à retenir

Votre box a une adresse IP publique qui peut changer. Deux solutions :

### Option A (la plus simple) : le DDNS gratuit de Synology
1. DSM > **Panneau de configuration > Accès externe > DDNS**.
2. Cliquez sur **Ajouter**, fournisseur **Synology**, et choisissez un nom, par exemple : `votre-nom.synology.me` (connexion avec votre compte Synology requise).
3. Validez. Le NAS met à jour l'adresse tout seul, même si votre IP publique change.
4. Vos amis jouent alors sur : **`http://votre-nom.synology.me:3001`**
   (un seul nom DDNS suffit pour tous les services du NAS : seul le numéro de port change.)

### Option B : votre propre nom de domaine
Si vous possédez un domaine (ex. chez OVH, Gandi...) :
1. Dans l'interface DNS de votre registrar, créez un enregistrement **CNAME** :
   - Nom : `tarot` (donnera `tarot.exemple.fr`)
   - Cible : votre adresse DDNS Synology (ex. `votre-nom.synology.me`)
2. Le CNAME est préférable à un enregistrement A car il suit automatiquement les changements de votre IP publique.
3. Vos amis jouent sur : `http://tarot.exemple.fr:3001`

---

## ÉTAPE 7 (facultatif mais recommandé) — HTTPS sans numéro de port

Pour une adresse propre du type `https://tarot.exemple.fr` (sans `:3001`) :

1. DSM > **Panneau de configuration > Portail de connexion > Avancé > Proxy inversé** > **Créer** :
   - Source : Protocole **HTTPS**, Nom d'hôte `tarot.exemple.fr`, Port **443**
   - Destination : Protocole **HTTP**, Nom d'hôte `localhost`, Port **3001**
2. **Très important pour ce jeu** (il utilise les WebSockets) : dans la même fenêtre, onglet **En-tête personnalisé** > **Créer > WebSocket**. DSM ajoute les deux lignes `Upgrade` et `Connection` automatiquement. Sans cela, le jeu semblera figé.
3. Redirigez le port **443** de votre box vers le NAS (comme à l'étape 5).
4. DSM > **Panneau de configuration > Sécurité > Certificat** : ajoutez un certificat **Let's Encrypt** gratuit pour `tarot.exemple.fr`, puis associez-le à votre règle de proxy inversé.

---

## En cas de problème

| Symptôme | Solution |
|---|---|
| La page ne s'affiche pas en local | Container Manager > Projet `tarot` : vérifiez qu'il est vert. Cliquez dessus > Journal pour lire les erreurs. Vous devez y voir « Serveur Tarot actif sur le port 3000 ». |
| « Port déjà utilisé » au lancement | Un autre service utilise le 3001. Éditez `docker-compose.yml` et remplacez `"3001:3000"` par `"3002:3000"` par exemple (et adaptez la redirection de box). |
| Ça marche en local mais pas depuis l'extérieur | Revérifiez la redirection de port (étape 5) et testez avec un téléphone **en 4G/5G** (pas en Wi-Fi maison). |
| Le jeu se fige pendant une partie en HTTPS | L'en-tête WebSocket du proxy inversé n'est pas configuré (étape 7, point 2). |
| Mise à jour du jeu | Remplacez les fichiers dans File Station, puis Container Manager > Projet `tarot` > **Arrêter** puis **Démarrer**. |

Bon jeu !
