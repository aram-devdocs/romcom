/**
 * WebSocket Signaling Server
 *
 * Handles:
 * - WebSocket connections for signaling
 * - SDP offer/answer exchange with Pion WebRTC server
 * - ICE candidate relay
 * - Control commands (play/pause/restart)
 * - State broadcasting to clients
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server as HttpServer } from 'http';

import {
  type ClientMessage,
  type ServerMessage,
  type EmulatorState,
  type ServerWelcomeMessage,
  type ServerStateChangeMessage,
  type ServerAnswerMessage,
  type ServerIceCandidateMessage,
  type ServerErrorMessage,
  type ServerPongMessage,
  type WebRTCOfferRequest,
  type WebRTCOfferResponse,
  type SDPOffer,
  type ICECandidate,
  type Command,
  isClientMessage,
  generateClientId,
  ErrorCodes,
} from '@n64-stream/shared';

import { createLogger } from './logger.js';
import type { EmulatorManager } from './emulator.js';

const logger = createLogger('signaling');

interface ClientConnection {
  id: string;
  ws: WebSocket;
  sessionId: string | null;
}

export interface SignalingServerConfig {
  server: HttpServer;
  emulatorManager: EmulatorManager;
  pionUrl: string;
  stunServer: string;
}

export class SignalingServer {
  private wss: WebSocketServer;
  private clients = new Map<string, ClientConnection>();
  private emulatorManager: EmulatorManager;
  private pionUrl: string;
  private stunServer: string;

  constructor(config: SignalingServerConfig) {
    this.emulatorManager = config.emulatorManager;
    this.pionUrl = config.pionUrl;
    this.stunServer = config.stunServer;

    // Create WebSocket server attached to HTTP server
    this.wss = new WebSocketServer({
      server: config.server,
      path: '/ws',
    });

    this.setupWebSocketServer();

    logger.info({ path: '/ws' }, 'WebSocket signaling server initialized');
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = generateClientId();

      const client: ClientConnection = {
        id: clientId,
        ws,
        sessionId: null,
      };

      this.clients.set(clientId, client);
      logger.info({ clientId }, 'Client connected');

      // Send welcome message with current state
      this.sendWelcome(client);

      // Handle messages
      ws.on('message', (data: RawData) => {
        void this.handleMessage(client, data);
      });

      // Handle close
      ws.on('close', () => {
        logger.info({ clientId }, 'Client disconnected');
        this.clients.delete(clientId);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error({ clientId, error: error.message }, 'WebSocket error');
      });
    });

    this.wss.on('error', (error) => {
      logger.error({ error: error.message }, 'WebSocket server error');
    });
  }

  /**
   * Send welcome message to newly connected client
   */
  private sendWelcome(client: ClientConnection): void {
    const message: ServerWelcomeMessage = {
      type: 'welcome',
      payload: {
        clientId: client.id,
        state: this.emulatorManager.getState(),
        stunServer: this.stunServer,
      },
    };

    this.send(client, message);
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(client: ClientConnection, data: RawData): Promise<void> {
    try {
      // Convert RawData to string - handle Buffer, ArrayBuffer, and Buffer[]
      let messageStr: string;
      if (Buffer.isBuffer(data)) {
        messageStr = data.toString('utf8');
      } else if (Array.isArray(data)) {
        messageStr = Buffer.concat(data).toString('utf8');
      } else {
        messageStr = Buffer.from(data).toString('utf8');
      }
      const parsed: unknown = JSON.parse(messageStr);

      if (!isClientMessage(parsed)) {
        this.sendError(client, ErrorCodes.INVALID_MESSAGE, 'Invalid message format');
        return;
      }

      const message: ClientMessage = parsed;

      switch (message.type) {
        case 'offer':
          await this.handleOffer(client, message.payload);
          break;

        case 'ice-candidate':
          await this.handleIceCandidate(client, message.payload);
          break;

        case 'command':
          await this.handleCommand(client, message.payload);
          break;

        case 'ping':
          this.handlePing(client, message.payload.timestamp);
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ clientId: client.id, error: msg }, 'Error handling message');
      this.sendError(client, ErrorCodes.INVALID_MESSAGE, msg);
    }
  }

  /**
   * Handle SDP offer from client
   */
  private async handleOffer(
    client: ClientConnection,
    offer: SDPOffer
  ): Promise<void> {
    logger.info({ clientId: client.id }, 'Received SDP offer');

    try {
      // Forward offer to Pion WebRTC server
      const request: WebRTCOfferRequest = {
        sdp: offer.sdp,
        clientId: client.id,
      };

      const response = await fetch(`${this.pionUrl}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Pion server error: ${String(response.status)}`);
      }

      const answer = (await response.json()) as WebRTCOfferResponse;
      client.sessionId = answer.sessionId;

      const message: ServerAnswerMessage = {
        type: 'answer',
        payload: {
          type: 'answer',
          sdp: answer.sdp,
        },
      };

      this.send(client, message);
      logger.info({ clientId: client.id, sessionId: answer.sessionId }, 'Sent SDP answer');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ clientId: client.id, error: msg }, 'Failed to handle offer');
      this.sendError(client, ErrorCodes.WEBRTC_ERROR, msg);
    }
  }

  /**
   * Handle ICE candidate from client
   */
  private async handleIceCandidate(
    client: ClientConnection,
    candidate: ICECandidate
  ): Promise<void> {
    if (!client.sessionId) {
      logger.warn({ clientId: client.id }, 'ICE candidate received before session');
      return;
    }

    try {
      // Forward ICE candidate to Pion server
      await fetch(`${this.pionUrl}/ice-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: client.sessionId,
          candidate,
        }),
      });

      logger.debug({ clientId: client.id }, 'Forwarded ICE candidate');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ clientId: client.id, error: msg }, 'Failed to forward ICE candidate');
    }
  }

  /**
   * Handle control command from client
   */
  private async handleCommand(
    client: ClientConnection,
    command: Command
  ): Promise<void> {
    logger.info({ clientId: client.id, action: command.action }, 'Received command');

    try {
      switch (command.action) {
        case 'play':
          await this.emulatorManager.play();
          break;

        case 'pause':
          await this.emulatorManager.pause();
          break;

        case 'restart':
          await this.emulatorManager.restart();
          break;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ clientId: client.id, error: msg }, 'Command failed');
      this.sendError(client, ErrorCodes.COMMAND_FAILED, msg);
    }
  }

  /**
   * Handle ping message
   */
  private handlePing(client: ClientConnection, timestamp: number): void {
    const message: ServerPongMessage = {
      type: 'pong',
      payload: {
        timestamp,
        serverTime: Date.now(),
      },
    };
    this.send(client, message);
  }

  /**
   * Send message to client
   */
  private send(client: ClientConnection, message: ServerMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message to client
   */
  private sendError(client: ClientConnection, code: string, message: string): void {
    const errorMessage: ServerErrorMessage = {
      type: 'error',
      payload: { code, message },
    };
    this.send(client, errorMessage);
  }

  /**
   * Broadcast state change to all connected clients
   */
  broadcastState(state: EmulatorState): void {
    const message: ServerStateChangeMessage = {
      type: 'state-change',
      payload: state,
    };

    const messageStr = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    }

    logger.debug({ status: state.status, clients: this.clients.size }, 'Broadcast state change');
  }

  /**
   * Broadcast ICE candidate to a specific client
   */
  sendIceCandidate(
    clientId: string,
    candidate: ServerIceCandidateMessage['payload']
  ): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const message: ServerIceCandidateMessage = {
      type: 'ice-candidate',
      payload: candidate,
    };

    this.send(client, message);
  }

  /**
   * Get number of connected clients
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
