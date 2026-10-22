"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle, ArrowRight, Database, SlidersHorizontal
} from "lucide-react";
import Navbar from "@/components/Navbar";
import ClarificationModal from "@/components/ClarificationModal";
import type { ResearchBlueprint } from "@/lib/api-types";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/lib/config";

interface RecentRunItem {
  id: string;
  report_id?: string;
  query?: string;
  title?: string;
  executive_title?: string;
  status: string;
  depth?: string;
  created_at: string;
  faithfulness_score?: number;
}

export default function PublicLandingAndDeskPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();

  // Screen 7.1 Input & Settings State
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">("standard");
  const [useDocuments, setUseDocuments] = useState(true);
  const [documentCount, setDocumentCount] = useState(0);
  const [domainScope, setDomainScope] = useState<"all" | "academic" | "financial">("all");
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [excludedDomains, setExcludedDomains] = useState("");

  // Scoping Clarification Modal State (Screen 7.2)
  const [scopingModalOpen, setScopingModalOpen] = useState(false);
  const [blueprint, setBlueprint] = useState<ResearchBlueprint | null>(null);
  const [scopingLoading, setScopingLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Recent Runs List State
  const [recentRuns, setRecentRuns] = useState<RecentRunItem[]>([]);
  const [workspaceDataError, setWorkspaceDataError] = useState(false);
  const [loadedSummaryToken, setLoadedSummaryToken] = useState<string | null>(null);
  const loadingRuns = authLoading || Boolean(token && loadedSummaryToken !== token);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(68, textareaRef.current.scrollHeight)}px`;
    }
  }, [query]);

  // Fetch recent runs and vault document counts
  useEffect(() => {
    if (authLoading || !token) return;

    const controller = new AbortController();
    let active = true;
    const headers: Record<string, string> = {};
    headers["Authorization"] = `Bearer ${token}`;

    Promise.all([
      fetch(`${API_URL}/api/reports`, { headers, signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Could not load recent research.");
        return response.json();
      }),
      fetch(`${API_URL}/api/vault`, { headers, signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Could not load the source library.");
        return response.json();
      }),
    ]).then(([repData, vaultData]) => {
      if (!active) return;
      setRecentRuns((repData.reports || []).slice(0, 10).map((run: RecentRunItem) => ({
        ...run,
        title: run.title || run.executive_title,
        id: run.id || run.report_id || "",
      })).filter((run: RecentRunItem) => Boolean(run.id)));
      setDocumentCount((vaultData.documents || []).length);
      setWorkspaceDataError(false);
    }).catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("Workspace summary unavailable:", error);
        setWorkspaceDataError(true);
      }
    }).finally(() => {
      if (active) setLoadedSummaryToken(token);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, authLoading]);

  // Initiate research: first checks preflight scope
  const handleInitiateResearch = async (skipPreflight = false) => {
    const cleanedQuery = query.trim();
    if (!cleanedQuery || submitting) return;
    if (!token) {
      const destination = `/studio?q=${encodeURIComponent(cleanedQuery)}`;
      router.push(`/login?redirect=${encodeURIComponent(destination)}`);
      return;
    }
    setErrorMsg("");

    if (!skipPreflight) {
      setScopingLoading(true);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_URL}/api/research/preflight`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: cleanedQuery,
            include_user_docs: useDocuments,
          }),
        });

        if (res.ok) {
          const bp: ResearchBlueprint = await res.json();
          setBlueprint(bp);
          if (
            bp.ambiguity_detected ||
            (bp.clarification_options && bp.clarification_options.length > 0)
          ) {
            setScopingModalOpen(true);
            setScopingLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn("Preflight scoping check non-critical warning:", err);
      } finally {
        setScopingLoading(false);
      }
    }

    await dispatchRun({});
  };

  const dispatchRun = async (params: {
    clarificationChoice?: string | null;
    customAngles?: string[];
  }) => {
    setSubmitting(true);
    setErrorMsg("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let researchQuery = query.trim();
      if (domainScope === "academic" && !researchQuery.toLowerCase().includes("peer-reviewed")) {
        researchQuery += " [Focus: peer-reviewed literature and academic research]";
      } else if (domainScope === "financial" && !researchQuery.toLowerCase().includes("financial")) {
        researchQuery += " [Focus: filings, market analysis, and economic data]";
      }
      const blockedDomains = excludedDomains.split(/[\s,;]+/).map((domain) => domain.trim().toLowerCase()).filter(Boolean);

      const res = await fetch(`${API_URL}/api/research`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: researchQuery,
          depth,
          include_user_docs: useDocuments,
          blocked_domains: blockedDomains,
          clarification_choice: params.clarificationChoice,
          custom_angles: params.customAngles,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to initiate research run.");
      }

      const data = await res.json();
      const runId = data.report_id || data.run_id;
      if (runId) {
        router.push(`/run/${runId}`);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleInitiateResearch();
    }
  };

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)] selection:text-[var(--ink)]">
      <Navbar />

      {/* ─── Hero Section with Screen 7.1 Research Desk ──────────────── */}
      <section className="w-full max-w-4xl mx-auto px-6 pt-16 pb-16 flex flex-col items-center text-center">
        {/* Subtle Eyebrow Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--ink-2)] text-xs font-mono mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          <span>Personal research workspace</span>
        </div>

        {/* Headline in Source Serif 4 */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-serif font-bold text-[var(--ink)] leading-[1.12] tracking-tight max-w-3xl">
          Investigate complex questions <br className="hidden sm:inline" />
          <span className="italic font-normal text-[var(--ink-2)]">with sources you can inspect.</span>
        </h1>

        {/* Subtitle */}
        <p className="mt-4 text-[var(--ink-2)] text-sm sm:text-base max-w-xl leading-relaxed">
          Bring public search and selected library documents into one research flow. Review the retrieved sources and see where a report needs closer checking.
        </p>

        {/* ─── Screen 7.1 Editorial Desk Column (720px wide) ──────────── */}
        <div className="w-full max-w-[720px] mx-auto mt-10 text-left bg-[var(--surface)] border border-[var(--line-strong)] rounded-[10px] p-6 shadow-sm">
          {/* Context Line */}
          <div className="flex items-center justify-between text-xs font-mono text-[var(--ink-3)] mb-4 pb-2 border-b border-[var(--line)]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              {authLoading ? (
                <span>Restoring workspace…</span>
              ) : user ? (
                <>
                  <span>{`${user.username}'s workspace`}</span>
                  <span>·</span>
                  <span>{loadingRuns ? "Loading runs…" : workspaceDataError ? "Runs unavailable" : `${recentRuns.length} runs`}</span>
                  <span>·</span>
                  <span>{loadingRuns ? "Loading sources…" : workspaceDataError ? "Sources unavailable" : `${documentCount} documents`}</span>
                </>
              ) : (
                <span>Sign in to access your private research workspace</span>
              )}
            </div>
            <span className="text-[10px] uppercase tracking-wider text-[var(--ink-3)]">Desk</span>
          </div>

          {/* Question Textarea in Source Serif */}
          <div className="relative border-b border-[var(--line)] focus-within:border-[var(--accent)] transition-colors pb-2">
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question you want to investigate…"
              rows={2}
              className="w-full bg-transparent font-serif text-[17px] sm:text-[19px] leading-[1.4] text-[var(--ink)] placeholder:text-[var(--ink-3)]/60 focus:outline-none resize-none"
            />
          </div>

          {errorMsg && (
            <div className="mt-3 p-2.5 rounded-[4px] bg-[var(--bad-soft)] border border-[var(--bad)] text-xs text-[var(--bad)] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Settings Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Depth Selector Chips */}
              <div className="inline-flex items-center rounded-[4px] border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
                <button
                  type="button"
                  onClick={() => setDepth("quick")}
                  className={`px-2.5 py-1 rounded-[3px] text-xs transition-all ${
                    depth === "quick"
                      ? "bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs"
                      : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                  }`}
                  title="A quick overview with one research pass"
                >
                  Quick <span className="text-[10px] opacity-60">1 pass</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDepth("standard")}
                  className={`px-2.5 py-1 rounded-[3px] text-xs transition-all ${
                    depth === "standard"
                      ? "bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs"
                      : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                  }`}
                  title="A balanced investigation with two research passes"
                >
                  Standard <span className="text-[10px] opacity-60">2 passes</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDepth("deep")}
                  className={`px-2.5 py-1 rounded-[3px] text-xs transition-all ${
                    depth === "deep"
                      ? "bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-xs"
                      : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                  }`}
                  title="A broader investigation with three research passes"
                >
                  Deep <span className="text-[10px] opacity-60">3 passes</span>
                </button>
              </div>

              {/* Use Documents Switch */}
              <button
                type="button"
                onClick={() => setUseDocuments(!useDocuments)}
                className={`chip ${useDocuments ? "chip-active" : ""}`}
                title="Cross-reference private vault documents"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Vault ({documentCount})</span>
              </button>

              {/* Domain Scope Chip */}
              <select
                aria-label="Source focus"
                value={domainScope}
                onChange={(e) => setDomainScope(e.target.value as "all" | "academic" | "financial")}
                className="chip bg-[var(--surface-2)] cursor-pointer text-xs pr-1"
              >
                <option value="all">All sources</option>
                <option value="academic">Academic research focus</option>
                <option value="financial">Markets and filings focus</option>
              </select>

              {/* Ghost More Options Toggle */}
              <button
                type="button"
                onClick={() => setMoreOptionsOpen(!moreOptionsOpen)}
                className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)] p-1 rounded transition-colors"
                title="Blocked domains & constraints"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              <p className="basis-full text-[10px] text-[var(--ink-3)]">
                Depth controls the number of research passes; completion time depends on available sources and provider response.
              </p>
            </div>

            {/* Right: Primary Button */}
            <div className="flex items-center gap-2 ml-auto">
              <span className="hidden sm:inline text-[11px] font-mono text-[var(--ink-3)]">
                Ctrl+Enter
              </span>
              <button
                type="button"
                onClick={() => handleInitiateResearch()}
                disabled={!query.trim() || submitting || scopingLoading}
                className="btn-primary"
              >
                {scopingLoading ? (
                  <span>Scoping...</span>
                ) : submitting ? (
                  <span>Initiating...</span>
                ) : (
                  <>
                    <span>Start research</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* More Options Panel */}
          {moreOptionsOpen && (
            <div className="mt-3 p-3 bg-[var(--surface-2)] border border-[var(--line)] rounded-[6px] space-y-2 text-xs">
              <label className="block text-[11px] font-mono text-[var(--ink-2)]">
                Blocked Domains (comma separated)
              </label>
              <input
                type="text"
                value={excludedDomains}
                onChange={(e) => setExcludedDomains(e.target.value)}
                placeholder="e.g. reddit.com, pinterest.com"
                className="input-base w-full px-2.5 py-1 text-xs"
              />
            </div>
          )}

          {/* Recent Runs List */}
          {!user ? null : workspaceDataError ? (
            <p role="status" className="mt-4 text-xs text-[var(--warn)]">
              Workspace summary could not be loaded. Your research is still available in History.
            </p>
          ) : loadingRuns ? (
            <p role="status" className="mt-4 text-xs text-[var(--ink-3)]">Loading your workspace…</p>
          ) : recentRuns.length > 0 && (
            <div className="mt-6 pt-4 border-t border-[var(--line)] space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-medium text-[var(--ink-2)]">
                  Recent research
                </span>
                <Link
                  href="/history"
                  className="text-sm text-[var(--ink-2)] hover:text-[var(--accent)] transition-colors"
                >
                  View history →
                </Link>
              </div>

              <div className="divide-y divide-[var(--line)]">
                {recentRuns.slice(0, 3).map((run) => (
                  <Link
                    key={run.id}
                    href={run.status === "completed" ? `/report/${run.id}` : `/run/${run.id}`}
                    className="py-2 px-1 flex items-baseline justify-between gap-3 hover:bg-[var(--surface-2)] focus-visible:outline-offset-[-2px] rounded-[4px] transition-colors group text-sm"
                  >
                    <div className="flex items-baseline gap-2 truncate">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          run.status === "completed" ? "bg-[var(--ok)]" : "bg-[var(--accent)] animate-quiet-pulse"
                        }`}
                      />
                      <span className="text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors truncate">
                        {run.title || run.query}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--ink-3)] shrink-0">
                      {run.faithfulness_score != null ? `${(run.faithfulness_score * 100).toFixed(0)}% refs` : ""}
                    </span>
                  </Link>
                ))}
              </div>

            </div>
          )}
        </div>
      </section>

      {!user && (
      <>
      {/* ─── Section 2: Features Section (#features) ──────────────────── */}
      <section id="features" className="w-full max-w-5xl mx-auto px-6 py-20 border-t border-[var(--line)] scroll-mt-12 space-y-12">
        <div className="text-center space-y-2 max-w-xl mx-auto">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
            Architectural Foundations
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] tracking-tight">
            Research with evidence you can inspect.
          </h2>
          <p className="text-xs sm:text-sm text-[var(--ink-2)] leading-relaxed">
            Search public sources and your selected library documents, then inspect the evidence and source status available for each report.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Dual Retrieval */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[10px] p-6 space-y-4 flex flex-col justify-between hover:border-[var(--line-strong)] transition-colors">
            <div className="space-y-2.5">
              <span className="text-[11px] font-mono text-[var(--accent)] uppercase font-semibold">
                01 / Dual Retrieval
              </span>
              <h3 className="text-base font-semibold text-[var(--ink)]">
                Public sources meet your library
              </h3>
              <p className="text-xs text-[var(--ink-2)] leading-relaxed">
                Search public sources and, when selected, passages indexed from your private library. Reports keep those evidence types identifiable.
              </p>
            </div>

            <div className="p-3 bg-[var(--surface-2)] rounded-[6px] border border-[var(--line)] text-xs font-mono space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--ink-2)]">Source Channels</span>
                <span className="text-[var(--ink-2)] font-semibold">When available</span>
              </div>
              <div className="text-[11px] text-[var(--ink-3)] space-y-1">
                <div>• Public web results from configured search providers</div>
                <div>• Indexed passages from selected library documents</div>
              </div>
            </div>
          </div>

          {/* Card 2: Adversarial Critic */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[10px] p-6 space-y-4 flex flex-col justify-between hover:border-[var(--line-strong)] transition-colors">
            <div className="space-y-2.5">
              <span className="text-[11px] font-mono text-[var(--warn)] uppercase font-semibold">
                02 / Adversarial Audit
              </span>
              <h3 className="text-base font-semibold text-[var(--ink)]">
                Reviews evidence conflicts
              </h3>
              <p className="text-xs text-[var(--ink-2)] leading-relaxed">
                When retrieved sources disagree, the workflow can surface the conflict for review. Conclusions depend on the evidence returned for that question.
              </p>
            </div>

            <div className="p-3 bg-[var(--surface-2)] rounded-[6px] border border-[var(--line)] text-xs font-mono space-y-1.5">
              <span className="text-[10px] uppercase text-[var(--warn)] font-semibold">
                Review the evidence
              </span>
              <p className="text-[11px] text-[var(--ink-2)]">
                Compare source passages and context before accepting a conclusion.
              </p>
            </div>
          </div>

          {/* Card 3: Verifiable Receipts */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[10px] p-6 space-y-4 flex flex-col justify-between hover:border-[var(--line-strong)] transition-colors">
            <div className="space-y-2.5">
              <span className="text-[11px] font-mono text-[var(--ok)] uppercase font-semibold">
                03 / Source inspection
              </span>
              <h3 className="text-base font-semibold text-[var(--ink)]">
                Inspect sources and support status
              </h3>
              <p className="text-xs text-[var(--ink-2)] leading-relaxed">
                Reports include source references and evidence checks where available. Open the source and verify that it supports the statement in context.
              </p>
            </div>

            {/* Describes available report evidence without inventing a result or source. */}
            <div className="p-3 bg-[var(--surface-2)] rounded-[6px] border border-[var(--line)] text-xs space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--ink-3)]">A report may include</span>
              <ul className="space-y-1 text-[11px] text-[var(--ink-2)]">
                <li>• A claim with its source reference</li>
                <li>• A retrieved passage or source link, when available</li>
                <li>• A support or review status for the claim</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Section 3: How It Works (#how-it-works) ─────────────────── */}
      <section id="how-it-works" className="w-full max-w-5xl mx-auto px-6 py-20 border-t border-[var(--line)] scroll-mt-12 space-y-12">
        <div className="text-center space-y-2 max-w-xl mx-auto">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
            Execution Flow
          </span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] tracking-tight">
            How Ada conducts deep research
          </h2>
          <p className="text-xs sm:text-sm text-[var(--ink-2)] leading-relaxed">
            From a scoped question to a report that keeps its sources and evidence checks visible.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div className="space-y-3">
            <span className="text-xs font-mono text-[var(--accent)] font-semibold tracking-wider block">
              STEP 01
            </span>
            <h3 className="text-base font-semibold text-[var(--ink)]">Scope & Clarify</h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
            If a question needs more focus, Ada offers a chance to clarify its scope before the research begins.
            </p>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-mono text-[var(--accent)] font-semibold tracking-wider block">
              STEP 02
            </span>
            <h3 className="text-base font-semibold text-[var(--ink)]">Find sources and compare</h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Ada searches through configured providers, retrieves selected library passages, and records the evidence available to the run.
            </p>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-mono text-[var(--accent)] font-semibold tracking-wider block">
              STEP 03
            </span>
            <h3 className="text-base font-semibold text-[var(--ink)]">Write a sourced report</h3>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Reports are assembled from retrieved material. Citation and support checks can flag statements that need closer review.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Bottom Call to Action ──────────────────────────────────── */}
      <section className="w-full max-w-4xl mx-auto px-6 py-20 text-center border-t border-[var(--line)] space-y-6">
        <h2 className="text-2xl sm:text-4xl font-serif font-bold text-[var(--ink)] tracking-tight">
          Ready to save hours of reading?
        </h2>
        <p className="text-xs sm:text-sm text-[var(--ink-2)] max-w-lg mx-auto leading-relaxed">
          Launch your first deep research investigation today. No credit card required.
        </p>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/register"
            className="btn-primary text-xs px-6 py-2.5"
          >
            <span>Get Started Free</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
          <a
            href="/login"
            className="btn-secondary text-xs px-6 py-2.5"
          >
            Sign In to Workspace
          </a>
        </div>
      </section>
      </>
      )}

      {/* ─── Footer ─────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-[var(--line)] py-8 px-6 text-xs text-[var(--ink-3)]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-[var(--ink)]">Ada Research Desk</span>
            <span>·</span>
            <span>Personal research workspace</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[11px]">
            {!user && <a href="#features" className="hover:text-[var(--ink)] transition-colors">Features</a>}
            {!user && <a href="#how-it-works" className="hover:text-[var(--ink)] transition-colors">How It Works</a>}
            <Link href="/architecture" className="hover:text-[var(--ink)] transition-colors">Architecture</Link>
            {user && <Link href="/history" className="hover:text-[var(--ink)] transition-colors">History</Link>}
            {!user && <Link href="/login" className="hover:text-[var(--ink)] transition-colors">Sign In</Link>}
            {!user && <Link href="/register" className="hover:text-[var(--ink)] transition-colors">Register</Link>}
          </div>
        </div>
      </footer>

      {/* Screen 7.2: Scoping / Clarification Dialog */}
      <ClarificationModal
        key={blueprint ? JSON.stringify(blueprint) : "empty-blueprint"}
        isOpen={scopingModalOpen}
        query={query}
        blueprint={blueprint}
        loading={submitting}
        onClose={() => setScopingModalOpen(false)}
        onSkip={() => {
          setScopingModalOpen(false);
          dispatchRun({});
        }}
        onConfirm={(calibrated) => {
          setScopingModalOpen(false);
          dispatchRun(calibrated);
        }}
      />
    </div>
  );
}
