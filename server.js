/*
 * Tarot Francais en ligne - jeu de Tarot multijoueur (4 et 5 joueurs)
 * Copyright (C) 2026 Tarot Francais contributors
 *
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le
 * modifier selon les termes de la GNU Affero General Public License publiee
 * par la Free Software Foundation, soit la version 3, soit (a votre choix)
 * toute version ulterieure.
 *
 * Il est distribue dans l'espoir qu'il sera utile, mais SANS AUCUNE GARANTIE,
 * sans meme la garantie implicite de QUALITE MARCHANDE ou d'ADEQUATION A UN
 * USAGE PARTICULIER. Voir la GNU Affero General Public License pour plus de
 * details : <https://www.gnu.org/licenses/>.
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// Noms neutres pour les IA (Présidents de la 4ème et 5ème République)
const aiNamesList = [
    'Charles de Gaulle', 'Georges Pompidou', 'Valéry Giscard d\'Estaing',
    'François Mitterrand', 'Jacques Chirac', 'Nicolas Sarkozy',
    'François Hollande', 'Emmanuel Macron', 'Vincent Auriol', 'René Coty'
];

function getRandomAINames(count) {
    let shuffled = [...aiNamesList].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

// ==================== CARTES DU TAROT (78 cartes) ====================
const SUITS = ['♠', '♥', '♣', '♦'];
const SUIT_VALUES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'C', 'D', 'R'];

function cardPoints(v) {
    if (v === 'R') return 4.5;
    if (v === 'D') return 3.5;
    if (v === 'C') return 2.5;
    if (v === 'V') return 1.5;
    return 0.5;
}

function buildDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        SUIT_VALUES.forEach((v, i) => {
            deck.push({
                t: 'c', suit: suit, value: v, rank: i + 1, pts: cardPoints(v),
                color: (suit === '♥' || suit === '♦') ? 'red' : 'black'
            });
        });
    });
    for (let n = 1; n <= 21; n++) {
        deck.push({ t: 'a', suit: 'ATOUT', value: String(n), rank: n, pts: (n === 1 || n === 21) ? 4.5 : 0.5, color: 'atout' });
    }
    deck.push({ t: 'e', suit: 'EXCUSE', value: 'EXC', rank: 0, pts: 4.5, color: 'excuse' });
    return deck;
}

function isBout(c) { return c.t === 'e' || (c.t === 'a' && (c.rank === 1 || c.rank === 21)); }
function sameCard(a, b) { return a.t === b.t && a.suit === b.suit && a.value === b.value; }

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const SUIT_ORDER = { '♠': 0, '♥': 1, '♣': 2, '♦': 3 };
function sortHand(hand) {
    hand.sort((a, b) => {
        const ga = (a.t === 'c') ? 0 : (a.t === 'a') ? 1 : 2;
        const gb = (b.t === 'c') ? 0 : (b.t === 'a') ? 1 : 2;
        if (ga !== gb) return ga - gb;
        if (a.t === 'c') {
            if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
            return a.rank - b.rank;
        }
        return a.rank - b.rank;
    });
    return hand;
}

// ==================== ENCHÈRES ====================
const BID_NAMES = ['Passe', 'Petite', 'Garde', 'Garde Sans', 'Garde Contre'];
const BID_MULT = [0, 1, 2, 4, 6];

// ==================== MATCHMAKING (files séparées 4 et 5 joueurs) ====================
let queues = { 4: [], 5: [] };
let intervals = { 4: null, 5: null };
let countdowns = { 4: 60, 5: 60 };
let activeGames = {};

io.on('connection', (socket) => {

    socket.on('startSoloGame', (data) => {
        const playerCount = (data.mode === 5) ? 5 : 4;
        const roomId = 'solo_' + socket.id;
        socket.join(roomId);
        let players = [{ id: socket.id, name: data.name, isBot: false, score: 0 }];
        getRandomAINames(playerCount - 1).forEach((name, idx) => {
            players.push({ id: 'bot_' + idx + '_' + socket.id, name: name, isBot: true, score: 0 });
        });
        createGame(roomId, players, playerCount, data.rounds);
    });

    socket.on('joinMatchmaking', (data) => {
        const mode = (data.mode === 5) ? 5 : 4;
        socket.data.mmMode = mode;
        queues[mode].push({ id: socket.id, name: data.name, rounds: parseInt(data.rounds) });
        socket.join('lobby_' + mode);
        if (queues[mode].length === 1) {
            countdowns[mode] = 60;
            startCountdown(mode);
        }
        broadcastLobby(mode);
        if (queues[mode].length === mode) launchOnlineGame(mode);
    });

    socket.on('forceStartWithBots', () => {
        const mode = socket.data.mmMode;
        if (mode && queues[mode].some(p => p.id === socket.id)) launchOnlineGame(mode);
    });

    socket.on('placeBid', (data) => handleBid(data.roomId, socket.id, data.bid));
    socket.on('callKing', (data) => handleCallKing(data.roomId, socket.id, data.card));
    socket.on('submitEcart', (data) => handleEcart(data.roomId, socket.id, data.indices));
    socket.on('playCard', (data) => handlePlay(data.roomId, socket.id, data.cardIndex));
    socket.on('announcePoignee', (data) => handlePoignee(data.roomId, socket.id));

    socket.on('nextRound', (roomId) => {
        let game = activeGames[roomId];
        if (game && game.phase === 'between') startRound(roomId);
    });

    socket.on('restartMatch', (roomId) => {
        let game = activeGames[roomId];
        if (game && game.phase === 'matchEnd') {
            game.players.forEach(p => p.score = 0);
            game.roundNumber = 0;
            game.dealer = Math.floor(Math.random() * game.playerCount);
            startRound(roomId);
        }
    });

    socket.on('disconnect', () => {
        [4, 5].forEach(mode => {
            const before = queues[mode].length;
            queues[mode] = queues[mode].filter(p => p.id !== socket.id);
            if (queues[mode].length !== before) broadcastLobby(mode);
            if (queues[mode].length === 0 && intervals[mode]) {
                clearInterval(intervals[mode]);
                intervals[mode] = null;
            }
        });
        // Dans une partie en cours : le joueur devient un robot pour ne pas bloquer les autres
        for (const roomId in activeGames) {
            const game = activeGames[roomId];
            const p = game.players.find(pl => pl.id === socket.id);
            if (p && !p.isBot) {
                p.isBot = true;
                p.name = p.name + ' (IA)';
                if (roomId.startsWith('solo_')) { delete activeGames[roomId]; continue; }
                io.to(roomId).emit('infoMsg', p.name + ' a quitté, une IA le remplace.');
                broadcastGameState(roomId);
                scheduleBot(roomId);
            }
        }
    });
});

function broadcastLobby(mode) {
    io.to('lobby_' + mode).emit('matchmakingStatus', {
        players: queues[mode].map(p => p.name),
        countdown: countdowns[mode],
        needed: mode
    });
}

function startCountdown(mode) {
    if (intervals[mode]) clearInterval(intervals[mode]);
    intervals[mode] = setInterval(() => {
        countdowns[mode]--;
        broadcastLobby(mode);
        if (countdowns[mode] <= 0) {
            clearInterval(intervals[mode]);
            intervals[mode] = null;
            launchOnlineGame(mode);
        }
    }, 1000);
}

function launchOnlineGame(mode) {
    if (queues[mode].length === 0) return;
    if (intervals[mode]) { clearInterval(intervals[mode]); intervals[mode] = null; }
    const chosenRounds = queues[mode][0] ? queues[mode][0].rounds : 10;
    const roomId = 'online_' + mode + '_' + Date.now();
    let players = [];
    while (queues[mode].length > 0 && players.length < mode) {
        const p = queues[mode].shift();
        players.push({ id: p.id, name: p.name, isBot: false, score: 0 });
    }
    const botsNeeded = mode - players.length;
    if (botsNeeded > 0) {
        getRandomAINames(botsNeeded).forEach((name, idx) => {
            players.push({ id: 'bot_' + idx + '_' + roomId, name: name, isBot: true, score: 0 });
        });
    }
    players.forEach(p => {
        if (!p.isBot) {
            const s = io.sockets.sockets.get(p.id);
            if (s) { s.leave('lobby_' + mode); s.join(roomId); }
        }
    });
    createGame(roomId, players, mode, chosenRounds);
}

// ==================== CRÉATION / DISTRIBUTION ====================
function createGame(roomId, players, playerCount, rounds) {
    rounds = parseInt(rounds);
    if (![5, 10, 15, 20].includes(rounds)) rounds = 5;
    activeGames[roomId] = {
        id: roomId, players: players, playerCount: playerCount,
        dealer: Math.floor(Math.random() * playerCount),
        roundNumber: 0, totalRounds: rounds, history: [],
        phase: 'idle', trick: [], message: ''
    };
    io.to(roomId).emit('gameStarted', roomId);
    startRound(roomId);
}

function startRound(roomId) {
    const game = activeGames[roomId];
    if (!game) return;
    const N = game.playerCount;
    game.roundNumber++;
    game.donneId = (game.donneId || 0) + 1;
    game.dealer = (game.dealer + 1) % N;

    const chienSize = (N === 5) ? 3 : 6;
    const handSize = (N === 5) ? 15 : 18;
    let deck = shuffle(buildDeck());

    game.players.forEach(p => {
        p.cards = sortHand(deck.splice(0, handSize));
        p.wonCards = [];
        p.bid = -1;
    });
    game.chien = deck.splice(0, chienSize);
    game.chienSize = chienSize;
    game.ecartCards = [];
    game.bestBid = 0;
    game.preneur = -1;
    game.bidTurn = (game.dealer + 1) % N;
    game.bidsPlaced = 0;
    game.calledCard = null;
    game.partner = -1;
    game.trick = [];
    game.lastTrick = null;
    game.tricksPlayed = 0;
    game.totalTricks = handSize;
    game.excuseInfo = null; // { owner, trickIdx, keptByOwner }
    game.playedCards = [];
    game.poignees = [];
    game.phase = 'bidding';
    game.message = 'Enchères : à ' + game.players[game.bidTurn].name + ' de parler.';
    broadcastGameState(roomId);
    scheduleBot(roomId);
}

// ==================== ENCHÈRES ====================
function handleBid(roomId, playerId, bid) {
    const game = activeGames[roomId];
    if (!game || game.phase !== 'bidding') return;
    const idx = game.players.findIndex(p => p.id === playerId);
    if (idx !== game.bidTurn) return;
    bid = parseInt(bid);
    if (isNaN(bid) || bid < 0 || bid > 4) return;
    if (bid !== 0 && bid <= game.bestBid) return; // doit surenchérir

    applyBid(roomId, idx, bid);
}

function applyBid(roomId, idx, bid) {
    const game = activeGames[roomId];
    const N = game.playerCount;
    game.players[idx].bid = bid;
    game.bidsPlaced++;
    if (bid > game.bestBid) {
        game.bestBid = bid;
        game.preneur = idx;
    }

    if (game.bidsPlaced >= N) {
        // Fin des enchères
        if (game.bestBid === 0) {
            game.message = 'Tout le monde passe : on redistribue !';
            io.to(roomId).emit('infoMsg', 'Tout le monde a passé, nouvelle donne.');
            game.roundNumber--; // cette donne ne compte pas
            setTimeout(() => startRound(roomId), 2000);
            broadcastGameState(roomId);
            return;
        }
        const pName = game.players[game.preneur].name;
        if (N === 5) {
            game.phase = 'callKing';
            game.message = pName + ' a pris (' + BID_NAMES[game.bestBid] + ') et doit appeler un Roi.';
        } else {
            proceedToChien(roomId);
            return;
        }
    } else {
        game.bidTurn = (game.bidTurn + 1) % N;
        game.message = 'Enchères : à ' + game.players[game.bidTurn].name + ' de parler.';
    }
    broadcastGameState(roomId);
    scheduleBot(roomId);
}

// ==================== APPEL AU ROI (5 joueurs) ====================
function handleCallKing(roomId, playerId, cardData) {
    const game = activeGames[roomId];
    if (!game || game.phase !== 'callKing') return;
    const idx = game.players.findIndex(p => p.id === playerId);
    if (idx !== game.preneur) return;
    if (!cardData || !cardData.suit || !cardData.value) return;
    if (!SUITS.includes(cardData.suit)) return;

    const hand = game.players[idx].cards;
    const kingsHeld = hand.filter(c => c.t === 'c' && c.value === 'R').length;
    // On appelle un Roi ; une Dame seulement si on possède les 4 Rois
    if (cardData.value === 'D' && kingsHeld < 4) return;
    if (cardData.value !== 'R' && cardData.value !== 'D') return;

    applyCallKing(roomId, { t: 'c', suit: cardData.suit, value: cardData.value });
}

function applyCallKing(roomId, called) {
    const game = activeGames[roomId];
    game.calledCard = called;
    // Recherche du partenaire (celui qui possède la carte appelée)
    game.partner = -1;
    game.players.forEach((p, i) => {
        if (p.cards.some(c => c.t === 'c' && c.suit === called.suit && c.value === called.value)) game.partner = i;
    });
    if (game.chien.some(c => c.t === 'c' && c.suit === called.suit && c.value === called.value)) game.partner = game.preneur;
    if (game.partner === -1) game.partner = game.preneur; // sécurité
    const label = (called.value === 'R' ? 'Roi' : 'Dame') + ' de ' + called.suit;
    io.to(roomId).emit('infoMsg', game.players[game.preneur].name + ' appelle le ' + label + '.');
    proceedToChien(roomId);
}

// ==================== CHIEN / ÉCART ====================
function proceedToChien(roomId) {
    const game = activeGames[roomId];
    const pName = game.players[game.preneur].name;
    if (game.bestBid >= 3) {
        // Garde Sans / Garde Contre : le chien reste fermé
        game.phase = 'play';
        game.leadIdx = (game.dealer + 1) % game.playerCount;
        game.currentTurn = game.leadIdx;
        game.message = pName + ' joue une ' + BID_NAMES[game.bestBid] + '. ' + game.players[game.currentTurn].name + ' entame.';
        broadcastGameState(roomId);
        scheduleBot(roomId);
    } else {
        // Petite / Garde : le chien est montré à tous, puis le preneur fait son écart
        game.phase = 'ecart';
        game.message = 'Chien dévoilé. ' + pName + ' prépare son écart (' + game.chienSize + ' cartes).';
        game.players[game.preneur].cards = sortHand(game.players[game.preneur].cards.concat(game.chien));
        broadcastGameState(roomId);
        scheduleBot(roomId);
    }
}

function ecartForbidden(card) {
    // Interdit d'écarter Rois et Bouts. Les atouts sont interdits sauf impossibilité.
    return (card.t === 'c' && card.value === 'R') || isBout(card);
}

function handleEcart(roomId, playerId, indices) {
    const game = activeGames[roomId];
    if (!game || game.phase !== 'ecart') return;
    const idx = game.players.findIndex(p => p.id === playerId);
    if (idx !== game.preneur) return;
    if (!Array.isArray(indices)) return;
    const hand = game.players[idx].cards;
    const uniq = [...new Set(indices.map(i => parseInt(i)))].filter(i => !isNaN(i) && i >= 0 && i < hand.length);
    if (uniq.length !== game.chienSize) return;

    const selected = uniq.map(i => hand[i]);
    if (selected.some(c => ecartForbidden(c))) return;

    // Atouts autorisés seulement s'il n'y a pas assez de cartes "normales"
    const normalAvailable = hand.filter(c => !ecartForbidden(c) && c.t !== 'a').length;
    const atoutsSelected = selected.filter(c => c.t === 'a').length;
    if (atoutsSelected > 0 && normalAvailable >= game.chienSize) {
        io.to(playerId).emit('infoMsg', "Ecart refuse : pas d'atout a l'ecart quand vous avez d'autres cartes.");
        return;
    }

    applyEcart(roomId, uniq);
}

function applyEcart(roomId, indices) {
    const game = activeGames[roomId];
    const hand = game.players[game.preneur].cards;
    indices.sort((a, b) => b - a);
    game.ecartCards = [];
    indices.forEach(i => game.ecartCards.push(hand.splice(i, 1)[0]));
    sortHand(hand);
    game.phase = 'play';
    game.leadIdx = (game.dealer + 1) % game.playerCount;
    game.currentTurn = game.leadIdx;
    game.trick = [];
    game.message = 'Écart terminé. ' + game.players[game.currentTurn].name + ' entame.';
    broadcastGameState(roomId);
    scheduleBot(roomId);
}

// ==================== RÈGLES DE JEU (cartes légales) ====================
function trickLedCard(trick) {
    // Première carte non-Excuse : c'est elle qui définit la couleur demandée
    for (const t of trick) { if (t.card.t !== 'e') return t.card; }
    return null;
}

function highestAtoutInTrick(trick) {
    let best = 0;
    trick.forEach(t => { if (t.card.t === 'a' && t.card.rank > best) best = t.card.rank; });
    return best;
}

function legalIndices(game, playerIdx) {
    const hand = game.players[playerIdx].cards;
    const trick = game.trick;
    const all = hand.map((c, i) => i);
    if (trick.length === 0) return all; // on entame : tout est permis

    const led = trickLedCard(trick);
    if (!led) return all; // seule l'Excuse a été jouée : tout est permis

    const bestAtout = highestAtoutInTrick(trick);
    const legal = [];
    const hasLedSuit = (led.t === 'c') && hand.some(c => c.t === 'c' && c.suit === led.suit);
    const atouts = hand.filter(c => c.t === 'a');
    const hasAtout = atouts.length > 0;
    const hasHigherAtout = atouts.some(c => c.rank > bestAtout);

    hand.forEach((c, i) => {
        if (c.t === 'e') { legal.push(i); return; } // l'Excuse se joue toujours
        if (led.t === 'a') {
            // Atout demandé : fournir de l'atout en montant si possible
            if (hasAtout) {
                if (c.t === 'a' && (!hasHigherAtout || c.rank > bestAtout)) legal.push(i);
            } else legal.push(i);
        } else {
            // Couleur demandée
            if (hasLedSuit) {
                if (c.t === 'c' && c.suit === led.suit) legal.push(i);
            } else if (hasAtout) {
                // Défaut de couleur : obligation de couper, en surcoupant si possible
                if (c.t === 'a' && (!hasHigherAtout || c.rank > bestAtout)) legal.push(i);
            } else legal.push(i); // ni couleur ni atout : défausse libre
        }
    });
    return legal.length ? legal : all;
}

// ==================== POIGNÉES ====================
// Règle officielle : à 4 joueurs 10/13/15 atouts (+20/+30/+40), à 5 joueurs 8/10/13.
// Annonçable par n'importe quel joueur au moment de jouer sa première carte.
// Le bonus n'est pas multiplié et revient toujours au camp vainqueur de la donne.
const POIGNEES = { 4: [[10, 20], [13, 30], [15, 40]], 5: [[8, 20], [10, 30], [13, 40]] };

function poigneeLevelFor(game, idx) {
    const hand = game.players[idx].cards;
    const n = hand.filter(c => c.t === 'a' || c.t === 'e').length; // l'Excuse peut compléter
    const defs = POIGNEES[game.playerCount] || POIGNEES[4];
    let best = null;
    defs.forEach(d => { if (n >= d[0]) best = { count: d[0], bonus: d[1] }; });
    return best;
}

function applyPoignee(roomId, idx) {
    const game = activeGames[roomId];
    if (game.players[idx].cards.length !== game.totalTricks) return false; // avant sa 1ère carte uniquement
    if (game.poignees.some(p => p.playerIdx === idx)) return false;
    const best = poigneeLevelFor(game, idx);
    if (!best) return false;
    game.poignees.push({ playerIdx: idx, count: best.count, bonus: best.bonus });
    const atouts = game.players[idx].cards.filter(c => c.t === 'a').map(c => c.rank).sort((x, y) => x - y).join(' ');
    const hasExc = game.players[idx].cards.some(c => c.t === 'e');
    io.to(roomId).emit('infoMsg', '✋ ' + game.players[idx].name + ' annonce une poignée de ' + best.count +
        ' atouts (+' + best.bonus + ' pour le camp vainqueur) : ' + atouts + (hasExc ? ' + Excuse' : ''));
    return true;
}

function handlePoignee(roomId, playerId) {
    const game = activeGames[roomId];
    if (!game || game.phase !== 'play') return;
    const idx = game.players.findIndex(p => p.id === playerId);
    if (idx !== game.currentTurn) return;
    if (applyPoignee(roomId, idx)) broadcastGameState(roomId);
}

// Une carte est "maîtresse" si aucune carte supérieure n'est encore en circulation
function isMasterCard(game, hand, card) {
    if (card.t === 'e') return false;
    const seen = (r, suit, type) => game.playedCards.some(c => c.t === type && (type === 'a' || c.suit === suit) && c.rank === r)
        || hand.some(c => c.t === type && (type === 'a' || c.suit === suit) && c.rank === r);
    if (card.t === 'a') {
        for (let r = card.rank + 1; r <= 21; r++) if (!seen(r, null, 'a')) return false;
        return true;
    }
    for (let r = card.rank + 1; r <= 14; r++) if (!seen(r, card.suit, 'c')) return false;
    return true;
}

// ==================== JOUER UNE CARTE ====================
function handlePlay(roomId, playerId, cardIndex) {
    const game = activeGames[roomId];
    if (!game || game.phase !== 'play') return;
    if (game.trick.length >= game.playerCount) return; // pli complet en cours de résolution
    const idx = game.players.findIndex(p => p.id === playerId);
    if (idx !== game.currentTurn) return;
    cardIndex = parseInt(cardIndex);
    if (isNaN(cardIndex)) return;
    if (!legalIndices(game, idx).includes(cardIndex)) return;
    applyPlay(roomId, idx, cardIndex);
}

function applyPlay(roomId, idx, cardIndex) {
    const game = activeGames[roomId];
    const card = game.players[idx].cards.splice(cardIndex, 1)[0];
    game.playedCards.push(card);
    game.trick.push({ playerIdx: idx, card: card });

    // Révélation du partenaire quand la carte appelée est jouée (5 joueurs)
    if (game.calledCard && card.t === 'c' && card.suit === game.calledCard.suit && card.value === game.calledCard.value) {
        io.to(roomId).emit('infoMsg', game.players[idx].name + ' est le partenaire du preneur !');
    }

    if (game.trick.length === game.playerCount) {
        game.message = 'Fin du pli...';
        broadcastGameState(roomId);
        setTimeout(() => resolveTrick(roomId), 1800);
    } else {
        game.currentTurn = (game.currentTurn + 1) % game.playerCount;
        game.message = 'À ' + game.players[game.currentTurn].name + ' de jouer.';
        broadcastGameState(roomId);
        scheduleBot(roomId);
    }
}

function resolveTrick(roomId) {
    const game = activeGames[roomId];
    if (!game || game.phase !== 'play') return;
    const trick = game.trick;
    const led = trickLedCard(trick);
    let winner = -1, bestRank = -1, bestIsAtout = false;

    trick.forEach(t => {
        const c = t.card;
        if (c.t === 'e') return; // l'Excuse ne gagne jamais
        if (c.t === 'a') {
            if (!bestIsAtout || c.rank > bestRank) { bestIsAtout = true; bestRank = c.rank; winner = t.playerIdx; }
        } else if (!bestIsAtout && led && c.t === 'c' && c.suit === led.suit) {
            if (c.rank > bestRank) { bestRank = c.rank; winner = t.playerIdx; }
        }
    });
    if (winner === -1) winner = trick[0].playerIdx; // cas extrême (que des Excuses impossible, sécurité)

    const isLastTrick = (game.tricksPlayed === game.totalTricks - 1);
    trick.forEach(t => {
        if (t.card.t === 'e' && !isLastTrick) {
            // L'Excuse reste à son propriétaire (compensation de 0,5 pt gérée au décompte)
            game.players[t.playerIdx].wonCards.push(t.card);
            game.excuseInfo = { owner: t.playerIdx, trickWinner: winner };
        } else {
            game.players[winner].wonCards.push(t.card);
        }
    });

    game.lastTrick = { cards: trick.map(t => ({ playerIdx: t.playerIdx, card: t.card })), winner: winner };
    game.tricksPlayed++;
    game.trick = [];

    if (game.tricksPlayed >= game.totalTricks) {
        scoreRound(roomId);
    } else {
        game.currentTurn = winner;
        game.leadIdx = winner;
        game.message = game.players[winner].name + ' remporte le pli et entame.';
        broadcastGameState(roomId);
        scheduleBot(roomId);
    }
}

// ==================== DÉCOMPTE DES POINTS ====================
function teamOf(game, playerIdx) {
    if (playerIdx === game.preneur) return 'A';
    if (game.partner >= 0 && game.partner !== game.preneur && playerIdx === game.partner) return 'A';
    return 'D';
}

function scoreRound(roomId) {
    const game = activeGames[roomId];
    game.phase = 'between';

    let attackPts = 0, attackBouts = 0;
    game.players.forEach((p, i) => {
        const isAttack = teamOf(game, i) === 'A';
        p.wonCards.forEach(c => {
            if (isAttack) { attackPts += c.pts; if (isBout(c)) attackBouts++; }
        });
    });

    // Compensation de l'Excuse (0,5 point rendu au camp qui a gagné le pli)
    if (game.excuseInfo) {
        const ownerTeam = teamOf(game, game.excuseInfo.owner);
        const winnerTeam = teamOf(game, game.excuseInfo.trickWinner);
        if (ownerTeam !== winnerTeam) {
            if (ownerTeam === 'A') attackPts -= 0.5; else attackPts += 0.5;
        }
    }

    // Le chien / l'écart
    const chienCards = (game.bestBid <= 2) ? game.ecartCards : game.chien;
    const chienToAttack = (game.bestBid !== 4); // Garde Contre : le chien va à la défense
    chienCards.forEach(c => {
        if (chienToAttack) { attackPts += c.pts; if (isBout(c)) attackBouts++; }
    });

    const targets = [56, 51, 41, 36];
    const target = targets[Math.min(attackBouts, 3)];
    const diff = attackPts - target;
    const won = diff >= 0;
    const mult = BID_MULT[game.bestBid];

    // Petit au bout : le camp qui gagne le dernier pli avec le Petit dedans
    let petitBonus = 0;
    if (game.lastTrick && game.lastTrick.cards.some(t => t.card.t === 'a' && t.card.rank === 1)) {
        const bonusTeam = teamOf(game, game.lastTrick.winner);
        petitBonus = (bonusTeam === 'A') ? 10 : -10;
    }

    // Poignées : bonus non multiplié, toujours au camp vainqueur de la donne
    const poigneeSum = game.poignees.reduce((s, p) => s + p.bonus, 0);
    let total = (25 + Math.abs(diff)) * mult * (won ? 1 : -1) + petitBonus * mult + poigneeSum * (won ? 1 : -1);
    total = Math.round(total);

    // Répartition des scores
    const N = game.playerCount;
    const results = [];
    if (N === 4) {
        game.players.forEach((p, i) => {
            const delta = (i === game.preneur) ? 3 * total : -total;
            p.score += delta;
            results.push({ name: p.name, delta: delta, score: p.score, role: (i === game.preneur) ? 'Preneur' : 'Défense' });
        });
    } else {
        const alone = (game.partner === game.preneur);
        game.players.forEach((p, i) => {
            let delta, role;
            if (i === game.preneur) { delta = (alone ? 4 : 2) * total; role = 'Preneur'; }
            else if (!alone && i === game.partner) { delta = total; role = 'Partenaire'; }
            else { delta = -total; role = 'Défense'; }
            p.score += delta;
            results.push({ name: p.name, delta: delta, score: p.score, role: role });
        });
    }

    const summary = {
        preneur: game.players[game.preneur].name,
        contract: BID_NAMES[game.bestBid],
        attackPts: Math.round(attackPts * 2) / 2,
        target: target, bouts: attackBouts, won: won,
        petitBonus: petitBonus * mult,
        poigneeBonus: poigneeSum * (won ? 1 : -1),
        totalValue: total,
        results: results,
        roundNumber: game.roundNumber,
        totalRounds: game.totalRounds,
        calledCard: game.calledCard,
        partnerName: (game.partner >= 0 && game.partner !== game.preneur) ? game.players[game.partner].name : null,
        isMatchEnd: game.roundNumber >= game.totalRounds
    };

    game.history.push({
        donne: game.roundNumber, preneur: summary.preneur, partner: summary.partnerName,
        contract: summary.contract, won: won, value: total,
        petit: petitBonus * mult, poignee: poigneeSum * (won ? 1 : -1),
        scores: game.players.map(p => p.score)
    });

    if (summary.isMatchEnd) {
        game.phase = 'matchEnd';
        const winnerP = game.players.reduce((max, p) => p.score > max.score ? p : max, game.players[0]);
        summary.matchWinner = winnerP.name;
    }
    broadcastGameState(roomId);
    io.to(roomId).emit('roundEnd', summary);

    // Si tous les humains sont partis (IA seulement), on nettoie
    if (game.players.every(p => p.isBot)) delete activeGames[roomId];
    else if (game.phase === 'between' && game.players.filter(p => !p.isBot).length > 0) {
        // Avance auto si le seul humain restant est en solo ? Non : bouton "manche suivante".
    }
}

// ==================== INTELLIGENCE DES ROBOTS ====================
function scheduleBot(roomId) {
    const game = activeGames[roomId];
    if (!game) return;

    let botIdx = -1;
    if (game.phase === 'bidding') botIdx = game.bidTurn;
    else if (game.phase === 'callKing' || game.phase === 'ecart') botIdx = game.preneur;
    else if (game.phase === 'play') botIdx = game.currentTurn;
    if (botIdx < 0 || !game.players[botIdx] || !game.players[botIdx].isBot) return;

    const phaseAtSchedule = game.phase;
    const turnAtSchedule = botIdx;
    setTimeout(() => {
        const g = activeGames[roomId];
        if (!g || g.phase !== phaseAtSchedule) return;
        if (g.phase === 'bidding' && g.bidTurn !== turnAtSchedule) return;
        if (g.phase === 'play' && (g.currentTurn !== turnAtSchedule || g.trick.length >= g.playerCount)) return;
        botAct(roomId, turnAtSchedule);
    }, 1400);
}

function botAct(roomId, idx) {
    const game = activeGames[roomId];
    if (!game) return;
    const bot = game.players[idx];

    if (game.phase === 'bidding') {
        const hand = bot.cards;
        const atouts = hand.filter(c => c.t === 'a').length;
        const bouts = hand.filter(c => isBout(c)).length;
        const rois = hand.filter(c => c.t === 'c' && c.value === 'R').length;
        const gros = hand.filter(c => c.t === 'a' && c.rank >= 16).length;
        const strength = atouts + bouts * 4 + rois * 2 + gros + ((game.playerCount === 5) ? 2 : 0);
        let wish = 0;
        if (strength >= 26) wish = 3;
        else if (strength >= 20) wish = 2;
        else if (strength >= 15) wish = 1;
        const bid = (wish > game.bestBid) ? wish : 0;
        applyBid(roomId, idx, bid);
        return;
    }

    if (game.phase === 'callKing') {
        const hand = bot.cards;
        const kingsHeld = hand.filter(c => c.t === 'c' && c.value === 'R').length;
        const wanted = (kingsHeld >= 4) ? 'D' : 'R';
        // Appelle dans sa couleur la plus longue où il n'a pas la carte
        let bestSuit = null, bestLen = -1;
        SUITS.forEach(s => {
            const holdsCard = hand.some(c => c.t === 'c' && c.suit === s && c.value === wanted);
            if (holdsCard) return;
            const len = hand.filter(c => c.t === 'c' && c.suit === s).length;
            if (len > bestLen) { bestLen = len; bestSuit = s; }
        });
        if (!bestSuit) bestSuit = SUITS[Math.floor(Math.random() * 4)];
        applyCallKing(roomId, { t: 'c', suit: bestSuit, value: wanted });
        return;
    }

    if (game.phase === 'ecart') {
        const hand = bot.cards;
        // Cartes candidates : ni Roi, ni Bout, ni Atout, triées par valeur croissante
        let cand = hand.map((c, i) => ({ c, i })).filter(x => !ecartForbidden(x.c) && x.c.t !== 'a');
        cand.sort((a, b) => (a.c.pts - b.c.pts) || (a.c.rank - b.c.rank));
        let picked = cand.slice(0, game.chienSize).map(x => x.i);
        if (picked.length < game.chienSize) {
            // Pas assez : on complète avec les plus petits atouts (hors bouts)
            let atoutsC = hand.map((c, i) => ({ c, i })).filter(x => x.c.t === 'a' && !isBout(x.c) && !picked.includes(x.i));
            atoutsC.sort((a, b) => a.c.rank - b.c.rank);
            while (picked.length < game.chienSize && atoutsC.length) picked.push(atoutsC.shift().i);
        }
        applyEcart(roomId, picked);
        return;
    }

    if (game.phase === 'play') {
        // Annonce automatique de poignée avant la première carte
        if (bot.cards.length === game.totalTricks && applyPoignee(roomId, idx)) {
            broadcastGameState(roomId);
        }

        const legal = legalIndices(game, idx);
        const hand = bot.cards;
        const isLastToPlay = (game.trick.length === game.playerCount - 1);
        const tricksRemaining = game.totalTricks - game.tricksPlayed;
        const trickPts = game.trick.reduce((s, t) => s + t.card.pts, 0);
        let choiceIdx = -1;

        function wouldWin(card) {
            const led = trickLedCard(game.trick) || card;
            const bestAtout = highestAtoutInTrick(game.trick);
            if (card.t === 'e') return false;
            if (card.t === 'a') return card.rank > bestAtout;
            if (bestAtout > 0) return false;
            if (led.t === 'c' && card.suit === led.suit) {
                let best = -1;
                game.trick.forEach(t => { if (t.card.t === 'c' && t.card.suit === led.suit && t.card.rank > best) best = t.card.rank; });
                return card.rank > best;
            }
            return false;
        }

        // 1. L'EXCUSE : jouée au dernier pli elle est perdue -> on la joue au plus tard
        //    à l'avant-dernier pli, ou plus tôt pour sauver une figure sur un gros pli.
        const excuseIdx = hand.findIndex(c => c.t === 'e');
        if (excuseIdx !== -1 && legal.includes(excuseIdx) && tricksRemaining === 2) {
            choiceIdx = excuseIdx;
        }

        // Réserves : jamais le Petit ni l'Excuse si un autre choix existe
        const safe = legal.filter(i => hand[i].t !== 'e' && !(hand[i].t === 'a' && hand[i].rank === 1));
        const noExcuse = legal.filter(i => hand[i].t !== 'e');
        const pool = safe.length ? safe : (noExcuse.length ? noExcuse : legal);

        if (choiceIdx === -1 && game.trick.length === 0) {
            // 2. ENTAME : jouer une carte maîtresse à points, sinon petite carte de sa couleur longue
            const masters = pool.filter(i => hand[i].t === 'c' && isMasterCard(game, hand, hand[i]));
            if (masters.length) {
                masters.sort((x, y) => hand[y].pts - hand[x].pts);
                choiceIdx = masters[0];
            } else {
                const suitCards = pool.filter(i => hand[i].t === 'c');
                if (suitCards.length) {
                    const lenBySuit = {};
                    hand.forEach(c => { if (c.t === 'c') lenBySuit[c.suit] = (lenBySuit[c.suit] || 0) + 1; });
                    suitCards.sort((x, y) => (lenBySuit[hand[y].suit] - lenBySuit[hand[x].suit]) || (hand[x].rank - hand[y].rank));
                    choiceIdx = suitCards[0];
                } else {
                    const sorted = [...pool].sort((x, y) => hand[x].rank - hand[y].rank);
                    choiceIdx = sorted[0];
                }
            }
        }

        if (choiceIdx === -1) {
            // 3. EN COURS DE PLI
            const winners = pool.filter(i => wouldWin(hand[i]));
            const masterWinners = winners.filter(i => isMasterCard(game, hand, hand[i]));

            if (isLastToPlay && winners.length && trickPts >= 2) {
                // Dernier à parler : ramasser au moindre coût
                winners.sort((x, y) => (hand[x].rank - hand[y].rank) || (hand[x].pts - hand[y].pts));
                choiceIdx = winners[0];
            } else if (masterWinners.length && trickPts >= 3) {
                // Une carte maîtresse sécurise le pli : encaisser les figures en jeu
                masterWinners.sort((x, y) => hand[x].pts - hand[y].pts);
                choiceIdx = masterWinners[0];
            }

            if (choiceIdx === -1) {
                // 4. On ne peut/veut pas gagner : se défausser au plus bas.
                //    Si on serait forcé de donner une figure sur un gros pli, sacrifier l'Excuse à la place.
                const dumps = [...pool].sort((x, y) => (hand[x].pts - hand[y].pts) || (hand[x].rank - hand[y].rank));
                const cheapest = dumps[0];
                if (excuseIdx !== -1 && legal.includes(excuseIdx) && hand[cheapest].pts >= 1.5 && trickPts >= 3 && tricksRemaining > 2) {
                    choiceIdx = excuseIdx;
                } else {
                    choiceIdx = cheapest;
                }
            }
        }
        applyPlay(roomId, idx, choiceIdx);
    }
}

// ==================== ENVOI DE L'ÉTAT AUX JOUEURS ====================
function broadcastGameState(roomId) {
    const game = activeGames[roomId];
    if (!game) return;
    game.players.forEach((player, idx) => {
        if (player.isBot) return;
        const showChien = (game.phase === 'ecart');
        io.to(player.id).emit('gameState', {
            roomId: roomId,
            donneId: game.donneId,
            playerCount: game.playerCount,
            myIndex: idx,
            phase: game.phase,
            message: game.message,
            dealer: game.dealer,
            playerNames: game.players.map(p => p.name),
            allPlayersCardsCount: game.players.map(p => p.cards ? p.cards.length : 0),
            allPlayersScores: game.players.map(p => p.score),
            hand: player.cards || [],
            legal: (game.phase === 'play' && game.currentTurn === idx && game.trick.length < game.playerCount) ? legalIndices(game, idx) : [],
            trick: game.trick.slice(),
            lastTrick: game.lastTrick,
            currentTurn: (game.phase === 'play') ? game.currentTurn : -1,
            bidTurn: (game.phase === 'bidding') ? game.bidTurn : -1,
            bids: game.players.map(p => p.bid),
            bestBid: game.bestBid,
            bidNames: BID_NAMES,
            preneur: game.preneur,
            contract: (game.bestBid > 0) ? BID_NAMES[game.bestBid] : null,
            calledCard: game.calledCard,
            chien: showChien ? game.chien : null,
            chienSize: game.chienSize,
            tricksPlayed: game.tricksPlayed,
            totalTricks: game.totalTricks,
            roundNumber: game.roundNumber,
            totalRounds: game.totalRounds,
            iAmPreneur: (idx === game.preneur),
            history: game.history || [],
            poignees: (game.poignees || []).map(pg => ({ name: game.players[pg.playerIdx].name, count: pg.count, bonus: pg.bonus })),
            myPoignee: (game.phase === 'play' && player.cards && player.cards.length === game.totalTricks
                && !(game.poignees || []).some(pg => pg.playerIdx === idx)) ? poigneeLevelFor(game, idx) : null,
            myKingsCount: (player.cards || []).filter(c => c.t === 'c' && c.value === 'R').length
        });
    });
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Serveur Tarot actif sur le port ' + PORT));
