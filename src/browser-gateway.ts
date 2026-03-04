/**
 * Browser Gateway Server for NanoClaw
 *
 * Provides HTTP and WebSocket interface for browser-based clients
 * to interact with NanoClaw groups.
 *
 * Architecture:
 * - Browsers connect via WebSocket
 * - Messages from browser are stored in SQLite (like other channels)
 * - Container output is streamed back to browsers
 * - Sessions are kept in sync across all channels
 *
 * Endpoints:
 * - GET  /health              - Health check
 * - GET  /groups              - List registered groups
 * - POST /api/message         - Send message to group
 * - GET  /ws                  - WebSocket for real-time messaging
 * - POST /api/session/link    - Link browser to group session
 */

import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

import {
  getAllRegisteredGroups,
  getAllSessions,
  setSession,
  getSession,
  storeMessageDirect,
} from './db.js';
import { getAvailableGroups } from './index.js';
import {
  ContainerOutput,
  runContainerAgent,
} from './container-runner.js';
import { browserSessionManager } from './browser-sessions.js';
import { logger } from './logger.js';

// Express app
const app = express();
app.use(express.json());

// Global session state for browser-to-group mapping
interface BrowserConnection {
  browserId: string;
  groupFolder?: string;
  channelJid?: string;
  socket: WebSocket;
}

let browserConnections = new Map<string, BrowserConnection>();
let nextBrowserId = 1;

// Container output handler - streams to browser
async function handleContainerOutput(
  groupFolder: string,
  output: ContainerOutput,
): Promise<void> {
  // Find browser connected to this group
  for (const [browserId, conn] of browserConnections.entries()) {
    if (
      conn.groupFolder === groupFolder &&
      conn.socket.readyState === WebSocket.OPEN
    ) {
      try {
        const message: any = { type: 'agent_output' };

        if (output.newSessionId) {
          // Update session in DB and notify
          setSession(groupFolder, output.newSessionId);
          message.sessionId = output.newSessionId;
          message.type = 'session_update';
        }

        if (output.result) {
          const raw =
            typeof output.result === 'string'
              ? output.result
              : JSON.stringify(output.result);
          // Strip internal blocks
          const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          message.content = text;
          message.timestamp = new Date().toISOString();

          if (output.status === 'success') {
            message.type = 'agent_message';
          } else if (output.status === 'error') {
            message.type = 'agent_error';
            message.error = output.error;
          }
        }

        conn.socket.send(JSON.stringify(message));
      } catch (err) {
        logger.error({ browserId, groupFolder, err }, 'Failed to stream output');
      }
    }
  }
}

/**
 * Process message for a group via direct container invocation
 * This is used when browser sends a message directly
 */
async function processGroupMessage(
  groupFolder: string,
  text: string,
  browserId: string,
): Promise<{ success: boolean; result?: string; sessionId?: string }> {
  const groups = getAllRegisteredGroups();
  const groupJid = Object.keys(groups).find(
    (jid) => groups[jid].folder === groupFolder,
  );

  if (!groupJid) {
    return { success: false, result: `Group folder "${groupFolder}" not found` };
  }

  const group = groups[groupJid];
  let sessionId = getSession(groupFolder);

  try {
    const prompt = text;
    const chatJid = `browser_${groupFolder}`;

    // Run container agent and capture output
    let result: string | null = null;
    let newSessionId: string | undefined;

    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder,
        chatJid,
        isMain: groupFolder === 'main',
        assistantName: undefined, // Will use config value
      },
      () => {}, // onProcess - not needed for direct call
      async (containerOutput) => {
        if (containerOutput.newSessionId) {
          newSessionId = containerOutput.newSessionId;
        }
        if (containerOutput.result) {
          const raw =
            typeof containerOutput.result === 'string'
              ? containerOutput.result
              : JSON.stringify(containerOutput.result);
          result = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        }
      },
    );

    if (output.status === 'error') {
      return { success: false, result: output.error };
    }

    if (newSessionId) {
      sessionId = newSessionId;
      setSession(groupFolder, newSessionId);
    }

    return {
      success: true,
      result: result ?? undefined,
      sessionId: newSessionId ?? undefined
    };
  } catch (err) {
    logger.error({ groupFolder, browserId, err }, 'Error processing message');
    return { success: false, result: String(err), sessionId: undefined };
  }
}

/**
 * Send notification to browser (if connected for this group)
 */
export function sendToBrowser(groupFolder: string, message: any): void {
  for (const [browserId, conn] of browserConnections.entries()) {
    if (
      conn.groupFolder === groupFolder &&
      conn.socket.readyState === WebSocket.OPEN
    ) {
      try {
        conn.socket.send(JSON.stringify(message));
      } catch (err) {
        logger.error({ browserId, groupFolder, err }, 'Failed to send to browser');
      }
    }
  }
}

/**
 * Handle browser message via WebSocket
 */
