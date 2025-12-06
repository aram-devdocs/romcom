import type { EmulatorStatus } from '@n64-stream/shared';
import { formatDuration } from '@n64-stream/shared';
import './StatusBar.css';

interface StatusBarProps {
  gameName: string;
  status: EmulatorStatus;
  fps: number;
  uptime: number;
  connected: boolean;
}

function getStatusLabel(status: EmulatorStatus): string {
  const labels: Record<EmulatorStatus, string> = {
    idle: 'Idle',
    loading: 'Loading...',
    playing: 'Playing',
    paused: 'Paused',
    error: 'Error',
  };
  return labels[status];
}

function getStatusClass(status: EmulatorStatus): string {
  const classes: Record<EmulatorStatus, string> = {
    idle: 'status-idle',
    loading: 'status-loading',
    playing: 'status-playing',
    paused: 'status-paused',
    error: 'status-error',
  };
  return classes[status];
}

export function StatusBar({
  gameName,
  status,
  fps,
  uptime,
  connected,
}: StatusBarProps): React.JSX.Element {
  return (
    <div className="status-bar">
      <div className="status-item game-name">
        <span className="status-label">Game:</span>
        <span className="status-value">{gameName}</span>
      </div>

      <div className="status-divider" />

      <div className={`status-item status-indicator ${getStatusClass(status)}`}>
        <span className="status-dot" />
        <span className="status-value">{getStatusLabel(status)}</span>
      </div>

      <div className="status-divider" />

      <div className="status-item">
        <span className="status-label">FPS:</span>
        <span className="status-value">{fps.toFixed(1)}</span>
      </div>

      <div className="status-divider" />

      <div className="status-item">
        <span className="status-label">Uptime:</span>
        <span className="status-value">{formatDuration(uptime)}</span>
      </div>

      <div className="status-divider" />

      <div className={`status-item connection-status ${connected ? 'connected' : 'disconnected'}`}>
        <span className="connection-dot" />
        <span className="status-value">{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </div>
  );
}
