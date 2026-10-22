"use client";

import { useMemo, useState } from "react";
import {
  FolderArchive, UploadCloud, Trash2, Search, CheckCircle2, AlertCircle, Plus, X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { formatDossierDate } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";
import VaultPreviewPanel from "@/components/vault/VaultPreviewPanel";
import { useVaultLibrary } from "@/hooks/useVaultLibrary";

export default function KnowledgeVaultPage() {
  const { token, loading: authLoading } = useAuth();
  const {
    documents, loading, totalSizeKb, statusMsg, errorMsg,
    selectedDocName, previewDoc, loadingPreview, previewError,
    uploading, pasting, reindexingDoc,
    openPreview, uploadDocument, addNote, reindexDocument, deleteDocument,
    clearStatus, clearError,
  } = useVaultLibrary(token, authLoading);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Paste Text Note
  const [showPaste, setShowPaste] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const handleUpload = (file: File | null = uploadFile) => {
    if (!file) return;
    void uploadDocument(file).then((uploaded) => {
      if (uploaded) setUploadFile(null);
    });
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

    const file = e.dataTransfer.files.item(0);
    if (file) handleUpload(file);
  };

  // Paste note handler
  const handlePaste = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await addNote(pasteTitle, pasteText);
    if (saved) {
      setPasteTitle("");
      setPasteText("");
      setShowPaste(false);
    }
  };

  // Delete document handler
  const handleDelete = async (docName: string) => {
    if (!confirm(`Permanently remove "${docName}" from your knowledge vault?`)) return;
    await deleteDocument(docName);
  };

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(d => d.doc_name.toLowerCase().includes(q));
  }, [documents, searchQuery]);

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
              <button type="button" aria-label="Dismiss confirmation" onClick={clearStatus} className="text-[var(--ok)] hover:opacity-75">
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
              <button type="button" aria-label="Dismiss error" onClick={clearError} className="text-[var(--bad)] hover:opacity-75">
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
                const uploadDate = doc.uploaded_at;
                const isSearchable = doc.index_status === "searchable";
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
                      onClick={() => void openPreview(doc.doc_name)}
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
                        isSearchable
                          ? "text-[var(--ok)] bg-[var(--ok-soft)] border-[var(--ok)]/30"
                          : "text-[var(--warn)] bg-[var(--warn-soft)] border-[var(--warn)]/30"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isSearchable ? "bg-[var(--ok)]" : "bg-[var(--warn)]"}`} />
                        <span>{isSearchable ? "Searchable" : "Not searchable"}</span>
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

        <VaultPreviewPanel
          key={selectedDocName ?? "empty"}
          preview={previewDoc}
          selectedDocName={selectedDocName}
          loading={loadingPreview}
          error={previewError}
          reindexingDoc={reindexingDoc}
          onDelete={handleDelete}
          onReindex={reindexDocument}
          onRequestUpload={() => document.getElementById("vaultFileInput")?.click()}
        />
      </main>
    </div>
  );
}
