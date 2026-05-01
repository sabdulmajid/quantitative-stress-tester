package gateway

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMarketDataFallsBackToStaleCacheOnRateLimit(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(testYahooPayload(80)))
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	provider := NewMarketDataProvider(MarketDataProviderConfig{
		BaseURL:      server.URL,
		CacheTTL:     time.Minute,
		HTTPClient:   server.Client(),
		FetchMinWait: time.Nanosecond,
		FetchMaxWait: time.Nanosecond,
	})
	provider.now = func() time.Time { return now }

	first, err := provider.PortfolioInputs(context.Background(), []string{"AAPL"})
	if err != nil {
		t.Fatalf("first fetch failed: %v", err)
	}
	if len(first.Mu) != 1 || len(first.Covariance) != 1 {
		t.Fatalf("unexpected first moment shape: %#v", first)
	}

	now = now.Add(2 * time.Minute)
	second, err := provider.PortfolioInputs(context.Background(), []string{"AAPL"})
	if err != nil {
		t.Fatalf("stale fallback failed: %v", err)
	}
	if len(second.Mu) != 1 || len(second.Covariance) != 1 {
		t.Fatalf("unexpected fallback moment shape: %#v", second)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected one successful fetch and one rate-limited fetch, got %d calls", calls.Load())
	}
}

func testYahooPayload(points int) string {
	timestamps := make([]string, 0, points)
	prices := make([]string, 0, points)
	start := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)
	for index := 0; index < points; index++ {
		timestamps = append(timestamps, fmt.Sprintf("%d", start.AddDate(0, 0, index).Unix()))
		prices = append(prices, fmt.Sprintf("%.2f", 100+float64(index)*0.4))
	}
	return fmt.Sprintf(
		`{"chart":{"result":[{"timestamp":[%s],"indicators":{"adjclose":[{"adjclose":[%s]}],"quote":[{"close":[%s]}]}}],"error":null}}`,
		strings.Join(timestamps, ","),
		strings.Join(prices, ","),
		strings.Join(prices, ","),
	)
}
