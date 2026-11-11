#!/usr/bin/env node
// curate: view and amend the landscape's industries and markets from Claude Code.
// Reads and writes the working folder only (outside git). Run with no arguments for help.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { curate, pending, sets } from "../src/apply.mjs";
import { loadLandscape } from "../src/landscape.mjs";
import { newId, problems, readRecords, SCHEMA, SET, writeRecord } from "../src/records.mjs";

const HELP = `curate: view and amend the landscape (sectors -> industries -> markets)

View
  curate list [--industry <slug>] [--sector <slug>]   the structure, with heights and evidence
  curate show <slug>                                    one industry or market, top excerpts, history
  curate status                                         change sets and what's waiting for review
  curate log [<slug>]                                   every decision, or those about one item

Amend (each writes one new decision record; needs --set and --why)
  curate rename <slug> <new title>
  curate define <slug> <new definition>
  curate merge <from-slug> <into-slug>
  curate move <market-slug> <industry-slug>
  curate hide <slug>          off the map; a market's evidence still counts for its industry
  curate delete <slug>        off the map, evidence dropped
  curate add-market <industry-slug> <title> --definition <text> --archetype <A-F> --evidence <id,id>
  curate withdraw <decision-id>
  Add --supersedes <decision-id> to any amendment to tweak an earlier decision.

Review and build
  curate rebuild [--preview <set>]    rebuild the map; --preview shows a draft set before it's accepted
  curate accept <set> --why <text>    accept every pending decision in a set (the "merge")
  curate reject <set> --why <text>
  curate effective [--preview <set>]  the curated structure as JSON (the build calls this)

Options: --set <name>  --why <text>  --by <email> (default $PATHWAYS_WHO, then git's user.email)
         --workspace <folder> (default $PATHWAYS_WORKSPACE, then ~/Downloads/Pathways, as the pathways tool)`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    set: { type: "string" },
    why: { type: "string" },
    by: { type: "string" },
    supersedes: { type: "string" },
    preview: { type: "string", multiple: true },
    workspace: { type: "string" },
    industry: { type: "string" },
    sector: { type: "string" },
    definition: { type: "string" },
    archetype: { type: "string" },
    evidence: { type: "string" },
    slug: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const [command, ...args] = positionals;

function die(message) {
  console.error(`curate: ${message}`);
  process.exit(1);
}

// The working folder. Decisions can be derived from client material, so they never live
// inside a git work tree (repo CLAUDE.md, the hard line).
const WORKSPACE = resolve(opt.workspace ?? process.env.PATHWAYS_WORKSPACE ?? join(homedir(), "Downloads", "Pathways"));
const LANDSCAPE = join(WORKSPACE, "landscape");
const DECISIONS = join(LANDSCAPE, "decisions");
const MAP = join(LANDSCAPE, "map");

