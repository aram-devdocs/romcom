import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ClientMessage,
  ServerMessage,
  EmulatorState,
  CommandAction,
  SDPOffer,
  ICECandidate,
  SDPAnswer,
  ServerWelcomeMessage,
} from '@n64-stream/shared';
import {
  WS_RECONNECT_INTERVAL_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  WS_PING_INTERVAL_MS,
} from '@n64-stream/shared';

type MessageHandler<T> = (data: T) => void;
type Unsubscribe = () => void;

interface UseWebSocketReturn {
  isConnected: boolean;
  clientId: string | null;
  sendCommand: (action: CommandAction) => void;
  sendOffer: (offer: SDPOffer) => void;
  sendIceCandidate: (candidate: ICECandidate) => void;
  onAnswer: (handler: MessageHandler<SDPAnswer>) => Unsubscribe;
  onIceCandidate: (handler: MessageHandler<ICECandidate>) => Unsubscribe;
  onStateChange: (handler: MessageHandler<EmulatorState>) => Unsubscribe;
  onWelcome: (handler: MessageHandler<ServerWelcomeMessage['payload']>) => Unsubscribe;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Event handlers
  const answerHandlers = useRef<Set<MessageHandler<SDPAnswer>>>(new Set());
  const iceCandidateHandlers = useRef<Set<MessageHandler<ICECandidate>>>(new Set());
  const stateChangeHandlers = useRef<Set<MessageHandler<EmulatorState>>>(new Set());
  const welcomeHandlers = useRef<Set<MessageHandler<ServerWelcomeMessage['payload']>>>(new Set());

  // Send message to server
  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Handle incoming message
  const handleMessage = useCallback((event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;

      switch (message.type) {
        case 'welcome':
          setClientId(message.payload.clientId);
          welcomeHandlers.current.forEach((handler) => { handler(message.payload); });
          break;

        case 'answer':
          answerHandlers.current.forEach((handler) => { handler(message.payload); });
          break;

        case 'ice-candidate':
          iceCandidateHandlers.current.forEach((handler) => { handler(message.payload); });
          break;

        case 'state-change':
          stateChangeHandlers.current.forEach((handler) => { handler(message.payload); });
          break;

        case 'pong':
          // Ping response received, connection is alive
          break;

        case 'error':
          console.error('Server error:', message.payload);
          break;
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, []);

  // Connect to WebSocket server
  const connect = useCallback(() => {
    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      reconnectAttempts.current = 0;

      // Start ping interval
      pingInterval.current = setInterval(() => {
        send({ type: 'ping', payload: { timestamp: Date.now() } });
      }, WS_PING_INTERVAL_MS);
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setClientId(null);
      wsRef.current = null;

      // Clear ping interval
      if (pingInterval.current) {
        clearInterval(pingInterval.current);
        pingInterval.current = null;
      }

      // Attempt reconnection
      if (reconnectAttempts.current < WS_MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current++;
        console.log(`Reconnecting... (attempt ${String(reconnectAttempts.current)})`);
        setTimeout(connect, WS_RECONNECT_INTERVAL_MS);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [handleMessage, send]);

  // Initialize connection
  useEffect(() => {
    connect();

    return () => {
      if (pingInterval.current) {
        clearInterval(pingInterval.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Public methods
  const sendCommand = useCallback(
    (action: CommandAction) => {
      send({ type: 'command', payload: { action } });
    },
    [send]
  );

  const sendOffer = useCallback(
    (offer: SDPOffer) => {
      send({ type: 'offer', payload: offer });
    },
    [send]
  );

  const sendIceCandidate = useCallback(
    (candidate: ICECandidate) => {
      send({ type: 'ice-candidate', payload: candidate });
    },
    [send]
  );

  // Event subscription methods
  const onAnswer = useCallback((handler: MessageHandler<SDPAnswer>): Unsubscribe => {
    answerHandlers.current.add(handler);
    return () => {
      answerHandlers.current.delete(handler);
    };
  }, []);

  const onIceCandidate = useCallback((handler: MessageHandler<ICECandidate>): Unsubscribe => {
    iceCandidateHandlers.current.add(handler);
    return () => {
      iceCandidateHandlers.current.delete(handler);
    };
  }, []);

  const onStateChange = useCallback((handler: MessageHandler<EmulatorState>): Unsubscribe => {
    stateChangeHandlers.current.add(handler);
    return () => {
      stateChangeHandlers.current.delete(handler);
    };
  }, []);

  const onWelcome = useCallback(
    (handler: MessageHandler<ServerWelcomeMessage['payload']>): Unsubscribe => {
      welcomeHandlers.current.add(handler);
      return () => {
        welcomeHandlers.current.delete(handler);
      };
    },
    []
  );

  return {
    isConnected,
    clientId,
    sendCommand,
    sendOffer,
    sendIceCandidate,
    onAnswer,
    onIceCandidate,
    onStateChange,
    onWelcome,
  };
}
