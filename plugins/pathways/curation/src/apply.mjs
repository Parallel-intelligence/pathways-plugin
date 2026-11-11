// Apply curation decisions to the landscape structure (sectors -> industries -> markets).
//
// Works like git, without git: a set is a branch, each decision a commit, and `accept`
// is the merge. Only accepted decisions reach the build. `accept` pins each decision by
// SHA-256, so a file changed after review stops the build. A preview applies a draft set
// on top, last, without accepting it.

import { AMENDMENTS, SET_OPS } from "./records.mjs";

/** Which decisions count, in the order the build applies them. */
export function plan(entries, { preview = [] } = {}) {
  const byId = new Map(entries.map((e) => [e.record.id, e]));
  const acceptedAt = new Map();
  // A rejected set is closed: an accept dated after its rejection counts for nothing.
  const rejectedAt = new Map();
  for (const { record: r } of entries) {
    if (r.op === "reject") rejectedAt.set(r.set, Math.min(rejectedAt.get(r.set) ?? Infinity, Date.parse(r.at)));
  }
  for (const { record: a } of entries) {
    if (a.op !== "accept") continue;
    if (Date.parse(a.at) > (rejectedAt.get(a.set) ?? Infinity)) continue;
    for (const [id, hash] of Object.entries(a.change.decisions)) {
      const e = byId.get(id);
      if (!e) throw new Error(`${a.id} accepts ${id}, which isn't in the decisions folder`);
      if (e.record.set !== a.set) throw new Error(`${a.id} accepts ${id}, which belongs to set ${e.record.set}`);
      if (SET_OPS.has(e.record.op)) throw new Error(`${a.id} accepts ${id}, which is itself an ${e.record.op}`);
      if (e.sha256 !== hash) throw new Error(`${id} changed after ${a.id} accepted it: records are never edited`);
      const t = Date.parse(a.at);
      if (!acceptedAt.has(id) || t < acceptedAt.get(id)) acceptedAt.set(id, t);
    }
  }
  const previewing = new Set(preview);
  const counted = new Map(acceptedAt);
  for (const { record: r } of entries) {
    if (previewing.has(r.set) && !SET_OPS.has(r.op) && !counted.has(r.id)) counted.set(r.id, Infinity);
  }
  const superseded = new Set();
  for (const id of counted.keys()) {
    const r = byId.get(id).record;
    if (!r.supersedes) continue;
    if (!byId.has(r.supersedes)) throw new Error(`${r.id} supersedes ${r.supersedes}, which isn't in the decisions folder`);
    superseded.add(r.supersedes);
  }
  const order = (a, b) => counted.get(a.id) - counted.get(b.id) || Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1);
  const active = [...counted.keys()]
    .map((id) => byId.get(id).record)
    .filter((r) => AMENDMENTS.has(r.op) && !superseded.has(r.id))
    .sort(order);
  return { active, acceptedAt, superseded };
}

/**
 * The structure with the decisions applied, plus where every removed market and industry's
 * evidence now goes: `remap.markets[slug]` is {level, slug} or null (dropped), and
 * `remap.industries[slug]` is a slug or null.
 */
