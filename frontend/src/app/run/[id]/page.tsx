"use client";

import React, { useState, useEffect, useRef, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Search, FileText, ExternalLink, AlertTriangle,
  Check, Clock, X, ChevronDown, ChevronRight, Filter,
  RotateCcw, BookOpen, ShieldCheck, ArrowUpRight
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

// Pipeline 6-stage definition matching Blueprint & Design Guide Section 7.3
const PIPELINE_STAGES = [
  { id: "scope", label: "Scope" },
  { id: "plan", label: "Plan" },
  { id: "gather", label: "Gather" },
  { id: "audit", label: "Audit" },
  { id: "write", label: "Write" },
  { id: "verify", label: "Verify" },
];

interface ResearchTrack {
  id: string | number;
  title: string;
  status: "pending" | "running" | "completed";
  sources_count: number;
  queries_count: number;
  progress_pct: number;
}

interface ActivityEvent {
  id: string;
  timestamp: string;
  stage: string;
  type: string;
  text: string;
  rawQuery?: string;
  domain?: string;
  criticFinding?: {
    claim?: string;
    conflictingValues?: string[];
    resolution?: string;
  };
}

interface SourceItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  date?: string;
  authorityDots: number; // 1 to 5
  isVault: boolean;
  excerpt?: string;
  trackId?: string | number;
  isNew?: boolean;
}

