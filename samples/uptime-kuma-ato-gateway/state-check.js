#!/usr/bin/env node
// Check the running Uptime Kuma through the same Socket.IO connection the UI
// uses, after start.sh has started the server.
//
// Uptime Kuma's UI is a Socket.IO client: on connection it learns whether it has
// to log in. With disableAuth=true the server auto signs the socket in as the
// admin and emits "autoLogin" (server/server.js); with auth enabled it emits
// "loginRequired" instead. The settings are read with the UI's own "getSettings"
// event. If the socket is asked for a login, or the settings are not the ones
// this sample promises, the Run is in a state where the Ato gateway is not the
// only gate (or the state can grow without the retention limit), so this exits
// non-zero and start.sh stops the Run.
'use strict';

const { io } = require('/app/node_modules/socket.io-client');

const PORT = process.env.PORT || '3001';
const KEEP_DAYS = parseInt(process.env.KUMA_KEEP_DAYS || '3', 10);
const EXPECTED = {
  disableAuth: true,
  keepDataPeriodDays: KEEP_DAYS,
  checkUpdate: false,
};

let finished = false;
function finish(code, message) {
  if (finished) return;
  finished = true;
  if (message) {
    if (code === 0) console.log('uptime-kuma: ' + message);
    else console.error('uptime-kuma: ' + message);
  }
  process.exit(code);
}

const startupTimer = setTimeout(() => {
  finish(1, 'the server did not answer through Socket.IO within 90 s');
}, 90_000);
startupTimer.unref();

const socket = io('http://127.0.0.1:' + PORT, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  timeout: 10000,
});

socket.on('autoLogin', () => {
  socket.emit('getSettings', (res) => {
    if (!res || res.ok !== true) {
      finish(1, 'getSettings through Socket.IO failed');
      return;
    }
    const data = res.data || {};
    for (const key of Object.keys(EXPECTED)) {
      if (data[key] !== EXPECTED[key]) {
        finish(
          1,
          'setting ' + key + ' is ' + JSON.stringify(data[key]) + ', expected ' + JSON.stringify(EXPECTED[key])
        );
        return;
      }
    }
    socket.disconnect();
    finish(0, 'serving with auth disabled, retention ' + KEEP_DAYS + ' days and the update check off');
  });
});

socket.on('loginRequired', () => {
  finish(1, 'the server asked for a login: disableAuth is not active, so the Ato gateway is not the only gate');
});

socket.on('connect_error', () => {
  // The server may still be migrating the database; reconnection keeps trying
  // until the startup timer above fires.
});
