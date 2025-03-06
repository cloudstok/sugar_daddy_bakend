const { getLobbiesMult } = require("./module/plane/plane-event");
const { eventRouter } = require("./router/event-router");
const { messageRouter } = require('./router/message-router');

const initSocket = (io)=> {
    eventRouter(io);  
    const onConnection = (socket)=>{
        console.log("Socket connected")
        socket.emit('maxOdds', getLobbiesMult());
        messageRouter(io , socket)
    }   
    io.on("connection", onConnection);
}

module.exports = {initSocket}