/**
 * Emulator Process Manager
 *
 * Manages the mupen64plus emulator process:
 * - Spawns headless emulator
 * - Captures raw video frames
 * - Handles play/pause/restart commands
 * - Manages save states for instant restart
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

import {
  type EmulatorState,
  type EmulatorStatus,
  extractRomName,
} from '@n64-stream/shared';

import { createLogger } from './logger.js';

const logger = createLogger('emulator');

export interface EmulatorConfig {
  romPath: string;
  pluginPath: string;
  savestatePath: string;
  videoWidth: number;
  videoHeight: number;
}

interface EmulatorEvents {
  frame: (data: Buffer) => void;
  stateChange: (state: EmulatorState) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

export class EmulatorManager extends EventEmitter {
  private config: EmulatorConfig;
  private process: ChildProcess | null = null;
  private status: EmulatorStatus = 'idle';
  private frameCount = 0;
  private startTime: number | null = null;
  private romName: string;
  private initialSaveStatePath: string;

  constructor(config: EmulatorConfig) {
    super();
    this.config = config;
    this.romName = extractRomName(config.romPath);
    this.initialSaveStatePath = path.join(config.savestatePath, 'initial.savestate');
  }

  // Type-safe event emitter methods
  override emit<K extends keyof EmulatorEvents>(
    event: K,
    ...args: Parameters<EmulatorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof EmulatorEvents>(
    event: K,
    listener: EmulatorEvents[K]
  ): this {
    return super.on(event, listener);
  }

  /**
   * Get current emulator state
   */
  getState(): EmulatorState {
    const uptime = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
    const fps = uptime > 0 ? this.frameCount / uptime : 0;

    return {
      status: this.status,
      romName: this.romName,
      romPath: this.config.romPath,
      frameCount: this.frameCount,
      fps: Math.round(fps * 10) / 10,
      uptime: Math.round(uptime),
    };
  }

  /**
   * Start the emulator process
   */
  async start(): Promise<void> {
    if (this.process) {
      logger.warn('Emulator already running');
      return;
    }

    // Verify ROM exists
    try {
      await fs.access(this.config.romPath);
    } catch {
      throw new Error(`ROM not found: ${this.config.romPath}`);
    }

    // Ensure savestate directory exists
    await fs.mkdir(this.config.savestatePath, { recursive: true });

    this.setStatus('loading');

    logger.info({ romPath: this.config.romPath }, 'Starting emulator');

    // Build mupen64plus command
    // Using a video plugin that outputs raw frames to stdout
    const args = this.buildMupenArgs();

    logger.debug({ args }, 'Emulator command');

    try {
      this.process = spawn('mupen64plus', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Set plugin path
          MUPEN64PLUS_PLUGIN_PATH: this.config.pluginPath,
        },
      });

      this.setupProcessHandlers();
      this.startTime = Date.now();
      this.frameCount = 0;

      // Wait a bit for the emulator to initialize, then create initial savestate
      setTimeout(() => {
        void this.createInitialSaveState();
      }, 2000);

      this.setStatus('playing');
    } catch (error) {
      this.setStatus('error');
      throw error;
    }
  }

  /**
   * Build mupen64plus command line arguments
   */
  private buildMupenArgs(): string[] {
    return [
      '--nogui',
      '--nosaveoptions',
      // Video plugin - ideally one that outputs raw frames
      // In practice, you'd use a custom plugin or Xvfb
      '--gfx', 'mupen64plus-video-rice',
      // Dummy audio (no sound for now)
      '--audio', 'dummy',
      // Dummy input (no controller input for MVP)
      '--input', 'dummy',
      // RSP plugin
      '--rsp', 'mupen64plus-rsp-hle',
      // Resolution
      '--resolution', `${String(this.config.videoWidth)}x${String(this.config.videoHeight)}`,
      // ROM path
      this.config.romPath,
    ];
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Handle stdout (frame data in raw video mode)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.frameCount++;
      this.emit('frame', data);
    });

    // Handle stderr (logging/errors)
    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        logger.debug({ output: message }, 'Emulator stderr');
      }
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      logger.info({ code }, 'Emulator process exited');
      this.process = null;
      this.setStatus('idle');
      this.emit('exit', code);
    });

    // Handle process error
    this.process.on('error', (error) => {
      logger.error({ error: error.message }, 'Emulator process error');
      this.setStatus('error');
      this.emit('error', error);
    });
  }

  /**
   * Create initial save state for restart functionality
   */
  private async createInitialSaveState(): Promise<void> {
    if (!this.process || this.status !== 'playing') return;

    try {
      // Send save state command to mupen64plus
      // This depends on the control interface being available
      logger.info('Creating initial save state for restart');
      await this.sendCommand('save_state', this.initialSaveStatePath);
    } catch (error) {
      logger.warn({ error }, 'Failed to create initial save state');
    }
  }

  /**
   * Send a command to the emulator process
   */
  private async sendCommand(command: string, arg?: string): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error('Emulator process not running');
    }

    const cmd = arg ? `${command} ${arg}\n` : `${command}\n`;
    
    return new Promise((resolve, reject) => {
      this.process?.stdin?.write(cmd, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Pause emulation
   */
  async pause(): Promise<void> {
    if (this.status !== 'playing') {
      logger.warn({ status: this.status }, 'Cannot pause - not playing');
      return;
    }

    try {
      await this.sendCommand('pause');
      this.setStatus('paused');
      logger.info('Emulator paused');
    } catch (error) {
      logger.error({ error }, 'Failed to pause emulator');
      throw error;
    }
  }

  /**
   * Resume emulation
   */
  async play(): Promise<void> {
    if (this.status === 'idle') {
      // Start fresh if not running
      await this.start();
      return;
    }

    if (this.status !== 'paused') {
      logger.warn({ status: this.status }, 'Cannot resume - not paused');
      return;
    }

    try {
      await this.sendCommand('resume');
      this.setStatus('playing');
      logger.info('Emulator resumed');
    } catch (error) {
      logger.error({ error }, 'Failed to resume emulator');
      throw error;
    }
  }

  /**
   * Restart from beginning
   */
  async restart(): Promise<void> {
    logger.info('Restarting emulator');

    try {
      // Try to load initial save state
      try {
        await fs.access(this.initialSaveStatePath);
        await this.sendCommand('load_state', this.initialSaveStatePath);
        this.frameCount = 0;
        this.startTime = Date.now();
        this.setStatus('playing');
        logger.info('Loaded initial save state');
        return;
      } catch {
        // Save state doesn't exist, restart process
      }

      // Stop and restart the process
      await this.stop();
      await this.start();
    } catch (error) {
      logger.error({ error }, 'Failed to restart emulator');
      throw error;
    }
  }

  /**
   * Stop the emulator
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    logger.info('Stopping emulator');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Force killing emulator process');
        this.process?.kill('SIGKILL');
      }, 5000);

      this.process?.once('exit', () => {
        clearTimeout(timeout);
        this.process = null;
        this.setStatus('idle');
        resolve();
      });

      this.process?.kill('SIGTERM');
    });
  }

  /**
   * Update status and emit state change
   */
  private setStatus(status: EmulatorStatus): void {
    if (this.status === status) return;

    this.status = status;
    this.emit('stateChange', this.getState());
  }
}
