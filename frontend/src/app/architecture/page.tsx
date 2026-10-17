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
    role: "Orthogonal DAG Query Decomposition",
    modelOrTech: "Gemini 1.5/2.5 Flash • Structured JSON",
    description: "Analyzes the user's research hypothesis and decomposes it into 3 to 7 orthogonal, non-overlapping investigation sub-questions. Formulates precise search queries targeting fundamental axioms rather than superficial keywords.",
    inputs: ["Raw Research Hypothesis", "Depth Level (Quick vs Deep)", "Domain Filter"],
    outputs: ["Sub-question DAG array", "Targeted search query matrix", "Investigation categories"],
    resiliency: "Regex-based trailing comma repair and automatic exponential backoff to handle free-tier API throttling.",
    codeSnippet: `def generate_research_plan(query: str, depth: str = "deep") -> List[Dict[str, Any]]:
    # Decomposes hypothesis into orthogonal research tracks
    prompt = f"Decompose into orthogonal research tracks: {query}"
    response = call_gemini_with_backoff(prompt)
    return parse_json_safely(response)`
  },
  {
    id: "retrieval",
    name: "02. Dual-Corpus Ingestion Workers",
    role: "Parallel Web & Private Document Retrieval",
    modelOrTech: "Trafilatura + Jina Reader + Qdrant ONNX",
    description: "Fans out sub-tasks concurrently across parallel threads or Celery chords. Simultaneously scrapes live web articles using a 3-tier fallback and retrieves private PDF passages from local Qdrant vector memory.",
    inputs: ["Search queries per track", "Qdrant collection 'ada_documents'", "Private doc flag"],
    outputs: ["Extracted full-text web articles", "Page-indexed PDF chunks", "Authority scores"],
    resiliency: "3-tier scraper: Trafilatura direct -> Jina Reader (r.jina.ai headless markdown) -> Serper snippet. Bypasses Cloudflare bot blocks.",
    codeSnippet: `def scrape_page_content(url: str) -> str:
    # Tier 1: Fast direct extraction via Trafilatura
    text = trafilatura.extract(fetch_url(url))
    if text and len(text) > 200: return text
    # Tier 2: Headless proxy via r.jina.ai (bypasses bot-walls)
    return fetch_jina_reader(url)`
  },
  {
    id: "manifest",
    name: "03. Evidence Normalizer & Deduplicator",
    role: "Deterministic Citation Standardization",
    modelOrTech: "Canonical Hash & URI Normalization",
    description: "Aggregates evidence across all parallel workers, removes duplicate URLs and snippets, strips tracking parameters, and assigns deterministic, permanent citation IDs ([S1], [S2] for web; [D1], [D2] for private documents).",
    inputs: ["Raw multi-worker evidence arrays"],
    outputs: ["Unified Evidence Manifest", "Unique Citation Index", "Passage excerpts"],
    resiliency: "URL query strip normalization prevents duplicate scraping of identical web pages with different UTM tags.",
    codeSnippet: `def normalize_and_deduplicate_evidence(raw_list):
    # D1, D2 for user docs; S1, S2 for web sources
    clean_list = []
    for item in raw_list:
        key = make_canonical_key(item)
        if key not in seen:
            item["source_id"] = f"S{idx}"
            clean_list.append(item)`
  },
  {
    id: "critic",
    name: "04. Adversarial Critic & Auditor",
    role: "Knowledge Gap & Contradiction Detection",
    modelOrTech: "Adversarial Prompting • Coverage Scoring",
    description: "Reviews the aggregated evidence manifest against the original query to identify missing data, uncorroborated assertions, and direct factual contradictions across sources. Generates dynamic Arbiter queries to resolve conflicts.",
    inputs: ["Unified Evidence Manifest", "Original Research Plan"],
    outputs: ["Coverage Quality & Score (0-100)", "Identified Gaps list", "Contradictions Matrix", "Arbiter Queries"],
    resiliency: "If coverage score is low or contradictions exceed threshold, dynamically dispatches an Arbiter research task before synthesis.",
    codeSnippet: `def audit_research_evidence(query, plan, evidence):
    prompt = f"Audit evidence for gaps and direct contradictions: {evidence}"
    audit = call_critic_llm(prompt)
    if audit.get("contradictions"):
        dispatch_arbiter_task(audit["arbiter_queries"])`
  },
  {
    id: "synthesizer",
    name: "05. Chief Research Synthesizer",
    role: "Long-Context Monograph Generation",
    modelOrTech: "Gemini 1.5/3.8 Flash (1M Context) + Groq Failover",
    description: "Injects all scraped sources and arbitrated viewpoints into Gemini's 1-million-token context window. Produces a 2,000+ word publication-grade research dossier organized into 6 standardized intelligence sections.",
    inputs: ["Full Evidence Manifest (up to 1M tokens)", "Critic Audit & Arbitrations"],
    outputs: ["2,000+ word structured markdown monograph with [S#]/[D#] inline citations"],
    resiliency: "Strict XML boundary isolation. Automatic 429 rate limit backoff (up to 20s) with seamless failover to Groq (qwen/qwen-2.5-72b).",
    codeSnippet: `def synthesize_research_dossier(query, evidence, critic_audit):
    # Pack up to 1M context with XML fencing
    payload = build_evidence_context(evidence)
    return call_gemini_with_fallback(payload)`
  },
  {
    id: "citations",
    name: "06. Citation Reference Guard",
    role: "Deterministic Citation ID Validation",
    modelOrTech: "Regex + Retrieved Evidence Manifest",
    description: "Checks that [S#] and [D#] citation IDs exist in the retrieved evidence manifest. It removes lines supported only by unknown IDs and reports reference validity; it does not evaluate claim entailment.",
    inputs: ["Draft Monograph", "Retrieved Evidence Manifest"],
    outputs: ["Citation Index", "Unmatched Citation IDs", "Cleaned Monograph"],
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
                <span>Trafilatura + Jina Fallback</span>
              </div>
              <div className="flex items-center gap-1.5 bg-[var(--surface-2)] px-3 py-1.5 rounded-[6px] border border-[var(--line)]">
                <Zap className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span>Groq 429 Failover to Gemini</span>
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
                  Implementation Reference
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
