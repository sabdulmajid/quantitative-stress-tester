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

func (s stubMarketDataProvider) PortfolioInputs(_ context.Context, _ []string) (marketInputs, error) {
	return marketInputs{Mu: s.mu, Covariance: s.cov}, s.err
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
				Tickers: []string{"T00", "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12", "T13", "T14", "T15", "T16", "T17", "T18", "T19", "T20"},
				Weights: []float64{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1},
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
		if payload.ConfidenceLevel != defaultConfidence {
			t.Fatalf("unexpected confidence_level: %v", payload.ConfidenceLevel)
		}
		if payload.RiskFreeRate != defaultRiskFreeRate {
			t.Fatalf("unexpected risk_free_rate: %v", payload.RiskFreeRate)
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
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"var_95":0.12,"var_99":0.2,"value_at_risk":0.12,"cvar":0.15,"annualized_volatility":0.22,"sharpe_ratio":0.54,"confidence_level":0.95,"expected_return":0.14,"histogram":[],"elapsed_ms":7}`))
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

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rr.Code)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("unexpected content type: %s", got)
	}

	var respBody map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&respBody); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if respBody["provider"] != "Test Provider" {
		t.Fatalf("unexpected provider: %v", respBody["provider"])
	}
	if respBody["range"] != "3y" {
		t.Fatalf("unexpected range: %v", respBody["range"])
	}
	if respBody["elapsed_ms"] != float64(7) {
		t.Fatalf("unexpected elapsed_ms: %v", respBody["elapsed_ms"])
	}
	if respBody["data_fetch_ms"] == nil {
		t.Fatalf("missing data_fetch_ms")
	}
	if respBody["total_roundtrip_ms"] == nil {
		t.Fatalf("missing total_roundtrip_ms")
	}
	if got := respBody["value_at_risk"]; got != float64(0.12) {
		t.Fatalf("unexpected value_at_risk: %v", got)
	}
	if got := respBody["cvar"]; got != float64(0.15) {
		t.Fatalf("unexpected cvar: %v", got)
	}
	if got := respBody["annualized_volatility"]; got != float64(0.22) {
		t.Fatalf("unexpected annualized_volatility: %v", got)
	}
	if got := respBody["sharpe_ratio"]; got != float64(0.54) {
		t.Fatalf("unexpected sharpe_ratio: %v", got)
	}
	scenario, ok := respBody["scenario"].(map[string]interface{})
	if !ok || scenario["id"] != "baseline" {
		t.Fatalf("unexpected scenario: %#v", respBody["scenario"])
	}
	contributions, ok := respBody["risk_contributions"].([]interface{})
	if !ok || len(contributions) != 2 {
		t.Fatalf("unexpected risk contributions: %#v", respBody["risk_contributions"])
	}
	correlation, ok := respBody["correlation_matrix"].([]interface{})
	if !ok || len(correlation) != 2 {
		t.Fatalf("unexpected correlation matrix: %#v", respBody["correlation_matrix"])
	}
}

func TestStressTestAppliesScenarioShock(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload computeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode upstream payload: %v", err)
		}

		if got, want := payload.PaddedMu[0], -0.125; got < want-1e-12 || got > want+1e-12 {
			t.Fatalf("unexpected scenario-adjusted mu: %v", got)
		}
		if got, want := payload.PaddedCov[0][0], 0.48; got < want-1e-12 || got > want+1e-12 {
			t.Fatalf("unexpected scenario-adjusted covariance: %v", got)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"var_95":0.2,"var_99":0.31,"value_at_risk":0.31,"cvar":0.36,"annualized_volatility":0.52,"sharpe_ratio":-0.71,"confidence_level":0.99,"expected_return":-0.11,"histogram":[],"elapsed_ms":9}`))
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
			mu: []float64{0.10, 0.08},
			cov: [][]float64{
				{0.20, 0.04},
				{0.04, 0.16},
			},
		},
	})

	reqBody := `{"tickers":["AAPL","MSFT"],"weights":[50,50],"confidence_level":0.99,"scenario_id":"financial_crisis_2008"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/stress-test", bytes.NewBufferString(reqBody))
	rr := httptest.NewRecorder()

	srv.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rr.Code)
	}

	var body stressTestResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Scenario.ID != "financial_crisis_2008" {
		t.Fatalf("unexpected scenario: %#v", body.Scenario)
	}
	if len(body.RiskContributions) != 2 {
		t.Fatalf("unexpected risk contributions: %#v", body.RiskContributions)
	}
	totalContribution := 0.0
	for _, contribution := range body.RiskContributions {
		totalContribution += contribution.ContributionPercent
	}
	if totalContribution < 0.999999 || totalContribution > 1.000001 {
		t.Fatalf("risk contribution percentages should sum to one, got %v", totalContribution)
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
	if body.MaxPortfolioTickers != maxPortfolioTickers {
		t.Fatalf("unexpected max tickers: %d", body.MaxPortfolioTickers)
	}
	if body.PaddedAssetCount != paddedSize {
		t.Fatalf("unexpected padded count: %d", body.PaddedAssetCount)
	}
	if len(body.Tickers) != 5 {
		t.Fatalf("unexpected tickers: %#v", body.Tickers)
	}
	if len(body.Scenarios) != len(macroScenarios) {
		t.Fatalf("unexpected scenarios: %#v", body.Scenarios)
	}
}
