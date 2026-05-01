package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultMarketDataBaseURL = "https://query1.finance.yahoo.com"
	defaultMarketDataRange   = "3y"
	defaultMarketDataCache   = 6 * time.Hour
	defaultFetchWorkers      = 2
	defaultFetchMinWait      = 120 * time.Millisecond
	defaultFetchMaxWait      = 320 * time.Millisecond
	marketDataUserAgent      = "Mozilla/5.0 (compatible; QuantStressEngine/1.0; +https://help.yahoo.com/kb/SLN28256.html)"
	maxMarketDataAttempts    = 3
	initialRetryBackoff      = 250 * time.Millisecond
	maxRetryBackoff          = 2 * time.Second
	tradingDaysPerYear       = 252.0
)

var supportedTickers = map[string]string{
	"AAPL":  "AAPL",
	"MSFT":  "MSFT",
	"TSLA":  "TSLA",
	"SPY":   "SPY",
	"GLD":   "GLD",
	"NVDA":  "NVDA",
	"AMZN":  "AMZN",
	"META":  "META",
	"GOOGL": "GOOGL",
	"NFLX":  "NFLX",
	"JPM":   "JPM",
	"V":     "V",
	"WMT":   "WMT",
	"JNJ":   "JNJ",
	"PG":    "PG",
	"QQQ":   "QQQ",
	"IWM":   "IWM",
	"TLT":   "TLT",
	"XLE":   "XLE",
	"XLF":   "XLF",
	"XLK":   "XLK",
	"XLV":   "XLV",
}

type marketDataProvider interface {
	Supports(symbol string) bool
	SupportedTickers() []string
	ProviderName() string
	HistoryRange() string
	CacheTTL() time.Duration
	PortfolioInputs(ctx context.Context, tickers []string) (marketInputs, error)
}

type marketInputs struct {
	Mu         []float64
	Covariance [][]float64
}

type MarketDataProviderConfig struct {
	BaseURL      string
	Range        string
	CacheTTL     time.Duration
	HTTPClient   *http.Client
	RedisURL     string
	FetchWorkers int
	FetchMinWait time.Duration
	FetchMaxWait time.Duration
	Logger       *slog.Logger
}

type MarketDataProvider struct {
	baseURL      string
	historyRange string
	cacheTTL     time.Duration
	client       *http.Client
	now          func() time.Time
	logger       *slog.Logger
	fetchWorkers int
	fetchMinWait time.Duration
	fetchMaxWait time.Duration

	cache seriesCache
}

type historicalSeriesCacheEntry struct {
	expiresAt time.Time
	series    []pricePoint
}

type pricePoint struct {
	date          string
	adjustedClose float64
}

type seriesCache interface {
	Fresh(ctx context.Context, ticker string, now time.Time) ([]pricePoint, bool)
	Last(ctx context.Context, ticker string) ([]pricePoint, bool)
	Store(ctx context.Context, ticker string, series []pricePoint, expiresAt time.Time) error
}

type redisSeriesCachePayload struct {
	ExpiresAt time.Time         `json:"expires_at"`
	Series    []redisPricePoint `json:"series"`
}

type redisPricePoint struct {
	Date          string  `json:"date"`
	AdjustedClose float64 `json:"adjusted_close"`
}

type memorySeriesCache struct {
	mu    sync.RWMutex
	items map[string]historicalSeriesCacheEntry
}

type redisSeriesCache struct {
	client *redis.Client
	prefix string
}

type hybridSeriesCache struct {
	primary  seriesCache
	fallback seriesCache
}

type marketDataHTTPError struct {
	statusCode int
	ticker     string
}

