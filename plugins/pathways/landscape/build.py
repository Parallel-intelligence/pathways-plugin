#!/usr/bin/env python3
"""Build the landscape from a working folder outside git.

    python3 -I packages/landscape/build.py <working-folder> <step>

Steps, in the order they usually run:
  structure  sectors, industries and markets from the general sources -> landscape/structure.json
  merge      each document's part outputs -> landscape/evidence/findings/<doc>.json
  check      check every findings file against the brief and the structure
  map        the map's data -> landscape/map/ (also runs docs)
  docs       the document list and its share of height -> landscape/map/docs.json
  layers     presence, growth and similarity from the map just built -> landscape/map/*.json (run after map)
  client-merge  a client's part outputs -> client/<client>/findings-v2/<doc>.json

With PATHWAYS_CLIENT=<client>, map and docs build that client's own landscape (the public
evidence plus the client's market findings, and the client's Brand presence) into
landscape/map-<client>/, leaving the public map alone (rules.md section 5b). Presence counts
where the client sells or explores, including the markets its own documents research.

The code and its rules (rules/settings.json, rules/rules.md) live here; all data, read and
written, lives in the working folder. The build refuses a working folder inside a git work
tree, so no client material or anything derived from it lands next to the repo.
"""
import json
import os
import re
import runpy
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = {"structure": "build-structure.py", "merge": "merge-parts.py", "check": "check-findings.py",
         "map": "build-map.py", "docs": "build-docs.py", "client-merge": "merge-client.py", "layers": "build-layers.py"}


