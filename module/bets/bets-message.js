const { prepareDataForWebhook, postDataToSourceForBet } = require('../../utilities/common-function');
const { addCashout, addSettleBet, addRoundStats, previousBet, insertBets, deleteBet, updateUserBalance, getUserBets } = require('./bets-db');
const { appConfig } = require('../../utilities/app-config');
const { getUserData, getDataForSession } = require('../players/player-message');
const { deleteCache, setCache } = require('../../utilities/redis-connection');
const { logEventAndEmitResponse } = require('../../utilities/helper-function');
const getLogger = require('../../utilities/logger');
const { sendToQueue } = require('../../utilities/amqp');
const logger = getLogger('Bets', 'jsonl');
const cashoutLogger = getLogger('Cashout', 'jsonl');
const settlBetLogger = getLogger('Settlement', 'jsonl');
const statsLogger = getLogger('RoundStats', 'jsonl');
const failedBetsLogger = getLogger('userFailedBets', 'log');
const cancelBetsLogger = getLogger('cancelledBet', 'jsonl');
const failedCashoutLogger = getLogger('failedCashout', 'jsonl');
const failedcancelledBetLogger = getLogger('failedCancelledBets', 'jsonl')
const userLocks = new Map();

const initBet = async (io, socket, data) => {
    const [message, ...restData] = data;
    switch (message) {
        case 'PB':
            return placeBet(io, socket, restData);
        case 'CO':
            return cashOut(io, socket, restData);
        case 'CB':
            return cancelBet(io, socket, restData);
    }
}

let bets = [];
let settlements = [];
let lobbyData = {};


const currentRoundBets = (socket) => {
    const betData = {};
    const filteredBets = bets.map(e=> cleanData(e, 'bet'));
    const filteredSettlements = settlements.map(e=> cleanData(e, 'cashout'));
    betData.bets = filteredBets;
    betData.settlement = filteredSettlements;
    return socket.emit('game_status', JSON.stringify(betData));
};

const setCurrentLobby = (data) => {
    lobbyData = data;
};

const placeBet = async (io, socket, [lobby_id, max_mult, status, user_id, operator_id, token, gameId, maxAutoCashout, bet_amount, identifier]) => {
    let data = { lobby_id, max_mult, status, user_id, operator_id, maxAutoCashout, bet_amount, identifier };
    if (lobbyData.lobbyId != lobby_id) {
        return logEventAndEmitResponse(socket, data, 'Bets has been closed for this Round', 'bet');
    }
    let timeDifference = (Date.now() - lobby_id) / 1000;
    if (timeDifference > 6) {
        return logEventAndEmitResponse(socket, data, 'Bets has been closed for this Round', 'bet');
    }
    const releaseLock = await acquireLock(`${operator_id}:${user_id}`);
    try {
        if (!user_id || user_id === 'undefined') {
            return logEventAndEmitResponse(socket, data, 'Invalid User details', 'bet');
        }
        bet_amount = +bet_amount;
        if (bet_amount < appConfig.minBetAmount || bet_amount > appConfig.maxBetAmount) {
            return logEventAndEmitResponse(socket, data, 'Invalid Bet', 'bet');
        }
        const bet_id = `b:${lobby_id}:${bet_amount}:${user_id}:${operator_id}:${identifier}`;
        let userData = await getUserData(user_id, operator_id);
        if (!userData) return logEventAndEmitResponse(socket, data, 'Session Timed Out', 'bet', io);
        let { name, balance, avatar, session_token, game_id } = userData;
        const betObj = { bet_id, name, balance, avatar, token: session_token, maxAutoCashout, socket_id: socket.id, game_id };
        if (bet_amount && bet_amount > +balance) {
            return logEventAndEmitResponse(socket, data, 'Insufficient Balance', 'bet');
        }
        const webhookData = await prepareDataForWebhook({ ...betObj, bet_amount, lobby_id, user_id }, "DEBIT", socket);
        betObj.webhookData = webhookData;
        let userBet = bets.find(e => e.token === betObj.token && e.bet_id.split(':')[1] === lobby_id);
        if (userBet) {
            balance = userBet.balance
            if (bet_id === userBet.bet_id) {
                return logEventAndEmitResponse(socket, data, 'duplicate bet', 'bet');
            }
        }
        balance = (balance - bet_amount).toFixed(2);
        await setCache(`${operator_id}:${user_id}`, JSON.stringify({ ...userData, balance }));
        betObj.balance = balance
        bets.push(betObj);
        let playerDetails = { id: user_id, name, balance, avatar, operator_id: operator_id }
        logger.info(JSON.stringify({ req: data, res: betObj }));
        socket.emit("info", playerDetails);
        const cleanBetObj = cleanData(betObj, 'bet');
        return io.emit("bet", cleanBetObj);
    } catch (error) {
        return logEventAndEmitResponse(socket, data, 'Something went wrong, while placing bet', 'bet');
    } finally {
        releaseLock();
    }
}

