"use client";

import React, { useState, useEffect, useRef, use, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Check, Copy, ExternalLink, Printer,
  ShieldCheck, AlertTriangle, X, ChevronRight, Share2,
  Database, Activity, FileText, CornerDownRight, MessageSquare,
  CheckCircle2, ChevronDown, Plus, Download, Sliders
} from "lucide-react";
import Navbar from "@/components/Navbar";
import RunInspectorDrawer from "@/components/RunInspectorDrawer";
import { API_URL, formatDossierDate } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

function headingText(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(headingText).join("");
  if (React.isValidElement(node)) return headingText((node.props as any).children);
  return "";
}

function headingSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

function sourceDomain(url?: string | null): string {
  if (!url) return "vault";
  try {
    return new URL(url).hostname;
  } catch {
    return "external source";
  }
}

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
  const [report, setReport] = useState<any>(null);
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
  const [selectedCitation, setSelectedCitation] = useState<any>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [runInspectorOpen, setRunInspectorOpen] = useState(false);

  // Screen 7.5 Follow-up Panel
  const [followupQuery, setFollowupQuery] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupThreads, setFollowupThreads] = useState<any[]>([]);
  const [selectedFollowupText, setSelectedFollowupText] = useState("");
  const followupInputRef = useRef<HTMLInputElement>(null);

  // Selection Floating Menu
  const [floatingSelection, setFloatingSelection] = useState<{ text: string; x: number; y: number } | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
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
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/v1/runs/${reportId}/report`, { headers })
      .then(async (res) => {
        if (res.ok) return res.json();
        const fallback = await fetch(`${API_URL}/api/report/status/${reportId}`, { headers });
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
        setReport(data);
        setStatus("completed");
      })
      .catch((err) => {
        console.warn("Report fetch warning:", err);
        setStatus("not_found");
      })
      .finally(() => setLoading(false));
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

  // Citation Index Mapping
  const citationMap = useMemo(() => {
    const map = new Map<string, any>();
    if (!report) return map;

    // Check evidence manifest
    if (report.evidence_manifest) {
      report.evidence_manifest.forEach((ev: any) => {
        const id = ev.source_id || ev.id;
        map.set(id, {
          id,
          title: ev.title || ev.doc_name || "Primary source",
          url: ev.url,
          domain: ev.domain || sourceDomain(ev.url),
          doc_name: ev.doc_name,
          snippet: ev.text || ev.quote || ev.snippet,
          authority: ev.authority_score != null ? ev.authority_score * 5 : null,
          kind: ev.doc_name ? "doc" : "web",
          verdict: "reference_found",
          reason: "Citation ID resolves to a retrieved passage; claim entailment was not evaluated",
        });
      });
    }

    // Check sources list from relational store
    if (report.sources) {
      report.sources.forEach((s: any) => {
        const id = s.source_id || s.id;
        if (!map.has(id)) {
          map.set(id, {
            id,
            title: s.title || s.domain,
            url: s.url,
            domain: s.domain,
            authority: s.authority_tier != null ? s.authority_tier * 5 : null,
            kind: s.kind === "user_doc" || s.kind === "doc" ? "doc" : "web",
            snippet: s.snippet || "",
            verdict: "reference_found",
          });
        }
      });
    }

    return map;
  }, [report]);

  // Chapters for Left Table of Contents
  const chapters = useMemo(() => {
    const md = report?.monograph || report?.report_markdown || "";
    if (!md) return [];
    const lines = md.split("\n");
    const result: { id: string; title: string }[] = [];

    const seen: Record<string, number> = {};
    lines.forEach((line: string) => {
      if (line.startsWith("## ")) {
        const title = line.replace(/^##\s+/, "").replace(/[`*_~]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
        const base = headingSlug(title);
        const occurrence = seen[base] || 0;
        seen[base] = occurrence + 1;
        const id = occurrence ? `${base}-${occurrence + 1}` : base;
        result.push({ id, title });
      }
    });

    if (result.length === 0) {
      result.push({ id: "overview", title: "Executive Intelligence Briefing" });
    }
    return result;
  }, [report]);

  const handleCitationClick = (citationTag: string) => {
    const cleanTag = citationTag.replace(/[\[\]]/g, "");
    const src = citationMap.get(cleanTag) || {
      id: cleanTag,
      title: `Citation [${cleanTag}]`,
      domain: "Indexed Evidence",
      authority: null,
      snippet: "",
      verdict: "unresolved",
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
        setReport((current: any) => current ? { ...current, is_public: data.is_public } : current);
      }
      await navigator.clipboard.writeText(window.location.href);
      showToast(report?.is_public ? "Public dossier link copied." : "Public sharing enabled. Link copied.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not copy dossier link.");
    } finally {
      setSharing(false);
    }
  };

  // Follow-up Inquiry Submission (Screen 7.5)
  const handleFollowupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followupQuery.trim() || followupLoading) return;

    const q = followupQuery.trim();
    setFollowupLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/report/${reportId}/query-evidence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question: q, selected_text: selectedFollowupText }),
      });

      if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        throw new Error(details.detail || "Unable to answer from this report's evidence.");
      }

      const data = await res.json();
      setFollowupThreads((prev) => [
        ...prev,
        {
          id: Date.now(),
          question: q,
          answer: data.answer,
          path: data.verification_status === "verified"
            ? "Checked against report evidence"
            : data.status === "insufficient_evidence"
              ? "No supporting report evidence"
              : "Citations checked · entailment uncertain",
          citations: data.citations || [],
          verificationStatus: data.verification_status,
        },
      ]);
      setFollowupQuery("");
      setSelectedFollowupText("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Follow-up investigation failed.");
    } finally {
      setFollowupLoading(false);
    }
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
  const renderedHeadingCounts = new Map<string, number>();

  // Scores - authentically loaded from report telemetry or null if not yet evaluated
  const scores = report.scores || (report.faithfulness_score !== undefined || report.coverage_score !== undefined ? {
    faithfulness: report.faithfulness_score,
    relevancy: report.relevancy_score,
    authority: report.authority_score,
    coverage: report.coverage_score != null ? report.coverage_score / 100 : null,
  } : null);
  const citationValidity = report.citation_validity_score ?? report.guard_results?.citation_validity_score ?? null;
  const runWarnings = [
    ...(Array.isArray(report.research_warnings) ? report.research_warnings : []),
    ...(Array.isArray(report.provider_warnings) ? report.provider_warnings : []),
  ].map((warning: unknown) => {
    if (typeof warning === "string") return warning;
    if (warning && typeof warning === "object") {
      const item = warning as Record<string, unknown>;
      return String(item.message || item.detail || "A research service was unavailable.");
    }
    return "A research service was unavailable.";
  });

  // Text size class mapping
  const textSizeClasses = {
    S: "text-[15px] leading-[1.65]",
    M: "text-[18px] leading-[1.68]",
    L: "text-[20px] leading-[1.72]",
  };

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
                  className={`block py-1 pl-2.5 transition-all truncate text-xs ${
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

          <div className="pt-4 border-t border-[var(--line)] space-y-2">
            <a
              href="#sources"
              className="text-xs font-mono text-[var(--ink-3)] hover:text-[var(--accent)] block"
            >
              Primary Sources ({sourcesCount}) →
            </a>
          </div>
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

          {/* Monograph Body rendered with Markdown & Citations */}
          <div className={`font-serif ${textSizeClasses[textSize]} text-[var(--ink)] leading-[1.68] space-y-6 monograph-prose`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => {
                  const titleText = headingText(children);
                  const base = headingSlug(titleText);
                  const occurrence = renderedHeadingCounts.get(base) || 0;
                  renderedHeadingCounts.set(base, occurrence + 1);
                  const id = occurrence ? `${base}-${occurrence + 1}` : base;
                  return (
                    <h2
                      id={id}
                      className="font-serif text-[24px] font-semibold text-[var(--ink)] pt-10 pb-2 mt-8 border-t border-[var(--line)] scroll-mt-16 leading-snug"
                    >
                      {children}
                    </h2>
                  );
                },
                h3: ({ children }) => (
                  <h3 className="font-serif text-[19px] font-semibold text-[var(--ink)] pt-6 pb-1 leading-snug">
                    {children}
                  </h3>
                ),
                p: ({ children }) => {
                  return (
                    <p className="my-4 leading-[1.68]">
                      {React.Children.map(children, (child) => {
                        if (typeof child === "string") {
                          // Match inline citation tags like [S1], [D2]
                          const parts = child.split(/(\[(?:S|D)?\d+\])/g);
                          return parts.map((part, pIdx) => {
                            const match = part.match(/^\[((?:S|D)?\d+)\]$/);
                            if (match) {
                              const tag = match[1];
                              return (
                                <button
                                  key={pIdx}
                                  type="button"
                                  onClick={() => handleCitationClick(tag)}
                                  className="citation-badge"
                                  title={`View citation [${tag}]`}
                                >
                                  [{tag}]
                                </button>
                              );
                            }

                            return part;
                          });
                        }
                        return child;
                      })}
                    </p>
                  );
                },
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-[var(--accent)] pl-4 py-1 my-6 font-serif italic text-[var(--ink-2)] bg-transparent">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="my-8 overflow-x-auto border border-[var(--line)] rounded-[6px] bg-[var(--surface)]">
                    <table className="w-full text-left font-sans text-xs">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-[var(--surface-2)] font-mono text-[11px] uppercase text-[var(--ink-3)] border-b border-[var(--line)]">
                    {children}
                  </thead>
                ),
                th: ({ children }) => (
                  <th className="py-2.5 px-3.5 font-semibold text-[var(--ink-2)]">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="py-2.5 px-3.5 border-t border-[var(--line)] font-mono text-[12px] text-[var(--ink)]">
                    {children}
                  </td>
                ),
              }}
            >
              {markdownContent}
            </ReactMarkdown>
          </div>

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

        {/* ── Column 3: SCORES PANEL (Right, 280px, collapses < 1200px) ─ */}
        <aside className="hidden xl:block w-[280px] shrink-0 sticky top-20 space-y-6 font-sans">
          {/* Quality Scores Card */}
          <div className="p-4 rounded-[10px] bg-[var(--surface)] border border-[var(--line)] space-y-4">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold block">
              Evidence Signals
            </span>

            {scores ? (
              <>
                <div className="space-y-3 font-mono text-xs">
                  {/* Claim entailment */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--ink-2)]">Claims supported</span>
                      <span className="font-semibold text-[var(--ok)]">
                        {scores.faithfulness != null ? `${(scores.faithfulness * 100).toFixed(0)}%` : "—"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[var(--line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--ok)] rounded-full"
                        style={{ width: `${scores.faithfulness != null ? scores.faithfulness * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Relevancy */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--ink-2)]">Relevancy</span>
                      <span className="font-semibold text-[var(--ink)]">
                        {scores.relevancy != null ? `${(scores.relevancy * 100).toFixed(0)}%` : "—"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[var(--line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)] rounded-full"
                        style={{ width: `${scores.relevancy != null ? scores.relevancy * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Authority */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--ink-2)]">Source authority estimate</span>
                      <span className="font-semibold text-[var(--ink)]">
                        {scores.authority != null ? `${(scores.authority * 100).toFixed(0)}%` : "—"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[var(--line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--ink-2)] rounded-full"
                        style={{ width: `${scores.authority != null ? scores.authority * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Coverage */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[var(--ink-2)]">Coverage</span>
                      <span className="font-semibold text-[var(--ink)]">
                        {scores.coverage != null ? `${(scores.coverage * 100).toFixed(0)}%` : "—"}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[var(--line)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)] rounded-full"
                        style={{ width: `${scores.coverage != null ? scores.coverage * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between text-[11px] font-mono pt-2 border-t border-[var(--line)]">
                  <span className="text-[var(--ink-2)]">Citation IDs resolved</span>
                  <span className="font-semibold text-[var(--ink)]">{citationValidity != null ? `${(citationValidity * 100).toFixed(0)}%` : "Not measured"}</span>
                </div>

                <p className="text-xs font-sans text-[var(--ink-2)] pt-1 border-t border-[var(--line)] leading-relaxed">
                  Claim support is judged against cited excerpts. Unavailable judgments are shown as unmeasured; citation-ID validity is reported separately.
                </p>
              </>
            ) : (
              <div className="space-y-2 py-1">
                <p className="text-xs font-sans text-[var(--ink-3)] leading-relaxed">
                  Verification telemetry was not recorded for this legacy dossier.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setRunInspectorOpen(true)}
              className="btn-secondary w-full text-xs"
            >
              <span>Open details</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Pruned Claims Section */}
          <div className="p-3.5 rounded-[8px] bg-[var(--surface-2)]/30 border border-[var(--line)] space-y-2 text-xs">
            <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] font-semibold block">
              Unmatched Citation IDs
            </span>
            <p className="text-[11px] text-[var(--ink-3)] leading-relaxed">
              {report.guard_results?.hallucinated_sources_count ?? "—"} citation IDs did not match the retrieved evidence manifest. Claim judgments and reasons are listed in run details.
            </p>
          </div>
        </aside>
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
        sources={report.sources || report.evidence_manifest || []}
        findings={report.findings || []}
        scores={scores}
      />
    </div>
  );
}
