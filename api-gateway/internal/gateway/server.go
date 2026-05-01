package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const (
	defaultNumPaths     = 100000
	defaultHorizonDays  = 252
	defaultSeed         = int64(42)
	maxRequestBodyBytes = 1 << 20
	paddedSize          = 50
	maxPortfolioTickers = 20
	defaultConfidence   = 0.95
	defaultRiskFreeRate = 0.0
)

var (
	httpRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "quant_gateway_http_requests_total",
			Help: "Total HTTP requests handled by the gateway.",
		},
		[]string{"method", "route", "status"},
	)
	httpRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "quant_gateway_http_request_duration_seconds",
			Help:    "Gateway HTTP request duration.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route"},
	)
	stressTestDataFetchDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "quant_gateway_stress_data_fetch_duration_seconds",
			Help:    "Market-data fetch and moment construction duration for stress-test requests.",
			Buckets: []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20},
		},
	)
	stressTestComputeDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "quant_gateway_stress_compute_duration_seconds",
			Help:    "Compute-engine simulation duration reported by the JAX service.",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
		},
	)
	stressTestRoundtripDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "quant_gateway_stress_roundtrip_duration_seconds",
			Help:    "Total gateway round-trip duration for stress-test requests.",
			Buckets: []float64{0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30},
		},
	)
)

type Config struct {
	ComputeEngineURL   string
	HTTPClient         *http.Client
	Logger             *slog.Logger
	MarketData         marketDataProvider
	MarketDataBaseURL  string
	MarketDataRange    string
	MarketDataCacheTTL time.Duration
	RedisURL           string
	MarketFetchWorkers int
	MarketFetchMinWait time.Duration
	MarketFetchMaxWait time.Duration
}

type Server struct {
	computeEngineURL *url.URL
	client           *http.Client
	logger           *slog.Logger
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
	Tickers         []string  `json:"tickers"`
	Weights         []float64 `json:"weights"`
	HorizonDays     *int      `json:"horizon_days,omitempty"`
	ConfidenceLevel *float64  `json:"confidence_level,omitempty"`
	RiskFreeRate    *float64  `json:"risk_free_rate,omitempty"`
	Seed            *int64    `json:"seed,omitempty"`
}

type computeRequest struct {
	PaddedWeights   []float64   `json:"padded_weights"`
	PaddedMu        []float64   `json:"padded_mu"`
	PaddedCov       [][]float64 `json:"padded_cov"`
	NumPaths        int         `json:"num_paths"`
	HorizonDays     int         `json:"horizon_days"`
	ConfidenceLevel float64     `json:"confidence_level"`
	RiskFreeRate    float64     `json:"risk_free_rate"`
	Seed            int64       `json:"seed"`
}

type histogramBin struct {
	BinStart  float64 `json:"bin_start"`
	BinEnd    float64 `json:"bin_end"`
	Frequency int     `json:"frequency"`
}

type computeResponse struct {
	ExpectedReturn       float64        `json:"expected_return"`
	Var95                float64        `json:"var_95"`
	Var99                float64        `json:"var_99"`
	ValueAtRisk          float64        `json:"value_at_risk"`
	CVar                 float64        `json:"cvar"`
	AnnualizedVolatility float64        `json:"annualized_volatility"`
	SharpeRatio          float64        `json:"sharpe_ratio"`
	ConfidenceLevel      float64        `json:"confidence_level"`
	ElapsedMS            float64        `json:"elapsed_ms"`
	Histogram            []histogramBin `json:"histogram"`
}

type stressTestResponse struct {
	computeResponse
	Provider          string      `json:"provider"`
	Range             string      `json:"range"`
	Tickers           []string    `json:"tickers"`
	Weights           []float64   `json:"weights"`
	HorizonDays       int         `json:"horizon_days"`
	RiskFreeRate      float64     `json:"risk_free_rate"`
	DataFetchMS       float64     `json:"data_fetch_ms"`
	TotalRoundtripMS  float64     `json:"total_roundtrip_ms"`
	Mu                []float64   `json:"mu"`
	CovarianceMatrix  [][]float64 `json:"covariance_matrix"`
	CorrelationMatrix [][]float64 `json:"correlation_matrix"`
}

