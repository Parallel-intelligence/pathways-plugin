#!/usr/bin/env python3
"""The map's extra layers, built from the map `map` just wrote. Run it after `map`:

    python3 -I packages/landscape/build.py <working-folder> layers

Writes into the map folder (landscape/map/, or landscape/map-<client>/ with PATHWAYS_CLIENT):
  presence.json    how the client shows up on each hill (sells, explores, perceived, studies) and what kinds
                   of documents that comes from: counts and group names only. Client maps only.
  growth.json      {growth, perf, leaders}: size per industry, growth a year per industry and market, and the
                   leading companies per industry, from the newest landscape/sources/growth-*/ folder.
  similarity.json  relatedness between the themes and the hill positions that come from it (version 2):
                   a base layer from hand ratings of the schema, and on a client map a client layer pulled
                   closer where the client's own documents discuss two industries together. The ratings stay
                   in the working folder, in landscape/similarity/. Needs numpy, scipy and scikit-learn.

Each layer is skipped, with a one-line note, when its inputs aren't there; the others still build.
"""
import csv
import glob
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

if "ROOT" not in globals():  # ROOT (the working folder) and MAP_DIR come from build.py
    raise SystemExit("run this through build.py: python3 -I packages/landscape/build.py <working-folder> layers")
if not (MAP_DIR / "bundle.json").is_file():
    raise SystemExit(f"no map in {MAP_DIR}: run the map step first")

STRUCTURE = json.loads((ROOT / "landscape" / "structure.json").read_text())


# ---- presence: how the client shows up on each hill ---------------------------------------------
# Per hill (industry and market slugs):
#   states: sells, explores, perceived ("Seen as"), studies ("Researches"). sells/explores/perceived are the brand
#           presence findings by state; studies are the ordinary market findings. This matches the bundle's
#           brands[0].themes (states + perceived) exactly for industries; perceived is a separate count, not in states.
#   types:  documents behind those findings, counted once each, grouped into seven plain names.
# An industry adds up its own findings and its markets' (documents counted once). No titles, no text, no names.

# the plain document groups, in the order the line lists ties
GROUPS = [("guest", "guest study", "guest studies"), ("product", "product study", "product studies"),
          ("tracker", "brand tracker", "brand trackers"), ("positioning", "positioning study", "positioning studies"),
          ("futures", "futures deck", "futures decks"), ("strategy", "strategy deck", "strategy decks"),
          ("other", "other report", "other reports")]
BY_PHASE = {"guest": "guest", "brand-tracker": "tracker", "positioning": "positioning", "futures": "futures",
            "strategy": "strategy", "market": "other"}   # an extraction batch's phase; "ocr" falls back to the catalogue type
BY_TYPE = {"consumer-insight": "guest", "ambassador-interview": "guest", "product-insight": "product",
           "materials-testing": "product", "trend-futures": "futures", "cultural-report": "futures",
           "strategy": "strategy", "process": "strategy", "contract": "strategy", "academic": "other", "other": "other"}