function cleanData(betObj, event) {
    let clearBetObj = {
        bet_id: betObj['bet_id'],
        maxAutoCashout: betObj['maxAutoCashout']
    };
    if (event == 'bet') {
        Object.assign(clearBetObj, {
            name: betObj['name'].slice(0, 2) + '***' + betObj['name'].slice(-2),
            avatar: betObj['avatar'],
        })
    };
    if (event == 'cashout') {
        Object.assign(clearBetObj, {
            max_mult: betObj['max_mult'],
            plane_status: betObj['plane_status'],
            final_amount: betObj['final_amount']
        })
    }
    return clearBetObj;
}

const removeBetObjAndEmit = async (bet_id, bet_amount, user_id, operator_id, socket_id, io) => {
    const releaseLock = await acquireLock(`${operator_id}:${user_id}`);
    try {
        bets = bets.filter(e => e.bet_id !== bet_id);
        let userData = await getUserData(user_id, operator_id);
        if (userData) {
            userData.balance = (Number(userData.balance) + Number(bet_amount)).toFixed(2);
            await setCache(`${operator_id}:${user_id}`, JSON.stringify(userData));
            io.to(socket_id).emit("info", userData);
        }
        failedBetsLogger.error(JSON.stringify({ req: bet_id, res: 'bets cancelled by upstream' }));
        io.emit("bet", { bet_id: bet_id, action: "cancel" });
    } catch (err) {
        console.error(`[ERR] while removing bet from betObj is::`, err);
    } finally {
        releaseLock();
    }
}


const settleCallBacks = async (io) => {
    try {
        if (bets.length === 0) return;
        console.log(`Settling webhook callbacks`);
        const results = await Promise.allSettled(bets.map(async (bet) => {
            try{
                const result = await postDataToSourceForBet(bet);
                return result;
            } catch (error) {
                return error;
            }
        }));
        
        const processResults = results.map(result => {
            if(result.status === 'fulfilled'){
                return handleFulfilledResult(result.value, io);
            }else{
                console.error(`Error processing bet: ${result.reason}`);
                return handleRejectedResult(result.reason, io);
            }
        });

        await Promise.all(processResults);
    } catch (err) {
        console.error(err);
    }

}

const handleFulfilledResult = async (value, io) => {
    try {
        const { socket_id, status, bet_id } = value;
        const [b, lobby_id, bet_amount, user_id, operator_id, identifier] = bet_id.split(":");
        if (status === 200) {
            await insertBets(value);
        } else {
            await removeBetObjAndEmit(bet_id, bet_amount, user_id, operator_id, socket_id, io);
            io.to(socket_id).emit("betError", "bets cancelled by upstream");
        }
    } catch (err) {
        console.error(err);
    }

}

const handleRejectedResult = async (reason, io) => {
    try {
        if(!reason || !io) return;
        const { response, socket_id, bet_id } = reason;
        const [b, lobby_id, bet_amount, user_id, operator_id, identifier] = bet_id.split(":");
        if (response?.data?.msg === "Invalid Token or session timed out") {
            await removeBetObjAndEmit(bet_id, bet_amount, user_id, operator_id, socket_id, io);
            await deleteCache(`${operator_id}:${user_id}`);
            io.to(socket_id).emit("logout", "user logout");
        }
        await removeBetObjAndEmit(bet_id, bet_amount, user_id, operator_id, socket_id, io);
        io.to(socket_id).emit("betError", "bets cancelled by upstream");

    } catch (er) {
        console.error(er);
    }

}



