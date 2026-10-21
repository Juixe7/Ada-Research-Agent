import { useEffect, useRef, useState } from "react";

import { API_URL } from "@/lib/config";
import type {
  IncomingRunEvent,
  RunEventPayload,
  RunStatus,
  RunStatusSnapshot,
} from "@/lib/research-run-types";

interface UseRunEventStreamOptions {
  runId: string;
  token: string | null;
  enabled: boolean;
  status: RunStatus;
  initialLastEventId: string | null;
  onEvent: (event: IncomingRunEvent) => void;
  onStatus: (snapshot: RunStatusSnapshot) => void;
}

/** Owns the run's resumable event stream and status-polling fallback. */
export function useRunEventStream({
  runId,
  token,
  enabled,
  status,
  initialLastEventId,
  onEvent,
  onStatus,
}: UseRunEventStreamOptions) {
  const [reconnected, setReconnected] = useState(false);
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(onStatus);
  const lastEventIdRef = useRef(initialLastEventId);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!enabled || !token || status !== "running") return;

    lastEventIdRef.current = initialLastEventId;
    const controller = new AbortController();
    let fallbackPoll: number | null = null;
    let reconnectTimer: number | null = null;
    let retryTimer: number | null = null;
    let hadDisconnect = false;

    const stopFallbackPolling = () => {
      if (fallbackPoll !== null) {
        window.clearInterval(fallbackPoll);
        fallbackPoll = null;
      }
    };

    const checkStatusFallback = async () => {
      try {
        const response = await fetch(`${API_URL}/api/report/status/${runId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const snapshot = await response.json() as RunStatusSnapshot;
        onStatusRef.current(snapshot);
        if (["completed", "failed", "cancelled"].includes(String(snapshot.status).toLowerCase())) {
          stopFallbackPolling();
        }
      } catch {
        // Retry on the next poll; the stream may recover independently.
      }
    };

    const startFallbackPolling = () => {
      if (fallbackPoll !== null) return;
      void checkStatusFallback();
      fallbackPoll = window.setInterval(() => void checkStatusFallback(), 3000);
    };

    const waitBeforeReconnect = (delay: number) => new Promise<void>((resolve) => {
      const finish = () => {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = null;
        controller.signal.removeEventListener("abort", finish);
        resolve();
      };
      retryTimer = window.setTimeout(finish, delay);
      controller.signal.addEventListener("abort", finish, { once: true });
    });

    const connect = async () => {
      let retryDelay = 1000;
      let terminalEventReceived = false;

      while (!controller.signal.aborted && !terminalEventReceived) {
        try {
          const headers: Record<string, string> = {
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          };
          if (lastEventIdRef.current) headers["Last-Event-ID"] = lastEventIdRef.current;

          const response = await fetch(`${API_URL}/api/v1/runs/${runId}/events`, {
            headers,
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Event stream returned ${response.status}`);
          }

          stopFallbackPolling();
          if (hadDisconnect) {
            if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
            setReconnected(true);
            reconnectTimer = window.setTimeout(() => setReconnected(false), 2500);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          try {
            while (!controller.signal.aborted) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
              let boundary = buffer.indexOf("\n\n");
              while (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                let eventName = "message";
                const dataLines: string[] = [];
                for (const line of frame.split("\n")) {
                  if (line.startsWith("event:")) eventName = line.slice(6).trim();
                  if (line.startsWith("id:")) lastEventIdRef.current = line.slice(3).trim();
                  if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
                }

                if (dataLines.length) {
                  try {
                    const data = JSON.parse(dataLines.join("\n")) as RunEventPayload;
                    onEventRef.current({ event: eventName, data });
                    if (["run_completed", "run_failed", "run_cancelled"].includes(eventName)) {
                      terminalEventReceived = true;
                    }
                  } catch (error) {
                    console.warn("Event parse error:", error);
                  }
                }
                boundary = buffer.indexOf("\n\n");
              }
              if (terminalEventReceived) break;
            }
          } finally {
            reader.releaseLock();
          }

          if (controller.signal.aborted || terminalEventReceived) break;
          // A clean EOF can still be a proxy interruption; poll while reconnecting.
          hadDisconnect = true;
          startFallbackPolling();
        } catch (error) {
          if (controller.signal.aborted) break;
          hadDisconnect = true;
          startFallbackPolling();
          console.warn("Run event stream disconnected; retrying with status polling.", error);
        }

        if (!controller.signal.aborted && !terminalEventReceived) {
          await waitBeforeReconnect(retryDelay);
          retryDelay = Math.min(retryDelay * 2, 10000);
        }
      }
    };

    void connect();
    return () => {
      controller.abort();
      stopFallbackPolling();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [runId, token, enabled, status, initialLastEventId]);

  return { reconnected };
}
