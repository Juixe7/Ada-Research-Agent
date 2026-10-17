from engine.ingest.doc_processor import chunk_text_with_metadata


def test_resume_passages_keep_section_and_subsection_context():
    text = """SUMMARY
Builds data products and research tools for scientific teams.

EXPERIENCE
Senior Engineer at Northstar Labs
Built a retrieval system for internal research. Improved source linking and ranking.

Research Assistant | University Lab
Prepared datasets and evaluated model outputs for a research project.

EDUCATION
Master of Science
Focused on information retrieval and machine learning."""

    chunks = chunk_text_with_metadata(text, chunk_size=240, overlap=40)
    sections = {chunk["section_path"] for chunk in chunks}

    assert "SUMMARY" in sections
    assert "EXPERIENCE > Senior Engineer at Northstar Labs" in sections
    assert "EXPERIENCE > Research Assistant | University Lab" in sections
    assert "EDUCATION > Master of Science" in sections
    assert all(chunk["text"].startswith(f"Section: {chunk['section_path']}\n\n") for chunk in chunks)


def test_chunks_overlap_within_section_but_stay_under_limit():
    text = "EXPERIENCE\nENGINEER\n" + "\n".join(
        f"- Evidence item {i}: " + ("reliable retrieval supports careful analysis and source tracing " * 2)
        for i in range(1, 7)
    )

    chunks = chunk_text_with_metadata(text, chunk_size=200, overlap=55)

    assert len(chunks) > 1
    assert all(chunk["section_path"] == "EXPERIENCE > ENGINEER" for chunk in chunks)
    assert all(len(chunk["text"]) <= 200 for chunk in chunks)
    assert all(chunk["chunk_index"] == index for index, chunk in enumerate(chunks, 1))
    assert any(
        chunks[index]["text"].split("\n\n", 1)[-1][-20:] in chunks[index + 1]["text"]
        for index in range(len(chunks) - 1)
    )


def test_section_context_can_continue_across_pdf_pages():
    chunks = chunk_text_with_metadata(
        "Continued work on the research platform and evaluated retrieval quality.",
        page_number=2,
        initial_section_path="EXPERIENCE > Research Engineer",
    )

    assert chunks[0]["page_number"] == 2
    assert chunks[0]["section_path"] == "EXPERIENCE > Research Engineer"