def presence():
    if not CLIENT:
        print("presence: skipped (public map; presence is a client map's layer)")
        return
    C = ROOT / "client" / CLIENT
    ind_of = {m["slug"]: m["industry"] for m in STRUCTURE["markets"]}
    ctype = {}
    for f in glob.glob(str(C / "catalogue" / "**" / "*.json"), recursive=True):
        d = json.loads(Path(f).read_text()); ctype[d.get("id") or Path(f).stem] = d.get("type")
    phases = C / "batch-3-extract" / "docs.json"
    phase = {d["id"]: d.get("phase") for d in json.loads(phases.read_text())} if phases.is_file() else {}

    def group(doc):
        return BY_PHASE.get(phase.get(doc)) or BY_TYPE.get(ctype.get(doc)) or "other"

    states, docs = defaultdict(Counter), defaultdict(set)
    unknown = set()
    for f in glob.glob(str(C / "findings-v2" / "*.json")):
        x = json.loads(Path(f).read_text()); doc = x["doc"]["id"]
        if doc not in phase and doc not in ctype: unknown.add(doc)
        for g in x.get("brand", []):
            if g.get("kind") == "presence" and g.get("slug"):
                states[g["slug"]][g["state"]] += 1; docs[g["slug"]].add(doc)
        for g in x.get("findings", []):
            if g.get("slug"):
                states[g["slug"]]["studies"] += 1; docs[g["slug"]].add(doc)

    def entry(st, ds):
        return {"states": {k: st.get(k, 0) for k in ("sells", "explores", "perceived", "studies") if st.get(k)},
                # documents in id order, so groups with equal counts always come out in the same order
            "types": dict(Counter(group(d) for d in sorted(ds)).most_common())}

    hills = {}
    for slug in set(states) | {i["slug"] for i in STRUCTURE["industries"]}:
        if slug.startswith("mk-"):
            hills[slug] = entry(states[slug], docs[slug])
        else:
            st, ds = Counter(states.get(slug, Counter())), set(docs.get(slug, set()))
            for m, i in ind_of.items():
                if i == slug: st += states.get(m, Counter()); ds |= docs.get(m, set())
            hills[slug] = entry(st, ds)
    hills = {k: v for k, v in sorted(hills.items()) if v["states"]}
    inside(MAP_DIR / "presence.json").write_text(json.dumps({"groups": [{"key": k, "one": a, "many": b} for k, a, b in GROUPS], "hills": hills}, indent=1))
    print(f"presence: {len(hills)} hills ({sum(k.startswith('mk-') for k in hills)} markets); documents by group:",
          dict(Counter(group(d) for d in set().union(*docs.values())).most_common()),
          f"; {len(unknown)} with no catalogue type or phase (counted as other)")


# ---- growth: size, growth a year and leaders, from the growth-slope sheets -----------------------
# The sheets key by title. Industries match by title; markets by title within their industry, and the
# markets renamed since the sheet was drawn (long draft title vs short map title) pair by shared words.
norm = lambda t: re.sub(r"[^a-z0-9]+", " ", t.lower().replace("&", "and")).strip()
words = lambda t: {w.rstrip("s") for w in norm(t).split() if w not in {"and", "the", "of", "incl", "in", "w"}}
num = lambda v: float(v) if v not in (None, "") else None


def perf_row(r, size_note):
    return {"r": float(r["growth_pct"]), "g": r["confidence"], "lo": num(r["band_low"]), "hi": num(r["band_high"]),
            "b": r["basis"], "src": r["source"], "sz": size_note}


def note_size(note):
    """A rough published size from the note column ('c. $10B ...', '$20B to $30B ...'): the first figure, or the
    midpoint of a range. 'Not sized ...' notes (even when they mention some other figure) give nothing."""
    if not note or note.lower().startswith("not sized"):
        return None
    m = re.search(r"\$(\d+(?:\.\d+)?)B(?:\s*to\s*\$(\d+(?:\.\d+)?)B)?", note)
    if not m:
        return None
    return round((float(m[1]) + float(m[2])) / 2, 1) if m[2] else float(m[1])


