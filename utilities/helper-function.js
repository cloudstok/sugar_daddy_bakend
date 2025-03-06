const getLogger = require('./logger');
const failedBetLogger = getLogger('failedBets', 'jsonl');
const failedCashoutLogger = getLogger('failedCashout', 'jsonl');
const failedSettlementLogger = getLogger('failedCashout', 'jsonl');
const cancelledBetLogger = getLogger('failedCancelledBets', 'jsonl')


module.exports = {
    logEventAndEmitResponse(socket, req, res, event, io) {
        let logData = JSON.stringify({ req, res })
        if (event === 'bet') {
            failedBetLogger.error(logData)
        }
        if (event === 'cancelledBet') {
            cancelledBetLogger.error(logData);
        }
        if (event === 'cashout') {
            failedCashoutLogger.error(logData);
        }
        if (event === 'settlement') {
            failedSettlementLogger.error(logData);
            if (Object.keys(req).length === 0) {
                return;
            }
            return socket.to(req.socket_id).emit('logout', 'user_logout');
        }
        if(res === 'Session Timed Out'){
            return io.to(socket.id).emit('logout', 'user_logout')
        }
        return socket.emit('betError', res);
    }
}