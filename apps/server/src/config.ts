/**
 * Configuration loading and validation
 */

import { z } from 'zod';
import {
  type ServerConfig,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_STUN_SERVER,
  DEFAULT_VIDEO_WIDTH,
  DEFAULT_VIDEO_HEIGHT,
  DEFAULT_VIDEO_FRAMERATE,
  DEFAULT_VIDEO_BITRATE,
  DEFAULT_PION_HTTP_PORT,
  DEFAULT_PION_RTP_PORT,
} from '@n64-stream/shared';

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(DEFAULT_PORT),
  host: z.string().default(DEFAULT_HOST),
  romPath: z.string().min(1, 'ROM_PATH is required'),
  mupenPluginPath: z.string().default('/usr/lib/mupen64plus'),
  pionUrl: z.string().url().default(`http://localhost:${String(DEFAULT_PION_HTTP_PORT)}`),
  pionRtpHost: z.string().default('localhost'),
  pionRtpPort: z.coerce.number().int().positive().default(DEFAULT_PION_RTP_PORT),
  savestatePath: z.string().default('./savestates'),
  stunServer: z.string().default(DEFAULT_STUN_SERVER),
  videoWidth: z.coerce.number().int().positive().default(DEFAULT_VIDEO_WIDTH),
  videoHeight: z.coerce.number().int().positive().default(DEFAULT_VIDEO_HEIGHT),
  videoFramerate: z.coerce.number().int().positive().default(DEFAULT_VIDEO_FRAMERATE),
  videoBitrate: z.string().default(DEFAULT_VIDEO_BITRATE),
  logLevel: z.string().default('info'),
});

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): ServerConfig {
  const result = configSchema.safeParse({
    port: process.env['PORT'],
    host: process.env['HOST'],
    romPath: process.env['ROM_PATH'],
    mupenPluginPath: process.env['MUPEN_PLUGIN_PATH'],
    pionUrl: process.env['PION_URL'],
    pionRtpHost: process.env['PION_RTP_HOST'],
    pionRtpPort: process.env['PION_RTP_PORT'],
    savestatePath: process.env['SAVESTATE_PATH'],
    stunServer: process.env['STUN_SERVER'],
    videoWidth: process.env['VIDEO_WIDTH'],
    videoHeight: process.env['VIDEO_HEIGHT'],
    videoFramerate: process.env['VIDEO_FRAMERATE'],
    videoBitrate: process.env['VIDEO_BITRATE'],
    logLevel: process.env['LOG_LEVEL'],
  });

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}
