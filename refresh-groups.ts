/**
 * Trigger group metadata refresh from WhatsApp.
 * Usage: npx tsx refresh-groups.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');

// Create IPC directory structure
const groupIpcDir = path.join(DATA_DIR, 'ipc', 'main');
fs.mkdirSync(groupIpcDir, { recursive: true });
fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });

// Create the refresh_groups task file
const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const taskPath = path.join(groupIpcDir, 'tasks', `${taskId}.json`);

// First sync groups metadata from WhatsApp
console.log('Connecting to WhatsApp to fetch group metadata...');

import makeWASocket, { useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const authDir = path.join(STORE_DIR, 'auth');
const dbPath = path.join(STORE_DIR, 'messages.db');

if (!fs.existsSync(authDir)) {
  console.error('ERROR: No WhatsApp auth found');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// Get all WhatsApp groups
const rows = db.prepare(
  `SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid <> '__group_sync__' ORDER BY last_message_time DESC`
).all() as Array<{ jid: string; name: string }>;

console.log(`Found ${rows.length} groups in database:`);
rows.forEach(r => console.log(`  - ${r.jid}: ${r.name}`));

// Now connect to WhatsApp and fetch metadata for all groups
async function syncFromWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Check if we need to fetch all groups or just sync
  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Chrome'),
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      sock.end(undefined);
      reject(new Error('Timeout'));
    }, 45000);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        try {
          const groups = await sock.groupFetchAllParticipating();
          console.log(`\nFetched ${Object.keys(groups).length} groups from WhatsApp`);

          const now = new Date().toISOString();
          for (const [jid, metadata] of Object.entries(groups)) {
            if (metadata.subject) {
              // Update the DB
              db.prepare(
                'INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name'
              ).run(jid, metadata.subject, now);
            }
          }

          // List all groups after sync
          const updatedRows = db.prepare(
            `SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid <> '__group_sync__' ORDER BY last_message_time DESC`
          ).all() as Array<{ jid: string; name: string }>;

          console.log(`\nTotal groups in database after sync: ${updatedRows.length}`);
          updatedRows.forEach(r => console.log(`  - ${r.jid}: ${r.name}`));

          // Create the refresh_groups task file for IPC
          const task = {
            type: 'refresh_groups',
            timestamp: now,
          };

          fs.writeFileSync(
            path.join(groupIpcDir, 'tasks', `refresh-${Date.now()}.json`),
            JSON.stringify(task, null, 2)
          );

          console.log('\nRefresh task created via IPC');

          clearTimeout(timeout);
          sock.end(undefined);
          db.close();
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          sock.end(undefined);
          reject(err);
        }
      } else if (update.connection === 'close') {
        clearTimeout(timeout);
        reject(new Error('Connection closed'));
      }
    });
  });
}

syncFromWhatsApp()
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
