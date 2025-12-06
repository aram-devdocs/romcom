import { useRef, useEffect } from 'react';
import './VideoPlayer.css';

interface VideoPlayerProps {
  stream: MediaStream | null;
}

export function VideoPlayer({ stream }: VideoPlayerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-player">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="video-element"
      />
      {!stream && (
        <div className="video-placeholder">
          <div className="placeholder-icon">🎮</div>
          <p>Waiting for video stream...</p>
        </div>
      )}
    </div>
  );
}
