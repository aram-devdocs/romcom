import { useState, useCallback, useRef, useEffect } from 'react';
import type { SDPOffer, SDPAnswer, ICECandidate } from '@n64-stream/shared';

type MessageHandler<T> = (data: T) => void;
type Unsubscribe = () => void;

interface UseWebRTCProps {
  stunServer: string;
  onLocalOffer: (offer: SDPOffer) => void;
  onLocalIceCandidate: (candidate: ICECandidate) => void;
  onAnswer: (handler: MessageHandler<SDPAnswer>) => Unsubscribe;
  onIceCandidate: (handler: MessageHandler<ICECandidate>) => Unsubscribe;
}

interface UseWebRTCReturn {
  isConnected: boolean;
  stream: MediaStream | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useWebRTC({
  stunServer,
  onLocalOffer,
  onLocalIceCandidate,
  onAnswer,
  onIceCandidate,
}: UseWebRTCProps): UseWebRTCReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidates = useRef<ICECandidate[]>([]);

  // Add pending ICE candidates after remote description is set
  const addPendingCandidates = useCallback(async () => {
    if (!pcRef.current) return;

    for (const candidate of pendingCandidates.current) {
      try {
        await pcRef.current.addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
      } catch (err) {
        console.error('Failed to add pending ICE candidate:', err);
      }
    }
    pendingCandidates.current = [];
  }, []);

  // Handle SDP answer from server
  useEffect(() => {
    const unsubscribe = onAnswer((answer) => {
      if (!pcRef.current) return;

      void (async () => {
        try {
          await pcRef.current?.setRemoteDescription({
            type: 'answer',
            sdp: answer.sdp,
          });
          console.log('Remote description set');

          // Add any pending ICE candidates
          await addPendingCandidates();
        } catch (err) {
          console.error('Failed to set remote description:', err);
        }
      })();
    });

    return unsubscribe;
  }, [onAnswer, addPendingCandidates]);

  // Handle ICE candidates from server
  useEffect(() => {
    const unsubscribe = onIceCandidate((candidate) => {
      if (!pcRef.current) return;

      // If remote description is not set yet, queue the candidate
      if (!pcRef.current.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }

      void (async () => {
        try {
          await pcRef.current?.addIceCandidate({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
          });
        } catch (err) {
          console.error('Failed to add ICE candidate:', err);
        }
      })();
    });

    return unsubscribe;
  }, [onIceCandidate]);

  // Connect to WebRTC server
  const connect = useCallback(async () => {
    console.log('Initializing WebRTC connection');

    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: stunServer }],
    });

    pcRef.current = pc;

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);

      switch (pc.connectionState) {
        case 'connected':
          setIsConnected(true);
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setIsConnected(false);
          setStream(null);
          break;
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onLocalIceCandidate({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        });
      }
    };

    // Handle incoming tracks (video stream)
    pc.ontrack = (event) => {
      console.log('Received track:', event.track.kind);
      if (event.streams[0]) {
        setStream(event.streams[0]);
      }
    };

    // Add transceiver for receiving video only
    pc.addTransceiver('video', { direction: 'recvonly' });

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log('Sending SDP offer');
      onLocalOffer({
        type: 'offer',
        sdp: offer.sdp ?? '',
      });
    } catch (err) {
      console.error('Failed to create offer:', err);
      throw err;
    }
  }, [stunServer, onLocalOffer, onLocalIceCandidate]);

  // Disconnect from WebRTC server
  const disconnect = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setIsConnected(false);
    setStream(null);
    pendingCandidates.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    stream,
    connect,
    disconnect,
  };
}
