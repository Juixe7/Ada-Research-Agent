"""Validates generated report citations against the run evidence manifest.

"""

import re
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

CITATION_REGEX = re.compile(r'\[(S\d+|D\d+)\]')
_SENTENCE_SPLIT_REGEX = re.compile(r"(?<=[.!?])\s+(?!\[(?:S\d+|D\d+)\])")


def _split_sentences(line: str) -> List[str]:
    """Split prose while keeping a trailing source tag with its sentence."""
    return _SENTENCE_SPLIT_REGEX.split(line)


def extract_cited_claims(report_markdown: str, evidence_manifest: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract citation-bearing sentences using the same stable ordering as the verifier."""
    valid_sources = {ev.get("source_id") for ev in evidence_manifest if ev.get("source_id")}
    claims: List[Dict[str, Any]] = []
    for line in report_markdown.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("- **["):
            continue
        if stripped.startswith("|") and not re.fullmatch(r"\|?[\s:|-]+\|?", stripped):
            tags = list(dict.fromkeys(cid for cid in CITATION_REGEX.findall(stripped) if cid in valid_sources))
            if tags:
                claims.append({"claim_id": len(claims) + 1, "sentence": stripped, "tags": tags})
            continue
        for sentence in _split_sentences(line):
            tags = list(dict.fromkeys(cid for cid in CITATION_REGEX.findall(sentence) if cid in valid_sources))
            if tags and len(CITATION_REGEX.sub("", sentence).strip()) > 10:
                claims.append({"claim_id": len(claims) + 1, "sentence": sentence.strip(), "tags": tags})
    return claims

def verify_and_ground_citations(
    report_markdown: str,
    evidence_manifest: List[Dict[str, Any]],
    claim_verdicts: Optional[Dict[int, Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Deterministic Citation Reference Validator:
    1. Extracts all inline bracketed citations [S1], [D2] from the synthesized markdown.
    2. Validates that every citation ID exists in the manifest of retrieved sources.
    3. Removes lines whose only citations are unrecorded IDs, and scrubs phantom tags
       from lines that also contain valid citations. This does not verify entailment.
    4. Compiles an interactive Citation Directory for frontend hover popups and bibliographies.
    """
    # Build dictionary of valid source IDs from manifest
    valid_sources = {ev.get("source_id"): ev for ev in evidence_manifest if ev.get("source_id")}
    
    # Find all citations in text
    all_citations_found = CITATION_REGEX.findall(report_markdown)
    unique_citations = sorted(list(set(all_citations_found)))

    valid_cited_ids = []
    hallucinated_ids = []

    for cid in unique_citations:
        if cid in valid_sources:
            valid_cited_ids.append(cid)
        else:
            hallucinated_ids.append(cid)

    # This ratio measures citation-ID validity only. It is deliberately kept
    # separate from faithfulness, which requires claim-level entailment checks.
    total_found_instances = len(all_citations_found)
    valid_instances = sum(1 for c in all_citations_found if c in valid_sources)
    # This is a citation-reference validity ratio, not a claim-entailment score.
    # A report with no citations has no measured grounding and must not score 100%.
    citation_validity_score = (valid_instances / total_found_instances) if total_found_instances > 0 else None

    # Build interactive citation index for frontend UI
    citation_index = {}
    for cid in valid_cited_ids:
        src = valid_sources[cid]
        citation_index[cid] = {
            "source_id": cid,
            "source_type": src.get("source_type", "web"),
            "title": src.get("title", "Untitled Source"),
            "url": src.get("url"),
            "domain": src.get("domain", "internal"),
            "doc_name": src.get("doc_name"),
            "page_number": src.get("page_number"),
            "authority_score": src.get("authority_score"),
            "snippet": src.get("text", "")[:350]
        }

    # Clean the markdown & reject claims backed solely by unrecorded sources
    cleaned_markdown = report_markdown
    rejected_claims: List[str] = []

    if hallucinated_ids:
        logger.warning("Citation validation found %s unrecorded source references", len(hallucinated_ids))
        hallucinated_set = set(hallucinated_ids)
        cleaned_lines = []

        for line in report_markdown.splitlines():
            stripped = line.strip()
            # Always preserve markdown headings, horizontal rules, and blank lines
            if not stripped or stripped.startswith("#") or stripped.startswith("---"):
                cleaned_lines.append(line)
                continue

            line_cites = CITATION_REGEX.findall(line)
            if not line_cites:
                cleaned_lines.append(line)
                continue

            # If a bullet point or single-sentence line cites ONLY hallucinated sources, reject the claim
            if stripped.startswith(("- ", "* ")) and all(c in hallucinated_set for c in line_cites):
                rejected_claims.append(stripped)
                continue

            # For paragraph lines, inspect sentence-by-sentence
            sentences = _split_sentences(line)
            kept_sentences = []
            for sent in sentences:
                sent_cites = CITATION_REGEX.findall(sent)
                if sent_cites and all(c in hallucinated_set for c in sent_cites):
                    # Claim relies exclusively on unrecorded source(s) -> reject claim
                    rejected_claims.append(sent.strip())
                else:
                    # Sentence has valid citations (or mixed valid + phantom); scrub only phantom tag
                    for hid in hallucinated_ids:
                        sent = re.sub(rf'\s*\[{hid}\]', '', sent)
                    kept_sentences.append(sent)

            if kept_sentences:
                cleaned_lines.append(" ".join(kept_sentences))

        cleaned_markdown = "\n".join(cleaned_lines)

    # Keep only unsupported claim sentences out of the final report. Partial and
    # unverified claims remain visible with explicit status in the Inspector.
    verdicts = claim_verdicts or {}
    verified_claims: List[Dict[str, Any]] = []
    claim_id = 0
    verified_lines: List[str] = []
    for line in cleaned_markdown.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("- **["):
            verified_lines.append(line)
            continue
        if stripped.startswith("|"):
            tags = [cid for cid in CITATION_REGEX.findall(line) if cid in valid_sources]
            if not tags or re.fullmatch(r"\|?[\s:|-]+\|?", stripped):
                verified_lines.append(line)
                continue
            claim_id += 1
            audit = verdicts.get(claim_id, {})
            verdict = audit.get("verdict", "unverified")
            verified_claims.append({
                "claim_id": claim_id,
                "sentence": stripped,
                "tags": tags,
                "verdict": verdict,
                "reason": audit.get("reason", "Claim entailment was unavailable for this table row."),
            })
            if verdict == "unsupported":
                rejected_claims.append(stripped)
            else:
                verified_lines.append(line)
            continue
        line_citations = [cid for cid in CITATION_REGEX.findall(line) if cid in valid_sources]
        if not line_citations:
            verified_lines.append(line)
            continue
        sentences = _split_sentences(line)
        kept = []
        for sentence in sentences:
            tags = [cid for cid in CITATION_REGEX.findall(sentence) if cid in valid_sources]
            if not tags:
                kept.append(sentence)
                continue
            claim_id += 1
            audit = verdicts.get(claim_id, {})
            verdict = audit.get("verdict", "unverified")
            verified_claims.append({
                "claim_id": claim_id,
                "sentence": sentence.strip(),
                "tags": tags,
                "verdict": verdict,
                "reason": audit.get("reason", "Claim entailment was unavailable for this sentence."),
            })
            if verdict != "unsupported":
                kept.append(sentence)
            else:
                rejected_claims.append(sentence.strip())
        if kept:
            verified_lines.append(" ".join(kept))
    cleaned_markdown = "\n".join(verified_lines)

    audited = [item for item in verified_claims if item["verdict"] in {"supported", "partial", "unsupported"}]
    supported = sum(1 for item in audited if item["verdict"] == "supported")
    entailment_score = round(supported / len(audited), 4) if audited else None

    return {
        "is_grounded": total_found_instances > 0 and len(hallucinated_ids) == 0,
        "faithfulness_score": entailment_score,
        "citation_validity_score": round(citation_validity_score, 4) if citation_validity_score is not None else None,
        "claims": verified_claims,
        "claims_audited": len(audited),
        "claims_supported": supported,
        "total_citations_count": total_found_instances,
        "unique_valid_sources_cited": len(valid_cited_ids),
        "hallucinated_sources_count": len(hallucinated_ids),
        "hallucinated_ids": hallucinated_ids,
        "rejected_claims_count": len(rejected_claims),
        "rejected_claims": rejected_claims,
        "citation_index": citation_index,
        "cleaned_markdown": cleaned_markdown
    }
