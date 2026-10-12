import sys
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.ingest.doc_processor import process_raw_text_document
from engine.storage.vector_store import get_vector_store
from engine.ingest.web_scraper import scrape_webpage

def test_phase0_foundations():
    print("=== 1. TESTING DOCUMENT INGESTION ===")
    sample_doc = """
    Executive Summary: Project Titan Q3 2026 Earnings
    Revenue reached $14.2B, a 28% increase year-over-year. Operating margin expanded to 31.4%.
    The primary driver of growth was enterprise AI infrastructure adoption, particularly custom ASIC silicon.
    However, supply chain constraints in HBM3e memory packages limited gross margins by 120 basis points.
    Management expects Q4 guidance to exceed consensus by 8-10%, projecting full year revenue of $58B.
    """
    chunks = process_raw_text_document(sample_doc, doc_name="Titan_Q3_Report.pdf")
    print(f"Generated {len(chunks)} chunks.")
    assert len(chunks) > 0, "No chunks generated"

    print("\n=== 2. TESTING VECTOR STORAGE & RETRIEVAL ===")
    vs = get_vector_store()
    indexed = vs.index_document_chunks(chunks)
    print(f"Successfully indexed {indexed} chunks into Qdrant.")
    assert indexed > 0, "No chunks indexed"

    query = "What were the supply chain constraints in Project Titan?"
    results = vs.search_user_docs(query, top_k=2)
    print(f"Search query: '{query}'")
    for r in results:
        print(f"  [Match: Score {r['score']}] (Doc: {r['doc_name']} | Page {r['page_number']})")
        print(f"  Snippet: {r['text'][:120]}...")
    assert len(results) > 0, "Search returned no results"

    print("\n=== 3. TESTING 3-TIER WEB SCRAPER ===")
    web_res = scrape_webpage("https://arxiv.org/abs/2401.03462")
    print(f"Scraped: '{web_res['title']}' via {web_res['method']}")
    print(f"Retrieved {web_res['char_count']} chars in {web_res['latency']}s")
    assert web_res["char_count"] > 500, "Web scraper failed to extract content"

    print("\n" + "="*50)
    print("✅ PHASE 0 FOUNDATIONS VERIFIED 100% OPERATIONAL!")
    print("="*50)

if __name__ == "__main__":
    test_phase0_foundations()
