"use client";

import React, { useState, useEffect, useRef, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, AlertTriangle, ChevronDown,
  ChevronRight, ArrowUpRight
} from "lucide-react";
import Navbar from "@/components/Navbar";
import RunActivityFeed from "@/components/run/RunActivityFeed";
import RunSourcesPanel from "@/components/run/RunSourcesPanel";
import { useRunEventStream } from "@/hooks/useRunEventStream";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";
import type {
  ActivityEvent,
  IncomingRunEvent,
  ResearchBudgetUsage,
  RunEventPayload,
  RunSource,
  RunStatus,
  RunStatusSnapshot,
} from "@/lib/research-run-types";
import { toPipelineStage } from "@/lib/research-run-utils";
import { toActivityEvent } from "@/lib/run-event-activity";

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

interface RunSourceRecord {
  source_id?: string;
  title?: string;
  url?: string | null;
  domain?: string | null;
  authority_tier?: number | null;
  published_at?: string | null;
  snippet?: string | null;
  kind?: string;
}

interface RunTrackRecord {
  id?: string | number;
  title?: string;
  status?: ResearchTrack["status"];
  sources_count?: number;
  queries_count?: number;
}

interface RunLlmCallRecord {
  tokens_in?: number;
  tokens_out?: number;
}

interface RunEventRecord {
  id?: string;
  seq?: number;
  type?: string;
  payload?: RunEventPayload;
}

interface RunDetails {
  query?: string;
  depth?: string;
  status?: string;
  stage?: string;
  created_at?: string;
  completed_at?: string;
  sources?: RunSourceRecord[];
  tracks?: RunTrackRecord[];
  llm_calls?: RunLlmCallRecord[];
  events?: RunEventRecord[];
  budgets?: { token_limit?: number; search_limit?: number; fetch_limit?: number };
  budget_usage?: Partial<ResearchBudgetUsage>;
}

/** Parse API timestamps, whose legacy naive ISO values are stored as UTC. */
function parseApiTimestamp(value: string): number {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasTimezone ? value : `${value}Z`).getTime();
}

export default function LiveInvestigationHeroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  return <RunInvestigation key={resolvedParams.id} runId={resolvedParams.id} />;
}

