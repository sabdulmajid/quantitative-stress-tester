from fastapi.testclient import TestClient

from app.main import app
from app.models.stress import DEFAULT_PATHS, HISTOGRAM_BINS, MAX_ASSETS


client = TestClient(app)


def build_payload() -> dict[str, object]:
    weights = [0.5, 0.3, 0.2] + [0.0] * (MAX_ASSETS - 3)
    mu = [0.12, 0.1, 0.08] + [0.0] * (MAX_ASSETS - 3)
    cov = [[0.0 for _ in range(MAX_ASSETS)] for _ in range(MAX_ASSETS)]
    cov[0][0] = 0.04
    cov[1][1] = 0.03
    cov[2][2] = 0.02
    cov[0][1] = cov[1][0] = 0.01
    cov[0][2] = cov[2][0] = 0.008
    cov[1][2] = cov[2][1] = 0.006

    return {
        "padded_weights": weights,
        "padded_mu": mu,
        "padded_cov": cov,
        "num_paths": DEFAULT_PATHS,
        "horizon_days": 252,
        "confidence_level": 0.99,
        "risk_free_rate": 0.02,
        "seed": 7,
    }


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_simulate_endpoint_returns_summary_only() -> None:
    response = client.post("/simulate", json=build_payload())
    assert response.status_code == 200

    body = response.json()
    assert body["elapsed_ms"] >= 0
    assert isinstance(body["expected_return"], float)
    assert body["var_95"] >= 0
    assert body["var_99"] >= body["var_95"]
    assert body["value_at_risk"] == body["var_99"]
    assert body["cvar"] >= body["value_at_risk"]
    assert body["annualized_volatility"] > 0
    assert isinstance(body["sharpe_ratio"], float)
    assert body["confidence_level"] == 0.99
    assert len(body["histogram"]) == HISTOGRAM_BINS
    assert sum(bin_record["frequency"] for bin_record in body["histogram"]) == DEFAULT_PATHS


def test_simulate_endpoint_rejects_bad_padding() -> None:
    payload = build_payload()
    payload["padded_mu"] = [0.1] * 10

    response = client.post("/simulate", json=payload)
    assert response.status_code == 422


def test_simulate_endpoint_rejects_unsupported_confidence_level() -> None:
    payload = build_payload()
    payload["confidence_level"] = 0.975

    response = client.post("/simulate", json=payload)
    assert response.status_code == 422
