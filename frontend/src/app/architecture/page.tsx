"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Layers, Database, ArrowRight, ArrowDown,
  Globe, Zap, Terminal, CheckCircle2, ShieldCheck, Code
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { API_URL } from "@/lib/config";

interface PipelineNode {
  id: string;
  name: string;
  role: string;
  modelOrTech: string;
  description: string;
  inputs: string[];
  outputs: string[];
  resiliency: string;
  codeSnippet: string;
}

interface BackendStatus {
  status?: string;
  service?: string;
  engine?: string;
}

const PIPELINE_NODES: PipelineNode[] = [
  {
    id: "planner",
    name: "01. Lead Planner Agent",
    role: "Research track and search-query planning",
    modelOrTech: "Small model group • research-plan generation",
    description: "Turns the research question, depth, and approved scope into a set of focused research tracks and search queries. The number of tracks follows the selected depth or the user's chosen research angles.",
    inputs: ["Research question", "Depth (quick, standard, or deep)", "Clarification and selected angles"],
    outputs: ["Research tracks", "Targeted search queries", "Track categories"],
    resiliency: "Uses the shared LLM gateway with configured provider fallback and budgets. If the model response cannot be parsed, a deterministic heuristic plan is returned.",
    codeSnippet: `plan = generate_research_plan(
    query=query,
    depth=depth,
    custom_angles=custom_angles,
    clarification_context=clarification,
    run_id=run_id,
)`
  },
  {
    id: "retrieval",
    name: "02. Parallel Web & Vault Retrieval",
    role: "Parallel Web & Private Document Retrieval",
    modelOrTech: "Search providers • safe page fetch • Qdrant",
    description: "Runs planned research tracks concurrently. Each track searches the public web and, when selected, retrieves passages from the signed-in user's private document collection.",
    inputs: ["Search queries per track", "Selected document names", "Authenticated user scope"],
    outputs: ["Retrieved web evidence", "Page-aware private passages", "Track warnings and source metadata"],
    resiliency: "Public page fetches validate URLs and redirects, enforce a response-size and time limit, and preserve search snippets when full-page extraction fails.",
    codeSnippet: `evidence = execute_iterative_sub_research(
    track=track,
    selected_docs=selected_docs,
    user_id=user_id,
    cancel_check=cancel_check,
)`
  },
  {
    id: "manifest",
    name: "03. Evidence Normalizer & Deduplicator",
    role: "Deterministic Citation Standardization",
    modelOrTech: "Canonical Hash & URI Normalization",
    description: "Merges duplicate evidence from parallel tracks, canonicalizes web URLs, groups repeated track references, and assigns stable source IDs for the report and evidence inspector.",
    inputs: ["Raw multi-worker evidence arrays"],
    outputs: ["Unified Evidence Manifest", "Unique Citation Index", "Passage excerpts"],
    resiliency: "Canonical URL and content-based keys remove common duplicates while retaining the tracks that found each source. Private document passages remain distinct evidence units.",
    codeSnippet: `evidence_manifest = normalize_and_deduplicate_evidence(
    raw_results
)`
  },
  {
    id: "critic",
    name: "04. Adversarial Critic & Auditor",
    role: "Knowledge Gap & Contradiction Detection",
    modelOrTech: "Adversarial Prompting • Coverage Scoring",
    description: "Reviews a bounded evidence summary against the question and research tracks, looking for gaps and conflicting claims. The graph can run a targeted arbiter search when the critic returns follow-up queries.",
    inputs: ["Unified Evidence Manifest", "Original Research Plan"],
    outputs: ["Coverage assessment", "Identified gaps", "Contradictions", "Optional arbiter queries"],
    resiliency: "If the critic call is unavailable, the system records that the audit is unavailable and does not fabricate gaps or contradictions.",
    codeSnippet: `audit = audit_research_evidence(
    query=query,
    sub_tasks=plan,
    evidence_manifest=evidence,
    run_id=run_id,
)`
  },
  {
    id: "synthesizer",
    name: "05. Chief Research Synthesizer",
    role: "Evidence-led, section-based report synthesis",
    modelOrTech: "Write model group • structured report sections",
    description: "Builds a report outline from the evidence and critic findings, synthesizes sections, assembles the report, and sends cited claims for verification. Output length depends on the evidence and research depth.",
    inputs: ["Retrieved evidence manifest", "Critic findings and optional arbiter results"],
    outputs: ["Structured research report", "Claim-level verification results"],
    resiliency: "Uses the configured write-model primary and fallback through the shared gateway. When synthesis is unavailable, the system preserves collected evidence and reports the failure instead of inventing findings.",
    codeSnippet: `outline = generate_outline(query, plan, evidence, critic)
section_drafts = {}
for section in outline:
    section_drafts[section["id"]] = synthesize_section(
        section, query, evidence_by_id, run_id=run_id
    )
report = assemble_final_dossier(query, section_drafts, outline, evidence, run_id)`
  },
  {
    id: "citations",
    name: "06. Citation Reference Guard",
    role: "Deterministic Citation ID Validation",
    modelOrTech: "Regex + Retrieved Evidence Manifest",
    description: "Checks that [S#] and [D#] citation IDs exist in the retrieved evidence manifest. It removes lines supported only by unknown IDs and reports reference validity; it does not evaluate claim entailment.",
    inputs: ["Draft Monograph", "Retrieved Evidence Manifest"],
    outputs: ["Citation index", "Claim-level verdicts", "Cleaned report and validity metrics"],
    resiliency: "Runs deterministically without an external model. Citation presence is not treated as proof that a source supports a claim.",
    codeSnippet: `def verify_and_ground_citations(report_markdown, evidence_manifest):
    # Resolve citation IDs against retrieved source IDs
    return {"citation_index": citation_index, "cleaned_markdown": cleaned_markdown}`
  }
];

