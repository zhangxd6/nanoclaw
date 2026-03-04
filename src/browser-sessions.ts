/**
 * Browser Session Management
 *
 * Manages browser sessions and their mappings to NanoClaw groups.
 * Browsers can link to any registered group and receive real-time updates.
 */

import { WebSocket } from 'ws';

import {
  storeMessageDirect,
  setSession,
  getSession,
  getAllSessions,
} from './db.js';
import { logger } from './logger.js';

export interface BrowserSession {
  sessionId: string;
  browserId: string;
  groupFolder?: string; // If connected to a specific group
  channelJid?: string; // The JID for this session (e.g., "main" or group jid)
  connectedAt: number;
  lastActive: number;
  socket: WebSocket;
}

export class BrowserSessionManager {
  private sessions = new Map<string, BrowserSession>(); // browserId -> session
  private groupToBrowser = new Map<string, string>(); // groupFolder -> browserId

  constructor() {}

  /**
   * Register a new browser connection
   */
  registerConnection(socket: WebSocket, browserId: string): BrowserSession {
    const session: BrowserSession = {
      sessionId: `browser_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      browserId,
      connectedAt: Date.now(),
      lastActive: Date.now(),
      socket,
    };

    this.sessions.set(browserId, session);
    logger.info({ browserId }, 'Browser connection registered');
    return session;
  }

  /**
   * Disconnect a browser session
   */
  disconnect(browserId: string): void {
    const session = this.sessions.get(browserId);
    if (session) {
      // Remove group mapping if any
      if (session.groupFolder) {
        this.groupToBrowser.delete(session.groupFolder);
      }
      this.sessions.delete(browserId);
      logger.info({ browserId }, 'Browser session disconnected');
    }
  }

  /**
   * Link a browser session to a group
   */
  linkToGroup(
    browserId: string,
    groupFolder: string,
    channelJid: string,
  ): void {
    const session = this.sessions.get(browserId);
    if (session) {
      // If was linked to another group, remove old mapping
      if (session.groupFolder && session.groupFolder !== groupFolder) {
        this.groupToBrowser.delete(session.groupFolder);
      }
      session.groupFolder = groupFolder;
      session.channelJid = channelJid;
      this.groupToBrowser.set(groupFolder, browserId);
      logger.info({ browserId, groupFolder }, 'Browser session linked to group');
    }
  }

  /**
   * Get browser session by ID
   */
  getSession(browserId: string): BrowserSession | undefined {
    const session = this.sessions.get(browserId);
    if (session) {
      session.lastActive = Date.now();
    }
    return session;
  }

  /**
   * Get browser session for a group (if any)
   */
  getSessionForGroup(groupFolder: string): BrowserSession | undefined {
    const browserId = this.groupToBrowser.get(groupFolder);
    if (browserId) {
      return this.getSession(browserId);
    }
    return undefined;
  }

  /**
   * Get all active browser sessions
   */
  getAllSessions(): BrowserSession[] {
    const now = Date.now();
    // Clean up stale sessions (inactive for 30 minutes)
    const STALE_THRESHOLD = 30 * 60 * 1000;

    for (const [browserId, session] of this.sessions.entries()) {
      if (now - session.lastActive > STALE_THRESHOLD) {
        logger.debug({ browserId }, 'Removing stale browser session');
        this.sessions.delete(browserId);
        if (session.groupFolder) {
          this.groupToBrowser.delete(session.groupFolder);
        }
      }
    }

    return Array.from(this.sessions.values());
  }

  /**
   * Get the browser ID linked to a group (or undefined if not linked)
   */
  getBrowserForGroup(groupFolder: string): string | undefined {
    return this.groupToBrowser.get(groupFolder);
  }

  /**
   * Send message to a specific browser session
   */
  sendMessageToBrowser(browserId: string, message: Record<string, unknown>): boolean {
    const session = this.getSession(browserId);
    if (session && session.socket.readyState === WebSocket.OPEN) {
      try {
        session.socket.send(JSON.stringify(message));
        return true;
      } catch (err) {
        logger.error({ browserId, err }, 'Failed to send message to browser');
        this.disconnect(browserId);
      }
    }
    return false;
  }

  /**
   * Broadcast message to all browser sessions
   */
  broadcast(message: Record<string, unknown>): void {
    const messageStr = JSON.stringify(message);
    for (const session of this.getAllSessions()) {
      if (session.socket.readyState === WebSocket.OPEN) {
        try {
          session.socket.send(messageStr);
        } catch (err) {
          logger.error({ browserId: session.browserId, err }, 'Failed to broadcast message');
        }
      }
    }
  }

  /**
   * Broadcast to all sessions linked to a specific group
   */
  broadcastToGroup(groupFolder: string, message: Record<string, unknown>): void {
    const browserId = this.groupToBrowser.get(groupFolder);
    if (browserId) {
      this.sendMessageToBrowser(browserId, message);
    }
  }

  /**
   * Get current sessions for all groups
   */
  getGroupSessions(): Record<string, string> {
    // Merge with database sessions
    const result: Record<string, string> = getAllSessions();

    for (const [groupFolder, browserId] of this.groupToBrowser.entries()) {
      const session = this.sessions.get(browserId);
      if (session) {
        result[groupFolder] = session.sessionId;
      }
    }

    return result;
  }
}

export const browserSessionManager = new BrowserSessionManager();

/**
 * Send message to browser if browser is connected for the group
 */
export function sendToBrowser(groupFolder: string, message: Record<string, unknown>): void {
  browserSessionManager.broadcastToGroup(groupFolder, message);
}

/**
 * Store message and notify browsers
 */
export function storeAndNotify(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
}): void {
  storeMessageDirect(msg);

  // Extract group folder from channel_jid
  const chatJid = msg.chat_jid;
  let groupFolder = 'main'; // Default

  if (chatJid.startsWith('tg:')) {
    groupFolder = `telegram_${chatJid.replace(/^tg:/, '')}`;
  } else if (chatJid.startsWith('dc:')) {
    groupFolder = `discord_${chatJid.replace(/^dc:/, '')}`;
  } else if (chatJid.includes('@')) {
    // WhatsApp format
    const domain = chatJid.split('@')[1];
    if (domain === 'g.us') {
      groupFolder = `whatsapp_${chatJid.split('@')[0]}`;
    } else {
      groupFolder = `whatsapp_dm_${chatJid.split('@')[0]}`;
    }
  }

  // Notify browser for this group
  sendToBrowser(groupFolder, {
    type: 'message',
    content: msg.content,
    sender: msg.sender_name,
    timestamp: msg.timestamp,
  });
}
