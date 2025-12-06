/**
 * N64 Web Streaming MVP - Main Server Entry Point
 *
 * This server handles:
 * - Express HTTP server for API and static files
 * - WebSocket server for signaling and control commands
 * - Coordination between emulator, encoder, and WebRTC server
 */

import 'dotenv/config';
import express, { type Express, type Request, type Response } from 'express';
import { createServer, type Server as HttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { type StatusResponse, type HealthResponse } from '@n64-stream/shared';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { EmulatorManager } from './emulator.js';
import { EncoderPipeline } from './encoder.js';
import { SignalingServer } from './signaling.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('main');

function main(): void {
  // Load and validate configuration
  const config = loadConfig();

  logger.info({ config: { ...config, romPath: path.basename(config.romPath) } }, 'Starting N64 Stream Server');

  // Create Express app
  const app: Express = express();
  const server: HttpServer = createServer(app);

  // Middleware
  app.use(express.json());

  // Serve static files from web client (in production)
  const clientPath = path.join(__dirname, '../../../web/dist');
  app.use(express.static(clientPath));

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

  // Create signaling server (attaches to HTTP server)
  const signalingServer = new SignalingServer({
    server,
    emulatorManager,
    pionUrl: config.pionUrl,
    stunServer: config.stunServer,
  });

  // Connect emulator output to encoder input
  emulatorManager.on('frame', (frameData: Buffer) => {
    encoderPipeline.writeFrame(frameData);
  });

  emulatorManager.on('stateChange', (state) => {
    signalingServer.broadcastState(state);
  });

  // Error handling
  emulatorManager.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'Emulator error');
  });

  encoderPipeline.on('error', (error: Error) => {
    logger.error({ error: error.message }, 'Encoder error');
  });

  // API Routes
  app.get('/api/health', (_req: Request, res: Response) => {
    const response: HealthResponse = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    res.json(response);
  });

  app.get('/api/status', (_req: Request, res: Response) => {
    const emulatorState = emulatorManager.getState();
    const response: StatusResponse = {
      emulator: emulatorState,
      encoder: {
        running: encoderPipeline.isRunning(),
        framesEncoded: encoderPipeline.getFrameCount(),
      },
      connections: signalingServer.getConnectionCount(),
    };
    res.json(response);
  });

  // Fallback to index.html for SPA routing
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });

  // Graceful shutdown
  async function shutdown(signal: string): Promise<void> {
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

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Start server
  server.listen(config.port, config.host, () => {
    logger.info(`Server listening on http://${config.host}:${String(config.port)}`);

    // Start emulator and encoder pipeline
    emulatorManager
      .start()
      .then(() => {
        encoderPipeline.start();
        logger.info('Emulator and encoder pipeline started');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: message }, 'Failed to start emulator');
        // Continue running - emulator can be retried
      });
  });
}

// Run the main function
try {
  main();
} catch (error: unknown) {
  console.error('Fatal error:', error);
  process.exit(1);
}
