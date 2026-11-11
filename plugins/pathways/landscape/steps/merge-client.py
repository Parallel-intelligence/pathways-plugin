#!/usr/bin/env python3
"""Merge a client's part outputs into one findings file per document (rules.md section 5b).

Reads client/<client>/docs-v2.json and client/<client>/parts-out/<doc>.pNN.json, checks each
excerpt against client/<client>/parts/<doc>.pNN.txt, and writes client/<client>/findings-v2/<doc>.json:
  findings   market evidence placed on a market or industry: adds height to the client's landscape
  proposals  market or presence evidence for a market that isn't in the structure yet
  shaping    enablers and context
  brand      presence, uniqueness, project and customer findings: the client layers, never height
Market evidence keeps the per-document limits in settings.json; presence keeps at most 3 per peak.

    PATHWAYS_CLIENT=<client> python3 -I packages/landscape/build.py <working-folder> client-merge
"""
import json
import re
from collections import Counter, defaultdict

if "ROOT" not in globals():  # ROOT, RULES and CLIENT come from build.py
    raise SystemExit("run this through build.py")
if not CLIENT:
    raise SystemExit("set PATHWAYS_CLIENT to the client's folder name under client/")
BASE = ROOT / "client" / CLIENT
SETTINGS = RULE_SETTINGS()  # the rules, with the Settings page's saved ones (build.py rule_settings())
MAX_MARKET = SETTINGS["mention"]["maxPerMarketPerDocument"]
MAX_INDUSTRY = SETTINGS["mention"]["maxPerIndustryPerDocument"]
MAX_PRESENCE = 3
structure = json.loads((ROOT / "landscape" / "structure.json").read_text())
INDUSTRIES = {i["slug"] for i in structure["industries"]}
MARKETS = {m["slug"] for m in structure["markets"]}
RANK = {"keep": 2, "weak": 1, "drop": 0, "panel": 0}
BRAND_KINDS = {"presence", "uniqueness", "project", "customer"}


def norm(text):
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text)  # stray control characters from conversion
    text = text.lower().replace("­", "").replace("ﬁ", "fi").replace("ﬂ", "fl")
    text = re.sub(r"[‘’‚′`]", "'", text)
    text = re.sub(r"[“”„″]", '"', text)
    text = re.sub(r"[‐-―−]", "-", text)
    text = re.sub(r"-\s*\n\s*", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def limited(items, cap_for):
    """Strongest verified first, up to the cap per peak. A product category on an industry counts
    as its own peak, as a market would (it stands in for markets the structure doesn't have yet).
    The key's name follows the extraction output already in working folders."""
    kept, used = [], defaultdict(int)
    for f in sorted(items, key=lambda f: (not f["verified"], -f["salience"])):
        key = (f["slug"], f.get("apparelCategory"))
        if used[key] < cap_for(f):
            used[key] += 1
            kept.append(f)
    return kept


docs = json.loads((BASE / "docs-v2.json").read_text())
out_dir = inside(BASE / "findings-v2")
written = set()
out_dir.mkdir(exist_ok=True)
report = []
for d in docs:
    parts = sorted(BASE.glob(f"parts-out/{safe_name(d['id'])}.p*.json"))
    if not parts:
        continue
    if len(parts) < d["parts"]:
        report.append((d["id"], f"MISSING parts {len(parts)}/{d['parts']}"))
    grades, docblock = [], None
    market, presence, proposals, shaping, brand = [], [], [], [], []
    checked = verified = 0
    for path in parts:
        out = json.loads(path.read_text())
        docblock = docblock or out["doc"]
        grades.append(out["doc"].get("grade", "weak"))
        source = norm((BASE / "parts" / (path.stem + ".txt")).read_text(errors="ignore"))
        for f in out["findings"]:
            excerpt = norm(f.get("excerpt") or "")
            f["verified"] = bool(excerpt) and excerpt in source
            checked += 1
            verified += f["verified"]
            kind, slug = f.get("kind"), f.get("slug")
            if kind in ("market", "presence"):
                if slug in MARKETS or slug in INDUSTRIES:
                    f["level"] = "market" if slug in MARKETS else "industry"
                    (market if kind == "market" else presence).append(f)
                else:
                    f["slug"] = None
                    proposals.append(f)
            elif kind in BRAND_KINDS:
                for key in ("slug",):
                    if f.get(key) not in MARKETS | INDUSTRIES:
                        f[key] = None
                f["slugs"] = [s for s in f.get("slugs", []) if s in MARKETS | INDUSTRIES]
                brand.append(f)
            else:
                f["affects"] = [a for a in f.get("affects", []) if a in MARKETS | INDUSTRIES]
                shaping.append(f)
    market = limited(market, lambda f: MAX_MARKET if f["level"] == "market" else MAX_INDUSTRY)
    brand = limited(presence, lambda f: MAX_PRESENCE) + brand
    common = Counter(grades).most_common()
    grade = max([g for g, n in common if n == common[0][1]], key=RANK.get)
    if "panel" in grades:  # a panel document stays panel whatever its parts say: it never adds height
        grade = "panel"
    doc = {**docblock, "id": d["id"], "title": d["title"], "grade": grade, "parts": d["parts"],
           "publisher": docblock.get("producer") or CLIENT, "source": f"client:{CLIENT}",
           "demandSurvey": False, "url": None, "partGrades": grades}
    doc.pop("part", None)
    # A document id built from a file name can carry a person's name: docs-v2.json may give a
    # neutral "alias", which replaces the id in the output and in every finding id.
    alias = d.get("alias")
    if alias:
        safe_name(alias)
        for f in market + proposals + shaping + brand:
            f["id"] = alias + f["id"][len(d["id"]):] if f["id"].startswith(d["id"]) else f"{alias}-{f['id']}"
        doc["id"] = alias
        doc.pop("partGrades", None)
    if doc["id"] in written:  # two documents under one id or alias would overwrite each other
        raise SystemExit(f"two client documents would both be written as {doc['id']}: give one a different alias")
    written.add(doc["id"])
    inside(out_dir / f"{safe_name(doc['id'])}.json").write_text(json.dumps(
        {"doc": doc, "findings": market, "proposals": proposals, "shaping": shaping, "brand": brand},
        indent=2, ensure_ascii=False) + "\n")
    kinds = Counter(f["kind"] for f in brand)
    report.append((d["id"], f"{grade:5} market {len(market):3} brand {dict(kinds)} proposals {len(proposals)} verified {verified}/{checked}"))

for doc_id, line in report:
    print(f"{doc_id[:50]:50} {line}")
print(f"\n{sum(1 for r in report if 'verified' in r[1])} documents merged into client/{CLIENT}/findings-v2/")
