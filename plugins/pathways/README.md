# pathways plugin

`/pathways` in Claude Code opens the Pathways tool on this laptop: a standalone copy that runs from this plugin, from any folder. No repo, and nothing to install by hand: on the first run, `start.sh` downloads pinned builds of Node and cloudflared into the plugin's data folder (checking each against its SHA-256), and asks macOS to install Apple's developer tools (git and Python) if they're missing. Analyse runs Claude Code on the person's plan: `claude` on PATH or from Anthropic's installer, or else the copy inside the Claude desktop app, so desktop-only people need nothing more. Its working folder is `~/Downloads/Pathways`, or `PATHWAYS_WORKSPACE` if that's set.

It starts empty, with no sample data. **Fetch latest** in Documents signs you in to Cloudflare Access (cloudflared opens your browser: emailed code, then authenticator) and downloads every document that isn't archived from the admin Worker into `documents/` in the working folder, checking each against its SHA-256. The Worker logs every download. The sign-in token stays with cloudflared and the tool's server; it never reaches the page.

Fetch latest also brings down three settings records a person saves once: the industries and markets (`push-structure <structure.json>`), which sources are licensed, so their excerpts are never shown (`push-sources <internal-sources.json>`), and the context factors (`push-factors <context-factors.json>`). Run them through the starter, which brings its own Node and cloudflared: `sh start.sh "$HOME/Library/Application Support/Pathways" push-sources <file>`, with the file outside any git repo. The sources' names live only in Cloudflare, since this plugin is public: without them the build and Publish refuse, and the tool shows no excerpts. **Add files** uploads through the Worker (confidentiality first; the checkout is taken if free and given back after).

**Analyse and extract** rereads every document that isn't archived: it turns each into text parts (PDF through macOS's own PDF framework, Word and HTML through `textutil`), starts a headless Claude Code session on the person's plan to read every part against `landscape/extraction-brief.md`, then runs the build (`merge`, `check`, `map`). That session reads documents that came from outside, so it's fenced in: it reads only inside the working folder and writes only its output and scratch folders (its subagents too), with Claude Code's own memory, plan and temporary folders denied and auto memory off; it has no shell, no web and no MCP servers; it loads no settings, hooks or CLAUDE.md, the person's or any planted in the folder; it's told that document text is data, never instructions; and it runs with API-key variables removed. The fence was tested on Claude Code 2.1.49. Stop ends it; a stopped or failed run leaves the previous results as they were. Its log and the build's are in `landscape/evidence/runs/current/`.

## Install

Once per person, in Claude Code:

```
/plugin marketplace add Parallel-intelligence/pathways-plugin
/plugin install pathways@pathways
```

Then `/pathways` in a new chat. Updates: `/plugin marketplace update pathways`, then `/plugin update pathways@pathways`. If you added the team's earlier marketplace (the cms repo, also named `pathways`), remove it first with `/plugin marketplace remove pathways`.

`Parallel-intelligence/pathways-plugin` is public and holds only this built plugin, copied fresh from a reviewed commit: the method and the code, never client data, and never the client's name, which the tool learns from the admin Worker after sign-in. Until it's set up, the team installs from the cms repo as before.

## What's in it

| Path | What | Made by |
|---|---|---|
| `skills/pathways/SKILL.md` | What Claude does for `/pathways` | Hand |
| `bin/pathways.mjs` | The tool's commands and local server, with sign-in, fetch, upload and analysis; Node built-ins only (`start`, `stop`, `status`, `check`, `push-structure`, `push-sources`, `push-factors`) | `apps/ui/standalone/` |
| `app/` | The tool's page, built in standalone mode (no sample data shown) | `apps/ui` |
| `map/` | Christian's map page | `apps/map` |
| `landscape/` | The landscape build, its extraction brief and rules | `packages/landscape` |

Don't edit the built parts by hand. After changing the tool, rebuild and commit them:

```bash
pnpm --filter @pathways/ui plugin
```

The tool listens on `127.0.0.1:5180` only and answers this machine's own address. Its process id and log are in the person's temporary folder (`$TMPDIR/pathways`). Nothing in this plugin holds client data: documents and what's built from them live in the working folder, outside git.
