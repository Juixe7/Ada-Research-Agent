"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  FolderArchive, UploadCloud, FileText, Trash2, Search, 
  CheckCircle2, AlertCircle, RefreshCw, Eye, X, 
  Copy, Check, FileSearch, Layers, BookOpen, Clock,
  ArrowUpDown, Filter, ChevronRight
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

interface VaultDoc {
  doc_name: string;
  size_kb: number;
  chunk_count?: number;
  created_at?: string;
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
    text: string;
    score?: number;
  }>;
}

export default function KnowledgeVaultPage() {
  const { token } = useAuth();

  const [documents, setDocuments] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Document Inspection Drawer
  const [previewDoc, setPreviewDoc] = useState<DocPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "chunks">("text");
  const [copiedText, setCopiedText] = useState(false);
  const [inspectFilter, setInspectFilter] = useState("");

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/api/vault`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (err: any) {
      console.warn("Failed to fetch vault docs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [token]);

  // Upload handler
  const handleUpload = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!uploadFile || uploading) return;

    setUploading(true);
    setStatusMsg("");
    setErrorMsg("");

    const formData = new FormData();
    formData.append("file", uploadFile);

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
        setStatusMsg(data.message || `Indexed ${data.chunks_indexed} passages successfully.`);
        setUploadFile(null);
        fetchDocuments();
      } else {
        throw new Error(data.detail || "Upload failed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Upload failed");
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
      const validExtensions = [".pdf", ".txt", ".md"];
      const fileExt = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (validExtensions.includes(fileExt)) {
        setUploadFile(file);
      } else {
        setErrorMsg("Supported file formats are PDF, Plaintext (.txt), and Markdown (.md).");
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
        body: JSON.stringify({ title: pasteTitle || "Private Research Note", text: pasteText }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg(`Indexed ${data.chunks_indexed} passages into vault corpus.`);
        setPasteTitle("");
        setPasteText("");
        setShowPaste(false);
        fetchDocuments();
      } else {
        throw new Error(data.detail || "Note ingestion failed");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to process text note");
    } finally {
      setPasting(false);
    }
  };

  // Open Document Inspector Drawer
  const handleOpenPreview = async (docName: string) => {
    setLoadingPreview(true);
    setErrorMsg("");
    setInspectFilter("");
    setActiveTab("text");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_URL}/api/vault/${encodeURIComponent(docName)}/preview`, { headers });
      if (!res.ok) throw new Error("Failed to load document preview");
      const data: DocPreview = await res.json();
      setPreviewDoc(data);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to inspect document.");
    } finally {
      setLoadingPreview(false);
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
      if (res.ok) {
        setDocuments(docs => docs.filter(d => d.doc_name !== docName));
        if (previewDoc?.doc_name === docName) {
          setPreviewDoc(null);
        }
        setStatusMsg(`Removed "${docName}" from vault.`);
      }
    } catch (err) {
      console.error("Delete failed:", err);
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

  // Filtered chunks in inspector
  const filteredChunks = useMemo(() => {
    if (!previewDoc?.chunks) return [];
    if (!inspectFilter.trim()) return previewDoc.chunks;
    const q = inspectFilter.toLowerCase();
    return previewDoc.chunks.filter(c => c.text.toLowerCase().includes(q));
  }, [previewDoc, inspectFilter]);

  return (
    <div className="min-h-screen bg-[#0c0d12] text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
      <Navbar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 md:py-14 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-zinc-800/80 pb-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              <FolderArchive className="w-3.5 h-3.5 text-zinc-400" />
              <span>Private Evidence Corpus</span>
            </div>
            <h1 className="text-3xl font-serif font-bold text-zinc-100 tracking-tight">
              Knowledge Vault
            </h1>
            <p className="text-xs text-zinc-400 max-w-xl leading-relaxed">
              Upload internal whitepapers, memos, or proprietary PDFs. When executing deep investigations, Ada grounds claims against your private documents alongside public web intelligence.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowPaste(!showPaste)}
              className="px-3.5 py-2 bg-[#12131a] hover:bg-[#161822] border border-zinc-800 rounded-xl text-xs font-medium text-zinc-300 transition-colors cursor-pointer"
            >
              {showPaste ? "Cancel Note" : "+ Paste Text Note"}
            </button>
            <button
              onClick={fetchDocuments}
              className="p-2 bg-[#12131a] hover:bg-[#161822] border border-zinc-800 rounded-xl text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              title="Refresh Vault Corpus"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-zinc-300" : ""}`} />
            </button>
          </div>
        </div>

        {/* Notifications */}
        {statusMsg && (
          <div className="p-3.5 rounded-xl bg-[#12131a] border border-zinc-700/80 text-zinc-200 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-zinc-400" />
              <span>{statusMsg}</span>
            </div>
            <button onClick={() => setStatusMsg("")} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-[#161313] border border-zinc-800 text-zinc-300 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-zinc-400" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg("")} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Upload Zone & Optional Paste Form */}
        <div className="space-y-4">
          {showPaste ? (
            <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-6 space-y-4">
              <div className="space-y-1">
                <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-300">
                  Paste Raw Research Note
                </h3>
                <p className="text-xs text-zinc-400">
                  Quickly index an excerpt, paywalled whitepaper excerpt, or proprietary data sheet.
                </p>
              </div>

              <form onSubmit={handlePaste} className="space-y-3">
                <input
                  type="text"
                  placeholder="Note Title (e.g. Q4 Competitor Benchmark Notes)"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  className="w-full bg-[#0c0d12] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
                />
                <textarea
                  rows={5}
                  placeholder="Paste document text or notes here..."
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  className="w-full bg-[#0c0d12] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors resize-none font-sans leading-relaxed"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowPaste(false)}
                    className="px-3.5 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pasting || !pasteText.trim()}
                    className="px-4 py-2 bg-zinc-200 hover:bg-white text-zinc-950 disabled:opacity-40 rounded-xl text-xs font-medium transition-all cursor-pointer"
                  >
                    {pasting ? "Indexing Passages..." : "Index Note into Vault"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`bg-[#12131a] border rounded-2xl p-6 sm:p-8 text-center transition-all ${
                isDragging 
                  ? "border-zinc-400 bg-[#161822]" 
                  : "border-zinc-800/80 hover:border-zinc-700/80"
              }`}
            >
              <div className="max-w-md mx-auto space-y-4">
                <div className="w-12 h-12 rounded-full bg-[#0c0d12] border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
                  <UploadCloud className="w-5 h-5 text-zinc-400" />
                </div>
                
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-zinc-200">
                    Drag and drop your research document here
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Supports PDF, Markdown (.md), and Plaintext (.txt) up to 25MB
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <label className="px-4 py-2 bg-[#161822] hover:bg-zinc-800 border border-zinc-700/80 rounded-xl text-xs font-medium text-zinc-200 cursor-pointer transition-colors">
                    <span>Browse Local Files</span>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </label>

                  {uploadFile && (
                    <button
                      onClick={() => handleUpload()}
                      disabled={uploading}
                      className="px-4 py-2 bg-zinc-200 hover:bg-white text-zinc-950 disabled:opacity-40 rounded-xl text-xs font-medium transition-all cursor-pointer"
                    >
                      {uploading ? "Extracting & Indexing..." : `Index "${uploadFile.name}"`}
                    </button>
                  )}
                </div>

                {uploadFile && (
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#0c0d12] border border-zinc-800 rounded-lg text-xs text-zinc-300">
                    <FileText className="w-3.5 h-3.5 text-zinc-400" />
                    <span>{uploadFile.name}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      ({Math.round(uploadFile.size / 1024)} KB)
                    </span>
                    <button 
                      onClick={() => setUploadFile(null)}
                      className="ml-1 text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Indexed Documents Table */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-2">
              <span>Indexed Documents</span>
              <span className="px-2 py-0.5 rounded-full bg-zinc-800/80 text-[11px] text-zinc-300">
                {documents.length}
              </span>
            </h2>

            {/* Document Search Filter */}
            {documents.length > 0 && (
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter by document title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#12131a] border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition-colors"
                />
              </div>
            )}
          </div>

          {loading ? (
            <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-12 text-center text-xs text-zinc-500 font-mono">
              Loading vault corpus...
            </div>
          ) : documents.length === 0 ? (
            <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl p-12 text-center space-y-3">
              <FolderArchive className="w-8 h-8 text-zinc-600 mx-auto" />
              <p className="text-xs text-zinc-400">No documents in your private vault yet.</p>
              <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                Upload PDFs or paste research notes above to anchor deep investigations against your proprietary corpus.
              </p>
            </div>
          ) : (
            <div className="bg-[#12131a] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] font-mono uppercase text-zinc-400 bg-[#0e0f15]">
                      <th className="py-3 px-4 font-semibold">Document Title</th>
                      <th className="py-3 px-4 font-semibold">File Size</th>
                      <th className="py-3 px-4 font-semibold">Indexed Passages</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {filteredDocuments.map((doc) => (
                      <tr key={doc.doc_name} className="hover:bg-zinc-800/20 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                            <span className="font-medium text-zinc-200 truncate max-w-sm">
                              {doc.doc_name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-400">
                          {doc.size_kb} KB
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-300">
                          {doc.chunk_count !== undefined ? `${doc.chunk_count} passages` : "Indexed"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenPreview(doc.doc_name)}
                              className="px-2.5 py-1.5 bg-[#161822] hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 border border-zinc-800"
                              title="Inspect Extracted Text & Chunks"
                            >
                              <FileSearch className="w-3.5 h-3.5 text-zinc-400" />
                              <span>Inspect</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(doc.doc_name)}
                              className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800/40 rounded-lg transition-colors cursor-pointer"
                              title="Delete from Vault"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Document Inspection Slide-out Drawer / Modal */}
        {previewDoc && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
            <div className="bg-[#12131a] border-l border-zinc-800 w-full max-w-2xl h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
              {/* Drawer Header */}
              <div className="p-5 border-b border-zinc-800 flex items-center justify-between gap-4 bg-[#0e0f15]">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-zinc-100 truncate">
                      {previewDoc.doc_name}
                    </h3>
                  </div>
                  <p className="text-[11px] font-mono text-zinc-400">
                    {previewDoc.filename}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewDoc(null)}
                    className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                    title="Close Inspector"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Diagnostic Metadata Strip */}
              <div className="px-5 py-3 border-b border-zinc-800/80 bg-[#101117] grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 rounded-lg bg-[#0c0d12] border border-zinc-800/80">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 block">File Size</span>
                  <span className="font-mono font-medium text-zinc-200">{previewDoc.size_kb} KB</span>
                </div>
                <div className="p-2 rounded-lg bg-[#0c0d12] border border-zinc-800/80">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 block">Pages</span>
                  <span className="font-mono font-medium text-zinc-200">{previewDoc.page_count}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#0c0d12] border border-zinc-800/80">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 block">Characters</span>
                  <span className="font-mono font-medium text-zinc-200">{previewDoc.char_count?.toLocaleString()}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#0c0d12] border border-zinc-800/80">
                  <span className="text-[10px] font-mono uppercase text-zinc-500 block">Indexed Chunks</span>
                  <span className="font-mono font-medium text-zinc-200">{previewDoc.chunks_indexed}</span>
                </div>
              </div>

              {/* Drawer Tabs & Filter */}
              <div className="px-5 py-2.5 border-b border-zinc-800 flex items-center justify-between gap-3 bg-[#0c0d12]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab("text")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeTab === "text"
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Extracted Text
                  </button>
                  <button
                    onClick={() => setActiveTab("chunks")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeTab === "chunks"
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Indexed Passages ({previewDoc.chunks?.length || 0})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {activeTab === "text" ? (
                    <button
                      onClick={handleCopyText}
                      className="px-2.5 py-1 bg-[#12131a] hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                      title="Copy full extracted text"
                    >
                      {copiedText ? <Check className="w-3.5 h-3.5 text-zinc-200" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
                      <span>{copiedText ? "Copied" : "Copy"}</span>
                    </button>
                  ) : (
                    <div className="relative w-40">
                      <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search chunks..."
                        value={inspectFilter}
                        onChange={(e) => setInspectFilter(e.target.value)}
                        className="w-full bg-[#12131a] border border-zinc-800 rounded-lg pl-7 pr-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {activeTab === "text" ? (
                  <div className="space-y-2">
                    <div className="p-4 bg-[#0c0d12] rounded-xl border border-zinc-800/80">
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed selection:bg-zinc-800">
                        {previewDoc.text || "No text could be extracted from this document."}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredChunks.length === 0 ? (
                      <p className="text-xs text-zinc-500 text-center py-8">
                        No passages matching search query.
                      </p>
                    ) : (
                      filteredChunks.map((chunk, idx) => (
                        <div 
                          key={chunk.chunk_id || idx}
                          className="p-4 bg-[#0c0d12] rounded-xl border border-zinc-800/80 space-y-2 group hover:border-zinc-700/80 transition-colors"
                        >
                          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 border-b border-zinc-800/60 pb-2">
                            <span>Passage #{idx + 1}</span>
                            <span>Page {chunk.page_number || 1} • {chunk.text.length} chars</span>
                          </div>
                          <p className="text-xs text-zinc-300 leading-relaxed font-sans">
                            {chunk.text}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-zinc-800 flex items-center justify-between bg-[#0e0f15] text-xs">
                <span className="text-zinc-500 font-mono text-[11px]">
                  ID: {previewDoc.doc_name}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(previewDoc.doc_name)}
                  className="px-3 py-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800/40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Document</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