export default function ArchitecturePage() {
  const [selectedNode, setSelectedNode] = useState<PipelineNode>(PIPELINE_NODES[0]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const stageButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, PIPELINE_NODES.findIndex((node) => node.id === selectedNode.id));

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then(res => res.json())
      .then(data => setBackendStatus(data))
      .catch(() => setBackendStatus({ status: "offline" }));
  }, []);

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)] flex flex-col font-sans selection:bg-[var(--accent-soft)]">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 py-10 md:py-16 space-y-10">
        {/* Header */}
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--ink-2)] text-[11px] font-mono tracking-wider uppercase">
            <Layers className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>System Blueprint & Execution Graph</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-[var(--ink)] tracking-tight">
            Ada Multi-Agent Architecture
          </h1>
          <p className="text-[var(--ink-2)] text-xs sm:text-sm leading-relaxed">
            A distributed, dual-corpus deep research engine designed for empirical citation grounding, adversarial gap arbitration, and resilient failover.
          </p>
        </div>

        {/* Live System Diagnostics Ribbon */}
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-[12px] p-4 sm:p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${backendStatus?.status === "ok" ? "bg-[var(--ok)]" : "bg-[var(--warn)]"}`} />
              <div>
                <span className="text-xs font-mono font-bold text-[var(--ink)] block">
                  Backend Engine: {backendStatus?.service || "Ada Core"}
                </span>
                <span className="text-[11px] text-[var(--ink-3)] font-mono">
                  Mode: {backendStatus?.engine || "multi-agent-langgraph-executor"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-[var(--ink-2)]">
              <div className="flex items-center gap-1.5 bg-[var(--surface-2)] px-3 py-1.5 rounded-[6px] border border-[var(--line)]">
                <Database className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Qdrant (384d BGE)</span>
              </div>
              <div className="flex items-center gap-1.5 bg-[var(--surface-2)] px-3 py-1.5 rounded-[6px] border border-[var(--line)]">
                <Globe className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Trafilatura + search-snippet fallback</span>
              </div>
              <div className="flex items-center gap-1.5 bg-[var(--surface-2)] px-3 py-1.5 rounded-[6px] border border-[var(--line)]">
                <Zap className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Configured LLM provider fallbacks</span>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Architecture Flow & Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Visual Pipeline Flow (5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--ink-3)] font-semibold">
                Execution Pipeline Stages
              </span>
              <span className="text-[10px] text-[var(--ink-4)] font-mono">Select to inspect · use ↑ ↓ to navigate</span>
            </div>

            {PIPELINE_NODES.map((node, idx) => {
              const isSelected = selectedNode.id === node.id;
              return (
                <div key={node.id} className="space-y-2">
                  <button
                    ref={(element) => { stageButtons.current[idx] = element; }}
                    onClick={() => setSelectedNode(node)}
                    onKeyDown={(event) => {
                      let nextIndex: number | null = null;
                      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                        nextIndex = (idx + 1) % PIPELINE_NODES.length;
                      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                        nextIndex = (idx - 1 + PIPELINE_NODES.length) % PIPELINE_NODES.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = PIPELINE_NODES.length - 1;
                      }

                      if (nextIndex !== null) {
                        event.preventDefault();
                        setSelectedNode(PIPELINE_NODES[nextIndex]);
                        stageButtons.current[nextIndex]?.focus();
                      }
                    }}
                    aria-label={`Inspect stage ${idx + 1}: ${node.name.replace(/^\d+\.\s*/, "")}`}
                    aria-pressed={isSelected}
                    tabIndex={idx === selectedIndex ? 0 : -1}
                    className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                      isSelected
                        ? "bg-[var(--surface-2)] border-[var(--ink-3)] text-[var(--ink)] shadow-xs"
                        : "bg-[var(--surface)] border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold uppercase ${
                          isSelected ? "bg-[var(--ink)] text-[var(--paper)]" : "bg-[var(--surface-3)] text-[var(--ink-3)]"
                        }`}>
                          Step 0{idx + 1}
                        </span>
                        <h4 className="text-xs font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                          {node.name.replace(/^\d+\.\s*/, '')}
                        </h4>
                      </div>
                      <p className="text-[11px] text-[var(--ink-3)] line-clamp-1 font-mono">
                        {node.modelOrTech}
                      </p>
                    </div>

                    <ArrowRight className={`w-4 h-4 transition-transform ${
                      isSelected ? "text-[var(--accent)] translate-x-1" : "text-[var(--ink-4)] group-hover:text-[var(--ink-2)]"
                    }`} />
                  </button>

                  {idx < PIPELINE_NODES.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowDown className="w-3.5 h-3.5 text-[var(--line-strong)]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Column: Node Deep-Dive Inspector (7 cols) */}
          <div className="lg:col-span-7 bg-[var(--surface)] border border-[var(--line)] rounded-xl p-6 sm:p-7 space-y-6 shadow-xl sticky top-20">
            {/* Selected Node Header */}
            <div className="space-y-2 border-b border-[var(--line)] pb-5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--ink-2)] border border-[var(--line)] font-semibold uppercase">
                  {selectedNode.name}
                </span>
                <span className="text-[11px] font-mono text-[var(--ink-3)]">
                  {selectedNode.role}
                </span>
              </div>
              <h3 className="text-xl font-serif font-bold text-[var(--ink)]">
                {selectedNode.modelOrTech}
              </h3>
              <p className="text-xs sm:text-sm text-[var(--ink-2)] leading-relaxed font-sans pt-1">
                {selectedNode.description}
              </p>
            </div>

            {/* Inputs & Outputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[var(--surface-2)] border border-[var(--line)] p-4 rounded-lg space-y-2">
                <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] font-semibold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[var(--ink-2)]" />
                  Contract Inputs
                </span>
                <ul className="text-xs text-[var(--ink-3)] space-y-1 list-disc pl-4 font-mono">
                  {selectedNode.inputs.map((inp, i) => (
                    <li key={i}>{inp}</li>
                  ))}
                </ul>
              </div>

              <div className="bg-[var(--surface-2)] border border-[var(--line)] p-4 rounded-lg space-y-2">
                <span className="text-[10px] font-mono uppercase text-[var(--ink-3)] font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ok)]" />
                  Contract Outputs
                </span>
                <ul className="text-xs text-[var(--ink-3)] space-y-1 list-disc pl-4 font-mono">
                  {selectedNode.outputs.map((out, i) => (
                    <li key={i}>{out}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Resiliency & Fault Tolerance */}
            <div className="bg-[var(--surface-2)] border border-[var(--line)] p-4 rounded-lg space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-[var(--ink-2)] font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--accent)]" />
                Resiliency & Fault Tolerance Guarantee
              </span>
              <p className="text-xs text-[var(--ink-3)] leading-relaxed">
                {selectedNode.resiliency}
              </p>
            </div>

            {/* Code Snippet Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-3)]">
                <span className="flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-[var(--ink-2)]" />
                  Representative Execution Flow
                </span>
                <span className="text-[var(--ink-4)]">engine/</span>
              </div>
              <div className="bg-[var(--surface-2)] p-4 rounded-lg border border-[var(--line)] overflow-x-auto">
                <pre className="text-xs font-mono text-[var(--ink-2)] leading-relaxed">
                  <code>{selectedNode.codeSnippet}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
