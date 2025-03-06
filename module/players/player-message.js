const axios = require('axios');
const { setCache, getCache, deleteCache } = require('../../utilities/redis-connection');
const createLogger = require('../../utilities/logger');
const { getRandomAvator } = require('../../utilities/common-function');
const logger = createLogger('players', 'jsonl');
const initPlayer = (io, socket, data) => {
    const [message, ...rest] = data
    switch (message) {
        case 'INFO': return handleUser(io, socket, rest);
    }
}

let playerCount = 0;
const handleUser = async (io, socket, data) => {
    try {
        const [token, game_id] = data;
        if (token === "undefined") {
            return socket.emit("info", {})
        } else {
            const userData = await getUserDataFromSource(token);
            if (userData) {
                logger.info(JSON.stringify(userData));
                let { name, user_id, balance, avatar, operatorId } = userData;
                user_id = encodeURIComponent(user_id);
                const key = `${operatorId}:${user_id}`;
                playerCount++;
                balance = (+balance).toFixed(2);
                const image = getRandomAvator();
                // const image = getAvatarValue(key);
                const playerDetailsFromApi = { id: user_id, operator_id: operatorId, name, balance, avatar: image, session_token: token, socket_id: socket.id, game_id };
                await setCache(key, JSON.stringify(playerDetailsFromApi));
                socket.on("disconnect", async () => {
                    logger.info(`user disconnected :: ${operatorId}:${user_id}`)
                    playerCount--;
                    await deleteCache(key);
                });

                return socket.emit("info", { id: user_id, operator_id: operatorId, name, balance, avatar: image });
            } else {
                return socket.emit("info", {});
            }
        }
    } catch (err) {
        logger.error(JSON.stringify({ data: data, err: err }));
        return socket.emit("info", {});
    }
}


const getDataForSession = async(data, socket) => {
    try{
        if(!(data?.token)){
            return false;
        }
        const { token, game_id } = data;
        const userData = await getUserDataFromSource(token);
        if(!userData){
            return false;
        }
        let { name, user_id, balance, avatar, operatorId } = userData;
        const key = `${operatorId}:${user_id}`;
        balance = (+balance).toFixed(2);
        let mockAvatar = getRandomAvator();
        const playerDetailsFromApi = { id: user_id, operator_id: operatorId, name, balance, avatar: avatar && avatar !== "null" ? avatar : mockAvatar, session_token: token, socket_id: socket, game_id };
        await setCache(key, JSON.stringify(playerDetailsFromApi));
        return playerDetailsFromApi;
    }catch (err) {
        logger.error(JSON.stringify({ data: token, err: err }));
        return false
    }
}


const getUserDataFromSource = async (token) => {
    try {
        const userData = await axios.get(`${process.env.service_base_url}/service/user/detail`, {
            headers: {
                'token': token
            }
        }).then(async data => {
            return data?.data?.user;
        }).catch(err => {
            logger.error(JSON.stringify({ data: data, err: err }));
            return false
        });
        return userData;
    } catch (err) {
        logger.error(JSON.stringify({ data: token, err: err }));
        return false
    }
}

const getPlayerCount = async () => playerCount;



const getUserData = async (user_id, operator_id) => {
    let userData = await getCache(`${operator_id}:${user_id}`);
    if (userData) {
        try {
            userData = JSON.parse(userData);
        } catch (err) {
            console.error(`[ERR] while updating avatar is::`, err);
            return false
        }
        return userData
    }
}




module.exports = { initPlayer, handleUser, getUserData, getDataForSession, getPlayerCount }
