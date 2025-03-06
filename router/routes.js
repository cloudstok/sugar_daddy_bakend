const routes = require('express').Router()

routes.get('/', async (req, res) => {
    res.send({ "msg": "Helix game server is up and running👍" })
});


module.exports = { routes }