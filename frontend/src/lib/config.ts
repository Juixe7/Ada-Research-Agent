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

/**
 * Formats a dossier creation timestamp safely.
 * Handles ISO strings, Unix timestamps in seconds (< 1e11), and Unix milliseconds.
 * Guaranteed never to produce 1970 for modern timestamps.
 */
export function formatDossierDate(val: string | number | undefined | null): string {
  if (!val) return "Recent";

  let d: Date;
  if (typeof val === "number") {
    d = new Date(val < 1e11 ? val * 1000 : val);
  } else {
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      d = new Date(num < 1e11 ? num * 1000 : num);
    } else {
      d = new Date(val);
    }
  }

  if (isNaN(d.getTime()) || d.getFullYear() <= 1971) {
    return "Recent";
  }

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export { API_URL, WS_URL };
