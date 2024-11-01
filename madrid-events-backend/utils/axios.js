const axios = require('axios');
const constants = require('../config/constants');

// Configuración de Axios
axios.defaults.timeout = constants.AXIOS_TIMEOUT;

// Interceptor para reintentos
axios.interceptors.response.use(null, (error) => {
    if (error.config && error.response && error.response.status >= 500) {
        return axios.request(error.config);
    }
    return Promise.reject(error);
});

module.exports = axios;