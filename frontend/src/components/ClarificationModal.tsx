"use client";

import React, { useState, useEffect } from "react";
import { ArrowRight, Check, X, HelpCircle, CornerDownRight } from "lucide-react";

export interface ClarificationOption {
  id: string;
  title: string;
  description?: string;
}

export interface ResearchAngle {
  id: number | string;
  title: string;
  description?: string;
  source_scope?: string;
  enabled?: boolean;
}

export interface ScopingBlueprint {
  ambiguity_detected?: boolean;
  ambiguity_explanation?: string;
  clarification_options?: ClarificationOption[];
  research_angles?: ResearchAngle[];
  suggested_perspective?: string;
  estimated_duration_seconds?: number;
}

interface ClarificationModalProps {
  isOpen: boolean;
  query: string;
  blueprint: ScopingBlueprint | null;
  onConfirm: (payload: { clarificationChoice: string | null; customAngles: string[] }) => void;
  onSkip: () => void;
  onClose: () => void;
  loading?: boolean;
}

export default function ClarificationModal({
  isOpen,
  query,
  blueprint,
  onConfirm,
  onSkip,
  onClose,
  loading = false,
}: ClarificationModalProps) {
  const [selectedClarification, setSelectedClarification] = useState<string | null>(null);
  const [somethingElseOpen, setSomethingElseOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const [selectedAngles, setSelectedAngles] = useState<string[]>([]);

  useEffect(() => {
    if (blueprint) {
      if (blueprint.clarification_options && blueprint.clarification_options.length > 0) {
        setSelectedClarification(blueprint.clarification_options[0].id);
      } else {
        setSelectedClarification(null);
      }

      if (blueprint.research_angles && blueprint.research_angles.length > 0) {
        setSelectedAngles(
          blueprint.research_angles
            .filter((a) => a.enabled !== false)
            .map((a) => a.title)
        );
      }
    }
  }, [blueprint]);

  if (!isOpen || !blueprint) return null;

  const toggleAngle = (title: string) => {
    if (selectedAngles.includes(title)) {
      if (selectedAngles.length > 1) {
        setSelectedAngles(selectedAngles.filter((t) => t !== title));
      }
    } else {
      setSelectedAngles([...selectedAngles, title]);
    }
  };

  const handleContinue = () => {
    const finalClarification =
      somethingElseOpen && customAnswer.trim()
        ? customAnswer.trim()
        : selectedClarification;

    onConfirm({
      clarificationChoice: finalClarification,
      customAngles: selectedAngles,
    });
  };

  const hasClarification =
    Boolean(blueprint.ambiguity_detected) ||
    Boolean(blueprint.clarification_options && blueprint.clarification_options.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl bg-[var(--surface)] border border-[var(--line-strong)] rounded-[10px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-[var(--ink)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--ink-2)]">
              Research Scope Alignment
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--ink-3)] hover:text-[var(--ink)] p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Question context */}
          <div className="pb-3 border-b border-[var(--line)]">
            <span className="text-[11px] font-mono uppercase text-[var(--ink-3)] block mb-1">
              Inquiry
            </span>
            <p className="font-serif text-[17px] text-[var(--ink)] leading-snug">
              &ldquo;{query}&rdquo;
            </p>
          </div>

          {/* 1. Scoping / Ambiguity Question */}
          {hasClarification && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                    01.
                  </span>
                  <h3 className="font-serif text-[15px] font-medium text-[var(--ink)] leading-snug">
                    {blueprint.ambiguity_explanation ||
                      "Which subject scope best reflects your objective for this investigation?"}
                  </h3>
                </div>
                <p className="text-xs text-[var(--ink-3)] font-sans pl-5">
                  Asked because grounding accuracy depends on separating internal project notes from public commercial entities.
                </p>
              </div>

              {/* Wrapped Options Chips */}
              <div className="pl-5 flex flex-wrap gap-2 pt-1">
                {blueprint.clarification_options?.map((opt) => {
                  const isSelected = !somethingElseOpen && selectedClarification === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSelectedClarification(opt.id);
                        setSomethingElseOpen(false);
                      }}
                      className={`chip py-1.5 px-3 rounded-[4px] text-xs transition-all ${
                        isSelected ? "chip-active" : ""
                      }`}
                      title={opt.description}
                    >
                      {isSelected && <Check className="w-3 h-3 text-[var(--accent)] shrink-0" />}
                      <span>{opt.title}</span>
                    </button>
                  );
                })}

                {/* Ghost Chip: Something Else */}
                <button
                  type="button"
                  onClick={() => {
                    setSomethingElseOpen(!somethingElseOpen);
                    setSelectedClarification(null);
                  }}
                  className={`chip py-1.5 px-3 rounded-[4px] text-xs border-dashed ${
                    somethingElseOpen ? "chip-active" : "text-[var(--ink-3)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span>+ Something else</span>
                </button>
              </div>

              {/* Custom Input Reveal */}
              {somethingElseOpen && (
                <div className="pl-5 pt-2 flex items-center gap-2">
                  <CornerDownRight className="w-3.5 h-3.5 text-[var(--ink-3)] shrink-0" />
                  <input
                    type="text"
                    value={customAnswer}
                    onChange={(e) => setCustomAnswer(e.target.value)}
                    placeholder="Specify your custom angle, focus entity, or constraint..."
                    className="input-base w-full px-3 py-1.5 text-xs bg-[var(--surface-2)]"
                    autoFocus
                  />
                </div>
              )}
            </div>
          )}

          {/* 2. Research Angles Selection */}
          {blueprint.research_angles && blueprint.research_angles.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                    {hasClarification ? "02." : "01."}
                  </span>
                  <h3 className="font-serif text-[15px] font-medium text-[var(--ink)]">
                    Planned investigation tracks & chapters
                  </h3>
                </div>
                <p className="text-xs text-[var(--ink-3)] font-sans pl-5">
                  Select the sub-questions to dispatch to parallel research workers.
                </p>
              </div>

              <div className="pl-5 space-y-2 pt-1">
                {blueprint.research_angles.map((angle) => {
                  const isChecked = selectedAngles.includes(angle.title);
                  return (
                    <div
                      key={angle.id}
                      onClick={() => toggleAngle(angle.title)}
                      className={`p-3 rounded-[6px] border transition-all cursor-pointer flex items-start gap-3 ${
                        isChecked
                          ? "bg-[var(--surface-2)] border-[var(--line-strong)]"
                          : "bg-transparent border-[var(--line)] opacity-60 hover:opacity-100"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-[3px] border mt-0.5 flex items-center justify-center shrink-0 transition-colors ${
                          isChecked
                            ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]"
                            : "border-[var(--line-strong)]"
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>

                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[var(--ink)]">
                            {angle.title}
                          </span>
                          {angle.source_scope && (
                            <span className="text-[10px] font-mono text-[var(--ink-3)] uppercase">
                              {angle.source_scope}
                            </span>
                          )}
                        </div>
                        {angle.description && (
                          <p className="text-[11.5px] text-[var(--ink-2)] line-clamp-2 leading-relaxed">
                            {angle.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="px-6 py-3.5 border-t border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="btn-secondary text-xs"
            disabled={loading}
          >
            Skip and use assumptions
          </button>

          <button
            type="button"
            onClick={handleContinue}
            className="btn-primary text-xs"
            disabled={loading}
          >
            <span>Continue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
