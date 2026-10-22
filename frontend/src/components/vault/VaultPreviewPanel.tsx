import { useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  FileText,
  FolderArchive,
  Layers,
  Loader2,
  RefreshCw,
} from "lucide-react";

import type { VaultPreviewResponse } from "@/lib/api-types";

type PreviewTab = "reader" | "passages";

interface VaultPreviewPanelProps {
  preview: VaultPreviewResponse | null;
  selectedDocName: string | null;
  loading: boolean;
  error: string | null;
  reindexingDoc: string | null;
  onDelete: (docName: string) => void;
  onReindex: (docName: string) => void;
  onRequestUpload: () => void;
}

/** Renders the selected source's extracted text, indexing state, and passages. */
export default function VaultPreviewPanel({
  preview,
  selectedDocName,
  loading,
  error,
  reindexingDoc,
  onDelete,
  onReindex,
  onRequestUpload,
}: VaultPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("reader");
  const [copiedText, setCopiedText] = useState(false);
  const [inspectFilter, setInspectFilter] = useState("");

  const filteredPassages = useMemo(() => {
    if (!preview?.chunks) return [];
    const query = inspectFilter.trim().toLowerCase();
    return query
      ? preview.chunks.filter((chunk) => chunk.text.toLowerCase().includes(query))
      : preview.chunks;
  }, [preview, inspectFilter]);

  const copyText = async () => {
    if (!preview?.text) return;
    try {
      await navigator.clipboard.writeText(preview.text);
      setCopiedText(true);
      window.setTimeout(() => setCopiedText(false), 2000);
    } catch {
      setCopiedText(false);
    }
  };

  const formatBadge = (name: string) => {
    const extension = name.toLowerCase().split(".").pop();
    const styles: Record<string, string> = {
      pdf: "bg-red-50 text-red-700 border-red-200",
      md: "bg-amber-50 text-amber-800 border-amber-200",
      docx: "bg-blue-50 text-blue-700 border-blue-200",
      csv: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
    const label = ["pdf", "md", "docx", "csv", "txt"].includes(extension ?? "")
      ? extension?.toUpperCase()
      : "FILE";
    return (
      <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${styles[extension ?? ""] ?? "bg-neutral-50 text-neutral-700 border-neutral-200"}`}>
        {label}
      </span>
    );
  };

  return (
    <section className="flex min-h-[600px] flex-1 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-xs">
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center space-y-3 p-12 text-center font-mono text-xs text-[var(--ink-3)]" role="status">
          <span className="h-3 w-3 animate-quiet-pulse rounded-full bg-[var(--accent)]" />
          <span>Opening document &amp; formatting passages...</span>
        </div>
      ) : error && !preview ? (
        <div className="mx-auto my-auto flex max-w-md flex-1 flex-col items-center justify-center space-y-4 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--warn)]/30 bg-[var(--warn-soft)] text-[var(--warn)]">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-serif text-base font-semibold text-[var(--ink)]">Document content unavailable</h3>
            <p className="font-sans text-xs leading-relaxed text-[var(--ink-3)]">
              The original source file for &ldquo;{selectedDocName}&rdquo; could not be resolved from local disk. Indexed passages may still be available.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-2">
            {selectedDocName && (
              <button type="button" onClick={() => onDelete(selectedDocName)} className="btn-secondary py-1.5 px-3.5 text-xs text-[var(--bad)] hover:bg-[var(--bad-soft)]">
                Remove from library
              </button>
            )}
            <button type="button" onClick={onRequestUpload} className="btn-primary py-1.5 px-4 text-xs">
              Re-upload document
            </button>
          </div>
        </div>
      ) : preview ? (
        <div className="flex h-full flex-1 flex-col">
          <header className="flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--surface-2)]/60 px-4 py-4 sm:px-6 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[var(--ink-3)]">
                {formatBadge(preview.doc_name)}
                <span className="whitespace-nowrap">
                  {preview.size_kb} KB • {preview.page_count} {preview.page_count === 1 ? "page" : "pages"} • {preview.char_count.toLocaleString()} chars
                </span>
                <span className="whitespace-nowrap font-medium text-[var(--accent)]">
                  {preview.chunks_indexed > 0 ? `${preview.chunks_indexed} searchable passages` : "No passages indexed"}
                </span>
              </div>
              <h2 title={preview.doc_name} className="truncate font-serif text-xl font-bold tracking-tight text-[var(--ink)]">
                {preview.doc_name}
              </h2>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 2xl:justify-end">
              {preview.chunks_indexed === 0 && (
                <button
                  type="button"
                  onClick={() => onReindex(preview.doc_name)}
                  disabled={reindexingDoc !== null}
                  className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  {reindexingDoc === preview.doc_name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  <span>{reindexingDoc === preview.doc_name ? "Indexing…" : "Index source"}</span>
                </button>
              )}
              <div role="group" aria-label="Source preview" className="inline-flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] p-0.5 font-sans text-xs">
                <button
                  type="button"
                  aria-pressed={activeTab === "reader"}
                  onClick={() => setActiveTab("reader")}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${activeTab === "reader" ? "bg-[var(--surface-2)] font-semibold text-[var(--ink)] shadow-xs" : "text-[var(--ink-3)] hover:text-[var(--ink)]"}`}
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reader</span>
                </button>
                <button
                  type="button"
                  aria-pressed={activeTab === "passages"}
                  onClick={() => setActiveTab("passages")}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${activeTab === "passages" ? "bg-[var(--surface-2)] font-semibold text-[var(--ink)] shadow-xs" : "text-[var(--ink-3)] hover:text-[var(--ink)]"}`}
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Passages ({preview.chunks.length})</span>
                </button>
              </div>
              <button type="button" onClick={copyText} className="btn-secondary flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs" title="Copy full document text">
                {copiedText ? <Check className="h-3.5 w-3.5 text-[var(--ok)]" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{copiedText ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </header>

          {activeTab === "reader" ? (
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col space-y-6 overflow-y-auto p-6 md:p-8">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-3 font-mono text-[11px] text-[var(--ink-3)]">
                <span>Document text</span>
                <span>~{Math.max(1, Math.round(preview.char_count / 1200))} min read</span>
              </div>
              {preview.text ? (
                <article className="max-w-[72ch] whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--ink-2)] selection:bg-[var(--accent-soft)]">
                  {preview.text}
                </article>
              ) : (
                <div className="py-12 text-center font-mono text-xs text-[var(--ink-3)]">No text content could be extracted from this document.</div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-2.5">
                <input
                  type="search"
                  aria-label="Search extracted passages"
                  placeholder="Search within extracted passages..."
                  value={inspectFilter}
                  onChange={(event) => setInspectFilter(event.target.value)}
                  className="input-base w-full max-w-sm px-3 py-1.5 text-xs"
                />
                <span aria-live="polite" className="font-mono text-[11px] text-[var(--ink-3)]">
                  Showing {filteredPassages.length} of {preview.chunks.length} excerpts
                </span>
              </div>
              <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 overflow-y-auto p-6">
                {filteredPassages.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[var(--ink-3)]">
                    {preview.chunks.length
                      ? `No passages match “${inspectFilter}”.`
                      : "No searchable passages were indexed for this source. Its text is still available in the reader. Use Index source above to prepare it for research."}
                  </div>
                ) : (
                  filteredPassages.map((passage, index) => {
                    const sectionPrefix = passage.section_path ? `Section: ${passage.section_path}\n\n` : "";
                    const excerpt = sectionPrefix && passage.text.startsWith(sectionPrefix)
                      ? passage.text.slice(sectionPrefix.length)
                      : passage.text;
                    return (
                      <article key={passage.chunk_id || index} className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-4 text-xs transition-all hover:bg-[var(--surface-2)]/70">
                        <div className="flex items-center justify-between font-mono text-[10.5px] text-[var(--ink-3)]">
                          <span className="flex items-center gap-1.5 font-semibold text-[var(--accent)]">
                            <FileText className="h-3 w-3" aria-hidden="true" />
                            <span>Passage {passage.chunk_index || index + 1} • Page {passage.page_number || 1}</span>
                          </span>
                        </div>
                        {passage.section_path && <p className="text-[10px] font-medium tracking-wide text-[var(--ink-3)]">{passage.section_path}</p>}
                        <p className="border-l-2 border-[var(--accent)]/40 py-0.5 pl-3 font-serif text-xs italic leading-relaxed text-[var(--ink)]">
                          &ldquo;{excerpt}&rdquo;
                        </p>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mx-auto my-auto flex max-w-md flex-1 flex-col items-center justify-center space-y-4 p-12 text-center text-[var(--ink-3)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface-2)] text-[var(--accent)]">
            <FolderArchive className="h-7 w-7" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="font-serif text-base font-semibold text-[var(--ink)]">Choose a document</h3>
            <p className="font-sans text-xs leading-relaxed text-[var(--ink-3)]">
              Select a source from your library to read its text or browse searchable passages.
            </p>
          </div>
          <button type="button" onClick={onRequestUpload} className="btn-primary px-4 py-2 text-xs shadow-xs">
            Add a source
          </button>
        </div>
      )}
    </section>
  );
}