async function handleBrowserMessage(
  ws: WebSocket,
  browserId: string,
  data: WebSocket.RawData,
): Promise<void> {
  let msg: any;
  try {
    msg = JSON.parse(data.toString());
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Invalid JSON format',
      }),
    );
    return;
  }

  switch (msg.type) {
    case 'link': {
      const { groupFolder, channelJid } = msg;
      if (!groupFolder || !channelJid) {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing fields' }));
        return;
      }

      const groups = getAllRegisteredGroups();
      const foundJid = Object.keys(groups).find(
        (jid) => groups[jid].folder === groupFolder,
      );

      if (!foundJid) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: `Group "${groupFolder}" not registered`,
          }),
        );
        return;
      }

      const connection = browserConnections.get(browserId);
      if (connection) {
        connection.groupFolder = groupFolder;
        connection.channelJid = channelJid;
      }

      ws.send(
        JSON.stringify({
          type: 'linked',
          groupFolder,
          channelJid,
        }),
      );

      // Send current session
      const sessionId = getSession(groupFolder);
      ws.send(
        JSON.stringify({
          type: 'session_update',
          groupFolder,
          sessionId,
        }),
      );
      break;
    }

    case 'message': {
      const { content, groupFolder } = msg;

      if (!content) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'Missing content field',
          }),
        );
        return;
      }

      // Use provided groupFolder or linked one
      const targetGroup =
        groupFolder || browserConnections.get(browserId)?.groupFolder;

      if (!targetGroup) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'No group specified and not linked to a group',
          }),
        );
        return;
      }

      const result = await processGroupMessage(targetGroup, content, browserId);

      if (result.success) {
        ws.send(
          JSON.stringify({
            type: 'message_sent',
            content,
            groupFolder: targetGroup,
            timestamp: new Date().toISOString(),
          }),
        );

        if (result.result) {
          ws.send(
            JSON.stringify({
              type: 'agent_response',
              content: result.result,
              sessionId: result.sessionId,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      } else {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: result.result || 'Unknown error',
            groupFolder: targetGroup,
          }),
        );
      }
      break;
    }

    case 'list_groups': {
      const groups = getAvailableGroups();
      ws.send(
        JSON.stringify({
          type: 'groups_list',
          groups,
        }),
      );
      break;
    }

    case 'get_session': {
      const { groupFolder } = msg;
      if (!groupFolder) {
        ws.send(JSON.stringify({ type: 'error', error: 'Missing groupFolder' }));
        return;
      }
      const sessionId = getSession(groupFolder);
      ws.send(
        JSON.stringify({
          type: 'session_info',
          groupFolder,
          sessionId,
        }),
      );
      break;
    }

    default: {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${msg.type}`,
        }),
      );
    }
  }
}

/**
 * Initialize the browser gateway HTTP server
 */
export function initializeBrowserGateway(): { app: typeof app; server: Server } {
  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'browser-gateway',
      timestamp: new Date().toISOString(),
    });
  });

  // List registered groups
  app.get('/groups', (_req: Request, res: Response) => {
    const groups = getAvailableGroups();
    res.json({
      groups,
      timestamp: new Date().toISOString(),
    });
  });

  // Send message to group (HTTP API)
  app.post('/api/message', async (req: Request, res: Response) => {
    const { groupFolder, message } = req.body;

    if (!groupFolder || !message) {
      return res.status(400).json({
        error: 'Missing groupFolder or message',
      });
    }

    const result = await processGroupMessage(
      String(groupFolder),
      String(message),
      'http-client',
    );

    if (result.success) {
      res.json({
        success: true,
        result: result.result,
        sessionId: result.sessionId,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.result || 'Unknown error',
      });
    }
  });

  // Link browser to group session
  app.post('/api/session/link', (req: Request, res: Response) => {
    const { groupFolder } = req.body;

    if (!groupFolder) {
      return res.status(400).json({
        error: 'Missing groupFolder',
      });
    }

    const sessionId = getSession(groupFolder);
    res.json({
      success: true,
      groupFolder,
      sessionId,
    });
  });

  // Get session info for group
  app.get('/api/session/:groupFolder', (req: Request, res: Response) => {
    const groupFolder = Array.isArray(req.params.groupFolder)
      ? req.params.groupFolder[0]
      : req.params.groupFolder;
    const sessionId = getSession(groupFolder || '');
    res.json({
      success: true,
      groupFolder,
      sessionId,
    });
  });

  // Get all sessions
  app.get('/api/sessions', (_req: Request, res: Response) => {
    const sessions = getAllSessions();
    res.json({
      success: true,
      sessions,
    });
  });

  // WebSocket endpoint
  const server = app.listen(3001, () => {
    logger.info('Browser gateway listening on port 3001');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const browserId = `br_${nextBrowserId++}_${Date.now()}`;
    logger.info({ browserId }, 'Browser connected');

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'welcome',
        browserId,
        version: '1.0.0',
      }),
    );

    const connection: BrowserConnection = {
      browserId,
      socket: ws,
    };
    browserConnections.set(browserId, connection);

    ws.on('message', (data: WebSocket.RawData) => {
      handleBrowserMessage(ws, browserId, data).catch((err) => {
        logger.error({ browserId, err }, 'Error handling message');
      });
    });

    ws.on('close', () => {
      browserConnections.delete(browserId);
      logger.info({ browserId }, 'Browser disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ browserId, err }, 'WebSocket error');
    });
  });

  wss.on('error', (err) => {
    logger.error({ err }, 'WebSocket server error');
  });

  return { app, server };
}

/**
 * Start the browser gateway (called from main)
 */
export let browserGatewayServer: Server | null = null;

/**
 * Start the browser gateway
 */
export function startBrowserGateway(): Promise<void> {
  return new Promise((resolve) => {
    const { app, server } = initializeBrowserGateway();
    browserGatewayServer = server;
    resolve();
  });
}

// Expose session manager for other modules
export { browserSessionManager, handleContainerOutput };
