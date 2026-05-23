wrk.method = "POST"
wrk.headers["Content-Type"] = "application/json"
wrk.body = [[
{
  "tickers": [
    "AAPL",
    "AMZN",
    "GLD",
    "GOOGL",
    "IWM",
    "JNJ",
    "JPM",
    "META",
    "MSFT",
    "NFLX",
    "NVDA",
    "PG",
    "QQQ",
    "SPY",
    "TLT",
    "TSLA",
    "V",
    "WMT",
    "XLE",
    "XLF"
  ],
  "weights": [
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5,
    5
  ],
  "horizon_days": 252,
  "confidence_level": 0.99,
  "risk_free_rate": 0.02,
  "seed": 42,
  "scenario_id": "financial_crisis_2008"
}
]]
