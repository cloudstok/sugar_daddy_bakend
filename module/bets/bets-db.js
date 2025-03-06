const { write } = require('../../utilities/db-connection');

const SQL_CASHOUT = "INSERT INTO settlement(bet_id, lobby_id, user_id ,operator_id, name, bet_amount, auto_cashout, balance, avatar, max_mult, status) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
const SQL_ROUND_STATS = "INSERT INTO round_stats (lobby_id, start_time, total_players , max_mult, end_time, total_bets, total_bet_amount, total_cashout_amount, biggest_winner, biggest_looser, total_round_settled)VALUES (?,?,?,?,?,?,?,?,?,?,?)";
const SQL_INSERT_BETS = 'INSERT INTO bets (bet_id, lobby_id, user_id, operator_id, name, balance, avatar, bet_amount, auto_cashout) VALUES(?,?,?,?,?,?,?,?,?)';

const addCashout = async (data) => {
    try {
        const { name, balance, avatar, lobby_id, bet_amount, user_id, operator_id, max_mult, bet_id, maxAutoCashout } = data;
        const autoCashout = maxAutoCashout === 'null' ? null : maxAutoCashout;
        await write(SQL_CASHOUT, [bet_id, lobby_id, decodeURIComponent(user_id), operator_id, name, bet_amount, autoCashout, balance, avatar, max_mult, "cashout"])
        console.info("Cashout Data Inserted Successfully")
    } catch (er) {
        console.error(er);
    }
}
const addSettleBet = async (data) => {
    try {
        if (!data || data.length === 0) {
            console.info("No data for Settlement.");
            return;
        }
        const finalData = [];
        for (let x of data) {
            const { lobby_id, bet_amount, user_id, operator_id, bet_id, name, balance, max_mult, avatar, maxAutoCashout } = x;
            const autoCashout = maxAutoCashout === 'null' ? null : maxAutoCashout;
            finalData.push([bet_id, lobby_id, decodeURIComponent(user_id), operator_id, name, bet_amount, autoCashout, balance, avatar, max_mult])
        }
        const placeholders = finalData.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?,?)').join(',');
        const SQL_SETTLEMENT = ` INSERT INTO settlement  (bet_id, lobby_id, user_id, operator_id, name, bet_amount, auto_cashout, balance, avatar, max_mult)  VALUES ${placeholders}`;
        const flattenedData = finalData.flat();
        await write(SQL_SETTLEMENT, flattenedData);
        console.info("Settlement Data Inserted Successfully")
    } catch (er) {
        console.error(er);
    }
}

const addRoundStats = async (data) => {
    try {
        const { lobby_id, start_time, total_players, max_mult, end_time, total_bets, total_bet_amount, total_cashout_amount, biggest_winner, biggest_looser, total_round_settled } = data
        await write(SQL_ROUND_STATS, [lobby_id, start_time, total_players, max_mult.toFixed(2), end_time, total_bets, total_bet_amount, total_cashout_amount, biggest_winner, biggest_looser, total_round_settled])
        console.info("Round stats data inserted successfully");
    } catch (er) {
        console.error(er);
    }
}

const insertBets = async (betData) => {
    try {
        let { bet_id, name, balance, avatar, maxAutoCashout } = betData;
        maxAutoCashout = maxAutoCashout === 'null' ? null : maxAutoCashout;
        let [b, lobby_id, bet_amount, user_id, operator_id, identifier] = bet_id.split(":");
        await write(SQL_INSERT_BETS, [bet_id, lobby_id, decodeURIComponent(user_id), operator_id, name, balance, avatar, bet_amount, maxAutoCashout]);
        console.info(`Bet placed successfully for user`, user_id);
    } catch (err) {
        console.error(err);
    }
}



module.exports = { addCashout, addSettleBet, addRoundStats, insertBets };