export function curate(structure, entries, options = {}) {
  const { active } = plan(entries, options);
  const s = structuredClone(structure);
  const industries = new Map(s.industries.map((i) => [i.slug, i]));
  const markets = new Map(s.markets.map((m) => [m.slug, m]));
  const marketTo = new Map();
  const industryTo = new Map();
  const applied = [];
  const hiddenFindings = new Set();

  const fail = (d, why) => {
    throw new Error(`${d.id} (${d.op} in set ${d.set}): ${why}`);
  };
  const get = (d, level, slug) => {
    const item = (level === "industry" ? industries : markets).get(slug);
    if (!item) fail(d, `there's no ${level} ${slug} on the map at this point`);
    return item;
  };
  const note = (item, key, value) => {
    item[key] = [...(item[key] ?? []), value];
  };

  for (const d of active) {
    const c = d.change;
    switch (d.op) {
      case "rename": {
        const item = get(d, c.level, c.slug);
        note(item, "previousTitles", item.title);
        item.title = c.title.trim();
        break;
      }
      case "define":
        get(d, c.level, c.slug).definition = c.definition.trim();
        break;
      case "merge": {
        const from = get(d, c.level, c.from);
        const into = get(d, c.level, c.into);
        note(into, "mergedFrom", from.title);
        if (c.level === "market") {
          markets.delete(c.from);
          marketTo.set(c.from, { level: "market", slug: c.into });
        } else {
          for (const m of markets.values()) if (m.industry === c.from) m.industry = c.into;
          industries.delete(c.from);
          industryTo.set(c.from, c.into);
          // Sizes add up when both are known; the growth rate no longer means anything.
          if (from.marketSizeUsdB != null && into.marketSizeUsdB != null) {
            into.marketSizeUsdB = +(from.marketSizeUsdB + into.marketSizeUsdB).toFixed(2);
          }
          into.cagr2019_24 = null;
        }
        break;
      }
      case "move": {
        const m = get(d, "market", c.slug);
        get(d, "industry", c.industry);
        if (m.industry === c.industry) fail(d, `${c.slug} is already in ${c.industry}`);
        note(m, "movedFrom", m.industry);
        m.industry = c.industry;
        break;
      }
      case "hide":
      case "delete": {
        get(d, c.level, c.slug);
        if (c.level === "market") {
          // Hide: off the map, its evidence still counts for its industry. Delete: evidence dropped too.
          const m = markets.get(c.slug);
          markets.delete(c.slug);
          marketTo.set(c.slug, d.op === "hide" ? { level: "industry", slug: m.industry } : null);
        } else {
          industries.delete(c.slug);
          industryTo.set(c.slug, null);
          for (const [slug, m] of markets) {
            if (m.industry !== c.slug) continue;
            markets.delete(slug);
            marketTo.set(slug, null);
          }
        }
        break;
      }
      case "add-market": {
        if (markets.has(c.slug) || marketTo.has(c.slug)) fail(d, `market ${c.slug} already exists or existed`);
        get(d, "industry", c.industry);
        // Added from evidence (rules.md section 4): the build still checks the evidence meets the rule. Without
        // evidence, a market a person added to the structure: on the map like any other, with no height yet.
        markets.set(c.slug, {
          slug: c.slug,
          title: c.title.trim(),
          industry: c.industry,
          ...(c.evidence ? { origin: "curation", evidence: c.evidence } : { origin: "added" }),
        });
        if (c.archetype) markets.get(c.slug).archetype = c.archetype;
        markets.get(c.slug).definition = (c.definition ?? "").trim();
        break;
      }
      case "add-industry": {
        if (industries.has(c.slug) || industryTo.has(c.slug)) fail(d, `industry ${c.slug} already exists or existed`);
        if (!s.sectors.some((each) => each.slug === c.sector)) fail(d, `there's no sector ${c.sector}`);
        industries.set(c.slug, { slug: c.slug, title: c.title.trim(), sector: c.sector, definition: (c.definition ?? "").trim(), marketSizeUsdB: null, cagr2019_24: null, origin: "curation" });
        break;
      }
      case "add-sector": {
        if (s.sectors.some((each) => each.slug === c.slug)) fail(d, `sector ${c.slug} already exists`);
        s.sectors.push({ slug: c.slug, title: c.title.trim(), marketSizeUsdB: null, cagr2019_24: null, origin: "curation" });
        break;
      }
      case "confirm":
        get(d, "market", c.slug).confirmed = true;
        break;
      case "hide-excerpt":
        hiddenFindings.add(c.finding);
        break;
    }
    applied.push({ id: d.id, set: d.set, op: d.op, by: d.by, at: d.at });
  }

  const resolveIndustry = (slug) => {
    for (let hops = 0; industryTo.has(slug); hops++) {
      if (hops > 1000) throw new Error(`industry ${slug}: merge loop`);
      slug = industryTo.get(slug);
      if (slug == null) return null;
    }
    return industries.has(slug) ? slug : null;
  };
  const resolveMarket = (slug) => {
    for (let hops = 0; marketTo.has(slug); hops++) {
      if (hops > 1000) throw new Error(`market ${slug}: merge loop`);
      const to = marketTo.get(slug);
      if (to == null) return null;
      if (to.level === "industry") {
        const ind = resolveIndustry(to.slug);
        return ind ? { level: "industry", slug: ind } : null;
      }
      slug = to.slug;
    }
    return markets.has(slug) ? { level: "market", slug } : null;
  };

  const remap = { markets: {}, industries: {} };
  for (const slug of marketTo.keys()) remap.markets[slug] = resolveMarket(slug);
  for (const slug of industryTo.keys()) remap.industries[slug] = resolveIndustry(slug);

  s.industries = [...industries.values()];
  s.markets = [...markets.values()];
  return { structure: s, remap, hiddenFindings: [...hiddenFindings].sort(), applied };
}

