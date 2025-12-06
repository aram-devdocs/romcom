/**
 * N64 Web Streaming MVP - Main Server Entry Point
 * 
 * This server handles:
 * - Express HTTP server for API and static files
 * - WebSocket server for signaling and control commands
 * - Coordination between emulator, encoder, and WebRTC server
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { EmulatorManager } from './emulator.js';
import { EncoderPipeline } from './encoder.js';
import { SignalingServer } from './signaling.js';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('main');

// Configuration from environment
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  romPath: process.env.ROM_PATH || '/roms/game.z64',
  mupenPluginPath: process.env.MUPEN_PLUGIN_PATH || '/usr/lib/mupen64plus',
  pionUrl: process.env.PION_URL || 'http://localhost:8080',
  pionRtpHost: process.env.PION_RTP_HOST || 'localhost',
  pionRtpPort: parseInt(process.env.PION_RTP_PORT || '5004', 10),
  savestatePath: process.env.SAVESTATE_PATH || '/savestates',
  videoWidth: parseInt(process.env.VIDEO_WIDTH || '640', 10),
  videoHeight: parseInt(process.env.VIDEO_HEIGHT || '480', 10),
  videoFramerate: parseInt(process.env.VIDEO_FRAMERATE || '60', 10),
  videoBitrate: process.env.VIDEO_BITRATE || '2M',
};

logger.info('Starting N64 Stream Server', { config: { ...config, romPath: path.basename(config.romPath) } });

// Create Express app
const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());

// Serve static files from client directory
const clientPath = path.join(__dirname, '../../client');
app.use(express.static(clientPath));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Emulator status endpoint
app.get('/api/status', (req, res) => {
  const emulatorState = emulatorManager.getState();
  res.json({
    emulator: emulatorState,
    encoder: encoderPipeline.isRunning(),
    connections: signalingServer.getConnectionCount()
  });
});

// Initialize components
const emulatorManager = new EmulatorManager({
  romPath: config.romPath,
  pluginPath: config.mupenPluginPath,
  savestatePath: config.savestatePath,
  videoWidth: config.videoWidth,
  videoHeight: config.videoHeight,
});

const encoderPipeline = new EncoderPipeline({
  width: config.videoWidth,
  height: config.videoHeight,
  framerate: config.videoFramerate,
  bitrate: config.videoBitrate,
  rtpHost: config.pionRtpHost,
  rtpPort: config.pionRtpPort,
});

// WebSocket server for signaling
const wss = new WebSocketServer({ server, path: '/ws' });

const signalingServer = new SignalingServer({
  wss,
  emulatorManager,
  encoderPipeline,
  pionUrl: config.pionUrl,
});

// Connect emulator output to encoder input
emulatorManager.on('frame', (frameData) => {
  encoderPipeline.writeFrame(frameData);
});

emulatorManager.on('stateChange', (state) => {
  signalingServer.broadcastState(state);
});

// Error handling
emulatorManager.on('error', (error) => {
  logger.error('Emulator error', { error: error.message });
});

encoderPipeline.on('error', (error) => {
  logger.error('Encoder error', { error: error.message });
});

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  signalingServer.closeAll();
  await emulatorManager.stop();
  encoderPipeline.stop();
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
server.listen(config.port, config.host, async () => {
  logger.info(`Server listening on http://${config.host}:${config.port}`);
  
  // Start emulator and encoder pipeline
  try {
    await emulatorManager.start();
    encoderPipeline.start();
    logger.info('Emulator and encoder pipeline started');
  } catch (error) {
    logger.error('Failed to start emulator', { error: error.message });
    // Continue running - emulator can be retried
  }
});

export { app, server };
