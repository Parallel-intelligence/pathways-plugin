// The structure decisions apply to, read the same way by the build (through `curate effective`)
// and by the local tool: structure.json, plus the markets added from evidence
// (landscape/minted-markets.json, and the client's own when building its map), marked
// origin "minted" so a decision can rename, move or confirm them like any other market.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRecords } from "./records.mjs";

const CLIENT = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function loadLandscape(workspace, client = "") {
  const landscape = join(workspace, "landscape");
  const structure = JSON.parse(readFileSync(join(landscape, "structure.json"), "utf8"));
  if (client && !CLIENT.test(client)) throw new Error(`client ${client} isn't a plain name`);
  const mintedFiles = [join(landscape, "minted-markets.json"), ...(client ? [join(workspace, "client", client, "minted-markets.json")] : [])];
  const have = new Set(structure.markets.map((m) => m.slug));
  for (const file of mintedFiles) {
    if (!existsSync(file)) continue;
    for (const m of JSON.parse(readFileSync(file, "utf8")).markets ?? []) {
      if (have.has(m.slug)) continue;
      have.add(m.slug);
      structure.markets.push({ ...m, origin: "minted" });
    }
  }
  return { structure, entries: readRecords(join(landscape, "decisions")) };
}
