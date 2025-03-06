const { initBet, disConnect, currentRoundBets } = require("../module/bets/bets-message");
const { initPlayer, avatarUpdate } = require("../module/players/player-message");
const createLogger = require('../utilities/logger');
const logger = createLogger('Event');


const messageRouter = async (io, socket) => {
    socket.on('message', (data) => {
        logger.info(data);
        const event = data.split(':')
        switch (event[0]) {
            case 'PL': return initPlayer(io, socket, event.slice(1, event.length));
            case 'BT': return initBet(io, socket, event.slice(1, event.length));
            case 'PLU': return avatarUpdate(io, socket, event.slice(1, event.length));
            case 'RC' : return currentRoundBets(socket);
        }
    });
    socket.on('disconnect', async()=> await disConnect(io, socket));
}


module.exports = { messageRouter }