def growth():
    folders = sorted(p for p in (ROOT / "landscape" / "sources").glob("growth-*") if p.is_dir())
    if not folders:
        print("growth: skipped (no landscape/sources/growth-*/ folder)")
        return
    SRC = folders[-1]   # the newest: folders are named growth-<yyyy-mm-dd>
    s = STRUCTURE
    l1 = list(csv.DictReader(open(SRC / "l1_growth_rates.csv", encoding="utf-8-sig")))
    l2 = list(csv.DictReader(open(SRC / "l2_growth_rates.csv", encoding="utf-8-sig")))
    ind_by_title = {norm(i["title"]): i for i in s["industries"]}

    PERF, unmatched, renamed = {}, [], []
    for r in l1:
        i = ind_by_title.get(norm(r["l1"]))
        if not i: unmatched.append(("industry", r["l1"])); continue
        PERF[i["slug"]] = perf_row(r, r["size_note"] or None)
    left_rows, left_mk = defaultdict(list), defaultdict(list)
    mk_by = {(m["industry"], norm(m["title"])): m for m in s["markets"]}
    for r in l2:
        i = ind_by_title.get(norm(r["l1"]))
        if not i: unmatched.append(("market", f'{r["l1"]} / {r["l2"]}')); continue
        m = mk_by.get((i["slug"], norm(r["l2"])))
        if m: PERF[m["slug"]] = perf_row(r, r["published_size"] or None)
        else: left_rows[i["slug"]].append(r)
    for m in s["markets"]:
        if m["slug"] not in PERF: left_mk[m["industry"]].append(m)
    for ind, rows in left_rows.items():
        pool = list(left_mk.get(ind, []))
        for r in rows:
            if not pool: unmatched.append(("market", f'{r["l1"]} / {r["l2"]}')); continue
            jac = lambda m: len(words(m["title"]) & words(r["l2"])) / max(1, len(words(m["title"]) | words(r["l2"])))
            best = max(pool, key=jac)
            if jac(best) == 0 and len(pool) > 1: unmatched.append(("market", f'{r["l1"]} / {r["l2"]}')); continue
            pool.remove(best); PERF[best["slug"]] = perf_row(r, r["published_size"] or None)
            renamed.append((r["l2"], best["title"]))
    no_row = [m["slug"] for m in s["markets"] if m["slug"] not in PERF] + [i["slug"] for i in s["industries"] if i["slug"] not in PERF]

    # size per industry: the sheet's published 2024 size where it has one, else a rough figure from its note,
    # else the structure's own figure, else an even share of what its sector's sized industries leave
    sheet_size = {i["slug"]: num(r["size_bn_2024"]) for r in l1 if (i := ind_by_title.get(norm(r["l1"])))}
    rough_size = {i["slug"]: v for r in l1 if (i := ind_by_title.get(norm(r["l1"]))) and not sheet_size.get(i["slug"]) and (v := note_size(r["size_note"]))}

    # leading companies per industry: leaders.json next to the sheets, the top 3 in the sheet's order.
    # The client's own name is written in lowercase, as everywhere in the tool.
    LEADERS = {}
    if (SRC / "leaders.json").exists():
        known = {i["slug"] for i in s["industries"]}
        for r in json.loads((SRC / "leaders.json").read_text())["industries"]:
            if r["slug"] in known and r["leaders"]:
                LEADERS[r["slug"]] = [n.lower() if CLIENT and n.lower() == CLIENT else n for n in r["leaders"][:3]]
    sec = {x["slug"]: x for x in s["sectors"]}
    table = {}
    for slug, se in sec.items():
        inds = [i for i in s["industries"] if i["sector"] == slug]
        own = {i["slug"]: sheet_size.get(i["slug"]) or rough_size.get(i["slug"]) or i.get("marketSizeUsdB") for i in inds}
        known = sum(v for v in own.values() if v)
        unknown = [k for k, v in own.items() if not v]
        rest = max(0.0, se["marketSizeUsdB"] - known)
        for i in inds:
            sized = bool(own[i["slug"]])
            table[i["slug"]] = {
                # a sector its sized industries already fill leaves nothing to share: floor at $1B so the log scale holds
                "size": own[i["slug"]] if sized else max(1.0, round(rest / max(1, len(unknown)), 1)),
                "cagr": i["cagr2019_24"] if i.get("cagr2019_24") is not None else se["cagr2019_24"],
                "sizeEst": not sized, "sizeSheet": bool(sheet_size.get(i["slug"])), "sizeRough": bool(rough_size.get(i["slug"])),
                # what the panel shows: a published figure, a rough one marked c., or nothing (the even share only sets width)
                "sizeLabel": (("c. $" if rough_size.get(i["slug"]) else "$") + f"{own[i['slug']]:g}B") if sized else None,
                "cagrEst": i.get("cagr2019_24") is None,
                "sector": se["title"],
            }
    inside(MAP_DIR / "growth.json").write_text(json.dumps({"growth": table, "perf": PERF, "leaders": LEADERS}, ensure_ascii=False))
    print(f"growth: from {SRC.name}; rates for {sum(k.startswith('mk-') for k in PERF)} markets and "
          f"{sum(not k.startswith('mk-') for k in PERF)} industries, sizes from the sheet for "
          f"{sum(v['sizeSheet'] for v in table.values())} of {len(table)} industries, leaders for {len(LEADERS)}; "
          f"{len(renamed)} markets paired by words, {len(unmatched)} sheet rows not matched, {len(no_row)} map items with no row")


