// Curation decision records: one JSON file per record, created once and never rewritten
// (repo CLAUDE.md, non-negotiable 5; build plan board 2.4). A tweak is a new record that
// supersedes an earlier one. The shape matches the admin Worker's create-only `decision`
// kind, so PAR-196 can push each file unchanged to PUT /v0/records/decision/<id>.

import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SCHEMA = "curation-decision/0.1";

// The admin Worker's record id rule (apps/admin/src/checks.js).
export const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const SET = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
// An industry gets a file of its own in a published version, named after its slug, and a version's file
// names are at most 80 characters (apps/admin/src/checks.js). A market gets no file, so its slug, which
// names its industry too, can run longer.
const INDUSTRY_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LEVELS = new Set(["industry", "market"]);
const MAX_WHY = 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_TITLE = 120;
const MAX_DEFINITION = 600;

// What each op carries in `change` (a kind ending in "?" may be left out). Amendments change the
// structure; `withdraw` only supersedes; `accept` and `reject` are about a whole set.
const OPS = {
  rename: { level: "level", slug: "slug", title: "title" },
  define: { level: "level", slug: "slug", definition: "definition" },
  merge: { level: "level", from: "slug", into: "slug" },
  move: { slug: "slug", industry: "slug" },
  hide: { level: "level", slug: "slug" },
  delete: { level: "level", slug: "slug" },
  "add-market": {
    slug: "slug",
    title: "title",
    industry: "slug",
    archetype: "archetype?",
    definition: "definition?",
    // Without evidence it's a market a person added to the structure, with nothing behind it yet.
    evidence: "evidence?",
    // Only on that client's own map: the base map and other clients' maps leave it out.
    client: "slug?",
  },
  "add-sector": { slug: "slug", title: "title" },
  // From the local tool: an industry of its own, a proposed market kept, one excerpt taken off.
  "add-industry": { slug: "industrySlug", title: "title", sector: "slug", definition: "definition?" },
  confirm: { slug: "slug" },
  "hide-excerpt": { finding: "finding" },
  // One excerpt (finding) placed on another market, its document and salience unchanged.
  "move-excerpt": { finding: "finding", to: "slug" },
  // Uniqueness fit tuning for one client's map (the pathways tool's Uniqueness tab). Each carries the value the
  // person saw before (`was`): an edit made on another laptop meanwhile then shows as a conflict, never a silent
  // overwrite (packages/fit params.mjs).
  "fit-band": { client: "slug", band: "fitBand", value: "fitNumber", was: "fitWas" },
  "fit-qualify": { client: "slug", motivation: "fitName", word: "fitWord", qualifies: "boolean", was: "fitWas" },
  "fit-placement": { client: "slug", axis: "fitAxis", value: "fitNumberOrNull", was: "fitWas" },
  "fit-axis": { client: "slug", axis: "fitAxis", on: "boolean", was: "fitWas" },
  "fit-primary": { client: "slug", market: "slug", motivations: "fitMotivations", was: "fitWas" },
  "fit-na": { client: "slug", market: "slug", na: "boolean", was: "fitWas" },
  withdraw: {},
  accept: { decisions: "hashes" },
  reject: {},
};
export const FIT_OPS = new Set(["fit-band", "fit-qualify", "fit-placement", "fit-axis", "fit-primary", "fit-na"]);
export const AMENDMENTS = new Set(["rename", "define", "merge", "move", "hide", "delete", "add-market", "add-industry", "add-sector", "confirm", "hide-excerpt", "move-excerpt", ...FIT_OPS]);
export const SET_OPS = new Set(["accept", "reject"]);

const FIT_NAME = /^[A-Z][A-Za-z]{1,29}$/;
const fitNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= -1 && v <= 1;
const fitMotivations = (v) => v === null || (Array.isArray(v) && v.length >= 1 && v.length <= 2 && v.every((m) => FIT_NAME.test(m)) && new Set(v).size === v.length);