const cancelBet = async (io, socket, [status, ...bet_id]) => {
    const [event, lobby_id, bet_amount, user_id, operator_id, identifierValue] = bet_id;
    bet_id = bet_id.join(':');
    let canObj = { status, bet_id };
    if (lobbyData.lobbyId !== lobby_id && lobbyData.status != 0) {
        failedcancelledBetLogger.error(JSON.stringify({ req: canObj, res: "Round has been closed cancel bet event" }));
    }
    try {
        if (status != 0) return;
        const betObj = bets.find(e => e.bet_id === bet_id);

        if (!betObj) {
            return logEventAndEmitResponse(socket, canObj, 'No active bets for given bet id', 'cancelledBet');
        }
        let { name, balance, avatar, game_id, token } = betObj;
        let userData = await getUserData(user_id, operator_id);
        if (!userData) {
            try {
                userData = await getDataForSession({ token, game_id }, socket.id);
                if (!userData) {
                    return logEventAndEmitResponse(socket, canObj, 'Session Timed Out', 'bet', io);
                }
            } catch (error) {
                console.error('Error fetching user data for session:', error);
                return logEventAndEmitResponse(socket, canObj, 'Session Timed Out', 'bet', io);
            }
        }
        let userBets = bets.filter(e => e.token === token);
        if (userBets.length > 1) {
            balance = +userBets[1].balance
            userBets[1].balance = (+balance + +bet_amount).toFixed(2);
        }
        balance = (+balance + +bet_amount).toFixed(2);
        await setCache(`${operator_id}:${user_id}`, JSON.stringify({ ...userData, balance }));
        let playerDetails = { id: user_id, name, balance, avatar, operator_id };
        socket.emit("info", playerDetails);
        cancelBetsLogger.info(JSON.stringify({ req: canObj, res: betObj }));
        bets = bets.filter(e => e.bet_id !== bet_id);
        return io.emit("bet", { bet_id: bet_id, action: "cancel" });

    } catch (error) {
        console.error(error);
        return logEventAndEmitResponse(socket, canObj, 'Something went wrong while cancelling the bet', 'cancelledBet')
    }
}


const acquireLock = async (user_id) => {
    while (userLocks.get(user_id)) {
        await userLocks.get(user_id);
    }

    let resolveLock;
    const lockPromise = new Promise((resolve) => {
        resolveLock = resolve;
    });

    userLocks.set(user_id, lockPromise);

    return () => {
        resolveLock();
        userLocks.delete(user_id);
    };
};


let cashOutBets = [];
const cashOut = async (io, socket, [max_mult, status, maxAutoCashout, ...betId], isAutoCashout = true) => {
    betId = betId.join(':');
    if (cashOutBets.includes(betId)) {
        return;
    }
    const CashObj = { max_mult, status, maxAutoCashout, betId, isAutoCashout };
    if (lobbyData.status != 1 && isAutoCashout) return logEventAndEmitResponse(socket, CashObj, 'Round has been closed for cashout event', 'cashout');
    let [b, lobby_id, bet_amount, user_id, operator_id, identifier] = betId.split(":");
    const releaseLock = await acquireLock(`${operator_id}:${user_id}`);
    try {
        const betObj = bets.find(e => e.bet_id === betId);
        if (!betObj) return logEventAndEmitResponse(socket, CashObj, 'No active bet for the event', 'cashout');
        Object.assign(betObj, { lobby_id, bet_amount, user_id, operator_id });
        max_mult = (betObj.maxAutoCashout !== 'null' && maxAutoCashout !== 'null' && Number(betObj.maxAutoCashout) == Number(maxAutoCashout) && Number(maxAutoCashout) <= Number(lobbyData['ongoingMaxMult'])) ? betObj.maxAutoCashout : max_mult;
        betObj.maxAutoCashout = (maxAutoCashout === 'null') ? 'null' : betObj.maxAutoCashout;


        const userBets = bets.filter(e => e.token === betObj.token);
        betObj.balance = userBets.length > 1 ? +userBets[1].balance : betObj.balance;

        const settledBets = (settlements.find(e => e.token === betObj.token && e.plane_status === 'cashout')) || false;
        if (settledBets) betObj.balance = +settledBets.balance;


        betObj.max_mult = (+max_mult).toFixed(2);
        betObj.plane_status = "cashout";
        betObj.final_amount = (Math.min((+bet_amount * +max_mult).toFixed(2), appConfig.maxCashoutAmount + ".00")).toFixed(2);
        betObj.amount = (betObj.final_amount - bet_amount).toFixed(2);
        betObj.balance = (+betObj.balance + +betObj.final_amount).toFixed(2);

        // Add cashout entry to the database
        await addCashout(betObj);

        // Prepare webhook data and post to source
        const webhookData = await prepareDataForWebhook(betObj, "CREDIT", socket);
        const { token, socket_id } = betObj;
        let userData = await getUserData(user_id, operator_id);
        const key = `${operator_id}:${user_id}`;
        try {
            await sendToQueue('', 'games_cashout', JSON.stringify({...webhookData, token: betObj.token, operatorId: operator_id}));
            if (userData) {
                userData.balance = betObj.balance;
                await setCache(key, JSON.stringify(userData));
            }
        } catch (err) {
            failedCashoutLogger.error(JSON.stringify({ req: CashObj, res: 'Error sending to queue' }));
        }

        // Emit events
        socket.emit("info", { id: user_id, name: betObj.name, balance: betObj.balance, avatar: betObj.avatar, operator_id });
        settlements.push(betObj);
        cashoutLogger.info(JSON.stringify({ req: CashObj, res: betObj }));
        const user_settlements = (settlements.filter(e => e.token === token && e.plane_status === 'cashout')).map(e => cleanData(e, 'cashout'));
        cashOutBets.push(betId);
        io.to(socket_id).emit('singleCashout', user_settlements);
        const cleanSettlementObj = cleanData(betObj, "cashout")
        io.emit("cashout", cleanSettlementObj);
        if (!userData) {
            try {
                userData = await getDataForSession({ token: betObj.token, game_id: betObj.game_id }, betObj.socket_id);
                if (!userData) {
                    return logEventAndEmitResponse(socket, CashObj, 'Session Timed Out', 'cashout', io);
                } else {
                    userData.balance = betObj.balance;
                    await setCache(key, JSON.stringify(userData));
                }
            } catch (error) {
                console.error('Error fetching user data for session:', error);
                return logEventAndEmitResponse(socket, CashObj, 'Session Timed Out', 'cashout', io);
            }
        }

    } catch (error) {
        console.log(error)
        return logEventAndEmitResponse(socket, CashObj, 'Something went wrong, while trying to Cashout', 'cashout');
    } finally {
        releaseLock();
    }
}

