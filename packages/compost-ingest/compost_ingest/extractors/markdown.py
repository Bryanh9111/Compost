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


def _extract_sentences(text: str, max_sentences: int = 3) -> str:
    """Return up to max_sentences from text, cleaned of markdown formatting."""
    clean = re.sub(r"[`*_#]", "", text).strip()
    sentences: list[str] = []
    for m in re.finditer(r"[^.!?]+[.!?]", clean):
        sentences.append(m.group().strip())
        if len(sentences) >= max_sentences:
            break
    if not sentences:
        return clean[:300].strip()
    return " ".join(sentences)


# Predicate inference from heading text and paragraph content
_PREDICATE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(install|setup|set up|getting started)\b", re.I), "requires_setup"),
    (re.compile(r"\b(configur|option|setting|parameter)\b", re.I), "configures"),
    (re.compile(r"\b(defin|what is|overview|introduc|describe)\b", re.I), "defines"),
    (re.compile(r"\b(architec|design|structur|layer|component)\b", re.I), "has_architecture"),
    (re.compile(r"\b(depend|require|prerequisit|need)\b", re.I), "depends_on"),
    (re.compile(r"\b(deprecat|remov|drop|obsolet)\b", re.I), "deprecates"),
    (re.compile(r"\b(error|bug|issue|problem|fix|troubleshoot)\b", re.I), "addresses_issue"),
    (re.compile(r"\b(example|usage|how to|tutorial|guide)\b", re.I), "demonstrates"),
    (re.compile(r"\b(api|endpoint|route|method|function|interface)\b", re.I), "exposes_api"),
    (re.compile(r"\b(test|spec|assert|expect|coverage)\b", re.I), "tests"),
    (re.compile(r"\b(perform|optim|fast|slow|latency|throughput)\b", re.I), "affects_performance"),
    (re.compile(r"\b(secur|auth|permission|token|credential)\b", re.I), "secures"),
    (re.compile(r"\b(migrat|upgrad|version|changelog)\b", re.I), "migrates"),
    (re.compile(r"\b(stor|databas|table|schema|sql|query)\b", re.I), "stores_data"),
]


def _infer_predicate(heading: str, paragraph: str) -> str:
    """Infer a meaningful predicate from heading + paragraph text."""
    combined = f"{heading} {paragraph[:200]}"
    for pattern, predicate in _PREDICATE_PATTERNS:
        if pattern.search(combined):
            return predicate
    return "describes"


def extract_facts(content: str, chunks: list[Chunk] | None = None) -> list[Fact]:
    """Extract heading-based facts with inferred predicates and richer objects."""
    paragraphs = _split_paragraphs(content)
    heading_paths = _build_heading_path(paragraphs)

    # Build heading->chunk_ids index from chunks metadata
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

        obj = _extract_sentences(para)
        if obj:
            predicate = _infer_predicate(subject, para)
            source_chunk_ids = heading_to_chunks.get(subject, [])
            facts.append(Fact(
                subject=subject,
                predicate=predicate,
                object=obj,
                source_chunk_ids=source_chunk_ids,
            ))

    return facts