const FIELD = {
  boolean: (v) => typeof v === "boolean",
  fitBand: (v) => v === "leaning" || v === "owned" || v === "opposite",
  fitName: (v) => typeof v === "string" && FIT_NAME.test(v),
  fitWord: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 60,
  fitAxis: (v) => typeof v === "string" && /^[A-Za-z0-9]{1,12}$/.test(v),
  fitNumber,
  fitNumberOrNull: (v) => v === null || fitNumber(v),
  fitMotivations,
  // The value before the edit: any of the values above, or null (nothing set yet).
  fitWas: (v) => v === null || typeof v === "boolean" || fitNumber(v) || fitMotivations(v),
  level: (v) => LEVELS.has(v),
  slug: (v) => typeof v === "string" && SLUG.test(v),
  industrySlug: (v) => typeof v === "string" && INDUSTRY_SLUG.test(v),
  title: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TITLE,
  definition: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_DEFINITION,
  archetype: (v) => typeof v === "string" && /^[A-F]$/.test(v),
  finding: (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v),
  evidence: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length <= 200),
  hashes: (v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 &&
    Object.entries(v).every(([id, h]) => ID.test(id) && /^[0-9a-f]{64}$/.test(h)),
};

/** Problems with a record, as a list of strings (empty when it's valid). */
export function problems(r) {
  const out = [];
  if (!r || typeof r !== "object") return ["not an object"];
  if (r.schema !== SCHEMA) out.push(`schema must be ${SCHEMA}`);
  if (!ID.test(r.id ?? "")) out.push("id must match the admin Worker's id rule");
  if (!SET.test(r.set ?? "")) out.push("set must be lowercase letters, digits and dashes");
  if (!(r.op in OPS)) return [...out, `unknown op ${r.op}`];
  if (typeof r.by !== "string" || !EMAIL.test(r.by)) out.push("by must be an email address");
  // Records come from teammates through the dev bucket and are printed in terminals: no control characters.
  const strings = [r.why, r.by, r.set, r.at, r.supersedes, ...Object.values(r.change ?? {}).flat()].filter((v) => typeof v === "string");
  if (strings.some((v) => CONTROL.test(v))) out.push("text can't hold control characters");
  if (typeof r.at !== "string" || Number.isNaN(Date.parse(r.at))) out.push("at must be an ISO date");
  if (typeof r.why !== "string" || !r.why.trim()) out.push("why is required");
  else if (r.why.length > MAX_WHY) out.push(`why is longer than ${MAX_WHY} characters`);
  if (r.supersedes != null && !ID.test(r.supersedes)) out.push("supersedes must be a record id");
  if (r.op === "withdraw" && !r.supersedes) out.push("withdraw needs supersedes");
  if (SET_OPS.has(r.op) && r.supersedes) out.push(`${r.op} can't supersede a record`);
  // A fit edit says the value it replaces (`was`), which a superseded record would hide: undo it, then edit again.
  if (FIT_OPS.has(r.op) && r.supersedes) out.push(`${r.op} can't supersede a record: undo it, then make a new edit`);
  const change = r.change ?? {};
  const allowed = OPS[r.op];
  for (const key of Object.keys(change)) if (!(key in allowed)) out.push(`change.${key} isn't part of ${r.op}`);
  for (const [key, kind] of Object.entries(allowed)) {
    const optional = kind.endsWith("?");
    if (optional && change[key] === undefined) continue;
    if (!FIELD[kind.replace("?", "")](change[key])) out.push(`change.${key} is missing or invalid`);
  }
  if (r.op === "merge" && change.from === change.into) out.push("can't merge something into itself");
  return out;
}

/** A new record id: d-<utc time>-<random>, within the Worker's id rule. */
export function newId(at = new Date()) {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "z").toLowerCase();
  return `d-${stamp}-${randomBytes(3).toString("hex")}`;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The exact bytes a record is stored as. Its SHA-256 is what `accept` pins. */
export function serialise(record) {
  return JSON.stringify(record, null, 2) + "\n";
}

/** Write a new record. Refuses to overwrite: an existing file is never touched. */
export function writeRecord(dir, record) {
  const bad = problems(record);
  if (bad.length) throw new Error(`invalid record: ${bad.join("; ")}`);
  const bytes = serialise(record);
  writeFileSync(join(dir, `${record.id}.json`), bytes, { flag: "wx", mode: 0o600 });
  return sha256(bytes);
}

/** Every record in a folder, each with the SHA-256 of its file. Fails on any bad file. */
export function readRecords(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const records = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const bytes = readFileSync(join(dir, name));
    let record;
    try {
      record = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`${name}: not valid JSON`);
    }
    const bad = problems(record);
    if (bad.length) throw new Error(`${name}: ${bad.join("; ")}`);
    if (name !== `${record.id}.json`) throw new Error(`${name}: file name doesn't match id ${record.id}`);
    records.push({ record, sha256: sha256(bytes) });
  }
  return records;
}
