#!/usr/bin/env node
// First-run initialization for Uptime Kuma 2.5.12, done non-interactively, plus
// the small set of settings this sample relies on. Run from start.sh on every
// start, before the server process.
//
// What the browser setup would otherwise do (read from the 2.5.12 sources):
//   - server/database.js (Database.connect) copies ./db/kuma.db to the data dir
//     on the first connection. That template has the schema and no rows.
//   - The first admin is created by the Socket.IO "setup" event
//     (server/server.js): username + bcrypt(10 rounds) password, inserted into
//     "user". server/server.js decides "needSetup" by counting that table.
// This script writes the same rows (one "user" row, bcrypt via the image's own
// bcryptjs) before the server starts, so the server never shows the setup page.
//
// It also stores (idempotently, on every start):
//   disableAuth=true        the app's own login is off. server/server.js reads it
//                           on every socket connection and auto signs in the
//                           first user, so the Ato gateway is the only gate.
//   keepDataPeriodDays=N    retention used by server/jobs/clear-old-data.js for
//                           the heartbeat and stat_daily tables; a small value
//                           keeps the 64 MiB filesystem-state checkpoint small.
//   checkUpdate=false       no periodic request to https://uptime.kuma.pet/version
//                           (the appliance must not talk to anything but the
//                           image pull and its own monitor targets).
//
// The admin_password Binding value is read from ATO_BINDING_ADMIN_PASSWORD and is
// never printed. Rotating it does not change an existing database: the account
// is only created once, and its login is not used while auth stays disabled.
'use strict';

const fs = require('fs');
const path = require('path');

const APP_DIR = '/app';
const DATA_DIR = (process.env.DATA_DIR || '/data/').replace(/\/+$/, '/');
const ADMIN_USER = process.env.KUMA_ADMIN_USER || 'admin';
const KEEP_DAYS = parseInt(process.env.KUMA_KEEP_DAYS || '3', 10);
const password = process.env.ATO_BINDING_ADMIN_PASSWORD || '';

function fatal(message) {
  console.error('uptime-kuma: ' + message);
  process.exit(1);
}

function loadModule(name) {
  // The image's production modules live in /app/node_modules; this script is in
  // the read-only workspace, so they are required by absolute path.
  return require(path.join(APP_DIR, 'node_modules', name));
}

const sqlite3 = loadModule('@louislam/sqlite3');

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READWRITE, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  if (!password) {
    fatal('missing ATO_BINDING_ADMIN_PASSWORD');
  }
  if (!(KEEP_DAYS >= 1)) {
    fatal('KUMA_KEEP_DAYS must be a positive number of days, got ' + process.env.KUMA_KEEP_DAYS);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 1. Pin SQLite. SetupDatabase (server/setup-database.js) shows the database
  //    choice page only when this file is missing and kuma.db is missing too;
  //    UPTIME_KUMA_DB_TYPE=sqlite in start.sh is the other half of the pin.
  const dbConfigPath = path.join(DATA_DIR, 'db-config.json');
  fs.writeFileSync(dbConfigPath, JSON.stringify({ type: 'sqlite' }, null, 4) + '\n');

  // 2. Copy the template exactly like Database.connect() would, so this script
  //    can seed rows before the server has ever connected.
  const dbPath = path.join(DATA_DIR, 'kuma.db');
  const templatePath = path.join(APP_DIR, 'db', 'kuma.db');
  if (!fs.existsSync(templatePath)) {
    fatal('missing the database template ' + templatePath);
  }
  if (!fs.existsSync(dbPath)) {
    fs.copyFileSync(templatePath, dbPath);
  }

  const db = await openDb(dbPath);
  try {
    const settingUpsert =
      'INSERT INTO setting (key, value, type) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type';

    // 3. The first admin, the same row the "setup" socket event would insert.
    const count = await get(db, 'SELECT COUNT(*) AS n FROM user');
    if (count.n === 0) {
      // check-password-strength is what the setup event checks; a value it calls
      // "Too weak" would be rejected there, so reject it here with a clear error
      // instead of starting an Instance that can never be set up.
      const { passwordStrength } = loadModule('check-password-strength');
      if (passwordStrength(password).value === 'Too weak') {
        fatal('the admin_password Binding is too weak for Uptime Kuma (it must not be "Too weak")');
      }
      const bcrypt = loadModule('bcryptjs');
      const hash = bcrypt.hashSync(password, 10);
      await run(db, 'INSERT INTO user (username, password, active) VALUES (?, ?, 1)', [ADMIN_USER, hash]);
      console.log('uptime-kuma: created the first admin "' + ADMIN_USER + '" (password not printed)');
    }

    // 4. The settings. disableAuth is written after the user exists so that the
    //    server's auto sign-in (R.findOne("user")) always has a user to sign in.
    await run(db, settingUpsert, ['disableAuth', JSON.stringify(true), 'general']);
    await run(db, settingUpsert, ['keepDataPeriodDays', JSON.stringify(KEEP_DAYS), 'general']);
    await run(db, settingUpsert, ['checkUpdate', JSON.stringify(false), 'general']);

    // 5. Leave the database in one file where possible: the server opens WAL, but
    //    this process is the last writer before it, so checkpoint the WAL away.
    try {
      await run(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {
      // Not in WAL mode yet (first run) - nothing to checkpoint.
    }
  } finally {
    await close(db);
  }

  console.log(
    'uptime-kuma: database ready (' + dbPath + '), auth disabled, retention ' + KEEP_DAYS + ' days, update check off'
  );
}

main().catch((e) => fatal(e && e.message ? e.message : String(e)));
