"""LLM-based fact extraction: uses local Ollama to extract structured SPO triples from chunks."""

from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Any


@dataclass
class LLMFact:
    subject: str
    predicate: str
    object: str
    confidence: float = 0.8
    source_chunk_ids: list[str] = field(default_factory=list)


OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("COMPOST_LLM_MODEL", "gemma3:4b")

EXTRACTION_PROMPT_TEMPLATE = """Extract structured facts from the following text as JSON.
Each fact should be a triple: subject, predicate, object.

Rules:
- Subject: a specific entity, concept, or component name (not a section heading)
- Predicate: a verb phrase describing the relationship (e.g., "uses", "requires", "stores_in", "runs_on", "depends_on", "produces", "exposes")
- Object: the target entity or a concise factual statement (max 100 chars)
- Extract 1-5 facts per chunk. Only extract facts actually stated in the text.
- Confidence: 0.5-1.0 based on how explicitly the fact is stated
- Skip facts about document structure (e.g., "this section discusses...")

Output JSON array only, no markdown fences:
[{{"subject": "...", "predicate": "...", "object": "...", "confidence": 0.9}}]

Text:
"""


def _call_ollama(prompt: str, model: str = OLLAMA_MODEL) -> str | None:
    """Call Ollama generate API. Returns response text or None on failure."""
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 512},
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("response", "")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def _parse_facts_json(raw: str) -> list[dict[str, Any]]:
    """Parse LLM output as JSON array of facts. Tolerant of markdown fences."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        # Try to find a JSON array in the text
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    return []


def extract_facts_llm(
    chunks: list[dict[str, Any]],
    max_chunks: int = 20,
) -> list[LLMFact]:
    """Extract facts from chunks using local Ollama LLM.

    Processes up to max_chunks. Each chunk gets one LLM call.
    Falls back gracefully: returns empty list if Ollama is unavailable.
    """
    facts: list[LLMFact] = []
    seen: set[tuple[str, str, str]] = set()

    for chunk in chunks[:max_chunks]:
        text = chunk.get("text", "")
        chunk_id = chunk.get("chunk_id", "")
        if len(text) < 30:
            continue

        prompt = EXTRACTION_PROMPT_TEMPLATE + text[:1500]
        response = _call_ollama(prompt)
        if not response:
            continue

        raw_facts = _parse_facts_json(response)
        for rf in raw_facts:
            subj = str(rf.get("subject", "")).strip()
            pred = str(rf.get("predicate", "")).strip()
            obj = str(rf.get("object", "")).strip()
            conf = float(rf.get("confidence", 0.8))

            if not subj or not pred or not obj:
                continue
            if len(subj) > 200 or len(obj) > 300:
                continue

            key = (subj.lower(), pred.lower(), obj.lower()[:50])
            if key in seen:
                continue
            seen.add(key)

            facts.append(LLMFact(
                subject=subj,
                predicate=pred,
                object=obj[:300],
                confidence=min(max(conf, 0.3), 1.0),
                source_chunk_ids=[chunk_id],
            ))

    return facts
