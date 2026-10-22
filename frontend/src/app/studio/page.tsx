"use client";

import { Suspense, useState, useEffect, useRef, type SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { 
  ArrowRight, Database, ChevronDown,
  FileText, AlertCircle, Plus, RotateCcw, 
  Clock, X
} from "lucide-react";
import Navbar from "@/components/Navbar";
import PreflightModal from "@/components/PreflightModal";
import { useAuth } from "@/context/AuthContext";
import { API_URL, formatDossierDate } from "@/lib/config";
import { useResearchLaunch } from "@/hooks/useResearchLaunch";
import type { ResearchDomain } from "@/hooks/useResearchLaunch";
import type {
  ResearchReportListResponse,
  ResearchReportSummary,
  VaultDocumentSummary,
  VaultListResponse,
} from "@/lib/api-types";

const DOMAIN_FILTERS = [
  { id: "all", label: "All Evidence", desc: "Broad consensus" },
  { id: "academic", label: "Peer-Reviewed", desc: "arXiv, ScienceDirect, PubMed" },
  { id: "financial", label: "Market & Filings", desc: "Industry reports, SEC filings" },
  { id: "technical", label: "Specs & Docs", desc: "Engineering whitepapers & specs" },
] satisfies Array<{ id: ResearchDomain; label: string; desc: string }>;

interface StudioHistoryState {
  token: string;
  reports: ResearchReportSummary[];
  pending: boolean;
  error: boolean;
}

interface StudioVaultState {
  token: string;
  documents: VaultDocumentSummary[];
  selectedDocs: string[];
  includeDocs: boolean;
  pending: boolean;
  error: boolean;
}

function ResearchStudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user, loading: authLoading } = useAuth();

  // Search query & options
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [depth, setDepth] = useState<"quick" | "standard" | "deep">("standard");
  const [selectedDomain, setSelectedDomain] = useState<ResearchDomain>("all");
  const {
    loading,
    error: errorMsg,
    scopingModalOpen,
    blueprint: blueprintData,
    preparedQuery,
    recalibrating,
    recalibrationError,
    start: startResearch,
    confirm: confirmResearch,
    skip: skipScoping,
    recalibrate: recalibrateScope,
    closeScoping,
  } = useResearchLaunch(token);

  // Recent reports for left sidebar
  const [historyState, setHistoryState] = useState<StudioHistoryState | null>(null);
  const currentHistory = token && historyState?.token === token ? historyState : null;
  const recentReports = currentHistory?.reports ?? [];
  const historyRequestPending = Boolean(token) && (!currentHistory || currentHistory.pending);
  const loadingHistory = Boolean(token) && historyRequestPending;
  const historyError = currentHistory?.error ?? false;

  // Vault documents & anchored popover
  const [vaultState, setVaultState] = useState<StudioVaultState | null>(null);
  const currentVault = token && vaultState?.token === token ? vaultState : null;
  const vaultDocs = currentVault?.documents ?? [];
  const selectedDocs = currentVault?.selectedDocs ?? [];
  const includeDocs = currentVault?.includeDocs ?? false;
  const vaultRequestPending = Boolean(token) && (!currentVault || currentVault.pending);
  const loadingVault = Boolean(token) && vaultRequestPending;
  const vaultError = currentVault?.error ?? false;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setSelectedDocs = (update: SetStateAction<string[]>) => {
    if (!token) return;
    setVaultState((current) => {
      if (!current || current.token !== token) return current;
      return {
        ...current,
        selectedDocs: typeof update === "function" ? update(current.selectedDocs) : update,
      };
    });
  };

  const setIncludeDocs = (update: SetStateAction<boolean>) => {
    if (!token) return;
    setVaultState((current) => {
      if (!current || current.token !== token) return current;
      return {
        ...current,
        includeDocs: typeof update === "function" ? update(current.includeDocs) : update,
      };
    });
  };

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => searchParams.get("session_id"));

  // Guard: if unauthenticated, redirect to login
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/studio");
    }
  }, [user, authLoading, router]);

  // Fetch recent reports for left workbench sidebar
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    fetch(`${API_URL}/api/reports`, { headers, signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load research history");
        return res.json();
      })
      .then((data: ResearchReportListResponse) => {
        if (controller.signal.aborted) return;
        setHistoryState({ token, reports: data.reports.slice(0, 10), pending: false, error: false });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn("Failed to load recent reports:", err);
        setHistoryState({ token, reports: [], pending: false, error: true });
      });

    return () => controller.abort();
  }, [token]);

  // Fetch vault documents
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    fetch(`${API_URL}/api/vault`, { headers, signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load source library");
        return res.json();
      })
      .then((data: VaultListResponse) => {
        if (controller.signal.aborted) return;
        const documents = data.documents;
        const searchableDocs = documents.filter((document) => document.index_status === "searchable");
        setVaultState({
          token,
          documents,
          selectedDocs: searchableDocs.map((document) => document.doc_name),
          includeDocs: searchableDocs.length > 0,
          pending: false,
          error: false,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Failed to load source library:", error);
        setVaultState({ token, documents: [], selectedDocs: [], includeDocs: false, pending: false, error: true });
      });

    return () => controller.abort();
  }, [token]);

  // Close vault popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleStartResearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    void startResearch({
      query,
      depth,
      domain: selectedDomain,
      includeDocs,
      selectedDocs,
      sessionId: activeSessionId,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleStartResearch();
    }
  };

  const handleClearInquiry = () => {
    setQuery("");
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handleNewSession = () => {
    setQuery("");
    setActiveSessionId(null);
    router.replace("/studio");
    if (textareaRef.current) textareaRef.current.focus();
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans">
        <Navbar />
        <div className="flex-1 flex items-center justify-center font-mono text-xs text-[var(--ink-3)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-quiet-pulse mr-2.5" />
          <span>Opening Research Studio...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 md:py-8">
        {/* Error notification */}
        {errorMsg && (
          <div className="w-full mb-6 p-3 rounded-[8px] bg-[var(--bad-soft)] border border-[var(--bad)]/30 text-[var(--bad)] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 2-Column Industrial Workbench Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Recent Investigations Sidebar (4 cols) */}
          <aside className="lg:col-span-4 bg-[var(--surface)] border border-[var(--line)] rounded-[12px] p-5 space-y-4 shadow-xs">
            {/* Action Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <div className="space-y-0.5">
                <span className="text-[11px] font-mono text-[var(--ink-3)] font-semibold tracking-wider uppercase block">
                  Your research
                </span>
                <h2 className="text-sm font-serif font-bold text-[var(--ink)]">
                  Recent research
                </h2>
              </div>

              <button
                type="button"
                onClick={handleNewSession}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--line)] text-[var(--ink)] text-xs font-medium transition-all cursor-pointer"
                title="Start a fresh investigation"
              >
                <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>New</span>
              </button>
            </div>

            {/* Recent Dossiers List */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold block">
                Recent research{!loadingHistory && !historyError ? ` (${recentReports.length})` : ""}
              </span>

              {loadingHistory ? (
                <div className="py-8 text-center text-xs font-mono text-[var(--ink-3)]">
                  Loading your research…
                </div>
              ) : historyError ? (
                <p role="alert" className="py-8 text-center text-xs text-[var(--ink-3)]">
                  Research history is unavailable right now. Try refreshing this page.
                </p>
              ) : recentReports.length === 0 ? (
                <div className="py-8 text-center space-y-1.5">
                  <p className="text-sm text-[var(--ink-2)]">Your research history will appear here.</p>
                  <p className="text-xs text-[var(--ink-3)]">Start with a question to begin.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                  {recentReports.map((report) => (
                    <div
                      key={report.report_id}
                      className="group p-3 rounded-[8px] bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--line-strong)] transition-all flex flex-col space-y-2"
                    >
                      <Link
                        href={report.status === "completed"
                          ? `/report/${report.report_id}`
                          : `/run/${report.report_id}`}
                        className="text-xs font-medium text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors line-clamp-2"
                      >
                        {report.query || report.executive_title || "Untitled Research"}
                      </Link>

                      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--ink-3)]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[var(--ink-3)]" />
                          <span>
                            {formatDossierDate(report.created_at)}
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={() => setQuery(report.query || "")}
                          className="text-[10px] text-[var(--accent)] hover:underline cursor-pointer font-medium"
                          title="Pre-fill this query in the console"
                        >
                          Use Query ↵
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Vault Navigation Footer */}
            <div className="pt-3 border-t border-[var(--line)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-[var(--ink-2)]">
                <Database className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span className="text-[11px] font-mono">
                  {loadingVault ? "Loading source library…" : vaultError ? "Source library unavailable" : `${vaultDocs.length} ${vaultDocs.length === 1 ? "source" : "sources"}`}
                </span>
              </div>
              <Link
                href="/vault"
                className="text-[11px] text-[var(--ink-3)] hover:text-[var(--ink)] hover:underline transition-colors"
              >
                Open Vault →
              </Link>
            </div>
          </aside>

          {/* Right Column: The Main Command Console (8 cols) */}
          <div className="lg:col-span-8 bg-[var(--surface)] border border-[var(--line)] rounded-[12px] p-6 sm:p-7 shadow-xs space-y-6">
            
            {/* Console Header Bar */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
              <div className="space-y-0.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent)] font-semibold block">
                  Research question
                </span>
                <h1 className="text-xl sm:text-2xl font-serif font-bold text-[var(--ink)] tracking-tight">
                  What would you like to find out?
                </h1>
              </div>

              {query && (
                <button
                  type="button"
                  onClick={handleClearInquiry}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  title="Clear inquiry text"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* Form */}
            <form onSubmit={handleStartResearch} className="space-y-5">
              
              {/* Inquiry Textarea */}
              <div className="space-y-2">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={4}
                    placeholder="Describe what you want to understand, compare, or verify…"
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] focus:border-[var(--accent)] rounded-[8px] px-4 py-3 text-xs sm:text-sm text-[var(--ink)] placeholder:text-[var(--ink-3)]/60 focus:outline-none transition-all font-sans leading-relaxed resize-none shadow-xs"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)] font-mono px-1">
                  <span>Press ⌘↵ or Ctrl+Enter to launch</span>
                  <span>{query.length} characters</span>
                </div>
              </div>

              {/* Domain Filters Row */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono text-[var(--ink-3)] uppercase tracking-wider font-semibold block">
                  Domain Filter:
                </span>
                <div className="flex flex-wrap gap-2">
                  {DOMAIN_FILTERS.map((f) => {
                    const isSelected = selectedDomain === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                  onClick={() => setSelectedDomain(f.id)}
                        className={`px-3 py-1.5 rounded-[6px] text-xs transition-all cursor-pointer ${
                          isSelected
                            ? "bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/60 font-semibold shadow-xs"
                            : "bg-[var(--surface-2)] text-[var(--ink-2)] border border-[var(--line)] hover:text-[var(--ink)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Controls Bar: Depth, Anchored Vault Popover & Launch Button */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[var(--line)]">
                <div className="flex flex-wrap items-center gap-3">
                  
                  {/* Research depth */}
                  <div className="flex items-center bg-[var(--surface-2)] p-1 rounded-[6px] border border-[var(--line)]" role="group" aria-label="Research depth">
                    <button
                      type="button"
                      aria-pressed={depth === "quick"}
                      onClick={() => setDepth("quick")}
                      className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors cursor-pointer ${depth === "quick" ? "bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)] font-semibold shadow-xs" : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"}`}
                    >
                      Quick
                    </button>
                    <button
                      type="button"
                      aria-pressed={depth === "standard"}
                      onClick={() => setDepth("standard")}
                      className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors cursor-pointer ${depth === "standard" ? "bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)] font-semibold shadow-xs" : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"}`}
                    >
                      Standard
                    </button>
                    <button
                      type="button"
                      aria-pressed={depth === "deep"}
                      onClick={() => setDepth("deep")}
                      className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors cursor-pointer ${
                        depth === "deep"
                          ? "bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)] font-semibold shadow-xs"
                          : "text-[var(--ink-3)] hover:text-[var(--ink-2)]"
                      }`}
                    >
                      Deep Investigation
                    </button>
                  </div>

                  {/* ANCHORED FLOATING POPOVER FOR VAULT DOCUMENTS */}
                  <div className="relative" ref={popoverRef}>
                    <button
                      type="button"
                      onClick={() => setPopoverOpen(!popoverOpen)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-[6px] bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-xs text-[var(--ink-2)] transition-colors cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-[var(--accent)]" />
                      <span>Source library</span>
                      {vaultDocs.some((document) => document.index_status === "searchable") && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)] font-semibold">
                          {includeDocs ? selectedDocs.length : 0}/{vaultDocs.filter((document) => document.index_status === "searchable").length}
                        </span>
                      )}
                      {vaultDocs.length > 0 && !vaultDocs.some((document) => document.index_status === "searchable") && (
                        <span className="text-[10px] text-[var(--warn)]">None indexed</span>
                      )}
                      <ChevronDown className="w-3 h-3 text-[var(--ink-3)] ml-0.5" />
                    </button>

                    {/* Anchored Popover Box */}
                    {popoverOpen && (
                      <div className="absolute top-full left-0 mt-2 z-50 w-72 sm:w-80 rounded-[10px] bg-[var(--surface)] border border-[var(--line-strong)] shadow-xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-100 text-[var(--ink)]">
                        <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
                          <span className="text-xs font-semibold text-[var(--ink)]">
                            Attach sources
                          </span>
                          <div className="flex items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              aria-label="Select all indexed sources"
                              onClick={() => {
                                const searchableDocs = vaultDocs.filter((document) => document.index_status === "searchable");
                                setSelectedDocs(searchableDocs.map((d) => d.doc_name));
                                setIncludeDocs(searchableDocs.length > 0);
                              }}
                              className="text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                            >
                              All
                            </button>
                            <span className="text-[var(--line-strong)]">•</span>
                            <button
                              type="button"
                              aria-label="Clear source selection"
                              onClick={() => {
                                setSelectedDocs([]);
                                setIncludeDocs(false);
                              }}
                              className="text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                            >
                              None
                            </button>
                          </div>
                        </div>

                        {vaultDocs.length === 0 ? (
                          <div className="py-4 text-center text-xs text-[var(--ink-3)] font-mono">
                            No sources in your library.
                            <Link href="/vault" className="text-[var(--accent)] block mt-1 hover:underline">
                              Upload files now →
                            </Link>
                          </div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                            {vaultDocs.map((doc) => {
                              const isSelected = includeDocs && selectedDocs.includes(doc.doc_name);
                              const isSearchable = doc.index_status === "searchable";
                              return (
                                <label
                                  key={doc.doc_name}
                                  aria-disabled={!isSearchable}
                                  className={`flex items-center justify-between p-2 rounded-[6px] border text-xs transition-colors ${!isSearchable ? "cursor-not-allowed opacity-70" : "cursor-pointer"} ${
                                    isSelected
                                      ? "bg-[var(--accent-soft)] border-[var(--accent)]/50 text-[var(--ink)]"
                                      : "bg-[var(--surface-2)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--line-strong)]"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={!isSearchable}
                                      aria-label={`${doc.doc_name}${!isSearchable ? " — not indexed, open source library to index" : ""}`}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedDocs([...selectedDocs, doc.doc_name]);
                                          setIncludeDocs(true);
                                        } else {
                                          const remainingDocs = selectedDocs.filter(d => d !== doc.doc_name);
                                          setSelectedDocs(remainingDocs);
                                          setIncludeDocs(remainingDocs.length > 0);
                                        }
                                      }}
                                      className="rounded-[3px] border-[var(--line)] accent-[var(--accent)] w-3.5 h-3.5 cursor-pointer"
                                    />
                                    <span className="min-w-0">
                                      <span className="truncate block">{doc.doc_name}</span>
                                      {!isSearchable && <span className="block text-[10px] text-[var(--warn)]">Not indexed · prepare it in the library</span>}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-mono text-[var(--ink-3)] ml-2">
                                    {doc.size_kb} KB
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        <div className="pt-2 border-t border-[var(--line)] flex items-center justify-between">
                          <Link href="/vault" className="text-[11px] text-[var(--ink-3)] hover:text-[var(--ink)] hover:underline">
                            Manage source library →
                          </Link>
                          <button
                            type="button"
                            onClick={() => setPopoverOpen(false)}
                            className="px-3 py-1 rounded-[4px] bg-[var(--surface-2)] text-xs text-[var(--ink-2)] hover:text-[var(--ink)] cursor-pointer border border-[var(--line)]"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Submit Launch Button */}
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="btn-primary font-semibold px-6 py-2.5 rounded-[8px] text-xs flex items-center gap-2 transition-all shadow-xs cursor-pointer disabled:opacity-40"
                >
                  <span>{loading ? "Calibrating..." : "Launch Investigation"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Selected Vault Document Chips preview */}
              {includeDocs && selectedDocs.length > 0 && (
                <div className="pt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-[var(--ink-3)] uppercase mr-1">
                    Attached:
                  </span>
                  {selectedDocs.map((docName) => (
                    <span
                      key={docName}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[var(--surface-2)] border border-[var(--line)] text-[11px] text-[var(--ink-2)] font-mono"
                    >
                      <FileText className="w-3 h-3 text-[var(--accent)]" />
                      <span className="max-w-[140px] truncate">{docName}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedDocs(selectedDocs.filter(d => d !== docName))}
                        className="text-[var(--ink-3)] hover:text-[var(--ink)] ml-0.5 p-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </form>
          </div>
        </div>
      </main>

      {/* Pre-flight Blueprint Calibration Dialog */}
      <PreflightModal
        key={blueprintData ? JSON.stringify(blueprintData) : "empty-blueprint"}
        isOpen={scopingModalOpen}
        onClose={closeScoping}
        query={preparedQuery}
        blueprint={blueprintData}
        onConfirm={({ clarificationChoice, customAngles }) => confirmResearch(clarificationChoice, customAngles)}
        onSkip={skipScoping}
        onRecalibrate={recalibrateScope}
        recalibrating={recalibrating}
        recalibrationError={recalibrationError}
      />
    </div>
  );
}

export default function ResearchStudioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--paper)]" />}>
      <ResearchStudioContent />
    </Suspense>
  );
}