def working_folder(arg):
    root = Path(arg).expanduser().resolve()
    if not (root / "landscape").is_dir():
        sys.exit(f"no landscape/ folder in {root}")
    # Refuse anything in or under a git repo: a .git entry in the folder or any parent, or anything
    # git doesn't plainly call "not a git repository" (a .git directory itself, a repo it won't trust).
    if any((d / ".git").exists() for d in (root, *root.parents)):
        sys.exit(f"refusing {root}: it is inside a git repo; landscape data stays outside git")
    check = subprocess.run(["git", "-C", str(root), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if check.returncode == 0 or "not a git repository" not in check.stderr:
        sys.exit(f"refusing {root}: git can't confirm it is outside a repo ({(check.stdout or check.stderr).strip()})")
    return root


SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,150}")


def safe_name(name):
    """A document id or slug that becomes part of a file name: letters, digits and dashes only."""
    if not isinstance(name, str) or not SLUG.fullmatch(name):
        sys.exit(f"refusing {name!r} as a file name: ids and slugs are lowercase letters, digits and dashes")
    return name


def map_dir(root, client):
    """Where the map's data goes: the public map, or a client's own copy (rules.md section 5b)."""
    return root / "landscape" / (f"map-{client}" if client else "map")


def evidence(root, client):
    """Every findings file the map builds from, as {doc, findings, proposals, shaping, presence}:
    the public findings, plus a client's market findings (they add height) and its presence."""
    out = []
    for path in sorted((root / "landscape" / "evidence" / "findings").glob("*.json")):
        data = json.loads(path.read_text())
        out.append({"doc": data["doc"], "findings": data["findings"], "proposals": data.get("proposals", []),
                    "shaping": data.get("shaping", []), "presence": []})
    if client:
        public = {each["doc"]["id"] for each in out}
        for path in sorted((root / "client" / client / "findings-v2").glob("*.json")):
            data = json.loads(path.read_text())
            # A client document must never stand in for a public one: it would replace its grade and its licensing.
            if data["doc"]["id"] in public:
                sys.exit(f"client/{client}/findings-v2/{path.name}: its id is also a public document's; give it an alias")
            out.append({"doc": data["doc"], "findings": data["findings"],
                        "proposals": [f for f in data.get("proposals", []) if f.get("kind", "market") == "market"],
                        "shaping": data.get("shaping", []),
                        # a market the client researches in its own documents counts as one it explores
                        "presence": [f for f in data.get("brand", []) if f["kind"] == "presence"]
                                    + [{**f, "state": "studies"} for f in data["findings"]]})
    return out


def internal_sources(root):
    """Licensed or internal-use sources: the rules' own list plus the one from Cloudflare.

    The plugin is public, so the sources' names live in Cloudflare (the settings record
    internal-sources) and reach the working folder with Fetch latest. Since 10 Nov licensed
    passages are shown like any other (rules.md change log), so the list only labels documents
    as licensed: without it the build still runs, with only the rules' own id prefixes.
    """
    rules = json.loads((HERE / "rules" / "settings.json").read_text())["internalSources"]
    fetched = root / "landscape" / "internal-sources.json"
    extra = json.loads(fetched.read_text()) if fetched.is_file() else {}
    if not extra.get("publishers"):
        print("note: no list of licensed sources in the working folder (Fetch latest brings it); "
              "documents are labelled licensed by id prefix only")
    return {"publishers": rules["publishers"] + extra.get("publishers", []),
            "idPrefixes": rules["idPrefixes"] + extra.get("idPrefixes", [])}


THIS_YEAR = 2026


def saved(root, name, schema):
    """A settings file the tool saved in the working folder, or None. A link, or a file not in the expected shape,
    stops the build: the tool never writes one (apps/ui/map-settings.ts)."""
    file = root / "landscape" / name
    if file.is_symlink():
        sys.exit(f"landscape/{name} is a link: save those settings again in the tool")
    if not file.is_file():
        return None
    data = json.loads(file.read_text())
    s = data.get("settings") if isinstance(data, dict) and data.get("schema") == schema else None
    if not isinstance(s, dict):
        sys.exit(f"landscape/{name} isn't in the expected shape: save those settings again in the tool")
    return s


def number(value, low, high, whole=False):
    ok = isinstance(value, (int, float)) and not isinstance(value, bool) and low <= value <= high
    return ok and (not whole or float(value).is_integer())


def rule_settings(root):
    """The rules (rules/settings.json), with the Settings page's saved reading and new-market rules in place of
    their own (landscape/rules.json), checked against the ranges the page offers."""
    settings = json.loads((HERE / "rules" / "settings.json").read_text())
    s = saved(root, "rules.json", "rules/1")
    if s is None:
        return settings
    r, m = s.get("reading"), s.get("newMarket")
    if not (isinstance(r, dict) and isinstance(m, dict) and number(r.get("wordsPerPart"), 2000, 30000, True)
            and all(number(r.get(k), 1, 20, True) for k in ("maxPerMarket", "maxPerIndustry", "maxEnablers", "maxContext"))
            and number(m.get("newMarketDocuments"), 1, 10, True) and number(m.get("newMarketStrongMentions"), 1, 10, True)
            and number(m.get("strongSalience"), 0, 1)):
        sys.exit("landscape/rules.json isn't in the expected shape: save the Settings page's rules again")
    settings.setdefault("parts", {})["wordsPerPart"] = int(r["wordsPerPart"])
    settings["mention"].update(maxPerMarketPerDocument=int(r["maxPerMarket"]), maxPerIndustryPerDocument=int(r["maxPerIndustry"]))
    settings["context"].update(maxEnablersPerPart=int(r["maxEnablers"]), maxContextPerPart=int(r["maxContext"]))
    settings["newMarket"].update(minDocuments=int(m["newMarketDocuments"]), orStrongMentionsInOneDocument=int(m["newMarketStrongMentions"]),
                                 strongSalience=m["strongSalience"])
    return settings


def heights(root):
    """How peaks grow: the rules' own settings, or the Map tab's saved ones (landscape/map-settings.json, written by
    the tool, apps/ui/map-settings.ts), checked against the ranges the tool offers. A file that doesn't pass stops
    the build. The map and docs steps both use this, so their heights agree."""
    settings = json.loads((HERE / "rules" / "settings.json").read_text())
    out = {"gradeWeight": dict(settings["height"]["gradeWeight"]), "perDocumentCap": settings["height"]["perDocumentCap"],
           "minSalience": settings["mention"]["minSalience"], "recency": "equal"}
    s = saved(root, "map-settings.json", "map-settings/1")
    if s is not None:
        if not (number(s.get("minSalience"), 0, 1) and number(s.get("perDocumentCap"), 1, 10)
                and number(s.get("weakWeight"), 0, 1) and s.get("recency") in ("equal", "recent", "strong")):
            sys.exit("landscape/map-settings.json isn't in the expected shape: save the Map tab's settings again")
        out.update(minSalience=s["minSalience"], perDocumentCap=s["perDocumentCap"], recency=s["recency"])
        out["gradeWeight"]["weak"] = s["weakWeight"]
    favour = out["recency"]

    def recency(year):
        """A document's weight for its age: halved every 4 years ("recent") or 2 ("strong"), as the tool shows it."""
        if favour == "equal" or not isinstance(year, (int, float)) or isinstance(year, bool) or year <= 0:
            return 1.0  # no year: counts fully, as the tool shows it
        return 0.5 ** (max(0, THIS_YEAR - year) / (4 if favour == "recent" else 2))
    return {**out, "recency": recency}


def run(step, root):
    """Run one step with the working folder and the rules folder handed to it."""
    client = os.environ.get("PATHWAYS_CLIENT") or None
    if client:
        safe_name(client)

    def inside(path):
        """Where a step writes: refused unless it resolves, symlinks followed, inside the working folder,
        and a write aimed at a client's map stays in it, so a link can't carry it into the public map."""
        real = Path(path).resolve()
        if not real.is_relative_to(root):
            sys.exit(f"refusing to write {path}: it resolves to {real}, outside {root}")
        aimed = map_dir(root, client)
        if client and Path(path).absolute().is_relative_to(aimed) and not real.is_relative_to(aimed.resolve()):
            sys.exit(f"refusing to write {path}: it resolves to {real}, outside {aimed}")
        return real
    script = HERE / "steps" / STEPS[step]
    # The plugin ships only the steps Analyse runs (merge, check, map, docs, layers): structure is built in the repo.
    if not script.is_file():
        sys.exit(f"{step}: not part of this copy of the build (run it from the repo)")
    runpy.run_path(str(script), run_name="__main__",
                   init_globals={"ROOT": root, "RULES": HERE / "rules", "run": run, "safe_name": safe_name, "inside": inside,
                                 "internal_sources": lambda: internal_sources(root), "CLIENT": client,
                                 "MAP_DIR": map_dir(root, client),
                                 "EVIDENCE": lambda: evidence(root, client), "HEIGHTS": lambda: heights(root),
                                 "RULE_SETTINGS": lambda: rule_settings(root)})


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in STEPS:
        sys.exit(f"usage: build.py <working-folder> {'|'.join(STEPS)}")
    run(sys.argv[2], working_folder(sys.argv[1]))
