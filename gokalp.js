"use strict";
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
const WebSocket = require('ws');
const tls = require('tls');
const fs = require('fs');

const config = {
    token: "",
    serverid: "1393195630683357204"
};

const guilds = new Map();
const ownGuildVanities = new Set();
let mfa = null;
let lastSeq = null;
let hbInterval = null;
const tlsConnections = [];
let index = 0;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Authorization': config.token,
    'Host': 'canary.discord.com',
    'Connection': 'keep-alive',
    'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRmlyZWZveCIsImRldmljZSI6IiIsInN5c3RlbV9sb2NhbGUiOiJ0ci1UUiIsImJyb3dzZXJfdXNlcl9hZ2VudCI6Ik1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQ7IHJ2OjEzMy4wKSBHZWNrby8yMDEwMDEwMSBGaXJlZm94LzEzMy4wIiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTMzLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6Imh0dHBzOi8vd3d3Lmdvb2dsZS5jb20vIiwicmVmZXJyaW5nX2RvbWFpbiI6Ind3dy5nb29nbGUuY29tIiwic2VhcmNoX2VuZ2luZSI6Imdvb2dsZSIsInJlZmVycmVyX2N1cnJlbnQiOiIiLCJyZWZlcnJpbmdfZG9tYWluX2N1cnJlbnQiOiIiLCJyZWxlYXNlX2NoYW5uZWwiOiJjYW5hcnkiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjozNTYxNDAsImNsaWVudF9ldmVudF9zb3VyY2UiOm51bGwsImhhc19jbGllbnRfbW9kcyI6ZmFsc2V9'
};

function createSocket(id) {
    return new Promise((resolve) => {
        const socket = tls.connect({
            host: 'canary.discord.com',
            port: 443,
            ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305',
            secureProtocol: 'TLSv1_2_method',
            rejectUnauthorized: false
        });
        socket.setKeepAlive(true, 0);
        socket.setNoDelay(true);
        socket.setTimeout(0);
        socket.id = id;
        socket.ready = false;
        
        socket.on('secureConnect', () => {
            socket.ready = true;
            resolve(socket);
        });
        
        socket.on('close', () => {
            socket.ready = false;
            setTimeout(() => createSocket(id).then(s => tlsConnections[id] = s), 100);
        });
        
        socket.on('error', () => {
            socket.ready = false;
            setTimeout(() => createSocket(id).then(s => tlsConnections[id] = s), 100);
        });
    });
}

function initSockets() {
    for (let i = 0; i < 7; i++) {
        createSocket(i).then(socket => tlsConnections[i] = socket);
    }
}

function request(method, path, customHeaders = {}, body = null) {
    const socket = tlsConnections[index];
    index = (index + 1) % tlsConnections.length;
    
    return new Promise((resolve, reject) => {
        if (!socket || !socket.ready) {
            return reject(new Error('Socket not ready'));
        }
        
        const h = { ...headers, ...customHeaders };
        if (body) h['Content-Length'] = Buffer.byteLength(body);
        
        let req = `${method} ${path} HTTP/1.1\r\n`;
        Object.entries(h).forEach(([k, v]) => req += `${k}: ${v}\r\n`);
        req += '\r\n' + (body || '');
        
        let rawResponse = '';
        let done = false;
        
        const onData = (chunk) => {
            if (done) return;
            rawResponse += chunk.toString();
            if (rawResponse.includes('\r\n\r\n')) {
                const parts = rawResponse.split('\r\n\r\n');
                let bodyPart = parts.slice(1).join('\r\n\r\n');
                done = true;
                socket.removeListener('data', onData);
                resolve(bodyPart);
            }
        };
        
        socket.on('data', onData);
        socket.write(req);
    });
}

function ultrafastrequest(method, path, customHeaders = {}, body = null) {
    const socket = tlsConnections[index];
    index = (index + 1) % tlsConnections.length;
    
    return new Promise((resolve, reject) => {
        if (!socket || !socket.ready) {
            return reject(new Error('Socket not ready'));
        }
        
        const h = { ...headers, ...customHeaders };
        if (body) h['Content-Length'] = Buffer.byteLength(body);
        
        let req = `${method} ${path} HTTP/1.1\r\n`;
        Object.entries(h).forEach(([k, v]) => req += `${k}: ${v}\r\n`);
        req += '\r\n' + (body || '');
        
        let rawResponse = '';
        let done = false;
        
        const timeout = setTimeout(() => {
            if (!done) {
                done = true;
                socket.removeListener('data', onData);
                reject(new Error('Timeout'));
            }
        }, 500);
        
        const onData = (chunk) => {
            if (done) return;
            rawResponse += chunk.toString();
            if (rawResponse.includes('\r\n\r\n')) {
                const parts = rawResponse.split('\r\n\r\n');
                let bodyPart = parts.slice(1).join('\r\n\r\n');
                done = true;
                clearTimeout(timeout);
                socket.removeListener('data', onData);
                resolve(bodyPart);
            }
        };
        
        socket.on('data', onData);
        socket.write(req);
    });
}

