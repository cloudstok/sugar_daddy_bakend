const { initPlane } = require("../module/plane/plane-event")

const eventRouter = async(io)=> {
    initPlane(io)
}

module.exports= { eventRouter}