#!/usr/bin/env python3
"""Turn structure.json + evidence findings into the data the map reads.

Writes landscape/map/bundle.json and landscape/map/evidence/<industry>.json in the
shape of the earlier prototype's map page (LandscapeBundle / ThemeEvidence). Structure only:
no brands, rules or demand, so the preview shows industries and markets alone.

The rules and their numbers: packages/landscape/rules/rules.md and settings.json.
Change a number in settings.json and rerun: the build prints which peaks moved.

    python3 -I packages/landscape/build.py <working-folder> map
"""
import json
import math
import os
import subprocess
from collections import defaultdict
from pathlib import Path

if "ROOT" not in globals():  # ROOT (the working folder) and RULES come from build.py
    raise SystemExit("run this through build.py: python3 -I packages/landscape/build.py <working-folder> map")
FINDINGS = ROOT / "landscape" / "evidence" / "findings"
OUT = ROOT / "landscape" / "map"
SETTINGS = json.loads((RULES / "settings.json").read_text())
GRADE_WEIGHT = SETTINGS["height"]["gradeWeight"]
CAP = SETTINGS["height"]["perDocumentCap"]  # the most one document can add to one peak
MIN_SALIENCE = SETTINGS["mention"]["minSalience"]  # below this a mention is a name-drop: panel only
MUST_VERIFY = SETTINGS["mention"].get("excerptMustVerify", True)  # unverified excerpts add no height
# The context factors come from Cloudflare (Fetch latest saves them in the working folder): they were worked out
# from the client's documents, so they're never in the public plugin.
FACTORS_FILE = ROOT / "landscape" / "context-factors.json"
if not FACTORS_FILE.is_file():
    raise SystemExit("the context factors aren't in the working folder: sign in, press Fetch latest, then try again")
FACTORS = {f["slug"]: f["title"] for f in json.loads(FACTORS_FILE.read_text())["factors"]}
PREVIOUS = OUT / "bundle.json"
previous = {t["slug"]: t["frequency"] for t in json.loads(PREVIOUS.read_text())["themes"]} if PREVIOUS.exists() else {}

structure = json.loads((ROOT / "landscape" / "structure.json").read_text())

# Curation: the team's accepted renames, merges, moves, hides and added markets. Each is a
# decision record in landscape/decisions/; the curate tool (the cms repo,
# packages/curation, still on its spike branch) applies them and says where removed items' evidence goes.
DECISIONS = ROOT / "landscape" / "decisions"
PREVIEW = [x for x in os.environ.get("PATHWAYS_PREVIEW", "").split(",") if x]
curation = {"applied": [], "remap": {"markets": {}, "industries": {}}}
if DECISIONS.is_dir() and any(DECISIONS.glob("*.json")):
    tool = os.environ.get("PATHWAYS_CURATE")
    if not tool:
        raise SystemExit("landscape/decisions/ has decisions: build with `curate rebuild` (or set PATHWAYS_CURATE to curate.mjs)")
    cmd = ["node", tool, "effective", "--workspace", str(ROOT)] + [a for x in PREVIEW for a in ("--preview", x)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr.strip() or "curate effective failed")
    curation = json.loads(result.stdout)
    structure = curation["structure"]
REMAP_MARKET, REMAP_INDUSTRY = curation["remap"]["markets"], curation["remap"]["industries"]
moved_findings = dropped_findings = 0


def place(f):
    """Where a finding's evidence goes after curation: unchanged, another peak, or nowhere (None)."""
    global moved_findings, dropped_findings
    table = REMAP_MARKET if f["level"] == "market" else REMAP_INDUSTRY
    if f["slug"] not in table:
        return f
    to = table[f["slug"]]
    if to is None:
        dropped_findings += 1
        return None
    moved_findings += 1
    return {**f, "level": to["level"], "slug": to["slug"]} if f["level"] == "market" else {**f, "slug": to}

sectors = {s["slug"]: s for s in structure["sectors"]}
industries = {i["slug"]: i for i in structure["industries"]}
markets = {m["slug"]: m for m in structure["markets"] if m.get("origin") != "curation"}

docs = {}
findings, proposals, shaping = [], {}, []
for path in sorted(FINDINGS.glob("*.json")):
    data = json.loads(path.read_text())
    doc = data["doc"]
    docs[doc["id"]] = doc
    for f in data.get("proposals", []):
        proposals[f["id"]] = {**f, "doc": doc["id"]}
    for f in data.get("shaping", []):
        affects = [t for t in f.get("affects", []) if t not in REMAP_MARKET or (REMAP_MARKET[t] or {}).get("level") == "market"]
        affects = [REMAP_MARKET[t]["slug"] if t in REMAP_MARKET else t for t in affects]
        shaping.append({**f, "affects": affects, "doc": doc["id"]})
    for f in data["findings"]:
        f = place(f)
        if f is None:
            continue
        if f["level"] == "market" and f["slug"] not in markets:
            raise SystemExit(f"{path.name}: unknown market {f['slug']}")
        if f["level"] == "industry" and f["slug"] not in industries:
            raise SystemExit(f"{path.name}: unknown industry {f['slug']}")
        findings.append({**f, "doc": doc["id"]})


