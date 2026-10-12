"use client";

import React, { useState, useEffect } from "react";
import {
  AlertTriangle,
  FileText,
  Globe,
  Sliders,
  ArrowRight,
  X,
  RefreshCw,
  Check
} from "lucide-react";

interface PreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  blueprint: any;
  onConfirm: (calibratedParams: {
    clarificationChoice: string | null;
    customAngles: string[];
  }) => void;
  onSkip: () => void;
  onRecalibrate: (modificationText: string) => Promise<void>;
  recalibrating: boolean;
}

export default function PreflightModal({
  isOpen,
  onClose,
  query,
  blueprint,
  onConfirm,
  onSkip,
  onRecalibrate,
  recalibrating
}: PreflightModalProps) {
  const [selectedClarification, setSelectedClarification] = useState<string | null>(null);
  const [customClarification, setCustomClarification] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [activeAngles, setActiveAngles] = useState<string[]>([]);
  const [userPromptTweak, setUserPromptTweak] = useState("");

  useEffect(() => {
    if (blueprint) {
      if (blueprint.clarification_options?.length > 0) {
        setSelectedClarification(blueprint.clarification_options[0].id);
      } else {
        setSelectedClarification(null);
      }

      if (blueprint.research_angles?.length > 0) {
        setActiveAngles(
          blueprint.research_angles
            .filter((a: any) => a.enabled !== false)
            .map((a: any) => a.title)
        );
      }
    }
  }, [blueprint]);

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

  const handleTweakSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPromptTweak.trim() || recalibrating) return;
    onRecalibrate(userPromptTweak.trim());
    setUserPromptTweak("");
  };

  const hasAmbiguity = Boolean(blueprint.ambiguity_detected);
  const sources = blueprint.ambiguity_sources || {};

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-[#12131a] border border-white/[0.1] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              <Sliders className="w-3.5 h-3.5" />
              <span>Scope Calibration</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">~{blueprint.estimated_duration_seconds || 35}s execution</span>
            </div>
            <h2 className="text-lg font-serif font-bold text-[#fafaf9] tracking-tight">
              Calibrate Research Intent
            </h2>
            <p className="text-xs text-zinc-400 truncate italic font-serif">
              &ldquo;{query}&rdquo;
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-6 overflow-y-auto">
          
          {/* Ambiguity Diagnosis */}
          {hasAmbiguity ? (
            <div className="space-y-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs font-mono uppercase tracking-wider">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                <span>Entity Ambiguity Detected</span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                {blueprint.ambiguity_explanation}
              </p>

              {/* Source Origin Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {sources.vault && (
                  <div className="bg-[#161822] p-3 rounded-lg border border-white/[0.08] space-y-1">
                    <span className="text-[10px] font-mono text-zinc-300 font-medium flex items-center gap-1.5">
                      <FileText className="w-3 h-3 text-zinc-400" />
                      <span>Private Knowledge Vault</span>
                    </span>
                    <p className="text-xs font-semibold text-[#fafaf9] truncate">{sources.vault.doc_name}</p>
                    <p className="text-[11px] text-zinc-400 line-clamp-2 italic">
                      &ldquo;{sources.vault.snippet}&rdquo;
                    </p>
                  </div>
                )}

                {sources.web && (
                  <div className="bg-[#161822] p-3 rounded-lg border border-white/[0.08] space-y-1">
                    <span className="text-[10px] font-mono text-zinc-300 font-medium flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-zinc-400" />
                      <span>Public Commercial Web</span>
                    </span>
                    <p className="text-xs font-semibold text-[#fafaf9] truncate">{sources.web.entity}</p>
                    <p className="text-[11px] text-zinc-400 line-clamp-2 italic">
                      &ldquo;{sources.web.snippet}&rdquo;
                    </p>
                  </div>
                )}
              </div>

              {/* Clarification Choice Selector */}
              {blueprint.clarification_options?.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block font-semibold">
                    Select Investigation Focus:
                  </span>
                  <div className="space-y-1.5">
                    {blueprint.clarification_options.map((opt: any) => (
                      <label
                        key={opt.id}
                        onClick={() => {
                          setSelectedClarification(opt.id);
                          setShowCustomInput(false);
                        }}
                        className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          selectedClarification === opt.id && !showCustomInput
                            ? "bg-white/[0.08] border-white/[0.2] text-[#fafaf9]"
                            : "bg-[#161822] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <input
                          type="radio"
                          name="clarification"
                          checked={selectedClarification === opt.id && !showCustomInput}
                          onChange={() => {}}
                          className="mt-0.5 text-zinc-300 focus:ring-zinc-400 cursor-pointer accent-zinc-300"
                        />
                        <div className="space-y-0.5">
                          <p className="font-semibold text-[#fafaf9]">{opt.title}</p>
                          <p className="text-[11px] text-zinc-400">{opt.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Research Angles */}
          {blueprint.research_angles?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  Investigation Angles ({activeAngles.length} selected):
                </span>
                <span className="text-[10px] text-zinc-500">Click to toggle angle</span>
              </div>

              <div className="space-y-1.5">
                {blueprint.research_angles.map((angle: any) => {
                  const isChecked = activeAngles.includes(angle.title);
                  return (
                    <div
                      key={angle.id}
                      onClick={() => toggleAngle(angle.title)}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? "bg-white/[0.04] border-white/[0.1] text-zinc-100"
                          : "bg-black/20 border-white/[0.03] text-zinc-500 line-through"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`w-4 h-4 rounded flex items-center justify-center border text-[10px] ${
                          isChecked ? "bg-zinc-200 border-zinc-200 text-zinc-950 font-bold" : "border-zinc-700 bg-zinc-900"
                        }`}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate">{angle.title}</p>
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">{angle.description}</p>
                        </div>
                      </div>

                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.04] text-zinc-400 border border-white/[0.06] shrink-0 ml-3">
                        {angle.source_scope || "Combined"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* User Prompt Tweak Input */}
          <form onSubmit={handleTweakSubmit} className="space-y-1.5 pt-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block font-semibold">
              Modify or Tweak Plan (Optional):
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={userPromptTweak}
                onChange={(e) => setUserPromptTweak(e.target.value)}
                placeholder="e.g. Focus only on commercial yields, ignore theoretical models..."
                className="flex-1 bg-[#161822] border border-white/[0.08] focus:border-white/[0.22] rounded-lg px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
              />
              <button
                type="submit"
                disabled={!userPromptTweak.trim() || recalibrating}
                className="px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-xs font-medium text-zinc-200 rounded-lg border border-white/[0.08] transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {recalibrating ? (
                  <RefreshCw className="w-3 h-3 animate-spin text-zinc-400" />
                ) : (
                  <span>Re-Plan</span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-white/[0.08] flex items-center justify-between gap-3 bg-[#0d0e14]">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            Skip Calibration
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLaunch}
              className="px-5 py-2 bg-zinc-200 hover:bg-white text-zinc-950 font-semibold rounded-lg text-xs transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <span>Launch Investigation</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
