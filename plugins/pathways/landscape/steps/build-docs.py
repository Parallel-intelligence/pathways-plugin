#!/usr/bin/env python3
"""The document view's data: every document, and the documents behind each peak.

Reads the same findings and settings as build-map.py and uses the same height rule, so a
document's "adds" is exactly its share of the peak's height. build-map.py runs it at the end;
it can also run alone after a map build.

    python3 -I packages/landscape/build.py <working-folder> docs

Writes landscape/map/docs.json:
  docs:  {id: {title, publisher, year, kind, grade, gradeReason, sample, geography,
               summary, cover, internal, peaks}}
  peaks: {industry or market slug: [{doc, adds, share, excerpts: [...]}]}, biggest first
  heights: {industry or market slug: height}, as build-map.py gave it

Internal documents (licensed or internal-use sources) keep their contribution but carry no cover and no excerpts.
Covers: landscape/map/covers/<id>.jpg, made beforehand from each document's first page. Summaries:
landscape/map/doc-summaries/*.json.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

if "ROOT" not in globals():  # ROOT (the working folder) and RULES come from build.py
    raise SystemExit("run this through build.py: python3 -I packages/landscape/build.py <working-folder> docs")
FINDINGS = ROOT / "landscape" / "evidence" / "findings"
MAP = ROOT / "landscape" / "map"
SETTINGS = json.loads((RULES / "settings.json").read_text())
GRADE_WEIGHT = SETTINGS["height"]["gradeWeight"]
CAP = SETTINGS["height"]["perDocumentCap"]
MIN_SALIENCE = SETTINGS["mention"]["minSalience"]
MUST_VERIFY = SETTINGS["mention"].get("excerptMustVerify", True)
INTERNAL = internal_sources()   # licensed or internal-use sources (build.py): count, never shown

bundle = json.loads((MAP / "bundle.json").read_text())
market_industry = {r["slug"]: ind for ind, rows in bundle["subthemes"].items() for r in rows}
market_title = {r["slug"]: r["title"] for rows in bundle["subthemes"].values() for r in rows}
heights = {t["slug"]: t["frequency"] for t in bundle["themes"]}
heights.update({r["slug"]: r["mentions"] for rows in bundle["subthemes"].values() for r in rows})

doc_meta = json.loads((ROOT / "landscape" / "evidence" / "doc-meta.json").read_text())
summaries = {}
for path in sorted((MAP / "doc-summaries").glob("*.json")):
    summaries.update(json.loads(path.read_text()))

docs, findings, proposals = {}, [], {}
for path in sorted(FINDINGS.glob("*.json")):
    data = json.loads(path.read_text())
    doc = data["doc"]
    docs[doc["id"]] = doc
    findings += [{**f, "doc": doc["id"]} for f in data["findings"]]
    proposals.update({f["id"]: {**f, "doc": doc["id"]} for f in data.get("proposals", [])})

# Markets added from evidence that made it onto the map carry their proposal findings.
for m in json.loads((ROOT / "landscape" / "minted-markets.json").read_text())["markets"]:
    if m["slug"] in market_industry:
        findings += [{**proposals[ref], "level": "market", "slug": m["slug"]} for ref in m["evidence"] if ref in proposals]


def internal(doc):
    return any(p in (doc.get("publisher") or "") for p in INTERNAL["publishers"]) or doc["id"].startswith(tuple(INTERNAL["idPrefixes"]))


def verified(f):
    return f.get("verified") or not MUST_VERIFY


def counts(f):
    return f["salience"] >= MIN_SALIENCE and verified(f) and GRADE_WEIGHT[docs[f["doc"]]["grade"]]


sal = defaultdict(float)              # (peak, doc) -> salience that counts
shown = defaultdict(list)             # (peak, doc) -> verified findings for the panel
for f in findings:
    ind = f["slug"] if f["level"] == "industry" else market_industry.get(f["slug"])
    if not ind:
        continue
    peaks = [ind] + ([f["slug"]] if f["level"] == "market" else [])
    for peak in peaks:
        if verified(f):
            shown[peak, f["doc"]].append(f)
        if counts(f):
            sal[peak, f["doc"]] += f["salience"]


def adds(peak, doc_id):
    s = sal.get((peak, doc_id), 0.0)
    return GRADE_WEIGHT[docs[doc_id]["grade"]] * CAP * (1 - math.exp(-s / CAP))


def excerpt(f):
    return {"id": f["id"], "text": f.get("excerpt") or f["summary"], "summary": f["summary"],
            "page": f.get("page"), "salience": f["salience"], "counts": bool(counts(f)),
            "market": market_title.get(f["slug"]) if f["level"] == "market" else None}


peaks = defaultdict(list)
for peak, doc_id in sorted(set(shown) | set(sal)):
    a = adds(peak, doc_id)
    fs = sorted(shown.get((peak, doc_id), []), key=lambda f: -f["salience"])
    if not fs and not a:
        continue
    peaks[peak].append({
        "doc": doc_id,
        "adds": round(a, 3),
        "share": round(a / heights[peak], 3) if heights.get(peak) else 0,
        "excerpts": [] if internal(docs[doc_id]) else [excerpt(f) for f in fs],
        "excerptCount": len(fs),
        "markets": sorted({f["slug"] for f in fs if f["level"] == "market"}),
        "general": any(f["level"] == "industry" for f in fs),
    })
for rows in peaks.values():
    rows.sort(key=lambda r: (-r["adds"], -(docs[r["doc"]]["year"] or 0)))

peak_count = defaultdict(int)
for rows in peaks.values():
    for r in rows:
        peak_count[r["doc"]] += 1

library = {}
for doc_id, d in docs.items():
    cover = MAP / "covers" / f"{safe_name(doc_id)}.jpg"
    library[doc_id] = {
        "title": d["title"], "publisher": d["publisher"], "year": d["year"], "kind": d["kind"],
        "grade": d["grade"], "gradeReason": d["gradeReason"], "sample": d["sample"],
        "geography": d["geography"], "summary": summaries.get(doc_id, ""),
        "cover": f"covers/{doc_id}.jpg" if cover.exists() and not internal(d) else None,
        "internal": internal(d), "peaks": peak_count[doc_id],
        "url": None if internal(d) else (d.get("url") or doc_meta.get(doc_id, {}).get("url")),
        "findings": sum(1 for f in findings if f["doc"] == doc_id and verified(f)),
    }

inside(MAP / "docs.json").write_text(json.dumps({"docs": library, "peaks": peaks, "heights": heights}, indent=1, ensure_ascii=False) + "\n")

# Check: per-document adds must sum to the height build-map.py gave each peak.
off = [(p, heights[p], round(sum(r["adds"] for r in rows), 2)) for p, rows in peaks.items()
       if abs(heights.get(p, 0) - sum(r["adds"] for r in rows)) > 0.02]
print(f"{len(library)} documents ({sum(1 for d in library.values() if d['cover'])} with covers, "
      f"{sum(1 for d in library.values() if d['summary'])} with summaries), {len(peaks)} peaks with documents")
print("heights match build-map.py" if not off else f"MISMATCH on {len(off)} peaks: {off[:5]}")
