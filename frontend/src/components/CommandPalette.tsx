"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search, FileText, Plus, Database, Clock,
  ExternalLink, ArrowRight, CornerDownLeft, Sparkles, X
} from "lucide-react";
import { API_URL } from "@/lib/config";
import { useAuth } from "@/context/AuthContext";

interface PaletteItem {
  id: string;
  category: "Actions" | "Runs" | "Vault";
  label: string;
  sublabel?: string;
  href?: string;
  action?: () => void;
  shortcut?: string;
}

export default function CommandPalette() {
  const router = useRouter();
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runs, setRuns] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl/Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      // Fetch runs and vault docs
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      fetch(`${API_URL}/api/reports`, { headers })
        .then((r) => (r.ok ? r.json() : { reports: [] }))
        .then((d) => setRuns(d.reports?.slice(0, 5) || []))
        .catch(() => {});

      fetch(`${API_URL}/api/vault`, { headers })
        .then((r) => (r.ok ? r.json() : { documents: [] }))
        .then((d) => setDocs(d.documents?.slice(0, 5) || []))
        .catch(() => {});
    } else {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen, token]);

  // Build items list
  const allItems: PaletteItem[] = [
    // Actions
    {
      id: "act-new",
      category: "Actions",
      label: "Start New Research Inquiry",
      sublabel: "Open research desk",
      href: "/",
      shortcut: "↵",
    },
    {
      id: "act-vault",
      category: "Actions",
      label: "Upload Document to Vault",
      sublabel: "PDF, TXT, or Markdown ingestion",
      href: "/vault",
    },
    {
      id: "act-dossiers",
      category: "Actions",
      label: "Browse Dossier Archive",
      sublabel: "Completed research monographs",
      href: "/history",
    },
    // Runs
    ...runs.map((r) => ({
      id: `run-${r.report_id || r.id}`,
      category: "Runs" as const,
      label: r.title || r.query || `Investigation #${r.report_id}`,
      sublabel: `${r.depth || "standard"} mode · ${r.status}`,
      href: r.status === "completed" ? `/report/${r.report_id || r.id}` : `/run/${r.report_id || r.id}`,
    })),
    // Vault Docs
    ...docs.map((d) => ({
      id: `doc-${d.doc_name}`,
      category: "Vault" as const,
      label: d.doc_name,
      sublabel: `${d.size_kb} KB · ${d.chunk_count || 0} passages`,
      href: "/vault",
    })),
  ];

  // Filter items by search query
  const filteredItems = allItems.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      (item.sublabel && item.sublabel.toLowerCase().includes(query.toLowerCase()))
  );

  // Keyboard navigation inside palette
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredItems[selectedIndex];
      if (current) {
        setIsOpen(false);
        if (current.action) current.action();
        else if (current.href) router.push(current.href);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4 bg-[rgb(22_21_18_/_0.45)] select-none">
      <div className="w-full max-w-[560px] bg-[var(--surface)] border border-[var(--line-strong)] rounded-[10px] shadow-2xl overflow-hidden flex flex-col text-[var(--ink)] animate-in fade-in zoom-in-95 duration-100">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-[var(--line)] bg-[var(--surface-2)]">
          <Search className="w-4 h-4 text-[var(--ink-3)] mr-2 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command, search dossiers, or find documents..."
            className="w-full bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none font-sans"
          />
          <span className="text-[10px] font-mono text-[var(--ink-3)] border border-[var(--line)] px-1.5 py-0.5 rounded-[3px] ml-2">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-[320px] overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--ink-3)] font-mono">
              No matching commands or files.
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setIsOpen(false);
                    if (item.action) item.action();
                    else if (item.href) router.push(item.href);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`px-3 py-2 rounded-[6px] transition-colors cursor-pointer flex items-center justify-between text-xs ${
                    isSelected
                      ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                      : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    {item.category === "Actions" ? (
                      <Sparkles className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    ) : item.category === "Runs" ? (
                      <Clock className="w-3.5 h-3.5 text-[var(--ink-3)] shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    )}
                    <div className="truncate">
                      <span className="font-medium truncate block text-[var(--ink)]">
                        {item.label}
                      </span>
                      {item.sublabel && (
                        <span className="text-[10.5px] font-mono text-[var(--ink-3)] truncate block">
                          {item.sublabel}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] px-1.5 py-0.5 rounded bg-[var(--surface-2)]">
                      {item.category}
                    </span>
                    {isSelected && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-[var(--accent)]" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hint */}
        <div className="px-4 py-2 border-t border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between text-[11px] font-mono text-[var(--ink-3)]">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Dismiss</span>
          </div>
          <span>Ada Research</span>
        </div>
      </div>
    </div>
  );
}
