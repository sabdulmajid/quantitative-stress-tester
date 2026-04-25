package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultNumPaths     = 100000
	defaultHorizonDays  = 252
	defaultSeed         = int64(42)
	maxRequestBodyBytes = 1 << 20
	paddedSize          = 50
)

type Config struct {
	ComputeEngineURL   string
	HTTPClient         *http.Client
	Logger             *log.Logger
	MarketData         marketDataProvider
	MarketDataBaseURL  string
	MarketDataRange    string
	MarketDataCacheTTL time.Duration
}

type Server struct {
	computeEngineURL *url.URL
	client           *http.Client
	logger           *log.Logger
	marketData       marketDataProvider
}

type supportedTickersResponse struct {
	Provider            string   `json:"provider"`
	Range               string   `json:"range"`
	CacheTTLSeconds     int64    `json:"cache_ttl_seconds"`
	MaxPortfolioTickers int      `json:"max_portfolio_tickers"`
	PaddedAssetCount    int      `json:"padded_asset_count"`
	Tickers             []string `json:"tickers"`
}

type stressTestRequest struct {
	Tickers     []string  `json:"tickers"`
	Weights     []float64 `json:"weights"`
	HorizonDays *int      `json:"horizon_days,omitempty"`
	Seed        *int64    `json:"seed,omitempty"`
}

type computeRequest struct {
	PaddedWeights []float64   `json:"padded_weights"`
	PaddedMu      []float64   `json:"padded_mu"`
	PaddedCov     [][]float64 `json:"padded_cov"`
	NumPaths      int         `json:"num_paths"`
	HorizonDays   int         `json:"horizon_days"`
	Seed          int64       `json:"seed"`
}

type validatedRequest struct {
	tickers     []string
	weights     []float64
	horizonDays int
	seed        int64
}

func New(cfg Config) *Server {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}

	provider := cfg.MarketData
	if provider == nil {
		provider = NewMarketDataProvider(MarketDataProviderConfig{
			BaseURL:    cfg.MarketDataBaseURL,
			Range:      cfg.MarketDataRange,
			CacheTTL:   cfg.MarketDataCacheTTL,
			HTTPClient: client,
		})
	}

	base := cfg.ComputeEngineURL
	if base == "" {
		base = "http://localhost:8000"
	}
	parsed, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		parsed, _ = url.Parse("http://localhost:8000")
	}

	return &Server{
		computeEngineURL: parsed,
		client:           client,
		logger:           cfg.Logger,
		marketData:       provider,
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/api/v1/supported-tickers", s.handleSupportedTickers)
	mux.HandleFunc("/api/v1/stress-test", s.handleStressTest)
	return corsMiddleware(loggingMiddleware(s.logger, mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSupportedTickers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(w, http.StatusOK, supportedTickersResponse{
		Provider:            s.marketData.ProviderName(),
		Range:               s.marketData.HistoryRange(),
		CacheTTLSeconds:     int64(s.marketData.CacheTTL().Seconds()),
		MaxPortfolioTickers: 5,
		PaddedAssetCount:    paddedSize,
		Tickers:             s.marketData.SupportedTickers(),
	})
}

func (s *Server) handleStressTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	req, err := decodeStressTestRequest(r.Body)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	validated, err := s.validateRequest(req)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	payload, err := s.buildComputePayload(r.Context(), validated)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	upstream, err := s.proxyToCompute(r.Context(), payload)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "compute engine unavailable")
		return
	}
	defer upstream.Body.Close()

	copyResponseHeaders(w.Header(), upstream.Header)
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(upstream.StatusCode)
	_, _ = io.Copy(w, upstream.Body)
}

