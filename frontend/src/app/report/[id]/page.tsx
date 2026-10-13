"use client";

import { useEffect, useState, use, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  ArrowLeft, CheckCircle2, Clock, FileText, AlertTriangle,
  Copy, Check, X, ArrowUpRight, BookOpen, Hash, Printer,
  Download, MessageSquare, Send, Loader2, ChevronLeft, ChevronRight,
  Database, RefreshCw, Plus, Share2, Globe, Lock, Edit3, Activity,
  PanelLeftClose, PanelLeftOpen, Search, Sparkles
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

export default function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const reportId = resolvedParams.id;
  const { token } = useAuth();

  // Report & Pipeline State
  const [report, setReport] = useState<any>(null);
  const [status, setStatus] = useState<string>("planning");
  const [initialLoading, setInitialLoading] = useState(true);
  const [stage, setStage] = useState<string>("Initializing investigation...");
  const [progress, setProgress] = useState(10);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(false);

  // Multi-Turn Session State
  const [sessionData, setSessionData] = useState<any>(null);

  // Layout & Navigation State
  const [viewMode, setViewMode] = useState<"continuous" | "pager">("continuous");
  const [activeChapterIdx, setActiveChapterIdx] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [tocCollapsed, setTocCollapsed] = useState(false);

  // Side Evidence Inspector State
  const [selectedCitation, setSelectedCitation] = useState<any>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Highlight Q&A (Reading Assistant) State
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const selectedTextRef = useRef<string>("");
  const [floatingMenu, setFloatingMenu] = useState<{ text: string; x: number; y: number } | null>(null);
  const [highlightQuestion, setHighlightQuestion] = useState("");
  const [highlightAnswer, setHighlightAnswer] = useState<string | null>(null);
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [readingAssistantOpen, setReadingAssistantOpen] = useState(false);
  const [assistantSelectedText, setAssistantSelectedText] = useState("");

  // Standalone Addendum Composer State
  const [addendumInquiry, setAddendumInquiry] = useState("");
  const [addendumLoading, setAddendumLoading] = useState(false);

  // Source Q&A State
  const [sourceQuestion, setSourceQuestion] = useState("");
  const [sourceAnswer, setSourceAnswer] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Timer during active execution
  useEffect(() => {
    if (initialLoading || status === "completed" || status === "failed" || status === "cancelled" || status === "not_found") return;
    const interval = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [status, initialLoading]);

  // Status Polling Loop
  useEffect(() => {
    let isMounted = true;
    let pollInterval: any = null;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/report/status/${reportId}`);
        if (!res.ok) {
          if (res.status === 404 && isMounted) {
            setStatus("not_found");
            if (pollInterval) clearInterval(pollInterval);
          }
          return;
        }
        const data = await res.json();
        if (!isMounted) return;

        setStatus(data.status);
        if (data.stage) setStage(data.stage);
        if (data.progress) setProgress(data.progress);
        if (data.query) {
          setReport((prev: any) => ({ ...(prev || {}), query: data.query }));
        }

        if (data.status === "completed" && data.result) {
          setReport(data.result);
          if (data.result.session_id) {
            fetchSession(data.result.session_id);
          }
          clearInterval(pollInterval);
        } else if (data.status === "cancelled" || data.status === "failed") {
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.warn("Status poll warning:", err);
      } finally {
        if (isMounted) {
          setInitialLoading(false);
        }
      }
    };

    fetchStatus();
    pollInterval = setInterval(fetchStatus, 2000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [reportId]);

  // Fetch session details if part of a multi-turn session
  const fetchSession = async (sessionId: string) => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_URL}/api/sessions/${sessionId}`, { headers });
      if (res.ok) {
        const sData = await res.json();
        setSessionData(sData);
      }
    } catch (err) {
      console.warn("Session fetch warning:", err);
    }
  };

  // Scroll Progress Listener
  useEffect(() => {
    const handleScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total > 0) {
        setScrollProgress(Math.min(100, Math.max(0, Math.round((window.scrollY / total) * 100))));
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Cancel Investigation
  const handleCancelResearch = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`${API_URL}/api/research/${reportId}/cancel`, {
        method: "POST"
      });
      if (res.ok) {
        setStatus("cancelled");
        setStage("Investigation cancelled by user.");
        showToast("Investigation cancelled.");
      }
    } catch (err) {
      console.error("Cancel failed:", err);
    } finally {
      setCancelling(false);
    }
  };

  // Text selection handler for reading assistant
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // If clicking inside the floating toolbar, do not close or clear
      if (floatingMenuRef.current && floatingMenuRef.current.contains(e.target as Node)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setFloatingMenu(null);
        return;
      }
      const text = selection.toString().trim();
      if (text.length > 8) {
        selectedTextRef.current = text;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setFloatingMenu({
          text,
          x: rect.left + rect.width / 2,
          y: Math.max(10, rect.top - 44)
        });
      } else {
        setFloatingMenu(null);
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const executeQuerySelection = async (text: string, question: string) => {
    setHighlightLoading(true);
    setHighlightAnswer(null);

    try {
      const res = await fetch(`${API_URL}/api/report/${reportId}/query-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_text: text,
          question: question
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.answer) {
        setHighlightAnswer(data.answer);
      } else {
        const errorMsg = data?.detail || data?.message || (res.status === 429 ? "AI rate limit reached. Please wait 30 seconds." : "Unable to extract an answer for this passage.");
        setHighlightAnswer(errorMsg);
      }
    } catch (err: any) {
      setHighlightAnswer("Error contacting inline assistant.");
    } finally {
      setHighlightLoading(false);
    }
  };

  const handleOpenReadingAssistant = (presetPrompt?: string) => {
    const textToQuery = selectedTextRef.current || floatingMenu?.text || "";
    if (!textToQuery) return;
    setAssistantSelectedText(textToQuery);
    setHighlightQuestion(presetPrompt || "");
    setHighlightAnswer(null);
    setInspectorOpen(false);
    setReadingAssistantOpen(true);
    setFloatingMenu(null);
    if (presetPrompt) {
      executeQuerySelection(textToQuery, presetPrompt);
    }
  };

  // Ask Reading Assistant a question on highlighted passage
  const handleAskReadingAssistant = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!highlightQuestion.trim() || highlightLoading) return;
    await executeQuerySelection(assistantSelectedText, highlightQuestion.trim());
  };

  // Ask question on specific source citation
  const handleQuerySource = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedCitation || !sourceQuestion.trim() || sourceLoading) return;

    setSourceLoading(true);
    setSourceAnswer(null);

    try {
      const res = await fetch(`${API_URL}/api/report/${reportId}/query-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: selectedCitation.id,
          question: sourceQuestion.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.answer) {
        setSourceAnswer(data.answer);
      } else {
        setSourceAnswer("This source does not mention that specific information.");
      }
    } catch (err) {
      setSourceAnswer("Failed to interrogate source citation.");
    } finally {
      setSourceLoading(false);
    }
  };

  // Author & Append an Addendum
  const handleCreateAddendum = async (inquiryText: string) => {
    if (!inquiryText.trim() || addendumLoading) return;

    setAddendumLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/report/${reportId}/addendum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inquiry: inquiryText.trim(),
          context: report?.monograph?.slice(0, 800) || ""
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.addendum_markdown) {
        setReport((prev: any) => ({
          ...prev,
          monograph: data.monograph || ((prev?.monograph || prev?.report_markdown || "") + "\n\n" + data.addendum_markdown),
          report_markdown: data.updated_report_markdown || ((prev?.report_markdown || prev?.monograph || "") + "\n\n" + data.addendum_markdown)
        }));
        setAddendumInquiry("");
        showToast("Authoritative Addendum appended to monograph.");
      } else {
        const errorMsg = data?.detail || data?.message || (res.status === 429 ? "AI rate limit reached. Please wait 30 seconds." : "Failed to generate Addendum.");
        showToast(errorMsg);
      }
    } catch (err: any) {
      showToast(err?.message || "Error generating Addendum.");
    } finally {
      setAddendumLoading(false);
    }
  };

  // Toggle Public Sharing Link
  const handleTogglePublic = async () => {
    if (!token) {
      showToast("Sign in to toggle public sharing.");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/report/${reportId}/toggle-public`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setIsPublic(data.is_public);
        showToast(data.is_public ? "Public share link enabled." : "Dossier set to private.");
      }
    } catch (err) {
      showToast("Failed to update privacy settings.");
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    showToast("Link copied to clipboard.");
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintPDF = () => {
    window.print();
  };

  // Citation index lookup
  const citationIndex = useMemo(() => {
    const map = new Map<string, any>();
    if (report?.citation_guard_audit?.verified_citations) {
      for (const c of report.citation_guard_audit.verified_citations) {
        map.set(c.id, c);
      }
    }
    if (report?.evidence_manifest) {
      for (const ev of report.evidence_manifest) {
        if (!map.has(ev.source_id)) {
          map.set(ev.source_id, {
            id: ev.source_id,
            title: ev.title || ev.doc_name,
            url: ev.url,
            doc_name: ev.doc_name,
            source_type: ev.source_type,
            snippet: ev.text
          });
        }
      }
    }
    return map;
  }, [report]);

  // Breakdown chapters for Table of Contents & Chapter Pager
  const chapters = useMemo(() => {
    if (!report?.monograph) return [];
    const lines = report.monograph.split("\n");
    const result: { id: string; title: string; content: string }[] = [];
    let currentChapter = { id: "intro", title: "Introduction & Executive Summary", content: "" };

    for (const line of lines) {
      if (line.startsWith("## ")) {
        if (currentChapter.content.trim()) {
          result.push({ ...currentChapter });
        }
        const chapterTitle = line.replace(/^##\s+/, "").trim();
        const chapterId = chapterTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        currentChapter = { id: chapterId, title: chapterTitle, content: line + "\n" };
      } else {
        currentChapter.content += line + "\n";
      }
    }
    if (currentChapter.content.trim()) {
      result.push(currentChapter);
    }
    return result;
  }, [report?.monograph]);

  // Open citation in Right Inspector
  const handleCitationClick = (citationId: string) => {
    const meta = citationIndex.get(citationId);
    if (meta) {
      setSelectedCitation(meta);
      setSourceQuestion("");
      setSourceAnswer(null);
      setInspectorOpen(true);
    }
  };

  // Custom text renderer to parse inline citations [1], [2], [S1], [D1]
  const renderTextWithCitations = (text: string) => {
    const parts = text.split(/(\[(?:S|D)?\d+\])/g);
    return parts.map((part, idx) => {
      const match = part.match(/^\[((?:S|D)?\d+)\]$/);
      if (match) {
        const cId = match[1];
        return (
          <button
            key={idx}
            type="button"
            onClick={() => handleCitationClick(cId)}
            className="citation-badge"
            title={`View primary source verification [${cId}]`}
          >
            [{cId}]
          </button>
        );
      }
      return part;
    });
  };

  // Custom Markdown Components for editorial reading
  const markdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#fafaf9] mt-8 mb-4 border-b border-white/[0.08] pb-3">
        {children}
      </h1>
    ),
    h2: ({ children, node }: any) => {
      const text = String(children);
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return (
        <h2 id={id} className="text-xl sm:text-2xl font-serif font-semibold tracking-tight text-[#fafaf9] mt-10 mb-3 scroll-mt-24 border-b border-white/[0.06] pb-2">
          {children}
        </h2>
      );
    },
    h3: ({ children }: any) => (
      <h3 className="text-base sm:text-lg font-serif font-semibold text-zinc-200 mt-6 mb-2">
        {children}
      </h3>
    ),
    p: ({ children }: any) => (
      <p className="text-[14.5px] sm:text-[15.5px] text-zinc-300 font-sans leading-[1.75] my-3.5 tracking-[-0.005em]">
        {Array.isArray(children) 
          ? children.map((c, i) => (typeof c === "string" ? renderTextWithCitations(c) : c))
          : typeof children === "string" ? renderTextWithCitations(children) : children}
      </p>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-6 border border-white/[0.08] rounded-xl bg-[#12131a]">
        <table className="w-full text-xs text-left border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className="border-b border-white/[0.08] p-3 text-zinc-400 font-mono font-medium uppercase tracking-wider bg-white/[0.02]">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border-b border-white/[0.04] p-3 text-zinc-300 font-sans">
        {Array.isArray(children) 
          ? children.map((c, i) => (typeof c === "string" ? renderTextWithCitations(c) : c))
          : typeof children === "string" ? renderTextWithCitations(children) : children}
      </td>
    ),
    pre: ({ children }: any) => (
      <pre className="bg-[#12131a] border border-white/[0.08] p-4 rounded-xl overflow-x-auto text-xs font-mono text-zinc-300 my-4">
        {children}
      </pre>
    ),
    code: ({ children, className }: any) => {
      const isInline = !className || !className.includes("language-");
      if (isInline) {
        return (
          <code className="bg-white/[0.06] text-zinc-200 px-1.5 py-0.5 rounded text-xs font-mono">
            {children}
          </code>
        );
      }
      return <code>{children}</code>;
    },
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-zinc-500 pl-4 py-1 my-4 text-zinc-400 italic text-sm">
        {children}
      </blockquote>
    ),
    ul: ({ children }: any) => (
      <ul className="list-disc pl-5 space-y-1.5 my-3 text-[14.5px] text-zinc-300 leading-relaxed">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal pl-5 space-y-1.5 my-3 text-[14.5px] text-zinc-300 leading-relaxed">
        {children}
      </ol>
    ),
    li: ({ children }: any) => (
      <li className="pl-1">
        {Array.isArray(children) 
          ? children.map((c, i) => (typeof c === "string" ? renderTextWithCitations(c) : c))
          : typeof children === "string" ? renderTextWithCitations(children) : children}
      </li>
    )
  };

  const executiveTitle = report?.executive_title || report?.query || "Research Investigation";
  const sourceCount = report?.evidence_manifest?.length || report?.total_sources_cited || 0;

  return (
    <div className="min-h-screen bg-[#0c0d12] text-[#fafaf9] flex flex-col font-sans">
      {/* Top Reading Progress Bar */}
      {status === "completed" && (
        <div 
          className="fixed top-0 left-0 h-0.5 bg-zinc-300 z-50 transition-all duration-150 no-print"
          style={{ width: `${scrollProgress}%` }}
        />
      )}

      <Navbar />

      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-[#161822] border border-white/[0.12] text-xs text-[#fafaf9] shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" />
          <span>{toastMessage}</span>
        </div>
      )}

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
        
        {/* Top Breadcrumb & Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4 no-print">
          <div className="flex items-center gap-3">
            <a
              href="/studio"
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Studio</span>
            </a>
            <span className="text-zinc-600">•</span>
            <span className="text-[11px] font-mono text-zinc-400">
              Dossier #{reportId}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* TOC Collapse Toggle */}
            {status === "completed" && chapters.length > 0 && (
              <button
                type="button"
                onClick={() => setTocCollapsed(!tocCollapsed)}
                className={`flex items-center gap-1.5 text-xs border px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  tocCollapsed
                    ? "bg-white/[0.04] text-zinc-400 hover:text-zinc-200 border-white/[0.08]"
                    : "bg-white/[0.08] text-white border-white/[0.14] font-medium"
                }`}
                title={tocCollapsed ? "Expand Table of Contents" : "Collapse Table of Contents"}
              >
                {tocCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
                <span>TOC</span>
              </button>
            )}

            {/* Evidence Inspector Toggle */}
            {status === "completed" && sourceCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!inspectorOpen && !selectedCitation && report?.evidence_manifest?.length > 0) {
                    const firstEv = report.evidence_manifest[0];
                    setSelectedCitation({
                      id: firstEv.source_id,
                      title: firstEv.title || firstEv.doc_name,
                      url: firstEv.url,
                      doc_name: firstEv.doc_name,
                      source_type: firstEv.source_type,
                      snippet: firstEv.text
                    });
                  }
                  setReadingAssistantOpen(false);
                  setInspectorOpen(!inspectorOpen);
                }}
                className={`flex items-center gap-1.5 text-xs border px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${
                  inspectorOpen
                    ? "bg-white/[0.08] text-white border-white/[0.14] font-medium"
                    : "bg-white/[0.04] text-zinc-400 hover:text-zinc-200 border-white/[0.08]"
                }`}
                title={inspectorOpen ? "Hide Evidence Panel" : "Show Evidence Panel"}
              >
                <Database className="w-3.5 h-3.5" />
                <span>Evidence ({sourceCount})</span>
              </button>
            )}

            {/* View Mode Switcher */}
            {status === "completed" && chapters.length > 1 && (
              <div className="flex items-center bg-[#12131a] border border-white/[0.08] p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewMode("continuous")}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    viewMode === "continuous"
                      ? "bg-white/[0.08] text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <BookOpen className="w-3 h-3" />
                  <span>Continuous</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("pager")}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    viewMode === "pager"
                      ? "bg-white/[0.1] text-white font-semibold shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Hash className="w-3 h-3" />
                  <span>Chapter Pager</span>
                </button>
              </div>
            )}

            {/* Share & Copy Link */}
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 text-xs bg-[#12131a] hover:bg-[#161822] border border-white/[0.08] px-3 py-1.5 rounded-xl text-zinc-300 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3 text-zinc-200" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? "Copied" : "Share"}</span>
            </button>

            {/* Exports */}
            {status === "completed" && (
              <div className="flex items-center gap-1 bg-[#12131a] border border-white/[0.08] p-1 rounded-xl">
                <button
                  onClick={handlePrintPDF}
                  className="px-2.5 py-1 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3 h-3 text-zinc-400" />
                  <span>PDF</span>
                </button>
                <a
                  href={`${API_URL}/api/report/${reportId}/download/markdown`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded transition-colors"
                >
                  .MD
                </a>
                <a
                  href={`${API_URL}/api/report/${reportId}/download/json`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded transition-colors"
                >
                  .JSON
                </a>
              </div>
            )}
          </div>
        </div>

        {/* MULTI-TURN SESSION TURN CAROUSEL */}
        {sessionData && sessionData.turns?.length > 1 && (
          <div className="bg-[#12131a] border border-white/[0.08] rounded-xl p-3 flex items-center justify-between gap-3 overflow-x-auto no-print">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-mono text-zinc-400 uppercase font-semibold shrink-0">
                Session Turns:
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                {sessionData.turns.map((t: any) => {
                  const isCurrent = t.id === reportId;
                  return (
                    <a
                      key={t.id}
                      href={`/report/${t.id}`}
                      className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors shrink-0 flex items-center gap-1.5 ${
                        isCurrent
                          ? "bg-white/[0.1] text-white font-semibold border border-white/[0.12]"
                          : "bg-white/[0.03] text-zinc-400 hover:text-zinc-200 border border-white/[0.05]"
                      }`}
                    >
                      <span>Turn 0{t.turn_index + 1}</span>
                      <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">
                        {t.query?.slice(0, 20)}...
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>

            <a
              href={`/studio?session_id=${sessionData.id}`}
              className="px-3 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs font-medium flex items-center gap-1 shrink-0 transition-colors"
            >
              <Plus className="w-3 h-3 text-zinc-400" />
              <span>Next Turn</span>
            </a>
          </div>
        )}

        {/* INITIAL LOADING STATE (Prevents flash of in-flight terminal on refresh) */}
        {initialLoading && (
          <div className="bg-[#12131a] border border-white/[0.08] rounded-2xl p-12 text-center space-y-4 max-w-xl mx-auto my-12 animate-in fade-in duration-150">
            <div className="w-8 h-8 border-2 border-white/20 border-t-zinc-200 rounded-full animate-spin mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-200">Loading Research Dossier...</p>
              <p className="text-xs text-zinc-500 font-mono">Retrieving verified evidence and citations</p>
            </div>
          </div>
        )}

        {/* NOT FOUND SCREEN */}
        {!initialLoading && status === "not_found" && (
          <div className="bg-[#12131a] border border-white/[0.08] rounded-2xl p-10 md:p-12 text-center space-y-4 max-w-xl mx-auto my-12">
            <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-zinc-300 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-[#fafaf9]">Dossier Not Found</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                The requested research dossier could not be located. It may have expired or been deleted.
              </p>
            </div>
            <div className="pt-2">
              <a
                href="/studio"
                className="px-4 py-2 bg-zinc-200 hover:bg-white text-zinc-900 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Launch New Inquiry</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* ─── ACTIVE INVESTIGATION RUNNING TERMINAL ────────────────── */}
        {!initialLoading && status !== "completed" && status !== "cancelled" && status !== "not_found" && (
          <div className="bg-[#12131a] border border-white/[0.08] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl max-w-4xl mx-auto">
            {/* Header with Inquiry and In-Flight Controls */}
            <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-white/[0.06]">
              <div className="space-y-1.5 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] font-mono text-zinc-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse" />
                  <span>Research in progress • Web & Vault Retrieval</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-400">Parallel Workers</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#fafaf9] tracking-tight">
                  {report?.query || "Investigating research inquiry..."}
                </h2>
                <p className="text-xs text-zinc-400 font-mono flex items-center gap-2">
                  <span className="text-zinc-500">Current Phase:</span>
                  <span className="text-zinc-200">{stage}</span>
                </p>
              </div>

              {/* In-Flight Controls: Edit Query & Cancel */}
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/studio?q=${encodeURIComponent(report?.query || "")}`}
                  className="px-3.5 py-2 bg-white/[0.05] hover:bg-white/[0.09] text-zinc-200 border border-white/[0.09] rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Pause and tweak this query in Studio"
                >
                  <Edit3 className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Edit Query</span>
                </a>

                <button
                  type="button"
                  onClick={handleCancelResearch}
                  disabled={cancelling}
                  className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{cancelling ? "Stopping..." : "Cancel"}</span>
                </button>
              </div>
            </div>

            {/* Subdued Progress Bar & Telemetry */}
            <div className="space-y-2">
              <div className="w-full bg-[#161822] h-2 rounded-full overflow-hidden border border-white/[0.06]">
                <div 
                  className="bg-zinc-300 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Math.max(12, progress)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 pt-0.5">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Elapsed: {elapsedSec}s</span>
                </span>
                <span>{progress}% Completed</span>
              </div>
            </div>

            {/* Pipeline Stage Feed */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Investigation Pipeline</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-500">Live Agent Steps</span>
              </div>

              <div className="bg-[#161822] border border-white/[0.06] rounded-xl p-4 space-y-2.5 font-mono text-xs">
                <div className="flex items-center justify-between py-1 border-b border-white/[0.04] text-[11px]">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${progress >= 10 ? "bg-zinc-200" : "bg-zinc-600"}`} />
                    <span className="text-zinc-200">1. Planning: Formulating search tracks & query decomposition</span>
                  </div>
                  <span className="text-zinc-400 text-[10px] font-semibold">{progress >= 35 ? "Completed" : "In Progress"}</span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-white/[0.04] text-[11px]">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${progress >= 35 ? "bg-zinc-200" : "bg-zinc-600"}`} />
                    <span className="text-zinc-200">2. Retrieval: Crawling academic literature, filings & private vault</span>
                  </div>
                  <span className="text-zinc-400 text-[10px] font-semibold">
                    {progress >= 60 ? "Completed" : progress >= 35 ? "In Progress" : "Pending"}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-white/[0.04] text-[11px]">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${progress >= 60 ? "bg-zinc-200" : "bg-zinc-600"}`} />
                    <span className="text-zinc-200">3. Grounding: Deduplicating content & assembling evidence index</span>
                  </div>
                  <span className="text-zinc-400 text-[10px] font-semibold">
                    {progress >= 72 ? "Completed" : progress >= 60 ? "In Progress" : "Queued"}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 text-[11px]">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${progress >= 72 ? "bg-zinc-200" : "bg-zinc-600"}`} />
                    <span className="text-zinc-200">4. Synthesis: Auditing contradictions & drafting research monograph</span>
                  </div>
                  <span className="text-zinc-400 text-[10px] font-semibold">
                    {progress >= 100 ? "Completed" : progress >= 72 ? "In Progress" : "Queued"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── CANCELLED STATE SCREEN ──────────────────────────────── */}
        {status === "cancelled" && (
          <div className="bg-[#12131a] border border-white/[0.08] rounded-2xl p-8 md:p-12 text-center space-y-5 shadow-2xl max-w-xl mx-auto">
            <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-zinc-300 mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-[#fafaf9]">Investigation Cancelled</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                You stopped this research run before completion. You can adjust your query or launch a fresh inquiry in Studio.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <a
                href={`/studio?q=${encodeURIComponent(report?.query || "")}`}
                className="px-4 py-2 bg-zinc-200 hover:bg-white text-zinc-900 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Edit Query & Re-Scope</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              <a
                href="/studio"
                className="px-4 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Start Over
              </a>
            </div>
          </div>
        )}

        {/* ─── COMPLETED DOSSIER: 3-PANE RESEARCH WORKBENCH ────────── */}
        {status === "completed" && report && (
          <div className="space-y-6" id="dossier-reading-canvas">
            
            {/* Publication Header */}
            <div className="bg-[#12131a] border border-white/[0.08] rounded-2xl p-6 sm:p-8 space-y-4">
              <div className="space-y-2">
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 border border-white/[0.1] font-semibold uppercase tracking-wider">
                  RESEARCH DOSSIER
                </span>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold text-[#fafaf9] tracking-tight leading-[1.2]">
                  {executiveTitle}
                </h1>
                {report.query && (
                  <p className="text-xs sm:text-sm text-zinc-400 font-sans italic border-l-2 border-zinc-600 pl-3">
                    Hypothesis: &ldquo;{report.query}&rdquo;
                  </p>
                )}
              </div>

              {/* Quiet Metadata Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.06] text-xs text-zinc-400 font-mono">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-zinc-300 font-semibold">
                    {sourceCount} Verified Sources
                  </span>
                  <span>•</span>
                  <span>Dual Corpus (Web + Vault)</span>
                  <span>•</span>
                  <span>
                    {Math.max(1, Math.ceil(((report?.monograph || report?.report_markdown || "").trim().split(/\s+/).filter(Boolean).length || 800) / 220))} min read
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePublic}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-stone-300 text-[11px] border border-white/[0.06] transition-colors cursor-pointer"
                  >
                    {isPublic ? <Globe className="w-3 h-3 text-stone-300" /> : <Lock className="w-3 h-3 text-stone-400" />}
                    <span>{isPublic ? "Public Share: ON" : "Private Dossier"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3-PANE LAYOUT: Left TOC + Center Reading Canvas + Right Evidence Inspector */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* MOBILE TOC OVERLAY DRAWER */}
              {!tocCollapsed && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md lg:hidden flex no-print animate-in fade-in duration-150">
                  <div className="w-80 max-w-[85vw] bg-[#12131a] border-r border-white/[0.1] h-full p-5 space-y-4 overflow-y-auto shadow-2xl animate-in slide-in-from-left duration-200">
                    <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-mono text-zinc-400 uppercase font-semibold">
                          Navigation
                        </span>
                        <h3 className="text-sm font-serif font-bold text-zinc-100">Table of Contents</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTocCollapsed(true)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-colors"
                        title="Close Table of Contents"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <nav className="space-y-1">
                      {chapters.map((ch, idx) => (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            if (viewMode === "pager") {
                              setActiveChapterIdx(idx);
                            } else {
                              const el = document.getElementById(ch.id);
                              if (el) el.scrollIntoView({ behavior: "smooth" });
                            }
                            setTocCollapsed(true);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors truncate block ${
                            (viewMode === "pager" && activeChapterIdx === idx)
                              ? "bg-white/[0.08] text-zinc-100 border border-white/[0.1] font-semibold"
                              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                          }`}
                        >
                          {ch.title}
                        </button>
                      ))}
                    </nav>
                  </div>
                  <div className="flex-1" onClick={() => setTocCollapsed(true)} />
                </div>
              )}

              {/* LEFT RAIL: Reading TOC (Desktop) */}
              {!tocCollapsed && (
                <aside className="hidden lg:block lg:col-span-3 sticky top-24 space-y-4 no-print animate-in fade-in duration-150">
                  <div className="bg-[#12131a] border border-white/[0.08] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                      <span className="text-[11px] font-mono text-zinc-400 uppercase font-semibold">
                        Table of Contents
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-500">
                          {chapters.length} sections
                        </span>
                        <button
                          type="button"
                          onClick={() => setTocCollapsed(true)}
                          className="p-1 rounded hover:bg-white/[0.06] text-zinc-400 hover:text-white cursor-pointer transition-colors"
                          title="Collapse Table of Contents"
                        >
                          <PanelLeftClose className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <nav className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                      {chapters.map((ch, idx) => (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            if (viewMode === "pager") {
                              setActiveChapterIdx(idx);
                            } else {
                              const el = document.getElementById(ch.id);
                              if (el) el.scrollIntoView({ behavior: "smooth" });
                            }
                          }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors truncate block ${
                            (viewMode === "pager" && activeChapterIdx === idx)
                              ? "bg-white/[0.08] text-zinc-100 border border-white/[0.1] font-semibold"
                              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                          }`}
                        >
                          {ch.title}
                        </button>
                      ))}
                    </nav>
                  </div>
                </aside>
              )}

              {/* CENTER READING CANVAS */}
              <article className={`
                ${tocCollapsed
                  ? (inspectorOpen || readingAssistantOpen ? "lg:col-span-8" : "lg:col-span-12")
                  : (inspectorOpen || readingAssistantOpen ? "lg:col-span-6" : "lg:col-span-9")
                } min-w-0 space-y-6 transition-all duration-200
              `}>
                <div className="bg-[#12131a] border border-white/[0.08] rounded-xl p-6 sm:p-10 shadow-xl">
                  {viewMode === "pager" && chapters.length > 0 ? (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
                        <span className="text-xs font-mono text-stone-400 font-semibold uppercase">
                          Chapter {activeChapterIdx + 1} of {chapters.length}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={activeChapterIdx === 0}
                            onClick={() => setActiveChapterIdx(i => Math.max(0, i - 1))}
                            className="p-1 rounded-lg bg-white/[0.04] disabled:opacity-30 text-stone-300 hover:text-white cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={activeChapterIdx === chapters.length - 1}
                            onClick={() => setActiveChapterIdx(i => Math.min(chapters.length - 1, i + 1))}
                            className="p-1 rounded-lg bg-white/[0.04] disabled:opacity-30 text-stone-300 hover:text-white cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {chapters[activeChapterIdx]?.content || ""}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {report?.monograph || report?.report_markdown || "No monograph content generated."}
                    </ReactMarkdown>
                  )}
                </div>

                {/* BOTTOM ACTION BAR: Follow-Up Inquiry & Addendums */}
                <div className="bg-[#12131a] border border-white/[0.08] rounded-xl p-5 sm:p-7 space-y-4 shadow-xl no-print">
                  <div className="space-y-1">
                    <span className="text-[11px] font-mono text-zinc-400 uppercase font-semibold">
                      Follow-Up Investigation
                    </span>
                    <h3 className="text-base font-serif font-bold text-[#fafaf9]">
                      Explore a specific follow-up angle
                    </h3>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreateAddendum(addendumInquiry);
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={addendumInquiry}
                      onChange={(e) => setAddendumInquiry(e.target.value)}
                      placeholder="e.g. Compare real-world degradation under extreme winter conditions..."
                      className="flex-1 bg-[#161822] border border-white/[0.08] focus:border-white/[0.22] rounded-lg px-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
                    />
                    <button
                      type="submit"
                      disabled={addendumLoading || !addendumInquiry.trim()}
                      className="px-4 py-2 bg-zinc-200 hover:bg-white disabled:opacity-40 text-zinc-900 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      {addendumLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Investigating...</span>
                        </>
                      ) : (
                        <>
                          <span>Investigate</span>
                          <Send className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </form>

                  {/* Proactive Trajectory Chips */}
                  {report?.suggested_inquiries?.length > 0 && (
                    <div className="pt-2 border-t border-white/[0.05] space-y-1.5">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">
                        Suggested exploration angles:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {report.suggested_inquiries.map((chip: string, i: number) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setAddendumInquiry(chip);
                              handleCreateAddendum(chip);
                            }}
                            className="text-left px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          >
                            + {chip}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </article>

              {/* RIGHT RAIL: Evidence Inspector & Reading Assistant Drawer */}
              {(inspectorOpen || readingAssistantOpen) && (
                <aside className="lg:col-span-3 sticky top-24 space-y-4 no-print animate-in fade-in slide-in-from-right-4 duration-200">
                  {/* EVIDENCE INSPECTOR */}
                  {inspectorOpen && selectedCitation && (
                    <div className="bg-[#12131a] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-2xl">
                      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <span className="citation-badge">
                            [{selectedCitation.id}]
                          </span>
                          <span className="text-xs font-semibold text-[#fafaf9] truncate max-w-[140px]">
                            {selectedCitation.source_type === "user_doc" ? "Vault Document" : "Web Citation"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setInspectorOpen(false)}
                          className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-2 text-xs">
                        <p className="font-semibold text-[#fafaf9] leading-snug">
                          {selectedCitation.title}
                        </p>
                        {selectedCitation.url && (
                          <a
                            href={selectedCitation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-zinc-300 hover:underline flex items-center gap-1 truncate block font-mono"
                          >
                            <span>{selectedCitation.url}</span>
                            <ArrowUpRight className="w-3 h-3 shrink-0" />
                          </a>
                        )}
                        {selectedCitation.snippet && (
                          <div className="bg-[#161822] p-3 rounded-lg border border-white/[0.06] text-[11px] text-zinc-300 italic leading-relaxed max-h-48 overflow-y-auto">
                            &ldquo;{selectedCitation.snippet}&rdquo;
                          </div>
                        )}
                      </div>

                      {/* Source Interrogation Q&A */}
                      <form onSubmit={handleQuerySource} className="space-y-2 pt-2 border-t border-white/[0.06]">
                        <span className="text-[10px] font-mono text-zinc-400 uppercase font-semibold block">
                          Ask about this source:
                        </span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={sourceQuestion}
                            onChange={(e) => setSourceQuestion(e.target.value)}
                            placeholder="e.g. What sample size was tested?"
                            className="flex-1 bg-[#161822] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={sourceLoading || !sourceQuestion.trim()}
                            className="p-1.5 bg-zinc-200 hover:bg-white text-zinc-900 disabled:opacity-40 rounded-lg cursor-pointer shrink-0"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </form>

                      {sourceAnswer && (
                        <div className="bg-white/[0.04] border border-white/[0.08] p-3 rounded-lg text-xs text-zinc-200 space-y-1">
                          <span className="text-[10px] font-mono text-zinc-400 font-semibold block uppercase">
                            Source Audit Answer:
                          </span>
                          <p className="leading-relaxed">{sourceAnswer}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* READING ASSISTANT (Highlight Q&A) */}
                  {readingAssistantOpen && (
                    <div className="bg-[#12131a] border border-white/[0.08] rounded-xl p-5 space-y-4 shadow-2xl">
                      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                        <span className="text-xs font-mono text-zinc-400 uppercase font-semibold">
                          Reading Assistant
                        </span>
                        <button
                          type="button"
                          onClick={() => setReadingAssistantOpen(false)}
                          className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <span className="text-[10px] font-mono text-zinc-500">Selected Passage:</span>
                        <div className="bg-[#161822] p-3 rounded-lg border border-white/[0.06] text-[11px] text-zinc-300 italic max-h-36 overflow-y-auto leading-relaxed">
                          &ldquo;{assistantSelectedText}&rdquo;
                        </div>
                      </div>

                      <form onSubmit={handleAskReadingAssistant} className="space-y-2">
                        <span className="text-[10px] font-mono text-zinc-400 uppercase font-semibold block">
                          What would you like clarified?
                        </span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={highlightQuestion}
                            onChange={(e) => setHighlightQuestion(e.target.value)}
                            placeholder="e.g. Explain this concept simply..."
                            className="flex-1 bg-[#161822] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={highlightLoading || !highlightQuestion.trim()}
                            className="p-1.5 bg-zinc-200 hover:bg-white text-zinc-900 disabled:opacity-40 rounded-lg cursor-pointer shrink-0"
                          >
                            {highlightLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </form>

                      {highlightLoading && (
                        <div className="bg-white/[0.04] border border-white/[0.08] p-3 rounded-lg text-xs text-zinc-300 flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                          <span>Interrogating passage and evidence...</span>
                        </div>
                      )}

                      {highlightAnswer && !highlightLoading && (
                        <div className="bg-white/[0.04] border border-white/[0.08] p-3 rounded-lg text-xs text-zinc-200 space-y-1">
                          <span className="text-[10px] font-mono text-zinc-400 font-semibold block uppercase">
                            Explanation:
                          </span>
                          <p className="leading-relaxed whitespace-pre-line">{highlightAnswer}</p>
                        </div>
                      )}
                    </div>
                  )}
                </aside>
              )}
            </div>
          </div>
        )}
      </main>

      {/* FLOATING TEXT SELECTION TOOLBAR */}
      {floatingMenu && (
        <div
          ref={floatingMenuRef}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="fixed z-50 transform -translate-x-1/2 no-print flex items-center gap-1.5 p-1 rounded-full bg-[#161822] border border-white/[0.14] shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
          style={{ left: floatingMenu.x, top: floatingMenu.y }}
        >
          <button
            type="button"
            onClick={() => handleOpenReadingAssistant("Explain this concept and its significance in clear terms.")}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Generate concise explanation of highlighted text"
          >
            <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
            <span>Explain</span>
          </button>

          <span className="text-zinc-600 text-[11px]">|</span>

          <button
            type="button"
            onClick={() => handleOpenReadingAssistant("What evidence and sources support this specific claim?")}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Inspect evidence corroborating this claim"
          >
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <span>Find Evidence</span>
          </button>

          <span className="text-zinc-600 text-[11px]">|</span>

          <button
            type="button"
            onClick={() => handleOpenReadingAssistant()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Ask custom question"
          >
            <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
            <span>Ask...</span>
          </button>
        </div>
      )}

      {/* FLOATING RESTORE TOC BUTTON */}
      {status === "completed" && chapters.length > 0 && tocCollapsed && (
        <button
          type="button"
          onClick={() => setTocCollapsed(false)}
          className="fixed bottom-6 left-6 z-40 px-3.5 py-2 rounded-full bg-[#161822] border border-white/[0.14] text-xs text-zinc-300 hover:text-white shadow-2xl flex items-center gap-2 backdrop-blur-xl transition-all cursor-pointer hover:border-white/30 animate-in fade-in zoom-in-95 duration-150 no-print"
          title="Open Table of Contents"
        >
          <PanelLeftOpen className="w-3.5 h-3.5 text-zinc-400" />
          <span>Table of Contents</span>
        </button>
      )}
    </div>
  );
}
