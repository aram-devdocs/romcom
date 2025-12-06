/**
 * Shared type definitions for N64 Stream
 */

// ============================================================================
// Emulator State Types
// ============================================================================

export type EmulatorStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface EmulatorState {
  status: EmulatorStatus;
  romName: string;
  romPath: string;
  frameCount: number;
  fps: number;
  uptime: number; // seconds since start
}

// ============================================================================
// WebSocket Message Types - Client to Server
// ============================================================================

export type ClientMessageType = 'offer' | 'ice-candidate' | 'command' | 'ping';

export interface SDPOffer {
  type: 'offer';
  sdp: string;
}

export interface ICECandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

export type CommandAction = 'play' | 'pause' | 'restart';

export interface Command {
  action: CommandAction;
}

export interface ClientOfferMessage {
  type: 'offer';
  payload: SDPOffer;
}

export interface ClientIceCandidateMessage {
  type: 'ice-candidate';
  payload: ICECandidate;
}

export interface ClientCommandMessage {
  type: 'command';
  payload: Command;
}

export interface ClientPingMessage {
  type: 'ping';
  payload: { timestamp: number };
}

export type ClientMessage =
  | ClientOfferMessage
  | ClientIceCandidateMessage
  | ClientCommandMessage
  | ClientPingMessage;

// ============================================================================
// WebSocket Message Types - Server to Client
// ============================================================================

export type ServerMessageType =
  | 'answer'
  | 'ice-candidate'
  | 'state-change'
  | 'error'
  | 'pong'
  | 'welcome';

export interface SDPAnswer {
  type: 'answer';
  sdp: string;
}

export interface ServerAnswerMessage {
  type: 'answer';
  payload: SDPAnswer;
}

export interface ServerIceCandidateMessage {
  type: 'ice-candidate';
  payload: ICECandidate;
}

export interface ServerStateChangeMessage {
  type: 'state-change';
  payload: EmulatorState;
}

export interface ErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

export interface ServerErrorMessage {
  type: 'error';
  payload: ErrorInfo;
}

export interface ServerPongMessage {
  type: 'pong';
  payload: { timestamp: number; serverTime: number };
}

export interface ServerWelcomeMessage {
  type: 'welcome';
  payload: {
    clientId: string;
    state: EmulatorState;
    stunServer: string;
  };
}

export type ServerMessage =
  | ServerAnswerMessage
  | ServerIceCandidateMessage
  | ServerStateChangeMessage
  | ServerErrorMessage
  | ServerPongMessage
  | ServerWelcomeMessage;

// ============================================================================
// API Types
// ============================================================================

export interface HealthResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
}

export interface StatusResponse {
  emulator: EmulatorState;
  encoder: {
    running: boolean;
    framesEncoded: number;
  };
  connections: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ServerConfig {
  port: number;
  host: string;
  romPath: string;
  mupenPluginPath: string;
  pionUrl: string;
  pionRtpHost: string;
  pionRtpPort: number;
  savestatePath: string;
  stunServer: string;
  videoWidth: number;
  videoHeight: number;
  videoFramerate: number;
  videoBitrate: string;
  logLevel: string;
}

export interface VideoConfig {
  width: number;
  height: number;
  framerate: number;
  bitrate: string;
}

// ============================================================================
// WebRTC Signaling Types (for Pion server)
// ============================================================================

export interface WebRTCOfferRequest {
  sdp: string;
  clientId: string;
}

export interface WebRTCOfferResponse {
  sdp: string;
  sessionId: string;
}

export interface WebRTCIceCandidateRequest {
  sessionId: string;
  candidate: ICECandidate;
}
