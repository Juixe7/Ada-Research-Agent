/**
 * Centralized configuration for API endpoints.
 *
 * - In local development (localhost:3000), connects to FastAPI at http://localhost:8000.
 * - In production behind Caddy reverse proxy, uses same-origin (window.location.origin)
 *   unless NEXT_PUBLIC_API_URL is explicitly configured.
 */

function resolveApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8000";
    }
    return window.location.origin;
  }
  return "http://localhost:8000";
}

const API_URL = resolveApiUrl();

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

const WS_URL = toWsUrl(API_URL);

export { API_URL, WS_URL };