func (s *Server) validateRequest(req stressTestRequest) (validatedRequest, error) {
	if len(req.Tickers) < 1 || len(req.Tickers) > 5 {
		return validatedRequest{}, errors.New("tickers length must be between 1 and 5")
	}
	if len(req.Tickers) != len(req.Weights) {
		return validatedRequest{}, errors.New("weights length must match tickers length")
	}

	normalizedTickers := make([]string, len(req.Tickers))
	seen := make(map[string]struct{}, len(req.Tickers))
	for index, ticker := range req.Tickers {
		normalized := strings.ToUpper(strings.TrimSpace(ticker))
		normalizedTickers[index] = normalized
		if !s.marketData.Supports(normalized) {
			return validatedRequest{}, fmt.Errorf("unsupported ticker %q", ticker)
		}
		if _, ok := seen[normalized]; ok {
			return validatedRequest{}, fmt.Errorf("duplicate ticker %q", normalized)
		}
		seen[normalized] = struct{}{}
	}

	normalizedWeights, err := normalizeWeights(req.Weights)
	if err != nil {
		return validatedRequest{}, err
	}

	horizonDays := defaultHorizonDays
	if req.HorizonDays != nil {
		if *req.HorizonDays <= 0 {
			return validatedRequest{}, errors.New("horizon_days must be positive")
		}
		horizonDays = *req.HorizonDays
	}

	seed := defaultSeed
	if req.Seed != nil {
		seed = *req.Seed
	}

	return validatedRequest{
		tickers:     normalizedTickers,
		weights:     normalizedWeights,
		horizonDays: horizonDays,
		seed:        seed,
	}, nil
}

func (s *Server) buildComputePayload(ctx context.Context, req validatedRequest) ([]byte, error) {
	mu, cov, err := s.marketData.PortfolioInputs(ctx, req.tickers)
	if err != nil {
		return nil, err
	}

	payload := computeRequest{
		PaddedWeights: padVector(req.weights, paddedSize),
		PaddedMu:      padVector(mu, paddedSize),
		PaddedCov:     padMatrix(cov, paddedSize),
		NumPaths:      defaultNumPaths,
		HorizonDays:   req.horizonDays,
		Seed:          req.seed,
	}

	return json.Marshal(payload)
}

func (s *Server) proxyToCompute(ctx context.Context, payload []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.computeURL("/simulate"), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	return s.client.Do(req)
}

func (s *Server) computeURL(path string) string {
	base := *s.computeEngineURL
	base.Path = strings.TrimRight(base.Path, "/") + path
	return base.String()
}

func decodeStressTestRequest(body io.Reader) (stressTestRequest, error) {
	limited := io.LimitReader(body, maxRequestBodyBytes)
	decoder := json.NewDecoder(limited)
	decoder.DisallowUnknownFields()

	var req stressTestRequest
	if err := decoder.Decode(&req); err != nil {
		return stressTestRequest{}, fmt.Errorf("invalid JSON payload: %w", err)
	}
	return req, nil
}

func normalizeWeights(weights []float64) ([]float64, error) {
	total := 0.0
	for _, weight := range weights {
		if math.IsNaN(weight) || math.IsInf(weight, 0) {
			return nil, errors.New("weights must be finite numbers")
		}
		if weight < 0 {
			return nil, errors.New("weights must be non-negative")
		}
		total += weight
	}
	if total <= 0 {
		return nil, errors.New("weights must sum to a positive value")
	}

	normalized := make([]float64, len(weights))
	for i, weight := range weights {
		normalized[i] = weight / total
	}
	return normalized, nil
}

func padVector(values []float64, size int) []float64 {
	out := make([]float64, size)
	copy(out, values)
	return out
}

func padMatrix(values [][]float64, size int) [][]float64 {
	out := make([][]float64, size)
	for i := range out {
		out[i] = make([]float64, size)
	}
	for i := 0; i < len(values) && i < size; i++ {
		copy(out[i], values[i])
	}
	return out
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func copyResponseHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		if isHopByHopHeader(key) {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func isHopByHopHeader(key string) bool {
	switch strings.ToLower(key) {
	case "connection", "proxy-connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func loggingMiddleware(logger *log.Logger, next http.Handler) http.Handler {
	if logger == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		logger.Printf("%s %s", r.Method, r.URL.Path)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		w.Header().Set("Access-Control-Max-Age", "600")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
