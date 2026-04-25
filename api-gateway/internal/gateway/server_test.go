package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type stubMarketDataProvider struct {
	supported map[string]struct{}
	mu        []float64
	cov       [][]float64
	err       error
}

func (s stubMarketDataProvider) Supports(symbol string) bool {
	_, ok := s.supported[symbol]
	return ok
}

func (s stubMarketDataProvider) SupportedTickers() []string {
	return []string{"AAPL", "GLD", "MSFT", "SPY", "TSLA"}
}

func (s stubMarketDataProvider) ProviderName() string {
	return "Test Provider"
}

func (s stubMarketDataProvider) HistoryRange() string {
	return "3y"
}

func (s stubMarketDataProvider) CacheTTL() time.Duration {
	return 6 * time.Hour
}

func (s stubMarketDataProvider) PortfolioInputs(_ context.Context, _ []string) ([]float64, [][]float64, error) {
	return s.mu, s.cov, s.err
}

func TestStressTestValidationRejectsBadRequests(t *testing.T) {
	srv := New(Config{
		MarketData: stubMarketDataProvider{
			supported: map[string]struct{}{
				"AAPL": {},
				"MSFT": {},
				"TSLA": {},
				"SPY":  {},
				"GLD":  {},
			},
		},
	})

	tests := []struct {
		name string
		req  stressTestRequest
	}{
		{
			name: "mismatched lengths",
			req: stressTestRequest{
				Tickers: []string{"AAPL"},
				Weights: []float64{0.5, 0.5},
			},
		},
		{
			name: "duplicate tickers",
			req: stressTestRequest{
				Tickers: []string{"AAPL", "AAPL"},
				Weights: []float64{0.5, 0.5},
			},
		},
		{
			name: "unsupported ticker",
			req: stressTestRequest{
				Tickers: []string{"AAPL", "QQQ"},
				Weights: []float64{0.5, 0.5},
			},
		},
		{
			name: "too many tickers",
			req: stressTestRequest{
				Tickers: []string{"AAPL", "MSFT", "TSLA", "SPY", "GLD", "AAPL"},
				Weights: []float64{1, 1, 1, 1, 1, 1},
			},
		},
		{
			name: "negative weight",
			req: stressTestRequest{
				Tickers: []string{"AAPL"},
				Weights: []float64{-1},
			},
		},
		{
			name: "zero sum",
			req: stressTestRequest{
				Tickers: []string{"AAPL"},
				Weights: []float64{0},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := srv.validateRequest(tc.req); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
}

func TestStressTestForwardsNormalizedPayload(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if got := r.URL.Path; got != "/simulate" {
			t.Fatalf("unexpected path: %s", got)
		}

		var payload computeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode upstream payload: %v", err)
		}

		if payload.NumPaths != defaultNumPaths {
			t.Fatalf("unexpected num_paths: %d", payload.NumPaths)
		}
		if payload.HorizonDays != defaultHorizonDays {
			t.Fatalf("unexpected horizon_days: %d", payload.HorizonDays)
		}
		if payload.Seed != defaultSeed {
			t.Fatalf("unexpected seed: %d", payload.Seed)
		}
		if got := len(payload.PaddedWeights); got != paddedSize {
			t.Fatalf("unexpected padded_weights length: %d", got)
		}
		if got := len(payload.PaddedMu); got != paddedSize {
			t.Fatalf("unexpected padded_mu length: %d", got)
		}
		if got := len(payload.PaddedCov); got != paddedSize {
			t.Fatalf("unexpected padded_cov rows: %d", got)
		}
		if got := len(payload.PaddedCov[0]); got != paddedSize {
			t.Fatalf("unexpected padded_cov cols: %d", got)
		}

		wantWeights := []float64{2.0 / 3.0, 1.0 / 3.0}
		for i, want := range wantWeights {
			if diff := payload.PaddedWeights[i] - want; diff < -1e-12 || diff > 1e-12 {
				t.Fatalf("unexpected weight %d: %v", i, payload.PaddedWeights[i])
			}
		}
		if payload.PaddedWeights[2] != 0 {
			t.Fatalf("expected zero padding in weights")
		}

		if payload.PaddedMu[0] != 0.18 || payload.PaddedMu[1] != 0.15 {
			t.Fatalf("unexpected padded mu: %#v", payload.PaddedMu[:2])
		}
		if payload.PaddedCov[0][1] != 0.038 || payload.PaddedCov[1][0] != 0.038 {
			t.Fatalf("unexpected covariance values")
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"var_95":0.12,"expected_return":0.14,"histogram":[],"elapsed_ms":7}`))
	}))
	defer upstream.Close()

	srv := New(Config{
		ComputeEngineURL: upstream.URL,
		HTTPClient:       upstream.Client(),
		MarketData: stubMarketDataProvider{
			supported: map[string]struct{}{
				"AAPL": {},
				"MSFT": {},
			},
			mu: []float64{0.18, 0.15},
			cov: [][]float64{
				{0.0725, 0.0380},
				{0.0380, 0.0590},
			},
		},
	})

	reqBody := `{"tickers":["AAPL","MSFT"],"weights":[2,1]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/stress-test", bytes.NewBufferString(reqBody))
	rr := httptest.NewRecorder()

	srv.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Fatalf("unexpected status: %d", rr.Code)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("unexpected content type: %s", got)
	}
	if got := rr.Body.String(); got != `{"var_95":0.12,"expected_return":0.14,"histogram":[],"elapsed_ms":7}` {
		t.Fatalf("unexpected body: %s", got)
	}
}

func TestHealth(t *testing.T) {
	srv := New(Config{
		MarketData: stubMarketDataProvider{
			supported: map[string]struct{}{
				"AAPL": {},
			},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()

	srv.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rr.Code)
	}
	body, _ := io.ReadAll(rr.Body)
	if string(body) != "{\"status\":\"ok\"}\n" {
		t.Fatalf("unexpected body: %s", string(body))
	}
}

func TestSupportedTickers(t *testing.T) {
	srv := New(Config{
		MarketData: stubMarketDataProvider{
			supported: map[string]struct{}{
				"AAPL": {},
			},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/supported-tickers", nil)
	rr := httptest.NewRecorder()

	srv.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rr.Code)
	}

	var body supportedTickersResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}

	if body.Provider != "Test Provider" {
		t.Fatalf("unexpected provider: %s", body.Provider)
	}
	if body.Range != "3y" {
		t.Fatalf("unexpected range: %s", body.Range)
	}
	if body.MaxPortfolioTickers != 5 {
		t.Fatalf("unexpected max tickers: %d", body.MaxPortfolioTickers)
	}
	if body.PaddedAssetCount != paddedSize {
		t.Fatalf("unexpected padded count: %d", body.PaddedAssetCount)
	}
	if len(body.Tickers) != 5 {
		t.Fatalf("unexpected tickers: %#v", body.Tickers)
	}
}
