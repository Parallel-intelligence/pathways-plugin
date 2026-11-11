#!/usr/bin/env python3
"""Merge each document's part outputs into one findings file, verify excerpts, apply limits.

Reads landscape/evidence/parts-out/<doc>.pNN.json, writes landscape/evidence/findings/<doc>.json.
- Excerpts are checked against the part's text (whitespace, case, quotes and dashes
  normalised). An unverified finding is kept but marked, and adds no height.
- Market evidence is limited per document (settings mention.maxPerMarketPerDocument /
  maxPerIndustryPerDocument): the strongest verified findings are kept.
- Grade: a demand survey keeps its source grade; otherwise the grade most parts gave (a tie goes to the better).

    python3 -I packages/landscape/build.py <working-folder> merge
"""
import json
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


def norm(text):
    text = text.lower().replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl")
    text = re.sub(r"[‘’‚′`]", "'", text)
    text = re.sub(r"[“”„″]", '"', text)
    text = re.sub(r"[‐-―−]", "-", text)
    text = re.sub(r"-\s*\n\s*", "-", text)  # words broken across lines
    return re.sub(r"\s+", " ", text).strip()


docs = json.loads((EV / "docs-v3.json").read_text())
report = []
for d in docs:
    parts = sorted(EV.glob(f"parts-out/{safe_name(d['id'])}.p*.json"))
    if len(parts) < d["parts"]:
        report.append((d["id"], f"MISSING parts: {len(parts)}/{d['parts']}"))
        if not parts:
            continue
    grades, docblock, market, proposals, shaping = [], None, [], [], []
    checked = verified = 0
    for path in parts:
        out = json.loads(path.read_text())
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
