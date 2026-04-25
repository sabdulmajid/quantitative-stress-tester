package config

import (
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	ListenAddr         string
	ComputeEngineURL   string
	RequestTimeout     time.Duration
	MarketDataBaseURL  string
	MarketDataRange    string
	MarketDataCacheTTL time.Duration
}

func Load() Config {
	return Config{
		ListenAddr:         listenAddr(),
		ComputeEngineURL:   normalizeURL(getenv("COMPUTE_ENGINE_URL", "http://localhost:8000")),
		RequestTimeout:     mustDuration(getenv("REQUEST_TIMEOUT", "30s"), 30*time.Second),
		MarketDataBaseURL:  getenv("MARKET_DATA_BASE_URL", "https://query1.finance.yahoo.com"),
		MarketDataRange:    getenv("MARKET_DATA_RANGE", "3y"),
		MarketDataCacheTTL: mustDuration(getenv("MARKET_DATA_CACHE_TTL", "6h"), 6*time.Hour),
	}
}

func listenAddr() string {
	if value := os.Getenv("API_GATEWAY_ADDR"); value != "" {
		return value
	}
	if value := os.Getenv("PORT"); value != "" {
		if strings.HasPrefix(value, ":") {
			return value
		}
		return ":" + value
	}
	return ":8080"
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func normalizeURL(raw string) string {
	candidate := strings.TrimRight(raw, "/")
	if _, err := url.ParseRequestURI(candidate); err == nil {
		return candidate
	}
	if _, err := url.ParseRequestURI("http://" + candidate); err == nil {
		return "http://" + candidate
	}
	return "http://localhost:8000"
}

func mustDuration(raw string, fallback time.Duration) time.Duration {
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}
