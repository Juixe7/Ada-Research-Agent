import re
from typing import List, Dict, Any

CITATION_REGEX = re.compile(r'\[(S\d+|D\d+)\]')

def verify_and_ground_citations(
    report_markdown: str,
    evidence_manifest: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Deterministic Citation & Claim Grounding Validator:
    1. Extracts all inline bracketed citations [S1], [D2] from the synthesized markdown.
    2. Validates that every citation ID exists in the manifest of retrieved sources.
    3. Rejects claims (sentences/bullet points) that rely solely on unrecorded/hallucinated
       source IDs, and scrubs phantom tags from multi-source sentences.
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

    # Compute deterministic faithfulness metric
    total_found_instances = len(all_citations_found)
    valid_instances = sum(1 for c in all_citations_found if c in valid_sources)
    faithfulness_score = (valid_instances / total_found_instances) if total_found_instances > 0 else 1.0

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
            "authority_score": src.get("authority_score", 0.7),
            "snippet": src.get("text", "")[:350]
        }

    # Clean the markdown & reject claims backed solely by unrecorded sources
    cleaned_markdown = report_markdown
    rejected_claims: List[str] = []

    if hallucinated_ids:
        print(f"[citation_guard] Flagged {len(hallucinated_ids)} unrecorded citation IDs: {hallucinated_ids}")
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
            sentences = re.split(r'(?<=[.!?])\s+', line)
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

    return {
        "is_grounded": len(hallucinated_ids) == 0,
        "faithfulness_score": round(faithfulness_score, 4),
        "total_citations_count": total_found_instances,
        "unique_valid_sources_cited": len(valid_cited_ids),
        "hallucinated_sources_count": len(hallucinated_ids),
        "hallucinated_ids": hallucinated_ids,
        "rejected_claims_count": len(rejected_claims),
        "rejected_claims": rejected_claims,
        "citation_index": citation_index,
        "cleaned_markdown": cleaned_markdown
    }