# ---- similarity: relatedness between the themes, and the positions that come from it -------------
#   base    Semantic relatedness from the schema alone: every industry against every other, and every market
#           against the other markets of its own industry. The scores are in ratings-industries.txt and
#           ratings-markets.txt, rated 0-1 with a reason from the titles and definitions in structure.json,
#           before any documents. Same for every client. Re-rate when the hierarchy changes: a new industry
#           needs scoring against all the others.
#   client  The base, pulled closer where the client's own documents keep discussing two industries together
#           (client maps only; the public map has the base alone). It only ever pulls closer:
#               client = 1 - (1 - base) * (1 - K * pull)
#           pull is 0..1 from co-occurrence in the client's documents: of the smaller industry's client
#           documents, the share that also feed the other industry, times a confidence that grows with the
#           number shared (1 - exp(-shared/4)). Pairs sharing fewer than MIN_DOCS client documents get no
#           pull; documents feeding more than MAX_SPREAD industries are left out.
# Proximity is industry-level only. Industry positions: metric MDS from classical MDS on 1 - score, then t-SNE
# started from it (keeps each industry next to its most related ones). The base is rotated onto the old sector
# ring; the client layout onto the base, so switching layers moves only what the client changes. Markets stay
# in their own industry's cluster, placed within it by classical MDS on their own scores. Deterministic.
# Classical methods only; the cross-check is TF-IDF over the same schema text.
RATINGS = ROOT / "landscape" / "similarity"   # the hand ratings: working folder only, never in git
K = 0.7          # how far a full client pull closes the gap to 1
MIN_DOCS = 3     # client documents a pair must share before it is pulled at all
MAX_SPREAD = 7   # client documents feeding more industries than this are left out of the pull
BANDS = [(0.90, "near-identical"), (0.75, "same need or offering"), (0.55, "clearly related"),
         (0.35, "loosely related"), (0.15, "weak link"), (0.0, "unrelated")]
band = lambda v: next(n for t, n in BANDS if v >= t)
LINK_MIN, LINKS_PER_MARKET = 0.70, 3


