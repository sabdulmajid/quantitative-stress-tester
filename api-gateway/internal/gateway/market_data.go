package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultMarketDataBaseURL = "https://query1.finance.yahoo.com"
	defaultMarketDataRange   = "3y"
	defaultMarketDataCache   = 6 * time.Hour
	marketDataUserAgent      = "Mozilla/5.0 (compatible; QuantStressEngine/1.0; +https://help.yahoo.com/kb/SLN28256.html)"
	maxMarketDataAttempts    = 3
	initialRetryBackoff      = 250 * time.Millisecond
	tradingDaysPerYear       = 252.0
)

var supportedTickers = map[string]string{
	"AAPL": "AAPL",
	"MSFT": "MSFT",
	"TSLA": "TSLA",
	"SPY":  "SPY",
	"GLD":  "GLD",
}

type marketDataProvider interface {
	Supports(symbol string) bool
	SupportedTickers() []string
	ProviderName() string
	HistoryRange() string
	CacheTTL() time.Duration
	PortfolioInputs(ctx context.Context, tickers []string) ([]float64, [][]float64, error)
}

type MarketDataProviderConfig struct {
	BaseURL    string
	Range      string
	CacheTTL   time.Duration
	HTTPClient *http.Client
}

type MarketDataProvider struct {
	baseURL      string
	historyRange string
	cacheTTL     time.Duration
	client       *http.Client
	now          func() time.Time

	mu    sync.RWMutex
	cache map[string]historicalSeriesCacheEntry
}

type historicalSeriesCacheEntry struct {
	expiresAt time.Time
	series    []pricePoint
}

type pricePoint struct {
	date          string
	adjustedClose float64
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Close []*float64 `json:"close"`
				} `json:"quote"`
				AdjClose []struct {
					AdjClose []*float64 `json:"adjclose"`
				} `json:"adjclose"`
			} `json:"indicators"`
		} `json:"result"`
		Error any `json:"error"`
	} `json:"chart"`
}

func NewMarketDataProvider(cfg MarketDataProviderConfig) *MarketDataProvider {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultMarketDataBaseURL
	}
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "https://" + baseURL
	}

	historyRange := strings.TrimSpace(cfg.Range)
	if historyRange == "" {
		historyRange = defaultMarketDataRange
	}

	cacheTTL := cfg.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = defaultMarketDataCache
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	return &MarketDataProvider{
		baseURL:      baseURL,
		historyRange: historyRange,
		cacheTTL:     cacheTTL,
		client:       client,
		now:          time.Now,
		cache:        make(map[string]historicalSeriesCacheEntry),
	}
}

func (p *MarketDataProvider) Supports(symbol string) bool {
	_, ok := supportedTickers[strings.ToUpper(strings.TrimSpace(symbol))]
	return ok
}

func (p *MarketDataProvider) SupportedTickers() []string {
	tickers := make([]string, 0, len(supportedTickers))
	for ticker := range supportedTickers {
		tickers = append(tickers, ticker)
	}
	sort.Strings(tickers)
	return tickers
}

func (p *MarketDataProvider) ProviderName() string {
	return "Yahoo Finance"
}

func (p *MarketDataProvider) HistoryRange() string {
	return p.historyRange
}

func (p *MarketDataProvider) CacheTTL() time.Duration {
	return p.cacheTTL
}

func (p *MarketDataProvider) PortfolioInputs(ctx context.Context, tickers []string) ([]float64, [][]float64, error) {
	type result struct {
		index  int
		series []pricePoint
		err    error
	}

	results := make(chan result, len(tickers))
	for index, ticker := range tickers {
		go func(index int, ticker string) {
			series, err := p.fetchHistoricalSeries(ctx, ticker)
			results <- result{index: index, series: series, err: err}
		}(index, ticker)
	}

	seriesByTicker := make([][]pricePoint, len(tickers))
	for range tickers {
		result := <-results
		if result.err != nil {
			return nil, nil, result.err
		}
		seriesByTicker[result.index] = result.series
	}

	return computeAnnualizedMoments(seriesByTicker)
}

