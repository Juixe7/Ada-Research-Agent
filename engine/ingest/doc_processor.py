import os
import re
import uuid
from pathlib import Path
from typing import List, Dict, Any, Optional
import pymupdf

class DocumentChunk:
    def __init__(
        self,
        chunk_id: str,
        doc_name: str,
        page_number: int,
        text: str,
        char_count: int,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.chunk_id = chunk_id
        self.doc_name = doc_name
        self.page_number = page_number
        self.text = text
        self.char_count = char_count
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "doc_name": self.doc_name,
            "page_number": self.page_number,
            "text": self.text,
            "char_count": self.char_count,
            "source_type": "user_doc",
            **self.metadata
        }

def normalize_section_boundaries(text: str) -> str:
    """Inserts clean paragraph breaks before section headers and major bullet clusters."""
    # Ensure project/experience lines with tech stack bars (e.g. 'Ada | Python...') have clean breaks
    text = re.sub(r'(\n)([A-Za-z0-9_\-\s]{2,30}\s*\|\s*[^\n]+)', r'\1\n\2', text)
    # Ensure uppercase section titles have clean breaks
    text = re.sub(r'(\n)([A-Z\s]{4,25})(\n)', r'\1\n\2\3', text)
    return text

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> List[str]:
    """
    Splits text into chunks preserving semantic paragraph, section, and sentence boundaries.
    Never slices in the middle of words or sentences.
    """
    if not text or not text.strip():
        return []

    text = normalize_section_boundaries(text)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    
    chunks = []
    current_chunk = ""

    for p in paragraphs:
        # If single paragraph fits within limit
        if len(current_chunk) + len(p) + 2 <= chunk_size:
            current_chunk = f"{current_chunk}\n\n{p}" if current_chunk else p
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""

            # If the paragraph itself exceeds chunk_size, split by sentences/lines
            if len(p) > chunk_size:
                sentences = re.split(r'(?<=[.!?])\s+|\n', p)
                sub_chunk = ""
                for sent in sentences:
                    sent = sent.strip()
                    if not sent:
                        continue
                    if len(sub_chunk) + len(sent) + 1 <= chunk_size:
                        sub_chunk = f"{sub_chunk} {sent}" if sub_chunk else sent
                    else:
                        if sub_chunk:
                            chunks.append(sub_chunk.strip())
                        sub_chunk = sent
                if sub_chunk.strip():
                    current_chunk = sub_chunk.strip()
            else:
                current_chunk = p

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks

def process_pdf_document(file_path: str, doc_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Ingests and parses a PDF document.
    Extracts text per page, applies recursive windowing, and tags page numbers.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF document not found: {file_path}")

    actual_doc_name = doc_name or path.name
    doc = pymupdf.open(file_path)
    if doc.is_encrypted:
        doc.close()
        raise ValueError(f"PDF document '{actual_doc_name}' is password-protected and cannot be parsed.")

    all_chunks = []

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_num = page_idx + 1
        page_text = page.get_text("text").strip()

        if not page_text:
            continue

        raw_chunks = chunk_text(page_text, chunk_size=1200, overlap=150)
        for chunk_str in raw_chunks:
            if len(chunk_str) < 50:
                continue
            chunk_obj = DocumentChunk(
                chunk_id=str(uuid.uuid4()),
                doc_name=actual_doc_name,
                page_number=page_num,
                text=chunk_str,
                char_count=len(chunk_str)
            )
            all_chunks.append(chunk_obj.to_dict())

    doc.close()
    return all_chunks

def process_raw_text_document(raw_text: str, doc_name: str = "User Pasted Document") -> List[Dict[str, Any]]:
    """
    Ingests raw user-pasted text (or paywalled articles pasted directly by the user).
    """
    if not raw_text or not raw_text.strip():
        return []

    raw_chunks = chunk_text(raw_text.strip(), chunk_size=1200, overlap=150)
    all_chunks = []
    for idx, chunk_str in enumerate(raw_chunks, 1):
        chunk_obj = DocumentChunk(
            chunk_id=str(uuid.uuid4()),
            doc_name=doc_name,
            page_number=idx,
            text=chunk_str,
            char_count=len(chunk_str)
        )
        all_chunks.append(chunk_obj.to_dict())

    return all_chunks