# Markets added from evidence (rules.md section 4): check each against the rule, then add it.
# Each lists the ids of the proposal findings that back it.
MINTED = json.loads((ROOT / "landscape" / "minted-markets.json").read_text())["markets"]
# Markets the team added by decision go through the same evidence rule.
MINTED += [m for m in structure["markets"] if m.get("origin") == "curation"]
unplaced = proposals


def counts(f):
    return f["salience"] >= MIN_SALIENCE and (f.get("verified", True) or not MUST_VERIFY) and GRADE_WEIGHT[docs[f["doc"]]["grade"]]


rule = SETTINGS["newMarket"]
minted_slugs = set()
for m in MINTED:
    if m["industry"] not in industries:
        raise SystemExit(f"minted market {m['slug']}: unknown industry {m['industry']}")
    missing = [ref for ref in m["evidence"] if ref not in unplaced]
    if missing:
        print(f"WARNING: {m['title']}: evidence not found ({', '.join(missing[:3])}); left off the map")
        continue
    mentions = [unplaced[ref] for ref in m["evidence"]]
    real = [u for u in mentions if counts(u) and not docs[u["doc"]].get("demandSurvey")]
    strong_per_doc = defaultdict(int)
    for u in real:
        if u["salience"] >= rule["strongSalience"]:
            strong_per_doc[u["doc"]] += 1
    passes = len({u["doc"] for u in real}) >= rule["minDocuments"] or any(
        n >= rule["orStrongMentionsInOneDocument"] for n in strong_per_doc.values())
    if not passes:
        print(f"WARNING: {m['title']} no longer meets the new-market rule; left off the map")
        continue
    markets[m["slug"]] = {**m, "minted": True}
    minted_slugs.add(m["slug"])
    for u in mentions:
        findings.append({**u, "level": "market", "slug": m["slug"]})


def industry_of(f):
    return f["slug"] if f["level"] == "industry" else markets[f["slug"]]["industry"]


# Salience per (peak, document), the documents behind each peak, and every finding for the panel.
ind_sal, mkt_sal = defaultdict(float), defaultdict(float)
ind_docs, mkt_docs = defaultdict(set), defaultdict(set)
ind_findings, mkt_findings = defaultdict(list), defaultdict(list)
for f in findings:
    ind = industry_of(f)
    ind_findings[ind].append(f)
    if f["level"] == "market":
        mkt_findings[f["slug"]].append(f)
    if counts(f):
        ind_sal[ind, f["doc"]] += f["salience"]
        ind_docs[ind].add(f["doc"])
        if f["level"] == "market":
            mkt_sal[f["slug"], f["doc"]] += f["salience"]
            mkt_docs[f["slug"]].add(f["doc"])


def height(sal, peak, doc_ids):
    return round(sum(GRADE_WEIGHT[docs[d]["grade"]] * CAP * (1 - math.exp(-sal[peak, d] / CAP)) for d in doc_ids), 2)


def titles(doc_ids):
    return sorted(docs[d]["title"] for d in doc_ids)


# "Shaped by": the enabler and context factors documents tie to each market (verified only).
shaped = defaultdict(lambda: defaultdict(int))
for f in shaping:
    if f.get("verified") or not MUST_VERIFY:
        for target in f.get("affects", []):
            factor = f.get("factor") or ""
            name = FACTORS.get(factor) or factor.replace("new:", "").strip()
            if name:
                shaped[target][name] += 1


def shaped_by(slug):
    top = sorted(shaped[slug].items(), key=lambda kv: -kv[1])[:3]
    return [name for name, _ in top]


themes, subthemes = [], {}
for slug, ind in industries.items():
    sector = sectors[ind["sector"]]
    h = height(ind_sal, slug, ind_docs[slug])
    themes.append({
        "slug": slug,
        "title": ind["title"],
        "summary": ind["definition"],
        "layer": "structure",
        "emergent": False,
        "industrySlug": sector["slug"],
        "industryTitle": sector["title"],
        "marketSizeUsdB": ind["marketSizeUsdB"],
        "cagr": ind["cagr2019_24"],
        "frequency": h,
        "signalMentions": h,
        "signalDocs": len(ind_docs[slug]),
        "excerpts": len(ind_findings[slug]),
        "relevance": None,
        "noSignal": not ind_docs[slug],
        "sources": titles(ind_docs[slug]),
        "mergedFrom": ind.get("mergedFrom"),
    })
    rows = []
    for m in (m for m in markets.values() if m["industry"] == slug):
        rows.append({
            "slug": m["slug"],
            "key": m["slug"],
            "title": m["title"],
            "summary": m["definition"] + (f" Shaped by: {', '.join(shaped_by(m['slug']))}." if shaped_by(m["slug"]) else ""),
            "shapedBy": shaped_by(m["slug"]),
            "mentions": height(mkt_sal, m["slug"], mkt_docs[m["slug"]]),
            "docs": len(mkt_docs[m["slug"]]),
            "weight": 0.0,
            "sources": titles(mkt_docs[m["slug"]]),
            "minted": m["slug"] in minted_slugs,
            "archetype": m["archetype"],
            "mergedFrom": m.get("mergedFrom"),
        })
    top = max((r["mentions"] for r in rows), default=0) or 1
    for r in rows:
        r["weight"] = round(r["mentions"] / top, 3)
    subthemes[slug] = rows

