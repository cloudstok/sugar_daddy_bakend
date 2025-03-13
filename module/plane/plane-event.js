const sleep = ms => new Promise(r => setTimeout(r, ms));
const { settleBet, settleCallBacks, setCurrentLobby, getCurrentLobby } = require('../bets/bets-message');
const { getPlayerCount } = require('../players/player-message');
const { insertLobbies } = require('./plane-db');
const createLogger = require('../../utilities/logger');
const logger = createLogger('Plane', 'jsonl');
const planeErrorLogger = createLogger('PlaneError', 'log');
const { read } = require('../../utilities/db-connection');

let lobbiesMult = [];

const checkPlaneHealth = () => setInterval(() => {
    const { lobbyId, status } = getCurrentLobby();
    if (isNaN(Number(lobbyId))) {
        planeErrorLogger.error(`Invalid Lobby id got ${lobbyId}. Exiting.. LobbyData is ${JSON.stringify(getCurrentLobby())}`);
        process.exit(1);
    }
    const timeDiff = (Date.now() - Number(lobbyId)) / 1000;
    if (status === 0 && timeDiff > 60) {
        planeErrorLogger.error(`Lobby Timed Out ${lobbyId}. Exiting.. LobbyData is ${JSON.stringify(getCurrentLobby())}`);
        process.exit(1);
    }
    if (timeDiff > 240) {
        planeErrorLogger.error(`Lobby Taking too much time ${lobbyId}. LobbyData is ${JSON.stringify(getCurrentLobby())}`);
    }
    if (timeDiff > 600) {
        planeErrorLogger.error(`Exiting Lobby as it took more than 5 minutes ${lobbyId}. LobbyData is ${JSON.stringify(getCurrentLobby())}`);
        process.exit(1);
    }
}, 1000);

const initPlane = async (io) => {
    logger.info("lobby started");
    initLobby(io);
    checkPlaneHealth();
    lobbiesMult = await getMaxMultOdds(io);
}

let odds = {};
let betCount = 0;

function getRandomBetCount() {
    betCount = Math.floor(Math.random() * (3000 - 600 + 1)) + 600;
    return betCount
}

const getLobbiesMult = () => lobbiesMult;
const getBetCount = () => betCount;

const initLobby = async (io) => {
    const lobbyId = Date.now();
    io.emit('betCount', getRandomBetCount());
    io.emit('maxOdds', lobbiesMult);
    let recurLobbyData = { lobbyId, status: 0, isWebhook: 0 }
    setCurrentLobby(recurLobbyData);
    odds.lobby_id = lobbyId;
    odds.start_time = Date.now();
    const start_delay = 7;
    let inc = 1
    const end_delay = 6;
    odds.total_players = await getPlayerCount();
   const max_mult = generateOdds().mult;

//    const max_mult = 50;


    for (let x = 0; x < start_delay; x++) {
        io.emit("plane", `${lobbyId}:${inc}:0`);
        inc++
        await sleep(1000);
    }

    recurLobbyData['max_mult'] = max_mult;
    recurLobbyData['isWebhookData'] = 1;
    setCurrentLobby(recurLobbyData);

    await settleCallBacks(io);

    await sleep(1000);

    let init_val = 1;
    recurLobbyData['status'] = 1;
    setCurrentLobby(recurLobbyData);
    do {
        io.emit("plane", `${lobbyId}:${init_val.toFixed(2)}:1`);
        init_val += 0.01;

        if (init_val < 2) {
            init_val = init_val + 0.01;
        }
        else if (init_val < 10) {
            init_val = init_val * 1.003;
        }
        else if (init_val < 50) {
            init_val = init_val * 1.004;
        }
        else {
            init_val = init_val * 1.005;
        }

        recurLobbyData['ongoingMaxMult'] = init_val.toFixed(2);
        setCurrentLobby(recurLobbyData);
        await sleep(100)
    } while (init_val < max_mult);
    odds.max_mult = max_mult

    recurLobbyData['status'] = 2;
    setCurrentLobby(recurLobbyData);
    for (let y = 0; y < end_delay; y++) {
        if (y == 1) {
            await settleBet(io, odds)
        }
        io.emit("plane", `${lobbyId}:${y}-${max_mult.toFixed(2)}:2`);
        await sleep(1000);
    }
    odds = {}
    const history = { time: new Date(), lobbyId, start_delay, end_delay, max_mult: max_mult.toFixed(2) };
    lobbiesMult.pop();
    lobbiesMult = [history.max_mult, ...lobbiesMult];
    io.emit("history", JSON.stringify(history));
    logger.info(JSON.stringify(history));
    await insertLobbies(history);
    return initLobby(io);
}


const getMaxMultOdds = async (io) => {
    try {
        let odds = await read('SELECT max_mult from lobbies order by created_at desc limit 30');
        odds = odds.map(e => e.max_mult);
        return odds;
    } catch (err) {
        console.error(err)
    }
}







//---------------------------
// const fs = require('fs');

const RTP = 9200;// Return to player 97.00%

function generateOdds() {
    const win_per = (Math.random() * 99.00);
    let mult = (RTP) / (win_per * 100)
    if (mult < 1.01) {
        mult = 1.00
    }
    else if(mult > 20) {
        const highMultRng = (Math.random());
        if(highMultRng < 0.3) mult = generateOdds().mult;
    }
    else if (mult > 100000){
        mult = 100000;
    }
    return ({ win_per, mult });
}

module.exports = { initPlane, getLobbiesMult, getBetCount }
