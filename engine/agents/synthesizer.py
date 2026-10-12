import os
import re
import html
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from engine.config import GEMINI_API_KEY, GEMINI_SYNTHESIS_MODEL

SYNTHESIZER_SYSTEM_INSTRUCTION = """You are the Chief Intelligence Analyst and Synthesizer of Ada Deep Research.
Your objective is to craft an exhaustive, publication-grade, deeply analytical research dossier on the requested topic.

CRITICAL CITATION & GROUNDING RULES:
1. Every factual assertion, data point, date, metric, and finding MUST be accompanied by an inline bracketed citation corresponding to the provided XML source ID (e.g. [S1], [S2], [D1]).
2. NEVER invent sources or use citation IDs that do not exist in the <evidence_manifest>.
3. If user documents are provided ([D1], [D2]...), highlight their internal data prominently.
4. Integrate the Critic's Contradiction Audit into a dedicated section explaining WHY sources disagree (e.g. definitions, timelines, methodologies).

STRUCTURE REQUIRED:
# [Comprehensive Executive Title]

## Executive Intelligence Briefing (TL;DR)
### Direct Answer
[1 to 2 authoritative, dense paragraphs directly answering the core inquiry with zero fluff, citing primary sources with [Sx] and [Dx]]

### Key Evidentiary Findings
- **Finding 1**: [Core insight with [Sx]/[Dx] citation]
- **Finding 2**: [Core insight with [Sx]/[Dx] citation]
- **Finding 3**: [Core insight with [Sx]/[Dx] citation]
- **Reconciled Discrepancy**: [Arbitrated resolution of conflicting claims or scope nuance]

---

## 1. Quantitative Benchmarks & State-of-the-Art Metrics
## 2. Detailed Technical & Architectural Analysis (Deep-dive sections with inline citations)
## 3. Contested Claims & Contradiction Breakdown (Detailed arbitration of conflicting evidence)
## 4. Strategic Risks, Bottlenecks & Future Outlook
## 5. Complete Evidence Sources (Numbered list of all sources cited with domains/titles)
"""

def format_evidence_xml(manifest: List[Dict[str, Any]]) -> str:
    """Formats evidence items into strict XML boundary tags for Gemini's long context window."""
    xml_parts = [f'<evidence_manifest total_sources="{len(manifest)}">']
    for ev in manifest:
        sid = ev.get("source_id", "S?")
        stype = ev.get("source_type", "web")
        title = html.escape(ev.get("title", "Untitled Source"))
        auth = ev.get("authority_score", 0.7)
        
        if stype == "user_doc":
            dname = html.escape(ev.get("doc_name", "User Doc"))
            pnum = ev.get("page_number", 1)
            xml_parts.append(f'  <source id="{sid}" type="user_doc" doc_name="{dname}" page="{pnum}" authority="{auth}" title="{title}">')
        else:
            url = html.escape(ev.get("url", ""))
            domain = html.escape(ev.get("domain", "web"))
            xml_parts.append(f'  <source id="{sid}" type="web" domain="{domain}" url="{url}" authority="{auth}" title="{title}">')

        # Clean text
        raw_text = ev.get("text", "")
        # Escape XML entities
        escaped_text = html.escape(raw_text)
        xml_parts.append(f'    <content>{escaped_text}</content>')
        xml_parts.append('  </source>')

    xml_parts.append('</evidence_manifest>')
    return "\n".join(xml_parts)

def synthesize_research_dossier(
    query: str,
    evidence_manifest: List[Dict[str, Any]],
    critic_audit: Dict[str, Any]
) -> str:
    """
    Synthesizes the entire evidence corpus using Gemini 1M context into a long-form cited dossier.
    """
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name=GEMINI_SYNTHESIS_MODEL,
        system_instruction=SYNTHESIZER_SYSTEM_INSTRUCTION
    )

    evidence_xml = format_evidence_xml(evidence_manifest)
    
    contradictions_summary = ""
    for c in critic_audit.get("contradictions", []):
        contradictions_summary += f"- Topic: {c.get('topic')}\n  Viewpoint A: {c.get('claim_a')}\n  Viewpoint B: {c.get('claim_b')}\n  Analysis: {c.get('analysis')}\n"

    gaps_summary = "\n".join(f"- {g}" for g in critic_audit.get("identified_gaps", []))

    user_prompt = f"""RESEARCH TOPIC:
"{query}"

AUDIT CONTRADICTIONS DETECTED BY CRITIC:
{contradictions_summary if contradictions_summary else "No severe direct contradictions detected."}

AUDITED KNOWLEDGE GAPS ADDRESSED:
{gaps_summary if gaps_summary else "Coverage was rated comprehensive."}

VERIFIED EVIDENCE CORPUS ({len(evidence_manifest)} Sources):
{evidence_xml}

Synthesize the definitive, publication-grade research report on this topic. Ensure heavy, accurate citation coverage using [Sx] and [Dx] notation throughout the text.
"""

    print(f"[synthesizer] Prompting {GEMINI_SYNTHESIS_MODEL} with {len(evidence_manifest)} sources (~{len(evidence_xml)//4} tokens)...")
    
    # ── Tier 1: Gemini 1M Context with Automatic 429 Backoff Retry ──
    import time
    for attempt in range(2):
        try:
            response = model.generate_content(
                user_prompt,
                generation_config=genai.types.GenerationConfig(
                    temperature=0.15,
                    max_output_tokens=8192
                ),
                request_options={"timeout": 20}
            )
            if response and response.text:
                return response.text.strip()
        except Exception as e:
            err_str = str(e)
            print(f"[synthesizer] Gemini attempt {attempt+1} error: {err_str[:120]}...")
            if ("429" in err_str or "quota" in err_str.lower()) and attempt < 1:
                wait_sec = 6
                print(f"[synthesizer] Rate limit hit. Backing off for {wait_sec}s...")
                time.sleep(wait_sec)
                continue
            break

    # ── Tier 2: Groq Fallback (Zero Quota Overlap with Google) ──
    try:
        from groq import Groq
        from engine.config import GROQ_API_KEY, GROQ_PLANNER_MODEL
        print(f"[synthesizer] Engaging Tier-2 Groq fallback ({GROQ_PLANNER_MODEL})...")
        groq_client = Groq(api_key=GROQ_API_KEY)
        truncated_prompt = user_prompt[:26000] if len(user_prompt) > 26000 else user_prompt
        resp = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": SYNTHESIZER_SYSTEM_INSTRUCTION},
                {"role": "user", "content": truncated_prompt}
            ],
            model=GROQ_PLANNER_MODEL,
            temperature=0.15,
            max_tokens=4096
        )
        if resp.choices and resp.choices[0].message.content:
            return resp.choices[0].message.content.strip()
    except Exception as groq_err:
        print(f"[synthesizer] Groq fallback error: {groq_err}")

    return f"# Research Report: {query}\n\nSynthesis could not complete due to provider rate limits. Evidence manifest preserved ({len(evidence_manifest)} sources collected)."
