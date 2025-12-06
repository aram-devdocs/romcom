// Package main implements the Pion WebRTC server for N64 streaming.
//
// This server:
// - Ingests RTP packets from FFmpeg
// - Manages WebRTC peer connections
// - Handles SDP offer/answer exchange via HTTP API
// - Relays ICE candidates
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/intervalpli"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/rs/cors"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// Config holds the server configuration
type Config struct {
	HTTPPort   int
	RTPPort    int
	STUNServer string
}

// Session represents a WebRTC peer connection session
type Session struct {
	ID             string
	PeerConnection *webrtc.PeerConnection
	VideoTrack     *webrtc.TrackLocalStaticRTP
	CreatedAt      time.Time
}

// Server manages WebRTC connections and RTP ingestion
type Server struct {
	config   Config
	sessions sync.Map // map[string]*Session

	videoTrack    *webrtc.TrackLocalStaticRTP
	rtpListener   *net.UDPConn
	webrtcAPI     *webrtc.API
	mediaEngine   *webrtc.MediaEngine
	
	mu sync.RWMutex
}

// OfferRequest represents the SDP offer from a client
type OfferRequest struct {
	SDP      string `json:"sdp"`
	ClientID string `json:"clientId"`
}

// OfferResponse represents the SDP answer to send to client
type OfferResponse struct {
	SDP       string `json:"sdp"`
	SessionID string `json:"sessionId"`
}

