# N64 Web Streaming MVP

Stream an N64 emulator running on a server to a browser client via WebRTC. Users visit the site, see the game (pre-configured via environment variable), and can control playback with Play, Pause, and Restart buttons.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                          │
│                                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────────────────┐   │
│  │              │      │              │      │                          │   │
│  │  Mupen64Plus │─────▶│   FFmpeg     │─────▶│   Pion WebRTC Server     │   │
│  │  (headless)  │ raw  │  (H.264 enc) │ RTP  │   (Go)                   │   │
│  │              │frames│              │      │                          │   │
│  └──────┬───────┘      └──────────────┘      └────────────┬─────────────┘   │
│         │                                                  │                 │
│         │ control (pause/resume/restart)                   │ media stream    │
│         │                                                  │                 │
│  ┌──────┴───────┐                                          │                 │
│  │  Node.js     │◀─────────────────────────────────────────┤                 │
│  │  + WebSocket │ signaling (SDP/ICE) + commands           │                 │
│  └──────────────┘                                          │                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP + WSS
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER CLIENT                                   │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                           React + Vite                                   │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │ │
│  │  │                      <video> element                            │    │ │
│  │  │                    (WebRTC MediaStream)                         │    │ │
│  │  └─────────────────────────────────────────────────────────────────┘    │ │
│  │                                                                          │ │
│  │        [ ▶ Play ]        [ ⏸ Pause ]        [ ↻ Restart ]               │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Monorepo** | pnpm + Turborepo | Fast, efficient workspace management |
| **Server** | Node.js + TypeScript | Express HTTP server, WebSocket signaling |
| **Frontend** | React + Vite + TypeScript | Modern UI with strict type safety |
| **WebRTC** | Pion (Go) | High-performance media streaming |
| **Emulator** | mupen64plus | N64 emulation with plugin architecture |
| **Encoding** | FFmpeg | Low-latency H.264 video encoding |
| **Shared Types** | TypeScript | Type-safe communication between client/server |

## Project Structure

```
n64-stream/
├── apps/
│   ├── server/              # Node.js + TypeScript server
│   │   ├── src/
│   │   │   ├── index.ts     # Main entry point
│   │   │   ├── config.ts    # Configuration with Zod validation
│   │   │   ├── emulator.ts  # Mupen64plus process manager
│   │   │   ├── encoder.ts   # FFmpeg encoding pipeline
│   │   │   ├── signaling.ts # WebSocket signaling server
│   │   │   └── logger.ts    # Pino logger
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web/                 # React + Vite frontend
│       ├── src/
│       │   ├── components/  # React components
│       │   ├── hooks/       # Custom hooks (useWebSocket, useWebRTC)
│       │   ├── styles/      # CSS styles
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── shared/              # Shared TypeScript types
│       ├── src/
│       │   ├── types/       # Type definitions
│       │   ├── constants.ts # Shared constants
│       │   └── utils.ts     # Utility functions
│       └── package.json
│
├── services/
│   └── webrtc/              # Pion WebRTC server (Go)
│       ├── main.go
│       ├── go.mod
│       └── Dockerfile
│
├── roms/                    # ROM files (gitignored)
├── nginx/                   # Nginx configuration
├── docker-compose.yml       # Production deployment
├── docker-compose.dev.yml   # Development deployment
├── turbo.json              # Turborepo configuration
├── pnpm-workspace.yaml     # pnpm workspace config
└── tsconfig.base.json      # Base TypeScript configuration
```

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **Go** >= 1.22 (for WebRTC server)
- **Docker** & **Docker Compose** (for containerized deployment)

### System Dependencies (for local development)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
    mupen64plus-core \
    mupen64plus-video-rice \
    mupen64plus-audio-sdl \
    mupen64plus-input-sdl \
    mupen64plus-rsp-hle \
    ffmpeg

# macOS (with Homebrew)
brew install mupen64plus ffmpeg
```

## Getting Started

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd n64-stream

# Install pnpm if not already installed
corepack enable
corepack prepare pnpm@9.14.2 --activate

# Install dependencies
pnpm install
```

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your configuration
# Most importantly, set ROM_PATH to your N64 ROM file
```

### 3. Add ROM File

Place your N64 ROM file in the `roms/` directory:

```bash
cp /path/to/your/game.z64 roms/
```

Update `.env`:
```env
ROM_PATH=/roms/game.z64
```

### 4. Build and Run

#### Development Mode

```bash
# Terminal 1: Start the WebRTC server
cd services/webrtc
go run main.go

