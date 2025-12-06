import { useState, useEffect, useCallback } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { Controls } from './components/Controls';
import { StatusBar } from './components/StatusBar';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { useWebSocket } from './hooks/useWebSocket';
import { useWebRTC } from './hooks/useWebRTC';
import type { EmulatorState, CommandAction } from '@n64-stream/shared';
import './styles/App.css';

function App(): React.JSX.Element {
  const [emulatorState, setEmulatorState] = useState<EmulatorState | null>(null);
  const [stunServer, setStunServer] = useState<string>('stun:stun.l.google.com:19302');

  // WebSocket connection for signaling and control
  const {
    isConnected: wsConnected,
    clientId,
    sendCommand,
    sendOffer,
    sendIceCandidate,
    onAnswer,
    onIceCandidate,
    onStateChange,
    onWelcome,
  } = useWebSocket();

  // WebRTC connection for video
  const {
    isConnected: rtcConnected,
    stream,
    connect: connectRTC,
  } = useWebRTC({
    stunServer,
    onLocalOffer: sendOffer,
    onLocalIceCandidate: sendIceCandidate,
    onAnswer,
    onIceCandidate,
  });

  // Handle welcome message
  useEffect(() => {
    const unsubscribe = onWelcome((data) => {
      setEmulatorState(data.state);
      setStunServer(data.stunServer);
    });
    return unsubscribe;
  }, [onWelcome]);

  // Handle state changes
  useEffect(() => {
    const unsubscribe = onStateChange((state) => {
      setEmulatorState(state);
    });
    return unsubscribe;
  }, [onStateChange]);

  // Connect WebRTC when WebSocket is ready
  useEffect(() => {
    if (wsConnected && clientId) {
      void connectRTC();
    }
  }, [wsConnected, clientId, connectRTC]);

  // Handle control commands
  const handleCommand = useCallback(
    (action: CommandAction) => {
      sendCommand(action);
    },
    [sendCommand]
  );

  const isConnecting = !wsConnected || !rtcConnected;
  const connectionStatus = !wsConnected ? 'Connecting to server...' : 'Establishing video stream...';

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">N64 Stream</h1>
      </header>

      <main className="main">
        <div className="player-container">
          <VideoPlayer stream={stream} />
          {isConnecting && <ConnectionOverlay message={connectionStatus} />}
        </div>

        <Controls
          onPlay={() => { handleCommand('play'); }}
          onPause={() => { handleCommand('pause'); }}
          onRestart={() => { handleCommand('restart'); }}
          disabled={!wsConnected}
          status={emulatorState?.status ?? 'idle'}
        />

        <StatusBar
          gameName={emulatorState?.romName ?? 'Loading...'}
          status={emulatorState?.status ?? 'idle'}
          fps={emulatorState?.fps ?? 0}
          uptime={emulatorState?.uptime ?? 0}
          connected={wsConnected && rtcConnected}
        />
      </main>
    </div>
  );
}

export default App;
