"""Web content extractor using trafilatura for HTML boilerplate removal."""

from __future__ import annotations

import trafilatura
from compost_ingest.extractors.markdown import Chunk, Fact, extract_chunks, extract_facts


def extract_from_html(html: str, source_url: str | None = None) -> tuple[str, list[Chunk], list[Fact]]:
    """Extract clean text from HTML, then chunk and extract facts.

    Returns (clean_text, chunks, facts).
    Falls back to basic tag stripping if trafilatura returns None.
    """
    clean = trafilatura.extract(
        html,
        url=source_url,
        include_comments=False,
        include_tables=True,
        favor_precision=True,
        output_format="txt",
    )

    if not clean:
        # Fallback: strip tags manually
        import re
        clean = re.sub(r"<[^>]+>", "", html)
        clean = re.sub(r"\s+", " ", clean).strip()

    # Reuse markdown chunking/fact extraction on the clean text
    chunks = extract_chunks(clean)
    facts = extract_facts(clean, chunks)

    return clean, chunks, facts
