# Landscape rules

How the landscape is built from documents. The numbers live in `settings.json`, so they can be tuned without touching code. These rules are expected to change. When one does, record the date, who changed it and why at the bottom.

## 1. The structure

- **Sector** (11): the GWI sectors. They are colour groups on the map, never peaks.
- **Industry** (40): a peak on the map.
- **Market** (113, plus any added from evidence): a smaller peak within an industry. A market is a business someone could build: it has real buyers and sellers. A material, a method or a mood is not a market.
- **Motivation** (7, Model v2): why people buy. Used for fit later, not for the shape of the landscape.

## 2. What a mention is

A **mention** is one passage in a document that makes a specific claim about an industry or market: what people buy, do, want or spend, or how the market is moving. It is recorded as a **verbatim excerpt** (one or two sentences, at most 300 characters) with a short paraphrase next to it. Each excerpt is checked against the document automatically. One that can't be found adds no height.

- **A single word is never a mention.** Neither is a keyword hit. "Running a business" is not running.
- **One passage is one mention**, however many times it names the market.
- **The same claim repeated** in one document (the summary and then the body, say) counts once.
- **A passage about two markets** counts once for each.
- **Each mention gets a salience**, its strength from 0 to 1:
  - about 0.9 for a dedicated section with data,
  - about 0.6 for a clear paragraph,
  - about 0.3 for a passing mention.
- **Weak mentions add no height.** Below `mention.minSalience` (0.4), a mention is a name-drop. It still shows in the side panel as evidence, but adds nothing to height.
- **Per document, at most 5 mentions per market and 5 per industry** (`mention.maxPerMarketPerDocument`): the strongest and most distinct. That keeps one long survey from filling the panel with near-identical lines.
- **Read every part.** Long documents are cut into parts of about 12,000 words (`parts.wordsPerPart`), and each part is read in full. No skimming or keyword search instead of reading.

## 2b. Enablers and context (no height)

Besides market evidence, extraction records two kinds of finding that shape markets without raising them. They feed a "Shaped by" line in the side panel.

- **Enabler:** a material, technology, ingredient, method or capability.
- **Context:** a broader driver: demographics, policy, public space, economics, culture, mindset.

Each one names a factor from `context-factors.json` and the 1–3 markets the document ties it to. Limits: 8 enablers and 8 context findings per part.

## 3. How high a peak is

1. **Mentions count.** That includes several mentions in one document as well as mentions across documents.
2. **Diminishing returns per document.** Per document and peak, add up the salience of its mentions, then run that through a smooth curve that tops out at `height.perDocumentCap` (3). The first mentions count almost fully. Each further one adds less. No single document can give one peak more than 3.
3. **Grade.** Multiply by the document's grade: keep 1, weak 0.5, drop 0.
   - **Keep:** a substantive, credible primary source, such as a survey, market report or dataset report.
   - **Weak:** thin (a teaser, summary page or press release), mainly restates other sources, a niche or unrepresentative sample, or older than 2021.
   - **Drop:** nothing on wellness markets.
   - **Demand surveys** keep the grade the earlier prototype gave them.
4. **Add across documents.** An industry's height includes its own mentions and those of all its markets.
5. **Display.** The map draws height on a log scale, never in bands. No evidence means flat ground.
6. **Market size doesn't affect height.** Size from GWI shows in the side panel only.

## 4. Adding a new market

When documents point to a market that isn't in the structure, it is added if either of these is true:

- **Breadth:** at least `newMarket.minDocuments` (2) documents mention it.
- **Depth:** one document has at least `newMarket.orStrongMentionsInOneDocument` (2) mentions of it at salience `newMarket.strongSalience` (0.7) or above.

Sources graded only for why people buy (demand surveys) add evidence to markets but never add one (`newMarket.demandSurveysCanMint`). A new market must pass the definition in section 1, and it shows on the map with a dashed outline.

## 5. Adding a new industry (a new peak)

Harder than a market, because it adds a peak. It needs all of:

- at least `newIndustry.minDocuments` (3) documents,
- at least `newIndustry.minMentions` (6) mentions in total,
- at least `newIndustry.minMentionsPerDocument` (2) mentions in each counted document. That shows it's discussed, not name-dropped.

A person confirms each new industry before it reaches the map.

## 6. Who changes what

- **Anyone on the team** (Parallel and &go&co) can change a number in `settings.json`, rebuild, and look. The build reports what moved.
- **A change that goes to the client** is recorded below, with the reason.

## Change log

| Date | Who | Change | Why |
|---|---|---|---|
| 24 Sep 2026 | Christian | New market: ≥2 documents, or 1 with ≥2 strong mentions (earlier prototype rule C) | Breadth or depth |
| 27 Oct 2026 | Christian | Height counts mentions within a document, not only documents | Documents alone flatten real differences |
| 27 Oct 2026 | Christian | Diminishing returns per document (cap 3), for every document | One survey gave most of the height |
| 27 Oct 2026 | Christian | A mention is a passage, never a single word; minimum salience 0.4 adds height (earlier prototype's floor) | Name-drops shouldn't raise peaks |
| 27 Oct 2026 | Christian | Brief v3: verbatim excerpts checked automatically; at most 3 mentions per market per document; read every part; enablers and context recorded without height; clearer grading | The comparison with the earlier prototype: ours skimmed long reports, over-recorded surveys and dropped context |
| 27 Oct 2026 | Christian | Per-document limit raised from 3 to 5 mentions per market and per industry | 3 lines per report was too thin in the side panel |
| 3 Nov 2026 | Oliver | Documents uploaded as Licensed get ids starting `licensed-`, added to `internalSources.idPrefixes` | The level chosen at upload decides what is never shown, whoever the publisher is |
