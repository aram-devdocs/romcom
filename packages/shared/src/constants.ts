/**
 * Shared constants for N64 Stream
 */

// Default video settings
export const DEFAULT_VIDEO_WIDTH = 640;
export const DEFAULT_VIDEO_HEIGHT = 480;
export const DEFAULT_VIDEO_FRAMERATE = 60;
export const DEFAULT_VIDEO_BITRATE = '2M';

// Default server settings
export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_STUN_SERVER = 'stun:stun.l.google.com:19302';

// WebRTC settings
export const DEFAULT_PION_HTTP_PORT = 8080;
export const DEFAULT_PION_RTP_PORT = 5004;

// Reconnection settings
export const WS_RECONNECT_INTERVAL_MS = 1000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const WS_PING_INTERVAL_MS = 30000;

// Error codes
export const ErrorCodes = {
  EMULATOR_NOT_STARTED: 'EMULATOR_NOT_STARTED',
  EMULATOR_CRASHED: 'EMULATOR_CRASHED',
  ROM_NOT_FOUND: 'ROM_NOT_FOUND',
  ENCODER_ERROR: 'ENCODER_ERROR',
  WEBRTC_ERROR: 'WEBRTC_ERROR',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  COMMAND_FAILED: 'COMMAND_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
