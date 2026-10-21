"use client";

import React, { useState } from "react";
import {
  FileText,
  Globe,
  ArrowRight,
  X,
  RefreshCw,
  Check,
  Compass
} from "lucide-react";
import type { ResearchBlueprint } from "@/lib/api-types";

interface PreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  blueprint: ResearchBlueprint | null;
  onConfirm: (calibratedParams: {
    clarificationChoice: string | null;
    customAngles: string[];
  }) => void;
  onSkip: () => void;
  onRecalibrate: (modificationText: string) => Promise<boolean>;
  recalibrating: boolean;
  recalibrationError?: string;
}

export default function PreflightModal({
  isOpen,
  onClose,
  query,
  blueprint,
  onConfirm,
  onSkip,
  onRecalibrate,
  recalibrating,
  recalibrationError = "",
}: PreflightModalProps) {
  const [selectedClarification, setSelectedClarification] = useState<string | null>(
    blueprint?.clarification_options?.[0]?.id ?? null
  );
  const [customClarification, setCustomClarification] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [activeAngles, setActiveAngles] = useState<string[]>(() =>
    blueprint?.research_angles?.filter((angle) => angle.enabled !== false).map((angle) => angle.title) ?? []
  );
  const [userPromptTweak, setUserPromptTweak] = useState("");

  if (!isOpen || !blueprint) return null;

  const toggleAngle = (title: string) => {
    if (activeAngles.includes(title)) {
      if (activeAngles.length > 1) {
        setActiveAngles(activeAngles.filter(a => a !== title));
      }
    } else {
      setActiveAngles([...activeAngles, title]);
    }
  };

  const handleLaunch = () => {
    const finalClarification = showCustomInput && customClarification.trim()
      ? customClarification.trim()
      : selectedClarification;

    onConfirm({
      clarificationChoice: finalClarification,
      customAngles: activeAngles
    });
  };

  const handleTweakSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPromptTweak.trim() || recalibrating) return;
    const updated = await onRecalibrate(userPromptTweak.trim());
    if (updated) setUserPromptTweak("");
  };

  const hasAmbiguity = Boolean(blueprint.ambiguity_detected);
  const sources = blueprint.ambiguity_sources || {};
  const clarificationOptions = blueprint.clarification_options ?? [];
  const researchAngles = blueprint.research_angles ?? [];

  const formatScopeLabel = (scope?: string) => {
    if (!scope) return "Web + Vault";
    const s = scope.toLowerCase();
    if (s.includes("combined") || s.includes("dual")) return "Web + Vault";
    if (s.includes("vault") || s.includes("user_doc")) return "Private Vault";
    return "Public Web";
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-[var(--surface)] border border-[var(--line)] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-[var(--line)] flex items-start justify-between gap-4 bg-[var(--surface-2)]">
          <div className="space-y-1.5 min-w-0">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)]">
              <Compass className="w-3.5 h-3.5 text-[var(--ink-2)]" />
              <span>Research Blueprint</span>
              <span className="text-[var(--ink-4)]">•</span>
              <span className="text-[var(--ink-3)]">Estimated ~30s</span>
            </div>
            <h2 className="text-xl font-serif font-bold text-[var(--ink)] tracking-tight">
              Review Investigation Plan
            </h2>
            <p className="text-xs text-[var(--ink-3)] truncate italic font-serif">
              &ldquo;{query}&rdquo;
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--ink-3)] hover:text-[var(--ink)] hover:bg-[var(--surface-3)] transition-colors cursor-pointer shrink-0"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          
          {/* Ambiguity / Multi-Context Diagnosis */}
          {hasAmbiguity ? (
            <div className="space-y-3.5 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-[var(--ink-3)] uppercase tracking-wider font-semibold">
                  Context Guidance
                </span>
                <h4 className="text-xs font-semibold text-[var(--ink)]">
                  Multiple perspectives identified for this topic
                </h4>
                <p className="text-xs text-[var(--ink-2)] leading-relaxed">
                  {blueprint.ambiguity_explanation}
                </p>
              </div>

              {/* Source Origin Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {sources.vault && (
                  <div className="bg-[var(--surface-3)] p-3 rounded-lg border border-[var(--line)] space-y-1">
                    <span className="text-[10px] font-mono text-[var(--ink-3)] font-medium flex items-center gap-1.5">
                      <FileText className="w-3 h-3 text-[var(--ink-3)]" />
                      <span>From Private Vault</span>
                    </span>
                    <p className="text-xs font-semibold text-[var(--ink)] truncate">{sources.vault.doc_name}</p>
                    <p className="text-[11px] text-[var(--ink-3)] line-clamp-2 italic">
                      &ldquo;{sources.vault.snippet}&rdquo;
                    </p>
                  </div>
                )}

                {sources.web && (
                  <div className="bg-[var(--surface-3)] p-3 rounded-lg border border-[var(--line)] space-y-1">
                    <span className="text-[10px] font-mono text-[var(--ink-3)] font-medium flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-[var(--ink-3)]" />
                      <span>From Public Web</span>
                    </span>
                    <p className="text-xs font-semibold text-[var(--ink)] truncate">{sources.web.entity}</p>
                    <p className="text-[11px] text-[var(--ink-3)] line-clamp-2 italic">
                      &ldquo;{sources.web.snippet}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              {/* Clarification Choice Selector */}
              {clarificationOptions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[var(--line)]">
                  <span className="text-[11px] font-mono text-[var(--ink-3)] uppercase tracking-wider block font-semibold">
                    Choose primary direction:
                  </span>
                  <div className="space-y-1.5">
                    {clarificationOptions.map((opt) => (
                      <label
                        key={opt.id}
                        onClick={() => {
                          setSelectedClarification(opt.id);
                          setShowCustomInput(false);
                        }}
                        className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          selectedClarification === opt.id && !showCustomInput
                            ? "bg-[var(--surface-3)] border-[var(--accent)] text-[var(--ink)]"
                            : "bg-[var(--surface-2)] border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink-2)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="clarification"
                          checked={selectedClarification === opt.id && !showCustomInput}
                          onChange={() => {}}
                          className="mt-0.5 text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer accent-[var(--accent)]"
                        />
                        <div className="space-y-0.5">
                          <p className="font-semibold text-[var(--ink)]">{opt.title}</p>
                          <p className="text-[11px] text-[var(--ink-3)]">{opt.description}</p>
                        </div>
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setShowCustomInput((open) => !open);
                        setSelectedClarification(null);
                      }}
                      className={`w-full p-3 rounded-xl border border-dashed text-left text-xs transition-colors ${
                        showCustomInput ? "border-[var(--accent)] bg-[var(--surface-3)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"
                      }`}
                    >
                      Something else
                    </button>
                    {showCustomInput && (
                      <input
                        type="text"
                        value={customClarification}
                        onChange={(event) => setCustomClarification(event.target.value)}
                        placeholder="Describe the direction you want to explore"
                        aria-label="Custom research direction"
                        className="w-full bg-[var(--surface-2)] border border-[var(--line)] focus:border-[var(--accent)] rounded-lg px-3.5 py-2.5 text-xs text-[var(--ink)] focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Research Angles */}
          {researchAngles.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
                  Angles to Explore ({activeAngles.length} of {researchAngles.length} active)
                </span>
              </div>

              <div className="space-y-2">
                {researchAngles.map((angle) => {
                  const isChecked = activeAngles.includes(angle.title);
                  return (
                    <div
                      key={angle.id}
                      onClick={() => toggleAngle(angle.title)}
                      className={`flex items-center justify-between p-3.5 rounded-xl border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? "bg-[var(--surface-2)] border-[var(--line-strong)] text-[var(--ink)] shadow-xs"
                          : "bg-[var(--surface)] border-[var(--line)] text-[var(--ink-4)] opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-4 h-4 rounded flex items-center justify-center border text-[10px] shrink-0 transition-colors ${
                          isChecked ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--paper)] font-bold" : "border-[var(--line-strong)] bg-[var(--surface)]"
                        }`}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate">{angle.title}</p>
                          <p className="text-[11px] text-[var(--ink-3)] truncate mt-0.5">{angle.description}</p>
                        </div>
                      </div>

                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--ink-3)] border border-[var(--line)] shrink-0 ml-3">
                        {formatScopeLabel(angle.source_scope)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* User Guidance / Constraint Input */}
          <form onSubmit={handleTweakSubmit} className="space-y-2 pt-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] block font-semibold">
              Add specific guidance or constraints:
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={userPromptTweak}
                onChange={(e) => setUserPromptTweak(e.target.value)}
                placeholder="e.g. Prioritize commercial viability and market readiness over theory..."
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] focus:border-[var(--accent)] rounded-lg px-3.5 py-2.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-4)] focus:outline-none font-sans"
              />
              <button
                type="submit"
                disabled={!userPromptTweak.trim() || recalibrating}
                className="px-4 py-2.5 bg-[var(--surface-3)] hover:bg-[var(--surface-2)] disabled:opacity-40 text-xs font-medium text-[var(--ink-2)] rounded-lg border border-[var(--line)] transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {recalibrating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--ink-3)]" />
                ) : (
                  <span>Update Plan</span>
                )}
              </button>
            </div>
            {recalibrationError && (
              <p role="alert" className="text-xs text-[var(--bad)]">
                {recalibrationError}
              </p>
            )}
          </form>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-[var(--line)] flex items-center justify-between gap-3 bg-[var(--surface-2)]">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          >
            Skip review, start now
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLaunch}
              className="btn-primary py-2 px-5 text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span>Start Research</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
