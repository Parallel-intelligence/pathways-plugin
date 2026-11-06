#!/usr/bin/env python3
"""Check every findings file before it reaches the map.

    python3 -I packages/landscape/build.py <working-folder> check
"""
import json
import re
import sys
from pathlib import Path

if "ROOT" not in globals():  # ROOT (the working folder) and RULES come from build.py
    raise SystemExit("run this through build.py: python3 -I packages/landscape/build.py <working-folder> check")
FINDINGS = ROOT / "landscape" / "evidence" / "findings"
structure = json.loads((ROOT / "landscape" / "structure.json").read_text())
industries = {i["slug"] for i in structure["industries"]}
markets = {m["slug"] for m in structure["markets"]}
GRADES = {"keep", "weak", "drop"}
TYPES = {"demand", "behaviour", "spend", "trend", "supply"}
MOTIVATIONS = {"Compete", "Connect", "Care", "Express", "Relief", "Play", "Growth", None}

problems, ids = [], set()
files = sorted(FINDINGS.glob("*.json"))
for path in files:
    name = path.name
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        problems.append(f"{name}: not valid JSON ({e})")
        continue
    doc = data.get("doc", {})
    if doc.get("id") != path.stem:
        problems.append(f"{name}: doc.id {doc.get('id')!r} doesn't match the file name")
    if doc.get("grade") not in GRADES:
        problems.append(f"{name}: grade {doc.get('grade')!r}")
    for f in data.get("findings", []):
        fid = f.get("id")
        if fid in ids:
            problems.append(f"{name}: duplicate finding id {fid}")
        ids.add(fid)
        level, slug = f.get("level"), f.get("slug")
        if (level == "industry" and slug not in industries) or (level == "market" and slug not in markets) or level not in ("industry", "market"):
            problems.append(f"{name} {fid}: unknown {level} {slug!r}")
        if not isinstance(f.get("salience"), (int, float)) or not 0 <= f["salience"] <= 1:
            problems.append(f"{name} {fid}: salience {f.get('salience')!r}")
        if f.get("type") not in TYPES:
            problems.append(f"{name} {fid}: type {f.get('type')!r}")
        if not f.get("excerpt"):
            problems.append(f"{name} {fid}: no excerpt")
        if f.get("motivation") not in MOTIVATIONS:
            problems.append(f"{name} {fid}: motivation {f.get('motivation')!r}")
        if len((f.get("summary") or "").split()) > 40:
            problems.append(f"{name} {fid}: summary over 40 words")
        if len(f.get("excerpt") or "") > 320:
            problems.append(f"{name} {fid}: excerpt over 320 characters (the brief asks for 300)")
    for u in data.get("proposals", []):
        if u.get("proposedIndustry") not in industries | {None}:
            problems.append(f"{name}: proposal with unknown industry {u.get('proposedIndustry')!r}")
    for u in data.get("shaping", []):
        if u.get("kind") not in ("enabler", "context"):
            problems.append(f"{name}: shaping finding of kind {u.get('kind')!r}")

verified = sum(1 for p in files for f in json.loads(p.read_text()).get("findings", []) if f.get("verified"))
print(f"{len(files)} findings files, {len(ids)} market findings, {verified} with verified excerpts")
for p in problems:
    print("  PROBLEM:", p)
sys.exit(1 if problems else 0)