type validatedRequest struct {
	tickers         []string
	weights         []float64
	horizonDays     int
	confidenceLevel float64
	riskFreeRate    float64
	seed            int64
}

type computePayloadBundle struct {
	body   []byte
	inputs marketInputs
}

func New(cfg Config) *Server {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{}
	}

	provider := cfg.MarketData
	if provider == nil {
		provider = NewMarketDataProvider(MarketDataProviderConfig{
			BaseURL:      cfg.MarketDataBaseURL,
			Range:        cfg.MarketDataRange,
			CacheTTL:     cfg.MarketDataCacheTTL,
			HTTPClient:   client,
			RedisURL:     cfg.RedisURL,
			FetchWorkers: cfg.MarketFetchWorkers,
			FetchMinWait: cfg.MarketFetchMinWait,
			FetchMaxWait: cfg.MarketFetchMaxWait,
			Logger:       cfg.Logger,
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
	mux.Handle("/metrics", promhttp.Handler())
	return corsMiddleware(loggingMiddleware(s.logger, metricsMiddleware(mux)))
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
		MaxPortfolioTickers: maxPortfolioTickers,
		PaddedAssetCount:    paddedSize,
		Tickers:             s.marketData.SupportedTickers(),
	})
}

func (s *Server) handleStressTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	requestStartedAt := time.Now()

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

	fetchStartedAt := time.Now()
	bundle, err := s.buildComputePayload(r.Context(), validated)
	dataFetchMS := elapsedMilliseconds(fetchStartedAt)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	stressTestDataFetchDuration.Observe(dataFetchMS / 1000.0)

	upstream, err := s.proxyToCompute(r.Context(), bundle.body)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "compute engine unavailable")
		return
	}
	defer upstream.Body.Close()

	if upstream.StatusCode != http.StatusOK {
		copyResponseHeaders(w.Header(), upstream.Header)
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", "application/json")
		}
		w.WriteHeader(upstream.StatusCode)
		_, _ = io.Copy(w, upstream.Body)
		return
	}

	var computeResp computeResponse
	if err := json.NewDecoder(upstream.Body).Decode(&computeResp); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to decode compute engine response")
		return
	}
	stressTestComputeDuration.Observe(computeResp.ElapsedMS / 1000.0)

	totalRoundtripMS := elapsedMilliseconds(requestStartedAt)
	stressTestRoundtripDuration.Observe(totalRoundtripMS / 1000.0)

	response := stressTestResponse{
		computeResponse:   computeResp,
		Provider:          s.marketData.ProviderName(),
		Range:             s.marketData.HistoryRange(),
		Tickers:           validated.tickers,
		Weights:           validated.weights,
		HorizonDays:       validated.horizonDays,
		RiskFreeRate:      validated.riskFreeRate,
		DataFetchMS:       dataFetchMS,
		TotalRoundtripMS:  totalRoundtripMS,
		Mu:                cloneFloat64s(bundle.inputs.Mu),
		CovarianceMatrix:  cloneMatrix(bundle.inputs.Covariance),
		CorrelationMatrix: covarianceToCorrelation(bundle.inputs.Covariance),
	}

	s.logStressTest(response, len(validated.tickers))
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) validateRequest(req stressTestRequest) (validatedRequest, error) {
	if len(req.Tickers) < 1 || len(req.Tickers) > maxPortfolioTickers {
		return validatedRequest{}, fmt.Errorf("tickers length must be between 1 and %d", maxPortfolioTickers)
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
		if !isSupportedHorizon(*req.HorizonDays) {
			return validatedRequest{}, errors.New("horizon_days must be one of 1, 10, or 252")
		}
		horizonDays = *req.HorizonDays
	}

	confidenceLevel := defaultConfidence
	if req.ConfidenceLevel != nil {
		if !isSupportedConfidence(*req.ConfidenceLevel) {
			return validatedRequest{}, errors.New("confidence_level must be 0.95 or 0.99")
		}
		confidenceLevel = *req.ConfidenceLevel
	}

	riskFreeRate := defaultRiskFreeRate
	if req.RiskFreeRate != nil {
		if math.IsNaN(*req.RiskFreeRate) || math.IsInf(*req.RiskFreeRate, 0) {
			return validatedRequest{}, errors.New("risk_free_rate must be finite")
		}
		riskFreeRate = *req.RiskFreeRate
	}

	seed := defaultSeed
	if req.Seed != nil {
		seed = *req.Seed
	}

	return validatedRequest{
		tickers:         normalizedTickers,
		weights:         normalizedWeights,
		horizonDays:     horizonDays,
		confidenceLevel: confidenceLevel,
		riskFreeRate:    riskFreeRate,
		seed:            seed,
	}, nil
}

