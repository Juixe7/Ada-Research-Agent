"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import {
  FolderArchive, UploadCloud, FileText, Trash2, Search,
  CheckCircle2, AlertCircle, Copy, Check, Plus, BookOpen, Layers, X,
  Loader2, RefreshCw,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL, formatDossierDate } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

interface VaultDoc {
  doc_name: string;
  filename?: string;
  size_kb: number;
  chunk_count?: number;
  uploaded_at?: string | number;
  created_at?: string | number;
  status?: string;
}

interface DocPreview {
  doc_name: string;
  filename: string;
  size_kb: number;
  page_count: number;
  char_count: number;
  chunks_indexed: number;
  text: string;
  chunks: Array<{
    chunk_id?: string;
    page_number?: number;
    section_path?: string;
    chunk_index?: number;
    text: string;
    score?: number;
  }>;
}

export default function KnowledgeVaultPage() {
  const { token, loading: authLoading } = useAuth();

  const [documents, setDocuments] = useState<VaultDoc[]>([]);
  const [loadedDocumentsToken, setLoadedDocumentsToken] = useState<string | null>(null);
  const loading = authLoading || Boolean(token && loadedDocumentsToken !== token);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Paste Text Note
  const [showPaste, setShowPaste] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);

  // Document Inspection (Right Pane)
  const [selectedDocName, setSelectedDocName] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [reindexingDoc, setReindexingDoc] = useState<string | null>(null);
  const previewRequestId = useRef(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"reader" | "passages">("reader");
  const [copiedText, setCopiedText] = useState(false);
  const [inspectFilter, setInspectFilter] = useState("");
  const selectedDocNameRef = useRef<string | null>(null);
  const documentsRequestId = useRef(0);

  const handleOpenPreview = useCallback(async (docName: string) => {
    const requestId = ++previewRequestId.current;
    selectedDocNameRef.current = docName;
    setSelectedDocName(docName);
    setPreviewDoc(null);
    setLoadingPreview(true);
    setPreviewError(null);
    setInspectFilter("");

    try {
      const res = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Source content unavailable on disk.");
      }
      const data: DocPreview = await res.json();
      if (requestId === previewRequestId.current) setPreviewDoc(data);
    } catch (error: unknown) {
      if (requestId === previewRequestId.current) {
        setPreviewError(error instanceof Error ? error.message : "Unable to read document content.");
      }
    } finally {
      if (requestId === previewRequestId.current) setLoadingPreview(false);
    }
  }, [token]);

  const fetchDocuments = useCallback(async () => {
    if (!token) return;
    const requestId = ++documentsRequestId.current;
    try {
      const headers: Record<string, string> = {};
      headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/vault`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Could not load your source library.");
      }
      const data = await res.json();
      const docs: VaultDoc[] = data.documents || [];
      if (requestId !== documentsRequestId.current) return;
      setDocuments(docs);
      if (docs.length > 0 && !selectedDocNameRef.current) {
        void handleOpenPreview(docs[0].doc_name);
      }
      setErrorMsg("");
    } catch (error: unknown) {
      if (requestId === documentsRequestId.current) {
        setErrorMsg(error instanceof Error ? error.message : "Could not load your source library.");
      }
    } finally {
      if (requestId === documentsRequestId.current) setLoadedDocumentsToken(token);
    }
  }, [token, handleOpenPreview]);

  useEffect(() => {
    if (authLoading || !token) return;
    // Defer the network read until after this render; its completion updates the list state.
    const request = window.setTimeout(() => void fetchDocuments(), 0);
    return () => {
      window.clearTimeout(request);
      documentsRequestId.current += 1;
    };
  }, [authLoading, token, fetchDocuments]);

  // Upload handler
  const handleUpload = async (fileToUpload?: File) => {
    const target = fileToUpload || uploadFile;
    if (!target || uploading) return;
    const extension = target.name.slice(target.name.lastIndexOf(".")).toLowerCase();
    if (![".pdf", ".docx", ".txt", ".md", ".csv"].includes(extension)) {
      setErrorMsg("Choose a PDF, DOCX, TXT, Markdown, or CSV file.");
      return;
    }
    if (target.size > 20 * 1024 * 1024) {
      setErrorMsg("This file is larger than the 20 MB limit.");
      return;
    }

    setUploading(true);
    setStatusMsg("");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", target);

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        headers,
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg(data.message || `Added ${target.name} to your research library.`);
        setUploadFile(null);
        await fetchDocuments();
        if (data.filename) {
          handleOpenPreview(data.filename);
        }
      } else {
        throw new Error(data.detail || "Upload failed");
      }
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const validExtensions = [".pdf", ".docx", ".txt", ".md", ".csv"];
      const fileExt = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (validExtensions.includes(fileExt)) {
        setUploadFile(file);
        handleUpload(file);
      } else {
        setErrorMsg("Supported formats: PDF, DOCX, TXT, Markdown, and CSV.");
      }
    }
  };

  // Paste note handler
  const handlePaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim() || pasting) return;

    setPasting(true);
    setStatusMsg("");
    setErrorMsg("");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}/api/paste-document`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: pasteTitle || "Private Research Memo", text: pasteText }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg("Your research note was added to the source library.");
        setPasteTitle("");
        setPasteText("");
        setShowPaste(false);
        await fetchDocuments();
        if (data.doc_name) {
          handleOpenPreview(data.doc_name);
        }
      } else {
        throw new Error(data.detail || "Note ingestion failed");
      }
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : "Failed to process text memo");
    } finally {
      setPasting(false);
    }
  };

  const handleReindex = async (docName: string) => {
    if (!token || reindexingDoc) return;
    setReindexingDoc(docName);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const response = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}/reindex`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Could not index this source.");
      setStatusMsg(`Indexed ${data.chunks_indexed || 0} searchable passages.`);
      await fetchDocuments();
      await handleOpenPreview(docName);
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : "Could not index this source.");
    } finally {
      setReindexingDoc(null);
    }
  };

  // Delete document handler
  const handleDelete = async (docName: string) => {
    if (!confirm(`Permanently remove "${docName}" from your knowledge vault?`)) return;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not remove this source.");
      setDocuments(docs => docs.filter(d => d.doc_name !== docName));
      if (selectedDocName === docName) {
        previewRequestId.current += 1;
        selectedDocNameRef.current = null;
        setPreviewDoc(null);
        setSelectedDocName(null);
        setLoadingPreview(false);
        setPreviewError(null);
      }
      setStatusMsg(`Removed "${docName}" from vault.`);
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : "Could not remove this source.");
    }
  };

  // Copy full text helper
  const handleCopyText = () => {
    if (!previewDoc?.text) return;
    navigator.clipboard.writeText(previewDoc.text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(d => d.doc_name.toLowerCase().includes(q));
  }, [documents, searchQuery]);

  // Filtered passages in inspector
  const filteredPassages = useMemo(() => {
    if (!previewDoc?.chunks) return [];
    if (!inspectFilter.trim()) return previewDoc.chunks;
    const q = inspectFilter.toLowerCase();
    return previewDoc.chunks.filter(c => c.text.toLowerCase().includes(q));
  }, [previewDoc, inspectFilter]);

  const totalSizeKb = useMemo(() => {
    return documents.reduce((acc, d) => acc + (d.size_kb || 0), 0);
  }, [documents]);

  const getFormatBadge = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-50 text-red-700 border border-red-200 shrink-0">
          PDF
        </span>
      );
    }
    if (lower.endsWith(".md")) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
          MD
        </span>
      );
    }
    if (lower.endsWith(".docx")) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
          DOCX
        </span>
      );
    }
    if (lower.endsWith(".csv")) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
          CSV
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-neutral-50 text-neutral-700 border border-neutral-200 shrink-0">
        {lower.endsWith(".txt") ? "TXT" : "FILE"}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 md:py-8 flex flex-col xl:flex-row gap-6 overflow-hidden">

        {/* ─── Left Pane (390px): Document Library & Ingestion ───────── */}
        <section className="w-full xl:w-[390px] shrink-0 flex flex-col space-y-4">

          {/* Header */}
          <div className="space-y-1.5 pb-4 border-b border-[var(--line)]">
            <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-3)]">
              <span className="font-medium">Your sources</span>
              <span aria-live="polite">
                {loading ? "Loading…" : `${documents.length} ${documents.length === 1 ? "source" : "sources"} · ${totalSizeKb > 0 ? `${totalSizeKb.toFixed(0)} KB` : "0 KB"}`}
              </span>
            </div>
            <h1 className="text-2xl font-serif font-bold text-[var(--ink)] tracking-tight">
              Source library
            </h1>
            <p className="text-xs text-[var(--ink-2)] leading-relaxed">
              Add your documents and notes to use as context in future research.
            </p>
          </div>

          {/* Source upload area */}
          <label
            htmlFor="vaultFileInput"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border border-dashed rounded-xl p-4 transition-all cursor-pointer text-center group ${
              isDragging
                ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]"
                : "bg-gradient-to-b from-[var(--surface)] to-[var(--surface-2)]/60 border-[var(--line-strong)] hover:border-[var(--accent)] text-[var(--ink-2)]"
            }`}
          >
            <input
              id="vaultFileInput"
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const selectedFile = e.target.files[0];
                  setUploadFile(selectedFile);
                  handleUpload(selectedFile);
                  e.currentTarget.value = "";
                }
              }}
            />
            <div className="flex flex-col items-center justify-center space-y-2 py-1">
              <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center text-[var(--accent)] group-hover:scale-105 transition-transform">
                <UploadCloud className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-[var(--ink)]">
                  {uploading ? "Preparing document…" : isDragging ? "Drop to add source" : "Add a source"}
                </p>
                <p className="text-[11px] text-[var(--ink-3)] font-mono">
                  Drag & drop PDF, DOCX, TXT, MD, or CSV • Max 20 MB (20 documents per workspace)
                </p>
              </div>
            </div>
          </label>

          {/* Quick Note Toggle */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowPaste(!showPaste)}
              className="text-[11px] font-mono text-[var(--ink-3)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showPaste ? "Close note editor" : "Write a note"}</span>
            </button>
          </div>

          {/* Inline Memo Composer */}
          {showPaste && (
            <form onSubmit={handlePaste} className="p-3.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl space-y-2.5 text-xs shadow-xs animate-in fade-in duration-150">
              <input
                type="text"
                placeholder="Memo Title (e.g., PV Benchmarking Summary)"
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                className="input-base w-full px-3 py-1.5 text-xs bg-[var(--surface-2)]"
              />
              <textarea
                rows={3}
                placeholder="Paste internal findings, meeting notes, or proprietary excerpts..."
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                className="input-base w-full px-3 py-2 text-xs bg-[var(--surface-2)] font-sans resize-none leading-relaxed"
              />
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] font-mono text-[var(--ink-4)]">
                  Indexed into private vector corpus
                </span>
                <button
                  type="submit"
                  disabled={!pasteText.trim() || pasting}
                  className="btn-primary text-xs py-1 px-3.5 cursor-pointer disabled:opacity-40"
                >
                  {pasting ? "Indexing..." : "Index Memo"}
                </button>
              </div>
            </form>
          )}

          {/* Filter Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--ink-3)]" />
            <input
              type="text"
              aria-label="Filter source library"
              placeholder="Find a document…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-base w-full pl-9 pr-3 py-2 text-xs bg-[var(--surface)] rounded-lg"
            />
          </div>

          {/* Status Alert Notification */}
          {statusMsg && (
            <div role="status" className="p-2.5 bg-[var(--ok-soft)] border border-[var(--ok)]/40 rounded-lg text-sm text-[var(--ok)] flex items-center justify-between gap-2 shadow-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{statusMsg}</span>
              </div>
              <button type="button" aria-label="Dismiss confirmation" onClick={() => setStatusMsg("")} className="text-[var(--ok)] hover:opacity-75">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {errorMsg && (
            <div role="alert" className="p-2.5 bg-[var(--bad-soft)] border border-[var(--bad)] rounded-lg text-sm text-[var(--bad)] flex items-center justify-between gap-2 shadow-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button type="button" aria-label="Dismiss error" onClick={() => setErrorMsg("")} className="text-[var(--bad)] hover:opacity-75">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Document Library Card List */}
          <div className="flex-1 overflow-y-auto space-y-2 border border-[var(--line)] rounded-xl p-2.5 bg-[var(--surface)] min-h-[240px] xl:min-h-[340px] xl:max-h-none max-h-[420px]">
            {loading ? (
              <div className="py-16 text-center text-sm text-[var(--ink-3)]" role="status">
                Loading your library…
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="py-16 text-center text-xs text-[var(--ink-3)] font-mono space-y-1.5 px-4">
                <FolderArchive className="w-6 h-6 mx-auto text-[var(--ink-4)] mb-2" />
                <p className="text-[var(--ink-2)] font-sans font-medium">No sources yet.</p>
                <p className="text-xs text-[var(--ink-3)] font-sans">
                  Add a document or note to use as context in future research.
                </p>
              </div>
            ) : (
              filteredDocuments.map((doc) => {
                const isSelected = selectedDocName === doc.doc_name;
                const uploadDate = doc.uploaded_at || doc.created_at;
                return (
                  <div
                    key={doc.doc_name}
                    className={`p-2 rounded-lg border transition-colors flex items-center justify-between gap-2 text-xs group ${
                      isSelected
                        ? "bg-[var(--surface-2)] border-[var(--accent)] shadow-xs"
                        : "bg-[var(--surface)] border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenPreview(doc.doc_name)}
                      aria-pressed={isSelected}
                      className="min-w-0 flex-1 flex items-center gap-2.5 rounded-md px-1 py-2 text-left focus-visible:outline-offset-2"
                    >
                      {getFormatBadge(doc.doc_name)}
                      <span className="truncate min-w-0 flex-1">
                        <span className={`font-medium truncate block text-sm ${
                          isSelected ? "text-[var(--ink)] font-semibold" : "text-[var(--ink)] group-hover:text-[var(--accent)]"
                        }`}>
                          {doc.doc_name}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-[var(--ink-3)] mt-0.5">
                          <span>{doc.size_kb} KB</span>
                          {uploadDate && <span>{formatDossierDate(uploadDate)}</span>}
                        </span>
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                        (doc.chunk_count || 0) > 0
                          ? "text-[var(--ok)] bg-[var(--ok-soft)] border-[var(--ok)]/30"
                          : "text-[var(--warn)] bg-[var(--warn-soft)] border-[var(--warn)]/30"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${(doc.chunk_count || 0) > 0 ? "bg-[var(--ok)]" : "bg-[var(--warn)]"}`} />
                        <span>{(doc.chunk_count || 0) > 0 ? "Searchable" : "Not searchable"}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.doc_name)}
                      className="h-9 w-9 inline-flex items-center justify-center text-[var(--ink-3)] hover:text-[var(--bad)] rounded-md hover:bg-[var(--bad-soft)] transition-colors shrink-0"
                      aria-label={`Remove ${doc.doc_name} from your library`}
                      title="Remove from library"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ─── Right Pane: Executive Document Reader & Intelligence ──── */}
        <section className="flex-1 flex flex-col border border-[var(--line)] rounded-xl bg-[var(--surface)] overflow-hidden shadow-xs min-h-[600px]">
          {loadingPreview ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-3 font-mono text-xs text-[var(--ink-3)]">
              <span className="w-3 h-3 rounded-full bg-[var(--accent)] animate-quiet-pulse" />
              <span>Opening document & formatting passages...</span>
            </div>
          ) : previewError && !previewDoc ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 max-w-md mx-auto my-auto">
              <div className="w-12 h-12 rounded-full bg-[var(--warn-soft)] border border-[var(--warn)]/30 flex items-center justify-center text-[var(--warn)]">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-serif text-base font-semibold text-[var(--ink)]">
                  Document Content Unavailable
                </h3>
                <p className="text-xs text-[var(--ink-3)] leading-relaxed font-sans">
                  The original source file for &ldquo;{selectedDocName}&rdquo; could not be resolved from local disk. Vector groundings may still exist in memory.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                {selectedDocName && (
                  <button
                    onClick={() => handleDelete(selectedDocName)}
                    className="btn-secondary text-xs py-1.5 px-3.5 text-[var(--bad)] hover:bg-[var(--bad-soft)]"
                  >
                    Remove from Library
                  </button>
                )}
                <button
                  onClick={() => document.getElementById("vaultFileInput")?.click()}
                  className="btn-primary text-xs py-1.5 px-4"
                >
                  Re-upload Document
                </button>
              </div>
            </div>
          ) : previewDoc ? (
            <div className="flex-1 flex flex-col h-full">

              {/* Document Reader Header */}
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--line)] bg-[var(--surface-2)]/60 flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-[var(--ink-3)]">
                    {getFormatBadge(previewDoc.doc_name)}
                    <span className="whitespace-nowrap">
                      {previewDoc.size_kb} KB • {previewDoc.page_count} {previewDoc.page_count === 1 ? "page" : "pages"} • {previewDoc.char_count.toLocaleString()} chars
                    </span>
                    <span className="whitespace-nowrap text-[var(--accent)] font-medium">
                      {previewDoc.chunks_indexed > 0 ? `${previewDoc.chunks_indexed} searchable passages` : "No passages indexed"}
                    </span>
                  </div>
                  <h2 title={previewDoc.doc_name} className="font-serif text-xl font-bold text-[var(--ink)] tracking-tight truncate">
                    {previewDoc.doc_name}
                  </h2>
                </div>

                {/* View Switcher & Action Controls */}
                <div className="flex flex-wrap items-center justify-start 2xl:justify-end gap-2">
                  {previewDoc.chunks_indexed === 0 && (
                    <button
                      type="button"
                      onClick={() => handleReindex(previewDoc.doc_name)}
                      disabled={reindexingDoc !== null}
                      className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-60"
                    >
                      {reindexingDoc === previewDoc.doc_name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span>{reindexingDoc === previewDoc.doc_name ? "Indexing…" : "Index source"}</span>
                    </button>
                  )}
                  <div className="inline-flex items-center border border-[var(--line)] rounded-lg bg-[var(--surface)] p-0.5 text-xs font-sans">
                    <button
                      type="button"
                      onClick={() => setActiveTab("reader")}
                      className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                        activeTab === "reader"
                          ? "bg-[var(--surface-2)] text-[var(--ink)] font-semibold shadow-xs"
                          : "text-[var(--ink-3)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Reader</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("passages")}
                      className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                        activeTab === "passages"
                          ? "bg-[var(--surface-2)] text-[var(--ink)] font-semibold shadow-xs"
                          : "text-[var(--ink-3)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Passages ({previewDoc.chunks?.length || 0})</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyText}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer"
                    title="Copy full document text"
                  >
                    {copiedText ? <Check className="w-3.5 h-3.5 text-[var(--ok)]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{copiedText ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>

              {/* Tab 1: Formatted Document Reader */}
              {activeTab === "reader" && (
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 max-w-3xl mx-auto w-full">
                  <div className="flex items-center justify-between pb-3 border-b border-[var(--line)] text-[11px] font-mono text-[var(--ink-3)]">
                    <span>Document text</span>
                    <span>~{Math.max(1, Math.round(previewDoc.char_count / 1200))} min read</span>
                  </div>

                  {previewDoc.text ? (
                    <article className="max-w-[72ch] text-sm font-sans text-[var(--ink-2)] leading-7 whitespace-pre-wrap selection:bg-[var(--accent-soft)]">
                      {previewDoc.text}
                    </article>
                  ) : (
                    <div className="py-12 text-center text-xs font-mono text-[var(--ink-3)]">
                      No text content could be extracted from this document.
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Indexed Evidence Passages */}
              {activeTab === "passages" && (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  {/* Search inside Passages */}
                  <div className="px-6 py-2.5 border-b border-[var(--line)] bg-[var(--surface)] flex items-center justify-between gap-3">
                    <input
                      type="text"
                      placeholder="Search within extracted passages..."
                      value={inspectFilter}
                      onChange={(e) => setInspectFilter(e.target.value)}
                      className="input-base w-full max-w-sm px-3 py-1.5 text-xs"
                    />
                    <span className="text-[11px] font-mono text-[var(--ink-3)]">
                      Showing {filteredPassages.length} of {previewDoc.chunks?.length || 0} excerpts
                    </span>
                  </div>

                  {/* Passages List */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-3 max-w-3xl mx-auto w-full">
                    {filteredPassages.length === 0 ? (
                      <div className="py-12 text-center text-sm text-[var(--ink-3)]">
                        {previewDoc.chunks?.length
                          ? `No passages match “${inspectFilter}”.`
                          : "No searchable passages were indexed for this source. Its text is still available in the reader. Use Index source above to prepare it for research."}
                      </div>
                    ) : (
                      filteredPassages.map((passage, idx) => (
                        <div
                          key={passage.chunk_id || idx}
                          className="p-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 hover:bg-[var(--surface-2)]/70 transition-all space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between text-[10.5px] font-mono text-[var(--ink-3)]">
                            <span className="text-[var(--accent)] font-semibold flex items-center gap-1.5">
                              <FileText className="w-3 h-3" aria-hidden="true" />
                              <span>Passage {passage.chunk_index || idx + 1} • Page {passage.page_number || 1}</span>
                            </span>
                            {passage.score !== undefined && (
                              <span className="text-[var(--ink-4)]">Relevance: {(passage.score * 100).toFixed(0)}%</span>
                            )}
                          </div>
                          {passage.section_path && (
                            <p className="text-[10px] font-medium tracking-wide text-[var(--ink-3)]">
                              {passage.section_path}
                            </p>
                          )}
                          <p className="font-serif text-xs sm:text-sm text-[var(--ink)] leading-relaxed italic border-l-2 border-[var(--accent)]/40 pl-3 py-0.5">
                            &ldquo;{passage.section_path && passage.text.startsWith(`Section: ${passage.section_path}\n\n`)
                              ? passage.text.slice(`Section: ${passage.section_path}\n\n`.length)
                              : passage.text}&rdquo;
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-[var(--ink-3)] space-y-4 max-w-md mx-auto my-auto">
              <div className="w-14 h-14 rounded-full bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center text-[var(--accent)]">
                <FolderArchive className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                  <h3 className="font-serif text-base font-semibold text-[var(--ink)]">
                    Choose a document
                </h3>
                <p className="text-xs text-[var(--ink-3)] leading-relaxed font-sans">
                  Select a source from your library to read its text or browse searchable passages.
                </p>
              </div>
              <button
                onClick={() => document.getElementById("vaultFileInput")?.click()}
                className="btn-primary text-xs py-2 px-4 shadow-xs"
              >
                Add a source
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
