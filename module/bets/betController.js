const { handleRejectedResult } = require("./bets-message");
const { getUserData } = require("../players/player-message");
const createLogger = require('../../utilities/logger');
const { setCache } = require("../../utilities/redis-connection");
const logger = createLogger('RevertedBets', 'jsonl');
const betsLogger = createLogger('failedRevertedBets', 'jsonl');



const settleBet = async (req, res) => {
    try {
        let { amount, userId, operatorId, rollbackMsg, description, txn_type, bet_id, socket_id, token } = req.body;
        userId = encodeURIComponent(userId);
        const userDetail = await getUserData(userId, operatorId);
        if (!userDetail) {
            return res.status(400).send({ status: false, msg: "Invalid User details" });
        }
        if (amount) {
            userDetail.balance += +amount;
            await setCache(`${operatorId}:${userId}`, JSON.stringify(userDetail));
        }
        if (txn_type === 0) {
            let data = { bet_id, socket_id, token, response: amount };
            await handleRejectedResult(data, req.io);
            return res.status(200).send({ status: true, msg: `Bet with bet id ${bet_id} has been successfully cancelled` });
        }
        const settleMsg = generateSettleMessage(rollbackMsg, description);
        //emit socket event for successful balance update
        logger.info(JSON.stringify({req: req.body, res: settleMsg}));
        req.io.to(userDetail.socket_id).emit("rollback", settleMsg);
        return res.status(200).send({ status: true, msg: "Amount updated as per the incoming event" });
    } catch (err) {
        betsLogger.error((JSON.stringify({req: req.body, res: err})));
        return res.status(500).send({ status: false, errMsg: "Internal Server Error..!" });
    }
}

const generateSettleMessage = (rollbackMsg, description) => {
    try {
        let settleMsg = rollbackMsg ? rollbackMsg.replace('debited', 'rollback-ed') : description;
        return settleMsg + ' by your game provider';
    } catch (error) {
        console.error('Error fetching generate Settle Message:', error);
        return error
    }

};




module.exports = { settleBet
}