/**
 * Shared utility functions for N64 Stream
 */

import { type ClientMessage, type ServerMessage } from './types/index.js';

/**
 * Type guard to check if a message is a valid ClientMessage
 */
export function isClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;

  if (typeof msg['type'] !== 'string') {
    return false;
  }

  const validTypes = ['offer', 'ice-candidate', 'command', 'ping'];
  return validTypes.includes(msg['type']);
}

/**
 * Type guard to check if a message is a valid ServerMessage
 */
export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const msg = data as Record<string, unknown>;

  if (typeof msg['type'] !== 'string') {
    return false;
  }

  const validTypes = ['answer', 'ice-candidate', 'state-change', 'error', 'pong', 'welcome'];
  return validTypes.includes(msg['type']);
}

/**
 * Safely parse JSON with type checking
 */
export function parseClientMessage(json: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (isClientMessage(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely parse server message from JSON
 */
export function parseServerMessage(json: string): ServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (isServerMessage(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a typed message serializer
 */
export function serializeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * Extract ROM name from path
 */
export function extractRomName(romPath: string): string {
  const filename = romPath.split('/').pop() ?? romPath;
  // Remove extension
  return filename.replace(/\.(z64|n64|v64)$/i, '');
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${String(hours)}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${String(minutes)}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Generate a unique client ID
 */
export function generateClientId(): string {
  return `client_${String(Date.now())}_${Math.random().toString(36).substring(2, 9)}`;
}
