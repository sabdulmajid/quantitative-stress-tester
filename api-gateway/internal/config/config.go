package config

import (
	"net/url"
	"os"
	"strconv"
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
	RedisURL           string
	MarketFetchWorkers int
	MarketFetchMinWait time.Duration
	MarketFetchMaxWait time.Duration
}

func Load() Config {
	return Config{
		ListenAddr:         listenAddr(),
		ComputeEngineURL:   normalizeURL(getenv("COMPUTE_ENGINE_URL", "http://localhost:8000")),
		RequestTimeout:     mustDuration(getenv("REQUEST_TIMEOUT", "30s"), 30*time.Second),
		MarketDataBaseURL:  getenv("MARKET_DATA_BASE_URL", "https://query1.finance.yahoo.com"),
		MarketDataRange:    getenv("MARKET_DATA_RANGE", "3y"),
		MarketDataCacheTTL: mustDuration(getenv("MARKET_DATA_CACHE_TTL", "6h"), 6*time.Hour),
		RedisURL:           os.Getenv("REDIS_URL"),
		MarketFetchWorkers: mustInt(getenv("MARKET_DATA_FETCH_WORKERS", "2"), 2),
		MarketFetchMinWait: mustDuration(getenv("MARKET_DATA_FETCH_MIN_WAIT", "120ms"), 120*time.Millisecond),
		MarketFetchMaxWait: mustDuration(getenv("MARKET_DATA_FETCH_MAX_WAIT", "320ms"), 320*time.Millisecond),
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

func mustInt(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
