const axios = require('axios');
const constants = require('../config/constants');

// Configuración de Axios
axios.defaults.timeout = constants.AXIOS_TIMEOUT;
axios.defaults.headers.common['User-Agent'] = constants.HTTP_USER_AGENT;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

axios.interceptors.response.use(undefined, async (error) => {
    const config = error.config;
    if (!config || !config.retryEnabled) {
        config.retryEnabled = true;
        config.__retryCount = 0;
    }

    const shouldRetry =
        error.response &&
        error.response.status >= 500 &&
        config.__retryCount < constants.MAX_RETRIES;

    if (shouldRetry) {
        config.__retryCount += 1;
        const backoff = constants.RETRY_DELAY * config.__retryCount;
        await delay(backoff);
        return axios.request(config);
    }

    return Promise.reject(error);
});

module.exports = axios;