// Refuses unless git positively says the folder (symlinks resolved) is outside every work
// tree. Any other answer, such as git missing or a "dubious ownership" refusal, fails closed.
function outsideGit(dir) {
  const real = realpathSync(dir);
  try {
    execFileSync("git", ["-C", real, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  } catch (e) {
    if (/not a git repository/i.test(e.stderr ?? "")) return;
    die(`couldn't confirm ${real} is outside git (${e.code ?? (e.stderr ?? "").trim()}); refusing`);
  }
  die(`${real} is inside a git work tree; the working folder must stay outside git`);
}

function load() {
  if (!existsSync(join(LANDSCAPE, "structure.json"))) die(`no landscape/structure.json in ${WORKSPACE}`);
  outsideGit(LANDSCAPE);
  if (existsSync(DECISIONS)) outsideGit(DECISIONS);
  try {
    return loadLandscape(WORKSPACE, process.env.PATHWAYS_CLIENT ?? "");
  } catch (e) {
    die(e.message);
  }
}

function apply(structure, entries, preview = opt.preview ?? []) {
  try {
    return curate(structure, entries, { preview });
  } catch (e) {
    die(e.message);
  }
}

// Reviews take no --by: who accepts or rejects comes from PATHWAYS_WHO or git only.
function who({ allowFlag = true } = {}) {
  if (opt.by && !allowFlag) die("accept and reject record you from PATHWAYS_WHO or git, not --by");
  if (opt.by) return opt.by;
  if (process.env.PATHWAYS_WHO) return process.env.PATHWAYS_WHO;
  try {
    const email = execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim();
    if (email) return email;
  } catch {}
  die("say who you are with --by <email> or PATHWAYS_WHO");
}

function bundle() {
  const path = join(MAP, "bundle.json");
  if (!existsSync(path)) return { themes: new Map(), markets: new Map(), builtAt: null };
  const b = JSON.parse(readFileSync(path, "utf8"));
  const markets = new Map(Object.values(b.subthemes ?? {}).flat().map((m) => [m.slug, m]));
  return { themes: new Map(b.themes.map((t) => [t.slug, t])), markets, builtAt: statSync(path).mtime };
}

function evidence(industry) {
  const path = join(MAP, "evidence", `${industry}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { topics: [] };
}

const levelOf = (structure, slug) =>
  structure.industries.some((i) => i.slug === slug) ? "industry" : structure.markets.some((m) => m.slug === slug) ? "market" : null;

const mentions = (record) => Object.values(record.change ?? {}).filter((v) => typeof v === "string");

function stateOf(entries) {
  const accepted = new Set(entries.filter((e) => e.record.op === "accept").flatMap((e) => Object.keys(e.record.change.decisions)));
  const superseded = new Set(entries.map((e) => e.record.supersedes).filter(Boolean));
  return (r) => (superseded.has(r.id) ? "superseded" : accepted.has(r.id) ? "accepted" : "pending");
}

function describe(r) {
  const c = r.change ?? {};
  switch (r.op) {
    case "rename": return `rename ${c.slug} -> "${c.title}"`;
    case "define": return `new definition for ${c.slug}`;
    case "merge": return `merge ${c.from} into ${c.into}`;
    case "move": return `move ${c.slug} to ${c.industry}`;
    case "hide": return `hide ${c.slug}`;
    case "delete": return `delete ${c.slug}`;
    case "add-market": return `add market "${c.title}" under ${c.industry}`;
    case "add-sector": return `add sector "${c.title}"`;
    case "add-industry": return `add industry "${c.title}" under ${c.sector}`;
    case "confirm": return `confirm market ${c.slug}`;
    case "hide-excerpt": return `take excerpt ${c.finding} off the map`;
    case "withdraw": return `withdraw ${r.supersedes}`;
    case "accept": return `accept ${Object.keys(c.decisions).length} decision(s)`;
    case "reject": return "reject the set";
  }
}

// ---------- view ----------

function list() {
  const { structure, entries } = load();
  const { structure: s } = apply(structure, entries);
  const b = bundle();
  const state = stateOf(entries);
  const waiting = entries.filter((e) => !["accept", "reject"].includes(e.record.op) && state(e.record) === "pending");
  const flag = (slug) => {
    const own = waiting.filter((e) => mentions(e.record).includes(slug));
    return own.length ? `  [pending: ${own.map((e) => `${describe(e.record)} (set ${e.record.set})`).join("; ")}]` : "";
  };
  for (const sector of s.sectors) {
    if (opt.sector && sector.slug !== opt.sector) continue;
    const inds = s.industries.filter((i) => i.sector === sector.slug && (!opt.industry || i.slug === opt.industry));
    if (!inds.length) continue;
    console.log(`\n${sector.title}  (${sector.slug})`);
    for (const i of inds) {
      const t = b.themes.get(i.slug);
      const stats = t ? `height ${t.frequency} · ${t.signalDocs} docs · ${t.excerpts} findings` : "not built yet";
      console.log(`  ${i.title}  (${i.slug})  ${stats}${flag(i.slug)}`);
      for (const m of s.markets.filter((m) => m.industry === i.slug)) {
        const r = b.markets.get(m.slug);
        console.log(`      ${m.title}  (${m.slug})  ${r ? `height ${r.mentions} · ${r.docs} docs` : "not built yet"}${flag(m.slug)}`);
      }
    }
  }
  console.log(`\n${s.sectors.length} sectors, ${s.industries.length} industries, ${s.markets.length} markets.`);
  console.log(`Heights from the last build${b.builtAt ? ` (${b.builtAt.toISOString().slice(0, 16)}Z)` : ""}; ${waiting.length} decision(s) pending review.`);
}

function show(slug) {
  const { structure, entries } = load();
  const { structure: s } = apply(structure, entries);
  const level = levelOf(s, slug);
  if (!level) die(`no industry or market ${slug} on the map (try: curate list)`);
  const b = bundle();
  const item = (level === "industry" ? s.industries : s.markets).find((x) => x.slug === slug);
  const industry = level === "industry" ? item : s.industries.find((i) => i.slug === item.industry);
  console.log(`${item.title}  (${level} ${slug})`);
  if (level === "industry") {
    const sector = s.sectors.find((x) => x.slug === item.sector);
    const t = b.themes.get(slug);
    console.log(`Sector: ${sector?.title}`);
    if (item.marketSizeUsdB != null) console.log(`Size: $${item.marketSizeUsdB}B (GWI)`);
    if (t) console.log(`Height ${t.frequency} · ${t.signalDocs} documents · ${t.excerpts} findings`);
    console.log(`Markets: ${s.markets.filter((m) => m.industry === slug).map((m) => m.title).join(", ") || "none"}`);
  } else {
    const r = b.markets.get(slug);
    console.log(`Industry: ${industry.title} (${industry.slug}) · archetype ${item.archetype}`);
    if (r) console.log(`Height ${r.mentions} · ${r.docs} documents`);
  }
  if (item.mergedFrom) console.log(`Merged in: ${item.mergedFrom.join(", ")}`);
  if (item.previousTitles) console.log(`Previously: ${item.previousTitles.join(", ")}`);
  console.log(`\nDefinition: ${item.definition}`);
  const topic = evidence(industry.slug).topics.find((t) => t.key === (level === "industry" ? "general" : slug));
  if (topic?.excerpts?.length) {
    console.log(`\nTop excerpts (${topic.excerpts.length} verified, from the last build):`);
    for (const e of topic.excerpts.slice(0, 3)) console.log(`  - ${e.text.slice(0, 300)}\n    (${e.document})`);
  }
  logFor(entries, slug);
}

function logFor(entries, slug) {
  const state = stateOf(entries);
  const rows = entries.map((e) => e.record).filter((r) => !slug || mentions(r).includes(slug) || entries.some((e) => e.record.id === r.supersedes && mentions(e.record).includes(slug)));
  if (!rows.length) return slug ? null : console.log("No decisions yet.");
  console.log(slug ? "\nDecisions:" : "");
  for (const r of rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const st = ["accept", "reject"].includes(r.op) ? "" : ` [${state(r)}]`;
    console.log(`  ${r.at.slice(0, 16)}  ${r.id}  set ${r.set}  ${r.by}\n      ${describe(r)}${st}: ${r.why}`);
  }
}

function status() {
  const { structure, entries } = load();
  apply(structure, entries); // fails loudly if the accepted decisions no longer apply
  const all = sets(entries);
  if (!all.length) return console.log(`No decisions yet (${DECISIONS}).`);
  for (const x of all) {
    console.log(`${x.set}: ${x.state} · ${x.decisions} decision(s), ${x.accepted} accepted, ${x.pending} waiting · by ${x.by.join(", ")}${x.reviewedBy.length ? ` · reviewed by ${x.reviewedBy.join(", ")}` : ""}`);
  }
  // PAR-196 will push these through the admin Worker; until it's deployed nothing is synced.
  console.log(`\n${entries.length} record(s) in ${DECISIONS}, none synced to the admin Worker yet (PAR-196).`);
}

// ---------- amend ----------

function record(op, change, extra = {}) {
  if (!opt.set) die("name the change set with --set <name> (like a branch: one set per piece of work)");
  if (!SET.test(opt.set)) die("--set must be lowercase letters, digits and dashes");
  if (!opt.why?.trim()) die("say why with --why <text>");
  const { structure, entries } = load();
  const at = new Date();
  const r = { schema: SCHEMA, id: newId(at), set: opt.set, op, change, supersedes: opt.supersedes ?? extra.supersedes ?? null, why: opt.why.trim(), by: who(), at: at.toISOString() };
  if (r.supersedes) {
    const old = entries.find((e) => e.record.id === r.supersedes);
    if (!old) die(`no decision ${r.supersedes}`);
    if (old.record.set !== r.set) die(`${r.supersedes} is in set ${old.record.set}; tweak it in that set`);
  }
  const bad = problems(r);
  if (bad.length) die(bad.join("; "));
  // Check it applies on top of everything accepted plus the rest of its set, before writing.
  apply(structure, entries, [opt.set]);
  apply(structure, [...entries, { record: r, sha256: "" }], [opt.set]);
  mkdirSync(DECISIONS, { recursive: true, mode: 0o700 });
  outsideGit(DECISIONS);
  writeRecord(DECISIONS, r);
  console.log(`Recorded ${r.id} in set ${r.set}: ${describe(r)}.`);
  console.log(`See it on the map: curate rebuild --preview ${r.set}. When reviewed: curate accept ${r.set} --why "..."`);
}

function current() {
  const { structure, entries } = load();
  return apply(structure, entries, opt.set ? [opt.set] : []).structure;
}

function amend() {
  const need = (n, usage) => args.length >= n || die(`usage: curate ${usage}`);
  const s = current();
  const level = (slug) => levelOf(s, slug) ?? die(`no industry or market ${slug} on the map (try: curate list)`);
  switch (command) {
    case "rename":
      need(2, "rename <slug> <new title>");
      return record("rename", { level: level(args[0]), slug: args[0], title: args.slice(1).join(" ") });
    case "define":
      need(2, "define <slug> <new definition>");
      return record("define", { level: level(args[0]), slug: args[0], definition: args.slice(1).join(" ") });
    case "merge": {
      need(2, "merge <from-slug> <into-slug>");
      const [from, into] = args;
      if (level(from) !== level(into)) die("merge two industries or two markets, not one of each");
      return record("merge", { level: level(from), from, into });
    }
    case "move":
      need(2, "move <market-slug> <industry-slug>");
      if (level(args[0]) !== "market" || level(args[1]) !== "industry") die("move takes a market, then the industry it moves to");
      return record("move", { slug: args[0], industry: args[1] });
    case "hide":
    case "delete":
      need(1, `${command} <slug>`);
      return record(command, { level: level(args[0]), slug: args[0] });
    case "add-market": {
      need(2, "add-market <industry-slug> <title> --definition <text> --archetype <A-F> --evidence <id,id>");
      if (level(args[0]) !== "industry") die("add-market takes an industry first");
      const title = args.slice(1).join(" ");
      const tail = title.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!tail && !opt.slug) die("the title needs letters or digits");
      const slug = opt.slug ?? `mk-${args[0].replace(/^[a-z]+-/, "")}--${tail}`;
      return record("add-market", {
        slug, title, industry: args[0], archetype: opt.archetype, definition: opt.definition,
        evidence: (opt.evidence ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      });
    }
    case "withdraw":
      need(1, "withdraw <decision-id>");
      return record("withdraw", {}, { supersedes: args[0] });
  }
}

function review(op) {
  const set = args[0] ?? die(`usage: curate ${op} <set> --why <text>`);
  if (!opt.why?.trim()) die("say why with --why <text>");
  const { structure, entries } = load();
  const waiting = pending(entries, set);
  if (!entries.some((e) => e.record.set === set)) die(`no set ${set}`);
  if (entries.some((e) => e.record.set === set && e.record.op === "reject")) die(`set ${set} was rejected; start a new set for further changes`);
  if (!waiting.length) die(`nothing in ${set} is waiting for review; to undo accepted changes, make new decisions`);
  if (op === "accept") apply(structure, entries, [set]); // refuse to accept a set that no longer applies
  const by = who({ allowFlag: false });
  const authors = new Set(waiting.map((e) => e.record.by));
  const at = new Date();
  const r = {
    schema: SCHEMA, id: newId(at), set, op,
    change: op === "accept" ? Object.fromEntries([["decisions", Object.fromEntries(waiting.map((e) => [e.record.id, e.sha256]))]]) : {},
    supersedes: null, why: opt.why.trim(), by, at: at.toISOString(),
  };
  mkdirSync(DECISIONS, { recursive: true, mode: 0o700 });
  outsideGit(DECISIONS);
  writeRecord(DECISIONS, r);
  console.log(`${op === "accept" ? "Accepted" : "Rejected"} set ${set} (${waiting.length} decision(s)) as ${r.id}.`);
  if (authors.has(by)) console.log("Note: you're reviewing your own changes. The flow expects someone else on the team to review them.");
  if (op === "accept") console.log("Rebuild the map to apply it: curate rebuild");
}

// ---------- build ----------

function effective() {
  const { structure, entries } = load();
  process.stdout.write(JSON.stringify(apply(structure, entries)) + "\n");
}

function rebuild() {
  load();
  if (existsSync(MAP)) outsideGit(MAP);
  // The landscape build sits two folders up, in the repo (packages/landscape) and in the plugin (landscape/) alike.
  const script = fileURLToPath(new URL("../../landscape/build.py", import.meta.url));
  const run = spawnSync("python3", ["-I", script, WORKSPACE, "map"], {
    cwd: WORKSPACE,
    stdio: "inherit",
    env: { ...process.env, PATHWAYS_CURATE: fileURLToPath(import.meta.url), PATHWAYS_WORKSPACE: WORKSPACE, PATHWAYS_PREVIEW: (opt.preview ?? []).join(",") },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
  console.log(`\nMap rebuilt${opt.preview?.length ? ` with draft set(s) ${opt.preview.join(", ")} shown` : ""}. Reload the pathways tool's Map tab to see it. A preview build can't be published: Analyse rebuilds from accepted decisions.`);
}

if (!command || opt.help) console.log(HELP);
else if (command === "list") list();
else if (command === "show") show(args[0] ?? die("usage: curate show <slug>"));
else if (command === "status") status();
else if (command === "log") {
  const { entries } = load();
  logFor(entries, args[0]);
} else if (["rename", "define", "merge", "move", "hide", "delete", "add-market", "withdraw"].includes(command)) amend();
else if (command === "accept" || command === "reject") review(command);
else if (command === "effective") effective();
else if (command === "rebuild") rebuild();
else die(`unknown command ${command}\n\n${HELP}`);
