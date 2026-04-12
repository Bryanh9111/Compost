"""Phase 0 markdown extractor: paragraph chunking + heading-based fact extraction."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Chunk:
    chunk_id: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Fact:
    subject: str
    predicate: str
    object: str
    source_chunk_ids: list[str] = field(default_factory=list)


CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def _split_paragraphs(content: str) -> list[str]:
    """Split content on double newlines, strip empty results."""
    parts = re.split(r"\n{2,}", content)
    return [p.strip() for p in parts if p.strip()]


def _build_heading_path(paragraphs: list[str]) -> list[list[str]]:
    """For each paragraph, compute the active heading path."""
    # heading_stack: list of (level, text)
    stack: list[tuple[int, str]] = []
    paths: list[list[str]] = []

    for para in paragraphs:
        m = HEADING_RE.match(para)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            # Pop headings of same or deeper level
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, text))
            paths.append([h for _, h in stack])
        else:
            paths.append([h for _, h in stack])

    return paths


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Chunk a single text string by character count with overlap."""
    if len(text) <= chunk_size:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
        if start >= len(text):
            break
    return chunks


def extract_chunks(content: str) -> list[Chunk]:
    """Split markdown into overlapping chunks, attaching heading_path metadata."""
    paragraphs = _split_paragraphs(content)
    heading_paths = _build_heading_path(paragraphs)

    chunk_idx = 0
    result: list[Chunk] = []

    for para, hpath in zip(paragraphs, heading_paths):
        is_heading = bool(HEADING_RE.match(para))
        sub_chunks = _chunk_text(para)
        for sub in sub_chunks:
            result.append(
                Chunk(
                    chunk_id=f"c{chunk_idx}",
                    text=sub,
                    metadata={
                        "heading_path": hpath,
                        "is_heading": is_heading,
                    },
                )
            )
            chunk_idx += 1

    return result


def _first_sentence(text: str) -> str:
    """Return the first sentence (or up to 200 chars) of text."""
    # Strip markdown code/emphasis markers for a clean object
    clean = re.sub(r"[`*_#]", "", text).strip()
    # Split on sentence-ending punctuation
    m = re.search(r"[.!?]", clean)
    if m:
        return clean[: m.start() + 1].strip()
    return clean[:200].strip()


def extract_facts(content: str, chunks: list[Chunk] | None = None) -> list[Fact]:
    """Extract heading-based subject/predicate/object facts with chunk linkage."""
    paragraphs = _split_paragraphs(content)
    heading_paths = _build_heading_path(paragraphs)

    # Build heading→chunk_ids index from chunks metadata
    heading_to_chunks: dict[str, list[str]] = {}
    if chunks:
        for chunk in chunks:
            hpath = chunk.metadata.get("heading_path", [])
            if hpath:
                subject = hpath[-1]
                heading_to_chunks.setdefault(subject, []).append(chunk.chunk_id)

    facts: list[Fact] = []
    seen_subjects: set[str] = set()

    for para, hpath in zip(paragraphs, heading_paths):
        if HEADING_RE.match(para):
            continue
        if not hpath:
            continue

        subject = hpath[-1]
        if subject in seen_subjects:
            continue
        seen_subjects.add(subject)

        obj = _first_sentence(para)
        if obj:
            source_chunk_ids = heading_to_chunks.get(subject, [])
            facts.append(Fact(
                subject=subject,
                predicate="discusses",
                object=obj,
                source_chunk_ids=source_chunk_ids,
            ))

    return facts
