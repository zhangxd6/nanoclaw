/**
 * Step: register — Write channel registration config, create group folders.
 * Replaces 06-register-channel.sh
 *
 * Fixes: SQL injection (parameterized queries), sed -i '' (uses fs directly).
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { isValidGroupFolder } from '../src/group-folder.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

interface RegisterArgs {
  jid: string;
  name: string;
  trigger: string;
  folder: string;
  requiresTrigger: boolean;
  assistantName: string;
  runner?: 'default' | 'dotnet' | 'python' | 'custom';
  containerImage?: string; // Custom container image override
}

function parseArgs(args: string[]): RegisterArgs {
  const result: RegisterArgs = {
    jid: '',
    name: '',
    trigger: '',
    folder: '',
    requiresTrigger: true,
    assistantName: 'Andy',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--jid':
        result.jid = args[++i] || '';
        break;
      case '--name':
        result.name = args[++i] || '';
        break;
      case '--trigger':
        result.trigger = args[++i] || '';
        break;
      case '--folder':
        result.folder = args[++i] || '';
        break;
      case '--no-trigger-required':
        result.requiresTrigger = false;
        break;
      case '--assistant-name':
        result.assistantName = args[++i] || 'Andy';
        break;
      case '--runner':
        result.runner = args[++i] as 'default' | 'dotnet' | 'python' | 'custom';
        break;
      case '--container-image':
        result.containerImage = args[++i] || '';
        break;
      case '--help':
        console.log(`
NanoClaw Group Registration

Usage: node dist/register.js [options]

Required Options:
  --jid <jid>              WhatsApp/Telegram group JID
  --name <name>            Display name for the group
  --trigger <pattern>      Trigger pattern (e.g., @Andy)
  --folder <folder>        Unique folder name for group storage

Options:
  --no-trigger-required    Group can be activated without trigger
  --assistant-name <name>  Assistant name (default: Andy)
  --runner <type>          Container runner type:
                             default   - Node.js agent (default)
                             dotnet    - .NET SDK agent
                             python    - Python agent
                             custom    - Custom runner (use --container-image)
  --container-image <img>  Use specific Docker image instead of runner type

Examples:
  # Default Node.js runner
  node dist/register.js --jid 1234@g.us --name "My Group" \\
    --trigger @Andy --folder mygroup

  # .NET runner
  node dist/register.js --jid 1234@g.us --name "My .NET Group" \\
    --trigger @Andy --folder dotnet-group --runner dotnet

  # Custom container image
  node dist/register.js --jid 1234@g.us --name "My Python Group" \\
    --trigger @Andy --folder pygroup --container-image my-python-image:tag
`);
        process.exit(0);
    }
  }

  return result;
}

export async function run(args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const parsed = parseArgs(args);

  // Trigger is required unless --no-trigger-required is passed
  const hasTrigger = parsed.trigger.length > 0 || !parsed.requiresTrigger;
  if (!parsed.jid || !parsed.name || !hasTrigger || !parsed.folder) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'missing_required_args',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  if (!isValidGroupFolder(parsed.folder)) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'invalid_folder',
      LOG: 'logs/setup.log',
    });
    process.exit(4);
  }

  logger.info(parsed, 'Registering channel');

  // Ensure data directory exists
  fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });

  // Write to SQLite using parameterized queries (no SQL injection)
  const dbPath = path.join(STORE_DIR, 'messages.db');
  const timestamp = new Date().toISOString();
  const requiresTriggerInt = parsed.requiresTrigger ? 1 : 0;

  const db = new Database(dbPath);
  // Ensure schema exists
  db.exec(`CREATE TABLE IF NOT EXISTS registered_groups (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL UNIQUE,
    trigger_pattern TEXT NOT NULL,
    added_at TEXT NOT NULL,
    container_config TEXT,
    requires_trigger INTEGER DEFAULT 1
  )`);

  // Build container_config JSON if runner or custom image is specified
  let containerConfig: string | null = null;
  const config: { runner?: string; containerImage?: string } = {};

  if (parsed.runner) {
    config.runner = parsed.runner;
  }

  if (parsed.containerImage) {
    config.containerImage = parsed.containerImage;
  }

  if (Object.keys(config).length > 0) {
    containerConfig = JSON.stringify(config);
  }

  db.prepare(
    `INSERT OR REPLACE INTO registered_groups
     (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    parsed.jid,
    parsed.name,
    parsed.folder,
    parsed.trigger,
    timestamp,
    containerConfig,
    requiresTriggerInt,
  );

  db.close();
  logger.info('Wrote registration to SQLite');

  // Create group folders
  fs.mkdirSync(path.join(projectRoot, 'groups', parsed.folder, 'logs'), {
    recursive: true,
  });

  // Update assistant name in CLAUDE.md files if different from default
  let nameUpdated = false;
  if (parsed.assistantName !== 'Andy') {
    logger.info(
      { from: 'Andy', to: parsed.assistantName },
      'Updating assistant name',
    );

    const mdFiles = [
      path.join(projectRoot, 'groups', 'global', 'CLAUDE.md'),
      path.join(projectRoot, 'groups', 'main', 'CLAUDE.md'),
    ];

    for (const mdFile of mdFiles) {
      if (fs.existsSync(mdFile)) {
        let content = fs.readFileSync(mdFile, 'utf-8');
        content = content.replace(/^# Andy$/m, `# ${parsed.assistantName}`);
        content = content.replace(
          /You are Andy/g,
          `You are ${parsed.assistantName}`,
        );
        fs.writeFileSync(mdFile, content);
        logger.info({ file: mdFile }, 'Updated CLAUDE.md');
      }
    }

    // Update .env
    const envFile = path.join(projectRoot, '.env');
    if (fs.existsSync(envFile)) {
      let envContent = fs.readFileSync(envFile, 'utf-8');
      if (envContent.includes('ASSISTANT_NAME=')) {
        envContent = envContent.replace(
          /^ASSISTANT_NAME=.*$/m,
          `ASSISTANT_NAME="${parsed.assistantName}"`,
        );
      } else {
        envContent += `\nASSISTANT_NAME="${parsed.assistantName}"`;
      }
      fs.writeFileSync(envFile, envContent);
    } else {
      fs.writeFileSync(envFile, `ASSISTANT_NAME="${parsed.assistantName}"\n`);
    }
    logger.info('Set ASSISTANT_NAME in .env');
    nameUpdated = true;
  }

  emitStatus('REGISTER_CHANNEL', {
    JID: parsed.jid,
    NAME: parsed.name,
    FOLDER: parsed.folder,
    TRIGGER: parsed.trigger,
    REQUIRES_TRIGGER: parsed.requiresTrigger,
    ASSISTANT_NAME: parsed.assistantName,
    RUNNER: parsed.runner || 'default',
    NAME_UPDATED: nameUpdated,
    STATUS: 'success',
    LOG: 'logs/setup.log',
  });
}
