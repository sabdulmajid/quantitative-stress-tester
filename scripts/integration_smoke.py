#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8080").rstrip("/")
COMPUTE_URL = os.environ.get("COMPUTE_URL", "http://localhost:8000").rstrip("/")
UI_URL = os.environ.get("UI_URL", "").rstrip("/")
WARM_THRESHOLD_MS = float(os.environ.get("WARM_THRESHOLD_MS", "1000"))
REQUIRE_AUTH_FLOW = os.environ.get("REQUIRE_AUTH_FLOW", "0") == "1"

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", os.environ.get("SUPABASE_URL", "")).rstrip("/")
SUPABASE_KEY = os.environ.get(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    os.environ.get("SUPABASE_ANON_KEY", ""),
)
SUPABASE_TEST_EMAIL = os.environ.get("SUPABASE_TEST_EMAIL", "")
SUPABASE_TEST_PASSWORD = os.environ.get("SUPABASE_TEST_PASSWORD", "")


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


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 120,
) -> tuple[dict[str, Any], float]:
    request_headers = dict(headers or {})
    data = None
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(url, method=method, headers=request_headers, data=data)
    started_at = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        raise SystemExit(f"{method} {url} failed with {exc.code}: {body}") from exc
    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    return json.loads(body), elapsed_ms


def get_json(url: str, headers: dict[str, str] | None = None) -> tuple[dict[str, Any], float]:
    return request_json("GET", url, headers=headers, timeout=60)


def post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> tuple[dict[str, Any], float]:
    return request_json("POST", url, payload=payload, headers=headers)


def assert_ticker_universe(response: dict[str, Any]) -> list[str]:
    tickers = response.get("tickers")
    if not isinstance(tickers, list) or len(tickers) < 20:
        raise SystemExit("expected at least 20 supported tickers")

    for key in ("provider", "range", "cache_ttl_seconds", "max_portfolio_tickers", "padded_asset_count"):
        if key not in response:
            raise SystemExit(f"missing ticker universe key: {key}")

    scenarios = response.get("scenarios")
    if not isinstance(scenarios, list) or not any(
        isinstance(scenario, dict) and scenario.get("id") == "financial_crisis_2008" for scenario in scenarios
    ):
        raise SystemExit("expected financial_crisis_2008 scenario metadata")

    if int(response["max_portfolio_tickers"]) < 20:
        raise SystemExit("expected max_portfolio_tickers to be at least 20")
    return [str(ticker) for ticker in tickers[:20]]


def build_payload(tickers: list[str]) -> dict[str, Any]:
    weight = round(100 / len(tickers), 6)
    weights = [weight for _ in tickers]
    weights[-1] = round(100 - sum(weights[:-1]), 6)
    return {
        "tickers": tickers,
        "weights": weights,
        "horizon_days": 252,
        "confidence_level": 0.99,
        "risk_free_rate": 0.02,
        "seed": 42,
        "scenario_id": "financial_crisis_2008",
    }


def assert_response_shape(response: dict[str, Any], expected_ticker_count: int) -> None:
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

    required_numeric_keys = (
        "expected_return",
        "var_95",
        "var_99",
        "value_at_risk",
        "cvar",
        "annualized_volatility",
        "sharpe_ratio",
        "elapsed_ms",
        "data_fetch_ms",
        "total_roundtrip_ms",
    )
    for key in required_numeric_keys:
        if not isinstance(response.get(key), (int, float)):
            raise SystemExit(f"missing numeric response key: {key}")

    if float(response["value_at_risk"]) < 0 or float(response["cvar"]) < 0:
        raise SystemExit("expected VaR and CVaR to be non-negative")

    covariance = response.get("covariance_matrix")
    correlation = response.get("correlation_matrix")
    if not isinstance(covariance, list) or len(covariance) != expected_ticker_count:
        raise SystemExit("unexpected covariance matrix shape")
    if not isinstance(correlation, list) or len(correlation) != expected_ticker_count:
        raise SystemExit("unexpected correlation matrix shape")

    scenario = response.get("scenario")
    if not isinstance(scenario, dict) or scenario.get("id") != "financial_crisis_2008":
        raise SystemExit("unexpected scenario metadata in stress response")

    risk_contributions = response.get("risk_contributions")
    if not isinstance(risk_contributions, list) or len(risk_contributions) != expected_ticker_count:
        raise SystemExit("unexpected risk contribution shape")
    contribution_total = 0.0
    for contribution in risk_contributions:
        if not isinstance(contribution, dict):
            raise SystemExit("risk contribution entries must be objects")
        for key in ("ticker", "weight", "marginal_volatility", "volatility_contribution", "contribution_percent"):
            if key not in contribution:
                raise SystemExit(f"missing risk contribution key: {key}")
        contribution_total += float(contribution["contribution_percent"])
    if not 0.99 <= contribution_total <= 1.01:
        raise SystemExit(f"risk contribution percentages should sum to one, got {contribution_total}")