function RunInvestigation({ runId }: { runId: string }) {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !token) {
      router.replace(`/login?redirect=${encodeURIComponent(`/run/${runId}`)}`);
    }
  }, [authLoading, token, router, runId]);

  // Run Metadata
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState("standard");
  const [status, setStatus] = useState<RunStatus>("loading");
  const [runLoaded, setRunLoaded] = useState(false);
  const [runLoadError, setRunLoadError] = useState(false);
  const [activeStage, setActiveStage] = useState("gather");
  const [stageProgressNote, setStageProgressNote] = useState("Gathering web evidence & vault docs");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  // Counters & Budget
  const [tokensUsed, setTokensUsed] = useState(0);
  const [tokensBudget, setTokensBudget] = useState(0);
  const [budgetUsage, setBudgetUsage] = useState({
    searches_used: 0, searches_limit: 0, fetches_used: 0, fetches_limit: 0,
  });

  // Layout Panels
  const [tracks, setTracks] = useState<ResearchTrack[]>([]);
  const [selectedTrackFilter, setSelectedTrackFilter] = useState<string | number | "all">("all");
  const [planExpanded, setPlanExpanded] = useState(false);

  // Center Activity Log
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selectedStageFilter, setSelectedStageFilter] = useState<string | "all">("all");
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const handleIncomingEventRef = useRef<(evt: IncomingRunEvent) => void>(() => undefined);

  // Evidence records arrive during initial load and the event stream.
  const [sources, setSources] = useState<RunSource[]>([]);
  const knownSourceUrlsRef = useRef<Set<string>>(new Set());

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
    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/v1/runs/${runId}`, { headers, signal: controller.signal })
      .then(async (response): Promise<RunDetails | null> => {
        if (response.ok) return response.json() as Promise<RunDetails>;
        const fallback = await fetch(`${API_URL}/api/report/status/${runId}`, { headers, signal: controller.signal });
        return fallback.ok ? await fallback.json() as RunDetails : null;
      })
      .then((data: RunDetails | null) => {
        if (!data) {
          setRunLoadError(true);
          return;
        }
        if (data.query) setQuery(data.query);
        if (data.depth) setDepth(data.depth);
        if (data.budgets?.token_limit) setTokensBudget(Number(data.budgets.token_limit));
        if (data.budgets) {
          setBudgetUsage((current) => ({
            ...current,
            searches_limit: Number(data.budgets?.search_limit || 0),
            fetches_limit: Number(data.budgets?.fetch_limit || 0),
          }));
        }
        if (data.budget_usage) setBudgetUsage((current) => ({ ...current, ...data.budget_usage }));
        if (Array.isArray(data.sources)) {
          const initialSources = data.sources.map((source, index): RunSource => {
            const authorityScore = Number(source.authority_tier);
            return {
              id: source.source_id || String(index + 1),
              title: source.title || source.domain || "Untitled source",
              url: source.url || "",
              domain: source.domain || "",
              date: source.published_at || "",
              authorityDots: Number.isFinite(authorityScore) && source.authority_tier != null
                ? Math.min(5, Math.max(1, Math.round(authorityScore > 1 ? authorityScore : authorityScore * 5)))
                : null,
              isVault: source.kind === "doc",
              excerpt: source.snippet || "",
            };
          });
          knownSourceUrlsRef.current = new Set(initialSources.map((source) => source.url));
          setSources(initialSources);
        }
        if (data.created_at) {
          const created = parseApiTimestamp(data.created_at);
          if (Number.isFinite(created)) {
            setStartedAt(created);
            const completed = data.completed_at ? parseApiTimestamp(data.completed_at) : Date.now();
            setElapsedSec(Math.max(0, Math.floor((completed - created) / 1000)));
          }
        }
        if (data.status) {
          const terminalStatuses = ["completed", "failed", "cancelled"] as const;
          const normalizedStatus = data.status.toLowerCase();
          setStatus(terminalStatuses.includes(normalizedStatus as typeof terminalStatuses[number])
            ? normalizedStatus as typeof terminalStatuses[number]
            : "running");
        }
        if (data.stage) setStageProgressNote(data.stage);
        const initialPipelineStage = toPipelineStage(data.stage);
        if (initialPipelineStage) setActiveStage(initialPipelineStage);
        if (data.tracks && data.tracks.length > 0) {
          setTracks(
            data.tracks.map((t, idx) => ({
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
          const orderedEvents = [...data.events].sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
          setLastEventId(orderedEvents[orderedEvents.length - 1]?.id || null);
          orderedEvents.forEach((event) => handleIncomingEventRef.current({ event: event.type, data: event.payload }));
        }
        if (Array.isArray(data.llm_calls)) {
          setTokensUsed(data.llm_calls.reduce((total: number, call) =>
            total + Number(call.tokens_in || 0) + Number(call.tokens_out || 0), 0));
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.warn("Run initial state warning:", err);
        setRunLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunLoaded(true);
      });
    return () => controller.abort();
  }, [runId, token, authLoading]);

  const handleIncomingEvent = useCallback((evt: IncomingRunEvent) => {
    const evtType = evt.event || evt.type || "unknown";
    const data = evt.data || {};

    if (evtType === "budget_updated" && data.budget) {
      setBudgetUsage((current) => ({ ...current, ...data.budget }));
    }

    if (evtType === "stage_changed") {
      const stage = String(data.stage || data.status || "").toLowerCase();
      // A stage update must not hide the later terminal event's final telemetry.
      setStageProgressNote(data.stage || stage || "Research in progress");
      const pipelineStage = toPipelineStage(stage);
      if (pipelineStage) setActiveStage(pipelineStage);
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
      if (data.budget) setBudgetUsage((current) => ({ ...current, ...data.budget }));
      setTracks((current) => current.map((track) => ({ ...track, status: "completed", progress_pct: 100 })));
      setActiveStage("verify");
    } else if (evtType === "run_failed") {
      setStatus("failed");
    } else if (evtType === "run_cancelled") {
      setStatus("cancelled");
    }

    if (evtType === "search_executed" || evtType === "section_synthesized" || evtType === "section_drafted") {
      const tokens = Number(data.tokens_used || data.tokens || 0);
      if (tokens) setTokensUsed((current) => current + tokens);
    } else if (evtType === "llm_call_completed") {
      const tokens = Number(data.tokens_in || 0) + Number(data.tokens_out || 0);
      setTokensUsed((current) => current + tokens);
    }

    if ((evtType === "research_warning" || evtType === "provider_degraded") && data.budget) {
      setBudgetUsage((current) => ({ ...current, ...data.budget }));
    }

    if (evtType === "source_fetched" || evtType === "source_discovered") {
      const url = data.url || "";
      let domain = data.domain || "external";
      if (!data.domain && url) {
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = "external";
        }
      }

      // Deduplicate before scheduling state updates. Updater functions stay pure,
      // and repeated SSE events do not inflate a track's source count.
      if (!knownSourceUrlsRef.current.has(url)) {
        knownSourceUrlsRef.current.add(url);
        const authScore = data.authority || data.authority_score;
        const newSource: RunSource = {
          id: url || String(Date.now() + Math.random()),
          title: data.title || domain,
          url,
          domain,
          date: data.published_date || "",
          authorityDots: authScore != null && Number.isFinite(Number(authScore))
            ? (Number(authScore) > 1 ? Math.min(5, Math.round(Number(authScore))) : Math.min(5, Math.max(1, Math.round(Number(authScore) * 5))))
            : null,
          isVault: Boolean(data.is_vault || data.source_type === "user_doc"),
          excerpt: data.excerpt || data.snippet || "",
          trackId: data.track_id,
          isNew: true,
        };
        setSources((current) => [newSource, ...current]);
        if (data.track_id != null) {
          setTracks((current) => current.map((track) => track.id === data.track_id
            ? { ...track, sources_count: track.sources_count + 1 }
            : track));
        }
      }
    } else if (evtType === "query_issued" && data.track_id != null) {
      const queries = Array.isArray(data.queries) ? data.queries : [];
      setTracks((current) => current.some((track) =>
        track.id === data.track_id || track.title === data.sub_question
      )
        ? current
        : [...current, {
            id: data.track_id!,
            title: data.sub_question || "Research track " + (current.length + 1),
            status: "pending",
            sources_count: 0,
            queries_count: queries.length,
            progress_pct: 0,
          }]);
    }

    const activity = toActivityEvent(evt);
    if (!activity) return;
    setEvents((current) => [...current, activity]);
    if (!userScrolledUp && activityScrollRef.current) {
      window.setTimeout(() => {
        if (activityScrollRef.current) {
          activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [userScrolledUp]);
  const handleStatusSnapshot = useCallback((snapshot: RunStatusSnapshot) => {
    const normalizedStatus = String(snapshot.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(normalizedStatus)) {
      setStatus(normalizedStatus as RunStatus);
    }
    if (snapshot.query) setQuery(snapshot.query);
    if (snapshot.stage) {
      setStageProgressNote(snapshot.stage);
      const pipelineStage = toPipelineStage(snapshot.stage);
      if (pipelineStage) setActiveStage(pipelineStage);
    }
    if (snapshot.budget_usage) {
      setBudgetUsage((current) => ({ ...current, ...snapshot.budget_usage }));
    }
  }, []);

  const { reconnected } = useRunEventStream({
    runId,
    token,
    enabled: !authLoading && runLoaded,
    status,
    initialLastEventId: lastEventId,
    onEvent: handleIncomingEvent,
    onStatus: handleStatusSnapshot,
  });

  useEffect(() => {
    handleIncomingEventRef.current = handleIncomingEvent;
  }, [handleIncomingEvent]);

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

  if (!runLoaded) {
    return (
      <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
        <Navbar />
        <div className="mx-auto max-w-3xl px-6 py-20" role="status" aria-live="polite">
          <p className="text-xs font-mono uppercase tracking-wider text-[var(--ink-3)]">Research workspace</p>
          <h1 className="mt-3 font-serif text-2xl">Restoring this investigation…</h1>
          <p className="mt-2 text-sm text-[var(--ink-2)]">Loading its saved sources, activity, and current stage.</p>
        </div>
      </main>
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

        <RunActivityFeed
          events={events}
          selectedStage={selectedStageFilter}
          userScrolledUp={userScrolledUp}
          scrollRef={activityScrollRef}
          onScrollStateChange={setUserScrolledUp}
          onJumpToLatest={() => {
            setUserScrolledUp(false);
            const element = activityScrollRef.current;
            if (element) element.scrollTop = element.scrollHeight;
          }}
        />
        <RunSourcesPanel sources={sources} status={status} />
      </div>

      {/* ─── Bottom Status Bar (32px high, Section 7.3 spec) ──────────── */}
      <footer className="h-8 bg-[var(--surface)] hairline-t px-6 flex items-center justify-between text-xs font-mono text-[var(--ink-3)] select-none">
        <div className="flex items-center gap-4">
          <span>
            Tokens {(tokensUsed / 1000).toFixed(1)}k{tokensBudget ? ` / ${(tokensBudget / 1000).toFixed(0)}k` : ""}
          </span>
          <span>·</span>
          <span>
            Sources {sources.length}
          </span>
          <span>·</span>
          <span>Searches {budgetUsage.searches_used}/{budgetUsage.searches_limit || "—"}</span>
          <span>·</span>
          <span>Fetches {budgetUsage.fetches_used}/{budgetUsage.fetches_limit || "—"}</span>
        </div>

        {/* Budget Meter turning --warn at 80% */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[10px]">Budget</span>
          <div className="w-20 h-1.5 bg-[var(--line)] rounded-full overflow-hidden">
            <div
              className={`h-full ${
                tokensBudget > 0 && tokensUsed / tokensBudget > 0.8
                  ? "bg-[var(--warn)]"
                  : "bg-[var(--accent)]"
              }`}
              style={{ width: `${tokensBudget ? Math.min(100, (tokensUsed / tokensBudget) * 100) : 0}%` }}
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

    </div>
  );
}