bundle = {
    "workspace": {"id": "landscape-v2", "name": "Wellness landscape v2", "slug": "landscape-v2"},
    "heightBy": "documents",
    "structure": {"industries": [
        {"slug": s["slug"], "title": s["title"], "marketSizeUsdB": s["marketSizeUsdB"], "cagr": s["cagr2019_24"]}
        for s in structure["sectors"]
    ]},
    "themes": themes,
    "subthemes": subthemes,
    "brands": [],
}


# Licensed or internal-use sources (same list as build-docs.py): their findings add height, but
# the panel never shows their text; it counts them instead.
INTERNAL = internal_sources()  # build.py: the rules' list plus Cloudflare's


def is_internal(doc_id):
    d = docs[doc_id]
    return any(k in (d.get("publisher") or "") for k in INTERNAL["publishers"]) or doc_id.startswith(tuple(INTERNAL["idPrefixes"]))


def excerpt(f):
    page = f" (p. {f['page']})" if f.get("page") else ""
    return {"id": f["id"], "text": (f.get("excerpt") or f["summary"]) + page, "summary": f["summary"],
            "document": docs[f["doc"]]["title"], "verified": f.get("verified", False)}


inside(OUT / "evidence").mkdir(parents=True, exist_ok=True)
for slug in industries:
    topics = []
    general = [f for f in ind_findings[slug] if f["level"] == "industry"]
    groups = [("general", "The industry as a whole", general)] + [
        (m["slug"], m["title"], mkt_findings[m["slug"]]) for m in markets.values() if m["industry"] == slug
    ]
    for key, title, fs in groups:
        if fs:
            fs = sorted(fs, key=lambda f: -f["salience"])
            ok = [f for f in fs if f.get("verified") or not MUST_VERIFY]
            shown = [f for f in ok if not is_internal(f["doc"])]
            topics.append({"key": key, "title": title, "documents": len({f["doc"] for f in ok}),
                           "excerpts": [excerpt(f) for f in shown],
                           "internalOnly": len(ok) - len(shown),
                           "unverified": sorted({docs[f["doc"]]["title"] for f in fs if f not in ok})})
    evidence = {"topics": topics, "excerptCount": len(ind_findings[slug]),
                "documentCount": len({f["doc"] for f in ind_findings[slug]})}
    inside(OUT / "evidence" / f"{safe_name(slug)}.json").write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")

inside(OUT / "bundle.json").write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")

flat = sum(1 for t in themes if t["noSignal"])
dry = sum(1 for rows in subthemes.values() for r in rows if not r["docs"])
print(f"{len(docs)} documents ({sum(1 for d in docs.values() if d['grade'] != 'drop')} used), {len(findings)} findings")
if curation["applied"]:
    sets = sorted({d["set"] for d in curation["applied"]})
    print(f"curation: {len(curation['applied'])} decisions applied (sets {', '.join(sets)})"
          + (f", draft preview of {', '.join(PREVIEW)}" if PREVIEW else "")
          + f"; {moved_findings} findings moved, {dropped_findings} dropped")
print(f"markets added from evidence: {len(minted_slugs)} ({', '.join(markets[x]['title'] for x in sorted(minted_slugs))})")
print(f"industries with height {len(themes) - flat}/{len(themes)}, markets with evidence {len(markets) - dry}/{len(markets)}")
for t in sorted(themes, key=lambda t: -t["frequency"])[:12]:
    print(f"  {t['frequency']:5}  {t['title']}  ({t['signalDocs']} docs, {t['excerpts']} findings)")

moved = [(t["title"], previous[t["slug"]], t["frequency"]) for t in themes
         if t["slug"] in previous and abs(previous[t["slug"]] - t["frequency"]) >= 0.05]
if previous:
    print(f"settings {SETTINGS['version']}: {len(moved)} peaks moved since the last build")
    for title, before, after in sorted(moved, key=lambda m: -abs(m[2] - m[1]))[:15]:
        print(f"  {before:5} -> {after:5}  {title}")

# The document view's data (landscape/map/docs.json) is built from the map just written.
run("docs", ROOT)