# Terminal 2: Start the Node.js server
pnpm --filter @n64-stream/server dev

# Terminal 3: Start the frontend dev server
pnpm --filter @n64-stream/web dev
```

Visit `http://localhost:5173` in your browser.

#### Production Mode (Docker)

```bash
# Build and run all services
docker compose up --build

# Or with the production profile (includes nginx)
docker compose --profile production up --build
```

Visit `http://localhost:80` in your browser.

## Available Scripts

### Root Level

```bash
pnpm build        # Build all packages
pnpm dev          # Start all in development mode
pnpm lint         # Lint all packages
pnpm typecheck    # Type check all packages
pnpm format       # Format all files with Prettier
pnpm clean        # Clean all build artifacts
```

### Individual Packages

```bash
# Server
pnpm --filter @n64-stream/server dev      # Development mode
pnpm --filter @n64-stream/server build    # Build
pnpm --filter @n64-stream/server start    # Start production

# Web
pnpm --filter @n64-stream/web dev         # Development mode
pnpm --filter @n64-stream/web build       # Build
pnpm --filter @n64-stream/web preview     # Preview production build

# Shared
pnpm --filter @n64-stream/shared build    # Build types
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROM_PATH` | `/roms/game.z64` | Path to the N64 ROM file |
| `PORT` | `3000` | Node.js server port |
| `HOST` | `0.0.0.0` | Server host binding |
| `STUN_SERVER` | `stun:stun.l.google.com:19302` | STUN server for WebRTC |
| `PION_URL` | `http://localhost:8080` | Pion WebRTC server URL |
| `PION_HTTP_PORT` | `8080` | Pion HTTP API port |
| `PION_RTP_PORT` | `5004` | RTP ingestion port |
| `VIDEO_WIDTH` | `640` | Video output width |
| `VIDEO_HEIGHT` | `480` | Video output height |
| `VIDEO_FRAMERATE` | `60` | Video framerate |
| `VIDEO_BITRATE` | `2M` | Video bitrate |
| `LOG_LEVEL` | `info` | Logging level |

## API Reference

### WebSocket Messages

#### Client → Server

```typescript
// Send control command
{ type: 'command', payload: { action: 'play' | 'pause' | 'restart' } }

// Send SDP offer
{ type: 'offer', payload: { type: 'offer', sdp: string } }

// Send ICE candidate
{ type: 'ice-candidate', payload: ICECandidate }

// Ping for keepalive
{ type: 'ping', payload: { timestamp: number } }
```

#### Server → Client

```typescript
// Welcome message with initial state
{ type: 'welcome', payload: { clientId: string, state: EmulatorState, stunServer: string } }

// Emulator state change
{ type: 'state-change', payload: EmulatorState }

// SDP answer
{ type: 'answer', payload: { type: 'answer', sdp: string } }

// ICE candidate
{ type: 'ice-candidate', payload: ICECandidate }

// Error
{ type: 'error', payload: { code: string, message: string } }
```

### REST API

```
GET  /api/health   # Health check
GET  /api/status   # Current emulator and connection status
```

## Success Criteria (MVP)

- [x] User visits website and sees N64 game video stream
- [x] Stream latency target: under 200ms (glass-to-glass)
- [x] Play button resumes emulation
- [x] Pause button freezes emulation
- [x] Restart button resets to beginning of ROM
- [x] Works in Chrome, Firefox, Safari
- [x] Single viewer supported

## Future Enhancements

1. **Controller Input** - Capture gamepad in browser, send to server
2. **Multi-player** - Player slots 1-4, input from different clients
3. **Audio Streaming** - Add audio track to WebRTC stream
4. **Latency Equalization** - Buffer inputs based on RTT
5. **Room System** - Multiple concurrent game sessions
6. **ROM Selection** - UI to choose from available ROMs
7. **Mobile Support** - Touch controls overlay

## Troubleshooting

### Common Issues

**"ROM not found"**
- Ensure the ROM file exists at the path specified in `ROM_PATH`
- Check file permissions

**"WebRTC connection failed"**
- Verify STUN server is accessible
- Check firewall settings for UDP ports
- Ensure Pion server is running

**"Emulator not starting"**
- Verify mupen64plus is installed
- Check plugin paths
- Review server logs for specific errors

### Logs

```bash
# View server logs
docker compose logs server

# View WebRTC server logs
docker compose logs webrtc

# View all logs
docker compose logs -f
```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm lint && pnpm typecheck`
5. Submit a pull request
