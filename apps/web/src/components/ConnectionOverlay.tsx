import './ConnectionOverlay.css';

interface ConnectionOverlayProps {
  message: string;
}

export function ConnectionOverlay({ message }: ConnectionOverlayProps): React.JSX.Element {
  return (
    <div className="connection-overlay">
      <div className="spinner" />
      <p className="overlay-message">{message}</p>
    </div>
  );
}