// ICECandidateRequest represents an ICE candidate from client
type ICECandidateRequest struct {
	SessionID string                  `json:"sessionId"`
	Candidate webrtc.ICECandidateInit `json:"candidate"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func main() {
	// Configure zerolog
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	// Load configuration from environment
	config := loadConfig()

	log.Info().
		Int("httpPort", config.HTTPPort).
		Int("rtpPort", config.RTPPort).
		Str("stunServer", config.STUNServer).
		Msg("Starting WebRTC server")

	// Create server
	server, err := NewServer(config)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create server")
	}

	// Start RTP listener
	if err := server.StartRTPListener(); err != nil {
		log.Fatal().Err(err).Msg("Failed to start RTP listener")
	}

	// Start HTTP server
	httpServer := server.StartHTTPServer()

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Info().Msg("Shutting down...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("HTTP server shutdown error")
	}

	server.Close()
	log.Info().Msg("Server stopped")
}

func loadConfig() Config {
	httpPort, _ := strconv.Atoi(getEnv("HTTP_PORT", "8080"))
	rtpPort, _ := strconv.Atoi(getEnv("RTP_PORT", "5004"))
	stunServer := getEnv("STUN_SERVER", "stun:stun.l.google.com:19302")

	return Config{
		HTTPPort:   httpPort,
		RTPPort:    rtpPort,
		STUNServer: stunServer,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// NewServer creates a new WebRTC server
func NewServer(config Config) (*Server, error) {
	// Create MediaEngine with H.264 codec
	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeH264,
			ClockRate:   90000,
			SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
		},
		PayloadType: 96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, fmt.Errorf("failed to register H264 codec: %w", err)
	}

	// Create interceptor registry for RTCP feedback
	interceptorRegistry := &interceptor.Registry{}
	
	// Add PLI (Picture Loss Indication) interceptor for keyframe requests
	pliFactory, err := intervalpli.NewReceiverInterceptor()
	if err != nil {
		return nil, fmt.Errorf("failed to create PLI interceptor: %w", err)
	}
	interceptorRegistry.Add(pliFactory)

	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, interceptorRegistry); err != nil {
		return nil, fmt.Errorf("failed to register interceptors: %w", err)
	}

	// Create WebRTC API
	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithInterceptorRegistry(interceptorRegistry),
	)

	// Create video track that will be shared by all peer connections
	videoTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264},
		"video",
		"n64-stream",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create video track: %w", err)
	}

	return &Server{
		config:      config,
		videoTrack:  videoTrack,
		webrtcAPI:   api,
		mediaEngine: mediaEngine,
	}, nil
}

// StartRTPListener starts listening for RTP packets from FFmpeg
func (s *Server) StartRTPListener() error {
	addr := net.UDPAddr{
		IP:   net.IPv4zero,
		Port: s.config.RTPPort,
	}

	conn, err := net.ListenUDP("udp", &addr)
	if err != nil {
		return fmt.Errorf("failed to listen on UDP port %d: %w", s.config.RTPPort, err)
	}

	s.rtpListener = conn
	log.Info().Int("port", s.config.RTPPort).Msg("RTP listener started")

	// Start goroutine to read RTP packets
	go s.readRTPPackets()

	return nil
}

// readRTPPackets continuously reads RTP packets and forwards them to all peer connections
func (s *Server) readRTPPackets() {
	buf := make([]byte, 1500) // MTU size
	packet := &rtp.Packet{}

	for {
		n, _, err := s.rtpListener.ReadFromUDP(buf)
		if err != nil {
			// Check if listener was closed
			if s.rtpListener == nil {
				return
			}
			log.Error().Err(err).Msg("Error reading RTP packet")
			continue
		}

		if err := packet.Unmarshal(buf[:n]); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal RTP packet")
			continue
		}

		// Write packet to the shared video track
		// This automatically forwards to all connected peer connections
		if _, err := s.videoTrack.Write(buf[:n]); err != nil {
			// Ignore closed errors during shutdown
			if err.Error() != "io: read/write on closed pipe" {
				log.Warn().Err(err).Msg("Failed to write to video track")
			}
		}
	}
}

// StartHTTPServer starts the HTTP API server
func (s *Server) StartHTTPServer() *http.Server {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("POST /offer", s.handleOffer)
	mux.HandleFunc("POST /ice-candidate", s.handleICECandidate)
	mux.HandleFunc("GET /health", s.handleHealth)

	// Add CORS middleware
	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
	}).Handler(mux)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", s.config.HTTPPort),
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Info().Int("port", s.config.HTTPPort).Msg("HTTP server started")
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("HTTP server error")
		}
	}()

	return server
}

// handleOffer handles SDP offer from client and returns SDP answer
func (s *Server) handleOffer(w http.ResponseWriter, r *http.Request) {
	var req OfferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	log.Info().Str("clientId", req.ClientID).Msg("Received SDP offer")

	// Create peer connection
	peerConnection, err := s.createPeerConnection()
	if err != nil {
		log.Error().Err(err).Msg("Failed to create peer connection")
		s.writeError(w, http.StatusInternalServerError, "Failed to create peer connection", err.Error())
		return
	}

	// Add video track to peer connection
	rtpSender, err := peerConnection.AddTrack(s.videoTrack)
	if err != nil {
		log.Error().Err(err).Msg("Failed to add video track")
		peerConnection.Close()
		s.writeError(w, http.StatusInternalServerError, "Failed to add video track", err.Error())
		return
	}

	// Handle RTCP packets (for PLI, etc.)
	go s.handleRTCP(rtpSender)

	// Set remote description (client's offer)
	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  req.SDP,
	}
	if err := peerConnection.SetRemoteDescription(offer); err != nil {
		log.Error().Err(err).Msg("Failed to set remote description")
		peerConnection.Close()
		s.writeError(w, http.StatusBadRequest, "Invalid SDP offer", err.Error())
		return
	}

	// Create answer
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create answer")
		peerConnection.Close()
		s.writeError(w, http.StatusInternalServerError, "Failed to create answer", err.Error())
		return
	}

	// Set local description
	if err := peerConnection.SetLocalDescription(answer); err != nil {
		log.Error().Err(err).Msg("Failed to set local description")
		peerConnection.Close()
		s.writeError(w, http.StatusInternalServerError, "Failed to set local description", err.Error())
		return
	}

	// Wait for ICE gathering to complete
	<-webrtc.GatheringCompletePromise(peerConnection)

	// Create session
	sessionID := uuid.New().String()
	session := &Session{
		ID:             sessionID,
		PeerConnection: peerConnection,
		VideoTrack:     s.videoTrack,
		CreatedAt:      time.Now(),
	}
	s.sessions.Store(sessionID, session)

	// Set up connection state handler
	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Info().
			Str("sessionId", sessionID).
			Str("state", state.String()).
			Msg("Peer connection state changed")

		if state == webrtc.PeerConnectionStateClosed ||
			state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateDisconnected {
			s.sessions.Delete(sessionID)
		}
	})

	// Send response
	resp := OfferResponse{
		SDP:       peerConnection.LocalDescription().SDP,
		SessionID: sessionID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)

	log.Info().Str("sessionId", sessionID).Msg("Created WebRTC session")
}

// handleICECandidate handles ICE candidates from client
func (s *Server) handleICECandidate(w http.ResponseWriter, r *http.Request) {
	var req ICECandidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, http.StatusBadRequest, "Invalid request body", err.Error())
		return
	}

	sessionVal, ok := s.sessions.Load(req.SessionID)
	if !ok {
		s.writeError(w, http.StatusNotFound, "Session not found", "")
		return
	}

	session := sessionVal.(*Session)

	if err := session.PeerConnection.AddICECandidate(req.Candidate); err != nil {
		log.Error().Err(err).Str("sessionId", req.SessionID).Msg("Failed to add ICE candidate")
		s.writeError(w, http.StatusBadRequest, "Failed to add ICE candidate", err.Error())
		return
	}

	log.Debug().Str("sessionId", req.SessionID).Msg("Added ICE candidate")
	w.WriteHeader(http.StatusOK)
}

// handleHealth returns server health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Count active sessions
	sessionCount := 0
	s.sessions.Range(func(_, _ interface{}) bool {
		sessionCount++
		return true
	})

	resp := map[string]interface{}{
		"status":    "ok",
		"timestamp": time.Now().Format(time.RFC3339),
		"sessions":  sessionCount,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// createPeerConnection creates a new WebRTC peer connection
func (s *Server) createPeerConnection() (*webrtc.PeerConnection, error) {
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{s.config.STUNServer}},
		},
	}

	return s.webrtcAPI.NewPeerConnection(config)
}

// handleRTCP reads RTCP packets (for PLI, etc.)
func (s *Server) handleRTCP(sender *webrtc.RTPSender) {
	for {
		_, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		// RTCP packets are automatically handled by interceptors
	}
}

// writeError writes an error response
func (s *Server) writeError(w http.ResponseWriter, status int, error, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   error,
		Message: message,
	})
}

// Close shuts down the server
func (s *Server) Close() {
	// Close RTP listener
	if s.rtpListener != nil {
		s.rtpListener.Close()
		s.rtpListener = nil
	}

	// Close all peer connections
	s.sessions.Range(func(key, value interface{}) bool {
		session := value.(*Session)
		session.PeerConnection.Close()
		s.sessions.Delete(key)
		return true
	})
}
