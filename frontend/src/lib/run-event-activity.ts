import type { ActivityEvent, IncomingRunEvent } from "@/lib/research-run-types";

/** Converts a telemetry event into the optional activity-feed entry it represents. */
export function toActivityEvent(
  event: IncomingRunEvent,
  receivedAt: Date = new Date(),
): ActivityEvent | null {
  const type = event.event || event.type || "unknown";
  const data = event.data || {};
  const timestamp = receivedAt.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const id = `${receivedAt.getTime()}-${Math.random().toString(36).slice(2)}`;

  switch (type) {
    case "search_executed":
      return {
        id,
        timestamp,
        stage: "gather",
        type: "search",
        text: "Searching ",
        rawQuery: data.query || "web search",
      };
    case "source_fetched":
    case "source_discovered": {
      const url = data.url || "";
      let domain = data.domain || "external";
      if (!data.domain && url) {
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = "external";
        }
      }
      return { id, timestamp, stage: "gather", type: "read", text: "Reading ", domain };
    }
    case "evidence_extracted":
      return {
        id,
        timestamp,
        stage: "gather",
        type: "evidence",
        text: `Extracted evidence passages (${data.count || data.total_evidence_units || 0})`,
      };
    case "research_warning":
    case "provider_degraded":
      return {
        id,
        timestamp,
        stage: "gather",
        type: "warning",
        text: String(data.message || data.detail || data.error || "A research service was unavailable."),
      };
    case "llm_call_completed": {
      const tokens = Number(data.tokens_in || 0) + Number(data.tokens_out || 0);
      return {
        id,
        timestamp,
        stage: "write",
        type: "llm",
        text: `${data.agent || "Model"} · ${tokens} tokens · ${Number(data.latency_ms || 0).toFixed(0)} ms`,
      };
    }
    case "critic_completed":
      return {
        id,
        timestamp,
        stage: "audit",
        type: "critic",
        text: "Adversarial audit completed: cross-checked claims",
        criticFinding: data.finding
          ? {
              claim: data.finding.claim,
              conflictingValues: data.finding.conflicting_values,
              resolution: data.finding.resolution,
            }
          : undefined,
      };
    case "section_synthesized":
    case "section_drafted":
      return {
        id,
        timestamp,
        stage: "write",
        type: "write",
        text: `Drafted chapter: ${data.section_title || "Section synthesis"}`,
      };
    case "query_issued": {
      const queries = Array.isArray(data.queries) ? data.queries : [];
      return {
        id,
        timestamp,
        stage: "plan",
        type: "search",
        text: `Planned ${queries.length || 1} search ${queries.length === 1 ? "query" : "queries"} for ${data.category || data.track_id || "a research track"}`,
        rawQuery: data.sub_question || queries[0],
      };
    }
    default:
      return null;
  }
}