func (e marketDataHTTPError) Error() string {
	return fmt.Sprintf("market data provider returned status %d for %s", e.statusCode, e.ticker)
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
	fetchWorkers := cfg.FetchWorkers
	if fetchWorkers <= 0 {
		fetchWorkers = defaultFetchWorkers
	}
	fetchMinWait := cfg.FetchMinWait
	if fetchMinWait <= 0 {
		fetchMinWait = defaultFetchMinWait
	}
	fetchMaxWait := cfg.FetchMaxWait
	if fetchMaxWait < fetchMinWait {
		fetchMaxWait = fetchMinWait
	}

	var cache seriesCache = newMemorySeriesCache()
	if redisCache := newRedisSeriesCache(cfg.RedisURL, historyRange, cfg.Logger); redisCache != nil {
		cache = &hybridSeriesCache{primary: redisCache, fallback: cache}
	}

	return &MarketDataProvider{
		baseURL:      baseURL,
		historyRange: historyRange,
		cacheTTL:     cacheTTL,
		client:       client,
		now:          time.Now,
		logger:       cfg.Logger,
		fetchWorkers: fetchWorkers,
		fetchMinWait: fetchMinWait,
		fetchMaxWait: fetchMaxWait,
		cache:        cache,
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

func (p *MarketDataProvider) PortfolioInputs(ctx context.Context, tickers []string) (marketInputs, error) {
	type result struct {
		index  int
		series []pricePoint
		err    error
	}
	type job struct {
		index  int
		ticker string
	}

	if len(tickers) == 0 {
		return marketInputs{}, errors.New("at least one ticker is required")
	}

	seriesByTicker := make([][]pricePoint, len(tickers))
	missing := make([]job, 0, len(tickers))
	for index, ticker := range tickers {
		normalized := strings.ToUpper(strings.TrimSpace(ticker))
		if cached, ok := p.cache.Fresh(ctx, normalized, p.now()); ok {
			seriesByTicker[index] = cached
			continue
		}
		missing = append(missing, job{index: index, ticker: normalized})
	}
	if len(missing) == 0 {
		mu, covariance, err := computeAnnualizedMoments(seriesByTicker)
		if err != nil {
			return marketInputs{}, err
		}
		return marketInputs{Mu: mu, Covariance: covariance}, nil
	}

	workerCount := p.fetchWorkers
	if workerCount > len(missing) {
		workerCount = len(missing)
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan job)
	results := make(chan result, len(missing))
	var wg sync.WaitGroup
	for worker := 0; worker < workerCount; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for task := range jobs {
				series, err := p.fetchHistoricalSeries(ctx, task.ticker)
				select {
				case results <- result{index: task.index, series: series, err: err}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for index, task := range missing {
			if index > 0 {
				if err := waitWithJitter(ctx, p.fetchMinWait, p.fetchMaxWait); err != nil {
					return
				}
			}
			select {
			case jobs <- task:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	var firstErr error
	for result := range results {
		if result.err != nil {
			if firstErr == nil {
				firstErr = result.err
				cancel()
			}
			continue
		}
		seriesByTicker[result.index] = result.series
	}
	if firstErr != nil {
		return marketInputs{}, firstErr
	}
	if err := ctx.Err(); err != nil {
		return marketInputs{}, err
	}

	mu, covariance, err := computeAnnualizedMoments(seriesByTicker)
	if err != nil {
		return marketInputs{}, err
	}
	return marketInputs{Mu: mu, Covariance: covariance}, nil
}

func (p *MarketDataProvider) fetchHistoricalSeries(ctx context.Context, ticker string) ([]pricePoint, error) {
	normalized := strings.ToUpper(strings.TrimSpace(ticker))
	if cached, ok := p.cache.Fresh(ctx, normalized, p.now()); ok {
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
			if storeErr := p.cache.Store(ctx, normalized, series, p.now().Add(p.cacheTTL)); storeErr != nil {
				p.logCacheWarning("market data cache store failed", normalized, storeErr)
			}
			return cloneSeries(series), nil
		}

		lastErr = err
		if isRateLimitError(err) {
			if stale, ok := p.cache.Last(ctx, normalized); ok {
				p.logCacheWarning("using stale market data after rate limit", normalized, err)
				return stale, nil
			}
		}
		if !retryable || attempt == maxMarketDataAttempts {
			break
		}

		wait := retryAfter
		if wait <= 0 {
			wait = jitterDuration(backoff, minDuration(backoff*2, maxRetryBackoff))
			backoff = minDuration(backoff*2, maxRetryBackoff)
		}

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}

	if isRateLimitError(lastErr) {
		if stale, ok := p.cache.Last(ctx, normalized); ok {
			p.logCacheWarning("using stale market data after exhausted rate-limit retries", normalized, lastErr)
			return stale, nil
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
		return nil, retryable, parseRetryAfter(response.Header.Get("Retry-After")), marketDataHTTPError{
			statusCode: response.StatusCode,
			ticker:     ticker,
		}
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

func newMemorySeriesCache() *memorySeriesCache {
	return &memorySeriesCache{items: make(map[string]historicalSeriesCacheEntry)}
}

func (c *memorySeriesCache) Fresh(_ context.Context, ticker string, now time.Time) ([]pricePoint, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.items[ticker]
	if !ok || now.After(entry.expiresAt) {
		return nil, false
	}
	return cloneSeries(entry.series), true
}

func (c *memorySeriesCache) Last(_ context.Context, ticker string) ([]pricePoint, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.items[ticker]
	if !ok {
		return nil, false
	}
	return cloneSeries(entry.series), true
}

func (c *memorySeriesCache) Store(_ context.Context, ticker string, series []pricePoint, expiresAt time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[ticker] = historicalSeriesCacheEntry{
		expiresAt: expiresAt,
		series:    cloneSeries(series),
	}
	return nil
}

func newRedisSeriesCache(rawURL string, historyRange string, logger *slog.Logger) *redisSeriesCache {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil
	}
	options, err := redis.ParseURL(trimmed)
	if err != nil {
		if logger != nil {
			logger.Warn("invalid redis url; using in-memory market cache only", slog.String("error", err.Error()))
		}
		return nil
	}
	return &redisSeriesCache{
		client: redis.NewClient(options),
		prefix: fmt.Sprintf("quant-stress:%s", strings.TrimSpace(historyRange)),
	}
}

func (c *redisSeriesCache) Fresh(ctx context.Context, ticker string, now time.Time) ([]pricePoint, bool) {
	payload, ok := c.get(ctx, ticker)
	if !ok || now.After(payload.ExpiresAt) {
		return nil, false
	}
	return redisPayloadToSeries(payload.Series), true
}

func (c *redisSeriesCache) Last(ctx context.Context, ticker string) ([]pricePoint, bool) {
	payload, ok := c.get(ctx, ticker)
	if !ok {
		return nil, false
	}
	return redisPayloadToSeries(payload.Series), true
}

func (c *redisSeriesCache) Store(ctx context.Context, ticker string, series []pricePoint, expiresAt time.Time) error {
	payload := redisSeriesCachePayload{
		ExpiresAt: expiresAt,
		Series:    seriesToRedisPayload(series),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return c.client.Set(ctx, c.key(ticker), encoded, 0).Err()
}

func (c *redisSeriesCache) get(ctx context.Context, ticker string) (redisSeriesCachePayload, bool) {
	raw, err := c.client.Get(ctx, c.key(ticker)).Bytes()
	if err != nil {
		return redisSeriesCachePayload{}, false
	}

	var payload redisSeriesCachePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return redisSeriesCachePayload{}, false
	}
	if len(payload.Series) == 0 {
		return redisSeriesCachePayload{}, false
	}
	return payload, true
}

func (c *redisSeriesCache) key(ticker string) string {
	return fmt.Sprintf("%s:%s", c.prefix, strings.ToUpper(strings.TrimSpace(ticker)))
}

func (c *hybridSeriesCache) Fresh(ctx context.Context, ticker string, now time.Time) ([]pricePoint, bool) {
	if series, ok := c.primary.Fresh(ctx, ticker, now); ok {
		return series, true
	}
	return c.fallback.Fresh(ctx, ticker, now)
}

func (c *hybridSeriesCache) Last(ctx context.Context, ticker string) ([]pricePoint, bool) {
	if series, ok := c.primary.Last(ctx, ticker); ok {
		return series, true
	}
	return c.fallback.Last(ctx, ticker)
}

func (c *hybridSeriesCache) Store(ctx context.Context, ticker string, series []pricePoint, expiresAt time.Time) error {
	_ = c.fallback.Store(ctx, ticker, series, expiresAt)
	return c.primary.Store(ctx, ticker, series, expiresAt)
}

func cloneSeries(series []pricePoint) []pricePoint {
	out := make([]pricePoint, len(series))
	copy(out, series)
	return out
}

func seriesToRedisPayload(series []pricePoint) []redisPricePoint {
	out := make([]redisPricePoint, len(series))
	for i, point := range series {
		out[i] = redisPricePoint{Date: point.date, AdjustedClose: point.adjustedClose}
	}
	return out
}

func redisPayloadToSeries(series []redisPricePoint) []pricePoint {
	out := make([]pricePoint, len(series))
	for i, point := range series {
		out[i] = pricePoint{date: point.Date, adjustedClose: point.AdjustedClose}
	}
	return out
}

func waitWithJitter(ctx context.Context, minimum time.Duration, maximum time.Duration) error {
	wait := jitterDuration(minimum, maximum)
	if wait <= 0 {
		return nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func jitterDuration(minimum time.Duration, maximum time.Duration) time.Duration {
	if maximum <= minimum {
		return minimum
	}
	spread := maximum - minimum
	return minimum + time.Duration(rand.Int63n(int64(spread)+1))
}

func minDuration(a time.Duration, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func isRateLimitError(err error) bool {
	var httpErr marketDataHTTPError
	return errors.As(err, &httpErr) && httpErr.statusCode == http.StatusTooManyRequests
}

func (p *MarketDataProvider) logCacheWarning(message string, ticker string, err error) {
	if p.logger == nil {
		return
	}
	p.logger.Warn(
		message,
		slog.String("ticker", ticker),
		slog.String("error", err.Error()),
	)
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
