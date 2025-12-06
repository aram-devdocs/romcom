/**
 * FFmpeg Encoding Pipeline
 *
 * Handles video encoding:
 * - Receives raw video frames from emulator
 * - Encodes to H.264 with low-latency settings
 * - Outputs RTP stream for WebRTC ingestion
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

import { createLogger } from './logger.js';

const logger = createLogger('encoder');

export interface EncoderConfig {
  width: number;
  height: number;
  framerate: number;
  bitrate: string;
  rtpHost: string;
  rtpPort: number;
}

interface EncoderEvents {
  started: () => void;
  stopped: () => void;
  error: (error: Error) => void;
}

export class EncoderPipeline extends EventEmitter {
  private config: EncoderConfig;
  private process: ChildProcess | null = null;
  private running = false;
  private frameCount = 0;
  private inputStream: Readable | null = null;

  constructor(config: EncoderConfig) {
    super();
    this.config = config;
  }

  // Type-safe event emitter methods
  override emit<K extends keyof EncoderEvents>(
    event: K,
    ...args: Parameters<EncoderEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof EncoderEvents>(
    event: K,
    listener: EncoderEvents[K]
  ): this {
    return super.on(event, listener);
  }

  /**
   * Check if encoder is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get number of frames encoded
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Start the FFmpeg encoding pipeline
   */
  start(): void {
    if (this.process) {
      logger.warn('Encoder already running');
      return;
    }

    logger.info(
      {
        resolution: `${String(this.config.width)}x${String(this.config.height)}`,
        framerate: this.config.framerate,
        bitrate: this.config.bitrate,
        rtpDest: `${this.config.rtpHost}:${String(this.config.rtpPort)}`,
      },
      'Starting FFmpeg encoder'
    );

    // Create input stream for piping frames
    this.inputStream = new Readable({
      read(): void {
        // No-op - we push data manually
      },
    });

    // Build FFmpeg arguments
    const args = this.buildFFmpegArgs();
    logger.debug({ args }, 'FFmpeg command');

    try {
      this.process = spawn('ffmpeg', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe input stream to FFmpeg stdin
      if (this.process.stdin) {
        this.inputStream.pipe(this.process.stdin);
      }

      this.setupProcessHandlers();
      this.running = true;
      this.frameCount = 0;
      this.emit('started');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ error: err.message }, 'Failed to start FFmpeg');
      this.emit('error', err);
    }
  }

  /**
   * Build FFmpeg command line arguments for low-latency H.264 encoding
   */
  private buildFFmpegArgs(): string[] {
    const { width, height, framerate, bitrate, rtpHost, rtpPort } = this.config;

    const bitrateNum = parseInt(bitrate, 10);
    const maxrate = String(Math.round(bitrateNum * 1.25));
    const bufsize = String(Math.round(bitrateNum * 0.5));
    const keyframeInterval = String(Math.round(framerate / 2));

    return [
      // Input settings
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${String(width)}x${String(height)}`,
      '-framerate', String(framerate),
      '-i', 'pipe:0',

      // H.264 encoding with low-latency settings
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.1',

      // Bitrate settings
      '-b:v', bitrate,
      '-maxrate', `${maxrate}M`,
      '-bufsize', `${bufsize}M`,

      // Keyframe settings (every 0.5 seconds)
      '-g', keyframeInterval,
      '-keyint_min', keyframeInterval,

      // Reduce frame reordering delay
      '-bf', '0',
      '-refs', '1',

      // Suppress banner
      '-hide_banner',
      '-loglevel', 'warning',

      // Output to RTP
      '-f', 'rtp',
      `rtp://${rtpHost}:${String(rtpPort)}`,
    ];
  }

  /**
   * Set up FFmpeg process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Handle stdout (SDP info, etc.)
    this.process.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        logger.debug({ output }, 'FFmpeg stdout');
      }
    });

    // Handle stderr (progress and errors)
    this.process.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output) {
        // Check for actual errors vs progress output
        if (output.includes('Error') || output.includes('error')) {
          logger.error({ output }, 'FFmpeg error');
        } else {
          logger.debug({ output }, 'FFmpeg stderr');
        }
      }
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      logger.info({ code }, 'FFmpeg process exited');
      this.running = false;
      this.process = null;
      this.inputStream = null;
      this.emit('stopped');
    });

    // Handle process error
    this.process.on('error', (error) => {
      logger.error({ error: error.message }, 'FFmpeg process error');
      this.running = false;
      this.emit('error', error);
    });

    // Handle stdin errors (broken pipe, etc.)
    this.process.stdin?.on('error', (error) => {
      // Ignore EPIPE errors when stopping
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
        logger.error({ error: error.message }, 'FFmpeg stdin error');
      }
    });
  }

  /**
   * Write a raw video frame to the encoder
   */
  writeFrame(frameData: Buffer): void {
    if (!this.running || !this.inputStream) {
      return;
    }

    // Validate frame size
    const expectedSize = this.config.width * this.config.height * 4; // RGBA = 4 bytes per pixel
    if (frameData.length !== expectedSize) {
      logger.warn(
        {
          expected: expectedSize,
          received: frameData.length,
        },
        'Unexpected frame size'
      );
      return;
    }

    try {
      this.inputStream.push(frameData);
      this.frameCount++;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ error: err.message }, 'Failed to write frame');
    }
  }

  /**
   * Stop the encoder pipeline
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    logger.info('Stopping FFmpeg encoder');

    // End the input stream
    if (this.inputStream) {
      this.inputStream.push(null);
    }

    // Give FFmpeg time to flush, then kill
    setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGTERM');
      }
    }, 1000);
  }
}
