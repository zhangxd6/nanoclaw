#!/usr/bin/env tsx

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

const logger = pino({ level: 'silent' });
const authDir = path.join('store', 'auth');
const dbPath = path.join('store', 'messages.db');

if (!fs.existsSync(authDir)) {
  console.error('NO_AUTH');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error('NO_DB');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Get existing groups from DB
const existingGroups = db.prepare("SELECT jid, name FROM chats WHERE jid LIKE '%g.us' AND jid != '__group_sync__'").all() as Array<{ jid: string; name: string }>;

console.log('=== Existing Groups in Database ===');
existingGroups.forEach(g => console.log(`${g.jid} | ${g.name}`));
console.log('');

const upsert = db.prepare(
  'INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name'
);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGroups() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    console.log('Creating WhatsApp socket...');
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
    });

    let connected = false;
    let groupsFetched = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        connected = true;
        console.log('Connected to WhatsApp!');

        // Small delay to ensure connection is stable
        await sleep(2000);

        try {
          console.log('Fetching all groups...');
          const groups = await sock.groupFetchAllParticipating();
          const now = new Date().toISOString();

          console.log('');
          console.log('=== All WhatsApp Groups ===');

          for (const [jid, metadata] of Object.entries(groups)) {
            if (metadata.subject) {
              upsert.run(jid, metadata.subject, now);
              console.log(`${jid} | ${metadata.subject}`);
            }
          }

          // Re-query to show updated list
          console.log('');
          console.log('=== Groups in Database After Sync ===');
          const updated = db.prepare("SELECT jid, name FROM chats WHERE jid LIKE '%g.us' AND jid != '__group_sync__'").all() as Array<{ jid: string; name: string }>;
          updated.forEach(g => console.log(`${g.jid} | ${g.name}`));

        } catch (err: any) {
          console.error('FETCH_ERROR:', err.message);
        }

        sock.end(undefined);
        db.close();
        process.exit(0);

      } else if (update.connection === 'close') {
        console.error('CONNECTION_CLOSED');
        db.close();
        process.exit(1);
      }
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (!connected) {
        console.error('TIMEOUT - No connection established');
        db.close();
        process.exit(1);
      }
    }, 60000);

  } catch (err: any) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

fetchGroups();
