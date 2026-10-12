"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { 
  Search, ArrowRight, Database, ChevronDown, 
  FileText, AlertCircle, Plus, RotateCcw, 
  ExternalLink, Clock, Sparkles, X, Check
} from "lucide-react";
import Navbar from "@/components/Navbar";
import PreflightModal from "@/components/PreflightModal";
import { useAuth } from "@/context/AuthContext";
import { API_URL } from "@/lib/config";

const DOMAIN_FILTERS = [
  { id: "all", label: "All Evidence", desc: "Broad consensus" },
  { id: "academic", label: "Peer-Reviewed", desc: "arXiv, ScienceDirect, PubMed" },
  { id: "financial", label: "Market & Filings", desc: "Industry reports, SEC filings" },
  { id: "technical", label: "Specs & Docs", desc: "Engineering whitepapers & specs" },
];

export default function ResearchStudioPage() {
  const router = useRouter();
  const { token, user } = useAuth();

  // Search query & options
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState<"deep" | "quick">("deep");
  const [selectedDomain, setSelectedDomain] = useState("all");
  const [includeDocs, setIncludeDocs] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Recent reports for left sidebar
  const [recentReports, setRecentReports] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Vault documents & anchored popover
  const [vaultDocs, setVaultDocs] = useState<any[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pre-flight blueprint modal
  const [scopingModalOpen, setScopingModalOpen] = useState(false);
  const [blueprintData, setBlueprintData] = useState<any>(null);
  const [recalibrating, setRecalibrating] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [preparedQuery, setPreparedQuery] = useState<string>("");

  // Read URL query params if user launched from Dashboard, Home, or Session Redirect
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q");
      const sid = params.get("session_id");
      if (q) setQuery(q);
      if (sid) setActiveSessionId(sid);
    }
  }, []);

  // Fetch recent reports for left workbench sidebar
  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/reports`, { headers })
      .then((res) => res.json())
      .then((data) => {
        if (data.reports) setRecentReports(data.reports.slice(0, 10));
      })
      .catch((err) => console.warn("Failed to load recent reports:", err))
      .finally(() => setLoadingHistory(false));
  }, [token]);

  // Fetch vault documents
  useEffect(() => {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`${API_URL}/api/vault`, { headers })
      .then(res => res.json())
      .then(data => {
        if (data.documents) {
          setVaultDocs(data.documents);
          setSelectedDocs(data.documents.map((d: any) => d.doc_name));
        }
      })
      .catch(() => setVaultDocs([]));
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

  const handleStartResearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || loading) return;

    setLoading(true);
    setErrorMsg("");

    let finalQuery = cleanQuery;
    if (selectedDomain === "academic" && !cleanQuery.toLowerCase().includes("academic")) {
      finalQuery += " [Focus: peer-reviewed literature, academic research]";
    } else if (selectedDomain === "financial" && !cleanQuery.toLowerCase().includes("financial")) {
      finalQuery += " [Focus: industry filings, market analysis, economic data]";
    } else if (selectedDomain === "technical" && !cleanQuery.toLowerCase().includes("technical")) {
      finalQuery += " [Focus: technical specifications, engineering benchmarks, whitepapers]";
    }
    setPreparedQuery(finalQuery);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      // Step 1: Pre-flight scoping check
      const res = await fetch(`${API_URL}/api/research/preflight`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: finalQuery,
          depth: depth,
          include_user_docs: includeDocs,
          selected_docs: includeDocs ? selectedDocs : []
        })
      });

      if (!res.ok) throw new Error("Preflight check failed");
      const blueprint = await res.json();
      setBlueprintData(blueprint);
      setScopingModalOpen(true);
    } catch (err: any) {
      console.warn("Preflight check bypassed, dispatching directly:", err);
      dispatchFinalResearch(finalQuery, depth, null, []);
    } finally {
      setLoading(false);
    }
  };

  const dispatchFinalResearch = async (
    targetQuery: string,
    targetDepth: "deep" | "quick",
    clarificationChoice: string | null,
    customAngles: string[]
  ) => {
    setLoading(true);
    setErrorMsg("");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}/api/research`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: targetQuery,
          depth: targetDepth,
          include_user_docs: includeDocs,
          selected_docs: includeDocs ? selectedDocs : [],
          clarification_choice: clarificationChoice,
          custom_angles: customAngles,
          session_id: activeSessionId
        }),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.report_id) {
        router.push(`/report/${data.report_id}`);
      } else {
        throw new Error("Missing report_id from server");
      }
    } catch (err: any) {
      console.error("Research dispatch error:", err);
      setErrorMsg("Failed to dispatch research to Ada engine. Ensure backend is running.");
      setLoading(false);
    }
  };

  const handleConfirmBlueprint = (calibrated: {
    clarificationChoice: string | null;
    customAngles: string[];
  }) => {
    setScopingModalOpen(false);
    dispatchFinalResearch(preparedQuery || query, depth, calibrated.clarificationChoice, calibrated.customAngles);
  };

  const handleSkipBlueprint = () => {
    setScopingModalOpen(false);
    dispatchFinalResearch(preparedQuery || query, depth, null, []);
  };

  const handleRecalibrateBlueprint = async (modificationText: string) => {
    setRecalibrating(true);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}/api/research/preflight`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: preparedQuery || query,
          depth: depth,
          include_user_docs: includeDocs,
          selected_docs: includeDocs ? selectedDocs : [],
          user_modification: modificationText
        })
      });
      if (res.ok) {
        const data = await res.json();
        setBlueprintData(data);
      }
    } catch (err) {
      console.error("Recalibration error:", err);
    } finally {
      setRecalibrating(false);
    }
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
    setSelectedDomain("all");
    setDepth("deep");
    if (textareaRef.current) textareaRef.current.focus();
  };

  return (
    <div className="min-h-screen bg-[#0c0d12] text-[#fafaf9] flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 md:py-10">
        {/* Error notification */}
        {errorMsg && (
          <div className="w-full mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 2-Column Industrial Workbench Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Recent Investigations Sidebar (4 cols) */}
          <aside className="lg:col-span-4 bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 space-y-5 shadow-lg">
            {/* Action Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="space-y-0.5">
                <span className="text-[11px] font-mono text-zinc-400 font-semibold tracking-wider uppercase block">
                  Workbench
                </span>
                <h2 className="text-base font-serif font-bold text-[#fafaf9]">
                  Past Dossiers
                </h2>
              </div>

              <button
                type="button"
                onClick={handleNewSession}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-zinc-300 text-xs font-medium transition-all cursor-pointer"
                title="Start a fresh investigation"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>

            {/* Recent Dossiers List */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-semibold block">
                Recent Inquiries ({recentReports.length})
              </span>

              {loadingHistory ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  Loading your dossiers...
                </div>
              ) : recentReports.length === 0 ? (
                <div className="py-8 text-center space-y-1.5">
                  <p className="text-xs text-zinc-400">No past dossiers yet.</p>
                  <p className="text-[11px] text-zinc-500">Your completed research runs will appear here.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {recentReports.map((report) => (
                    <div
                      key={report.id || report._id}
                      className="group p-3 rounded-xl bg-[#161822] border border-white/[0.06] hover:border-white/[0.18] transition-all flex flex-col space-y-2"
                    >
                      <a
                        href={`/report/${report.id || report._id}`}
                        className="text-xs font-medium text-zinc-200 group-hover:text-white transition-colors line-clamp-2"
                      >
                        {report.query || report.executive_title || "Untitled Research"}
                      </a>

                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <span>
                            {report.created_at ? new Date(report.created_at).toLocaleDateString() : "Recent"}
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={() => setQuery(report.query || "")}
                          className="text-[10px] text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer"
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
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-zinc-400">
                <Database className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-[11px] font-mono">{vaultDocs.length} files in Vault</span>
              </div>
              <a
                href="/vault"
                className="text-[11px] text-zinc-400 hover:text-zinc-200 hover:underline transition-colors"
              >
                Open Vault →
              </a>
            </div>
          </aside>

          {/* Right Column: The Main Command Console (8 cols) */}
          <div className="lg:col-span-8 bg-[#12131a] border border-white/[0.08] rounded-2xl p-6 sm:p-7 shadow-xl space-y-6">
            
            {/* Console Header Bar */}
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
              <div className="space-y-0.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold block">
                  Command Console
                </span>
                <h1 className="text-xl sm:text-2xl font-serif font-bold text-[#fafaf9] tracking-tight">
                  Formulate Investigation Inquiry
                </h1>
              </div>

              {query && (
                <button
                  type="button"
                  onClick={handleClearInquiry}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
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
                    placeholder="Enter any topic or research hypothesis (e.g. Compare solid-state battery energy density benchmarks against current LFP pouch cells, focusing on commercial yield limits)..."
                    className="w-full bg-[#161822] border border-white/[0.08] focus:border-white/[0.22] rounded-xl px-4 py-3.5 text-xs sm:text-sm text-[#fafaf9] placeholder-zinc-500 focus:outline-none transition-all font-sans leading-relaxed resize-none shadow-inner"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono px-1">
                  <span>Press ⌘↵ or Ctrl+Enter to launch</span>
                  <span>{query.length} characters</span>
                </div>
              </div>

              {/* Domain Filters Row */}
              <div className="space-y-2">
                <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider font-semibold block">
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
                        className={`px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer ${
                          isSelected
                            ? "bg-white/[0.1] text-white border border-white/[0.18] font-medium shadow-sm"
                            : "bg-[#161822] text-zinc-400 border border-white/[0.06] hover:text-zinc-200 hover:bg-white/[0.04]"
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Controls Bar: Depth, Anchored Vault Popover & Launch Button */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/[0.06]">
                <div className="flex flex-wrap items-center gap-3">
                  
                  {/* Depth Toggle Pill */}
                  <div className="flex items-center bg-[#161822] p-1 rounded-xl border border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => setDepth("deep")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        depth === "deep"
                          ? "bg-white/[0.1] text-white border border-white/[0.14] font-semibold"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Deep Investigation
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepth("quick")}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        depth === "quick"
                          ? "bg-white/[0.1] text-white border border-white/[0.14] font-semibold"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Standard
                    </button>
                  </div>

                  {/* ANCHORED FLOATING POPOVER FOR VAULT DOCUMENTS */}
                  <div className="relative" ref={popoverRef}>
                    <button
                      type="button"
                      onClick={() => setPopoverOpen(!popoverOpen)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#161822] border border-white/[0.08] hover:border-white/[0.18] text-xs text-zinc-300 transition-colors cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Vault Documents</span>
                      {vaultDocs.length > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.08] text-zinc-300 border border-white/[0.12] font-semibold">
                          {includeDocs ? selectedDocs.length : 0}/{vaultDocs.length}
                        </span>
                      )}
                      <ChevronDown className="w-3 h-3 text-zinc-400 ml-0.5" />
                    </button>

                    {/* Anchored Popover Box */}
                    {popoverOpen && (
                      <div className="absolute top-full left-0 mt-2 z-50 w-72 sm:w-80 rounded-xl bg-[#12131a] border border-white/[0.12] shadow-2xl p-4 space-y-3 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                          <span className="text-xs font-semibold text-[#fafaf9]">
                            Attach Vault Files
                          </span>
                          <div className="flex items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDocs(vaultDocs.map(d => d.doc_name));
                                setIncludeDocs(true);
                              }}
                              className="text-zinc-400 hover:text-white cursor-pointer"
                            >
                              All
                            </button>
                            <span className="text-zinc-600">•</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDocs([]);
                                setIncludeDocs(false);
                              }}
                              className="text-zinc-400 hover:text-white cursor-pointer"
                            >
                              None
                            </button>
                          </div>
                        </div>

                        {vaultDocs.length === 0 ? (
                          <div className="py-4 text-center text-xs text-zinc-500">
                            No documents in your vault.
                            <a href="/vault" className="text-zinc-300 block mt-1 hover:underline">
                              Upload files now →
                            </a>
                          </div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                            {vaultDocs.map((doc) => {
                              const isSelected = includeDocs && selectedDocs.includes(doc.doc_name);
                              return (
                                <label
                                  key={doc.doc_name}
                                  className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                                    isSelected
                                      ? "bg-white/[0.08] border-white/[0.18] text-[#fafaf9]"
                                      : "bg-[#161822] border-white/[0.04] text-zinc-400 hover:bg-white/[0.04]"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedDocs([...selectedDocs, doc.doc_name]);
                                          setIncludeDocs(true);
                                        } else {
                                          setSelectedDocs(selectedDocs.filter(d => d !== doc.doc_name));
                                        }
                                      }}
                                      className="rounded border-zinc-700 bg-zinc-900 text-zinc-300 focus:ring-zinc-400 w-3.5 h-3.5 cursor-pointer accent-zinc-300"
                                    />
                                    <span className="truncate">{doc.doc_name}</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-zinc-500 ml-2">
                                    {doc.size_kb} KB
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                          <a href="/vault" className="text-[11px] text-zinc-400 hover:text-white hover:underline">
                            Manage Vault Files →
                          </a>
                          <button
                            type="button"
                            onClick={() => setPopoverOpen(false)}
                            className="px-3 py-1 rounded-lg bg-white/[0.06] text-xs text-zinc-300 hover:text-white cursor-pointer"
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
                  className="bg-zinc-200 hover:bg-white disabled:opacity-40 text-zinc-950 font-semibold px-6 py-2.5 rounded-lg text-xs flex items-center gap-2 transition-all shadow-sm cursor-pointer"
                >
                  <span>{loading ? "Calibrating..." : "Launch Investigation"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Selected Vault Document Chips preview */}
              {includeDocs && selectedDocs.length > 0 && (
                <div className="pt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">
                    Attached:
                  </span>
                  {selectedDocs.map((docName) => (
                    <span
                      key={docName}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] text-zinc-300 font-sans"
                    >
                      <FileText className="w-3 h-3 text-zinc-400" />
                      <span className="max-w-[140px] truncate">{docName}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedDocs(selectedDocs.filter(d => d !== docName))}
                        className="hover:text-white text-stone-400 ml-0.5 cursor-pointer"
                        title="Remove file attachment"
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

      {/* Pre-Flight Scoping Modal */}
      {blueprintData && (
        <PreflightModal
          isOpen={scopingModalOpen}
          onClose={() => setScopingModalOpen(false)}
          query={query}
          blueprint={blueprintData}
          onConfirm={handleConfirmBlueprint}
          onSkip={handleSkipBlueprint}
          onRecalibrate={handleRecalibrateBlueprint}
          recalibrating={recalibrating}
        />
      )}
    </div>
  );
}
