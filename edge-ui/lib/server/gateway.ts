export function normalizeBaseUrl(raw: string | undefined) {
  const fallback = "http://localhost:8080";
  const value = (raw ?? fallback).trim();
  if (!value) return fallback;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/$/, "");
  }
  return `http://${value.replace(/\/$/, "")}`;
}

export function getGatewayBaseUrl() {
  return normalizeBaseUrl(process.env.API_GATEWAY_INTERNAL_URL);
}
