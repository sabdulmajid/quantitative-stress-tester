# Compute Engine

FastAPI service for fixed-shape GBM-based portfolio stress testing.

## API

- `GET /health`
- `POST /simulate`

## Request Shape

```json
{
  "padded_weights": [0.5, 0.3, 0.2, 0.0, "... up to 50 values"],
  "padded_mu": [0.18, 0.15, 0.08, 0.0, "... up to 50 values"],
  "padded_cov": [[0.07, 0.03, 0.02], "... padded to 50x50"],
  "num_paths": 100000,
  "horizon_days": 252,
  "seed": 42
}
```

## Runtime Notes

- The app prewarms the exact padded `50 x 50` execution shape during FastAPI startup.
- Warm-path runs at the default `100000`-path setting were verified below one second in this environment.
- The histogram response is capped at `50` bins and the raw path array is never returned.
- JAX selected a CPU backend here. For GPU deployment, install a CUDA-enabled JAX build on NVIDIA hosts.
