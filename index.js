const express = require('express');
const socketIO = require('socket.io');
const cors = require('cors')
const http = require('http');
const { initSocket } = require('./socket');
const { routes } = require('./router/routes');
require('dotenv').config();
const port = process.env.PORT || 4200;
const createLogger = require('./utilities/logger');
const {checkDatabaseConnection} = require('./utilities/db-connection');
const { initializeRedis } = require('./utilities/redis-connection');
const { connect } = require('./utilities/amqp');
const logger = createLogger('Server');

const startServer = async () => {
        await Promise.all([checkDatabaseConnection(), connect()]);
        await initializeRedis();
        var app = express();
        let server = http.createServer(app);
        var io = new socketIO.Server(server);
        app.use(cors());
        app.use(express.json());
        initSocket(io);
        app.use((req, res, next) => {
                req.io = io;
                next();
        });
        app.use(routes)

        server.listen(port, () => { logger.info(`Server listening at PORT ${port}`)});
};

startServer();
// hello