export default function LiveInvestigationHeroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const runId = resolvedParams.id;
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace(`/login?redirect=${encodeURIComponent(`/run/${runId}`)}`);
    }
  }, [authLoading, token, router, runId]);

  // Run Metadata
  const [query, setQuery] = useState("Research run");
  const [depth, setDepth] = useState("standard");
  const [status, setStatus] = useState<"running" | "completed" | "failed" | "cancelled">("running");
  const [runLoaded, setRunLoaded] = useState(false);
  const [runLoadError, setRunLoadError] = useState(false);
  const [activeStage, setActiveStage] = useState("gather");
  const [stageProgressNote, setStageProgressNote] = useState("Gathering web evidence & vault docs");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const lastEventId = useRef<string | null>(null);

  // Counters & Budget
  const [tokensUsed, setTokensUsed] = useState(0);
  const [tokensBudget] = useState(250000);
  const [fetchedCount, setFetchedCount] = useState(0);
  const [fetchLimit] = useState(30);

  // Layout Panels
  const [tracks, setTracks] = useState<ResearchTrack[]>([]);
  const [selectedTrackFilter, setSelectedTrackFilter] = useState<string | number | "all">("all");
  const [planExpanded, setPlanExpanded] = useState(false);

  // Center Activity Log
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selectedStageFilter, setSelectedStageFilter] = useState<string | "all">("all");
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const activityScrollRef = useRef<HTMLDivElement>(null);

  // Right Sources Drawer
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | "vault" | "web">("all");
  const [selectedEvidenceSource, setSelectedEvidenceSource] = useState<SourceItem | null>(null);

  // Cancel Confirmation Modal
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Timer
  useEffect(() => {
    if (!runLoaded || status !== "running") return;
    const interval = setInterval(() => {
      if (startedAt != null) setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [runLoaded, status, startedAt]);

  // Initial Fetch of Run State
  useEffect(() => {
    if (authLoading || !token) return;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/v1/runs/${runId}`, { headers })
      .then(async (response) => {
        if (response.ok) return response.json();
        const fallback = await fetch(`${API_URL}/api/report/status/${runId}`, { headers });
        return fallback.ok ? fallback.json() : null;
      })
      .then((data) => {
        if (!data) {
          setRunLoadError(true);
          return;
        }
        if (data.query) setQuery(data.query);
        if (data.depth) setDepth(data.depth);
        if (data.created_at) {
          const created = new Date(data.created_at).getTime();
          if (Number.isFinite(created)) {
            setStartedAt(created);
            setElapsedSec(Math.max(0, Math.floor((Date.now() - created) / 1000)));
          }
        }
        if (data.status) {
          setStatus(["completed", "failed", "cancelled"].includes(data.status) ? data.status : "running");
        }
        if (data.stage) setStageProgressNote(data.stage);
        if (data.stage) {
          const stage = String(data.stage).toLowerCase();
          if (/scop/.test(stage)) setActiveStage("scope");
          else if (/plan/.test(stage)) setActiveStage("plan");
          else if (/scrap|gather|research/.test(stage)) setActiveStage("gather");
          else if (/critic|audit|arbiter/.test(stage)) setActiveStage("audit");
          else if (/synth|outline|write|assembl/.test(stage)) setActiveStage("write");
          else if (/verif|score|final|export/.test(stage)) setActiveStage("verify");
        }
        if (data.tracks && data.tracks.length > 0) {
          setTracks(
            data.tracks.map((t: any, idx: number) => ({
              id: t.id || idx + 1,
              title: t.title || `Track ${idx + 1}`,
              status: t.status || "pending",
              sources_count: t.sources_count || 0,
              queries_count: t.queries_count || 0,
              progress_pct: t.status === "completed" ? 100 : t.status === "running" ? 50 : 0,
            }))
          );
        }
        if (Array.isArray(data.events) && data.events.length) {
          const orderedEvents = [...data.events].sort((a: any, b: any) => Number(a.seq || 0) - Number(b.seq || 0));
          lastEventId.current = orderedEvents[orderedEvents.length - 1]?.id || null;
          orderedEvents.forEach((event: any) => handleIncomingEvent({ event: event.type, data: event.payload }));
        }
      })
      .catch((err) => {
        console.warn("Run initial state warning:", err);
        setRunLoadError(true);
      })
      .finally(() => setRunLoaded(true));
  }, [runId, token, authLoading]);

  // Connect to SSE stream
  useEffect(() => {
    if (authLoading || !token || !runLoaded || status !== "running") return;
    const controller = new AbortController();
    let fallbackPoll: ReturnType<typeof setInterval> | null = null;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (lastEventId.current) headers["Last-Event-ID"] = lastEventId.current;

    const checkStatusFallback = async () => {
      try {
        const res = await fetch(`${API_URL}/api/report/status/${runId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) return;
        const d = await res.json();
        const terminalStatus = String(d.status || "").toLowerCase();
        if (terminalStatus === "completed" || terminalStatus === "failed" || terminalStatus === "cancelled") {
          setStatus(terminalStatus);
          if (fallbackPoll) clearInterval(fallbackPoll);
        }
        if (d.query) setQuery(d.query);
        if (d.stage) setStageProgressNote(d.stage);
      } catch (e) {
        // quiet catch
      }
    };

    const startFallbackPolling = () => {
      if (fallbackPoll) return;
      void checkStatusFallback();
      fallbackPoll = setInterval(checkStatusFallback, 3000);
    };

    const connect = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/runs/${runId}/events`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Event stream returned ${response.status}`);
        setReconnected(true);
        window.setTimeout(() => setReconnected(false), 2500);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedTerminalEvent = false;
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
              if (line.startsWith("id:")) lastEventId.current = line.slice(3).trim();
              if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
            }
            if (dataLines.length) {
              try {
                const eventData = JSON.parse(dataLines.join("\n"));
                handleIncomingEvent({ event: eventName, data: eventData });
                if (
                  ["run_completed", "run_failed", "run_cancelled"].includes(eventName) ||
                  (eventName === "stage_changed" && ["completed", "failed", "cancelled"].includes(String(eventData.status || "").toLowerCase()))
                ) {
                  receivedTerminalEvent = true;
                }
              } catch (err) {
                console.warn("Event parse error:", err);
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
        // A graceful SSE close can happen after a proxy or server restart without
        // delivering the terminal event. Keep the UI in sync from durable status.
        if (!controller.signal.aborted && !receivedTerminalEvent) {
          startFallbackPolling();
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          startFallbackPolling();
          console.warn("Run event stream disconnected; using status polling.", err);
        }
      }
    };
    void connect();

    return () => {
      controller.abort();
      if (fallbackPoll) clearInterval(fallbackPoll);
    };
  }, [runId, token, authLoading, runLoaded, status]);

  function handleIncomingEvent(evt: any) {
    const evtType = evt.event || evt.type || "unknown";
    const data = evt.data || {};
    const timeStr = new Date().toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // Update Stage Mapping
    if (evtType === "stage_changed") {
      const stage = String(data.stage || data.status || "").toLowerCase();
      if (["completed", "failed", "cancelled"].includes(String(data.status || "").toLowerCase())) {
        setStatus(String(data.status).toLowerCase() as "completed" | "failed" | "cancelled");
      }
      setStageProgressNote(data.stage || stage || "Research in progress");
      if (/scop/.test(stage)) setActiveStage("scope");
      else if (/plan/.test(stage)) setActiveStage("plan");
      else if (/scrap|gather|research/.test(stage)) setActiveStage("gather");
      else if (/critic|audit|arbiter/.test(stage)) setActiveStage("audit");
      else if (/synth|outline|write|assembl/.test(stage)) setActiveStage("write");
      else if (/verif|score|final/.test(stage)) setActiveStage("verify");
    } else if (evtType === "run_started" || evtType === "scope_completed") {
      setActiveStage("plan");
    } else if (evtType === "plan_completed" || evtType === "track_started") {
      setActiveStage("gather");
    } else if (evtType === "critic_completed") {
      setActiveStage("audit");
    } else if (evtType === "section_synthesized") {
      setActiveStage("write");
    } else if (evtType === "verification_completed") {
      setActiveStage("verify");
    } else if (evtType === "run_completed") {
      setStatus("completed");
      setActiveStage("verify");
    } else if (evtType === "run_failed") {
      setStatus("failed");
    } else if (evtType === "run_cancelled") {
      setStatus("cancelled");
    }

    // Build Activity Row
    let newActivity: ActivityEvent | null = null;

    if (evtType === "search_executed") {
      const q = data.query || "web search";
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "gather",
        type: "search",
        text: `Searching `,
        rawQuery: q,
      };
      if (data.tokens_used) setTokensUsed((t) => t + Number(data.tokens_used));
      else if (data.tokens) setTokensUsed((t) => t + Number(data.tokens));
    } else if (evtType === "source_fetched" || evtType === "source_discovered") {
      const url = data.url || "";
      let domain = data.domain || "external";
      if (!data.domain && url) {
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = "external";
        }
      }
      setFetchedCount((c) => c + 1);
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "gather",
        type: "read",
        text: `Reading `,
        domain,
      };

      // Add to Sources Drawer
      setSources((prev) => {
        if (prev.some((s) => s.url === url)) return prev;
        const authScore = data.authority || data.authority_score;
        const newSrc: SourceItem = {
          id: String(prev.length + 1),
          title: data.title || domain,
          url,
          domain,
          date: data.published_date || "",
          authorityDots: authScore ? (authScore > 1 ? Math.min(5, Math.round(authScore)) : Math.min(5, Math.max(1, Math.round(authScore * 5)))) : (data.is_vault ? 5 : 3),
          isVault: Boolean(data.is_vault || data.source_type === "user_doc"),
          excerpt: data.excerpt || data.snippet || "",
          isNew: true,
        };
        return [newSrc, ...prev];
      });
    } else if (evtType === "evidence_extracted") {
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "gather",
        type: "evidence",
        text: `Extracted evidence passages (${data.count || data.total_evidence_units || 0})`,
      };
    } else if (evtType === "research_warning" || evtType === "provider_degraded") {
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "gather",
        type: "warning",
        text: String(data.message || data.detail || data.error || "A research service was unavailable."),
      };
    } else if (evtType === "critic_completed") {
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "audit",
        type: "critic",
        text: `Adversarial audit completed: cross-checked claims`,
        criticFinding: data.finding
          ? {
              claim: data.finding.claim,
              conflictingValues: data.finding.conflicting_values,
              resolution: data.finding.resolution,
            }
          : undefined,
      };
    } else if (evtType === "section_synthesized" || evtType === "section_drafted") {
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "write",
        type: "write",
        text: `Drafted chapter: ${data.section_title || "Section synthesis"}`,
      };
      if (data.tokens_used) setTokensUsed((t) => t + Number(data.tokens_used));
      else if (data.tokens) setTokensUsed((t) => t + Number(data.tokens));
    } else if (evtType === "query_issued") {
      const queries = Array.isArray(data.queries) ? data.queries : [];
      newActivity = {
        id: String(Date.now() + Math.random()),
        timestamp: timeStr,
        stage: "plan",
        type: "search",
        text: `Planned ${queries.length || 1} search ${queries.length === 1 ? "query" : "queries"} for ${data.category || data.track_id || "a research track"}`,
        rawQuery: data.sub_question || queries[0],
      };
    }

    if (newActivity) {
      setEvents((prev) => [...prev, newActivity!]);
      if (!userScrolledUp && activityScrollRef.current) {
        setTimeout(() => {
          if (activityScrollRef.current) {
            activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
          }
        }, 50);
      }
    }
  }

  const handleCancelRun = async () => {
    setCancelling(true);
    try {
      const response = await fetch(`${API_URL}/api/research/${runId}/cancel`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Cancellation request failed");
      setStatus("cancelled");
      setCancelModalOpen(false);
    } catch (e) {
      console.warn("Cancel request error:", e);
    } finally {
      setCancelling(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (authLoading || !token || !runLoaded) {
    return (
      <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
        <header className="h-14 border-b border-[var(--line)] bg-[var(--surface)] px-5 flex items-center">
          <button type="button" onClick={() => router.push("/dashboard")} className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)] hover:text-[var(--ink)]">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </button>
        </header>
        <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-6 text-center">
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="mx-auto block h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
            <p className="text-sm text-[var(--ink-2)]">Loading this research run…</p>
          </div>
        </main>
      </div>
    );
  }

  if (runLoadError) {
    return (
      <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
        <header className="h-14 border-b border-[var(--line)] bg-[var(--surface)] px-5 flex items-center">
          <button type="button" onClick={() => router.push("/history")} className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)] hover:text-[var(--ink)]">
            <ArrowLeft className="h-4 w-4" /> Research history
          </button>
        </header>
        <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-6 text-center">
          <section className="space-y-4">
            <AlertTriangle className="mx-auto h-8 w-8 text-[var(--warn)]" />
            <h1 className="font-serif text-2xl font-semibold">This research run is unavailable</h1>
            <p className="text-sm leading-relaxed text-[var(--ink-2)]">We couldn’t retrieve its saved status. It may have been removed, or the research service may be temporarily unavailable.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => window.location.reload()} className="btn-secondary text-sm">Try again</button>
              <button type="button" onClick={() => router.push("/history")} className="btn-primary text-sm">Research history</button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (status === "failed" || status === "cancelled") {
    const wasCancelled = status === "cancelled";
    return (
      <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
        <header className="h-14 border-b border-[var(--line)] bg-[var(--surface)] px-5 flex items-center">
          <button type="button" onClick={() => router.push("/history")} className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)] hover:text-[var(--ink)]">
            <ArrowLeft className="h-4 w-4" /> Research history
          </button>
        </header>
        <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-6 text-center">
          <section className="space-y-4">
            <AlertTriangle className={`mx-auto h-8 w-8 ${wasCancelled ? "text-[var(--ink-3)]" : "text-[var(--warn)]"}`} />
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)]">{wasCancelled ? "Cancelled" : "Report unavailable"}</p>
              <h1 className="font-serif text-2xl font-semibold">{query}</h1>
            </div>
            <p className="text-sm leading-relaxed text-[var(--ink-2)]">
              {wasCancelled
                ? "This investigation was cancelled before a report was saved."
                : "This investigation ended without a saved report. Its question remains in your history, but no findings or sources are available to show."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => router.push("/studio")} className="btn-primary text-sm">Start new research</button>
              <button type="button" onClick={() => router.push("/history")} className="btn-secondary text-sm">View history</button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const filteredEvents = events.filter((e) => {
    if (selectedStageFilter !== "all" && e.stage !== selectedStageFilter) return false;
    return true;
  });

  const filteredSources = sources.filter((s) => {
    if (sourceFilter === "vault" && !s.isVault) return false;
    if (sourceFilter === "web" && s.isVault) return false;
    return true;
  });

  // Calculate Stage Index for linear strip
  const currentStageIdx = PIPELINE_STAGES.findIndex((s) => s.id === activeStage);

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      {/* ─── Top Bar: Title, Depth, Timer & Pipeline Strip ───────────── */}
      <header className="sticky top-0 z-30 bg-[var(--surface)] hairline-b">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex flex-col gap-2.5">
          {/* Row 1: Back, Title, Timer */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="p-1 rounded text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors"
                  title="Return to dashboard"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <h1 className="font-serif text-[17px] font-semibold text-[var(--ink)] truncate max-w-xl">
                {query}
              </h1>

              {reconnected && (
                <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 rounded-[3px]">
                  Reconnected
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0 font-mono text-xs text-[var(--ink-2)]">
              <span className="capitalize px-2 py-0.5 rounded-[4px] bg-[var(--surface-2)] border border-[var(--line)]">
                {depth}
              </span>
              <span>·</span>
              <span className="text-[var(--ink)] font-semibold">
                {formatTimer(elapsedSec)}
              </span>

              {status === "completed" && (
                <button
                  type="button"
                  onClick={() => router.push(`/report/${runId}`)}
                  className="btn-primary py-1 px-3 text-xs ml-2"
                >
                  <span>View report</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Row 2: 6-Node Pipeline Linear Strip */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto py-1">
              {PIPELINE_STAGES.map((stg, idx) => {
                const isDone = idx < currentStageIdx || status === "completed";
                const isActive = idx === currentStageIdx && status === "running";
                const isPending = idx > currentStageIdx && status !== "completed";

                return (
                  <button
                    key={stg.id}
                    type="button"
                    onClick={() =>
                      setSelectedStageFilter(
                        selectedStageFilter === stg.id ? "all" : stg.id
                      )
                    }
                    className={`flex items-center gap-1.5 text-xs font-sans transition-all ${
                      selectedStageFilter === stg.id
                        ? "text-[var(--accent)] font-semibold"
                        : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {/* 10px circular node */}
                    <div
                      className={`w-2.5 h-2.5 rounded-full transition-all shrink-0 ${
                        isDone
                          ? "bg-[var(--ink-2)]"
                          : isActive
                          ? "bg-transparent border-2 border-[var(--accent)] animate-quiet-pulse"
                          : "border border-[var(--line-strong)]"
                      }`}
                    />
                    <span className="uppercase text-[11px] tracking-wider font-mono">
                      {stg.label}
                    </span>

                    {idx < PIPELINE_STAGES.length - 1 && (
                      <span className="text-[var(--line-strong)] select-none ml-2 sm:ml-3">
                        —
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-[11px] font-mono text-[var(--ink-3)] hidden md:block">
              {stageProgressNote}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Hero 3-Column Split Layout ──────────────────────────────── */}
      <div className="flex-1 max-w-[1400px] w-full mx-auto flex flex-col md:flex-row overflow-hidden">
        {/* ── Column 1: TRACKS (Left, 280px) ───────────────────────── */}
        <aside className="w-full md:w-[280px] shrink-0 bg-[var(--surface)] hairline-r flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
              Tracks ({tracks.length})
            </span>
            {selectedTrackFilter !== "all" && (
              <button
                type="button"
                onClick={() => setSelectedTrackFilter("all")}
                className="text-[10px] font-mono text-[var(--accent)] hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tracks.length === 0 ? (
              <div className="py-8 text-center text-xs font-mono text-[var(--ink-3)] space-y-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-quiet-pulse inline-block" />
                <p>Synthesizing research tracks...</p>
              </div>
            ) : (
              tracks.map((track, i) => {
              const isSelected = selectedTrackFilter === track.id;
              return (
                <div
                  key={track.id}
                  onClick={() =>
                    setSelectedTrackFilter(isSelected ? "all" : track.id)
                  }
                  className={`p-2.5 rounded-[6px] border transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? "bg-[var(--surface-2)] border-[var(--accent)]"
                      : "bg-[var(--surface)] border-[var(--line)] hover:border-[var(--line-strong)]"
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-[var(--ink-3)] font-semibold">
                      {i + 1}
                    </span>
                    <h3 className="text-xs font-sans font-medium text-[var(--ink)] leading-snug line-clamp-2">
                      {track.title}
                    </h3>
                  </div>

                  {/* 3px Thin Progress Bar */}
                  <div className="w-full h-[3px] bg-[var(--line)] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        track.status === "completed"
                          ? "bg-[var(--ok)]"
                          : "bg-[var(--accent)]"
                      }`}
                      style={{ width: `${track.progress_pct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[var(--ink-3)] pt-0.5">
                    <span>{track.sources_count} sources</span>
                    <span>{track.queries_count} queries</span>
                  </div>
                </div>
              );
            })
            )}

            {/* Collapsible Plan Section */}
            <div className="pt-3 border-t border-[var(--line)]">
              <button
                type="button"
                onClick={() => setPlanExpanded(!planExpanded)}
                className="w-full flex items-center justify-between text-xs text-[var(--ink-2)] hover:text-[var(--ink)] font-mono py-1"
              >
                <span>Investigation Plan</span>
                {planExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {planExpanded && (
                <div className="pt-2 text-xs text-[var(--ink-3)] space-y-1.5 font-sans">
                  <p>1. Dual retrieval across web indices and local PDF vault.</p>
                  <p>2. Adversarial critic evaluation of quantitative conflicts.</p>
                  <p>3. Sectional draft assembly and executive synthesis.</p>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Column 2: ACTIVITY STREAM (Centre, quiet log) ─────────── */}
        <main className="flex-1 flex flex-col bg-[var(--paper)] relative overflow-hidden min-h-[400px]">
          <div className="px-5 py-3 border-b border-[var(--line)] flex items-center justify-between bg-[var(--surface)]">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
                Activity Stream
              </span>
              {selectedStageFilter !== "all" && (
                <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded-[3px]">
                  stage: {selectedStageFilter}
                </span>
              )}
            </div>

            {userScrolledUp && (
              <button
                type="button"
                onClick={() => {
                  setUserScrolledUp(false);
                  if (activityScrollRef.current) {
                    activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
                  }
                }}
                className="chip text-[11px] text-[var(--accent)] border-[var(--accent)]"
              >
                Jump to latest ↓
              </button>
            )}
          </div>

          {/* Activity Log List */}
          <div
            ref={activityScrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
              setUserScrolledUp(!isAtBottom);
            }}
            className="flex-1 overflow-y-auto p-5 space-y-3 font-sans text-xs"
          >
            {filteredEvents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[var(--ink-3)] py-12 space-y-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
                <p className="font-mono text-xs">Waiting for agent activity telemetry...</p>
              </div>
            ) : (
              filteredEvents.map((evt) => {
                const isCritic = evt.type === "critic";
                const isWarning = evt.type === "warning";
                return (
                  <div
                    key={evt.id}
                    className={`flex items-start gap-3 py-1.5 ${
                      isCritic || isWarning
                        ? "border-l-2 border-[var(--warn)] pl-3 bg-[var(--warn-soft)]/30 rounded-r-[4px] py-2"
                        : ""
                    }`}
                  >
                    {/* Monospace Timestamp */}
                    <span className="font-mono text-[11px] text-[var(--ink-3)] shrink-0 pt-0.5">
                      {evt.timestamp}
                    </span>

                    {/* Icon + Log line */}
                    <div className="flex-1 text-[var(--ink)] leading-relaxed">
                      <span className="text-[var(--ink-2)]">{evt.text}</span>
                      {evt.rawQuery && (
                        <code className="font-mono text-[11.5px] text-[var(--ink)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded-[3px] ml-1">
                          &ldquo;{evt.rawQuery}&rdquo;
                        </code>
                      )}
                      {evt.domain && (
                        <a
                          href={`https://${evt.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11.5px] text-[var(--accent)] hover:underline ml-1"
                        >
                          {evt.domain}
                        </a>
                      )}

                      {/* Expandable Critic Finding */}
                      {evt.criticFinding && (
                        <div className="mt-2 p-2 bg-[var(--surface)] border border-[var(--line)] rounded-[4px] space-y-1 text-xs">
                          <span className="text-[10px] font-mono uppercase text-[var(--warn)] font-semibold block">
                            Adversarial Conflict Detected
                          </span>
                          <p className="text-[var(--ink)] font-medium">
                            {evt.criticFinding.claim}
                          </p>
                          {evt.criticFinding.conflictingValues && (
                            <div className="font-mono text-[11px] text-[var(--ink-2)] pt-1 space-y-0.5">
                              {evt.criticFinding.conflictingValues.map((v, vi) => (
                                <div key={vi}>• {v}</div>
                              ))}
                            </div>
                          )}
                          {evt.criticFinding.resolution && (
                            <p className="text-[11px] text-[var(--ink-3)] italic pt-1 border-t border-[var(--line)] mt-1">
                              Resolution: {evt.criticFinding.resolution}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>

        {/* ── Column 3: SOURCES DRAWER (Right, 380px) ──────────────── */}
        <aside className="w-full md:w-[380px] shrink-0 bg-[var(--surface)] hairline-l flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
              Evidence Sources ({filteredSources.length})
            </span>

            {/* Filter chips: All, Vault, Web */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSourceFilter("all")}
                className={`chip text-[10px] py-0.5 px-2 ${sourceFilter === "all" ? "chip-active" : ""}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("web")}
                className={`chip text-[10px] py-0.5 px-2 ${sourceFilter === "web" ? "chip-active" : ""}`}
              >
                Web
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("vault")}
                className={`chip text-[10px] py-0.5 px-2 ${sourceFilter === "vault" ? "chip-active" : ""}`}
              >
                Vault
              </button>
            </div>
          </div>

          {/* Sources List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {filteredSources.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--ink-3)] font-mono">
                No sources ingested yet. Crawlers gathering...
              </div>
            ) : (
              filteredSources.map((src) => (
                <div
                  key={src.id}
                  onClick={() => setSelectedEvidenceSource(src)}
                  className={`p-3 rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)]/50 hover:bg-[var(--surface-2)] transition-colors cursor-pointer space-y-2 ${
                    src.isNew ? "animate-feed-highlight" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-sans font-medium text-[var(--ink)] line-clamp-2 leading-snug">
                      {src.title}
                    </h4>
                    <span className="text-[10px] font-mono text-[var(--ink-3)] shrink-0">
                      {src.date}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-3)]">
                    <span className="text-[var(--accent)] truncate max-w-[180px]">
                      {src.domain}
                    </span>

                    {/* Authority Dots (1 to 5) */}
                    <div className="flex items-center gap-1" title={`Authority: ${src.authorityDots}/5`}>
                      {[1, 2, 3, 4, 5].map((dot) => (
                        <span
                          key={dot}
                          className={`w-1 h-1 rounded-full ${
                            dot <= src.authorityDots
                              ? "bg-[var(--ink-2)]"
                              : "bg-[var(--line-strong)]"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {src.excerpt && (
                    <p className="font-serif text-[11.5px] text-[var(--ink-2)] line-clamp-2 italic leading-relaxed pt-1 border-t border-[var(--line)]">
                      &ldquo;{src.excerpt}&rdquo;
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* ─── Bottom Status Bar (32px high, Section 7.3 spec) ──────────── */}
      <footer className="h-8 bg-[var(--surface)] hairline-t px-6 flex items-center justify-between text-xs font-mono text-[var(--ink-3)] select-none">
        <div className="flex items-center gap-4">
          <span>
            Tokens {(tokensUsed / 1000).toFixed(1)}k / {(tokensBudget / 1000).toFixed(0)}k
          </span>
          <span>·</span>
          <span>
            Fetched {fetchedCount} / {fetchLimit}
          </span>
        </div>

        {/* Budget Meter turning --warn at 80% */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[10px]">Budget</span>
          <div className="w-20 h-1.5 bg-[var(--line)] rounded-full overflow-hidden">
            <div
              className={`h-full ${
                tokensUsed / tokensBudget > 0.8
                  ? "bg-[var(--warn)]"
                  : "bg-[var(--accent)]"
              }`}
              style={{ width: `${Math.min(100, (tokensUsed / tokensBudget) * 100)}%` }}
            />
          </div>
        </div>

        <div>
          {status === "running" && (
            <button
              type="button"
              onClick={() => setCancelModalOpen(true)}
              className="btn-ghost-danger font-mono text-[11px]"
            >
              Cancel run
            </button>
          )}
        </div>
      </footer>

      {/* Cancel Confirmation Dialog */}
      {cancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-sm bg-[var(--surface)] border border-[var(--line)] rounded-[8px] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Cancel this research investigation?
            </h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Active crawling and token consumption will halt immediately. Intermediate findings will remain accessible.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="btn-secondary text-xs"
              >
                Continue running
              </button>
              <button
                type="button"
                onClick={handleCancelRun}
                className="btn-ghost-danger text-xs px-3 py-1.5"
                disabled={cancelling}
              >
                {cancelling ? "Cancelling..." : "Confirm cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Source Evidence Inspector Drawer / Popover */}
      {selectedEvidenceSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40">
          <div className="w-full max-w-md h-full bg-[var(--surface)] border-l border-[var(--line)] p-6 flex flex-col justify-between shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                <span className="text-[11px] font-mono uppercase text-[var(--ink-3)]">
                  Evidence Inspector
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedEvidenceSource(null)}
                  className="p-1 text-[var(--ink-3)] hover:text-[var(--ink)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <h2 className="font-serif text-[18px] text-[var(--ink)] leading-snug">
                {selectedEvidenceSource.title}
              </h2>

              <div className="text-xs font-mono text-[var(--ink-2)] space-y-1">
                <div>Domain: {selectedEvidenceSource.domain}</div>
                <div>Published: {selectedEvidenceSource.date || "Unknown"}</div>
                <div>Authority Score: {selectedEvidenceSource.authorityDots}/5</div>
              </div>

              <div className="pt-3 border-t border-[var(--line)]">
                <span className="text-[11px] font-mono uppercase text-[var(--ink-3)] block mb-2">
                  Verbatim Passage Excerpt
                </span>
                <p className="font-serif text-xs text-[var(--ink)] leading-relaxed bg-[var(--surface-2)] p-3 rounded-[6px] border border-[var(--line)] italic">
                  &ldquo;{selectedEvidenceSource.excerpt}&rdquo;
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--line)] flex items-center justify-between">
              {selectedEvidenceSource.url && (
                <a
                  href={selectedEvidenceSource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <span>Open original URL</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setSelectedEvidenceSource(null)}
                className="btn-primary text-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
