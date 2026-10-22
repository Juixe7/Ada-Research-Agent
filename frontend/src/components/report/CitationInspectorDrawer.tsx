import { Check, ExternalLink, X } from "lucide-react";
import type { CitationDetails } from "@/lib/report-types";

interface CitationInspectorDrawerProps {
  citation: CitationDetails | null;
  onClose: () => void;
}

export default function CitationInspectorDrawer({ citation, onClose }: CitationInspectorDrawerProps) {
  if (!citation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40">
      <div className="w-full max-w-[380px] h-full bg-[var(--surface)] border-l border-[var(--line)] p-6 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200">
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--accent)]">
                {citation.kind === "doc" ? "VAULT" : "RESEARCH"}
              </span>
              <span className="text-xs font-mono font-semibold text-[var(--ink)]">
                Citation [{citation.id}]
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close citation details"
              className="p-1 text-[var(--ink-3)] hover:text-[var(--ink)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <h3 className="font-serif text-[16px] text-[var(--ink)] leading-snug">{citation.title}</h3>

          <div className="text-xs font-mono text-[var(--ink-3)] space-y-1">
            <div>Domain: {citation.domain}</div>
            <div>
              Authority estimate: {citation.authority != null
                ? `${citation.authority.toFixed(1)} / 5`
                : citation.kind === "doc" ? "User-provided; not scored" : "Not scored"}
            </div>
          </div>

          <div className="p-2.5 rounded-[4px] bg-[var(--ok-soft)] border border-[var(--ok)]/40 text-xs flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[var(--ok)] shrink-0" />
            <span className="text-[var(--ok)] font-medium">
              {citation.verdict === "unresolved" ? "Citation reference not found" : "Citation reference located"}
            </span>
          </div>

          {citation.snippet && (
            <div className="space-y-1.5 pt-2">
              <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] block font-semibold">
                Source excerpt
              </span>
              <p className="font-serif text-xs text-[var(--ink)] bg-[var(--surface-2)] p-3 rounded-[6px] border border-[var(--line)] italic leading-relaxed">
                &ldquo;{citation.snippet}&rdquo;
              </p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-[var(--line)] flex items-center justify-between">
          {citation.url && (
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <span>Open source</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button type="button" onClick={onClose} className="btn-primary text-xs">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
