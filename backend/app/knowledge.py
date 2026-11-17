import math
import re
import tomllib
from collections import Counter
from pathlib import Path

from pydantic import BaseModel

KNOWLEDGE_VERSION = "1"
TOKEN_GROUPS = re.compile(r"[a-z][a-z0-9_]*|[\u3400-\u9fff]+", re.I)


class KnowledgeEntry(BaseModel):
    id: str
    title: str
    keywords: str
    source: str
    applicable: str
    dataset_id: str
    wrong_sql: str
    example_sql: str
    rule: str
    sqlite_version: str = "3.46+"


def read_entry(path: Path) -> KnowledgeEntry:
    _, header, rule = path.read_text(encoding="utf-8").split("+++", 2)
    return KnowledgeEntry(**tomllib.loads(header), rule=rule.strip())


def tokens(text: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for token in TOKEN_GROUPS.findall(text.lower()):
        if token.isascii() or len(token) == 1:
            counts[token] += 1
        else:
            counts.update(token[index:index + 2] for index in range(len(token) - 1))
    return counts


ENTRIES = [read_entry(path) for path in sorted(Path(__file__).with_name("knowledge").glob("SQL-*.md"))]
INDEX = [(entry, tokens(f"{entry.title} {entry.keywords} {entry.rule}")) for entry in ENTRIES]
LENGTHS = [sum(terms.values()) for _, terms in INDEX]
AVG_LENGTH = sum(LENGTHS) / max(1, len(INDEX))
FREQUENCIES = Counter(term for _, terms in INDEX for term in terms)


def search_knowledge(query: str) -> list[KnowledgeEntry]:
    terms = tokens(query)
    ranked = []
    for (entry, counts), length in zip(INDEX, LENGTHS, strict=True):
        norm = 1.2 * (0.25 + 0.75 * length / AVG_LENGTH)
        score = 0.0
        for term in counts.keys() & terms.keys():
            documents = FREQUENCIES[term]
            idf = math.log1p((len(INDEX) - documents + 0.5) / (documents + 0.5))
            score += idf * counts[term] * 2.2 / (counts[term] + norm)
        if score > 0:
            ranked.append((-score, entry.id, entry))
    return [entry for _, _, entry in sorted(ranked)[:3]]
