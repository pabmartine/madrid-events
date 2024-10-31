const rateLimit = require("express-rate-limit");
const constants = require('./constants');

const limiter = rateLimit({
    windowMs: constants.RATE_LIMIT_WINDOW_MS,
    max: constants.RATE_LIMIT_MAX_REQUESTS
});

module.exports = limiter;