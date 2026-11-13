#!/usr/bin/env python3
"""Merge each document's part outputs into one findings file, verify excerpts, apply limits.

Reads landscape/evidence/parts-out/<doc>.pNN.json, writes landscape/evidence/findings/<doc>.json.
- Excerpts are checked against the part's text (whitespace, case, quotes and dashes
  normalised). An unverified finding is kept but marked, and adds no height.
- Market evidence is limited per document (settings mention.maxPerMarketPerDocument /
  maxPerIndustryPerDocument): the strongest verified findings are kept.
- Grade: a demand survey keeps its source grade; otherwise the grade most parts gave (a tie goes to the better).
- PATHWAYS_MERGE_IDS (comma-separated document ids), when set, limits the merge to those documents, and each only
  once every part is read: Analyse sets it to the documents its run read in full, so earlier findings stay as they are.
- A part output whose doc.id isn't the document it's filed under (or that isn't a JSON object with a doc block) is
  never merged into it: it's left out, as if missing, and reported.

    python3 -I packages/landscape/build.py <working-folder> merge
"""
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

if "ROOT" not in globals():  # ROOT (the working folder) and RULES come from build.py
    raise SystemExit("run this through build.py: python3 -I packages/landscape/build.py <working-folder> merge")
EV = ROOT / "landscape" / "evidence"
SETTINGS = RULE_SETTINGS()  # the rules, with the Settings page's saved ones (build.py rule_settings())
MAX_MARKET = SETTINGS["mention"]["maxPerMarketPerDocument"]
MAX_INDUSTRY = SETTINGS["mention"]["maxPerIndustryPerDocument"]
structure = json.loads((ROOT / "landscape" / "structure.json").read_text())
INDUSTRIES = {i["slug"] for i in structure["industries"]}
MARKETS = {m["slug"] for m in structure["markets"]}
RANK = {"keep": 2, "weak": 1, "drop": 0, "panel": 0}


def part_output(path, ids):
    """A part output, if it's the document it's filed under (its doc.id one of `ids`), else None."""
    try:
        out = json.loads(path.read_text())
    except ValueError:
        return None
    ok = isinstance(out, dict) and isinstance(out.get("doc"), dict) and out["doc"].get("id") in ids and isinstance(out.get("findings"), list)
    return out if ok else None


def norm(text):
    text = text.lower().replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl")
    text = re.sub(r"[‘’‚′`]", "'", text)
    text = re.sub(r"[“”„″]", '"', text)
    text = re.sub(r"[‐-―−]", "-", text)
    text = re.sub(r"-\s*\n\s*", "-", text)  # words broken across lines
    return re.sub(r"\s+", " ", text).strip()


docs = json.loads((EV / "docs-v3.json").read_text())
ONLY = os.environ.get("PATHWAYS_MERGE_IDS")
if ONLY is not None:
    wanted = {each for each in ONLY.split(",") if each}
    docs = [d for d in docs if d["id"] in wanted]
report = []
for d in docs:
    outs, refused = [], []
    for path in sorted(EV.glob(f"parts-out/{safe_name(d['id'])}.p*.json")):
        out = part_output(path, {d["id"]})
        (outs if out is not None else refused).append((path, out))
    if refused:
        report.append((d["id"], f"REFUSED part outputs not filed for this document: {', '.join(path.name for path, _ in refused)}"))
    parts = [path for path, _ in outs]
    if len(parts) < d["parts"]:
        report.append((d["id"], f"MISSING parts: {len(parts)}/{d['parts']}"))
        if not parts or ONLY is not None:  # a limited merge writes no findings from part of a document
            continue
    grades, docblock, market, proposals, shaping = [], None, [], [], []
    checked = verified = 0
    for path, out in outs:
        docblock = docblock or out["doc"]
        grades.append(out["doc"].get("grade", "weak"))
        source = norm((EV / "parts" / (path.stem + ".txt")).read_text(errors="ignore"))
        for f in out["findings"]:
            excerpt = norm(f.get("excerpt") or "")
            f["verified"] = bool(excerpt) and excerpt in source
            checked += 1
            verified += f["verified"]
            if f["kind"] == "market":
                slug = f.get("slug")
                if slug in MARKETS or slug in INDUSTRIES:
                    f["level"] = "market" if slug in MARKETS else "industry"
                    market.append(f)
                else:
                    f["slug"] = None
                    proposals.append(f)
            else:
                f["affects"] = [a for a in f.get("affects", []) if a in MARKETS or a in INDUSTRIES]
                shaping.append(f)
    # Limits: strongest verified first.
    kept, per_slug = [], defaultdict(int)
    for f in sorted(market, key=lambda f: (not f["verified"], -f["salience"])):
        limit = MAX_MARKET if f["level"] == "market" else MAX_INDUSTRY
        if per_slug[f["slug"]] < limit:
            per_slug[f["slug"]] += 1
            kept.append(f)
    common = Counter(grades).most_common()
    top = [g for g, n in common if n == common[0][1]]
    grade = d["sourceGrade"] if d.get("demandSurvey") and d.get("sourceGrade") else max(top, key=RANK.get)
    if "panel" in grades:  # a panel document stays panel whatever its parts say: it never adds height
        grade = "panel"
    doc = {**docblock, "id": d["id"], "title": d["title"], "grade": grade, "parts": d["parts"],
           "demandSurvey": d.get("demandSurvey", False), "url": d.get("url"), "partGrades": grades}
    doc.pop("part", None)
    inside(EV / "findings" / f"{safe_name(d['id'])}.json").write_text(json.dumps(
        {"doc": doc, "findings": kept, "proposals": proposals, "shaping": shaping}, indent=2, ensure_ascii=False) + "\n")
    report.append((d["id"], f"{grade:5} market {len(kept):3} (of {len(market)}) proposals {len(proposals):2} shaping {len(shaping):2} verified {verified}/{checked}"))

for doc_id, line in report:
    print(f"{doc_id[:55]:55} {line}")
total = [r for r in report if "verified" in r[1]]
print(f"\n{len(total)} documents merged")