func (p *MarketDataProvider) fetchHistoricalSeries(ctx context.Context, ticker string) ([]pricePoint, error) {
	normalized := strings.ToUpper(strings.TrimSpace(ticker))
	if cached, ok := p.cachedSeries(normalized); ok {
		return cached, nil
	}

	symbol, ok := supportedTickers[normalized]
	if !ok {
		return nil, fmt.Errorf("unsupported ticker %q", ticker)
	}

	endpoint, err := url.Parse(fmt.Sprintf("%s/v8/finance/chart/%s", p.baseURL, url.PathEscape(symbol)))
	if err != nil {
		return nil, err
	}

	query := endpoint.Query()
	query.Set("range", p.historyRange)
	query.Set("interval", "1d")
	query.Set("includeAdjustedClose", "true")
	query.Set("events", "div,splits")
	endpoint.RawQuery = query.Encode()

	backoff := initialRetryBackoff
	var lastErr error

	for attempt := 1; attempt <= maxMarketDataAttempts; attempt++ {
		series, retryable, retryAfter, err := p.fetchHistoricalSeriesOnce(ctx, normalized, endpoint.String())
		if err == nil {
			p.storeSeries(normalized, series)
			return cloneSeries(series), nil
		}

		lastErr = err
		if !retryable || attempt == maxMarketDataAttempts {
			break
		}

		wait := retryAfter
		if wait <= 0 {
			wait = backoff
			backoff *= 2
		}

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}

	return nil, lastErr
}

func (p *MarketDataProvider) fetchHistoricalSeriesOnce(ctx context.Context, ticker string, endpoint string) ([]pricePoint, bool, time.Duration, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, false, 0, err
	}
	request.Header.Set("User-Agent", marketDataUserAgent)

	response, err := p.client.Do(request)
	if err != nil {
		return nil, true, 0, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		retryable := response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= http.StatusInternalServerError
		return nil, retryable, parseRetryAfter(response.Header.Get("Retry-After")), fmt.Errorf("market data provider returned status %d for %s", response.StatusCode, ticker)
	}

	var payload yahooChartResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, false, 0, fmt.Errorf("decode market data payload for %s: %w", ticker, err)
	}

	series, err := parseYahooSeries(payload)
	if err != nil {
		return nil, false, 0, fmt.Errorf("parse market data for %s: %w", ticker, err)
	}
	if len(series) < 60 {
		return nil, false, 0, fmt.Errorf("not enough historical observations for %s", ticker)
	}

	return series, false, 0, nil
}

func parseYahooSeries(payload yahooChartResponse) ([]pricePoint, error) {
	if len(payload.Chart.Result) == 0 {
		return nil, errors.New("missing chart result")
	}

	result := payload.Chart.Result[0]
	if len(result.Timestamp) == 0 {
		return nil, errors.New("missing timestamps")
	}

	var adjustedCloses []*float64
	if len(result.Indicators.AdjClose) > 0 {
		adjustedCloses = result.Indicators.AdjClose[0].AdjClose
	}

	var closes []*float64
	if len(result.Indicators.Quote) > 0 {
		closes = result.Indicators.Quote[0].Close
	}

	if len(adjustedCloses) == 0 && len(closes) == 0 {
		return nil, errors.New("missing close series")
	}

	points := make([]pricePoint, 0, len(result.Timestamp))
	for index, timestamp := range result.Timestamp {
		value := pickPrice(adjustedCloses, closes, index)
		if value == nil || *value <= 0 || math.IsNaN(*value) || math.IsInf(*value, 0) {
			continue
		}
		points = append(points, pricePoint{
			date:          time.Unix(timestamp, 0).UTC().Format("2006-01-02"),
			adjustedClose: *value,
		})
	}

	if len(points) < 2 {
		return nil, errors.New("not enough valid price points")
	}

	sort.Slice(points, func(i, j int) bool {
		return points[i].date < points[j].date
	})
	return points, nil
}