def similarity():
    try:
        import numpy as np
        from scipy.linalg import orthogonal_procrustes
        from scipy.stats import spearmanr
        from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
        from sklearn.manifold import TSNE, smacof
    except ImportError as e:
        print(f"similarity: skipped, {e.name} isn't installed (pip install numpy scipy scikit-learn); any existing similarity.json is left as it is")
        return
    needed = ["ratings-industries.txt", "ratings-markets.txt", "ratings-market-links.txt", "link-candidates.json"]
    missing = [n for n in needed if not (RATINGS / n).is_file()]
    if missing:
        print(f"similarity: skipped, landscape/similarity/ has no {', '.join(missing)}; any existing similarity.json is left as it is")
        return

    def hier_version(inds, mks):   # slugs and parents, in bundle order
        key = "|".join(f'{i["slug"]}<{i["industrySlug"]}' for i in inds) + "||" + "|".join(f'{m["slug"]}<{ind}' for ind, m in mks)
        return hashlib.sha1(key.encode()).hexdigest()[:12]

    def read_industry_ratings(n):
        S, why = np.eye(n), {}
        for line in (RATINGS / "ratings-industries.txt").read_text().splitlines():
            if line.startswith("#") or not line.strip():
                continue
            i, rest = line.split(":", 1)
            for e in rest.split(";"):
                m = re.match(r"\s*(\d+)\s+(\d*\.\d+|\d)\s*(.*)", e)
                a, b, v = int(i), int(m[1]), float(m[2])
                S[a, b] = S[b, a] = v
                why[(a, b)] = m[3].strip() or band(v)
        if len(why) != n * (n - 1) // 2:
            raise SystemExit(f"ratings-industries.txt has {len(why)} pairs, the hierarchy needs {n*(n-1)//2}: re-rate")
        return S, why

    def read_market_ratings(groups):
        out = {}
        for line in (RATINGS / "ratings-markets.txt").read_text().splitlines():
            if line.startswith("#") or not line.strip():
                continue
            ind, rest = line.split(":", 1)
            n = len(groups[ind])
            S, why = np.eye(n), {}
            for e in rest.split(";"):
                m = re.match(r"\s*(\d+)-(\d+)\s+(\d*\.\d+|\d)\s*(.*)", e)
                a, b, v = int(m[1]), int(m[2]), float(m[3])
                S[a, b] = S[b, a] = v
                why[f"{a}-{b}"] = m[4].strip() or band(v)
            if len(why) != n * (n - 1) // 2:
                raise SystemExit(f"ratings-markets.txt: {ind} has {len(why)} pairs, needs {n*(n-1)//2}: re-rate")
            out[ind] = (S, why)
        missing = [k for k, v in groups.items() if len(v) > 1 and k not in out]
        if missing:
            raise SystemExit(f"ratings-markets.txt is missing {missing}: re-rate")
        return out

    def read_market_links(hv, mks):
        """Cross-industry market pairs for arcs only: rated pairs at LINK_MIN or above, at most LINKS_PER_MARKET per
        market (strongest first). Stops if the ratings were made for another hierarchy."""
        ind_of = {m["slug"]: ind for ind, m in mks}
        cands = json.loads((RATINGS / "link-candidates.json").read_text())
        rated, pairs = set(), []
        for line in (RATINGS / "ratings-market-links.txt").read_text().splitlines():
            if line.startswith("#") or not line.strip():
                continue
            if line.startswith("hierarchy "):
                if line.split()[1] != hv:
                    raise SystemExit(f"ratings-market-links.txt was rated for hierarchy {line.split()[1]}, not {hv}: re-shortlist and re-rate")
                continue
            if line.startswith("+"):
                m = re.match(r"\+\s+(\S+)\s+(\S+)\s+(\d*\.\d+|\d)\s*(.*)", line)
                a, b, v, why = m[1], m[2], float(m[3]), m[4]
            else:
                m = re.match(r"(\d+)\s+(\d*\.\d+|\d)\s*(.*)", line)
                k = int(m[1]); rated.add(k)
                (a, b), v, why = cands[k], float(m[2]), m[3]
            if a not in ind_of or b not in ind_of or ind_of[a] == ind_of[b]:
                raise SystemExit(f"ratings-market-links.txt: {a} / {b} isn't a cross-industry pair in this hierarchy")
            pairs.append((v, a, b, why.strip() or band(v)))
        if len(rated) != len(cands):
            raise SystemExit(f"ratings-market-links.txt rates {len(rated)} of {len(cands)} candidates: finish rating")
        used, links = {}, []
        for v, a, b, why in sorted(pairs, key=lambda p: -p[0]):
            if v >= LINK_MIN and used.get(a, 0) < LINKS_PER_MARKET and used.get(b, 0) < LINKS_PER_MARKET:
                used[a] = used.get(a, 0) + 1; used[b] = used.get(b, 0) + 1
                links.append({"a": a, "b": b, "score": v, "why": why})
        return links

    def topk(S, i, k):
        return [j for j in np.argsort(-S[i], kind="stable") if j != i][:k]

    def near_kept(S, X, k=3):
        D = ((X[:, None] - X[None]) ** 2).sum(-1)
        np.fill_diagonal(D, np.inf)
        return float(np.mean([len(set(topk(S, i, k)) & set(np.argsort(D[i])[:k])) / k for i in range(len(S))]))

    def classical(D, dims=2):
        n = len(D)
        J = np.eye(n) - 1 / n
        B = -0.5 * J @ (D ** 2) @ J
        vals, vecs = np.linalg.eigh(B)
        idx = np.argsort(vals)[::-1][:dims]
        X = vecs[:, idx] * np.sqrt(np.maximum(vals[idx], 0))
        for c in range(X.shape[1]):   # fix each axis's sign so the output never flips between runs
            if X[np.argmax(np.abs(X[:, c])), c] < 0:
                X[:, c] *= -1
        return X

    def layout(S, anchor):
        D = 1 - np.clip(S, 0, 1)
        np.fill_diagonal(D, 0)
        X, _ = smacof(D, n_components=2, init=classical(D), n_init=1, max_iter=600, eps=1e-7, metric=True, normalized_stress=False)
        kept_mds = near_kept(S, X)
        X = TSNE(2, metric="precomputed", init=(X - X.mean(0)) / (X[:, 0].std() or 1) * 1e-4, perplexity=8, random_state=0).fit_transform(D)
        X = X - X.mean(0)
        A = anchor - anchor.mean(0)
        X = X @ orthogonal_procrustes(X, A)[0]
        X = (X - X.min(0)) / ((X.max(0) - X.min(0)).max() or 1)
        X = X + (1 - (X.max(0) - X.min(0))) / 2 - X.min(0)
        return X, {"mdsTop3Kept": round(kept_mds, 2), "top3Kept": round(near_kept(S, X), 2)}

    def round_layout(X, S, radial=0.85, angular=0.5):
        """The same layout made round: each hill keeps its direction from the centre and its order outwards, but
        distances are evened out so the hills fill a disc (rank r -> sqrt(r/n), the even fill of a disc), and
        directions are spread round the full circle (rank-based angles). Blended with the original by `radial` and
        `angular`, so close neighbours stay close. Deterministic."""
        n = len(X)
        P = X - X.mean(0)
        r = np.hypot(P[:, 0], P[:, 1])
        a = np.arctan2(P[:, 1], P[:, 0])
        r_even = np.sqrt((np.argsort(np.argsort(r)) + 0.5) / n)
        r_new = (1 - radial) * r / (r.max() or 1) + radial * r_even
        order = np.argsort(a, kind="stable")
        a_even = np.empty(n)
        a_even[order] = a[order[0]] + np.arange(n) / n * 2 * np.pi        # same order round the circle, even steps
        da = np.angle(np.exp(1j * (a_even - a)))                            # shortest turn from the old direction
        a_new = a + angular * da
        Y = np.c_[r_new * np.cos(a_new), r_new * np.sin(a_new)]
        Y = (Y - Y.min(0)) / ((Y.max(0) - Y.min(0)).max() or 1)
        Y = Y + (1 - (Y.max(0) - Y.min(0))) / 2 - Y.min(0)
        return Y, {"top3Kept": round(near_kept(S, Y), 2)}

    def centre_layout(Y, S, height, pull=0.9):
        """The round layout with the tallest hills pulled gently towards the middle: each hill keeps its direction
        from the centre, and its distance blends its round-layout distance with where its height ranks (tallest ->
        centre, as an even disc fill). `height` is Normal's (documents with evidence), so nothing moves when the page
        switches to Performance. pull = 0 is the round layout; 1 would order the rings by height alone."""
        n = len(Y)
        P = Y - Y.mean(0)
        r = np.hypot(P[:, 0], P[:, 1]); r = r / (r.max() or 1)
        a = np.arctan2(P[:, 1], P[:, 0])
        rank = np.argsort(np.argsort(-np.asarray(height, float), kind="stable"))   # 0 = tallest
        r_h = np.sqrt((rank + 0.5) / n)
        r_new = (1 - pull) * r + pull * r_h
        Z = np.c_[r_new * np.cos(a), r_new * np.sin(a)]
        Z = 0.5 + 0.5 * Z / (np.hypot(Z[:, 0], Z[:, 1]).max() or 1)   # keep the middle at the middle (no re-centring by the outline)
        rr = np.hypot(*(Z - 0.5).T)
        return Z, {"top3Kept": round(near_kept(S, Z), 2),
                   "tallestNearCentre": round(float(spearmanr(np.asarray(height, float), -rr).statistic), 2)}

    def market_offsets(S):
        """Each market's place inside its industry's cluster: classical MDS on 1 - score, scaled to a unit disc."""
        n = len(S)
        if n == 1:
            return np.zeros((1, 2))
        D = 1 - np.clip(S, 0, 1)
        np.fill_diagonal(D, 0)
        X = classical(D)
        if X.shape[1] < 2:
            X = np.c_[X, np.zeros(n)]
        X = X - X.mean(0)
        r = np.sqrt((X ** 2).sum(1)).max()
        return X / r if r > 1e-9 else X

    def schema_tfidf(inds, schema, mk_titles):
        texts = [f'{i["title"]} {i["title"]} {schema[i["slug"]]["definition"]} {" ".join(mk_titles[i["slug"]])}' for i in inds]
        stop = list(ENGLISH_STOP_WORDS | {"people", "buy", "products", "services", "wellness", "health", "such", "including"})
        X = TfidfVectorizer(stop_words=stop, sublinear_tf=True, ngram_range=(1, 2)).fit_transform(texts).toarray()
        X /= np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)
        return X @ X.T

    def client_pull(inds):
        """0..1 pull per industry pair from the client's own documents (those in this map but not the public one)."""
        lu = json.loads((MAP_DIR / "docs.json").read_text())["docs"]
        pub = json.loads((ROOT / "landscape" / "map" / "docs.json").read_text())["docs"]
        client = {v["title"] for k, v in lu.items() if k not in pub}
        idx = {i["slug"]: k for k, i in enumerate(inds)}
        counts = {}
        for i in inds:
            ev = json.loads((MAP_DIR / "evidence" / f'{safe_name(i["slug"])}.json').read_text())
            for tp in ev["topics"]:
                for x in tp["excerpts"]:
                    if x["document"] in client:
                        counts.setdefault(x["document"], np.zeros(len(inds)))[idx[i["slug"]]] += 1
        P = np.array([(c > 0) for c in counts.values()], float)        # client docs x industries they feed
        P = P[P.sum(1) <= MAX_SPREAD]                                     # a catch-all document says nothing about a pair
        shared = (P.T @ P).astype(int)
        per = P.sum(0)
        # overlap: of the smaller industry's client documents, the share that also feed the other one;
        # times how sure we are, which grows with the number of shared documents (3 -> 0.53, 7 -> 0.83)
        overlap = shared / np.maximum(np.minimum(per[:, None], per[None, :]), 1)
        C = overlap * (1 - np.exp(-shared / 4))
        C[shared < MIN_DOCS] = 0
        np.fill_diagonal(C, 0)
        return np.clip(C, 0, 1), shared, len(P)

    folder = MAP_DIR.name
    schema = {i["slug"]: i for i in STRUCTURE["industries"]}
    b = json.loads((MAP_DIR / "bundle.json").read_text())
    inds = b["themes"]
    mks = [(i["slug"], m) for i in inds for m in b["subthemes"].get(i["slug"], [])]
    groups = {i["slug"]: b["subthemes"].get(i["slug"], []) for i in inds}
    n = len(inds)
    base, why = read_industry_ratings(n)
    mratings = read_market_ratings(groups)
    sectors = [s["slug"] for s in b["structure"]["industries"]]
    ring = {s: (math.cos(k / len(sectors) * 2 * math.pi - math.pi / 2), math.sin(k / len(sectors) * 2 * math.pi - math.pi / 2)) for k, s in enumerate(sectors)}

    # cross-check: the ratings against TF-IDF over the same schema text
    tf = schema_tfidf(inds, schema, {k: [m["title"] for m in v] for k, v in groups.items()})
    iu = np.triu_indices(n, 1)
    print(f"similarity: ratings vs schema TF-IDF, Spearman {spearmanr(base[iu], tf[iu]).statistic:.2f}")

    Xb, kb = layout(base, np.array([ring[i["industrySlug"]] for i in inds]))
    height = [i.get("frequency") or 0 for i in inds]   # Normal's height basis in the bundle
    Rb, rkb = round_layout(Xb, base)
    Cb, ckb = centre_layout(Rb, base, height)
    print(f"  base layout keeps nearby: {kb}; round: {rkb}; centre: {ckb}")
    layers = {"base": {"score": base, "pos": Xb, "kept": kb, "posRound": Rb, "keptRound": rkb, "posCentre": Cb, "keptCentre": ckb}}
    if CLIENT:
        pull, shared, ndocs = client_pull(inds)
        client = 1 - (1 - base) * (1 - K * pull)
        np.fill_diagonal(client, 1)
        Xc, kc = layout(client, Xb)
        Rc, rkc = round_layout(Xc, client)
        Cc, ckc = centre_layout(Rc, client, height)
        print(f"  client layer from {ndocs} client documents; layout keeps nearby: {kc}; round: {rkc}; centre: {ckc}")
        layers["client"] = {"score": client, "pos": Xc, "kept": kc, "posRound": Rc, "keptRound": rkc, "posCentre": Cc, "keptCentre": ckc, "pull": pull, "shared": shared}

    r2 = lambda A: [[round(float(v), 3) for v in row] for row in A]
    doc = {
        "about": "Relatedness between themes and positions from it (build_relatedness.py). base: semantic, from the "
                 "schema alone. client: the base pulled closer where the client's own documents discuss two "
                 "industries together. Derived data: keep outside git.",
        "version": 2, "map": folder, "hierarchyVersion": hier_version(inds, mks),
        "builtAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "default": "client" if "client" in layers else "base",
        "method": {"base": "rated 0-1 from titles and definitions (ratings-industries.txt, ratings-markets.txt)",
                   "client": f"1-(1-base)*(1-{K}*pull); pull from co-occurrence in the client's documents, min {MIN_DOCS} shared",
                   "layout": "SMACOF from classical MDS on 1-score, then t-SNE from it; client rotated onto base",
                   "kept": {k: v["kept"] for k, v in layers.items()}},
        "industries": {"slugs": [i["slug"] for i in inds],
                       "why": {f"{a}-{c}": why[(a, c)] for a, c in sorted(why)},
                       "layers": {k: {"score": r2(v["score"]), "pos": r2(v["pos"]), "posRound": r2(v["posRound"]), "posCentre": r2(v["posCentre"]),
                                      **({"pull": r2(v["pull"]), "sharedDocs": v["shared"].tolist()} if k == "client" else {})}
                                  for k, v in layers.items()}},
        "markets": {ind: {"slugs": [m["slug"] for m in ms],
                          "score": r2(mratings[ind][0]) if ind in mratings else [[1]],
                          "why": mratings[ind][1] if ind in mratings else {},
                          "offset": r2(market_offsets(mratings[ind][0]) if ind in mratings else np.zeros((1, 2)))}
                    for ind, ms in groups.items()},
        "marketLinks": read_market_links(hier_version(inds, mks), mks),   # cross-industry market pairs: arcs only, never moves a hill
    }
    out = inside(MAP_DIR / "similarity.json")
    out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    print(f"  wrote similarity.json ({out.stat().st_size // 1024} KB), hierarchy {doc['hierarchyVersion']}")


presence()
growth()
similarity()