/** Each set's state, for `curate status`. */
export function sets(entries) {
  const { acceptedAt } = plan(entries);
  const superseded = new Set(entries.map((e) => e.record.supersedes).filter(Boolean));
  const out = new Map();
  for (const { record: r } of entries) {
    const set = out.get(r.set) ?? { set: r.set, decisions: 0, accepted: 0, pending: 0, rejected: false, by: new Set(), reviewedBy: new Set() };
    out.set(r.set, set);
    if (r.op === "accept") set.reviewedBy.add(r.by);
    else if (r.op === "reject") {
      set.rejected = true;
      set.reviewedBy.add(r.by);
    } else {
      set.decisions++;
      set.by.add(r.by);
      if (acceptedAt.has(r.id)) set.accepted++;
      else if (!superseded.has(r.id)) set.pending++;
    }
  }
  return [...out.values()].map((x) => ({
    ...x,
    by: [...x.by],
    reviewedBy: [...x.reviewedBy],
    state: x.rejected ? "rejected" : x.pending === 0 && x.accepted > 0 ? "accepted" : x.accepted > 0 ? "partly accepted" : "draft",
  }));
}

/** Records in a set that no accept covers yet: what the next `accept` pins. */
export function pending(entries, set) {
  const { acceptedAt } = plan(entries);
  return entries.filter(({ record: r }) => r.set === set && !SET_OPS.has(r.op) && !acceptedAt.has(r.id));
}

/** Sets still open: drafts, and sets partly accepted. A preview shows them on top of what's accepted. */
export function openSets(entries) {
  return sets(entries).filter((x) => x.state === "draft" || x.state === "partly accepted").map((x) => x.set);
}

/** Records waiting for an accept in the open sets, an edit and its withdraw counting as none. */
export function openCount(entries) {
  const open = openSets(entries).flatMap((set) => pending(entries, set).map((e) => e.record));
  const undone = new Set(open.filter((r) => r.op === "withdraw").map((r) => r.supersedes));
  const ids = new Set(open.map((r) => r.id));
  return open.filter((r) => !undone.has(r.id) && !(r.op === "withdraw" && ids.has(r.supersedes ?? ""))).length;
}

/**
 * The set a person's edits from the local tool go in: cms-<their name>, or the next free one once that's been
 * rejected (a rejected set is closed, so anything added to it would never reach the map).
 */
export function personalSet(email, entries) {
  const base = `cms-${email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 36).replace(/-$/, "") || "cms";
  const rejected = new Set(sets(entries).filter((x) => x.rejected).map((x) => x.set));
  if (!rejected.has(base)) return base;
  for (let n = 2; ; n++) if (!rejected.has(`${base}-${n}`)) return `${base}-${n}`;
}