function readMfaToken() {
    try {
        if (fs.existsSync('./mfa_token.json')) {
            const data = JSON.parse(fs.readFileSync('./mfa_token.json', 'utf8'));
            if (data.token && data.token !== mfa) {
                mfa = data.token;
                console.log('mfa gecildi');
            }
        }
    } catch {}
}

function instantSnipe(url) {
    if (!mfa) return;
    
    const payload = JSON.stringify({ code: url });
    const snipeHeaders = {
        'X-Discord-MFA-Authorization': mfa,
        'Content-Type': 'application/json'
    };
    
    // 8 paralel istek oluştur
    const requests = Array.from({ length: 6 }, () =>
        ultrafastrequest('PATCH', `/api/v7/guilds/${config.serverid}/vanity-url`, snipeHeaders, payload)
            .then(res => {
                try {
                    const data = JSON.parse(res);
                    if (data.code === url) {
                        console.log(`✓ Başarılı: ${url}`);
                        return { success: true, data, url };
                    }
                } catch {}
                throw new Error('Başarısız istek');
            })
    );
    
    // İlk tamamlanan isteği kontrol et (Promise.race)
    Promise.race(requests)
        .then(result => {
            // İlk istek başarılı ise bitir
            console.log(`✓ Başarılı: ${url}`);
        })
        .catch(() => {
            // İlk istek başarısız ise Promise.any ile devam et
            Promise.any(requests)
                .then(result => {
                    console.log(`✓ Başarılı: ${url}`);
                })
                .catch(error => {
                    // Tüm istekler başarısız
                });
        });
}

function connectWS() {
    const ws = new WebSocket('wss://gateway-us-east1-b.discord.gg/?v=9&encoding=json');
    
    ws.on('open', () => {
        ws.send(JSON.stringify({
            op: 2,
            d: {
                token: config.token,
                intents: 1,
                properties: {
                    $os: "linux",
                    $browser: "",
                    $device: ""
                }
            }
        }));
    });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.s) lastSeq = msg.s;
            
            if (msg.op === 10) {
                clearInterval(hbInterval);
                hbInterval = setInterval(() => {
                    if (ws.readyState === 1) {
                        ws.send(JSON.stringify({ op: 1, d: lastSeq }));
                    }
                }, msg.d.heartbeat_interval * 0.4);
            }
            
            if (msg.op === 0) {
                if (msg.t === 'READY') {
                    msg.d.guilds.filter(g => g.vanity_url_code).forEach(g => {
                        guilds.set(g.id, g.vanity_url_code);
                        if (g.owner_id === msg.d.user.id || (g.permissions && (parseInt(g.permissions) & 8) === 8)) {
                            ownGuildVanities.add(g.vanity_url_code);
                        }
                        console.log(`Tracked: ${g.vanity_url_code}`);
                    });
                }
                
                if (msg.t === 'GUILD_UPDATE') {
                    const stored = guilds.get(msg.d.id);
                    if (stored && (stored !== msg.d.vanity_url_code || (!msg.d.vanity_url_code && ownGuildVanities.has(stored)))) {
                        console.log(` Sniping: ${stored}`);
                        instantSnipe(stored);
                    }
                    
                    if (msg.d.vanity_url_code) {
                        guilds.set(msg.d.id, msg.d.vanity_url_code);
                    }
                }
            }
        } catch {}
    });
    
    ws.on('close', () => {
        clearInterval(hbInterval);
        setTimeout(connectWS, 300);
    });
    
    ws.on('error', () => ws.close());
}

function init() {
    initSockets();
    
    readMfaToken();
    if (fs.existsSync('./mfa_token.json')) {
        fs.watchFile('./mfa_token.json', { interval: 50 }, readMfaToken);
    }
    setInterval(readMfaToken, 100);
    
    for (let i = 0; i < 3; i++) {
        setTimeout(() => connectWS(), i * 30);
    }
}

setTimeout(init, 100);

process.on('SIGINT', () => {
    tlsConnections.forEach(s => s.destroy());
    process.exit(0);
});
