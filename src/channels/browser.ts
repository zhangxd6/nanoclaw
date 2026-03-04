import { logger } from '../logger.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';
import { browserSessionManager } from '../browser-sessions.js';

/**
 * Browser Channel for NanoClaw
 *
 * This channel allows browsers to connect and interact with NanoClaw groups.
 * Each browser connects via WebSocket and can link to any registered group.
 *
 * Message flow:
 * Browser -> Gateway (WebSocket) -> SQLite -> Message Loop -> Container
 * Container output -> IPC watcher -> Browser (via WebSocket push)
 */
export interface BrowserChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class BrowserChannel implements Channel {
  name = 'browser';

  private opts: BrowserChannelOpts;

  constructor(opts: BrowserChannelOpts) {
    this.opts = opts;
  }

  /**
   * Register browser session with the manager
   */
  registerBrowser(ws: import('ws').WebSocket, browserId: string): void {
    browserSessionManager.registerConnection(ws, browserId);
  }

  /**
   * Link browser to a group
   */
  linkBrowserToGroup(
    browserId: string,
    groupFolder: string,
    channelJid: string,
  ): void {
    browserSessionManager.linkToGroup(browserId, groupFolder, channelJid);
  }

  /**
   * Get browser session for a group
   */
  getBrowserForGroup(groupFolder: string): import('ws').WebSocket | undefined {
    const session = browserSessionManager.getSessionForGroup(groupFolder);
    return session?.socket;
  }

  /**
   * Send message to browser (if connected for this group)
   */
  async sendMessageToBrowser(
    groupFolder: string,
    text: string,
  ): Promise<boolean> {
    const browserId = browserSessionManager.getBrowserForGroup(groupFolder);
    if (browserId) {
      const session = browserSessionManager.getSession(browserId);
      if (
        session &&
        session.socket.readyState === (await import('ws')).WebSocket.OPEN
      ) {
        try {
          session.socket.send(
            JSON.stringify({
              type: 'message',
              content: text,
              timestamp: new Date().toISOString(),
              fromAgent: true,
            }),
          );
          return true;
        } catch (err) {
          logger.error(
            { groupFolder, browserId, err },
            'Failed to send to browser',
          );
        }
      }
    }
    return false;
  }

  /**
   * Get all linked browser sessions for groups
   */
  getLinkedBrowsers(): Record<string, string> {
    return browserSessionManager.getGroupSessions();
  }

  async connect(): Promise<void> {
    // Browser channel doesn't need to start a server here
    // The gateway server is started separately in src/browser-gateway.ts
    logger.info('Browser channel initialized');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // Find browser linked to this jid's group
    let groupFolder = 'main';

    if (jid.startsWith('browser_')) {
      groupFolder = jid.replace(/^browser_/, '');
    } else if (jid.startsWith('tg:')) {
      groupFolder = `telegram_${jid.replace(/^tg:/, '')}`;
    } else if (jid.includes('@')) {
      const domain = jid.split('@')[1];
      if (domain === 'g.us') {
        groupFolder = `whatsapp_${jid.split('@')[0]}`;
      }
    }

    // Try to send to browser
    const sent = await this.sendMessageToBrowser(groupFolder, text);
    if (!sent) {
      logger.debug(
        { jid, groupFolder },
        'No browser connected for group, skipping outbound message',
      );
    }
  }

  isConnected(): boolean {
    return true; // Browser channel is always "connected" when running
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('browser_');
  }

  async disconnect(): Promise<void> {
    // Cleanup handled by gateway server
  }

  async setTyping?(jid: string, isTyping: boolean): Promise<void> {
    // Optional typing indicator - not implemented for browser yet
  }
}
