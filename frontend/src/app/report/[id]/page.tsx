"use client";

import React, { useState, useEffect, useRef, use, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Check, Copy, ExternalLink, Printer,
  ShieldCheck, AlertTriangle, X, Share2,
  CheckCircle2
} from "lucide-react";
import Navbar from "@/components/Navbar";
import RunInspectorDrawer from "@/components/RunInspectorDrawer";
import ReportEvidencePanel from "@/components/report/ReportEvidencePanel";
import ReportMonograph from "@/components/report/ReportMonograph";
import { API_URL, formatDossierDate } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";
import { useReportFollowups } from "@/hooks/useReportFollowups";
import {
  buildCitationMap,
  buildReportChapters,
  buildReportSources,
  getReportWarnings,
} from "@/lib/report-content";
import type { CitationDetails, ReportData } from "@/lib/report-types";

export default function ReportReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const reportId = resolvedParams.id;
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();

  // Core Data
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("loading");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Screen 7.4 Toolbar Controls
  const [showVerification, setShowVerification] = useState(false);
  const [textSize, setTextSize] = useState<"S" | "M" | "L">("M");
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string>("");

  // Screen 7.8 Evidence Inspector & Claim Overlay
  const [selectedCitation, setSelectedCitation] = useState<CitationDetails | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [runInspectorOpen, setRunInspectorOpen] = useState(false);

  const followupInputRef = useRef<HTMLInputElement>(null);

  // Selection Floating Menu
  const [floatingSelection, setFloatingSelection] = useState<{ text: string; x: number; y: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const {
    query: followupQuery,
    setQuery: setFollowupQuery,
    loading: followupLoading,
    threads: followupThreads,
    selectedText: selectedFollowupText,
    setSelectedText: setSelectedFollowupText,
    submit: submitFollowup,
  } = useReportFollowups(reportId, token, showToast);

  const navigateToSection = (event: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    event.preventDefault();
    window.history.replaceState(null, "", `#${encodeURIComponent(sectionId)}`);
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    setActiveSectionId(sectionId);
  };

  // Reading progress tracking & Scroll-spy
  useEffect(() => {
    const handleScroll = () => {
      const el = document.documentElement;
      const total = el.scrollHeight - el.clientHeight;
      if (total > 0) {
        setScrollProgress((el.scrollTop / total) * 100);
      }

      // Scroll spy for sections
      const headings = document.querySelectorAll("h2[id]");
      let currentId = "";
      headings.forEach((h) => {
        const top = h.getBoundingClientRect().top;
        if (top < 150) {
          currentId = h.id;
        }
      });
      if (currentId) setActiveSectionId(currentId);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Fetch report data
  useEffect(() => {
    if (authLoading) return;
    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/v1/runs/${reportId}/report`, { headers, signal: controller.signal })
      .then(async (res) => {
        if (res.ok) return res.json();
        const fallback = await fetch(`${API_URL}/api/report/status/${reportId}`, {
          headers,
          signal: controller.signal,
        });
        if (!fallback.ok) throw new Error("Research dossier not found or access denied.");
        const data = await fallback.json();
        if (data.status !== "completed") {
          router.replace(`/run/${reportId}`);
          return null;
        }
        return data.result || data;
      })
      .then((data) => {
        if (!data) return;
        if (data.status && data.status !== "completed") {
          // Still running: redirect to Screen 7.3 Live Hero View
          router.replace(`/run/${reportId}`);
          return;
        }
        if (!data.report_markdown && !data.monograph) {
          setStatus("not_found");
          return;
        }
        setReport(data as ReportData);
        setStatus("completed");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn("Report fetch warning:", err);
        setStatus("not_found");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [authLoading, reportId, token, router]);

  // Handle text selection for "Ask about this" floating action
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setFloatingSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length > 5 && text.length < 500) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setFloatingSelection({
          text,
          x: rect.left + rect.width / 2,
          y: rect.top - 36,
        });
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Report transformations stay pure so section navigation and citation lookup
  // use the same rules in the UI.
  const citationMap = useMemo(() => buildCitationMap(report), [report]);
  const reportSources = useMemo(() => buildReportSources(report), [report]);
  const chapters = useMemo(
    () => buildReportChapters(report?.monograph || report?.report_markdown || ""),
    [report],
  );
  // ReactMarkdown's heading renderer may be invoked more than once in development.
  // Reconcile rendered IDs to the same deterministic list used by the contents links.
  useEffect(() => {
    if (!report) return;
    const headings = Array.from(document.querySelectorAll<HTMLElement>(".monograph-prose h2"));
    headings.forEach((heading, index) => {
      const chapter = chapters[index];
      if (chapter) heading.id = chapter.id;
    });

    if (!window.location.hash) return;
    const sectionId = decodeURIComponent(window.location.hash.slice(1));
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      setActiveSectionId(sectionId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [report, chapters]);
  const sourcesChapter = chapters.find(({ title }) =>
    /^(?:evidence\s+sources|primary\s+sources|sources?\s*(?:&|and)\s*citations?|bibliography)\b/i.test(title)
  );

  const handleCitationClick = (citationTag: string) => {
    const cleanTag = citationTag.replace(/[\[\]]/g, "");
    const src = citationMap.get(cleanTag) || {
      id: cleanTag,
      title: `Citation [${cleanTag}]`,
      domain: "Indexed Evidence",
      authority: null,
      snippet: "",
      verdict: "unresolved",
      kind: "web" as const,
    };
    setSelectedCitation(src);
    setInspectorOpen(true);
  };

  const handleCopyMarkdown = () => {
    const md = report?.monograph || report?.report_markdown || "";
    navigator.clipboard.writeText(md);
    setCopied(true);
    showToast("Report markdown copied to clipboard.");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (sharing || typeof window === "undefined") return;
    setSharing(true);
    try {
      if (!report?.is_public) {
        if (!token) throw new Error("Sign in to enable public sharing.");
        const response = await fetch(`${API_URL}/api/report/${reportId}/toggle-public`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Could not enable public sharing.");
        setReport((current) => current ? { ...current, is_public: Boolean(data.is_public) } : current);
      }
      await navigator.clipboard.writeText(window.location.href);
      showToast(report?.is_public ? "Public dossier link copied." : "Public sharing enabled. Link copied.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not copy dossier link.");
    } finally {
      setSharing(false);
    }
  };

  const handleFollowupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitFollowup();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--paper)] flex flex-col items-center justify-center space-y-3 font-mono text-xs text-[var(--ink-3)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
        <p>Loading research monograph...</p>
      </div>
    );
  }

  if (status === "not_found" || !report) {
    return (
      <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans">
        <Navbar />
        <div className="max-w-md mx-auto my-24 p-8 bg-[var(--surface)] border border-[var(--line)] rounded-[10px] text-center space-y-4">
          <AlertTriangle className="w-6 h-6 text-[var(--warn)] mx-auto" />
          <h2 className="font-serif text-lg font-semibold">Dossier Not Found</h2>
          <p className="text-xs text-[var(--ink-2)]">
            The requested research investigation #{reportId} does not exist or may have expired.
          </p>
          <Link href="/" className="btn-primary inline-flex text-xs">
            Return to Desk
          </Link>
        </div>
      </div>
    );
  }

  const markdownContent = report.monograph || report.report_markdown || "";
  const title = report.executive_title || report.query || "Research Investigation";
  const depth = report.depth || "standard";
  const dateStr = formatDossierDate(report.created_at);
  const sourcesCount = report.sources?.length || report.evidence_manifest?.length || 0;

  // Scores - authentically loaded from report telemetry or null if not yet evaluated
  const scores = report.scores || (report.faithfulness_score !== undefined || report.coverage_score !== undefined ? {
    faithfulness: report.faithfulness_score,
    relevancy: report.relevancy_score,
    authority: report.authority_score,
    coverage: report.coverage_score != null ? report.coverage_score / 100 : null,
  } : null);
  const citationValidity = report.citation_validity_score ?? report.guard_results?.citation_validity_score ?? null;
  const runWarnings = getReportWarnings(report);

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      {/* ─── Reading Progress Bar (Fixed Top hairline) ───────────────── */}
      <div
        className="fixed top-0 left-0 h-[2px] bg-[var(--accent)] z-50 transition-all duration-100 no-print"
        style={{ width: `${scrollProgress}%` }}
      />

      <Navbar />

      {floatingSelection && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setSelectedFollowupText(floatingSelection.text);
            setFollowupQuery((current) => current || "How does this passage relate to the report?");
            setFloatingSelection(null);
            followupInputRef.current?.focus();
          }}
          className="fixed z-[60] -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--ink)] px-3.5 py-2 text-xs font-medium text-[var(--paper)] shadow-lg hover:opacity-90"
          style={{
            left: Math.max(100, Math.min(floatingSelection.x, window.innerWidth - 100)),
            top: Math.max(72, floatingSelection.y),
          }}
        >
          Ask Ada about this
        </button>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-[6px] text-xs text-[var(--ink)] shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ok)]" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ─── Screen 7.4 Sticky 40px Toolbar ──────────────────────────── */}
      <div className="sticky top-0 z-30 h-10 bg-[var(--surface)] hairline-b px-6 flex items-center justify-between text-xs text-[var(--ink-2)] no-print">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/studio")}
            className="flex items-center gap-1.5 text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Desk</span>
          </button>
          <span className="text-[var(--line-strong)]">·</span>
          <span className="font-mono text-[11px] text-[var(--ink-3)]">
            #{reportId}
          </span>
        </div>

        {/* Center / Right Toolbar Controls */}
        <div className="flex items-center gap-2.5">
          {/* Citation reference display */}
          <button
            type="button"
            onClick={() => setShowVerification(!showVerification)}
            className={`chip text-xs py-1 px-2.5 transition-all ${
              showVerification ? "chip-active" : ""
            }`}
            title="Explain what the citation reference check measures."
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Citation check method</span>
          </button>
          {showVerification && (
            <span className="hidden xl:inline max-w-[300px] text-[10px] text-[var(--ink-3)]">
              Citation IDs are checked against retrieved sources; claim support is not scored.
            </span>
          )}

          {/* Text Size Control (S, M, L) */}
          <div className="hidden sm:inline-flex items-center border border-[var(--line)] rounded-[4px] bg-[var(--surface-2)] p-0.5 font-mono text-[11px]">
            {(["S", "M", "L"] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setTextSize(sz)}
                className={`px-2 py-0.5 rounded-[3px] transition-colors ${
                  textSize === sz
                    ? "bg-[var(--surface)] text-[var(--ink)] font-bold shadow-xs"
                    : "text-[var(--ink-3)] hover:text-[var(--ink)]"
                }`}
              >
                {sz}
              </button>
            ))}
          </div>

          <span className="text-[var(--line-strong)] hidden sm:inline">·</span>

          {/* Copy Markdown */}
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="p-1.5 text-[var(--ink-3)] hover:text-[var(--ink)] rounded transition-colors"
            title="Copy as Markdown"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--ok)]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Print PDF */}
          <button
            type="button"
            onClick={() => window.print()}
            className="p-1.5 text-[var(--ink-3)] hover:text-[var(--ink)] rounded transition-colors"
            title="Print or Save as PDF"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={handleShare}
            className="p-1.5 text-[var(--ink-3)] hover:text-[var(--ink)] rounded transition-colors"
            title={report?.is_public ? "Copy public dossier link" : "Enable public sharing and copy link"}
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ─── Screen 7.4 Three-Column Layout ───────────────────────────── */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-10 flex gap-10 justify-between items-start">
        {/* ── Column 1: CONTENTS (Left, 220px, sticky, collapses < 960px) ─ */}
        <nav className="hidden lg:block w-[220px] shrink-0 sticky top-20 space-y-3 font-sans text-xs">
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold block pb-1 border-b border-[var(--line)]">
            Contents
          </span>

          <div className="space-y-1.5">
            {chapters.map((ch) => {
              const isActive = activeSectionId === ch.id;
              return (
                <a
                  key={ch.id}
                  href={`#${ch.id}`}
                  onClick={(event) => navigateToSection(event, ch.id)}
                  aria-current={isActive ? "location" : undefined}
                  title={`Go to ${ch.title}`}
                  className={`block cursor-pointer py-1 pl-2.5 transition-all truncate text-xs hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    isActive
                      ? "border-l-2 border-[var(--accent)] font-semibold text-[var(--ink)]"
                      : "border-l-2 border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                  }`}
                >
                  {ch.title}
                </a>
              );
            })}
          </div>

          {sourcesChapter && (
            <div className="pt-4 border-t border-[var(--line)] space-y-2">
              <a
                href={`#${sourcesChapter.id}`}
                onClick={(event) => navigateToSection(event, sourcesChapter.id)}
                className="block cursor-pointer text-xs font-mono text-[var(--ink-3)] hover:text-[var(--accent)] hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Primary Sources ({sourcesCount}) →
              </a>
            </div>
          )}
        </nav>

        {/* ── Column 2: CENTER READING COLUMN (Max 68ch) ─────────────── */}
        <article className="flex-1 max-w-[68ch] mx-auto w-full space-y-8">
          {/* Article Header (Display Title & Byline) */}
          <header className="space-y-3 pb-6 border-b border-[var(--line)]">
            <h1 className="font-serif text-[32px] sm:text-[36px] font-semibold text-[var(--ink)] leading-[1.18] tracking-tight">
              {title}
            </h1>

            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-[var(--ink-3)]">
              <span className="capitalize">{depth} mode</span>
              <span>·</span>
              <span>{dateStr}</span>
              <span>·</span>
              <span>{sourcesCount} primary sources</span>
              <span>·</span>
              <span>Source-linked report</span>
            </div>
          </header>

          {runWarnings.length > 0 && (
            <aside role="status" className="rounded-lg border border-amber-300/50 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">
              <div className="font-semibold">Some research sources or services were unavailable</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                {Array.from(new Set(runWarnings)).map((warning: string, index: number) => <li key={`${index}-${warning}`}>{warning}</li>)}
              </ul>
            </aside>
          )}

          <ReportMonograph
            markdown={markdownContent}
            textSize={textSize}
            onCitationClick={handleCitationClick}
          />

          {/* ─── Screen 7.5 Docked Follow-Up Panel ─────────────────────── */}
          <section className="pt-12 border-t border-[var(--line)] space-y-4 no-print">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
                Follow-Up Inquiry & Clarifications
              </span>
            </div>

            {selectedFollowupText && (
              <div className="flex items-start justify-between gap-3 rounded border border-[var(--line)] bg-[var(--surface-2)]/40 px-3 py-2 text-xs text-[var(--ink-2)]">
                <span className="line-clamp-2">Asking about: “{selectedFollowupText}”</span>
                <button type="button" onClick={() => setSelectedFollowupText("")} className="shrink-0 text-[var(--ink-3)] hover:text-[var(--ink)]">Clear</button>
              </div>
            )}

            {/* Existing Followup Answers */}
            {followupThreads.map((thread) => (
              <div
                key={thread.id}
                className="p-4 rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)]/40 border-l-2 border-l-[var(--accent)] space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[var(--ink)]">&ldquo;{thread.question}&rdquo;</span>
                  <span className="text-[10px] font-mono text-[var(--ink-3)]">{thread.path}</span>
                </div>
                <p className="font-serif text-sm text-[var(--ink-2)] leading-relaxed">
                  {thread.answer}
                </p>
                {thread.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {thread.citations.map((tag: string) => (
                      <button key={`${thread.id}-${tag}`} type="button" onClick={() => handleCitationClick(tag)} className="citation-badge" title={`Inspect source [${tag}]`}>
                        [{tag}]
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Input Bar */}
            <form onSubmit={handleFollowupSubmit} className="flex gap-2">
              <input
                ref={followupInputRef}
                type="text"
                value={followupQuery}
                onChange={(e) => setFollowupQuery(e.target.value)}
                placeholder="Ask a follow-up about this report..."
                className="input-base flex-1 px-3.5 py-2 text-xs bg-[var(--surface)]"
              />
              <button
                type="submit"
                disabled={!followupQuery.trim() || followupLoading}
                className="btn-primary text-xs"
              >
                {followupLoading ? "Checking evidence..." : "Ask"}
              </button>
            </form>
          </section>
        </article>

        <ReportEvidencePanel
          scores={scores}
          citationValidity={citationValidity}
          unmatchedCitationCount={report.guard_results?.hallucinated_sources_count}
          onOpenDetails={() => setRunInspectorOpen(true)}
        />
      </div>

      {/* ─── Screen 7.8 Evidence Inspector Drawer (Right, 380px) ───────── */}
      {inspectorOpen && selectedCitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40">
          <div className="w-full max-w-[380px] h-full bg-[var(--surface)] border-l border-[var(--line)] p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--accent)]">
                    {selectedCitation.kind === "doc" ? "VAULT" : "RESEARCH"}
                  </span>
                  <span className="text-xs font-mono font-semibold text-[var(--ink)]">
                    Citation [{selectedCitation.id}]
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  className="p-1 text-[var(--ink-3)] hover:text-[var(--ink)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <h3 className="font-serif text-[16px] text-[var(--ink)] leading-snug">
                {selectedCitation.title}
              </h3>

              <div className="text-xs font-mono text-[var(--ink-3)] space-y-1">
                <div>Domain: {selectedCitation.domain}</div>
                <div>Authority estimate: {selectedCitation.authority != null ? `${selectedCitation.authority.toFixed(1)} / 5` : selectedCitation.kind === "doc" ? "User-provided; not scored" : "Not scored"}</div>
              </div>

              {/* Status Verdict */}
              <div className="p-2.5 rounded-[4px] bg-[var(--ok-soft)] border border-[var(--ok)]/40 text-xs flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-[var(--ok)] shrink-0" />
                <span className="text-[var(--ok)] font-medium">
                  {selectedCitation.verdict === "unresolved" ? "Citation reference not found" : "Citation reference located"}
                </span>
              </div>

              {/* Verbatim Excerpt */}
              {selectedCitation.snippet && (
                <div className="space-y-1.5 pt-2">
                  <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] block font-semibold">
                    Source excerpt
                  </span>
                  <p className="font-serif text-xs text-[var(--ink)] bg-[var(--surface-2)] p-3 rounded-[6px] border border-[var(--line)] italic leading-relaxed">
                    &ldquo;{selectedCitation.snippet}&rdquo;
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[var(--line)] flex items-center justify-between">
              {selectedCitation.url && (
                <a
                  href={selectedCitation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <span>Open source</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setInspectorOpen(false)}
                className="btn-primary text-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Screen 7.8 Run Inspector Drawer ─────────────────────────── */}
      <RunInspectorDrawer
        isOpen={runInspectorOpen}
        onClose={() => setRunInspectorOpen(false)}
        runId={reportId}
        token={token}
        sources={reportSources.map((source) => ({
          ...source,
          url: source.url || undefined,
          authority_tier: source.authority_tier ?? undefined,
        }))}
        findings={report.findings || []}
        scores={scores ?? undefined}
      />
    </div>
  );
}