func pickPrice(adjustedCloses []*float64, closes []*float64, index int) *float64 {
	if index < len(adjustedCloses) && adjustedCloses[index] != nil {
		return adjustedCloses[index]
	}
	if index < len(closes) && closes[index] != nil {
		return closes[index]
	}
	return nil
}

func computeAnnualizedMoments(seriesByTicker [][]pricePoint) ([]float64, [][]float64, error) {
	alignedDates := intersectDates(seriesByTicker)
	if len(alignedDates) < 2 {
		return nil, nil, errors.New("not enough overlapping historical dates")
	}

	returnSeries := make([][]float64, len(seriesByTicker))
	for i, series := range seriesByTicker {
		byDate := make(map[string]float64, len(series))
		for _, point := range series {
			byDate[point.date] = point.adjustedClose
		}

		returns := make([]float64, 0, len(alignedDates)-1)
		for j := 1; j < len(alignedDates); j++ {
			previous := byDate[alignedDates[j-1]]
			current := byDate[alignedDates[j]]
			if previous <= 0 || current <= 0 {
				return nil, nil, errors.New("non-positive close encountered in aligned series")
			}
			returns = append(returns, math.Log(current/previous))
		}
		returnSeries[i] = returns
	}

	sampleCount := len(returnSeries[0])
	if sampleCount < 2 {
		return nil, nil, errors.New("not enough overlapping return observations")
	}

	means := make([]float64, len(returnSeries))
	for i, returns := range returnSeries {
		total := 0.0
		for _, value := range returns {
			total += value
		}
		means[i] = (total / float64(len(returns))) * tradingDaysPerYear
	}

	covariance := make([][]float64, len(returnSeries))
	for i := range covariance {
		covariance[i] = make([]float64, len(returnSeries))
	}

	for i := range returnSeries {
		for j := i; j < len(returnSeries); j++ {
			meanI := means[i] / tradingDaysPerYear
			meanJ := means[j] / tradingDaysPerYear
			sum := 0.0
			for k := 0; k < sampleCount; k++ {
				sum += (returnSeries[i][k] - meanI) * (returnSeries[j][k] - meanJ)
			}
			value := (sum / float64(sampleCount-1)) * tradingDaysPerYear
			covariance[i][j] = value
			covariance[j][i] = value
		}
	}

	return means, covariance, nil
}

func intersectDates(seriesByTicker [][]pricePoint) []string {
	if len(seriesByTicker) == 0 {
		return nil
	}

	counts := make(map[string]int, len(seriesByTicker[0]))
	for _, point := range seriesByTicker[0] {
		counts[point.date] = 1
	}

	for _, series := range seriesByTicker[1:] {
		seen := make(map[string]struct{}, len(series))
		for _, point := range series {
			seen[point.date] = struct{}{}
		}
		for date, count := range counts {
			if _, ok := seen[date]; ok {
				counts[date] = count + 1
			}
		}
	}

	dates := make([]string, 0, len(counts))
	for date, count := range counts {
		if count == len(seriesByTicker) {
			dates = append(dates, date)
		}
	}
	sort.Strings(dates)
	return dates
}

func (p *MarketDataProvider) cachedSeries(ticker string) ([]pricePoint, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	entry, ok := p.cache[ticker]
	if !ok || p.now().After(entry.expiresAt) {
		return nil, false
	}
	return cloneSeries(entry.series), true
}

func (p *MarketDataProvider) storeSeries(ticker string, series []pricePoint) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.cache[ticker] = historicalSeriesCacheEntry{
		expiresAt: p.now().Add(p.cacheTTL),
		series:    cloneSeries(series),
	}
}

func cloneSeries(series []pricePoint) []pricePoint {
	out := make([]pricePoint, len(series))
	copy(out, series)
	return out
}

func parseRetryAfter(value string) time.Duration {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	seconds, err := strconv.Atoi(trimmed)
	if err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}

	retryTime, err := http.ParseTime(trimmed)
	if err != nil {
		return 0
	}

	delay := time.Until(retryTime)
	if delay < 0 {
		return 0
	}
	return delay
}