func (s *Server) buildComputePayload(ctx context.Context, req validatedRequest) (computePayloadBundle, error) {
	inputs, err := s.marketData.PortfolioInputs(ctx, req.tickers)
	if err != nil {
		return computePayloadBundle{}, err
	}

	payload := computeRequest{
		PaddedWeights:   padVector(req.weights, paddedSize),
		PaddedMu:        padVector(inputs.Mu, paddedSize),
		PaddedCov:       padMatrix(inputs.Covariance, paddedSize),
		NumPaths:        defaultNumPaths,
		HorizonDays:     req.horizonDays,
		ConfidenceLevel: req.confidenceLevel,
		RiskFreeRate:    req.riskFreeRate,
		Seed:            req.seed,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return computePayloadBundle{}, err
	}

	return computePayloadBundle{body: body, inputs: inputs}, nil
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

func cloneFloat64s(values []float64) []float64 {
	out := make([]float64, len(values))
	copy(out, values)
	return out
}

func cloneMatrix(values [][]float64) [][]float64 {
	out := make([][]float64, len(values))
	for i := range values {
		out[i] = cloneFloat64s(values[i])
	}
	return out
}

func covarianceToCorrelation(covariance [][]float64) [][]float64 {
	correlation := make([][]float64, len(covariance))
	for i := range covariance {
		correlation[i] = make([]float64, len(covariance))
	}

	for i := range covariance {
		for j := range covariance {
			if i == j {
				correlation[i][j] = 1
				continue
			}
			if i >= len(covariance) || j >= len(covariance[i]) || j >= len(covariance) || i >= len(covariance[j]) {
				continue
			}
			denominator := math.Sqrt(math.Max(covariance[i][i], 0) * math.Max(covariance[j][j], 0))
			if denominator <= 0 {
				continue
			}
			correlation[i][j] = covariance[i][j] / denominator
		}
	}
	return correlation
}

func isSupportedHorizon(value int) bool {
	return value == 1 || value == 10 || value == 252
}

func isSupportedConfidence(value float64) bool {
	return math.Abs(value-0.95) < 1e-9 || math.Abs(value-0.99) < 1e-9
}

func elapsedMilliseconds(startedAt time.Time) float64 {
	return float64(time.Since(startedAt).Microseconds()) / 1000.0
}

func (s *Server) logStressTest(response stressTestResponse, tickerCount int) {
	if s.logger == nil {
		return
	}
	s.logger.Info(
		"stress test completed",
		slog.Int("ticker_count", tickerCount),
		slog.Float64("confidence_level", response.ConfidenceLevel),
		slog.Int("horizon_days", response.HorizonDays),
		slog.Float64("compute_ms", response.ElapsedMS),
		slog.Float64("data_fetch_ms", response.DataFetchMS),
		slog.Float64("total_roundtrip_ms", response.TotalRoundtripMS),
	)
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

func loggingMiddleware(logger *slog.Logger, next http.Handler) http.Handler {
	if logger == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		logger.Info(
			"http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", recorder.status),
			slog.Int("bytes", recorder.bytes),
			slog.Float64("elapsed_ms", elapsedMilliseconds(startedAt)),
		)
	})
}

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		route := normalizeMetricRoute(r.URL.Path)
		status := strconv.Itoa(recorder.status)
		httpRequestsTotal.WithLabelValues(r.Method, route, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, route).Observe(time.Since(startedAt).Seconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(payload []byte) (int, error) {
	n, err := r.ResponseWriter.Write(payload)
	r.bytes += n
	return n, err
}

func normalizeMetricRoute(path string) string {
	switch path {
	case "/health", "/metrics", "/api/v1/supported-tickers", "/api/v1/stress-test":
		return path
	default:
		return "other"
	}
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
