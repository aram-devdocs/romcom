/**
 * WebSocket Signaling Server
 * 
 * Handles:
 * - WebRTC signaling (SDP offer/answer, ICE candidates)
 * - Control commands (play, pause, restart)
 * - State broadcasting to connected clients
 */

import { createLogger } from './logger.js';

const logger = createLogger('signaling');

/**
 * Message types for client-server communication
 */
const MessageType = {
  // Client -> Server
  OFFER: 'offer',
  ICE_CANDIDATE: 'ice-candidate',
  COMMAND: 'command',
  
  // Server -> Client
  ANSWER: 'answer',
  STATE_CHANGE: 'state-change',
  ERROR: 'error',
};

export class SignalingServer {
  constructor({ wss, emulatorManager, encoderPipeline, pionUrl }) {
    this.wss = wss;
    this.emulatorManager = emulatorManager;
    this.encoderPipeline = encoderPipeline;
    this.pionUrl = pionUrl;
    this.clients = new Map();
    this.clientIdCounter = 0;
    
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = ++this.clientIdCounter;
      const clientInfo = {
        id: clientId,
        ws,
        ip: req.socket.remoteAddress,
        connectedAt: new Date(),
        peerConnection: null,
      };
      
      this.clients.set(clientId, clientInfo);
      logger.info('Client connected', { clientId, ip: clientInfo.ip });
      
      // Send initial state
      this.sendToClient(ws, {
        type: MessageType.STATE_CHANGE,
        payload: this.emulatorManager.getState(),
      });
      
      ws.on('message', (data) => {
        this.handleMessage(clientInfo, data);
      });
      
      ws.on('close', () => {
        logger.info('Client disconnected', { clientId });
        this.clients.delete(clientId);
      });
      
      ws.on('error', (error) => {
        logger.error('WebSocket error', { clientId, error: error.message });
      });
    });
  }

  async handleMessage(clientInfo, data) {
    try {
      const message = JSON.parse(data.toString());
      logger.debug('Received message', { clientId: clientInfo.id, type: message.type });
      
      switch (message.type) {
        case MessageType.OFFER:
          await this.handleOffer(clientInfo, message.payload);
          break;
          
        case MessageType.ICE_CANDIDATE:
          await this.handleIceCandidate(clientInfo, message.payload);
          break;
          
        case MessageType.COMMAND:
          await this.handleCommand(clientInfo, message.payload);
          break;
          
        default:
          logger.warn('Unknown message type', { type: message.type });
      }
    } catch (error) {
      logger.error('Error handling message', { error: error.message });
      this.sendToClient(clientInfo.ws, {
        type: MessageType.ERROR,
        payload: { message: 'Failed to process message' },
      });
    }
  }

  async handleOffer(clientInfo, offer) {
    try {
      logger.info('Processing SDP offer', { clientId: clientInfo.id });
      
      // Forward offer to Pion WebRTC server and get answer
      const response = await fetch(`${this.pionUrl}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientInfo.id.toString(),
          offer: offer,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Pion server error: ${response.status}`);
      }
      
      const { answer } = await response.json();
      
      this.sendToClient(clientInfo.ws, {
        type: MessageType.ANSWER,
        payload: answer,
      });
      
      logger.info('SDP answer sent', { clientId: clientInfo.id });
    } catch (error) {
      logger.error('Failed to handle offer', { error: error.message });
      this.sendToClient(clientInfo.ws, {
        type: MessageType.ERROR,
        payload: { message: 'Failed to establish WebRTC connection' },
      });
    }
  }

  async handleIceCandidate(clientInfo, candidate) {
    try {
      logger.debug('Processing ICE candidate', { clientId: clientInfo.id });
      
      // Forward ICE candidate to Pion server
      await fetch(`${this.pionUrl}/ice-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientInfo.id.toString(),
          candidate: candidate,
        }),
      });
    } catch (error) {
      logger.error('Failed to handle ICE candidate', { error: error.message });
    }
  }

  async handleCommand(clientInfo, command) {
    const { action } = command;
    logger.info('Processing command', { clientId: clientInfo.id, action });
    
    try {
      switch (action) {
        case 'play':
          await this.emulatorManager.resume();
          break;
          
        case 'pause':
          await this.emulatorManager.pause();
          break;
          
        case 'restart':
          await this.emulatorManager.restart();
          break;
          
        default:
          logger.warn('Unknown command', { action });
          return;
      }
      
      // Broadcast new state to all clients
      this.broadcastState(this.emulatorManager.getState());
    } catch (error) {
      logger.error('Command execution failed', { action, error: error.message });
      this.sendToClient(clientInfo.ws, {
        type: MessageType.ERROR,
        payload: { message: `Failed to execute ${action}` },
      });
    }
  }

  sendToClient(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcastState(state) {
    const message = JSON.stringify({
      type: MessageType.STATE_CHANGE,
      payload: state,
    });
    
    for (const client of this.clients.values()) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(message);
      }
    }
  }

  getConnectionCount() {
    return this.clients.size;
  }

  closeAll() {
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
  }
}
