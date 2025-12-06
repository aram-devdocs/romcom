import type { EmulatorStatus } from '@n64-stream/shared';
import './Controls.css';

interface ControlsProps {
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  disabled: boolean;
  status: EmulatorStatus;
}

export function Controls({
  onPlay,
  onPause,
  onRestart,
  disabled,
  status,
}: ControlsProps): React.JSX.Element {
  const isPlaying = status === 'playing';
  const isPaused = status === 'paused';
  const isLoading = status === 'loading';

  return (
    <div className="controls">
      <button
        className="control-button play"
        onClick={onPlay}
        disabled={disabled || isPlaying || isLoading}
        aria-label="Play"
        title="Play"
      >
        <span className="button-icon">▶</span>
        <span className="button-label">Play</span>
      </button>

      <button
        className="control-button pause"
        onClick={onPause}
        disabled={disabled || isPaused || isLoading}
        aria-label="Pause"
        title="Pause"
      >
        <span className="button-icon">⏸</span>
        <span className="button-label">Pause</span>
      </button>

      <button
        className="control-button restart"
        onClick={onRestart}
        disabled={disabled || isLoading}
        aria-label="Restart"
        title="Restart"
      >
        <span className="button-icon">↻</span>
        <span className="button-label">Restart</span>
      </button>
    </div>
  );
}
