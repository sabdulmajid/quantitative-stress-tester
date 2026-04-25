#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request


GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8080").rstrip("/")
COMPUTE_URL = os.environ.get("COMPUTE_URL", "http://localhost:8000").rstrip("/")
UI_URL = os.environ.get("UI_URL", "").rstrip("/")
WARM_THRESHOLD_MS = float(os.environ.get("WARM_THRESHOLD_MS", "1000"))

PAYLOAD = {
    "tickers": ["AAPL", "MSFT", "SPY"],
    "weights": [50, 30, 20],
    "horizon_days": 252,
    "seed": 42,
}


def wait_for_healthcheck(url: str, timeout_seconds: float = 90.0) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status == 200:
                    return
        except urllib.error.URLError:
            time.sleep(1)
    raise SystemExit(f"healthcheck timed out: {url}")


def post_json(url: str, payload: dict[str, object]) -> tuple[dict[str, object], float]:
    request = urllib.request.Request(
        url,
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload).encode("utf-8"),
    )

    started_at = time.perf_counter()
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    return json.loads(body), elapsed_ms


def get_json(url: str) -> tuple[dict[str, object], float]:
    request = urllib.request.Request(url, method="GET")

    started_at = time.perf_counter()
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")
    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    return json.loads(body), elapsed_ms


def assert_ticker_universe(response: dict[str, object]) -> None:
    tickers = response.get("tickers")
    if not isinstance(tickers, list) or len(tickers) < 1:
        raise SystemExit("expected at least one supported ticker")

    for key in ("provider", "range", "cache_ttl_seconds", "max_portfolio_tickers", "padded_asset_count"):
        if key not in response:
            raise SystemExit(f"missing ticker universe key: {key}")


def assert_response_shape(response: dict[str, object]) -> None:
    histogram = response.get("histogram")
    if not isinstance(histogram, list) or len(histogram) != 50:
        raise SystemExit("expected 50 histogram bins in response")

    frequency_total = 0
    for row in histogram:
        if not isinstance(row, dict):
            raise SystemExit("histogram entries must be objects")
        for key in ("bin_start", "bin_end", "frequency"):
            if key not in row:
                raise SystemExit(f"missing histogram key: {key}")
        frequency_total += int(row["frequency"])

    if frequency_total != 100000:
        raise SystemExit(f"expected histogram frequencies to sum to 100000, got {frequency_total}")

    if float(response.get("var_95", -1)) < 0:
        raise SystemExit("expected var_95 to be non-negative")


def main() -> int:
    wait_for_healthcheck(f"{COMPUTE_URL}/health")
    wait_for_healthcheck(f"{GATEWAY_URL}/health")

    ticker_universe, ticker_http_ms = get_json(f"{GATEWAY_URL}/api/v1/supported-tickers")
    assert_ticker_universe(ticker_universe)

    warm_response, warm_http_ms = post_json(f"{GATEWAY_URL}/api/v1/stress-test", PAYLOAD)
    assert_response_shape(warm_response)

    hot_response, hot_http_ms = post_json(f"{GATEWAY_URL}/api/v1/stress-test", PAYLOAD)
    assert_response_shape(hot_response)

    ui_proxy_http_ms = None
    if UI_URL:
        ui_universe, _ = get_json(f"{UI_URL}/api/v1/supported-tickers")
        assert_ticker_universe(ui_universe)
        ui_response, ui_proxy_http_ms = post_json(f"{UI_URL}/api/v1/stress-test", PAYLOAD)
        assert_response_shape(ui_response)

    compute_elapsed_ms = float(hot_response["elapsed_ms"])
    if compute_elapsed_ms >= WARM_THRESHOLD_MS:
        raise SystemExit(
            f"warm compute latency {compute_elapsed_ms:.2f} ms exceeded threshold {WARM_THRESHOLD_MS:.2f} ms"
        )

    print(
        json.dumps(
            {
                "warmup_http_ms": round(warm_http_ms, 2),
                "warm_http_ms": round(hot_http_ms, 2),
                "warm_compute_ms": round(compute_elapsed_ms, 2),
                "ticker_universe_http_ms": round(ticker_http_ms, 2),
                "ui_proxy_http_ms": None if ui_proxy_http_ms is None else round(ui_proxy_http_ms, 2),
                "provider": ticker_universe["provider"],
                "var_95": hot_response["var_95"],
                "expected_return": hot_response["expected_return"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