def supabase_login() -> str | None:
    if not (SUPABASE_URL and SUPABASE_KEY and SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD):
        if REQUIRE_AUTH_FLOW:
            raise SystemExit("auth flow required but Supabase test credentials are not configured")
        return None

    payload = {"email": SUPABASE_TEST_EMAIL, "password": SUPABASE_TEST_PASSWORD}
    response, _ = post_json(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        payload,
        headers={"apikey": SUPABASE_KEY},
    )
    token = response.get("access_token")
    if not isinstance(token, str) or not token:
        raise SystemExit("Supabase login did not return an access token")
    return token


def run_authenticated_ui_flow(payload: dict[str, Any]) -> str:
    if not UI_URL:
        if REQUIRE_AUTH_FLOW:
            raise SystemExit("auth flow required but UI_URL is not configured")
        return "skipped:no-ui-url"

    ui_universe, _ = get_json(f"{UI_URL}/api/v1/supported-tickers")
    assert_ticker_universe(ui_universe)

    token = supabase_login()
    if token is None:
        return "skipped:no-supabase-credentials"

    auth_headers = {"Authorization": f"Bearer {token}"}
    ui_response, _ = post_json(f"{UI_URL}/api/v1/stress-test", payload, headers=auth_headers)
    assert_response_shape(ui_response, expected_ticker_count=20)

    history, _ = get_json(f"{UI_URL}/api/v1/history", headers=auth_headers)
    runs = history.get("runs")
    if not isinstance(runs, list) or len(runs) == 0:
        raise SystemExit("expected authenticated stress run history")
    latest = runs[0]
    if not isinstance(latest, dict) or len(latest.get("tickers", [])) != 20:
        raise SystemExit("latest saved run did not contain the 20-ticker portfolio")
    if float(latest.get("value_at_risk", -1)) < 0:
        raise SystemExit("latest saved run is missing value_at_risk")
    return "verified"


def main() -> int:
    wait_for_healthcheck(f"{COMPUTE_URL}/health")
    wait_for_healthcheck(f"{GATEWAY_URL}/health")

    ticker_universe, ticker_http_ms = get_json(f"{GATEWAY_URL}/api/v1/supported-tickers")
    tickers = assert_ticker_universe(ticker_universe)
    payload = build_payload(tickers)

    warm_response, warm_http_ms = post_json(f"{GATEWAY_URL}/api/v1/stress-test", payload)
    assert_response_shape(warm_response, expected_ticker_count=20)

    hot_response, hot_http_ms = post_json(f"{GATEWAY_URL}/api/v1/stress-test", payload)
    assert_response_shape(hot_response, expected_ticker_count=20)

    authenticated_flow = run_authenticated_ui_flow(payload)

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
                "data_fetch_ms": round(float(hot_response["data_fetch_ms"]), 2),
                "total_roundtrip_ms": round(float(hot_response["total_roundtrip_ms"]), 2),
                "ticker_universe_http_ms": round(ticker_http_ms, 2),
                "authenticated_ui_flow": authenticated_flow,
                "provider": ticker_universe["provider"],
                "ticker_count": len(tickers),
                "confidence_level": hot_response["confidence_level"],
                "value_at_risk": hot_response["value_at_risk"],
                "cvar": hot_response["cvar"],
                "annualized_volatility": hot_response["annualized_volatility"],
                "sharpe_ratio": hot_response["sharpe_ratio"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
