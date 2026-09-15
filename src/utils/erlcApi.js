const axios = require('axios');
const { getSetting } = require('./database');
const logger = require('./logger');

const BASE_URL = 'https://api.policeroleplay.community/v2';
const V1_URL = 'https://api.policeroleplay.community/v1';

async function request(endpoint, options = {}, version = 'v2') {
    const serverKey = getSetting('ERLC_SERVER_KEY', process.env.ERLC_SERVER_KEY);
    if (!serverKey) throw new Error('ERLC_SERVER_KEY not configured.');

    const url = `${version === 'v2' ? BASE_URL : V1_URL}${endpoint}`;
    
    try {
        const response = await axios({
            url,
            method: options.method || 'GET',
            headers: {
                'Server-Key': serverKey,
                'Content-Type': 'application/json',
                ...options.headers
            },
            data: options.data,
            params: options.params,
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            if (error.response.status === 429) {
                const retryAfter = error.response.data.retry_after || 5;
                logger.warn(`ERLC API Rate Limited. Retrying in ${retryAfter}s...`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return request(endpoint, options, version);
            }
            if (error.response.status === 403) {
                logger.error('ERLC API Unauthorized. Invalid Server-Key.');
                throw new Error('Invalid Server-Key. Please check /config.');
            }
            throw new Error(`ERLC API Error: ${error.response.data.message || error.response.statusText}`);
        }
        throw new Error(`ERLC API Connection Error: ${error.message}`);
    }
}

// V2 Endpoints (Recommended)
const erlc = {
    // Combined status fetch
    getServerFull: (params = {}) => request('/server', { 
        params: {
            Players: true,
            Staff: true,
            JoinLogs: true,
            Queue: true,
            KillLogs: true,
            CommandLogs: true,
            Vehicles: true,
            ...params
        }
    }),

    getServerInfo: () => request('/server'),
    
    getPlayers: async () => {
        const data = await request('/server', { params: { Players: true } });
        return data.Players || [];
    },

    sendCommand: (command) => request('/server/command', {
        method: 'POST',
        data: { command }
    }),

    // Roblox Lookups
    getRobloxUsername: async (id) => {
        try {
            const res = await axios.get(`https://users.roblox.com/v1/users/${id}`);
            return res.data.displayName || res.data.name;
        } catch (_) { return id; }
    },

    // Legacy V1 (if needed)
    getBans: () => request('/server/bans', {}, 'v1'),
};

module.exports = erlc;
