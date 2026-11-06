#!/usr/bin/env python3
"""Build the landscape from a working folder outside git.

    python3 -I packages/landscape/build.py <working-folder> <step>

Steps, in the order they usually run:
  structure  sectors, industries and markets from the general sources -> landscape/structure.json
  merge      each document's part outputs -> landscape/evidence/findings/<doc>.json
  check      check every findings file against the brief and the structure
  map        the map's data -> landscape/map/ (also runs docs)
  docs       the document list and its share of height -> landscape/map/docs.json

The code and its rules (rules/settings.json, rules/rules.md) live here; all data, read and
written, lives in the working folder. The build refuses a working folder inside a git work
tree, so no client material or anything derived from it lands next to the repo.
"""
import json
import re
import runpy
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = {"structure": "build-structure.py", "merge": "merge-parts.py", "check": "check-findings.py",
         "map": "build-map.py", "docs": "build-docs.py"}


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


def internal_sources(root):
    """Licensed or internal-use sources: the rules' own list plus the one from Cloudflare.

    The plugin is public, so the sources' names live in Cloudflare (the settings record
    internal-sources) and reach the working folder with Fetch latest. Without that list the
    build can't tell which excerpts must never be shown, so it refuses to run.
    """
    rules = json.loads((HERE / "rules" / "settings.json").read_text())["internalSources"]
    fetched = root / "landscape" / "internal-sources.json"
    if not fetched.is_file():
        sys.exit("the list of licensed sources isn't in the working folder: sign in, press Fetch latest, then try again")
    extra = json.loads(fetched.read_text())
    if not extra.get("publishers"):
        sys.exit("the list of licensed sources in the working folder is empty: press Fetch latest, then try again")
    return {"publishers": rules["publishers"] + extra["publishers"], "idPrefixes": rules["idPrefixes"] + extra["idPrefixes"]}


def run(step, root):
    """Run one step with the working folder and the rules folder handed to it."""
    def inside(path):
        """Where a step writes: refused unless it resolves, symlinks followed, inside the working folder."""
        real = Path(path).resolve()
        if not real.is_relative_to(root):
            sys.exit(f"refusing to write {path}: it resolves to {real}, outside {root}")
        return real
    script = HERE / "steps" / STEPS[step]
    # The plugin ships only the steps Analyse runs (merge, check, map, docs): structure is built in the repo.
    if not script.is_file():
        sys.exit(f"{step}: not part of this copy of the build (run it from the repo)")
    runpy.run_path(str(script), run_name="__main__",
                   init_globals={"ROOT": root, "RULES": HERE / "rules", "run": run, "safe_name": safe_name, "inside": inside,
                                 "internal_sources": lambda: internal_sources(root)})


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in STEPS:
        sys.exit(f"usage: build.py <working-folder> {'|'.join(STEPS)}")
    run(sys.argv[2], working_folder(sys.argv[1]))
