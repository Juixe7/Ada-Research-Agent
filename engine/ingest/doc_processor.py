"""Extracts supported document formats and chunks text with page and heading metadata.

"""

import re
import uuid
import csv
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pymupdf


class DocumentChunk:
    """Serializable text passage with source, location, and section metadata."""

    def __init__(
        self,
        chunk_id: str,
        doc_name: str,
        page_number: int,
        text: str,
        char_count: int,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Build a parsed document chunk.

        Args:
            chunk_id: Stable identifier for this passage.
            doc_name: Original sanitized source-document name.
            page_number: One-based source page, or the parser's document-level
                page marker when the format has no pages.
            text: Passage text used for retrieval.
            char_count: Character count for the stored passage.
            metadata: Optional section/chunk metadata copied into serialization.
        """
        self.chunk_id = chunk_id
        self.doc_name = doc_name
        self.page_number = page_number
        self.text = text
        self.char_count = char_count
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the chunk into the retrieval payload shape."""
        return {
            "chunk_id": self.chunk_id,
            "doc_name": self.doc_name,
            "page_number": self.page_number,
            "text": self.text,
            "char_count": self.char_count,
            "source_type": "user_doc",
            **self.metadata,
        }


_KNOWN_HEADINGS = {
    "summary", "professional summary", "profile", "objective", "about me",
    "experience", "work experience", "professional experience", "employment",
    "employment history", "career history", "education", "academic background",
    "skills", "technical skills", "core skills", "key skills", "competencies",
    "projects", "selected projects", "personal projects", "certifications",
    "licenses and certifications", "awards", "publications", "research",
    "leadership", "volunteer experience", "languages", "interests", "references",
}
_BULLET_RE = re.compile(r"^(?:[-*•▪◦‣]|\(?\d+[.)]|\(?[a-zA-Z][.)])\s+")
_NUMBERED_HEADING_RE = re.compile(r"^\s*\d+(?:\.\d+)*[.)]?\s+(.+?)\s*$")


def _clean_line(line: str) -> str:
    """Collapse horizontal whitespace and trim one extracted document line."""
    return re.sub(r"[\t\u00a0 ]+", " ", line).strip()


def _heading_text(line: str) -> Optional[str]:
    """Recognize explicit/standalone headings without treating ordinary prose as one."""
    candidate = _clean_line(line)
    if not candidate or len(candidate) > 90:
        return None

    candidate = re.sub(r"^#{1,6}\s*", "", candidate)
    numbered = _NUMBERED_HEADING_RE.match(candidate)
    if numbered:
        candidate = numbered.group(1).strip()
    candidate = candidate.rstrip(":").strip()
    normalized = re.sub(r"\s+", " ", candidate.lower())
    if normalized in _KNOWN_HEADINGS:
        return candidate

    # PDFs commonly render section headings in all caps, while headings ending
    # with a colon are a useful signal in resumes and technical documents.
    letters = [char for char in candidate if char.isalpha()]
    if not letters or _BULLET_RE.match(candidate):
        return None
    if len(candidate) <= 64 and len(letters) >= 3:
        upper_ratio = sum(char.isupper() for char in letters) / len(letters)
        if upper_ratio >= 0.82 and not re.search(r"[.!?]$", candidate):
            return candidate
        if line.strip().endswith(":") and len(candidate.split()) <= 8:
            return candidate
        # Resume roles/projects often use a short title-case line within a
        # section (for example, "Research Assistant | Acme Labs").
        words = candidate.split()
        if (
            len(candidate) <= 90
            and 2 <= len(words) <= 9
            and not re.search(r"[.!?]$", candidate)
            and all(
                word in {"|", "&", "-", "—", "–"}
                or word[0].isupper()
                or word.lower() in {"and", "of", "for", "at", "in", "to", "the"}
                for word in words
            )
        ):
            return candidate
    return None


def _heading_level(line: str, heading: str, has_section: bool = False) -> int:
    """Choose a Markdown heading level from explicit and inferred section cues."""
    markdown = re.match(r"^\s*(#{1,6})\s*", line)
    if markdown:
        return min(len(markdown.group(1)), 2)
    normalized = re.sub(r"\s+", " ", heading.lower())
    if normalized in _KNOWN_HEADINGS:
        return 1
    return 2 if has_section else 1


def normalize_section_boundaries(text: str) -> str:
    """Normalize PDF line endings and put recognized headings on their own blocks."""
    lines = [_clean_line(line) for line in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    output: List[str] = []
    for line in lines:
        if _heading_text(line) and output and output[-1] != "":
            output.append("")
        output.append(line)
        if _heading_text(line):
            output.append("")
    return "\n".join(output)


def _split_long_unit(text: str, max_chars: int) -> List[str]:
    """Split an oversized paragraph on sentence/line boundaries, then word boundaries."""
    pieces = [piece.strip() for piece in re.split(r"(?<=[.!?])\s+|\n+", text) if piece.strip()]
    if not pieces:
        pieces = [text.strip()]

    result: List[str] = []
    current = ""
    for piece in pieces:
        # A long sentence or URL-free line still needs a bounded, word-safe split.
        if len(piece) > max_chars:
            words = []
            remaining = piece
            while len(remaining) > max_chars:
                split_at = remaining.rfind(" ", 0, max_chars + 1)
                if split_at <= 0:
                    split_at = max_chars
                words.append(remaining[:split_at].strip())
                remaining = remaining[split_at:].strip()
            if remaining:
                words.append(remaining)
        else:
            words = [piece]
        for word_part in words:
            candidate = f"{current}\n{word_part}" if current else word_part
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    result.append(current)
                current = word_part
    if current:
        result.append(current)
    return result


def _overlap_tail(text: str, overlap: int) -> str:
    """Return a word-aligned suffix to carry into the next passage."""
    if overlap <= 0 or not text:
        return ""
    tail = text[-overlap:]
    first_space = tail.find(" ")
    if first_space >= 0:
        tail = tail[first_space + 1:]
    return tail.strip()


def chunk_text_with_metadata(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 150,
    page_number: int = 1,
    initial_section_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Chunk text with heading context, page metadata, and real same-section overlap."""
    if not text or not text.strip():
        return []
    if chunk_size < 100:
        raise ValueError("chunk_size must be at least 100 characters")
    overlap = max(0, min(overlap, chunk_size // 2))

    normalized = normalize_section_boundaries(text)
    units: List[Tuple[str, str]] = []
    section_path: List[str] = initial_section_path.split(" > ") if initial_section_path else []
    for block in re.split(r"\n\s*\n", normalized):
        block = block.strip()
        if not block:
            continue
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        # A heading block updates the section path; preserve it as explicit context.
        heading = _heading_text(lines[0]) if len(lines) == 1 else None
        if heading:
            level = _heading_level(lines[0], heading, has_section=bool(section_path))
            if level == 1 or not section_path:
                section_path = [heading]
            else:
                section_path = [section_path[0], heading]
            continue
        body = "\n".join(lines)
        section = " > ".join(section_path)
        context_size = len(f"Section: {section}\n\n") if section else 0
        body_limit = max(1, chunk_size - context_size)
        for piece in _split_long_unit(body, body_limit):
            units.append((section, piece))

    chunks: List[Dict[str, Any]] = []
    current_section: Optional[str] = None
    current_body = ""

    def flush() -> None:
        """Append the current non-empty chunk with its section/page metadata."""
        nonlocal current_body
        if not current_body.strip():
            return
        section = current_section or ""
        text_body = current_body.strip()
        # Repeating the section label in the embedded text helps retrieval retain
        # context when a passage is returned without its neighboring passages.
        embedded_text = f"Section: {section}\n\n{text_body}" if section else text_body
        chunks.append({
            "text": embedded_text,
            "section_path": section or None,
            "page_number": page_number,
            "char_count": len(embedded_text),
        })
        current_body = ""

    for section, unit in units:
        if current_body and section != current_section:
            flush()
        if not current_body:
            current_section = section
        section_context_size = len(f"Section: {section}\n\n") if section else 0
        body_limit = max(1, chunk_size - section_context_size)
        candidate = f"{current_body}\n\n{unit}" if current_body else unit
        if len(candidate) <= body_limit:
            current_body = candidate
            continue

        previous = current_body
        previous_section = current_section
        flush()
        current_section = section
        available_overlap = max(0, body_limit - len(unit) - 1)
        tail = _overlap_tail(previous, min(overlap, available_overlap)) if section == (previous_section or "") else ""
        current_body = f"{tail}\n{unit}" if tail else unit

    flush()
    for index, chunk in enumerate(chunks, 1):
        chunk["chunk_index"] = index
    return chunks


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> List[str]:
    """Compatibility wrapper returning only the passage text."""
    return [chunk["text"] for chunk in chunk_text_with_metadata(text, chunk_size, overlap)]


def _page_chunks(
    page_text: str,
    page_number: int,
    chunk_size: int = 1200,
    overlap: int = 150,
    initial_section_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Chunk one PDF page while preserving the current section path."""
    return chunk_text_with_metadata(page_text, chunk_size, overlap, page_number, initial_section_path)


def process_pdf_document(file_path: str, doc_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Extract PDF text page by page and create heading-aware, overlapping passages."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF document not found: {file_path}")

    actual_doc_name = doc_name or path.name
    doc = pymupdf.open(file_path)
    try:
        if doc.is_encrypted:
            raise ValueError(f"PDF document '{actual_doc_name}' is password-protected and cannot be parsed.")

        all_chunks: List[Dict[str, Any]] = []
        current_section_path: Optional[str] = None
        for page_idx in range(len(doc)):
            page_num = page_idx + 1
            page_text = doc[page_idx].get_text("text").strip()
            if not page_text:
                continue
            page_chunks = _page_chunks(page_text, page_num, initial_section_path=current_section_path)
            if page_chunks and page_chunks[-1].get("section_path"):
                current_section_path = page_chunks[-1]["section_path"]
            for chunk in page_chunks:
                chunk_text_value = chunk["text"]
                if len(chunk_text_value) < 50:
                    continue
                all_chunks.append(DocumentChunk(
                    chunk_id=str(uuid.uuid4()),
                    doc_name=actual_doc_name,
                    page_number=page_num,
                    text=chunk_text_value,
                    char_count=len(chunk_text_value),
                    metadata={
                        "section_path": chunk.get("section_path"),
                        "chunk_index": len(all_chunks) + 1,
                    },
                ).to_dict())
        return all_chunks
    finally:
        doc.close()


def process_docx_document(content: bytes, doc_name: str) -> List[Dict[str, Any]]:
    """Extract DOCX paragraphs/headings and table rows with section context."""
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError("The DOCX file is invalid or damaged.") from exc

    lines: List[str] = []
    for child in root.findall(".//w:body/*", namespace):
        if child.tag.endswith("}p"):
            text = "".join(node.text or "" for node in child.findall(".//w:t", namespace)).strip()
            if not text:
                continue
            style = child.find("./w:pPr/w:pStyle", namespace)
            style_name = style.attrib.get(f"{{{namespace['w']}}}val", "") if style is not None else ""
            if style_name.lower().startswith("heading1"):
                lines.append(f"# {text}")
            elif style_name.lower().startswith(("heading2", "heading3")):
                lines.append(f"## {text}")
            else:
                lines.append(text)
        elif child.tag.endswith("}tbl"):
            for row in child.findall("./w:tr", namespace):
                cells = [" ".join("".join(t.text or "" for t in p.findall(".//w:t", namespace)) for p in cell.findall("./w:p", namespace)).strip() for cell in row.findall("./w:tc", namespace)]
                cells = [cell for cell in cells if cell]
                if cells:
                    lines.append(" | ".join(cells))
    return process_raw_text_document("\n\n".join(lines), doc_name)


def process_csv_document(content: bytes, doc_name: str) -> List[Dict[str, Any]]:
    """Turn CSV records into header-labelled, section-aware text passages."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("CSV files must use UTF-8 encoding.") from exc
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2 or not any(cell.strip() for cell in rows[0]):
        raise ValueError("CSV must contain a header row and at least one data row.")
    headers = [cell.strip() or f"Column {index + 1}" for index, cell in enumerate(rows[0])]
    records = []
    for row_number, row in enumerate(rows[1:], start=2):
        fields = [f"{headers[index]}: {value.strip()}" for index, value in enumerate(row[:len(headers)]) if value.strip()]
        if fields:
            records.append(f"Record {row_number}\n" + "\n".join(fields))
    return process_raw_text_document("# CSV data\n\n" + "\n\n".join(records), doc_name)


def process_raw_text_document(raw_text: str, doc_name: str = "User Pasted Document") -> List[Dict[str, Any]]:
    """Chunk pasted text with the same section-aware strategy as PDF text."""
    if not raw_text or not raw_text.strip():
        return []

    all_chunks = []
    for chunk in chunk_text_with_metadata(raw_text.strip(), chunk_size=1200, overlap=150):
        chunk_text_value = chunk["text"]
        all_chunks.append(DocumentChunk(
            chunk_id=str(uuid.uuid4()),
            doc_name=doc_name,
            page_number=chunk["page_number"],
            text=chunk_text_value,
            char_count=len(chunk_text_value),
            metadata={
                "section_path": chunk.get("section_path"),
                "chunk_index": len(all_chunks) + 1,
            },
        ).to_dict())
    return all_chunks