const settleBet = async (io, data) => {
    try {
        const filteredBets = bets.filter(betObj => !betObj.hasOwnProperty('plane_status'));
        if (filteredBets.length > 0) {
            const updatedBets = [];
            await Promise.all(filteredBets.map(async betObj => {
                const [b, lobby_id, bet_amount, user_id, operator_id, identifier] = betObj.bet_id.split(":");
                if (betObj.maxAutoCashout !== 'null' && Number(betObj.maxAutoCashout) <= lobbyData.max_mult) {
                    const socket = io.sockets.sockets.get(betObj.socket_id);
                    if (socket) {
                        let autoCashout = betObj.maxAutoCashout;
                        await cashOut(io, socket, [autoCashout, '1', 'null', b, lobby_id, bet_amount, user_id, operator_id, identifier], false);
                        return;
                    } else {
                        settlBetLogger.warn(JSON.stringify({ req: betObj, res: `Socket not found for socket_id: ${betObj.socket_id}` }));
                    }
                }
                Object.assign(betObj, { lobby_id, bet_amount, user_id, operator_id, max_mult: (+data.max_mult).toFixed(2), plane_status: "crashed", final_amount: 0, amount: bet_amount });
                settlBetLogger.info(JSON.stringify(betObj));
                settlements.push(betObj);
                updatedBets.push(betObj);
            }));
            await addSettleBet(updatedBets); // Insert Data into Databases
        }

        // Create round stats
        const roundStats = createRoundStats(data, settlements);

        statsLogger.info(JSON.stringify(roundStats));
        await addRoundStats(roundStats); // Insert stats into Databases

        // Clear bets and settlements arrays
        bets.length = 0;
        settlements.length = 0;
        cashOutBets.length = 0;
    } catch (error) {
        console.error('Error settling bets:', error);
        logEventAndEmitResponse(io, {}, 'Something went wrong while settling bet', 'settlement');
    }
};

const createRoundStats = (data, settlements) => {
    const stats = settlements.reduce((acc, e) => {
        acc.total_bet_amount += +e.bet_amount;
        if (e.plane_status === "cashout") {
            acc.total_cashout_amount += +e.final_amount;
            acc.biggest_winner = Math.max(acc.biggest_winner, +e.final_amount);
        }
        if (e.plane_status === "crashed") {
            acc.biggest_looser = Math.max(acc.biggest_looser, +e.bet_amount);
        }
        return acc;
    }, { total_bet_amount: 0, total_cashout_amount: 0, biggest_winner: 0, biggest_looser: 0 });

    const end_time = Date.now();
    const total_round_settled = stats.total_bet_amount - stats.total_cashout_amount;

    return {
        ...data,
        end_time,
        total_bets: settlements.length,
        total_bet_amount: stats.total_bet_amount,
        total_cashout_amount: stats.total_cashout_amount,
        biggest_winner: stats.biggest_winner,
        biggest_looser: stats.biggest_looser,
        total_round_settled
    };
};




const disConnect = async(io, socket) => {
    if(bets.length > 0){
        await Promise.all(bets.map(async bet=> {
            if(!bet.hasOwnProperty('plane_status') && bet.socket_id == socket.id && lobbyData['status'] == '1'){
                await cashOut(io, socket, [lobbyData['ongoingMaxMult'], lobbyData['status'], bet.maxAutoCashout, ...bet.bet_id.split(':')]);
            };
        }));
        if(lobbyData['status'] == '0'){
            bets = bets.filter(bet=> bet.socket_id != socket.id);
        }
    }
}

const getCurrentLobby =()=> lobbyData;

module.exports = { initBet, settleBet, settleCallBacks, handleRejectedResult, setCurrentLobby, disConnect, currentRoundBets, getCurrentLobby};
