(() => {
  "use strict";
  const canvas = document.getElementById("gl");
  const gl = canvas.getContext("webgl2", {antialias:true, alpha:false});
  const msg = document.getElementById("msg");
  if(!gl){ msg.hidden=false; msg.textContent="The map needs WebGL2, which this browser doesn't appear to support."; return; }

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- colour scales (10 evenly spaced matplotlib samples each) ----------
  const RAMPS={
    magma:  ["#000004","#180f3e","#451077","#721f81","#9f2f7f","#cd4071","#f1605d","#fd9567","#feca8d","#fcfdbf"],
    inferno:["#000004","#1b0c41","#4a0c6b","#781c6d","#a52c60","#cf4446","#ed6925","#fb9b06","#f7d13d","#fcffa4"],
    plasma: ["#0d0887","#46039f","#7201a8","#9c179e","#bd3786","#d8576b","#ed7953","#fb9f3a","#fdca26","#f0f921"],
    // custom scale (replaces matplotlib viridis): deep navy → indigo → teal → pale green → cream
    viridis:["#002e4c","#315083","#008387","#b3e68c","#f8ffbe"],
    // &go&co scale (Leonardo, Lab): keys #003830 · #0b6f83 · #4ebb7a · #bdf581 · #f2f48e at 0 · 23 · 57 · 84 · 100%; flat ground = the first stop
    goandco:["#003830","#055257","#0b6d80","#2c8581","#3f9e7e","#4cb87b","#7ad07d","#a6e780","#cef585","#f2f48e"],
    cividis:["#00224e","#123570","#3b496c","#575d6d","#707173","#8a8678","#a59c74","#c3b369","#e1cc55","#fee838"],
    turbo:  ["#30123b","#4662d7","#36aaf9","#1ae4b6","#72fe5e","#c8ef34","#faba39","#f66b19","#cb2a04","#7a0403"],
    // light themes: a pale floor rising to a saturated summit
    // white-beige → orange → red → purple summits
    ember:  ["#fffdf3","#fff3c9","#fee39a","#fdc868","#fda348","#fb7636","#ee4528","#cc1a2b","#9a1147","#611260"],
    // Leonardo scale (HSLuv): cream → peach → pink → magenta → electric violet
    // Leonardo scale (CAM02): light grey → warm beige → apricot → pure yellow
    lemon:  ["#cfcfcf","#dccfc1","#e8d1b5","#f6d3a6","#fcd78d","#ffdb70","#ffe256","#ffe942","#fff02c","#fff700"],
    // Leonardo scale (CAM02): pale grey → sand → apricot → rose → mauve → violet → electric blue
    dusk:   ["#e8e8e8","#e2d9bd","#e1c49d","#e4ab8c","#e08d95","#cd7da6","#b56fbb","#9060d4","#5f5be8","#0055ff"],
    // Leonardo scale (CAM02), run floor → summit: pale yellow → lime → green → teal → deep navy
    lagoon: ["#fdfde8","#ffffdb","#d6f79b","#acf84b","#6cec60","#38e17c","#00b998","#008f9a","#006187","#002f61"],
    orchid: ["#fffef4","#fff3d6","#fee0c2","#fecfbd","#febfba","#fea9c0","#fe8ccb","#fd63dc","#ed01f9","#bb00ff"],
  };
  const LIGHT_RAMPS=new Set(["ember","orchid","lemon","dusk","lagoon"]);
  const hex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  function sampleRamp(stops,t){
    const n=stops.length-1, x=Math.max(0,Math.min(1,t))*n, i=Math.min(n-1,Math.floor(x)), f=x-i;
    const a=hex(stops[i]), b=hex(stops[i+1]);
    return [0,1,2].map(c=>Math.round(a[c]+(b[c]-a[c])*f));
  }
  // where flat ground sits on each ramp: scales whose low end brightens quickly get a lower floor
  const FLOOR_TS={magma:0.10, inferno:0.10, plasma:0.06, viridis:0.10, goandco:0.0, cividis:0.08, turbo:0.03, ember:0.03, orchid:0.02, lemon:0.0, dusk:0.0, lagoon:0.0};
  let FLOOR_T=FLOOR_TS.magma;
  let rampName="magma", rampStops=RAMPS.magma, FLOOR_RGB=sampleRamp(rampStops,FLOOR_T);
  function rampCSS(){                            // legend runs floor → peak
    const n=12;
    return "linear-gradient(90deg,"+Array.from({length:n},(_,i)=>{
      const c=sampleRamp(rampStops, FLOOR_T+(1-FLOOR_T)*i/(n-1));
      return `rgb(${c}) ${(i/(n-1)*100).toFixed(0)}%`; }).join(",")+")";
  }
  // the ramp is a 1-D texture the shader samples, so switching scales is instant
  const rampTex=gl.createTexture();
  function applyRamp(name){
    rampName=name; rampStops=RAMPS[name]; FLOOR_T=FLOOR_TS[name];
    const px=new Uint8Array(256*3);
    for(let i=0;i<256;i++) px.set(sampleRamp(rampStops,i/255), i*3);
    gl.bindTexture(gl.TEXTURE_2D,rampTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,256,1,0,gl.RGB,gl.UNSIGNED_BYTE,px);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    // the page takes its floor from the scale; the UI chrome does not follow the scale,
    // it is white on the dark scales and black on the light ones
    FLOOR_RGB=sampleRamp(rampStops,FLOOR_T);
    const light=LIGHT_RAMPS.has(name);
    const root=document.documentElement.style;
    root.setProperty("--ground",`rgb(${FLOOR_RGB})`);
    root.setProperty("--accent", light ? "#000" : "#fff");
    root.setProperty("--on-accent", light ? "#fff" : "#000");
    document.documentElement.toggleAttribute("data-light", light);   // flips ink, panels and labels (CSS)
    gl.clearColor(FLOOR_RGB[0]/255,FLOOR_RGB[1]/255,FLOOR_RGB[2]/255,1);
    document.getElementById("rampBar").style.background=rampCSS();
    for(const b of document.querySelectorAll(".rchip")) b.setAttribute("aria-pressed", b.dataset.ramp===name?"true":"false");
    document.getElementById("rampVal").textContent=name;
    syncRampDefault();
    document.getElementById("btnTheme")?.setAttribute("aria-pressed", light ? "true" : "false");
  }
  document.getElementById("btnTheme").addEventListener("click",()=>{
    const light=LIGHT_RAMPS.has(rampName);
    applyRamp(light ? "goandco" : "lagoon");   // the light theme is lagoon
    try{ localStorage.setItem("ramp-default", rampName); }catch(e){}   // remembered in this browser
  });
  for(const b of document.querySelectorAll(".rchip")){
    b.querySelector("i").style.background="linear-gradient(135deg,"+RAMPS[b.dataset.ramp].join(",")+")";
    b.addEventListener("click",()=>applyRamp(b.dataset.ramp));
  }
  const cycleRamp=()=>{ const names=Object.keys(RAMPS); applyRamp(names[(names.indexOf(rampName)+1)%names.length]); };
  document.getElementById("rampBar").addEventListener("click",cycleRamp);
  document.getElementById("rampBar").addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); cycleRamp(); } });
  // landscape v2 default: goandco, unless the reader made another scale their default (Make default, remembered in this browser)
  function savedRamp(){ try{ const r=localStorage.getItem("ramp-default"); return r && RAMPS[r] ? r : null; }catch(e){ return null; } }
  function syncRampDefault(){
    const btn=document.getElementById("rampDefault"); if(!btn) return;
    const isDefault=rampName===(savedRamp() || "goandco");
    btn.disabled=isDefault; btn.textContent=isDefault ? "Default ✓" : "Make default";
  }
  document.getElementById("rampDefault").addEventListener("click",()=>{ try{ localStorage.setItem("ramp-default", rampName); }catch(e){} syncRampDefault(); });
  // no light / dark toggle (12 Nov): a light scale remembered in this browser is ignored, so nobody is left in light
  applyRamp((r=>r && !LIGHT_RAMPS.has(r) ? r : null)(savedRamp()) || "goandco");

  // ---------- theme data: Structure (GWI industries) + Signal (richness hills) ----------
  const SPAN = 10;              // terrain spans [-5,5] in X and Z
  const HALF = SPAN/2;
  const FLOOR = 600;            // flat floor extends to ±600 — effectively infinite
  const AMP = 2.6;              // vertical amplitude of the terrain
  // Fallback if structure.json fails; real map built from GWI industry order + emergent
  const TYPE_COMMUNITY = {values:0, participation:1, wellbeing:2, spend:3, technology:4, identity:5, place:6, mobility:7, behaviour:8, materials:9, culture:10};
  // one hue per GWI sector for the legend and the terrain's range labels; last = emergent
  const INDUSTRY_COLORS = [
    "#ff9da7","#8cd17d","#f28e2b","#76b7b2","#4e79a7","#b07aa1",
    "#9c755f","#edc948","#e15759","#59a14f","#86bcb6","#bab0ac"
  ];
  // the 2-D circles carry no colour of their own; only the step 3 verdict colours them (CSS)
  const sectorColor = () => document.documentElement.hasAttribute("data-light") ? "#4a4458" : "#d9d3e3";   // neutral: pale on dark themes, slate on light ones
  let brandPack = null;
  let subset = "industry";
  let ruleSets = null, rule = null;   // fit-rule switch: the bundle's rules, the one shown
  let wellnessLandscape = null;
  let structureData = null;
  // ---------- growth (data/growth, optional): {growth, perf, leaders}; a 404 turns Performance and the figures off ----------
  // growth: size per industry (US$B, 2024: a published figure, else the base map's, else an even share of the sector),
  //   with sizeLabel (what the panel shows; null = not sized) and cagr.
  // perf: growth a year per industry and market: r = % a year, g = grade, lo/hi = likely range, b = how it is known,
  //   src = source. Fit for ranking and slope, not for forecasts; Very low = placeholder.
  // leaders: leading companies per industry (industry level only).
  let GROWTH = {}, PERF = {}, LEADERS = {};
  let GAX = [0, 1];   // the growth bars' shared scale, % a year (loadGrowth)
  const hasGrowth = () => Object.keys(PERF).length>0;
  async function loadGrowth(){
    try{
      const r=await fetch("data/growth",{cache:"no-store"});
      const d = r.ok ? await r.json() : null;
      const obj = x => x && typeof x==="object" && !Array.isArray(x) ? x : {};
      GROWTH=obj(d?.growth); PERF=Object.fromEntries(Object.entries(obj(d?.perf)).filter(([,p])=>p && Number.isFinite(p.r))); LEADERS=obj(d?.leaders);
    }catch(e){ GROWTH={}; PERF={}; LEADERS={}; }
    const v=Object.values(PERF);
    GAX = v.length ? [Math.min(0,...v.map(p=>p.lo??p.r)), Math.ceil(Math.max(...v.map(p=>p.hi??p.r)))] : [0, 1];
    // no growth data: no Performance view (the switch hides), and the map stays in Normal
    document.querySelector(".mode-tabs").hidden = !hasGrowth();
    if(!hasGrowth()){ perfMode=false; colourP=footP=0; }
    syncHillMode();
  }
  const startPerf = ['performance','growth'].includes(new URLSearchParams(location.search).get('view'));   // ?view=performance
  let perfMode = startPerf;   // Performance keeps Normal's colours (decided 9 Nov)
  // how far the map is from Normal (0) to Performance (1); frame() moves it towards its target
  let colourP = startPerf ? 1 : 0, footP = startPerf ? 1 : 0;
  const easeHill = p => p*p*(3-2*p), HILL_SECONDS = 0.7;
  const growthOf = t => GROWTH[t.parentSlug || t.slug] || GROWTH[t.slug] || null;
  // a market the sheet has no row for takes its industry's rate, as the sheet does for its own gaps
  const perfOf = t => PERF[t.slug] || (PERF[t.parentSlug] && {...PERF[t.parentSlug], g:'Very low', b:'Not in the sheet: its industry\'s rate', lo:null, hi:null, sz:null, inherited:true}) || null;
  let industryCommunity = {};   // slug → community index
  let gwiMarket = null;             // from gwi-market.json (Monitor 2025 xlsx sync)
  // what a theme's height (and a bubble's size) encodes: the view's setting, sent with the bundle
  let heightBy = "documents";
  const HEIGHT_WORD = {documents:"documents", excerpts:"excerpts", themes:"markets"};
  let step = "landscape";           // "landscape" (GWI hills filled by signal) | "brand" (where a brand sits) | "uniqueness"
  let brandPresence = {brands:{}};  // brand-presence.json (Step 2)
  let verdictData = null;           // verdicts.json (Step 3)
  let curationOps = [];             // curation lives in the app (Structure and Themes stages); nothing here
  // Inside the local tool's frame only: the portal's page can't be framed (frame-ancestors 'none'),
  // so the tool's extras (fit-rule tabs, the refresh message, the debug hook) never reach a client.
  const IN_TOOL = window.parent !== window;
  let brandsReady = false;           // Brand and Uniqueness open only once a version carries brands
  // the portal answers 410 for a version that is no longer the live one: a newer one was published, or it was rolled back
  const UPDATED = "The map has been updated. Reload the page to see the latest version.";
  /** A message over the map with a Reload button: never a status code or an address. */
  function showMessage(text){ const b=document.createElement("button"); b.type="button"; b.className="msg-reload"; b.textContent="Reload"; b.addEventListener("click",()=>location.reload()); msg.replaceChildren(text, b); msg.hidden=false; }
  const VERDICT_LABEL = {leader:"Leader", "leader-potential":"Leader potential", whitespace:"Whitespace", conditional:"Conditional", "follower-risk":"Follower risk", avoid:"Avoid", unscored:"Unscored"};
  const verdictColor = k => `var(--v-${Object.hasOwn(VERDICT_LABEL, k) ? k : "unscored"})`;   // known verdicts only: bundle values never reach CSS as written

  /** The landscape at a level ("themes" or "subthemes"), with this browser's curation edits applied. */
  function landscapeFor(level){
    const src = wellnessLandscape, kids = JSON.parse(JSON.stringify(subThemesBase));
    let list = (src.themes||[]).map(t=>({...t}));
    const by = slug => list.find(t=>t.slug===slug);
    for(const o of curationOps){
      if(o.op==="rename"){ const t=by(o.slug); if(t) t.title=o.title; }
      else if(o.op==="hide" || o.op==="delete") list=list.filter(t=>t.slug!==o.slug);
      else if(o.op==="merge"){
        const a=by(o.from), b=by(o.into); if(!a||!b) continue;
        b.signalMentions=(b.signalMentions||0)+(a.signalMentions||0);
        b.frequency=Math.max(1,b.signalMentions); b.noSignal=!b.signalMentions;
        b.signalDocs=new Set([...(b.sources||[]),...(a.sources||[])]).size;
        b.sources=[...new Set([...(b.sources||[]),...(a.sources||[])])];
        if(a.marketSizeUsdB!=null && b.marketSizeUsdB!=null){ b.marketSizeUsdB=+(a.marketSizeUsdB+b.marketSizeUsdB).toFixed(2); b.cagr2019_24=null; }
        b.mergedFrom=[...(b.mergedFrom||[]), a.title];
        kids[b.slug]=[...(kids[b.slug]||[]), ...(kids[a.slug]||[])];
        list=list.filter(t=>t!==a);
      }
    }
    if(level==="subthemes"){
      // Ranges: every GWI hill opens into its sub-themes. The hills on the terrain are the sub-themes;
      // the cluster they form is the GWI theme. A hill with no sub-themes stays as a single peak.
      // Peaks are the model-extracted themes under each GWI hill. Height = the peak's actual count of
      // extracted themes (no brackets). A busy GWI theme simply has more, and taller, peaks.
      const open=[];
      for(const t of list){
        const cs=kids[t.slug]||[];
        if(!cs.length){ open.push({...t, parentSlug:t.slug, parentTitle:t.title}); continue; }
        for(const c of cs) open.push({
          ...t, slug:c.slug, title:c.title, summary:c.summary, isSubTheme:true, subKey:c.key,
          parentSlug:t.slug, parentTitle:t.title,
          frequency:Math.max(1,c.mentions||1), signalMentions:c.mentions||0, signalDocs:c.docs||0, noSignal:!c.mentions, noDemand:"demand" in c && (c.demand==null || c.demand==="missing"), layer:(c.minted||c.fromEvidence)?"emergent":t.layer,   /* a sub-theme minted from the research reads as new */ relevance:null, excerptTotal:null,
          sources:c.sources||[], marketSizeUsdB:null, cagr2019_24:null, phrases:null, mergedFrom:null,
        });
      }
      const top=Math.max(1,...open.map(o=>o.frequency));
      for(const o of open) o.frequencyNormalised=+(0.15+0.85*Math.sqrt(o.frequency/top)).toFixed(3);
      return {...src, themes:open};
    }
    return {...src, themes:list};
  }
  function verdictPack(brand){
    const v=(verdictData && verdictData.brands[brand]) || {hills:{}};
    const present=(brandPresence.brands[brand]||{themes:{}}).themes;
    const themes={};
    for(const t of wellnessLandscape.themes){
      const h=v.hills[t.slug];
      const cls=h ? h.cls : "unscored";
      // same terrain as step 2 (where the brand sits); step 3 only adds where it should and should not play
      themes[t.slug]={...(present[t.slug]||{presenceNormalised:0, mentionCount:0}), verdict:cls, plays:h?h.plays:[]};
    }
    // markets (sub-themes) are scored on their own: their verdicts join the hills'
    for(const [slug,h] of Object.entries(v.hills)) if(!themes[slug]) themes[slug]={verdict:h.cls, plays:h.plays};
    return {entityId:brand, themes};
  }
  let subThemesBase = {};
  let firstBrand = null;
  let directTransitionFinalField = null;

  function stripMd(s){
    return String(s||"").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g,"$1").trim();
  }

  function communityFor(d){
    if(d.emergent || !d.industrySlug) return industryCommunity.__emergent ?? 11;
    if(d.industrySlug in industryCommunity) return industryCommunity[d.industrySlug];
    return TYPE_COMMUNITY[d.type] ?? 0;
  }

  /** Resolve Size · $ from synced GWI Monitor 2025 rows (gwi-market.json ← xlsx). */
  function hillMarketUsdB(t){
    if(t.nodeMarketUsdB!=null) return t.nodeMarketUsdB;   // Step 1 sub-sector size, straight from the GWI Monitor
    if(t.emergent) return 5;                               // emergent hills have no GWI size
    if(gwiMarket){
      const byName = gwiMarket._byName || (gwiMarket._byName = Object.fromEntries((gwiMarket.entries||[]).map(e=>[e.name, e])));
      const matches = gwiMarket.themeMatch || [];
      for(const m of matches){
        try{
          if(new RegExp(m.match, "i").test(t.name||"")){
            const row = byName[m.gwiName];
            if(row && row.marketSizeUsdB!=null) return row.marketSizeUsdB;
          }
        }catch(_){ /* bad regex — skip */ }
      }
      // industry slug → sector row
      const ind = (gwiMarket.industries||[]).find(i=>i.slug===t.industrySlug);
      if(ind && ind.marketSizeUsdB!=null) return ind.marketSizeUsdB;
      if(ind && byName[ind.gwiName]) return byName[ind.gwiName].marketSizeUsdB;
    }
    if(t.industryMarketSizeUsdB!=null) return t.industryMarketSizeUsdB;
    return 40;
  }
  function hillMarketSource(t){
    if(t.nodeMarketUsdB!=null) return "the base map";
    if(t.emergent) return "none — an emergent industry";
    if(gwiMarket){
      const byName = gwiMarket._byName || (gwiMarket._byName = Object.fromEntries((gwiMarket.entries||[]).map(e=>[e.name, e])));
      for(const m of gwiMarket.themeMatch||[]){
        try{
          if(new RegExp(m.match, "i").test(t.name||"")){
            const row = byName[m.gwiName];
            if(row) return `GWI ${row.level>=2?"sub-sector":"sector"} · ${row.name}`;
          }
        }catch(_){}
      }
      const ind = (gwiMarket.industries||[]).find(i=>i.slug===t.industrySlug);
      if(ind) return `GWI sector · ${ind.title||ind.gwiName}`;
    }
    if(t.industryMarketSizeUsdB!=null) return "its sector";
    return "fallback";
  }

  function applyHeights(w){
    const items=w.items;
    if(!items.length) return;
    const maxE=Math.max(...items.map(t=>t.excerpts)), minE=Math.min(...items.map(t=>t.excerpts));
    for(const t of items){
      const lg=(Math.log(t.excerpts)-Math.log(minE))/Math.max(1e-6,Math.log(maxE)-Math.log(minE));
      t.height=0.12+0.88*lg;
      t.mentions=t.excerpts/maxE;
      const fn = t.frequencyNormalised || Math.sqrt(t.mentions);
      t.size=Math.max(0.16,Math.min(0.72, 0.18+0.54*fn));
      if(w.level==="subthemes"){ t.size*=0.42; t.height*=0.72; }   // many small, lower peaks that read as one range (no needles)
      if(t.noSignal) t.height=0;                                    // no signal = flat ground; the dot and label stay
      t.sources=Math.max(1, t.excerpts);
      t.marketUsdB=hillMarketUsdB(t);
      t.marketSource=hillMarketSource(t);
      const gr=growthOf(t);
      if(gr && !t.isSubTheme){ t.marketUsdB=gr.size; t.sizeLabel=gr.sizeLabel; t.sizeRough=gr.sizeRough; }
      else if(!t.isSubTheme){ t.sizeLabel = t.nodeMarketUsdB!=null ? "$"+t.nodeMarketUsdB+"B" : null; t.sizeRough=false; }
      t.cagr=gr ? gr.cagr : null; t.cagrEst=gr ? gr.cagrEst : true;
      t.perf=perfOf(t);
    }
    const sizes=items.map(t=>t.marketUsdB);
    const maxS=Math.max(...sizes), minS=Math.min(...sizes);
    for(const t of items){
      const lg=(Math.log(t.marketUsdB)-Math.log(minS))/Math.max(1e-6,Math.log(maxS)-Math.log(minS));
      t.marketShare=0.08+0.92*lg;
    }
    // Performance height: growth a year, linear from 0 to the level's fastest (slope = growth); a sliver for the slowest
    const maxR=Math.max(1e-6,...items.map(t=>t.perf ? t.perf.r : 0)), sub=w.level==='subthemes';
    for(const t of items){
      const lg=Math.max(0,Math.log(Math.max(t.marketUsdB,0.1)/Math.max(minS,0.1)))/Math.max(1e-6,Math.log(Math.max(maxS,0.1)/Math.max(minS,0.1)));
      t.evidenceSize=t.size; t.evidenceHeight=t.height;
      // footprint by market size (industries only; markets have no comparable size, so they keep evidence)
      t.marketFoot = !sub ? 0.16+0.56*lg : t.size;
      t.perfHeight = (0.05+0.95*Math.max(0,Math.min(1,(t.perf ? t.perf.r : 0)/maxR)))*(sub?0.72:1);
      const e=easeHill(footP); t.size=t.evidenceSize+(t.marketFoot-t.evidenceSize)*e; t.height=t.evidenceHeight+(t.perfHeight-t.evidenceHeight)*e; setEvRatio(t,e);
    }
  }

  function renderIndustryLegend(){
    const el=document.getElementById("industryLegend");
    if(!el || !structureData) return;
    const title=document.getElementById("legendTitle"), dna=document.getElementById("brandDna");
    if(step==="uniqueness"){
      title.textContent="Uniqueness · verdict per industry";
      el.innerHTML="";
      const tally={}; for(const t of paneA.world.items) tally[t.verdict]=(tally[t.verdict]||0)+1;
      for(const k of Object.keys(VERDICT_LABEL)){
        const li=document.createElement("li");
        const sw=document.createElement("span"); sw.className="swatch"; sw.style.background=`var(--v-${k})`;
        const lab=document.createElement("span"); lab.textContent=VERDICT_LABEL[k];
        const cnt=document.createElement("span"); cnt.className="cnt"; cnt.textContent=tally[k]||0;
        li.append(sw,lab,cnt); el.appendChild(li);
      }
      const b=verdictData && verdictData.brands[subset];
      dna.hidden=false;
      dna.textContent = b ? `${b.title} · Brand DNA — ${b.dna.length ? b.dna.map(d=>`${d.grid}: ${d.x.pole} / ${d.y.pole}`).join(" · ") : "not positioned yet"}. Owned axis: ${b.ownedAxis ? b.ownedAxis.replace("-"," ") : "unknown"}. Verdicts come from each industry's incumbent.` : "";
      return;
    }
    title.textContent="Sector"; dna.hidden=true;
    const counts={};
    for(const t of paneA.world.items){
      const k=t.emergent?"__emergent":(t.industrySlug||"__emergent");
      counts[k]=(counts[k]||0)+1;
    }
    const rows=[...(structureData.industries||[]).map(i=>({
      slug:i.slug, title:i.title, n:counts[i.slug]||0, c:industryCommunity[i.slug]
    })), {slug:"__emergent", title:"Emergent (outside the base map)", n:counts.__emergent||0, c:industryCommunity.__emergent}];
    el.innerHTML="";
    for(const r of rows){
      if(!r.n && r.slug!=="__emergent") continue; // hide unused industries for clarity
      const li=document.createElement("li");
      const sw=document.createElement("span"); sw.className="swatch";
      sw.style.background=INDUSTRY_COLORS[r.c % INDUSTRY_COLORS.length];
      const lab=document.createElement("span"); lab.textContent=r.title;
      const cnt=document.createElement("span"); cnt.className="cnt"; cnt.textContent=r.n;
      li.append(sw,lab,cnt); el.appendChild(li);
    }
  }

  function hash01(s){
    let h=2166136261>>>0;
    for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
    return ((h>>>0)%10000)/10000;
  }
  // ---------- worlds: the peaks at one level, laid out once and kept ----------
  // A world is one level's peaks ("themes": one per theme; "subthemes": every theme broken into its
  // sub-themes, clustered under it) with their layout. Each pane shows one world; two panes at the same
  // level share one. The layout doesn't depend on the step or brand, so a world is built once, on first
  // use, and a step or brand change only re-applies the brand's reading to it (applyPack).
  const worlds={themes:null, subthemes:null};
  const builtWorlds=()=>Object.values(worlds).filter(Boolean);
  function world(level){ return worlds[level] || (worlds[level]=buildWorld(level)); }
  function buildWorld(level){
    const w={level, items:[], bySlug:new Map(), rangeCentres:[], bubbleScale:1, clusterR:3.4};
    w.items = (landscapeFor(level).themes || []).map((d,i)=>({
      id:i,
      w,
      level,
      slug:d.slug,
      name:d.title,
      community:communityFor(d),
      type:d.type || "concept",
      industrySlug:d.industrySlug || null,
      industryTitle:d.industryTitle || (d.emergent ? "Emergent" : ""),
      industryMarketSizeUsdB:d.industryMarketSizeUsdB ?? null,
      emergent:!!d.emergent,
      excerpts:Math.max(1, Number(d.frequency)||1),
      layer:d.layer || (d.emergent?"emergent":"structure"),
      parentSlug:d.parentSlug || d.slug,
      parentTitle:d.parentTitle || d.title,
      isSubTheme:!!d.isSubTheme,
      nodeMarketUsdB:d.marketSizeUsdB ?? null,
      cagr:d.cagr2019_24 ?? null,
      gwiFigure:d.gwiFigure ?? null,
      signalMentions:Number(d.signalMentions)||0,
      signalDocs:Number(d.signalDocs)||0,
      relevance:d.relevance ?? null,
      excerptTotal:d.excerptTotal ?? null,
      noSignal:!!d.noSignal,
      noDemand:!!d.noDemand,
      mergedFrom:d.mergedFrom || null,
      phrases:d.phrases || null,
      x:(Number(d.x)-0.5)*6.8,
      z:(Number(d.y)-0.5)*6.8,
      summary:stripMd(d.summary),
      frequencyNormalised:Number(d.frequencyNormalised)||0,
      subKey:d.subKey || null,
    }));
    for(const t of w.items) w.bySlug.set(t.slug, t);
    applyPack(w, brandPack);
    for(const t of w.items) t.transitionFromScale=1-t.shrinkR;   // at rest under the current reading
    if(!w.items.length){ packStats=null; return w; }
    applyHeights(w);
    for(const t of w.items){
      t.x=Math.max(-3.4,Math.min(3.4,t.x));
      t.z=Math.max(-3.4,Math.min(3.4,t.z));
      t.bx=t.x; t.bz=t.z; // bubble coords; re-packed independently of terrain
    }
    buildMeta(w);
    // Sub-themes starts each peak at its theme's place in the Themes layout (the range layout places the
    // peaks from there), rather than packing every peak from scratch, which took seconds
    if(level==="subthemes"){ seedFromThemeLayout(w); applyRangeLayout(w); }
    else { packTerrainLayout(w); packBubbleLayout(w); }
    return w;
  }
  /** The step's brand reading on each peak: presence (how far it shrinks), verdict, quotes. */
  function applyPack(w, pack){
    const scores = (pack && pack.themes) || {};
    // Hills whose markets carry verdicts of their own. A market without one then reads as unscored;
    // markets of a hill with none (older workspaces) keep inheriting the hill's verdict.
    const scoredHills = new Set(w.items.filter(t=>t.isSubTheme && scores[t.slug]).map(t=>t.parentSlug));
    // presence on the same log scale as the landscape's heights (applyHeights): one industry the brand
    // is strongest in doesn't flatten every other one it is present in
    const lows = Object.values(scores).map(s=>Number(s.presenceNormalised)||0).filter(p=>p>0);
    const pMin = Math.min(1, ...lows);
    const scaled = p => p>0 ? 0.12+0.88*(pMin<1 ? 1-Math.log(p)/Math.log(pMin) : 1) : 0;
    for(const t of w.items){
      const brand = scores[t.parentSlug] || {presenceNormalised:0, mentionCount:0};   // presence stays the hill's
      const own = !t.isSubTheme ? brand : scores[t.slug] || (scoredHills.has(t.parentSlug) ? {} : brand);
      const presence = Number(brand.presenceNormalised)||0;
      t.verdict = step==="uniqueness" ? (own.verdict || "unscored") : null;
      t.brandDocs = Number(brand.docs)||0;
      t.brandStates = {...(brand.states||{}), perceived:Number(brand.perceived)||0};   // perceived is counted apart from states
      t.plays = own.plays || [];
      t.shrinkR = pack ? 1-scaled(presence) : 0;
      t.presence = presence;
      t.mentionCount = Number(brand.mentionCount)||0;
      t.strength = brand.strength || "none";
      t.snippet = brand.snippet || "";
      t.hookSource = brand.source || "";
    }
  }
  function resetShrink(){
    shrinkTarget=0;
    shrinkEl.value="0";
    $("shrinkVal").textContent="0%";
    field.fill(0); fieldBytes.fill(0);
    front=Infinity;
    gl.bindTexture(gl.TEXTURE_2D,fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,FIELD_N,1,gl.RED,gl.UNSIGNED_BYTE,fieldBytes);
  }
  /** Seed positions: one ring position per sector (the range), emergent hills in the middle; deterministic. */
  function seedPositions(hills, industries){
    // A layout chosen in the local tool (0 to 1 on both axes) wins when every hill has one.
    if(hills.length && hills.every(t=>Number.isFinite(t.x) && Number.isFinite(t.y))) return hills.map(t=>({...t, r:0.04}));
    const centres={};
    industries.forEach((ind,i)=>{ const a=(i/Math.max(1,industries.length))*Math.PI*2-Math.PI/2; centres[ind.slug]={x:Math.cos(a)*0.5,y:Math.sin(a)*0.5}; });
    const nodes=hills.map(t=>{ const c=(!t.emergent && t.industrySlug && centres[t.industrySlug])||{x:0,y:0};
      const p = SIM && SIM.idx.has(t.slug) ? SIM.pos[SIM.idx.get(t.slug)] : null;
      if(p) return {...t, x:(p[0]-0.5)*1.4, y:(p[1]-0.5)*1.4};
      return {...t, x:c.x+(hash01(t.slug)-0.5)*0.4, y:c.y+(hash01(t.slug+"z")-0.5)*0.4}; });
    for(let it=0;it<120;it++) for(let a=0;a<nodes.length;a++) for(let b=a+1;b<nodes.length;b++){
      let dx=nodes[b].x-nodes[a].x, dy=nodes[b].y-nodes[a].y; const d=Math.hypot(dx,dy)||1e-6;
      if(d<0.13){ const k=((0.13-d)/d)*0.4; dx*=k; dy*=k; nodes[a].x-=dx; nodes[a].y-=dy; nodes[b].x+=dx; nodes[b].y+=dy; } }
    const xs=nodes.map(n=>n.x), ys=nodes.map(n=>n.y); const minX=Math.min(...xs), minY=Math.min(...ys);
    const span=Math.max(Math.max(...xs)-minX, Math.max(...ys)-minY)||1;
    return nodes.map(n=>({...n, x:(n.x-minX)/span, y:(n.y-minY)/span, r:0.04}));
  }
  /** A source link only when it is http(s); a cover only from this server. Data never decides a scheme or origin. */
  const safeHref=u=>{ if(!u) return null; try{ const x=new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; }catch(e){ return null; } };
  const safeImg=u=>{ if(!u) return null; try{ const x=new URL(u, location.href); return x.origin===location.origin ? x.href : null; }catch(e){ return null; } };
  /** The bundle's industries, sectors and markets, as the page keeps them (at start and on each refresh). */
  function readBundle(data){
    const maxF=Math.max(1,...data.themes.map(t=>t.frequency||0));
    const hills=data.themes.map(t=>({
      slug:t.slug, title:t.title, summary:t.summary, layer:t.layer, type:t.layer, emergent:!!t.emergent,
      industrySlug:t.industrySlug, industryTitle:t.industryTitle,
      marketSizeUsdB:t.marketSizeUsdB, cagr2019_24:t.cagr,
      frequency:Math.max(1,t.frequency||0), frequencyNormalised:+(0.15+0.85*Math.sqrt((t.frequency||0)/maxF)).toFixed(3),
      signalMentions:t.signalMentions, signalDocs:t.signalDocs, excerptTotal:t.excerpts ?? 0, relevance:t.relevance ?? null, noSignal:!!t.noSignal, sources:t.sources||[],
      x:t.x, y:t.y,
      industryMarketSizeUsdB:(data.structure.industries.find(i=>i.slug===t.industrySlug)||{}).marketSizeUsdB ?? null,
    }));
    structureData = data.structure;
    heightBy = data.heightBy || "documents";
    gwiMarket = null;
    industryCommunity = {};
    data.structure.industries.forEach((ind,i)=>{ industryCommunity[ind.slug]=i; });
    industryCommunity.__emergent = data.structure.industries.length;
    wellnessLandscape = { themes: seedPositions(hills, data.structure.industries) };
    subThemesBase = data.subthemes || {};
  }
  async function bootstrap(){
    try{
      const url="data/bundle";   // always this server's own data (no URL override)
      const r=await fetch(url,{cache:"no-store"}); if(!r.ok){ const e=new Error(r.status+" "+url); e.status=r.status; throw e; }
      const data=await r.json();
      [SIM] = await Promise.all([loadSimilarity(data), loadGrowth()]);   // relatedness and places (null keeps the old layout); growth
      readBundle(data);
      // Presence (the brand step) shows faded and can't be opened until a version carries brands; Uniqueness stays
      // greyed out in the page until it's scored (12 Nov), whatever the data
      brandsReady = data.brands.length>0;
      for(const t of document.querySelectorAll('.step-tabs .tab[data-step="brand"]')){
        t.dataset.about ??= t.title; t.disabled=!brandsReady; t.classList.toggle("soon", !brandsReady);
        t.title = brandsReady ? t.dataset.about : "Brand positions appear here once they're published.";
        // a disabled tab never shows its tooltip to keyboard, touch or screen reader users, so its name says why
        if(brandsReady) t.removeAttribute("aria-label");
        else t.setAttribute("aria-label", `${t.textContent.trim()}: brand positions appear here once they're published`);
      }
      if(!brandsReady && step!=="landscape") setStep("landscape");
      // brands: tabs and presence packs from the brand data
      brandPresence = { brands: Object.fromEntries(data.brands.map(b=>[b.entityId, {entityId:b.entityId, themes:b.themes}])) };
      verdictData = { brands: Object.fromEntries(data.brands.map(b=>[b.entityId, {title:b.title, dna:b.dna, ownedAxis:b.ownedAxis,
        hills:Object.fromEntries(Object.entries(b.verdicts||{}).map(([id,v])=>[id, {cls:v.cls, plays:v.plays || [{play:v.play, cls:v.cls, incumbent:v.incumbent||"—", why:v.why, consultantVerdict:null, evidence:null, basis:"engine"}]}]))}])) };
      const tabs=document.querySelector(".subset-tabs"); tabs.innerHTML="";
      for(const b of data.brands){ const el=document.createElement("button"); el.className="tab"; el.setAttribute("role","tab"); el.dataset.subset=b.entityId; el.setAttribute("aria-selected","false"); el.textContent=b.title; el.addEventListener("click",()=>setSubset(b.entityId)); tabs.appendChild(el); }
      // one tab per fit rule, plus Changed (the first rule's colours where the rules disagree)
      ruleSets = { rules: data.rules || [], byBrand: Object.fromEntries(data.brands.map(b=>[b.entityId, b.verdictsByRule || {}])),
        base: Object.fromEntries(Object.entries(verdictData.brands).map(([id,b])=>[id, b.hills])) };
      rule = ruleSets.rules[0]?.key ?? null;
      const ruleTabs=document.querySelector(".rule-tabs"); ruleTabs.innerHTML="";
      if(IN_TOOL && ruleSets.rules.length>1) for(const r of [...ruleSets.rules, {key:"changed", title:"Changed"}]){
        const el=document.createElement("button"); el.className="tab"; el.setAttribute("role","tab"); el.dataset.rule=r.key; el.textContent=r.title;
        el.title = r.key==="changed" ? "Only the markets whose colour differs between "+ruleSets.rules[0].title+" and "+ruleSets.rules[ruleSets.rules.length-1].title+"; everything else is grey" : "Colour the markets by the "+r.title+" fit rule";
        el.addEventListener("click",()=>setRule(r.key)); ruleTabs.appendChild(el);
      }
      firstBrand = data.brands[0]?.entityId ?? null;
      renderStepChrome();
      paneA.world=paneB.world=world("themes");
      repaintTerrain();
      buildLabels(paneA); buildLabels(paneB); buildBubbles();
      buildRangeLabels();
      renderIndustryLegend();
      select(null);
      renderLevelTabs();
      resetShrink();
    }catch(err){
      showMessage(err?.status===410 ? UPDATED : "The map couldn't load. Reload the page to try again.");
      throw err;
    }
  }

  // ---------- proximity: relatedness (data/similarity, optional) ----------
  // Relatedness for every pair of industries in two layers: base (semantic, from the base map alone) and, for a
  // client's map, client (pulled closer where the client's own documents keep discussing two industries together).
  // Markets are scored only against the other markets of their industry. ?layout=base|client picks the layer
  // (default: the file's). With no file, or one built for another hierarchy, the page keeps the sector layout.
  let SIM = null;
  async function loadSimilarity(data){
    try{
      const r=await fetch("data/similarity",{cache:"no-store"});
      if(!r.ok){ console.info("no relatedness file: the old layout (sector ring)"); return null; }
      const s=await r.json(), I=s.industries, slugs=data.themes.map(t=>t.slug);
      const stale = s.version!==2 || !I || I.slugs.length!==slugs.length || slugs.some(x=>!I.slugs.includes(x))
        || Object.entries(data.subthemes||{}).some(([ind,ms])=>{ const M=(s.markets||{})[ind]; return ms.length>1 && (!M || M.slugs.length!==ms.length || ms.some(m=>!M.slugs.includes(m.slug))); });
      if(stale){ console.warn("relatedness file was built for another hierarchy: re-score it. Using the old layout."); return null; }
      const want=new URLSearchParams(location.search).get("layout"), layer = I.layers[want] ? want : s.default;
      const markets=new Map(), links=new Map();
      for(const [ind,M] of Object.entries(s.markets)) M.slugs.forEach((x,i)=>markets.set(x,{ind,i,M}));
      for(const l of s.marketLinks||[]){ links.set(l.a+"|"+l.b,l.score); links.set(l.b+"|"+l.a,l.score); }
      // default: tallest hills (Normal height) in the middle; ?shape=round: evened into a disc without that pull;
      // ?shape=related: the plain relatedness layout (keeps the most neighbours together)
      const shape = new URLSearchParams(location.search).get("shape") || "centre", L=I.layers[layer];
      const pos = (shape==="round" && L.posRound) || (shape==="centre" && L.posCentre) || L.pos;
      return {layer, idx:new Map(I.slugs.map((x,i)=>[x,i])), score:L.score, pos, markets, links};
    }catch(e){ console.warn("relatedness file unreadable: the old layout", e); return null; }
  }
  // a pair's relatedness, 0 to 1. Industries: the layer's score. Markets: their own industry's scores, or a
  // cross-industry link (an arc only, it never moves a hill); 0 for any other pair, so arcs follow real scores
  function simScore(t,o){
    if(!SIM) return null;
    if(t.level!=="subthemes"){ const a=SIM.idx.get(t.slug), b=SIM.idx.get(o.slug); return a==null || b==null ? null : SIM.score[a][b]; }
    const A=SIM.markets.get(t.slug), B=SIM.markets.get(o.slug);
    if(A && B && A.ind===B.ind) return A.M.score[A.i][B.i];
    return SIM.links.get(t.slug+"|"+o.slug) ?? 0;
  }
  const indScore=(a,b)=>{ const i=SIM.idx.get(a), j=SIM.idx.get(b); return i==null || j==null ? 0 : SIM.score[i][j]; };
  // a market's place inside its industry's cluster (unit disc), from its own industry's scores
  const marketOffset=t=>{ const A=SIM && SIM.markets.get(t.slug); return A ? A.M.offset[A.i] : null; };
  // sector stays a light pull only (industries)
  const kinOf=(w,t)=> t.level==="subthemes" ? null : w.items.filter(o=>o!==t && !!t.industrySlug && o.industrySlug===t.industrySlug).map(o=>({id:o.id, score:0.12}));
  // relationships: prefer same GWI industry (sub-themes), then proximity
  function relatedScore(t,o){
    const sim=simScore(t,o);
    if(sim!=null) return {id:o.id, score:sim, sameIndustry: t.level==="subthemes" ? t.parentSlug===o.parentSlug : (!!t.industrySlug && t.industrySlug===o.industrySlug)};
    const d=Math.hypot(o.x-t.x,o.z-t.z);
    const sameIndustry = t.level==="subthemes" ? t.parentSlug===o.parentSlug : ((!!t.industrySlug && t.industrySlug===o.industrySlug) || (t.emergent && o.emergent));
    const score=(sameIndustry?0.46:0.24) + 0.42*Math.max(0,1-d/2.6) + (hash01(t.slug<o.slug ? t.slug+o.slug : o.slug+t.slug)-0.5)*0.12;   // fixed jitter: the same pair always scores the same, so the pack (and every contour) is identical on each re-lay
    return {id:o.id, score:+Math.max(0.08,Math.min(0.97,score)).toFixed(2), sameIndustry};
  }
  function buildMeta(w){
    for(const t of w.items){
      t.kin = SIM ? kinOf(w,t) : null;
      t.related=w.items.filter(o=>o!==t).map(o=>relatedScore(t,o)).filter(r=>!SIM || r.score>0.05).sort((a,b)=>b.score-a.score).slice(0, w.level==="subthemes"?11:6);
      t.similarity=+(t.related.reduce((a,r)=>a+r.score,0)/Math.max(1,t.related.length)).toFixed(2);
      if(!t.summary){
        const top=t.related.length ? w.items[t.related[0].id].name : "no other industry";
        t.summary=`${t.name} appears in ${t.excerpts} excerpts across ${t.sources} sources; its strongest overlap is with ${top}.`;
      }
    }
  }

  // ---------- heightmap: analytic gaussians into a float texture ----------
  // Each theme is a gaussian hill; hills are merged with a p-norm (a smooth max), so
  // ridges have no creases. Float precision keeps the dense contours and hillshade
  // perfectly smooth — an 8-bit canvas would terrace them.
  const HM=512;
  const hmData=new Float32Array(HM*HM);
  const hmTexBase=gl.createTexture(), hmTexShrunk=gl.createTexture(), hmTexIndustry=gl.createTexture();
  // 1-D "shrink field": one value per world-x column, blended in the shader — the slider
  // never repaints the heightmap, it only retargets this field, which then rolls left→right
  const FIELD_N=256, field=new Float32Array(FIELD_N), fieldBytes=new Uint8Array(FIELD_N);
  const fieldTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,fieldTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,FIELD_N,1,0,gl.RED,gl.UNSIGNED_BYTE,fieldBytes);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const fieldAt = x => field[Math.max(0,Math.min(FIELD_N-1,Math.round((x+HALF)/SPAN*(FIELD_N-1))))];

  // ---------- minimap: the 2-D height image, blended per column exactly like the shader ----------
  const hmBase=new Float32Array(HM*HM), hmShrunk=new Float32Array(HM*HM);
  const gNum=new Float32Array(HM*HM*4), gDen=new Float32Array(HM*HM), gData=new Float32Array(HM*HM*4);
  const growthTex=gl.createTexture();
  let introFlat=false;             // the first-load intro holds the terrain flat until it grows it
  // the terrain draws the terrain pane's world (in single views both panes share it)
  const terrainItems=()=>paneA.world.items;
  function flattenBase(){
    hmBase.fill(0); uploadHeightmap(hmTexBase,hmBase);
    for(const t of terrainItems()) t.peakBase=0;
  }
  const mini=document.getElementById("mini"), mctx=mini.getContext("2d");
  const MW=mini.width, miniImg=mctx.createImageData(MW,MW);
  function drawMiniMap(){
    const d=miniImg.data, step=HM/MW;
    for(let y=0;y<MW;y++){
      const sy=Math.min(HM-1,Math.floor(y*step));
      for(let x=0;x<MW;x++){
        const sx=Math.min(HM-1,Math.floor(x*step)), i=sy*HM+sx;
        const f=field[Math.min(FIELD_N-1,Math.round(x/(MW-1)*(FIELD_N-1)))];
        const v=Math.round(Math.min(1,hmBase[i]+(hmShrunk[i]-hmBase[i])*f)*255);
        const o=(y*MW+x)*4; d[o]=v; d[o+1]=v; d[o+2]=v; d[o+3]=255;
      }
    }
    mctx.putImageData(miniImg,0,0);
  }
  function paintHeightmap(tex, scaleOf, peakKey, store){
    hmData.fill(0);
    const doGrowth = tex===hmTexBase; if(doGrowth){ gNum.fill(0); gDen.fill(0); }
    const pxPerUnit=HM/SPAN, P=4;                        // p-norm: a soft max so hills merge
    for(const t of terrainItems()){
      const k=scaleOf(t), gE=t.evRatio??1;                               // per-theme multiplier (1 = untouched)
      const cx=((t.x+HALF)/SPAN)*HM, cy=((t.z+HALF)/SPAN)*HM;
      // super-gaussian (exponent 1.5): flatter top and steeper flank, like the original
      // blurred discs; sigma ≈ the theme's footprint so neighbours blend into ridges
      const sig=t.size*k*0.95*spreadMul*pxPerUnit, hgt=t.height*k;
      const R=Math.ceil(sig*2.6), inv=1/(2*sig*sig);
      const x0=Math.max(0,Math.floor(cx-R)), x1=Math.min(HM-1,Math.ceil(cx+R));
      const y0=Math.max(0,Math.floor(cy-R)), y1=Math.min(HM-1,Math.ceil(cy+R));
      for(let y=y0;y<=y1;y++){
        const dy=y-cy, row=y*HM;
        for(let x=x0;x<=x1;x++){
          const dx=x-cx, g=hgt*Math.exp(-Math.pow((dx*dx+dy*dy)*inv, 1.5));
          const gp=Math.pow(g,P); hmData[row+x]+=gp;
          if(doGrowth){ gNum[(row+x)*4+1]+=gp*gE; gDen[row+x]+=gp; }
        }
      }
    }
    for(let i=0;i<hmData.length;i++) hmData[i]=Math.pow(hmData[i],1/P);
    if(doGrowth){
      for(let i=0;i<gDen.length;i++){ const d=gDen[i], j=i*4; gData[j+1] = d>1e-12 ? gNum[j+1]/d : 1; gData[j+3]=1; }
      gl.bindTexture(gl.TEXTURE_2D,growthTex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,HM,HM,0,gl.RGBA,gl.FLOAT,gData);
      for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
    }
    // zero frame so the clamped edge texel is exactly flat
    const F=12;
    for(let y=0;y<HM;y++) for(let x=0;x<HM;x++){
      if(x<F||y<F||x>=HM-F||y>=HM-F) hmData[y*HM+x]=0;
    }
    if(peakKey){
      for(const t of terrainItems()){
        const cx=Math.round(((t.x+HALF)/SPAN)*HM), cy=Math.round(((t.z+HALF)/SPAN)*HM);
        t[peakKey]=hmData[cy*HM+cx];              // normalised; scaled by height in updatePeaks
      }
    }
    store.set(hmData);
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,HM,HM,0,gl.RED,gl.FLOAT,hmData);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }
  function uploadHeightmap(tex, data){
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,HM,HM,0,gl.RED,gl.FLOAT,data);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }
  function captureVisibleHeightmap(){
    const visible=new Float32Array(HM*HM);
    for(let y=0;y<HM;y++) for(let x=0;x<HM;x++){
      const i=y*HM+x;
      const f=field[Math.min(FIELD_N-1,Math.round(x/(HM-1)*(FIELD_N-1)))];
      visible[i]=hmBase[i]+(hmShrunk[i]-hmBase[i])*f;
    }
    return visible;
  }
  function useVisibleHeightmapAsBase(visible){
    hmBase.set(visible);
    uploadHeightmap(hmTexBase,hmBase);
    for(const t of terrainItems()){
      const cx=Math.round(((t.x+HALF)/SPAN)*HM), cy=Math.round(((t.z+HALF)/SPAN)*HM);
      t.peakBase=hmBase[cy*HM+cx];
    }
  }
  function uploadField(){
    gl.bindTexture(gl.TEXTURE_2D,fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,FIELD_N,1,gl.RED,gl.UNSIGNED_BYTE,fieldBytes);
  }

  let shrinkTarget=0;                               // 0..1 from the slider
  let heightMul=1, spreadMul=1.2, noiseAmp=0;         // the other terrain sliders
  let front=Infinity;                               // x of the rolling front; Infinity = idle
  const BAND=1.2, SWEEP_SPEED=18;                   // world units of overshoot, units per second
  function repaintTerrain(){
    if(!hillPainting) hillEnds = null;   // anything else repainting (brand, level, spread) makes the cached ends stale
    // both extremes are painted once per layout; everything in between is a GPU blend
    paintHeightmap(hmTexBase,   ()=>1,              "peakBase",   hmBase);
    // Ghost contours always reference Industry. hmTexBase may temporarily
    // become the previous brand during a direct brand-to-brand transition.
    uploadHeightmap(hmTexIndustry,hmBase);
    paintHeightmap(hmTexShrunk, t=>1-t.shrinkR,     "peakShrunk", hmShrunk);
    if(introFlat) flattenBase();                    // mid-intro the terrain grows from flat, not from here
    updatePeaks();
    drawMiniMap();
  }
  function updatePeaks(){
    for(const t of terrainItems()) t.peak = (t.peakBase + (t.peakShrunk-t.peakBase)*fieldAt(t.x))*AMP*heightMul;
  }
  function finishDirectTransition(){
    if(directTransitionFinalField===null) return;
    const finalField=directTransitionFinalField;
    directTransitionFinalField=null;
    // Restore the canonical industry → selected-pack textures without changing
    // the visible endpoint. This keeps the manual shrink control meaningful.
    repaintTerrain();
    field.fill(finalField);
    fieldBytes.fill(Math.round(finalField*255));
    shrinkTarget=finalField;
    for(const w of builtWorlds()) for(const t of w.items) t.transitionFromScale=1;
    uploadField();
    updatePeaks();
    drawMiniMap();
  }
  // advance the roll: columns behind the front ease to the target; when the sweep has
  // passed and something is still off-target (the slider moved meanwhile), roll again
  function stepField(dt){
    if(front===Infinity) return false;
    front += SWEEP_SPEED*dt;
    const k=Math.min(1, dt*14);
    let maxd=0;
    for(let i=0;i<FIELD_N;i++){
      const x=-HALF+SPAN*i/(FIELD_N-1);
      if(x<front) field[i]+=(shrinkTarget-field[i])*k;
      maxd=Math.max(maxd,Math.abs(shrinkTarget-field[i]));
      fieldBytes[i]=Math.round(field[i]*255);
    }
    if(front>HALF+BAND){
      if(maxd>0.003) front=-HALF-BAND; else {
        field.fill(shrinkTarget); fieldBytes.fill(Math.round(shrinkTarget*255)); front=Infinity;
        finishDirectTransition();
      }
    }
    uploadField();
    updatePeaks();
    drawMiniMap();
    return true;
  }

  // ---------- geometry: dense plane + one ring of huge flat quads ----------
  // A single structured grid: xs = [-FLOOR, -5 … 5 (SEG steps), FLOOR].
  // The outer ring shares vertices with the dense interior, so there are no
  // T-junctions and no seam — the flat floor continues to the horizon.
  const SEG=256;
  function buildPlane(){
    const xs=[-FLOOR];
    for(let i=0;i<=SEG;i++) xs.push((i/SEG-0.5)*SPAN);
    xs.push(FLOOR);
    const N=xs.length;
    const verts=N*N;
    const pos=new Float32Array(verts*2);   // x,z ; y comes from the shader
    const uv =new Float32Array(verts*2);   // (x+5)/10 — outside [0,1] on the ring (clamped)
    let p=0,u=0;
    for(let j=0;j<N;j++){
      for(let i=0;i<N;i++){
        const x=xs[i], z=xs[j];
        pos[p++]=x; pos[p++]=z;
        uv[u++]=(x+HALF)/SPAN; uv[u++]=(z+HALF)/SPAN;
      }
    }
    const idx=new Uint32Array((N-1)*(N-1)*6); let k=0;
    for(let j=0;j<N-1;j++){
      for(let i=0;i<N-1;i++){
        const a=j*N+i, b=a+1, c=a+N, d=c+1;
        idx[k++]=a; idx[k++]=c; idx[k++]=b;
        idx[k++]=b; idx[k++]=c; idx[k++]=d;
      }
    }
    return {pos,uv,idx,count:idx.length,tris:(N-1)*(N-1)*2};
  }

  // ---------- shaders ----------
  const VERT=`#version 300 es
  precision highp float;
  in vec2 aPos; in vec2 aUv;
  uniform mat4 uProjView;
  uniform sampler2D uMap; uniform sampler2D uMap2; uniform sampler2D uField;
  uniform sampler2D uIndustry;
  uniform float uAmp; uniform float uGhost; uniform float uNoise; uniform float uFlat;
  uniform float uTexel;
  // Terrain ⇄ Bubbles: uSweep 0→1 runs a front across the map, left first; behind it each column
  // collapses to flat (uCollapse 1) or grows back from flat (uCollapse 0). At rest: uSweep 0, uCollapse 1.
  uniform float uSweep; uniform float uCollapse;
  out float vH; out vec2 vUv; out vec3 vWorld; out float vBaseY; out float vKeep;

  // two-octave value noise, only used when the Noise slider is up
  float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
  }

  void main(){
    // force height to zero at the terrain boundary so it meets the flat floor exactly
    float mask = 1.0 - smoothstep(4.5, 5.0, max(abs(aPos.x), abs(aPos.y)));
    float hb = texture(uMap, aUv).r;                          // original
    float hs = texture(uMap2, aUv).r;                         // fully shrunk
    float hn = mix(hb, hs, texture(uField, vec2(aUv.x,0.5)).r); // current, per column
    float hi = texture(uIndustry, aUv).r;
    float c = clamp((uSweep - 0.4*aUv.x)/0.6, 0.0, 1.0);
    c = c*c*(3.0-2.0*c);
    float keep = uCollapse > 0.5 ? 1.0 - c : c;               // how much of this column's height stands
    float h = mix(hn, hi, uGhost) * uAmp * mask * (1.0-uFlat) * keep; // ghost pass always rides Industry; 2-D view is flat
    float n = vnoise(aPos*1.3)*0.65 + vnoise(aPos*2.9)*0.35;
    h += (n-0.5) * uNoise * smoothstep(0.0, 0.4, h) * mask;   // relief only on the hills
    vec3 world = vec3(aPos.x, h, aPos.y);
    vBaseY = h;                              // the surface's own height: contours are measured from it
    if(uGhost > 0.5){
      // the contour lines float an air gap off the terrain, along its normal, so the surface
      // never swallows them, however steep the slope or low the camera
      const float GAP = 0.03;
      float e = uTexel, k = uAmp * mask / (2.0 * e * 10.0);   // 10 = the terrain's span in world units
      float hx = (texture(uIndustry, aUv + vec2(e, 0.0)).r - texture(uIndustry, aUv - vec2(e, 0.0)).r) * k;
      float hz = (texture(uIndustry, aUv + vec2(0.0, e)).r - texture(uIndustry, aUv - vec2(0.0, e)).r) * k;
      world += normalize(vec3(-hx, 1.0, -hz)) * GAP;
    }
    vH = h/uAmp; vUv=aUv; vWorld=world; vKeep=keep;
    gl_Position = uProjView * vec4(world,1.0);
  }`;

  const FRAG=`#version 300 es
  precision highp float;
  in float vH; in vec2 vUv; in vec3 vWorld; in float vBaseY; in float vKeep;
  uniform sampler2D uMap;
  uniform float uAmp; uniform float uTexel;
  uniform float uGhost; uniform sampler2D uMap2; uniform sampler2D uField;
  uniform sampler2D uIndustry;
  float curAt(vec2 uv){                                       // current (blended) height
    return mix(texture(uMap,uv).r, texture(uMap2,uv).r, texture(uField, vec2(uv.x,0.5)).r);
  }
  out vec4 frag;

  uniform sampler2D uRamp; uniform float uFloorT; uniform float uFlat;
  uniform float uEnvelope;                                    // 1 while the ghost pass draws the contours
  // first load: uIntro 1 while it plays; uLines 0→1 draws the full terrain's contours on (the growth itself is a field blend);
  // uDepthOnly lays down that terrain's surface without colour, so only its front contours draw (hidden lines removed)
  uniform float uIntro; uniform float uLines; uniform float uDepthOnly;
  uniform float uUndraw;                                      // 1 = every contour whole; 0→1 draws them on, 1→0 takes them off
  float undrawn(float k){                                     // each contour goes at its own moment, from its own point
    float drawnTo = clamp((uUndraw - fract(sin(k*127.1)*43758.5453)*0.55)/0.45, 0.0, 1.0);
    float along = fract(atan(vWorld.z, vWorld.x)/6.2831853 + fract(sin((k+17.0)*127.1)*43758.5453));
    return 1.0 - smoothstep(drawnTo - 0.015, drawnTo, along);
  }
  float h1(float n){ return fract(sin(n*127.1)*43758.5453); }
  // One contour style everywhere, so a hill's lines weigh the same at full height, shrunk or growing:
  // the UI's ink (white on the dark scales, black on the light ones) at LINE_ALPHA, on the terrain and in the ghost outline.
  uniform vec3 uInk;
  const float LINE_ALPHA = 0.2;
  float contour(float w){                    // an anti-aliased line at every whole w; fwidth guarded, 0/0 would NaN
    return 1.0 - min(abs(fract(w - 0.5) - 0.5) / max(fwidth(w), 1e-5) * 1.25, 1.0);
  }
  vec3 ramp(float t){ return texture(uRamp, vec2(clamp(t,0.0,1.0),0.5)).rgb; }
  uniform sampler2D uGrowth; uniform float uGrowthOn;
  void main(){
    if(uGhost > 0.5){
      if(uDepthOnly > 0.5){ frag = vec4(0.0); return; }
      // ghost wireframe: the Industry terrain's contours over the whole landscape, so the
      // brand's terrain (never taller than Industry) always reads as inside the lines
      float cur  = curAt(vUv);                 // blended height (what is rendered solid)
      float orig = texture(uIndustry, vUv).r;
      float onSurface = 1.0 - step(0.02, orig - cur);     // Industry and brand coincide here
      float gy = vBaseY;                       // the true height, not the lifted pass
      float gw = gy * 24.0;
      float gline = contour(gw) * smoothstep(0.02, 0.08, gy);
      if(uIntro > 0.5){
        // first load: each contour starts drawing at a random moment, from a random point round the map;
        // where the growing terrain has reached it, it hands over to the terrain's own contours
        float k = floor(gw + 0.5);
        float drawnTo = clamp((uLines - h1(k)*0.55)/0.45, 0.0, 1.0);
        float along = fract(atan(vWorld.z, vWorld.x)/6.2831853 + h1(k + 17.0));
        gline *= (1.0 - smoothstep(drawnTo - 0.015, drawnTo, along)) * (1.0 - onSurface);
      }
      if(uUndraw < 1.0) gline *= undrawn(floor(gw + 0.5));
      if(gline < 0.03) discard;
      frag = vec4(uInk, gline*LINE_ALPHA);
      return;
    }
    // the flat floor sits at 10% of magma (dark plum), peaks reach 100%
    // the 2-D pane is a plain floor: no elevation colour and no hillshade, or the hills show through as phantoms
    float t = mix(uFloorT, 1.0, clamp(vH, 0.0, 1.0) * (1.0-uFlat));
    vec3 col = ramp(t);
    if(uGrowthOn > 0.001){
      vec4 f = texture(uGrowth, vUv);
      // Growth keeps each hill's Activity colours (f.g = Activity height over Growth height), so colour still reads as
      // evidence while the shape shows growth. The 12 Nov inverted trial confused readers and was reverted.
      col = mix(col, ramp(mix(uFloorT, 1.0, clamp(vH*f.g, 0.0, 1.0) * (1.0-uFlat))), uGrowthOn);
    }

    // soft hillshade from a wide heightmap gradient stencil (smooth, not gritty)
    float tx = uTexel;
    float hl = curAt(vUv-vec2(tx,0.0));
    float hr = curAt(vUv+vec2(tx,0.0));
    float hd = curAt(vUv-vec2(0.0,tx));
    float hu = curAt(vUv+vec2(0.0,tx));
    vec3 n = normalize(vec3((hl-hr)*uAmp*vKeep, tx*6.0, (hd-hu)*uAmp*vKeep));
    vec3 sun = normalize(vec3(-0.6,0.9,0.5));
    float shade = clamp(dot(n, sun)*0.5+0.5, 0.0, 1.0);
    // relative to flat ground, so the floor is exactly the scale's floor colour in every pane (split views match)
    col *= 1.0 + (shade - (sun.y*0.5+0.5)) * 0.2 * (1.0 - uFlat);

    // procedural contour lines (fract/fwidth); suppressed on the flat floor
    float world = vWorld.y * 24.0;
    float line = contour(world) * smoothstep(0.0, 0.08, vWorld.y);
    if(uUndraw < 1.0) line *= undrawn(floor(world + 0.5));
    // while the ghost pass is drawn it carries every contour, so drop the solid ones to avoid doubling
    col = mix(col, uInk, line*LINE_ALPHA*(1.0-uEnvelope));

    // faint 1-unit world grid on flat ground so the plane reads as infinite
    vec2 fw = max(fwidth(vWorld.xz), vec2(1e-5));
    vec2 g = abs(fract(vWorld.xz - 0.5) - 0.5) / fw;
    float grid = 1.0 - min(min(g.x, g.y), 1.0);
    float onFloor = 1.0 - smoothstep(0.0, 0.12, vWorld.y);
    // fade the grid out where lines get denser than pixels (grazing angles, far zoom)
    float gridFade = 1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y));
    col = mix(col, ramp(0.24), grid * 0.30 * onFloor * gridFade);


    frag = vec4(col,1.0);
  }`;

  function compile(type,src){
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
      throw new Error(gl.getShaderInfoLog(s)+"\n"+src.split("\n").map((l,i)=>(i+1)+": "+l).join("\n"));
    }
    return s;
  }
  let prog;
  try{
    prog=gl.createProgram();
    gl.attachShader(prog,compile(gl.VERTEX_SHADER,VERT));
    gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,FRAG));
    gl.bindAttribLocation(prog,0,"aPos");
    gl.bindAttribLocation(prog,1,"aUv");
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  }catch(e){ msg.hidden=false; msg.textContent="The map can't be drawn in this browser. Try another browser, or turn on hardware acceleration."; console.error(e); return; }

  const U={
    projView: gl.getUniformLocation(prog,"uProjView"),
    map: gl.getUniformLocation(prog,"uMap"),
    amp: gl.getUniformLocation(prog,"uAmp"),
    texel: gl.getUniformLocation(prog,"uTexel"),
    ghost: gl.getUniformLocation(prog,"uGhost"),
    envelope: gl.getUniformLocation(prog,"uEnvelope"),
    intro: gl.getUniformLocation(prog,"uIntro"),
    lines: gl.getUniformLocation(prog,"uLines"),
    depthOnly: gl.getUniformLocation(prog,"uDepthOnly"),
    ink: gl.getUniformLocation(prog,"uInk"),
    map2: gl.getUniformLocation(prog,"uMap2"),
    field: gl.getUniformLocation(prog,"uField"),
    industry: gl.getUniformLocation(prog,"uIndustry"),
    noise: gl.getUniformLocation(prog,"uNoise"),
    ramp: gl.getUniformLocation(prog,"uRamp"),
    floorT: gl.getUniformLocation(prog,"uFloorT"),
    flat: gl.getUniformLocation(prog,"uFlat"),
    sweep: gl.getUniformLocation(prog,"uSweep"),
    collapse: gl.getUniformLocation(prog,"uCollapse"),
    undraw: gl.getUniformLocation(prog,"uUndraw"),
    growth: gl.getUniformLocation(prog,"uGrowth"), growthOn: gl.getUniformLocation(prog,"uGrowthOn"),
  };

  // ---------- upload geometry ----------
  const geo=buildPlane();
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
  const bPos=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,bPos);
  gl.bufferData(gl.ARRAY_BUFFER,geo.pos,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const bUv=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,bUv);
  gl.bufferData(gl.ARRAY_BUFFER,geo.uv,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,0,0);
  const bIdx=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,bIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,geo.idx,gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // ---------- mat4 helpers ----------
  function ident(){ const m=new Float32Array(16); m[0]=m[5]=m[10]=m[15]=1; return m; }
  function multiply(a,b){
    const o=new Float32Array(16);
    for(let c=0;c<4;c++) for(let r=0;r<4;r++){
      o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
    }
    return o;
  }
  function ortho(l,r,b,t,n,f){
    const m=ident();
    m[0]=2/(r-l); m[5]=2/(t-b); m[10]=-2/(f-n);
    m[12]=-(r+l)/(r-l); m[13]=-(t+b)/(t-b); m[14]=-(f+n)/(f-n);
    return m;
  }
  function lookAt(eye,ctr,up){
    let z=[eye[0]-ctr[0],eye[1]-ctr[1],eye[2]-ctr[2]];
    let zl=Math.hypot(...z)||1; z=z.map(v=>v/zl);
    let x=[up[1]*z[2]-up[2]*z[1], up[2]*z[0]-up[0]*z[2], up[0]*z[1]-up[1]*z[0]];
    let xl=Math.hypot(...x)||1; x=x.map(v=>v/xl);
    let y=[z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
    const m=ident();
    m[0]=x[0];m[4]=x[1];m[8]=x[2];
    m[1]=y[0];m[5]=y[1];m[9]=y[2];
    m[2]=z[0];m[6]=z[1];m[10]=z[2];
    m[12]=-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]);
    m[13]=-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]);
    m[14]=-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]);
    return m;
  }
  function transform(m,v){ // returns [x,y,z,w]
    return [
      m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],
      m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],
      m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14],
      m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15],
    ];
  }

  // ---------- panes: each visualisation owns a camera, viewport, label layer and arcs ----------
  let PANEL_W=560; let panelT=0;   // the panel's width, set by dragging its border (setPanelWidth)            // the room the open panel takes: 400 wide, inset 22, a 22 gap
  const MAX_ZOOM=8, R=12, DEFAULT_THETA=0.7;
  const makeCam=phi=>({theta:DEFAULT_THETA, phi, phiTarget:phi, zoom:1, center:[0,0.4,0],
                        centerTarget:null, zoomTarget:null, thetaTarget:null});
  const panes=[
    {id:"A", mode:"3d", cam:makeCam(Math.PI*0.28), labelsEl:document.getElementById("labels"),
     rect:[0,0,1,1], visible:true,  projView:ident(), labelNodes:[], arcVao:null, arcBuf:null, arcVerts:0,
     world:null, active:new Set(), related:new Set(), hover:null, rangeActive:null},
    {id:"B", mode:"2d", cam:makeCam(0.02),         labelsEl:document.getElementById("labelsB"),
     rect:[0,0,1,1], visible:false, projView:ident(), labelNodes:[], arcVao:null, arcBuf:null, arcVerts:0,
     world:null, active:new Set(), related:new Set(), hover:null, rangeActive:null},
  ];
  const paneA=panes[0], paneB=panes[1];
  let tab="3d";                                          // "3d" | "2d" | "split"
  const visiblePanes=()=>panes.filter(p=>p.visible);
  const divider=document.getElementById("divider");
  const bubblesEl=document.getElementById("bubbles");
  const paneLevelEls=document.querySelectorAll(".pane-level");

  // viewport rectangles (CSS px, y down). The side panel takes the right edge; in split
  // mode the remaining width is shared.
  function layoutPanes(){
    // the terrain runs on behind the floating panel: the right-hand pane keeps the full width and only its
    // centre moves left (p.shift, px under the panel), so the selection still sits mid-way in what shows
    const W=canvas.clientWidth, H=canvas.clientHeight;
    const covered = W>640 ? PANEL_W*panelT : 0, visible=W-covered;
    if(viewFx){ paneA.rect=[0,0,W,H]; paneB.rect=[0,0,W,H]; paneA.shift=paneB.shift=covered; }
    else if(tab==="split"){ const w=visible/2; paneA.rect=[0,0,w,H]; paneB.rect=[w,0,W-w,H]; paneA.shift=0; paneB.shift=covered; }
    else if(tab==="2d"){ paneB.rect=[0,0,W,H]; paneB.shift=covered; }
    else { paneA.rect=[0,0,W,H]; paneA.shift=covered; }
    for(const p of panes){
      p.labelsEl.style.display=p.visible?"":"none";
      p.labelsEl.style.left=p.rect[0]+"px"; p.labelsEl.style.width=p.rect[2]+"px";
    }
    bubblesEl.style.left=paneB.rect[0]+"px"; bubblesEl.style.width=paneB.rect[2]+"px";
    divider.style.display = tab==="split" ? "block" : "none"; divider.style.left=paneB.rect[0]+"px";
    for(const el of paneLevelEls) el.style.left=((el.dataset.pane==="A" ? paneA : paneB).rect[0]+22)+"px";
  }
  // the width of a pane that will show once the side panel has finished opening or closing
  const settledWidth=p=>{
    const W=canvas.clientWidth, visible = W>640 && panelOpen ? W-PANEL_W : W;
    return tab==="split" ? visible/2 : visible;
  };
  const posOf=(p,t)=> p.mode==="2d" ? [t.bx??t.x, t.bz??t.z] : [t.x, t.z];
  const pxPerUnit=p=> p.rect[3]*p.cam.zoom/12.4;           // ortho: px per world unit
  function project(p,world){                                // world → pane-local px
    const c=transform(p.projView,world);
    return [(c[0]/c[3]*0.5+0.5)*p.rect[2], (1-(c[1]/c[3]*0.5+0.5))*p.rect[3], c[2]/c[3], c[0]/c[3], c[1]/c[3]];
  }

  function updateCamera(p){
    const c=p.cam, k=reduceMotion ? 1 : 0.1;            // under reduced motion the camera jumps to its target
    c.phi += (c.phiTarget-c.phi)*(reduceMotion ? 1 : 0.12);
    if(c.centerTarget){
      const g=c.centerTarget, o=c.center;
      o[0]+=(g[0]-o[0])*k; o[1]+=(g[1]-o[1])*k; o[2]+=(g[2]-o[2])*k;
      if(Math.hypot(g[0]-o[0],g[1]-o[1],g[2]-o[2])<0.005) c.centerTarget=null;
    }
    if(c.zoomTarget!==null){ c.zoom+=(c.zoomTarget-c.zoom)*k; if(Math.abs(c.zoomTarget-c.zoom)<0.002) c.zoomTarget=null; }
    if(c.thetaTarget!==null){ c.theta+=(c.thetaTarget-c.theta)*k; if(Math.abs(c.thetaTarget-c.theta)<0.002) c.thetaTarget=null; }
    const phi=Math.max(0.02,c.phi), sp=Math.sin(phi), cp=Math.cos(phi);
    const eye=[c.center[0]+R*sp*Math.sin(c.theta), c.center[1]+R*cp, c.center[2]+R*sp*Math.cos(c.theta)];
    const aspect=p.rect[2]/Math.max(1,p.rect[3]), s=6.2/c.zoom;
    // slide the box right by half the covered width, so the centre sits mid-way in the part that shows
    const dx=(p.shift||0)/Math.max(1,p.rect[2])*s*aspect;
    // the orthographic box extends far behind and ahead so the ±600 floor is never clipped
    p.projView=multiply(ortho(-s*aspect+dx,s*aspect+dx,-s,s,-900,1800), lookAt(eye,c.center,[0,1,0]));
  }
  function defaultZoom(p){
    const aspect=settledWidth(p)/Math.max(1,p.rect[3]);
    const half = p.mode==="2d" ? p.world.clusterR+0.3 : 4.6;   // island half-extent, with a margin
    return Math.min(MAX_ZOOM,Math.max(0.45, 6.2/Math.max(half, half/aspect)));
  }

  // ---------- selection and hover, across panes that may show different levels ----------
  // `sel` and `hov` are items from any world. A pane shows an item of its own level as itself; a theme on a
  // Sub-themes pane as its cluster of sub-themes (and its range name), or as its own peak when it has no
  // sub-themes; a sub-theme on a Themes pane as its parent theme.
  let sel=null, hov=null;
  function inPane(p, t){
    if(!t) return null;
    const W=p.world;
    if(t.w===W) return {item:t};
    const same=W.bySlug.get(t.slug);
    if(same) return {item:same};
    if(t.level==="themes") return {cluster:W.items.filter(o=>o.parentSlug===t.slug), range:t.slug};
    const parent=W.bySlug.get(t.parentSlug);
    return parent ? {item:parent, parent:true} : null;
  }
  /** Hover an item everywhere it is drawn: its label (as a pill, always shown) and bubble on each pane, or
   *  the range name of its cluster, and its row in the panel. */
  function setHover(t){
    if(t===hov) return;
    hov=t;
    showPerfTip(t);
    const rp=rangePane();
    for(const p of panes){
      const s=inPane(p,t);
      p.hover = s?.item ? s.item.id : null;
      for(const L of p.labelNodes) L.el.classList.toggle("hover",L.t.id===p.hover);
      if(p===rp) for(const r of worlds.subthemes.rangeCentres) r.el?.classList.toggle("hover", !!s?.range && s.range===r.slug);
    }
    for(const B of bubbleNodes) B.g.classList.toggle("hover",B.t.id===paneB.hover);
    for(const li of document.querySelectorAll("#pRelated li")) li.classList.toggle("hover",!!t && li.dataset.slug===t.slug);
    // a sub-theme of the selected theme: light its row in the evidence too
    const parent=selectedParentSlug();
    markEvidenceTopic(t && t.isSubTheme && t.parentSlug===parent ? t.subKey : null);
  }
  /** A headline figure shrinks to fit its tile rather than run out of it (a four-digit count, 100%). */
  function fitFigure(b){
    b.style.fontSize="";
    const room=b.clientWidth, need=b.scrollWidth;
    if(room && need>room) b.style.fontSize=Math.floor(parseFloat(getComputedStyle(b).fontSize)*room/need)+"px";
  }
  /** The theme whose evidence the panel shows: the selected theme, or a selected sub-theme's theme. */
  function selectedParentSlug(){
    return sel ? (sel.isSubTheme ? sel.parentSlug : sel.slug) : null;
  }
  function markEvidenceTopic(key){
    for(const row of document.querySelectorAll("#pEvidenceBody [data-key]")) row.classList.toggle("hover",key!=null && row.dataset.key===key);
  }
  /** Hover one of the selected theme's sub-themes: its row in the evidence and, where sub-themes are shown, its peak. */
  let hoverTopic=null;
  function setTopicHover(key){
    if(key===hoverTopic) return;
    hoverTopic=key;
    markEvidenceTopic(key);
    const W=worlds.subthemes;
    if(W && visiblePanes().some(p=>p.world===W)){
      const parent=selectedParentSlug();
      setHover(key==null || !parent ? null : W.items.find(t=>t.isSubTheme && t.parentSlug===parent && t.subKey===key) || null);
    }
  }
  /**
   * A pane's labels, one per peak of its world. Mid-roll (`animate`), the old labels stay where they were
   * to bow out as the roll reaches them, and the new ones build on behind it; otherwise they simply appear.
   */
  function buildLabels(p, animate=false){
    if(animate){ for(const L of p.labelNodes){ if(L.shown){ L.el.classList.add("leaving"); leavingLabels.push(L); } else L.el.remove(); } }
    else { for(const L of p.labelNodes) L.el.remove(); }
    p.labelsEl.classList.toggle("ranges", p.world.level==="subthemes");   // a range shows only the names in play
    p.labelNodes=p.world.items.map(t=>{
      const el=document.createElement("button");
      el.type="button"; el.className="label"; el.setAttribute("aria-pressed","false");
      el.tabIndex=-1;                                     // for the mouse: keyboards reach every peak through the peak list
      el.dataset.layer=t.layer; if(t.verdict) el.dataset.verdict=t.verdict; if(t.noDemand){ el.dataset.nodemand=""; el.title="No research yet on why people buy here"; }
      const txt=document.createElement("span"); txt.className="txt"; txt.textContent=t.name;
      const dot=document.createElement("span"); dot.className="dot";
      el.append(txt,dot);
      el.addEventListener("click",()=>clickItem(p,t));
      el.addEventListener("pointerenter",()=>setHover(t));
      el.addEventListener("pointerleave",()=>setHover(null));
      p.labelsEl.appendChild(el);
      return {t,el};
    });
  }
  function updateLabels(p){
    const flat=p.mode==="2d", placed=[];
    const rank=L=> L.t.id===p.hover ? 3 : p.active.has(L.t.id) ? 2 : p.related.has(L.t.id) ? 1 : 0;
    const order=[...p.labelNodes].sort((a,b)=> rank(b)-rank(a) || b.t.height-a.t.height);
    for(const L of order){
      const [lx,lz]=posOf(p,L.t);
      const wy= flat ? 0 : (L.t.peak ?? L.t.height*AMP)+0.03;   // the dot sits on the summit
      const [sx,sy,ndcz,ndcx,ndcy]=project(p,[lx,wy,lz]);
      let show = ndcz>-1 && ndcz<1 && ndcx>-1.1 && ndcx<1.1 && ndcy>-1.1 && ndcy<1.1;
      if(show){
        const w=L.t.name.length*7.2+22, x0=sx-w/2, x1=sx+w/2;
        const y0= flat ? sy-14 : sy-35, y1= flat ? sy+14 : sy+4;
        // hovered, selected and related labels always show; everything else yields to what's placed
        if(rank(L)===0){ for(const r of placed){ if(x0<r[2] && x1>r[0] && y0<r[3] && y1>r[1]){ show=false; break; } } }
        if(show) placed.push([x0,y0,x1,y1]);
      }
      L.sx=sx; L.sy=sy; L.shown=show;
      if(p===paneB && viewFx){ const g=bubbleGrowAt(p,sx); L.el.style.opacity = g<1 ? g.toFixed(3) : ""; }   // with its bubble
      if(show){
        L.el.style.display="";
        L.el.style.transform=`translate(-50%,${flat?"-50%":"-100%"}) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      } else L.el.style.display="none";
    }
  }

  // ---------- 2-D bubbles (pane B): circle area = freq share, or industry $ when Size · $ ----------
  const SVG_NS="http://www.w3.org/2000/svg";
  let bubbleNodes=[];
  const bubbleR0 = t => 0.10 + 0.62*Math.sqrt(Math.max(0.02, t.mentions));
  const rangeRoom = t => t.size*1.12;                        // Sub-themes: the room a peak / circle owns
  // world units, the same space as the terrain; a world's bubbleScale is set by its layout so circles fit the island
  const bubbleR = t => t.level==="subthemes" ? rangeRoom(t)*0.94 : bubbleR0(t)*t.w.bubbleScale;
  let packStats=null;
  // relationship-based packing: seed every circle from the relaxed community layout (which
  // encodes similarity), relax — circles push apart, each is pulled toward its seed and its
  // related themes — then a pure collision pass guarantees nothing overlaps
  function relationshipPack(items, gap=0.045){
    const n=items.length;
    const area=items.reduce((a,it)=>a+Math.PI*it.r*it.r,0);
    const S=Math.sqrt(area/((SIM ? 0.5 : 0.78)*Math.PI))/3.4, seedK = SIM ? 0.08 : 0.03;
    for(const it of items){ it.x=it.t.x*S; it.z=it.t.z*S; it.sx=it.x; it.sz=it.z; }
    const byId=new Map(items.map(it=>[it.t.id,it]));
    const collide=k=>{
      let worst=0;
      for(let a=0;a<n;a++) for(let b=a+1;b<n;b++){
        const A=items[a], B=items[b], dx=B.x-A.x, dz=B.z-A.z, d=Math.hypot(dx,dz)||1e-6, ov=A.r+B.r+gap-d;
        if(ov>0){ worst=Math.max(worst,ov); const px=dx/d*ov*0.5*k, pz=dz/d*ov*0.5*k; A.x-=px; A.z-=pz; B.x+=px; B.z+=pz; }
      }
      return worst;
    };
    for(let it=0; it<300; it++){
      for(const c of items){
        c.x+=(c.sx-c.x)*seedK; c.z+=(c.sz-c.z)*seedK;
        for(const r of (c.t.kin ? c.t.related.concat(c.t.kin) : c.t.related)){
          const o=byId.get(r.id); if(!o) continue;
          const dx=o.x-c.x, dz=o.z-c.z, d=Math.hypot(dx,dz)||1e-6, rest=c.r+o.r+gap;
          if(d>rest){ const f=(d-rest)/d*0.006*r.score; c.x+=dx*f; c.z+=dz*f; }
        }
        c.x-=c.x*0.002; c.z-=c.z*0.002;
      }
      collide(0.7);
    }
    let worst=Infinity, iters=0;
    while(iters<4000 && (worst=collide(1))>1e-4) iters++;
    packStats={worst, iters};
    return items;
  }
  // Terrain pack: frequency radii → t.x/t.z. Bubble pack: the same radii → t.bx/t.bz (the 2-D view only).
  /** Start every sub-theme at its theme's place in the Themes layout; applyRangeLayout clusters them from there. */
  function seedFromThemeLayout(w){
    const T=world("themes");
    for(const t of w.items){
      const at=T.bySlug.get(t.parentSlug);
      if(at){ t.x=t.bx=at.x; t.z=t.bz=at.z; }
    }
  }
  function packTerrainLayout(w){
    const packed=relationshipPack(w.items.map(t=>({t,r:bubbleR0(t)})));
    const ext=Math.max(...packed.map(q=>Math.max(Math.abs(q.x),Math.abs(q.z))), 1e-6);
    const reach=t=>2*0.95*Math.max(spreadMul,1.2)*Math.max(t.size, t.evidenceSize??0, t.marketFoot??0);
    const fit=Math.max(...packed.map(q=>(Math.max(Math.abs(q.x),Math.abs(q.z))*3.4/ext + reach(q.t))/(HALF-0.1)), 1);
    const S = SIM ? 3.4/ext/fit : 3.4/ext;   // relatedness layouts only; the old layout is left as it was
    for(const q of packed){ q.t.x=q.t.bx=q.x*S; q.t.z=q.t.bz=q.z*S; }
  }

  /** Sub-themes: each theme is a cluster of its sub-theme peaks. Clusters are packed like the bubbles
   *  (related sectors pull together) rather than set on a ring. Run once per world: it resizes the peaks. */
  function applyRangeLayout(w){
    const items=w.items, groups=new Map();
    for(const t of items){ if(!groups.has(t.parentSlug)) groups.set(t.parentSlug, []); groups.get(t.parentSlug).push(t); }
    const rOf=rangeRoom;                                   // room a peak needs so neighbours stay separate summits (and circles never overlap)
    const proxies=[...groups.entries()].map(([slug,members],i)=>{
      const m0=members[0];
      return {id:i, slug, members, title:m0.parentTitle, sector:m0.emergent?"__emergent":m0.industrySlug,
        x:m0.x, z:m0.z, related:[], r:Math.max(0.2, Math.sqrt(members.reduce((a,t)=>a+rOf(t)*rOf(t),0))*1.3)};
    });
    for(const g of proxies) g.related = SIM
      ? proxies.filter(o=>o!==g).map(o=>({id:o.id, score:indScore(g.slug,o.slug)})).sort((a,b)=>b.score-a.score).slice(0,6)
      : proxies.filter(o=>o!==g && o.sector===g.sector).map(o=>({id:o.id, score:0.5}));
    const packed=relationshipPack(proxies.map(g=>({t:g, r:g.r})), 0.22);
    const ext=Math.max(...packed.map(q=>Math.max(Math.abs(q.x)+q.r, Math.abs(q.z)+q.r)), 1e-6);
    const S=Math.min(1, 4.3/ext);
    w.rangeCentres=[];
    for(const q of packed){
      const g=q.t, cx=q.x*S, cz=q.z*S;
      const order=[...g.members].sort((a,b)=>b.excerpts-a.excerpts);
      order.forEach((t,j)=>{ const off=marketOffset(t), a=j*2.39996+hash01(g.slug)*6.28, d=rOf(t)*1.6*Math.sqrt(j)*S; if(off && order.length>1){ t.x=cx+off[0]*g.r*S*0.7; t.z=cz+off[1]*g.r*S*0.7; } else { t.x=cx+Math.cos(a)*d; t.z=cz+Math.sin(a)*d; } if(S<1){ t.size*=S; t.height*=Math.max(0.45,S); } });   // footprint and height shrink together, or peaks turn to needles
      for(let it=0;it<60;it++){
        for(let a=0;a<order.length;a++){
          order[a].x+=(cx-order[a].x)*0.02; order[a].z+=(cz-order[a].z)*0.02;
          for(let b=a+1;b<order.length;b++){
            const A=order[a], B=order[b]; let dx=B.x-A.x, dz=B.z-A.z; const d=Math.hypot(dx,dz)||1e-6, min=rOf(A)+rOf(B);
            if(d<min){ const k=(min-d)/d*0.5; dx*=k; dz*=k; A.x-=dx; A.z-=dz; B.x+=dx; B.z+=dz; }
          }
        }
      }
      w.rangeCentres.push({slug:g.slug, title:g.title, x:cx, z:cz, n:g.members.length, members:g.members});
    }
    // final pass over every peak: push apart anything still touching, within a range or between ranges
    for(let it=0, worst=1; it<600 && worst>1e-4; it++){
      worst=0;
      for(let a=0;a<items.length;a++) for(let b=a+1;b<items.length;b++){
        const A=items[a], B=items[b], dx=B.x-A.x, dz=B.z-A.z, d=Math.hypot(dx,dz)||1e-6;
        const ov=rOf(A)+rOf(B)+(A.parentSlug===B.parentSlug?0:0.06)-d;
        if(ov>0){ worst=Math.max(worst,ov); const px=dx/d*ov*0.5, pz=dz/d*ov*0.5; A.x-=px; A.z-=pz; B.x+=px; B.z+=pz; }
      }
    }
    for(const q of w.rangeCentres){                         // range names follow their peaks
      const ms=items.filter(t=>t.parentSlug===q.slug);
      q.x=ms.reduce((a,t)=>a+t.x,0)/ms.length; q.z=ms.reduce((a,t)=>a+t.z,0)/ms.length;
    }
    for(const t of items){
      t.x=Math.max(-4.4,Math.min(4.4,t.x)); t.z=Math.max(-4.4,Math.min(4.4,t.z));
      t.bx=t.x; t.bz=t.z;                                  // the 2-D view mirrors the same clusters
    }
    w.bubbleScale=0.62*S;
    w.clusterR=Math.max(3.2, ...items.map(t=>Math.hypot(t.x,t.z)+0.35));
  }

  // ---------- range names: each theme's name over its cluster, on the pane that shows sub-themes ----------
  const rangeLabelsEl=document.getElementById("rangeLabels");
  /** The pane the range names sit on: the first visible one showing sub-themes, the terrain first. */
  function rangePane(){ return visiblePanes().find(p=>p.world.level==="subthemes") || null; }
  function buildRangeLabels(){
    const el=rangeLabelsEl;
    if(!el) return;
    el.innerHTML="";
    const rp=rangePane(), W=worlds.subthemes;
    if(!rp || !W.rangeCentres.length){
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");                       // still aria-hidden: the peak list names the peaks
    for(const r of W.rangeCentres){
      const d=document.createElement("div");
      d.className="range-label";
      d.title=`${r.title} · ${r.n} ${r.n===1?"market":"markets"}`;
      const txt=document.createElement("span"); txt.className="txt"; txt.textContent=r.title; d.appendChild(txt);
      // no rollover; a click still opens the industry (its markets' names stay hidden until then)
      d.style.pointerEvents="auto"; d.style.cursor="pointer";
      d.addEventListener("click",()=>{ const theme=world("themes").bySlug.get(r.slug); if(theme) select(sel===theme ? null : theme); });
      el.appendChild(d);
      r.el=d;
    }
    for(const r of W.rangeCentres) r.el?.classList.toggle("active", rp.rangeActive===r.slug);
  }

  function updateRangeLabels(p){
    if(p!==rangePane()) return;
    const W=worlds.subthemes;
    const el=rangeLabelsEl;
    el.style.left=p.rect[0]+"px";
    el.style.width=p.rect[2]+"px";
    el.style.top=p.rect[1]+"px";
    el.style.height=p.rect[3]+"px";
    const placed=[];
    for(const r of [...W.rangeCentres].sort((a,b)=>b.n-a.n)){
      if(!r.el) continue;
      // tilted: over the middle of the cluster at its tallest summit's height (a ground point lands on the
      // hills in front), lifted clear of the summit's own name. Top-down: the middle of the cluster.
      const flat=p.mode==="2d", hOf=t=>t.peak??t.height*AMP;
      const top=r.members.reduce((a,t)=>hOf(t)>hOf(a)?t:a);
      // an industry with no markets of its own is one peak with the same name: the market name says it
      if(r.members.length===1 && top.name===r.title){ r.el.style.display="none"; continue; }
      const [ax,az]= flat ? [r.x, r.z] : r.members.length===1 ? posOf(p,top) : [r.x, r.z];
      const [sx,sy0,ndcZ]=project(p,[ax, flat ? 0.05 : hOf(top)+0.03, az]);
      let sy= flat ? sy0 : sy0-48;
      const w=r.title.length*6.4+18, hh=9;                // the lozenge's width and half-height
      // market names come first: step up past any it would cover; if it still can't fit, leave it out
      const marketBoxes=p.labelNodes.filter(L=>L.shown).map(L=>{ const lw=L.t.name.length*7.2+22;
        return flat ? [L.sx-lw/2, L.sy-14, L.sx+lw/2, L.sy+14] : [L.sx-lw/2, L.sy-35, L.sx+lw/2, L.sy+4]; });
      let clash=null;
      for(let k=0;k<6;k++){
        clash=marketBoxes.find(q=>sx-w/2<q[2] && sx+w/2>q[0] && sy-hh<q[3] && sy+hh>q[1]);
        if(!clash) break;
        sy=clash[1]-hh-2;
      }
      if(clash){ r.el.style.display="none"; continue; }
      const box=[sx-w/2, sy-hh, sx+w/2, sy+hh];
      const off = ndcZ>1 || ndcZ<-1 || sx<-40 || sy<-20 || sx>p.rect[2]+40 || sy>p.rect[3]+20;
      const hit = placed.some(q=>box[0]<q[2] && box[2]>q[0] && box[1]<q[3] && box[3]>q[1]);
      if(off || hit){ r.el.style.display="none"; continue; }
      placed.push(box);
      r.el.style.display="";
      r.el.style.left=sx+"px";
      r.el.style.top=sy+"px";
    }
  }

  function packBubbleLayout(w){
    // relationshipPack seeds from t.x/t.z (terrain), then only bx/bz are written, so the terrain stays put
    const packed=relationshipPack(w.items.map(t=>({t,r:bubbleR0(t)})));
    const ext=Math.max(...packed.map(q=>Math.max(Math.abs(q.x),Math.abs(q.z))), 1e-6);
    w.bubbleScale=3.4/ext;
    for(const q of packed){ q.t.bx=q.x*w.bubbleScale; q.t.bz=q.z*w.bubbleScale; }
    w.clusterR=Math.max(...w.items.map(t=>Math.hypot(t.bx, t.bz)+bubbleR(t)));
  }
  function buildBubbles(){
    bubblesEl.innerHTML=""; bubbleNodes=[];
    for(const t of paneB.world.items){
      const g=document.createElementNS(SVG_NS,"g"); g.setAttribute("class","b");
      const outer=document.createElementNS(SVG_NS,"circle"); outer.setAttribute("class","outer");
      const inner=document.createElementNS(SVG_NS,"circle"); inner.setAttribute("class","inner");
      inner.addEventListener("click",()=>clickItem(paneB,t));
      inner.addEventListener("pointerenter",()=>setHover(t));
      inner.addEventListener("pointerleave",()=>setHover(null));
      if(t.verdict) g.dataset.verdict=t.verdict;
      if(t.emergent || t.layer==="emergent") g.dataset.layer="emergent";   // an emergent theme, or a market the research added: a dashed outline (CSS)
      g.append(outer,inner); bubblesEl.appendChild(g);
      bubbleNodes.push({t,g,outer,inner});
    }
  }

  // ---------- evidence: the verbatim passages behind the selected theme, a document at a time ----------
  const evidenceUrl=(()=>{                             // beside the bundle this page was given
    const u=new URL("data/bundle", location.href);
    u.pathname=u.pathname.replace(/\/bundle$/,"/evidence"); u.search="";
    return u;
  })();
  const evidenceCache=new Map();
  let evidenceFor=null;                                // what the panel should be showing; late answers for anything else are dropped
  const docName=title=>title.replace(/\.(pdf|md|docx?|txt|html?|csv|xlsx?|pptx?)$/i,"");   // the name, without its file type
  /** Show the theme's evidence in the panel; `focus` (a topic's key) opens that topic and brings it into view. */
  async function loadEvidence(themeId, focus){
    evidenceFor=themeId;
    const box=document.getElementById("pEvidence"), body=document.getElementById("pEvidenceBody");
    box.hidden=false;
    let data=evidenceCache.get(themeId);
    if(!data){
      body.innerHTML="";
      const note=document.createElement("p"); note.className="ev-note"; note.textContent="Loading…"; body.appendChild(note);
      try{
        const u=new URL(evidenceUrl); u.searchParams.set("theme",themeId);
        const r=await fetch(u,{cache:"no-store"}); if(!r.ok){ const e=new Error(String(r.status)); e.status=r.status; throw e; }
        data=cleanSummaries(await r.json()); evidenceCache.set(themeId,data);
      }catch(e){
        if(evidenceFor===themeId) note.textContent = e?.status===410 ? UPDATED : "These documents couldn't load. Reload the page to try again.";
        return;
      }
    }
    await docsReady;
    if(evidenceFor===themeId) renderEvidence(data,themeId,focus);
  }
  const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
  function renderEvidence(data,themeId,focus){
    const body=document.getElementById("pEvidenceBody");
    hoverTopic=null;
    // the headline counts the same excerpts: the theme's, or the one topic's when a topic is what's selected
    const focused=data.topics.find(t=>t.key===focus);
    if(sel && sel.isSubTheme){
      const rank=new Map(data.topics.map((tp,i)=>[tp.key,i])), list=document.getElementById("pRelated");
      const at=li=>rank.get(sel.w.bySlug.get(li.dataset.slug)?.subKey) ?? Infinity;
      list.append(...[...list.children].sort((a,b)=>at(a)-at(b)));
    }
    fillDocKpis(sel && sel.isSubTheme ? focus : themeId);
    body.innerHTML="";
    const peak = sel && sel.isSubTheme ? focus : themeId;
    renderDocCards(body, docsData?.peaks[peak] || [], {
      height: heightOf(peak),
      // in the industry view the markets become filters on the cards; hovering one lights its peak, as before
      markets: sel && sel.isSubTheme ? null : data.topics.filter(t=>t.key!=="general"),
      hasGeneral: data.topics.some(t=>t.key==="general"),
    });
    const docRows=docsData?.peaks[peak]||[], adding=docRows.filter(r=>r.adds>0).length;
  }

  // ---------- documents: every document once (library) and the documents behind each peak ----------
  let docsData=null;
  /** Drop the extraction's "Unconfirmed:" flag from every summary in a payload (in place), capitalising what follows. */
  function cleanSummaries(x){
    if(Array.isArray(x)) x.forEach(cleanSummaries);
    else if(x && typeof x==='object') for(const k in x){ const v=x[k];
      if(k==='summary' && typeof v==='string' && /^Unconfirmed:\s*/.test(v)){ const t=v.replace(/^Unconfirmed:\s*/,''); x[k]=t.charAt(0).toUpperCase()+t.slice(1); }
      else if(v && typeof v==='object') cleanSummaries(v); }
    return x;
  }
  // the counts the Documents section shows, for the top boxes: documents (and how many add height), excerpts
  // (and how many come from documents that only mention the peak in passing)
  const peakKey = t => t.isSubTheme ? t.subKey : t.slug;
  function peakCounts(key){
    const rows = docsData?.peaks?.[key]; if(!rows) return null;
    const add = rows.filter(r=>r.adds>0), ex = rows.reduce((a,r)=>a+(r.excerptCount||0),0), exAdd = add.reduce((a,r)=>a+(r.excerptCount||0),0);
    return {docs:rows.length, adding:add.length, ex, exPassing:ex-exAdd};
  }
  // brand presence detail (data/presence, optional): counts and document kinds per hill; a missing file = no lines
  let presenceData=null;
  function loadPresence(){
    return fetch(new URL("data/presence", location.href),{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null)
      .then(d=>{ presenceData = d && typeof d==="object" && d.hills && typeof d.hills==="object" ? d : null; if(sel && step==='brand') renderFigures(sel); });
  }
  loadPresence();
  const brandName = () => verdictData?.brands?.[subset]?.title || "the brand";
  const BRAND_STATES=[["sells","Sells",0.9],["explores","Explores",0.62],["perceived","Seen as",0.4],["studies","Researches",0.2]];   // one muted family
  function brandCard(t, c, el, big){
    const P=presenceData?.hills?.[peakKey(t)];
    const st = P?.states || t.brandStates || {};
    const own = t.isSubTheme && P;   // a market reads its own counts; the presence share stays its industry's
    if(t.mentionCount){ const b=el('b','fig-big',`${t.strength[0].toUpperCase()+t.strength.slice(1)} \u2022 ${Math.round(t.presence*100) || '<1'}%`); big.push(b); c.append(b); }
    else c.append(el('div','fig-none','No presence yet'));
    const tint=a=>`color-mix(in srgb, var(--ink) ${Math.round(a*100)}%, transparent)`;
    const parts=BRAND_STATES.filter(([k])=>st[k]>0);
    if(parts.length){
      const bar=el('div','pres-bar'); bar.title=`How ${brandName()} shows up here, by finding`;
      for(const [k,lbl,a] of parts){ const seg=el('i'); seg.style.flexGrow=st[k]; seg.style.background=tint(a); seg.title=`${lbl}: ${st[k]}`; bar.append(seg); }
      const leg=el('div','fig-note pres-legend');
      for(const [k,lbl,a] of parts){ const it=el('span'); const dot=el('i'); dot.style.background=tint(a); it.append(dot, `${lbl} `, el('b',null,String(st[k]))); leg.append(it); }
      c.append(bar, leg);
    }
    if(P && P.types && Object.keys(P.types).length){   // the kinds of documents, most first, other last
      const G=Object.fromEntries((presenceData.groups||[]).map(g=>[g.key,g])), cap1=w=>w.charAt(0).toUpperCase()+w.slice(1);
      const kinds=el('div','fig-note pres-kinds');
      for(const [k,n] of Object.entries(P.types).sort((x,y)=>(x[0]==='other')-(y[0]==='other') || y[1]-x[1])){
        const it=el('span'); it.append(el('b',null,String(n)), ' '+cap1(n===1?(G[k]?.one||k):(G[k]?.many||k))); kinds.append(it);
      }
      c.append(kinds);
    }
  }
  function renderFigures(t){
    const box=document.getElementById('pKpis'); box.className='figs'; box.innerHTML='';
    const el=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; };
    const card=(label,title,into=box)=>{ const c=el('div','fig-card'); if(title) c.title=title; c.append(el('div','fig-lbl',label)); into.append(c); return c; };
    const big=[];
    // the same in Normal and Performance: market size, growth, leaders; then the evidence
    if(!t.isSubTheme && !t.emergent){
      const c=card('Market size','Market size, 2024');
      if(t.sizeLabel){ const b=el('b','fig-big',t.sizeLabel); big.push(b); c.append(b); if(t.sizeRough) c.append(el('div','fig-note','estimate')); }
      else c.append(el('div','fig-none','not sized yet'));
    }
    if(t.perf){ const c=card('Growth a year','Growth a year, 2019–24'); const b=el('b','fig-big',t.perf.r.toFixed(1)+'%'); big.push(b); c.append(b, growthBar(t.perf)); }
    const leaders = !t.isSubTheme && LEADERS[t.slug];
    if(leaders && leaders.length) card('Leading companies').append(el('div','fig-names',leaders.join(' \u2022 ')));
    // Brand: one card for presence and its evidence, at the top (no 'Quoted from': the documents list shows them)
    document.getElementById('pEvidenceBrand').innerHTML='';
    if(step==='brand'){
      const c=card('Brand presence','How present the brand is here, from its own documents', document.getElementById('pEvidenceBrand'));   // first card of Evidence
      brandCard(t, c, el, big);   // presence share, how the brand shows up, and the kinds of documents behind it
    }
    const ev=document.getElementById('pEvidenceKpis'); ev.innerHTML='';   // the Evidence cards sit at the top of the Documents section
    const c=peakCounts(peakKey(t));
    for(const [id,label,title,v] of [
      ['pKpiDocs','Documents','Every document with an excerpt here; those that are more than a passing mention add height to the hill', c?.docs ?? t.signalDocs],
      ['pKpiExcerpts','Excerpts','Every verbatim excerpt from those documents, passing mentions included', c?.ex ?? (t.isSubTheme ? '…' : t.excerptTotal)]]){
      const k=card(label,title,ev); const b=el('b','fig-big',String(v)); b.id=id; big.push(b); const n=el('div','fig-note'); n.id=id+'Sub'; k.append(b,n);
    }
    big.forEach(fitFigure); fitRanges(box); fillDocKpis(peakKey(t));
  }
  function fillDocKpis(key){
    const c = peakCounts(key) || {docs:0, adding:0, ex:0, exPassing:0};
    const set=(id,v)=>{ const b=document.getElementById(id); if(b){ b.textContent=String(v); fitFigure(b); } };
    set('pKpiDocs', c.docs); set('pKpiExcerpts', c.ex);
    const ds=document.getElementById('pKpiDocsSub'), es=document.getElementById('pKpiExcerptsSub');
    if(ds) ds.textContent = c.docs ? (c.adding===c.docs ? 'all add height' : `${c.adding} ${c.adding===1 ? 'adds' : 'add'} height`) : '';
    if(es) es.textContent = !c.exPassing ? '' : c.exPassing===c.ex ? 'all in passing' : `${c.exPassing} in passing`;
  }
  let docsUpdated=false;   // the portal answers 410 once this version is no longer live (UPDATED)
  const docsReady=fetch(new URL("data/docs", location.href),{cache:"no-store"}).then(r=>{ docsUpdated=r.status===410; return r.ok?r.json():null; }).then(d=>{docsData=cleanSummaries(d); return docsData;}).catch(()=>null);
  const fmtH=h=>h==null?"—":(Math.round(h*10)/10).toString();
  const GRADE={keep:["Strong","A strong source: counts in full"],weak:["Weak","A weak source: counts at half weight"],drop:["Not used","Used for context only: adds no height"]};
  const heightOf=slug=>docsData?.heights[slug] ?? null;
  const itemFor=slug=>world("themes").bySlug.get(slug) || null;   // an industry's peak (the library links to industries)
  const initials=s=>s.replace(/\(.*?\)/g,"").split(/[\s&,/-]+/).filter(w=>/^[A-Z0-9]/.test(w)).slice(0,3).map(w=>w[0]).join("") || s.slice(0,2);
  function coverEl(d){
    const c=document.createElement("div"); c.className="doc-cover";
    if(safeImg(d.cover)){ const img=document.createElement("img"); img.src=safeImg(d.cover); img.alt=""; img.loading="lazy"; c.appendChild(img); return c; }
    c.classList.add("blank");
    const b=document.createElement("b"); b.textContent=initials(d.publisher);
    const k=document.createElement("span"); k.textContent=d.kind.replace("-"," ");
    c.append(b,k); return c;
  }
  /** One document as a card. `row` is its line in a peak (what it adds there), or null in the library. */
  function docCard(id, row, {showMarket=false}={}){
    const d=docsData.docs[id];
    const card=document.createElement("article"); card.className="doc-card"; card.dataset.doc=id;
    const body=document.createElement("div"); body.className="doc-body";
    const title=d.title.replace(/\s+_?\s+/g," ").trim();
    const h=document.createElement("h4"); h.className="doc-title"; h.title=title;
    const hb=document.createElement("button"); hb.type="button"; hb.textContent=title; hb.addEventListener("click",()=>openDocument(id)); h.appendChild(hb);
    const by=document.createElement("div"); by.className="doc-by";
    const pub=document.createElement("span"); pub.className="pub"; pub.textContent=[d.publisher,d.year,(d.internal||d.licensed)?"Licensed":null].filter(Boolean).join(" · "); pub.title=d.publisher;
    const g=document.createElement("span"); g.className="grade g-"+d.grade;
    const [gl,gt]=GRADE[d.grade]||[d.grade,""];
    g.textContent=gl; g.title=gt;
    by.append(pub,g);
    body.append(h,by);
    if(d.summary){ const s=document.createElement("p"); s.className="doc-sum"; s.textContent=d.summary; s.title=d.summary; body.appendChild(s); }
    if(row){
      const a=document.createElement("div"); a.className="doc-adds";
      const lbl=document.createElement("span");
      if(row.adds>0){
        const bar=document.createElement("div"); bar.className="bar"; const i=document.createElement("i"); i.style.width=Math.max(2,Math.round(row.share*100))+"%"; bar.appendChild(i);
        lbl.textContent=`adds ${Math.round(row.share*100)}%`;
        lbl.title=`Adds ${Math.round(row.share*100)}% of this hill's height`;
        a.append(bar,lbl);
      } else {
        a.classList.add("none");
        lbl.textContent = d.grade==="drop" ? "adds no height: context only" : "adds no height: passing mentions only";
        a.appendChild(lbl);
      }
      body.appendChild(a);
    } else if(d.peaks){
      const peaks=document.createElement("div"); peaks.className="doc-peaks";
      const rows=Object.entries(docsData.peaks).filter(([,rs])=>rs.some(r=>r.doc===id&&r.adds>0)).map(([slug,rs])=>({slug,adds:rs.find(r=>r.doc===id).adds,item:itemFor(slug)}))
        .filter(r=>r.item).sort((a,b)=>b.adds-a.adds);
      for(const r of rows.slice(0,4)){
        const c=document.createElement("button"); c.type="button"; c.className="doc-chip"; c.textContent=r.item.name; c.title=`Adds ${r.adds.toFixed(2)} to ${r.item.name}`;
        c.addEventListener("click",()=>select(r.item));
        peaks.appendChild(c);
      }
      if(rows.length>4){ const m=document.createElement("span"); m.className="doc-chip"; m.style.cursor="default"; m.textContent=`+${rows.length-4} more`; peaks.appendChild(m); }
      if(rows.length) body.appendChild(peaks);
    }
    const ex = row && Array.isArray(row.excerpts) ? row.excerpts : [];
    const foot=document.createElement("div"); foot.className="doc-foot";
    let quotes=null;
    if(ex.length){
      const t=document.createElement("button"); t.type="button"; t.setAttribute("aria-expanded","false");
      const chev=document.createElement("span"); chev.className="chev"; chev.setAttribute("aria-hidden","true"); chev.textContent="▾";
      t.append(plural(ex.length,"excerpt","excerpts"), chev);
      quotes=document.createElement("div"); quotes.className="doc-quotes"; quotes.hidden=true;
      for(const e of ex){
        const q=document.createElement("blockquote"); q.className="ev-q";
        const p=document.createElement("p"); setRich(p, e.text); q.appendChild(p);
        const c=document.createElement("cite"); c.textContent=[showMarket?(e.market||"Industry-wide"):null, e.page?`p. ${e.page}`:null, e.counts?null:"not counted: passing mention"].filter(Boolean).join(" · ");
        if(c.textContent) q.appendChild(c);
        quotes.appendChild(q);
      }
      t.addEventListener("click",()=>{ const o=quotes.hidden; quotes.hidden=!o; t.setAttribute("aria-expanded",o?"true":"false"); });
      foot.appendChild(t);
    }
    if(safeHref(d.url)){ const l=document.createElement("a"); l.href=safeHref(d.url); l.target="_blank"; l.rel="noopener noreferrer"; l.textContent="Source ↗"; foot.appendChild(l); }
    if(foot.children.length) body.appendChild(foot);
    const cv=coverEl(d); cv.classList.add("open"); cv.title="Open the document"; cv.addEventListener("click",()=>openDocument(id));
    card.append(cv, body);
    if(quotes) card.appendChild(quotes);
    return card;
  }
  const SORTS={
    contribution:(a,b)=>(b.adds??0)-(a.adds??0) || (docsData.docs[b.doc].year||0)-(docsData.docs[a.doc].year||0),
    recent:(a,b)=>(docsData.docs[b.doc].year||0)-(docsData.docs[a.doc].year||0) || (b.adds??0)-(a.adds??0),
  };
  let docSort="contribution";

  /** Two columns that keep reading order: each card goes into the shorter column (call with the grid in the page). */
  function fillMasonry(grid, nodes){
    grid.innerHTML="";
    const cols=[0,1].map(()=>{ const c=document.createElement("div"); c.className="mcol"; grid.appendChild(c); return c; });
    nodes.forEach((n,i)=>{
      const a=cols[0].offsetHeight, b=cols[1].offsetHeight;   // 0 and 0 while hidden: alternate instead
      (a||b ? (a<=b ? cols[0] : cols[1]) : cols[i%2]).appendChild(n);
    });
  }
  /** Excerpt text as it was written: markdown **bold** from a web source shows as bold, everything else as plain text. */
  function setRich(el, text){
    el.textContent="";
    text.split("**").forEach((part,i)=>{ if(!part) return; if(i%2){ const b=document.createElement("strong"); b.textContent=part; el.appendChild(b); } else el.append(part); });
  }
  /** A verbatim excerpt as a card: the quote is the body; a tag says where it comes from or where it goes. */
  function quoteCard(e, {doc=null, tag=null, onTag=null}={}){
    const c=document.createElement("article"); c.className="qcard";
    const qm=document.createElement("span"); qm.className="qm"; qm.setAttribute("aria-hidden","true"); qm.textContent="“";
    const p=document.createElement("p"); setRich(p, e.text);
    c.append(qm,p);
    const meta=[e.page?`p. ${e.page}`:null, e.counts?null:"passing mention: adds no height"].filter(Boolean).join(" · ");
    if(meta){ const m=document.createElement("span"); m.className="qmeta"; m.textContent=meta; c.appendChild(m); }
    if(doc || tag){
      const t=document.createElement("button"); t.type="button"; t.className="qtag"+(doc?"":" plain");
      if(doc){
        const d=docsData.docs[doc];
        if(safeImg(d.cover)){ const img=document.createElement("img"); img.src=safeImg(d.cover); img.alt=""; img.loading="lazy"; t.appendChild(img); }
        else { const i=document.createElement("i"); i.textContent=initials(d.publisher).slice(0,2); t.appendChild(i); }
      }
      const s=document.createElement("span"); s.textContent=tag || docsData.docs[doc].title.replace(/\s+_?\s+/g," "); t.appendChild(s);
      t.title=s.textContent; t.addEventListener("click",onTag || (()=>openDocument(doc)));
      c.appendChild(t);
    }
    return c;
  }
  function segmented(options, value, onChange, label){
    const wrap=document.createElement("div"); wrap.className="doc-sort"; wrap.setAttribute("role","group"); wrap.setAttribute("aria-label",label);
    for(const [k,text] of options){
      const b=document.createElement("button"); b.type="button"; b.textContent=text; b.setAttribute("aria-pressed",String(value===k));
      b.addEventListener("click",()=>{ for(const o of wrap.children) o.setAttribute("aria-pressed",String(o===b)); onChange(k); });
      wrap.appendChild(b);
    }
    return wrap;
  }
  /** The documents behind one peak, as document cards or as their excerpts; for an industry its markets filter both. */
  let peakView="documents";
  function renderDocCards(body, rows, {height, markets, hasGeneral}){
    if(!docsData){ const p=document.createElement("p"); p.className="ev-note"; p.textContent=docsUpdated ? UPDATED : "The documents couldn't load. Reload the page to try again."; body.appendChild(p); return; }
    if(!rows.length){ const p=document.createElement("p"); p.className="ev-note"; p.textContent="No documents behind this peak yet: a research gap."; body.appendChild(p); return; }
    let filter=null;
    const titleOf=new Map((markets||[]).map(t=>[t.key,t.title]));
    const tools=document.createElement("div"); tools.className="doc-tools";
    const list=document.createElement("div");
    const draw=()=>{
      list.innerHTML="";
      const shown=rows.filter(r=>filter==null || (filter==="general" ? r.general : r.markets.includes(filter))).sort(SORTS[docSort]);
      if(peakView==="excerpts"){
        list.className="masonry";
        const year=id=>docsData.docs[id].year||0;
        const ex=shown.flatMap(r=>r.excerpts.map(e=>({e,doc:r.doc,adds:r.adds})))
          .filter(({e})=>filter==null || (filter==="general" ? !e.market : e.market===titleOf.get(filter)))
          .sort((a,b)=>docSort==="recent" ? year(b.doc)-year(a.doc) || b.e.salience-a.e.salience : (b.e.counts-a.e.counts) || b.e.salience-a.e.salience || b.adds-a.adds);
        fillMasonry(list, ex.map(({e,doc})=>quoteCard(e,{doc})));
        if(!ex.length){ list.className=""; const p=document.createElement("p"); p.className="ev-note"; p.textContent="No excerpts to show."; list.appendChild(p); }
      } else {
        list.className="doc-list";
        for(const r of shown) list.appendChild(docCard(r.doc, r, {showMarket:!!markets && filter==null}));
      }
    };
    tools.append(
      segmented([["documents","Documents"],["excerpts","Excerpts"]], peakView, k=>{ peakView=k; draw(); }, "Show"),
      segmented([["contribution","Contribution"],["recent","Recent"]], docSort, k=>{ docSort=k; draw(); }, "Sort"));
    body.appendChild(tools);
    if(markets && markets.length){
      const chips=document.createElement("div"); chips.className="doc-chips";
      const all=[{key:null,title:"All",n:rows.length}, ...(hasGeneral?[{key:"general",title:"Industry-wide",n:rows.filter(r=>r.general).length}]:[]),
        ...markets.map(t=>({key:t.key,title:t.title,n:rows.filter(r=>r.markets.includes(t.key)).length})).filter(c=>c.n)];
      for(const c of all){
        const b=document.createElement("button"); b.type="button"; b.className="doc-chip"; b.setAttribute("aria-pressed",String(c.key===filter));
        if(c.key && c.key!=="general") b.dataset.key=c.key;
        b.append(c.title); const n=document.createElement("span"); n.className="n"; n.textContent=c.n; b.appendChild(n);
        b.addEventListener("click",()=>{ filter=c.key; for(const o of chips.children) o.setAttribute("aria-pressed",String(o===b)); draw(); });
        if(c.key && c.key!=="general"){ b.addEventListener("pointerenter",()=>setTopicHover(c.key)); b.addEventListener("pointerleave",()=>setTopicHover(null)); }
        chips.appendChild(b);
      }
      body.appendChild(chips);
    }
    body.appendChild(list);
    draw();
  }

  /** The library tile: the cover leads, as the archive did; documents with no PDF get a short type tile. */
  function docTile(id, total){
    const d=docsData.docs[id], title=d.title.replace(/\s+_?\s+/g," ");
    const t=document.createElement("button"); t.type="button"; t.className="tile"; t.title=title; t.dataset.doc=id;
    if(safeImg(d.cover)){ const img=document.createElement("img"); img.src=safeImg(d.cover); img.alt=""; img.loading="lazy"; t.appendChild(img); }
    else {
      const art=document.createElement("div"); art.className="tile-art";
      const b=document.createElement("b"); b.textContent=initials(d.publisher);
      const k=document.createElement("span"); k.textContent=d.kind.replace("-"," ");
      art.append(b,k); t.appendChild(art);
    }
    const body=document.createElement("div"); body.className="tile-body";
    const h=document.createElement("h4"); h.className="tile-title"; h.textContent=title;
    const by=document.createElement("div"); by.className="tile-by"; by.textContent=[d.publisher,d.year].filter(Boolean).join(" · ");
    const foot=document.createElement("div"); foot.className="tile-foot";
    const g=document.createElement("span"); g.className="grade g-"+d.grade;
    const [gl,gt]=GRADE[d.grade]||[d.grade,""]; g.textContent=gl; g.title=gt;
    const n=document.createElement("span"); n.textContent = total>0 ? "adds height" : "context only";
    foot.append(g,n);
    body.append(h,by,foot); t.appendChild(body);
    t.addEventListener("click",()=>openDocument(id));
    return t;
  }
  /** What a document adds to each industry, biggest first. */
  function industriesOf(id){
    return Object.entries(docsData.peaks).map(([slug,rs])=>({slug,item:itemFor(slug),row:rs.find(r=>r.doc===id)}))
      .filter(x=>x.item && x.row).sort((a,b)=>b.row.adds-a.row.adds);
  }
  /** The library: every document as a cover-led tile, biggest impact or newest first, filterable by grade. */
  async function openLibrary(){
    if(sel) select(null);
    closeLibrary();
    await docsReady;
    noteOpener();
    panel.classList.add("library","open"); panel.setAttribute("aria-hidden","false"); app.classList.add("panel-open"); panelOpen=true;
    document.getElementById("btnLibrary").setAttribute("aria-pressed","true");
    pType.textContent="Library";
    pName.textContent="Documents";
    const meta=document.getElementById("pLibraryMeta"), body=document.getElementById("pLibraryBody");
    body.innerHTML="";
    if(!docsData){ pSummary.textContent=docsUpdated ? UPDATED : "The documents couldn't load. Reload the page to try again."; return; }
    const ids=Object.keys(docsData.docs);
    const used=ids.filter(id=>docsData.docs[id].peaks);
    pSummary.textContent=`Every document the landscape is built on: general wellness research reports and surveys, ${used.length} of which put height on the map. Open one to see what it says and where it lands.`;
    const rows=ids.map(id=>({doc:id, adds:industriesOf(id).reduce((s,x)=>s+x.row.adds,0)}));
    meta.textContent=`${plural(ids.length,"document","documents")} · ${ids.filter(id=>docsData.docs[id].cover).length} with covers`;
    let grade=null;
    const tools=document.createElement("div"); tools.className="doc-tools";
    const chips=document.createElement("div"); chips.className="doc-chips";
    const grid=document.createElement("div"); grid.className="masonry";
    const draw=()=>{
      fillMasonry(grid, rows.filter(r=>grade==null || docsData.docs[r.doc].grade===grade).sort(SORTS[docSort]).map(r=>docTile(r.doc, r.adds)));
    };
    tools.appendChild(segmented([["contribution","Biggest impact"],["recent","Recent"]], docSort, k=>{ docSort=k; draw(); }, "Sort"));
    for(const [k,label] of [[null,"All"],["keep","Strong"],["weak","Weak"],["drop","Not used"]]){
      const b=document.createElement("button"); b.type="button"; b.className="doc-chip"; b.setAttribute("aria-pressed",String(k===grade));
      b.append(label); const n=document.createElement("span"); n.className="n"; n.textContent=k?ids.filter(id=>docsData.docs[id].grade===k).length:ids.length; b.appendChild(n);
      b.addEventListener("click",()=>{ grade=k; for(const o of chips.children) o.setAttribute("aria-pressed",String(o===b)); draw(); });
      chips.appendChild(b);
    }
    body.append(tools, chips, grid);
    draw();
    panel.scrollTo({top:0});
  }

  /** The document page: its cover, what it is, the industries it shapes (lit on the map), and its excerpts. */
  let docFrom=null;                                  // what Back returns to: "peak" (the selection) or "library"
  function openDocument(id){
    const d=docsData.docs[id], title=d.title.replace(/\s+_?\s+/g," ");
    docFrom = panel.classList.contains("library") ? "library" : sel ? "peak" : null;
    closeLibrary();
    panel.classList.add("document","open"); panel.setAttribute("aria-hidden","false"); app.classList.add("panel-open"); panelOpen=true;
    const box=document.getElementById("pDocument"); box.innerHTML="";
    const el=(tag,cls,text)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; };

    const hero=el("header","doc-hero"+(safeImg(d.cover)?"":" blank"));
    if(safeImg(d.cover)){ const img=el("img"); img.src=safeImg(d.cover); img.alt=""; hero.appendChild(img); }
    else { const art=el("div","art"); art.append(el("b",null,initials(d.publisher)), el("span",null,d.kind.replace("-"," "))); hero.appendChild(art); }
    const nav=el("div","doc-nav");
    if(docFrom){ const back=el("button",null,"‹"); back.type="button"; back.setAttribute("aria-label", docFrom==="library"?"Back to the library":`Back to ${sel.name}`); back.title=back.getAttribute("aria-label"); back.addEventListener("click",backFromDocument); nav.appendChild(back); }
    else nav.appendChild(el("span","spacer"));
    const close=el("button",null,"×"); close.type="button"; close.setAttribute("aria-label","Close panel"); close.addEventListener("click",()=>select(null)); nav.appendChild(close);
    const chip=el("span","chip"); chip.append("Document");
    const by=el("div","doc-by");
    const g=el("span","grade g-"+d.grade); const [gl,gt]=GRADE[d.grade]||[d.grade,""]; g.textContent=gl; g.title=gt;
    by.append(el("span","pub",[d.publisher,d.year].filter(Boolean).join(" · ")), g);
    hero.append(nav, chip, el("h2",null,title), by);
    box.appendChild(hero);

    const lede=el("div","doc-lede");
    if(d.summary) lede.appendChild(el("p","summary",d.summary));
    const facts=el("dl","stats");
    for(const [k,v] of [["Kind",d.kind.replace("-"," ")],["Where",d.geography],["Sample",d.sample]]){
      if(!v) continue;
      const row=el("div",String(v).length>16?"wide":null); row.append(el("dt",null,k), el("dd",null,v)); facts.appendChild(row);
    }
    lede.appendChild(facts);
    if(safeHref(d.url)){ const foot=el("div","doc-foot"); const a=el("a",null,"Open the source ↗"); a.href=safeHref(d.url); a.target="_blank"; a.rel="noopener noreferrer"; foot.appendChild(a); lede.appendChild(foot); }
    box.appendChild(lede);

    const inds=industriesOf(id);
    const sec=(label,count,tip)=>{ const s=el("section"); const h=el("div","sec-head"); const l=el("h3","lbl",label); l.appendChild(el("span","count",String(count))); h.appendChild(l); if(tip) h.title=tip; s.appendChild(h); return s; };
    const shaping=inds.filter(x=>x.row.adds>0);
    const s1=sec("Industries", shaping.length, "The industries this document adds height to, and by how much. Lit on the map.");
    if(shaping.length){
      const chips=el("div","doc-peaks big");
      for(const x of shaping){
        const b=el("button","doc-chip"); b.type="button"; b.append(x.item.name); b.appendChild(el("span","n",Math.round(x.row.share*100)+"%"));
        b.title=`Adds ${Math.round(x.row.share*100)}% of ${x.item.name}'s height`;
        b.addEventListener("click",()=>select(x.item)); chips.appendChild(b);
      }
      s1.appendChild(chips);
    } else s1.appendChild(el("p","ev-note", d.grade==="drop" ? "Used for context only, so it adds no height anywhere." : "Context only: it adds no height to any industry."));
    box.appendChild(s1);

    const ex=inds.flatMap(x=>x.row.excerpts.map(e=>({e,x})));
    const s2=sec("Excerpts", ex.length, "Verbatim passages from the document, each tagged with the market or industry it feeds.");
    if(ex.length){
      const grid=el("div","masonry");
      s2.appendChild(grid);
      box.appendChild(s2);
      fillMasonry(grid, ex.sort((a,b)=>(b.e.counts-a.e.counts) || b.e.salience-a.e.salience)
        .map(({e,x})=>quoteCard(e,{tag:e.market||x.item.name, onTag:()=>select(x.item)})));
    } else s2.appendChild(el("p","ev-note", "No excerpts placed on the map."));
    box.appendChild(s2);

    lightPeaks(new Set(shaping.map(x=>x.slug)), new Set(Object.entries(docsData.peaks).filter(([slug,rs])=>!itemFor(slug) && rs.some(r=>r.doc===id && r.adds>0)).map(([slug])=>slug)));
    panel.scrollTo({top:0});
  }
  function backFromDocument(){
    const from=docFrom;
    closeLibrary();
    if(from==="library") openLibrary();
    else { renderSelection(); panel.scrollTo({top:0}); }
  }
  /** Light a document's peaks on every pane, with arcs fanning out from a point above them (as a project did to its themes). */
  function lightPeaks(industries, markets){
    for(const p of panes){
      const W=p.world; if(!W) continue;
      const lit=W.items.filter(o=>o.isSubTheme ? markets.has(o.slug) : industries.has(o.slug));
      p.active=new Set(); p.related=new Set(lit.map(o=>o.id)); p.rangeActive=null;
      for(const L of p.labelNodes){ L.el.classList.remove("active"); L.el.classList.toggle("related",p.related.has(L.t.id)); L.el.setAttribute("aria-pressed","false"); }
      p.labelsEl.classList.toggle("dim",true);
      p.docLit = lit.length ? lit : null;
      buildArcs(p, p.docLit ? docHub(p) : null);
      if(p.docLit && p.visible) focusOn(p, lit);
    }
    for(const B of bubbleNodes){ B.g.classList.remove("active"); B.g.classList.toggle("related",paneB.related.has(B.t.id)); }
    bubblesEl.classList.toggle("dim",true);
    syncPeakList();                                       // nothing is selected while a document's peaks are lit
  }
  /** The point the document's arcs fan out from: above the middle of its peaks (recomputed as the terrain moves). */
  function docHub(p){
    const lit=p.docLit, avg=f=>lit.reduce((s,o)=>s+f(o),0)/lit.length;
    return {w:p.world, x:avg(o=>o.x), z:avg(o=>o.z), bx:avg(o=>o.bx??o.x), bz:avg(o=>o.bz??o.z),
      peak:Math.max(...lit.map(o=>o.peak??0))+1.4, related:lit.map(o=>({id:o.id}))};
  }
  /** The selected document's marker: a dot with a document icon (Lucide "file-text") where its arcs fan out. */
  function updateDocHub(p){
    if(!p.hubEl){
      p.hubEl=document.createElement("div"); p.hubEl.className="doc-hub"; p.hubEl.setAttribute("aria-hidden","true");
      p.hubEl.innerHTML='<svg viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
      p.labelsEl.appendChild(p.hubEl);
    }
    const on=!!(p.visible && p.docLit && p.arcVerts && p.docLit[0].w===p.world);
    p.hubEl.style.display = on ? "" : "none";
    if(!on) return;
    const h=docHub(p), [hx,hz]=posOf(p,h);
    const [sx,sy]=project(p,[hx, p.mode==="2d" ? 0.06 : h.peak+0.05, hz]);
    p.hubEl.style.transform=`translate(-50%,-50%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
  }
  /** Leave the library or a document page (the panel shows the selection again, if any). */
  function closeLibrary(){
    panel.classList.remove("library","document");
    for(const p of panes) p.docLit=null;
    document.getElementById("btnLibrary").setAttribute("aria-pressed","false");
  }
  function updateBubbles(p){
    const ppu=pxPerUnit(p);
    for(const B of bubbleNodes){
      const t=B.t, [bx,bz]=posOf(p,t), [sx,sy]=project(p,[bx,0,bz]);
      const r=bubbleR(t)*ppu*bubbleGrowAt(p,sx), k=bubblePresenceScale(t);
      // circle colour = GWI sector (size already carries the volume); step 3 overrides with the verdict in CSS
      const col=sectorColor(t);
      B.outer.setAttribute("cx",sx.toFixed(1)); B.outer.setAttribute("cy",sy.toFixed(1));
      B.outer.setAttribute("r",r.toFixed(1)); B.outer.setAttribute("stroke",col);
      B.inner.setAttribute("cx",sx.toFixed(1)); B.inner.setAttribute("cy",sy.toFixed(1));
      B.inner.setAttribute("r",(r*k).toFixed(1)); B.inner.setAttribute("fill",col);
      // translucent fill; an emergent theme's outline is dashed (CSS). In step 3 the verdict colours the outer ring (CSS)
      B.inner.setAttribute("fill-opacity", "0.38");
      if(!B.g.classList.contains("active") && !B.g.classList.contains("related")) B.inner.setAttribute("stroke",col);
    }
  }

  // ---------- selection: shared across panes ----------
  const app=document.getElementById("app"), panel=document.getElementById("panel");
  const pType=document.getElementById("pType"), pName=document.getElementById("pName"),
        pSummary=document.getElementById("pSummary"), pHook=document.getElementById("pHook"),
        pStats=document.getElementById("pStats"),
        pRelated=document.getElementById("pRelated");
  let panelOpen=false;
  const panelResize=document.getElementById("panelResize");
  const setPanelWidth=(w, save)=>{
    w=Math.round(Math.max(320, Math.min(w, window.innerWidth*0.8)));
    PANEL_W=w; document.documentElement.style.setProperty("--panel-w", w+"px");
    if(save) try{ localStorage.setItem("panel-width", String(w)); }catch(e){}
  };
  try{ const w=Number(localStorage.getItem("panel-width")); if(w) setPanelWidth(w); }catch(e){}
  panelResize.addEventListener("pointerdown",e=>{
    e.preventDefault(); panelResize.setPointerCapture(e.pointerId);
    panelResize.classList.add("dragging"); app.classList.add("resizing");
    const move=ev=>setPanelWidth(window.innerWidth-ev.clientX, false);
    const up=ev=>{ setPanelWidth(window.innerWidth-ev.clientX, true); panelResize.classList.remove("dragging"); app.classList.remove("resizing");
      panelResize.removeEventListener("pointermove",move); panelResize.removeEventListener("pointerup",up); panelResize.removeEventListener("pointercancel",up); };
    panelResize.addEventListener("pointermove",move); panelResize.addEventListener("pointerup",up); panelResize.addEventListener("pointercancel",up);
  });
  panelResize.addEventListener("keydown",e=>{
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){ e.preventDefault(); setPanelWidth(PANEL_W+(e.key==="ArrowLeft"?24:-24), true); }
  });
  window.addEventListener("resize",()=>setPanelWidth(PANEL_W,false));
  /** Arcs run from the selection to its related peaks, on each pane that shows the selection itself. */
  const rebuildArcs=()=>{
    for(const p of panes){
      if(p.docLit && p.docLit[0].w===p.world){ buildArcs(p, docHub(p)); continue; }   // a document page: arcs from the document to its peaks
      const s=inPane(p,sel); buildArcs(p, s?.item && !s.parent ? s.item : null);
    }
  };
  /** How each pane shows the selection: the peaks lit as selected and as related, and the lit range name. */
  function renderSelection(){
    for(const p of panes){
      const s=inPane(p,sel);
      p.active=new Set(s?.item ? [s.item.id] : []);
      p.related=new Set(s?.cluster ? s.cluster.map(o=>o.id) : s?.item && !s.parent ? s.item.related.map(r=>r.id) : []);
      p.rangeActive=s?.range ?? null;
      for(const L of p.labelNodes){
        const a=p.active.has(L.t.id);
        L.el.classList.toggle("active",a);
        L.el.classList.toggle("related",p.related.has(L.t.id));
        L.el.setAttribute("aria-pressed",a && !s?.parent ? "true" : "false");   // a selected market's industry is lit, not pressed
      }
      p.labelsEl.classList.toggle("dim",!!sel);
    }
    for(const B of bubbleNodes){
      B.g.classList.toggle("active",paneB.active.has(B.t.id));
      B.g.classList.toggle("related",paneB.related.has(B.t.id));
    }
    bubblesEl.classList.toggle("dim",!!sel);
    const rp=rangePane();
    for(const r of worlds.subthemes?.rangeCentres || []) r.el?.classList.toggle("active", !!rp && rp.rangeActive===r.slug);
    rebuildArcs();
    syncPeakList();
  }
  // ---------- the peak list: a keyboard and screen-reader route to every peak (WCAG 1.1.1, 2.1.1) ----------
  // The canvas is one image to assistive tech, and a label hidden for overlap can't be reached, so a visually
  // hidden list names every peak each shown pane's level has: alphabetical, markets under their industry. A
  // button selects its peak as a click on its label does (clickItem); a focused one shows itself and lights the
  // peak's label. The list is rebuilt only when what's shown changes (level, view, new data), so focus stays.
  // A button is found by its level and slug: in Split an industry with no markets is in both groups.
  const peakListEl=document.getElementById("peakList");
  const peakButton=(level, slug)=>[...peakListEl.querySelectorAll("button")].find(b=>b.dataset.level===level && b.dataset.slug===slug) || null;
  document.getElementById("skipPeaks").addEventListener("click",e=>{ e.preventDefault(); document.getElementById("btnSpin").focus(); });
  const LEVEL_WORDS={themes:["industry","industries","Industries"], subthemes:["market","markets","Markets"]};
  let peakGroups=[];                                       // one per level shown: {w, p, buttons: id → button}
  function syncPeakList(){
    const shown=[];
    for(const p of visiblePanes()) if(p.world && !shown.some(g=>g.w===p.world)) shown.push({w:p.world, p});
    if(shown.length===peakGroups.length && shown.every((g,i)=>g.w===peakGroups[i].w)) shown.forEach((g,i)=>{ peakGroups[i].p=g.p; });
    else buildPeakList(shown);
    for(const g of peakGroups){
      // pressed is the selection itself: a selected market's industry is lit on the map, and pressing it selects it
      const s=inPane(g.p, sel), id=s?.item && !s.parent && g.p.active.has(s.item.id) ? s.item.id : null;
      for(const [k,b] of g.buttons) b.setAttribute("aria-pressed", k===id ? "true" : "false");
    }
    describeCanvas();
  }
  function buildPeakList(shown){
    const f=document.activeElement, focused=peakListEl.contains(f) ? {level:f.dataset.level, slug:f.dataset.slug} : null;
    const make=(tag,text,cls)=>{ const e=document.createElement(tag); if(text!=null) e.textContent=text; if(cls) e.className=cls; return e; };
    const byName=(a,b)=>a.name.localeCompare(b.name);
    peakListEl.replaceChildren();
    peakGroups=shown.map(({w,p})=>{
      const g={w, p, buttons:new Map()};
      const item=t=>{
        const b=make("button",t.name); b.type="button"; b.dataset.level=w.level; b.dataset.slug=t.slug;
        b.setAttribute("aria-controls","panel");
        if(t.noDemand) b.title="No research yet on why people buy here";
        b.addEventListener("click",()=>clickItem(g.p,t));
        b.addEventListener("focus",()=>{ if(b.matches(":focus-visible")) setHover(t); });   // not when focus comes back after a mouse click
        b.addEventListener("blur",()=>{ if(hov===t) setHover(null); });
        g.buttons.set(t.id,b);
        const li=make("li"); li.appendChild(b); return li;
      };
      const list=make("ul");
      if(w.level==="subthemes"){
        const byParent=new Map();
        for(const t of w.items){ if(!byParent.has(t.parentSlug)) byParent.set(t.parentSlug, {name:t.parentTitle, items:[]}); byParent.get(t.parentSlug).items.push(t); }
        for(const ind of [...byParent.values()].sort(byName)){
          const li=make("li"), sub=make("ul");
          sub.append(...ind.items.sort(byName).map(item));
          li.append(make("h3",ind.name,"sr-only"), sub); list.appendChild(li);
        }
      } else list.append(...[...w.items].sort(byName).map(item));
      peakListEl.append(make("h2",LEVEL_WORDS[w.level][2]+" on the map","sr-only"), list);
      return g;
    });
    if(focused) peakButton(focused.level, focused.slug)?.focus();   // new data: stay on the same peak
  }
  // What opened the panel, so closing it hands focus back: a peak by level and slug (the list may be rebuilt while
  // the panel is open, and a label hands over to its list button), or another control (Documents). It changes
  // while the panel is open only when a peak is picked from outside it.
  let panelOpener=null;
  function noteOpener(){
    const a=document.activeElement;
    if(!a || a===document.body || panel.contains(a)) return;
    const L=panes.flatMap(p=>p.labelNodes.map(L=>({p, L}))).find(x=>x.L.el===a);
    const peak = peakListEl.contains(a) ? {level:a.dataset.level, slug:a.dataset.slug} : L ? {level:L.p.world.level, slug:L.L.t.slug} : null;
    if(peak || !panelOpen) panelOpener={el:a, ...peak};
  }
  /** Close the panel (× or Escape). Focus left in it goes back to what opened it, else to the closed peak's button. */
  function closePanel(){
    const o=panelOpener, was=sel, a=document.activeElement, inPanel=panel.contains(a) || a===document.body;
    select(null);
    if(!inPanel) return;
    const back=(o?.slug!=null && peakButton(o.level, o.slug)) || (o?.el.isConnected && !o.el.closest(".labels") && o.el)
      || (was && peakButton(was.level, was.slug));
    if(back) back.focus(); else if(panel.contains(a)) a.blur();
  }
  /** The canvas's text alternative: what the map shows, and where to find each peak. */
  function describeCanvas(){
    const count=p=>{ const n=p.world.items.length, w=LEVEL_WORDS[p.world.level]; return n+" "+(n===1 ? w[0] : w[1]); };
    const hills=()=>count(paneA)+" as hills, taller where there are more "+(HEIGHT_WORD[heightBy] || "documents");
    const what = tab==="split" ? "on the left, "+hills()+"; on the right, "+count(paneB)+" as circles" : tab==="2d" ? count(paneB)+" as circles" : hills();
    canvas.setAttribute("aria-label", "Wellness landscape map: "+what+". The list of peaks that follows names each one.");
  }
  /** The peaks a pane frames for the selection: its cluster, or it and its company (sector, or theme). */
  function framingFor(p){
    const s=inPane(p,sel);
    if(!s) return null;
    if(s.cluster) return s.cluster.length ? s.cluster : null;
    const t=s.item, W=p.world;
    if(!s.parent){ const lit=t.related.map(r=>W.items[r.id]).filter(Boolean); if(lit.length) return [t, ...lit]; }   // the hill and its lines' ends
    const group=W.items.filter(o=>o===t || (W.level==="subthemes" ? o.parentSlug===t.parentSlug : ((!t.emergent && o.industrySlug && o.industrySlug===t.industrySlug) || (t.emergent && o.emergent))));
    return group.length>1 ? group : [t, ...t.related.map(r=>W.items[r.id])];
  }
  /** Click a peak: select it, or clear the selection when it is what's selected on that pane. */
  function clickItem(p,t){
    const s=sel && inPane(p,sel);
    select(s && s.item===t && !s.parent ? null : t);
  }
  /** Select an item from any world (or nothing): every pane shows it its own way, the panel describes it. */
  function select(t, {frame=true}={}){
    if(t) noteOpener(); else panelOpener=null;
    sel=t;
    closeLibrary();
    renderSelection();
    panelOpen=!!t;
    panel.classList.toggle("open",panelOpen);
    panel.setAttribute("aria-hidden",panelOpen?"false":"true");
    app.classList.toggle("panel-open",panelOpen);
    if(!t){ evidenceFor=null; return; }
    renderPanel(t);
    panel.scrollTo({top:0, behavior:reduceMotion?"auto":"smooth"});   // every selection starts at the top of its panel
    if(frame) for(const p of visiblePanes()){ const items=framingFor(p); if(items) focusOn(p, items); }
  }
  function renderPanel(t){
    pType.innerHTML="";
    const typeMark=document.createElement("span"); typeMark.className="mark"+(t.emergent?" new":""); typeMark.setAttribute("aria-hidden","true");
    pType.append(typeMark, t.emergent ? "emergent" : (t.industryTitle || t.type));
    pName.textContent=t.name; pSummary.textContent=t.summary;
    const showHook=step==="brand" && t.snippet;
    pHook.hidden=!showHook;
    pHook.textContent=showHook ? t.snippet : "";
    renderFigures(t);
    pStats.innerHTML="";
    const rows=[];
    if(t.isSubTheme) rows.push(["Part of", t.parentTitle]);
    if(t.mergedFrom) rows.push(["Merged in", t.mergedFrom.join(", ")]);
    if(t.emergent && t.phrases) rows.push(["Recurring phrases", t.phrases.slice(0,6).join(" · ")]);
    for(const [k,v] of rows){                       // the facts under the headline figures (lost in the port from the prototype)
      if(v==null || v==="") continue;
      const d=document.createElement("div");
      if(String(v).length>16) d.className="wide";   // long text (documents, phrases) takes the full width
      const dt=document.createElement("dt"); dt.textContent=k;
      const dd=document.createElement("dd"); if(v instanceof Node){ dd.appendChild(v); d.className="wide"; } else dd.textContent=v;
      d.append(dt,dd); pStats.appendChild(d);
    }
    pStats.hidden=!pStats.children.length;
    loadEvidence(t.isSubTheme ? t.parentSlug : t.slug, t.isSubTheme ? t.subKey : null);   // a topic opens within its theme

    const pPlays=document.getElementById("pPlays");
    pPlays.innerHTML=""; pPlays.hidden = step!=="uniqueness";
    if(step==="uniqueness"){
      if(!t.plays.length){
        const li=document.createElement("li"); li.className="why";
        li.textContent = t.emergent ? "Emergent industry — outside the base map, so there is no incumbent read." : "Unscored — no incumbent and owned axis have been set for this industry yet.";
        pPlays.appendChild(li);
      }
      if(t.plays[0] && t.plays[0].card){ pPlays.appendChild(marketCardEl(t.plays[0].card)); }
      else for(const pl of t.plays){
        const li=document.createElement("li");
        const chip=document.createElement("span"); chip.className="verdict-chip"; chip.style.background=verdictColor(pl.cls); chip.textContent=pl.label||VERDICT_LABEL[pl.cls];
        const head=document.createElement("b"); head.textContent=pl.play;
        const why=document.createElement("div"); why.className="why"; why.textContent=`Incumbent: ${pl.incumbent}. ${pl.why}`;
        li.append(chip, head, why);
        // a client tool: the panel shows the verdict and its reasoning, never an analyst's own notes or comparisons
        const jv=document.createElement("div"); jv.className="why"; jv.textContent=pl.ruleNote||"Based on the brand's owned axis against the industry's incumbent."; li.appendChild(jv);
        pPlays.appendChild(li);
      }
    }
    const relatedLbl=document.getElementById("pRelatedLbl");
    // the closest peaks at the selection's own level, with its own kind first (buildMeta)
    const items=t.w.items, sub=t.level==="subthemes";
    relatedLbl.textContent = sub ? "Related markets" : "Related industries";
    // a sub-theme's list is the other sub-themes of its theme, as the Sub-themes list above has them (most
    // documents first; renderEvidence puts them in that list's exact order once it has loaded)
    const siblings = t.isSubTheme;
    const rel = siblings
      ? items.filter(o=>o!==t && o.isSubTheme && o.parentSlug===t.parentSlug).map(o=>relatedScore(t,o))
          .sort((a,b)=>items[b.id].signalDocs-items[a.id].signalDocs || items[b.id].frequency-items[a.id].frequency || items[a.id].name.localeCompare(items[b.id].name))
      : t.related;
    document.getElementById("pRelatedTip").textContent = SIM
      ? (siblings ? "The other markets of the same industry, in the order of the list above. Relatedness runs from 0 to 1: how close the two are in meaning, from their definitions."
                  : "Ranked by relatedness: how close the two industries are in meaning, from their definitions"
                    + (SIM.layer==="client" ? ", pulled closer where the client's own documents keep discussing both" : "")
                    + ". Relatedness runs from 0 to 1. Hills sit near the industries they are most related to.")
      : siblings
      ? "The other markets of the same industry, in the order of the list above. Relatedness runs from 0 to 1: how close each sits to this one on the map."
      : "Ranked by relatedness: how close they sit on the map, with extra weight for "
        + (sub ? "markets of the same industry." : t.emergent ? "other emergent industries." : "industries in the same sector.")
        + " Relatedness runs from 0 to 1.";
    const relRows = rel.map(r=>{ const o=items[r.id]; return {item:o, name:o.name, emergent:o.emergent, score:r.score}; });
    document.getElementById("pRelatedSec").hidden = !relRows.length;
    document.getElementById("pRelatedCount").textContent = String(relRows.length);
    pRelated.innerHTML="";
    for(const o of relRows){
      const li=document.createElement("li"), b=document.createElement("button"); b.type="button";
      li.dataset.slug=o.item.slug;
      li.addEventListener("pointerenter",()=>setHover(o.item));
      li.addEventListener("pointerleave",()=>setHover(null));
      const n=document.createElement("span"); n.className="rn";
      const mk=document.createElement("span"); mk.className="mark"+(o.emergent?" new":""); mk.setAttribute("aria-hidden","true");
      const nm=document.createElement("span"); nm.textContent=o.name;
      n.append(mk,nm);
      const bar=document.createElement("span"); bar.className="bar";
      const fill=document.createElement("i"); fill.style.width=Math.round(o.score*100)+"%"; bar.appendChild(fill);
      const v=document.createElement("span"); v.className="rv"; v.textContent=o.score.toFixed(2); v.title="Relatedness, 0 to 1";
      b.append(n,bar,v); b.addEventListener("click",()=>select(o.item));
      li.appendChild(b); pRelated.appendChild(li);
    }
  }
  document.getElementById("pClose").addEventListener("click",closePanel);
  document.getElementById("btnLibrary").addEventListener("click",()=>panel.classList.contains("library") ? select(null) : openLibrary());
  document.addEventListener("keydown",e=>{ if(e.key==="Escape" && panelOpen) closePanel(); });

  // frame the given themes in a pane at ~48% of its (settled) viewport — the tighter of
  // width or height decides the zoom; the look-at point is height-aware
  function focusOn(p, items){
    if(!items.length) return;
    const c=p.cam, flat=p.mode==="2d";
    const pts=items.map(t=>{ const [x,z]=posOf(p,t); return [x, flat?0:(t.peak??0)+0.05, z]; });
    // each hill's ground footprint as four points round its base: the bubble in 2-D, else the hill's visible
    // spread (about 1.6 sigma of its current width, which follows Normal or Performance)
    const footR=t=> flat ? bubbleR(t) : 1.6*0.95*spreadMul*t.size;
    const ring=[]; for(const t of items){ const [x,z]=posOf(p,t), r=footR(t); ring.push([x+r,0,z],[x-r,0,z],[x,0,z+r],[x,0,z-r]); }
    let cx=0,cy=0,cz=0; for(const q of pts){ cx+=q[0]; cy+=q[1]; cz+=q[2]; } cx/=pts.length; cy/=pts.length; cz/=pts.length;
    // the look-at point IS the group's 3-D centroid, so orbiting (auto or by hand) pivots on it
    c.centerTarget=[cx,cy,cz];
    const phi=Math.max(0.02,c.phiTarget), sp=Math.sin(phi), cp=Math.cos(phi);
    const eye=[cx+R*sp*Math.sin(c.theta), cy+R*cp, cz+R*sp*Math.cos(c.theta)];
    const view=lookAt(eye,[cx,cy,cz],[0,1,0]);
    // the lines' tops: each arc rises 0.35 + 0.22 x its length above the middle of its two ends (buildArcs)
    const [ax,az]=posOf(p,items[0]);
    if(!flat) for(const o of items.slice(1)){ const [ox,oz]=posOf(p,o), d=Math.hypot(ox-ax,oz-az);
      ring.push([(ax+ox)/2, ((items[0].peak??0)+(o.peak??0))/2+0.05+0.35+0.22*d, (az+oz)/2]); }
    const vs=pts.concat(ring).map(q=>transform(view,q));
    const x0=Math.min(...vs.map(v=>v[0])), x1=Math.max(...vs.map(v=>v[0])), y0=Math.min(...vs.map(v=>v[1])), y1=Math.max(...vs.map(v=>v[1]));
    const MIN_BOX=2.6;                                     // about a mid-sized hill and a neighbour: a lone small hill frames no closer
    const bw=Math.max(MIN_BOX,x1-x0), bh=Math.max(MIN_BOX*0.6,y1-y0);
    const Wv=settledWidth(p), H=Math.max(1,p.rect[3]);
    const FILL=0.85, PAD=32;
    const midX=(x0+x1)/2, midY=(y0+y1)/2;
    let ppu=Math.min((FILL*H-2*PAD)/bh, (FILL*Wv-2*PAD)/bw);
    // names sit centred over their peaks (about 7.2px a letter) and may use the whole visible width up to 8px
    // from its edges; zoom out further only as far as that needs, and never below 60% of the hills' framing
    const ppuHills=ppu;
    for(const q of pts){ const i=pts.indexOf(q), dx=Math.abs(transform(view,q)[0]-midX), hw=(items[i].name.length*7.2+22)/2;
      if(dx>1e-6) ppu=Math.min(ppu, (Wv/2-8-hw)/dx); }
    ppu=Math.max(ppu, 0.6*ppuHills);
    c.zoomTarget=Math.min(4,Math.max(0.45, ppu*2*6.2/H));   // a selection zooms in at most 4x
    // centre the view on that box, not on the peaks' 3-D middle (which left the group high): shift the look-at
    // point along the ground so the box's middle lands in the middle of the visible area
    const v0=transform(view,[cx,cy,cz]);
    // move along the camera's own right and up (so a vertical shift is never stretched across the ground at a
    // low tilt), and never further than 3 units from the group's middle
    const e1=[Math.cos(c.theta),0,-Math.sin(c.theta)], fw=[cx-eye[0],cy-eye[1],cz-eye[2]], fl=Math.hypot(...fw)||1;
    const f=fw.map(v=>v/fl), e2=[e1[1]*f[2]-e1[2]*f[1], e1[2]*f[0]-e1[0]*f[2], e1[0]*f[1]-e1[1]*f[0]];
    const d1=transform(view,[cx+e1[0],cy+e1[1],cz+e1[2]]), d2=transform(view,[cx+e2[0],cy+e2[1],cz+e2[2]]);
    const a11=d1[0]-v0[0], a21=d1[1]-v0[1], a12=d2[0]-v0[0], a22=d2[1]-v0[1], det=a11*a22-a12*a21;
    if(Math.abs(det)>1e-6){ const dx=midX-v0[0], dy=midY-v0[1]; let u=(dx*a22-dy*a12)/det, w=(a11*dy-a21*dx)/det;
      const m=Math.hypot(u,w); if(m>3){ u*=3/m; w*=3/m; }
      c.centerTarget=[cx+u*e1[0]+w*e2[0], cy+u*e1[1]+w*e2[1], cz+u*e1[2]+w*e2[2]]; }
    // guard: the frame must show at least one of the hills it frames, with finite numbers; if not, fall back to
    // the previous framing (the peaks' middle, peaks only, at about half the pane)
    { const ct=c.centerTarget, zt=c.zoomTarget, hh=6.2/zt, hw=hh*Wv/H, vc=transform(view,ct);
      const shows=Number.isFinite(zt) && ct.every(Number.isFinite) && pts.some(q=>{ const v=transform(view,q); return Math.abs(v[0]-vc[0])<=hw && Math.abs(v[1]-vc[1])<=hh; });
      if(!shows){
        console.warn('selection framing fell back to the previous framing: '+items.map(t=>t.slug).join(', '));
        const pv=pts.map(q=>transform(view,q)), pw=Math.max(0.05, Math.max(...pv.map(v=>v[0]))-Math.min(...pv.map(v=>v[0]))), ph=Math.max(0.05, Math.max(...pv.map(v=>v[1]))-Math.min(...pv.map(v=>v[1])));
        c.centerTarget=[cx,cy,cz];
        c.zoomTarget=Math.min(MAX_ZOOM,Math.max(0.45, Math.min((0.48*H-96)/ph, (0.48*Wv-96)/pw)*2*6.2/H));
      } }
  }

  // ---------- arcs: raised curves from the selection to its related themes, per pane ----------
  // each segment is drawn as a thin ribbon, uWidth CSS pixels wide on screen (GL lines are always 1 pixel)
  const ARC_VS=`#version 300 es
  precision highp float;
  in vec3 aA; in vec3 aB; in float aEnd; in float aSide; in float aT;
  uniform mat4 uProjView; uniform vec2 uPx; uniform float uWidth;
  out float vT; out float vS;
  void main(){
    vec4 a=uProjView*vec4(aA,1.0), b=uProjView*vec4(aB,1.0);
    vec2 sa=a.xy/a.w*uPx*0.5, sb=b.xy/b.w*uPx*0.5;
    vec2 d=sb-sa; d = length(d)>1e-4 ? normalize(d) : vec2(1.0,0.0);
    vec4 p = aEnd>0.5 ? b : a;
    p.xy += vec2(-d.y,d.x)*aSide*(uWidth*0.5)/(uPx*0.5)*p.w;
    vT=aT; vS=aSide; gl_Position=p;
  }`;
  const ARC_FS=`#version 300 es
  precision highp float; in float vT; in float vS;
  uniform vec3 uColor; uniform vec3 uInk; uniform float uTime; uniform float uAlpha; out vec4 frag;
  void main(){
    float cross = step(1.5, vT), t = vT - 2.0*cross;   // a cross-industry arc carries t + 2: draw it dashed
    if(cross > 0.5 && fract(t*18.0) > 0.55) discard;
    float edge = 1.0 - smoothstep(0.45, 1.0, abs(vS));   // soft edges
    if(uTime < 0.0){ frag=vec4(uColor, mix(0.9,0.5,t)*uAlpha*edge); return; }   // reduced motion: static
    float head = fract(uTime*0.45);                 // travels start -> end every ~2.2s
    float d = t - head;
    float tail = smoothstep(-0.25, 0.0, d) * (1.0 - smoothstep(0.0, 0.02, d));
    float a = mix(0.62, 0.34, t) + tail*0.6;
    frag=vec4(mix(uColor, uInk, tail*0.7), min(1.0,a)*uAlpha*edge);
  }`;
  const arcProg=gl.createProgram();
  gl.attachShader(arcProg,compile(gl.VERTEX_SHADER,ARC_VS));
  gl.attachShader(arcProg,compile(gl.FRAGMENT_SHADER,ARC_FS));
  for(const [k,n] of ["aA","aB","aEnd","aSide","aT"].entries()) gl.bindAttribLocation(arcProg,k,n);
  gl.linkProgram(arcProg);
  const AU={projView:gl.getUniformLocation(arcProg,"uProjView"), color:gl.getUniformLocation(arcProg,"uColor"),
            time:gl.getUniformLocation(arcProg,"uTime"), alpha:gl.getUniformLocation(arcProg,"uAlpha"), px:gl.getUniformLocation(arcProg,"uPx"), width:gl.getUniformLocation(arcProg,"uWidth"), ink:gl.getUniformLocation(arcProg,"uInk")};
  for(const p of panes){
    p.arcVao=gl.createVertexArray(); gl.bindVertexArray(p.arcVao);
    p.arcBuf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,p.arcBuf);
    // per vertex: segment start (3), segment end (3), which end (1), side (1), position along the arc (1)
    for(const [k,n,off] of [[0,3,0],[1,3,12],[2,1,24],[3,1,28],[4,1,32]]){ gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k,n,gl.FLOAT,false,36,off); }
    gl.bindVertexArray(null);
  }
  function buildArcs(p,t){
    p.arcVerts=0;
    if(!t) return;
    const flat=p.mode==="2d", N=40, out=[];
    const [ax,az]=posOf(p,t), a=[ax, flat?0.06:(t.peak??0)+0.05, az];
    for(const r of t.related){
      const o=t.w.items[r.id], [ox,oz]=posOf(p,o), b=[ox, flat?0.06:(o.peak??0)+0.05, oz];
      const xo = SIM && t.level==="subthemes" && o.parentSlug!==t.parentSlug ? 2 : 0;   // dashed: another industry's market
      const d=Math.hypot(b[0]-a[0],b[2]-a[2]), rise=flat?0:0.35+0.22*d;
      let prev=null;
      for(let i=0;i<=N;i++){
        const s=i/N;
        const pt=[a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s+Math.sin(s*Math.PI)*rise, a[2]+(b[2]-a[2])*s, s];
        if(prev){                                          // a ribbon segment: two triangles
          const A=prev.slice(0,3), B=pt.slice(0,3), v=(end,side)=>out.push(...A,...B,end,side,(end?pt[3]:prev[3])+xo);
          v(0,-1); v(0,1); v(1,-1); v(1,-1); v(0,1); v(1,1);
        }
        prev=pt;
      }
    }
    const data=new Float32Array(out);
    gl.bindBuffer(gl.ARRAY_BUFFER,p.arcBuf); gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
    p.arcVerts=data.length/9;
  }

  // ---------- interaction: the pane under the pointer owns the gesture ----------
  const paneAt=x=>visiblePanes().find(p=>x>=p.rect[0] && x<p.rect[0]+p.rect[2]) || visiblePanes()[0];
  let drag=null;
  canvas.addEventListener("pointerdown",e=>{
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
    // left-drag orbits and tilts; right-drag, middle-drag or shift-drag pans
    drag={x:e.clientX,y:e.clientY,pan:e.shiftKey || e.button===2 || e.button===1,pane:paneAt(e.clientX)};
    spin=false; setPressed(btnSpin,false);
    intro.camera=false;
  });
  canvas.addEventListener("contextmenu",e=>e.preventDefault());   // right-drag pans, so no menu over the map
  canvas.addEventListener("pointermove",e=>{
    if(!drag) return;
    const c=drag.pane.cam, dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    drag.x=e.clientX; drag.y=e.clientY;
    if(drag.pan || e.shiftKey){
      c.centerTarget=null;
      const k=0.011/c.zoom, st=Math.sin(c.theta), ct=Math.cos(c.theta);
      // on the ground, screen-right is (cosθ, -sinθ) and screen-down is (sinθ, cosθ);
      // a vertical drag covers more ground the more the view is tilted
      const dyW=dy/Math.max(Math.cos(c.phi),0.25);
      c.center[0]-=(dx*ct + dyW*st)*k;
      c.center[2]-=(dyW*ct - dx*st)*k;
    } else {
      c.thetaTarget=null;
      c.theta -= dx*0.006;
      if(drag.pane.mode!=="2d"){                            // the bubbles pane stays top-down
        c.phiTarget=Math.min(Math.PI*0.49, Math.max(0.02, c.phiTarget - dy*0.005));
        setPressed(btnView, c.phiTarget>0.18);
      }
    }
  });
  const endDrag=()=>{ if(drag){ drag=null; canvas.classList.remove("dragging"); } };
  canvas.addEventListener("pointerup",endDrag);
  canvas.addEventListener("pointercancel",endDrag);
  // wheel and trackpad zoom work wherever the cursor is (over labels, bubbles, controls), except inside
  // a panel that scrolls (the theme panel, the controls dock), which keeps its own scrolling
  addEventListener("wheel",e=>{
    if(e.target.closest?.(".panel,.dock-body")) return;
    e.preventDefault();
    const c=paneAt(e.clientX).cam;
    c.zoomTarget=null;
    c.zoom=Math.min(MAX_ZOOM,Math.max(0.45, c.zoom*(1 - e.deltaY*0.0012)));
  },{passive:false});

  // ---------- buttons, tabs, sliders ----------
  const btnView=document.getElementById("btnView");
  const btnSpin=document.getElementById("btnSpin");
  const btnLab=document.getElementById("btnLab");
  const setPressed=(b,v)=>b.setAttribute("aria-pressed", v?"true":"false");
  let spin=false;

  btnView.addEventListener("click",()=>{                    // tilt applies to the terrain pane
    const on=btnView.getAttribute("aria-pressed")==="true";
    setPressed(btnView,!on);
    paneA.cam.phiTarget = on ? 0.03 : Math.PI*0.28;
  });
  btnSpin.addEventListener("click",()=>{ spin=!spin; setPressed(btnSpin,spin); });
  // the controls dock: an accordion whose body holds the Theme and Terrain tabs
  const dockBody=document.getElementById("dockBody");
  btnLab.addEventListener("click",()=>{
    const open=btnLab.getAttribute("aria-expanded")!=="true";
    btnLab.setAttribute("aria-expanded", open?"true":"false");
    dockBody.hidden=!open;
    if(open) drawMiniMap();
  });
  for(const t of document.querySelectorAll(".dock-tabs .tab")){
    t.addEventListener("click",()=>{
      for(const o of document.querySelectorAll(".dock-tabs .tab")){
        const on=o===t;
        o.setAttribute("aria-selected", on?"true":"false");
        document.getElementById(o.getAttribute("aria-controls")).hidden=!on;
      }
      if(t.dataset.dock==="terrain") drawMiniMap();
    });
  }
  function resetCamera(){
    spin=false; setPressed(btnSpin,false);
    for(const p of visiblePanes()){
      const c=p.cam;
      c.thetaTarget=DEFAULT_THETA;
      c.phiTarget = p.mode==="2d" ? 0.02 : Math.PI*0.28;
      c.centerTarget=[0,0.4,0];
      c.zoomTarget=defaultZoom(p);
    }
    setPressed(btnView,true);
  }
  document.getElementById("btnReset").addEventListener("click",resetCamera);

  // map-style zoom and bearing, applied to every visible pane (the wheel zooms the pane under the cursor)
  function zoomBy(f){
    for(const p of visiblePanes()){
      const c=p.cam;
      c.zoomTarget=Math.min(MAX_ZOOM,Math.max(0.45,(c.zoomTarget??c.zoom)*f));
    }
  }
  function faceNorth(){                          // the shortest turn back to the default bearing
    spin=false; setPressed(btnSpin,false);
    for(const p of visiblePanes()){
      const c=p.cam, d=c.theta-DEFAULT_THETA;
      c.thetaTarget=c.theta-(d-2*Math.PI*Math.round(d/(2*Math.PI)));
    }
  }
  document.getElementById("btnZoomIn").addEventListener("click",()=>zoomBy(1.5));
  document.getElementById("btnZoomOut").addEventListener("click",()=>zoomBy(1/1.5));
  document.getElementById("btnNorth").addEventListener("click",faceNorth);
  addEventListener("keydown",e=>{
    if(e.metaKey||e.ctrlKey||e.altKey||e.target.closest?.("input,textarea,select")) return;
    if(e.key==="+"||e.key==="=") zoomBy(1.5);
    else if(e.key==="-"||e.key==="_") zoomBy(1/1.5);
  });
  // the compass needle points where the default "up the screen" direction now lies
  const compass=document.getElementById("compass");
  let compassDeg=0;
  function updateCompass(){
    const p=visiblePanes()[0], c=p.cam;
    const a=project(p,c.center), b=project(p,[c.center[0]-Math.sin(DEFAULT_THETA),c.center[1],c.center[2]-Math.cos(DEFAULT_THETA)]);
    const deg=Math.atan2(b[0]-a[0],a[1]-b[1])*180/Math.PI;
    if(Math.abs(deg-compassDeg)>0.5){ compassDeg=deg; compass.style.transform=`rotate(${deg.toFixed(1)}deg)`; }
  }

  /** Show a view's panes and chrome, without touching the cameras. */
  function applyView(mode){
    tab=mode;
    paneA.visible = mode!=="2d"; paneB.visible = mode!=="3d";
    for(const m of ["3d","2d","split"]) app.classList.toggle("tab-"+m, tab===m);
    for(const b of document.querySelectorAll(".view-tabs .tab")) b.setAttribute("aria-selected", b.dataset.view===mode?"true":"false");
    layoutPanes();
    // a single view shows one level: the hidden pane takes the shown one's, so the two stay interchangeable
    if(mode==="3d" && paneB.world!==paneA.world) showWorld(paneB, paneA.world);
    else if(mode==="2d" && paneA.world!==paneB.world) showWorld(paneA, paneB.world);
    renderIndustryLegend();
    handOver();
    buildRangeLabels();
    renderSelection();
    renderLevelTabs();
  }
  const loaded=()=>!!paneA.world;
  function setView(mode){
    if(!loaded()) return;
    if(viewFx) finishViewFx();
    if(mode===tab) return;
    if(!reduceMotion && ((tab==="3d" && mode==="2d") || (tab==="2d" && mode==="3d"))){ startViewFx(mode); return; }
    const before=new Set(visiblePanes().map(p=>p.id));
    applyView(mode);
    for(const p of visiblePanes()){
      const items=framingFor(p);
      if(items) focusOn(p, items);                          // keep both panes on the selection
      else if(!before.has(p.id) || mode!=="split"){ p.cam.centerTarget=[0,0.4,0]; p.cam.zoomTarget=defaultZoom(p); }
    }
  }
  for(const b of document.querySelectorAll(".view-tabs .tab")) b.addEventListener("click",()=>setView(b.dataset.view));

  // ---------- Terrain ⇄ Bubbles, as one movement. To the bubbles: the terrain's labels fade off; the camera rises
  // to look straight down, north up and framed as the bubbles will be; the contours undraw and the hills collapse,
  // left first; and as the camera eases to a stop the bubbles grow in place, left first, on a plane that pivots
  // with the camera. Back to the terrain, the reverse: the bubbles shrink, left first, as the camera tilts down and
  // the hills grow back behind them; the contours draw on, and the terrain's labels return once it has settled.
  // Times in ms from the start of the camera's part (after the labels).
  const VIEW_FX={LABELS:250, CAM:1000};
  const TO_FLAT={END:1350, UNDRAW:[0,600], SWEEP:[150,950], BUBBLES:[550,1350]};
  const TO_TERRAIN={END:1300, BUBBLES:[0,700], CAM:300, SWEEP:[400,1250], DRAW:[700,1300]};
  const PHASE_MS={labelsOut:VIEW_FX.LABELS, move:TO_FLAT.END, settle:TO_TERRAIN.END, labelsIn:VIEW_FX.LABELS};
  const span=(t,[a,b])=>Math.min(1,Math.max(0,(t-a)/(b-a)));
  function terrainLabels(o){ paneA.labelsEl.style.opacity=o; if(rangeLabelsEl) rangeLabelsEl.style.opacity=o; }
  const easeInOut=x=> x<0.5 ? 4*x*x*x : 1-Math.pow(-2*x+2,3)/2;
  let viewFx=null, savedTerrainCam=null;
  const camState=c=>({phi:c.phi, theta:c.theta, zoom:c.zoom, center:[...c.center]});
  const nearestTheta=(from,to)=>{ const d=from-to; return from-(d-2*Math.PI*Math.round(d/(2*Math.PI))); };
  function setCam(c,s){
    c.phi=c.phiTarget=s.phi; c.theta=s.theta; c.zoom=s.zoom; c.center=[...s.center];
    c.thetaTarget=null; c.zoomTarget=null; c.centerTarget=null;
  }
  /** Where a pane's camera is heading once focusOn (or the default framing) has set its targets. */
  function framedCam(p, phi, theta){
    const c=p.cam, items = framingFor(p);
    const was=c.theta; c.phiTarget=phi; c.theta=theta;                  // frame as seen from where it will rest
    if(items) focusOn(p, items); else { c.centerTarget=[0,0.4,0]; c.zoomTarget=defaultZoom(p); }
    const s={phi, theta, zoom:c.zoomTarget ?? c.zoom, center:[...(c.centerTarget || c.center)]};
    c.zoomTarget=null; c.centerTarget=null; c.theta=was;
    return s;
  }
  function startViewFx(to){
    endIntro();
    const a=paneA.cam, b=paneB.cam, now=performance.now();
    for(const btn of document.querySelectorAll(".view-tabs .tab")) btn.setAttribute("aria-selected", btn.dataset.view===to?"true":"false");
    paneB.rect=[...paneA.rect]; paneB.shift=paneA.shift;
    app.classList.add("view-fx");
    if(to==="2d"){
      savedTerrainCam=camState(a);
      const flat=framedCam(paneB, 0.02, DEFAULT_THETA);                 // the bubbles, north up, as they will rest
      setCam(b, flat);
      viewFx={to, phase:"labelsOut", t0:now, goal:flat};
      return;
    }
    // back to the terrain: it starts where the bubbles are, overhead and flat, beneath them
    setCam(a, {...camState(b), phi:0.02});
    viewFx={to, phase:"settle", t0:now, from:camState(a), goal:null, bcam:camState(b), bub:1};
    paneA.visible=true; layoutPanes(); beginBubbles(); terrainLabels("0");
    const back=savedTerrainCam;
    const framed=framedCam(paneA, back ? back.phi : Math.PI*0.28, back ? back.theta : DEFAULT_THETA);
    // with nothing selected, return to exactly where the terrain was left
    viewFx.goal = !sel && back ? {...back} : framed;
    viewFx.goal.theta=nearestTheta(a.theta, viewFx.goal.theta);        // turn back the short way
    setCam(a, viewFx.from);
  }
  /** The bubbles join the terrain for the hand-over: drawn over it (their floor is its flattened floor). */
  function beginBubbles(){ paneB.visible=true; app.classList.add("view-fade"); }
  function endBubbles(){
    app.classList.remove("view-fade");
    for(const L of paneB.labelNodes) L.el.style.opacity="";
  }
  /** How far a bubble (or its label) at screen x has grown in the hand-over: left first, in place. */
  function bubbleGrowAt(p, sx){
    const fx=viewFx;
    if(!fx || fx.bub==null || p!==paneB) return 1;
    const w=Math.max(1,p.rect[2]-(p.shift||0)), u=Math.min(1,Math.max(0,sx/w));
    const c=Math.min(1,Math.max(0,(fx.bub-0.4*(fx.to==="2d" ? u : 1-u))/0.6));
    return c*c*(3-2*c);
  }
  /** Advance the transition; called each frame before the cameras update. */
  function stepViewFx(now){
    if(!viewFx) return;
    const f=Math.min(1,(now-viewFx.t0)/PHASE_MS[viewFx.phase]), e=easeInOut(f);
    viewFx.f=f;
    if(viewFx.phase==="labelsOut" || viewFx.phase==="labelsIn"){
      terrainLabels(String(viewFx.phase==="labelsOut" ? 1-e : e));
      if(f<1) return;
      if(viewFx.phase==="labelsIn"){ viewFx=null; terrainLabels(""); app.classList.remove("view-fx"); return; }
      // labels gone: now the camera rises, from wherever it is (auto-rotate may have turned it meanwhile)
      const a=paneA.cam;
      viewFx={to:viewFx.to, phase:"move", t0:now, from:camState(a), goal:{...viewFx.goal, theta:nearestTheta(a.theta, DEFAULT_THETA)}};
      return;
    }
    const t=now-viewFx.t0, toFlat=viewFx.phase==="move";
    const cam=easeInOut(Math.min(1,Math.max(0,(toFlat ? t : t-TO_TERRAIN.CAM)/VIEW_FX.CAM)));
    const a=viewFx.from, g=viewFx.goal, lerp=(x,y)=>x+(y-x)*cam;
    setCam(paneA.cam, {phi:lerp(a.phi,g.phi), theta:lerp(a.theta,g.theta), zoom:lerp(a.zoom,g.zoom),
                       center:a.center.map((v,i)=>lerp(v,g.center[i]))});
    if(paneB.visible) setCam(paneB.cam, camState(paneA.cam));        // the bubbles' plane pivots with the terrain's
    if(toFlat){
      viewFx.bub=span(t, TO_FLAT.BUBBLES);
      if(viewFx.bub>0 && !paneB.visible){ beginBubbles(); setCam(paneB.cam, camState(paneA.cam)); }
      if(f<1) return;
      endBubbles(); viewFx=null; terrainLabels(""); app.classList.remove("view-fx"); applyView("2d");
      return;
    }
    if(paneB.visible){
      viewFx.bub=1-span(t, TO_TERRAIN.BUBBLES);
      if(viewFx.bub<=0){ endBubbles(); applyView("3d"); setCam(paneB.cam, viewFx.bcam); }
    }
    if(f<1) return;
    viewFx={to:viewFx.to, phase:"labelsIn", t0:now};                  // settled: the labels come back
  }
  /** The terrain through the hand-over (see TO_FLAT and TO_TERRAIN); arcs fade with its contours. */
  function terrainFx(){
    const fx=viewFx;
    if(!fx || fx.phase==="labelsOut" || fx.phase==="labelsIn") return {sweep:0, collapse:1, undraw:1, arcs:1};
    if(fx.phase==="move"){
      const t=(fx.f ?? 0)*TO_FLAT.END, off=1-span(t, TO_FLAT.UNDRAW);
      return {sweep:span(t, TO_FLAT.SWEEP), collapse:1, undraw:off, arcs:off};
    }
    const t=(fx.f ?? 0)*TO_TERRAIN.END, on=span(t, TO_TERRAIN.DRAW);
    return {sweep:span(t, TO_TERRAIN.SWEEP), collapse:0, undraw:on, arcs:on};
  }
  /** Jump a transition in flight to its end (another view was asked for). */
  function finishViewFx(){
    const fx=viewFx; viewFx=null;
    endBubbles(); terrainLabels(""); app.classList.remove("view-fx");
    if(fx.to==="2d") applyView("2d");
    else { applyView("3d"); if(fx.goal) setCam(paneA.cam, fx.goal); if(fx.bcam) setCam(paneB.cam, fx.bcam); }
  }

  const $=id=>document.getElementById(id);
  const shrinkEl=$("shrink"), heightEl=$("heightS"), spreadEl=$("spreadS"), noiseEl=$("noiseS");
  shrinkEl.addEventListener("input",()=>{
    directTransitionFinalField=null;
    shrinkTarget=shrinkEl.value/100; $("shrinkVal").textContent=shrinkEl.value+"%";
    if(front===Infinity) front=-HALF-BAND;               // start a roll; a roll in progress just retargets
  });
  function bubblePresenceScale(t){
    const from=t.transitionFromScale ?? 1;
    const to=1-t.shrinkR;
    return from+(to-from)*fieldAt(t.x);
  }
  // A change to the terrain (its level, or the step / brand) rolls to the new terrain with the intro's easing:
  // each column eases in and out, the right edge starting later than the left. Labels on the panes in
  // `roll.panes` leave and build on column by column; other labels stay where they are.
  const ROLL={D:1400, STAGGER:0.4};
  let roll=null, leavingLabels=[];
  function stepRoll(now){
    if(!roll) return false;
    const f=reduceMotion ? 1 : Math.min(1,(now-roll.t0)/ROLL.D);
    for(let i=0;i<FIELD_N;i++){
      const u=Math.min(1,Math.max(0,(f-roll.stagger*i/(FIELD_N-1))/(1-roll.stagger)));
      field[i]=u<0.5 ? 4*u*u*u : 1-Math.pow(-2*u+2,3)/2;
      fieldBytes[i]=Math.round(field[i]*255);
    }
    uploadField(); updatePeaks(); drawMiniMap();
    for(const L of leavingLabels) if(!L.gone && fieldAt(L.t.x)>0.02){ L.gone=true; L.el.classList.add("gone"); }
    for(const p of roll.panes) for(const L of p.labelNodes) if(!L.grown && fieldAt(L.t.x)>=0.99){ L.grown=true; L.el.classList.add("grown"); }
    if(f>=1) endRoll();
    return true;
  }
  function endRoll(){
    if(!roll) return;
    for(const p of roll.panes){
      p.labelsEl.classList.remove("build");
      for(const L of p.labelNodes) if(!L.grown){ L.grown=true; L.el.classList.add("grown"); }
    }
    rangeLabelsEl.classList.remove("build");
    roll=null;
    for(const L of leavingLabels) L.el.remove();
    leavingLabels=[];
    field.fill(1); fieldBytes.fill(255); uploadField();
    finishDirectTransition();
  }
  /**
   * Roll the terrain from what is on screen to what `change` leaves it showing (a new level for the terrain
   * pane, or a new brand reading). Every bubble keeps its current size as the roll's starting point, so a
   * pane whose peaks did not change does not move. `labelPanes` rebuild their labels as the roll passes.
   * `stagger` 0 morphs every column together instead of rolling left to right.
   */
  function rollTerrain(change, labelPanes=[], {stagger=ROLL.STAGGER}={}){
    endIntro();
    if(roll) endRoll();                                   // a new change mid-roll starts from where the last one landed
    for(const w of builtWorlds()) for(const t of w.items) t.transitionFromScale=bubblePresenceScale(t);
    const visible=captureVisibleHeightmap();
    change();
    const finalField = brandPack ? 1 : 0;
    repaintTerrain();
    useVisibleHeightmapAsBase(visible);
    field.fill(0); fieldBytes.fill(0); uploadField();
    directTransitionFinalField=finalField;
    shrinkTarget=1;
    shrinkEl.value=String(finalField*100);
    $("shrinkVal").textContent=(finalField*100)+"%";
    front=Infinity;                                       // the eased roll (stepRoll) carries it, not the slider's front
    roll={t0:performance.now(), panes:labelPanes, stagger};
    for(const p of labelPanes){ p.labelsEl.classList.add("build"); buildLabels(p, true); }
    if(labelPanes.includes(rangePane())) rangeLabelsEl.classList.add("build");
    updatePeaks();
    drawMiniMap();
  }
  /** With nothing selected, pull a pane's camera back to its whole landscape. */
  function reframe(panes=visiblePanes()){
    if(sel) return;
    for(const p of panes){ p.cam.centerTarget=[0,0.4,0]; p.cam.zoomTarget=defaultZoom(p); }
  }
  function renderStepChrome(){
    for(const b of document.querySelectorAll(".step-tabs .tab")) b.setAttribute("aria-selected", b.dataset.step===step?"true":"false");
    for(const b of document.querySelectorAll(".subset-tabs .tab")) b.setAttribute("aria-selected", b.dataset.subset===subset?"true":"false");
    // brand tabs only when there is a choice: one brand's map needs no toggle
    document.querySelector(".subset-tabs").hidden = step==="landscape" || document.querySelectorAll(".subset-tabs .tab").length<2;
    for(const b of document.querySelectorAll(".rule-tabs .tab")) b.setAttribute("aria-selected", b.dataset.rule===rule?"true":"false");
    document.querySelector(".rule-tabs").hidden = step!=="uniqueness" || !(IN_TOOL && ruleSets && ruleSets.rules.length>1);
    document.getElementById("rampLbl").firstChild.textContent = "Elevation · "+HEIGHT_WORD[heightBy]+(step==="landscape" ? " " : ", scaled by brand presence ");
  }
  /** A new step or brand: every world takes its reading and the terrain rolls to it; nothing is re-laid. */
  function setPack(){
    const pack = step==="uniqueness" ? verdictPack(subset) : step==="brand" ? (brandPresence.brands[subset] || {themes:{}}) : null;
    rollTerrain(()=>{ brandPack=pack; for(const w of builtWorlds()) applyPack(w, pack); });
    for(const p of panes) for(const L of p.labelNodes){ if(L.t.verdict) L.el.dataset.verdict=L.t.verdict; else delete L.el.dataset.verdict; }
    for(const B of bubbleNodes){ if(B.t.verdict) B.g.dataset.verdict=B.t.verdict; else delete B.g.dataset.verdict; }
    renderIndustryLegend();
    if(sel) renderPanel(sel);                              // the camera stays where it is: only the reading changes
  }
  function setStep(name){
    if(name!=="landscape" && !brandsReady) return;
    if(name===step || !loaded()) return;
    step=name;
    if(step==="landscape") subset="industry";
    else if(subset==="industry") subset=firstBrand ?? "industry";
    renderStepChrome();
    setPack();
  }
  /** A fit rule (or Changed): each brand's market verdicts come from that rule's set; the camera stays put. */
  function setRule(key){
    if(key===rule || !ruleSets) return;
    rule=key;
    const keys = ruleSets.rules.map(r=>r.key), first = keys[0], second = keys[keys.length-1];   // the default against the baseline
    for(const [id,b] of Object.entries(verdictData.brands)){
      const sets=ruleSets.byBrand[id] || {}, base=ruleSets.base[id] || {};
      if(key!=="changed"){ b.hills={...base, ...(sets[key]||{})}; continue; }
      const grey=(h,why)=>({cls:"unscored", plays:h.plays.map((p,i)=>i?p:{...p, cls:"unscored", label:why+(p.label?" · "+p.label:"")})});
      const hills={};
      for(const [slug,h] of Object.entries(base)) hills[slug]=(sets[first]||{})[slug] ? h : grey(h,"Not a market");
      for(const [slug,h] of Object.entries(sets[first]||{})) hills[slug]=h.cls!==(sets[second]||{})[slug]?.cls ? h : grey(h,"Unchanged");
      b.hills=hills;
    }
    renderStepChrome();
    setPack();
  }
  function marketCardEl(c){
    const el=(tag, cl, text)=>{ const e=document.createElement(tag); if(cl) e.className=cl; if(text!=null) e.textContent=text; return e; };
    const mark=(m)=>{ if(!m) return null; const s=el("span","lowconf",m.symbol); s.title=m.title; s.tabIndex=0; s.setAttribute("aria-label",m.title); return s; };
    const li=el("li","mcard");
    const tiles=el("div","tiles");
    for(const t of c.tiles||[]){ const d=el("div","tile"); const v=el("div","v",t.v); if(t.tone) v.style.color=verdictColor(t.tone); const mk=mark(t.marker); if(mk) v.appendChild(mk); d.append(el("div","k",t.k), v, el("div","t",t.t)); tiles.appendChild(d); }
    li.appendChild(tiles);
    if(c.headline) li.appendChild(el("div","head",c.headline));
    if(c.bars){ const w=el("div"); w.appendChild(el("h4",null,c.bars.title));
      for(const d of c.bars.items){ const b=el("div","bar"); const tr=el("div","track"); const f=el("div","fill"); f.style.width=Math.round(d.value*100)+"%"; tr.appendChild(f); b.append(el("span",null,d.label), tr, el("span","n",d.value.toFixed(2))); w.appendChild(b); }
      li.appendChild(w); }
    if(c.table){ const w=el("div"); w.appendChild(el("h4",null,c.table.title)); const tb=el("table"); const hr=el("tr"); for(const h of c.table.head) hr.appendChild(el("th",null,h)); tb.appendChild(hr);
      for(const r of c.table.rows){ const tr=el("tr"); r.cells.forEach((x,i)=>tr.appendChild(el("td", i===1?"n":(i>1?"dim":null), x)));
        const td=el("td"); if(r.box){ const bx=el("span","box"); const dot=el("i"); dot.style.background=verdictColor(r.tone); bx.append(dot, document.createTextNode(r.box)); td.appendChild(bx); } tr.appendChild(td); tb.appendChild(tr); }
      w.appendChild(tb); li.appendChild(w); }
    for(const l of c.lists||[]){ const w=el("div"); w.appendChild(el("h4",null,l.title));
      for(const r of l.rows){ const row=el("div","lead"); const left=el("span"); left.appendChild(el("b",null,r.left)); const right=el("span","s",r.right); const mk=mark(r.marker); if(mk) right.prepend(mk); row.append(left,right); w.appendChild(row); }
      li.appendChild(w); }
    return li;
  }
  function setSubset(name){
    if(name===subset) return;
    subset=name;
    renderStepChrome();
    setPack();
  }
  for(const b of document.querySelectorAll(".step-tabs .tab")) b.addEventListener("click",()=>setStep(b.dataset.step));

  // ---------- levels: Themes (one peak per theme) or Sub-themes (every theme broken into its sub-themes) ----------
  /** Point a pane at a world: the terrain repaints for the terrain pane, the bubbles for the bubbles pane. */
  function showWorld(p, w, {animate=false}={}){
    p.world=w;
    if(p===paneA){
      if(animate) return;                                 // rollTerrain repaints and rebuilds the labels
      repaintTerrain();
      buildLabels(p);
    } else {
      buildLabels(p);
      buildBubbles();
    }
  }
  /** A sub-theme selection outlives only while some pane shows sub-themes; then it becomes its theme. */
  function handOver(){
    if(sel && sel.level==="subthemes" && paneA.world.level!=="subthemes" && paneB.world.level!=="subthemes"){
      sel = world("themes").bySlug.get(sel.parentSlug) || null;
      select(sel, {frame:false});
    }
  }
  /** The level toggles: the single one shows the shown pane's level; in Split each side has its own. */
  function renderLevelTabs(){
    const shown = paneA.visible ? paneA : paneB;
    for(const b of document.querySelectorAll(".level-tabs .tab")){
      const pane = b.closest(".level-tabs").dataset.pane;
      const level = pane==="A" ? paneA.world.level : pane==="B" ? paneB.world.level : shown.world.level;
      b.setAttribute("aria-selected", b.dataset.level===level ? "true" : "false");
    }
  }
  let swapTimer=null;
  /**
   * Set a pane's level, or both: `setLevels({A, B})`. The terrain rolls to its new level with its labels
   * building on; the bubbles fade out and back at theirs; a hidden pane changes at once. The selection
   * carries across (a theme becomes its cluster, a sub-theme hands over to its theme when no pane shows
   * sub-themes), and only the panes that changed re-frame.
   */
  function setLevels({A, B}){
    if(!loaded()) return;
    const toA = A && A!==paneA.world.level ? world(A) : null;
    const toB = B && B!==paneB.world.level ? world(B) : null;
    if(!toA && !toB) return;
    if(viewFx) finishViewFx();
    endIntro();
    if(toA){
      if(paneA.visible && !reduceMotion) rollTerrain(()=>showWorld(paneA, toA, {animate:true}), [paneA]);
      else { if(roll) endRoll(); showWorld(paneA, toA); }
      renderIndustryLegend();
    }
    if(toB){
      if(swapTimer){ clearTimeout(swapTimer); swapTimer=null; }
      if(paneB.visible && !reduceMotion){
        bubblesEl.classList.add("swap"); paneB.labelsEl.classList.add("swap");
        paneB.world=toB;                                   // the selection and framing below already use it
        swapTimer=setTimeout(()=>{
          swapTimer=null;
          showWorld(paneB, paneB.world);
          renderSelection();
          bubblesEl.classList.remove("swap"); paneB.labelsEl.classList.remove("swap");
        }, 180);
      } else showWorld(paneB, toB);
    }
    handOver();
    buildRangeLabels();
    renderSelection();
    renderLevelTabs();
    for(const p of [toA && paneA, toB && paneB].filter(Boolean)){
      if(!p.visible) continue;
      const items=framingFor(p);
      if(items) focusOn(p, items); else reframe([p]);
    }
  }
  const topbarEl=document.querySelector(".topbar");
  new ResizeObserver(()=>app.style.setProperty("--topbar-h", topbarEl.offsetHeight+"px")).observe(topbarEl);
  for(const b of document.querySelectorAll(".level-tabs .tab")){
    b.addEventListener("click",()=>{
      const pane=b.closest(".level-tabs").dataset.pane, level=b.dataset.level;
      setLevels(pane==="A" ? {A:level} : pane==="B" ? {B:level} : {A:level, B:level});
    });
  }


  heightEl.addEventListener("input",()=>{                 // a uniform: free
    heightMul=heightEl.value/100; $("heightVal").textContent=heightMul.toFixed(1)+"×";
    updatePeaks(); rebuildArcs();
  });
  noiseEl.addEventListener("input",()=>{                  // a uniform: free
    noiseAmp=noiseEl.value/100*0.35; $("noiseVal").textContent=noiseEl.value;
  });
  let repaintQueued=false;
  function syncHillMode(){
    for(const b of document.querySelectorAll('.mode-tabs .tab')) b.setAttribute('aria-selected', (b.dataset.mode==='performance')===perfMode?'true':'false');
    renderStepChrome();
    if(sel) renderPanel(sel);   // the panel leads with size and growth in Performance
    document.getElementById('perfTip')?.setAttribute('hidden','');   // a hover card from the other mode never lingers
  }
  function setHillMode(mode){
    perfMode = mode==='performance';   // frame() eases the hills and the colour there
    syncHillMode();
    const u=new URL(location.href); if(perfMode) u.searchParams.set('view','performance'); else u.searchParams.delete('view'); history.replaceState(null,'',u);
  }
  for(const b of document.querySelectorAll('.mode-tabs .tab')) b.addEventListener('click',()=>setHillMode(b.dataset.mode));
  syncHillMode();
  function stepHillMix(dt){
    const k = reduceMotion ? 1 : dt/HILL_SECONDS, toward=(v,to)=> to>v ? Math.min(to,v+k) : Math.max(to,v-k);
    const fT = perfMode ? 1 : 0;
    colourP = toward(colourP, fT);
    if(footP===fT) return;
    if(!hillEnds){ const now=hillSnapshotNow(), other=hillSnapshot(fT); hillEnds = fT ? {a:now, b:other} : {a:other, b:now}; }
    footP = toward(footP, fT); const e = easeHill(footP);
    const A=hillEnds.a, B=hillEnds.b;
    for(let i=0;i<hmBase.length;i++){ hmBase[i]=A.base[i]+(B.base[i]-A.base[i])*e; hmShrunk[i]=A.shrunk[i]+(B.shrunk[i]-A.shrunk[i])*e; }
    for(let i=0;i<gData.length;i++) gData[i]=A.g[i]+(B.g[i]-A.g[i])*e;
    uploadHeightmap(hmTexBase,hmBase); uploadHeightmap(hmTexIndustry,hmBase); uploadHeightmap(hmTexShrunk,hmShrunk);
    gl.bindTexture(gl.TEXTURE_2D,growthTex); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,HM,HM,gl.RGBA,gl.FLOAT,gData);
    terrainItems().forEach((t,j)=>{ const pa=A.peaks[j], pb=B.peaks[j]; if(pa&&pb){ t.peakBase=pa[0]+(pb[0]-pa[0])*e; t.peakShrunk=pa[1]+(pb[1]-pa[1])*e; } });
    updatePeaks();
    if(footP===fT){ setHillSizes(e); drawMiniMap(); rebuildArcs(); }   // landed: the blend at 0 or 1 is that end state exactly
  }
  let hillEnds = null;   // the Normal (a) and Performance (b) heightmaps, painted once per transition
  function setHillSizes(e){ for(const w of builtWorlds()) for(const t of w.items) if(t.marketFoot!=null){ t.size = t.evidenceSize + (t.marketFoot-t.evidenceSize)*e; t.height = t.evidenceHeight + (t.perfHeight-t.evidenceHeight)*e; setEvRatio(t,e); } }
  let hillPainting = false;
  const hillSnapshotNow = () => ({ base: hmBase.slice(), shrunk: hmShrunk.slice(), g: gData.slice(), peaks: terrainItems().map(t=>[t.peakBase,t.peakShrunk]) });
  function hillSnapshot(e){
    hillPainting = true; setHillSizes(e); repaintTerrain(); hillPainting = false;
    return hillSnapshotNow();
  }
  const perfTip=document.createElement('div'); perfTip.id='perfTip'; perfTip.hidden=true;
  perfTip.style.cssText='position:fixed;z-index:60;pointer-events:none;max-width:280px;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.35;background:var(--panel,#fff);color:var(--ink,#222);box-shadow:0 4px 18px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08)';
  document.body.appendChild(perfTip);
  let tipX=0, tipY=0; addEventListener('pointermove',e=>{ tipX=e.clientX; tipY=e.clientY; if(!perfTip.hidden) placeTip(); },{passive:true});
  function placeTip(){ const r=perfTip.getBoundingClientRect(); perfTip.style.left=Math.min(innerWidth-r.width-8, tipX+14)+'px'; perfTip.style.top=Math.min(innerHeight-r.height-8, tipY+14)+'px'; }
  const perfRange = p => p.lo!=null && p.hi!=null ? `${p.lo.toFixed(1)} to ${p.hi.toFixed(1)}%` : null;
  // growth on one scale for every industry and market: a thin line, a dot at the estimate, the ends of the scale under it;
  // an estimated rate also shows its likely range, as a shaded band and a line of text between the ends (10 Nov)
  function growthBar(p){
    const x=v=>`${(100*(v-GAX[0])/(GAX[1]-GAX[0])).toFixed(2)}%`, mk=(css)=>{ const e=document.createElement('i'); e.style.cssText='position:absolute;display:block;'+css; return e; };
    const box=document.createElement('span'); box.className='gbar';
    box.title=`${p.r.toFixed(1)}% a year${perfRange(p) ? `, likely ${perfRange(p)}` : ''}. Every bar uses the same scale, ${GAX[0]} to ${GAX[1]}% a year.`;
    const track=document.createElement('span'); track.style.cssText='position:relative;display:block;height:14px';
    track.append(mk('left:0;right:0;top:6px;height:2px;border-radius:1px;background:color-mix(in srgb, var(--accent) 22%, transparent)'));
    if(perfRange(p)) track.append(mk(`left:${x(p.lo)};width:calc(${x(p.hi)} - ${x(p.lo)});top:5px;height:4px;border-radius:2px;background:color-mix(in srgb, var(--accent) 45%, transparent)`));
    track.append(mk(`left:${x(p.r)};top:0;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:color-mix(in srgb, var(--ink) 82%, transparent)`));
    const cap=document.createElement('span'); cap.className='gbar-cap';
    cap.innerHTML=`<span>${GAX[0]}%</span><span>${GAX[1]}%</span>`;
    if(perfRange(p)){ const r=document.createElement('span'); r.className='gbar-range'; r.textContent=`${p.lo.toFixed(1)}% \u2013 ${p.hi.toFixed(1)}%`;
      r.style.left=x(p.r); r.dataset.at=x(p.r); cap.append(r); }   // centred on the dot; fitRanges() keeps it clear of the axis end labels
    box.append(track,cap); return box;
  }
  /** Centre each range label on its dot; where that would touch an end label, align it to that side instead
   *  (8px clear), measured from the rendered text so it holds at any panel width. */
  function fitRanges(root){
    for(const r of root.querySelectorAll('.gbar-range')){
      const cap=r.parentElement, [lo,hi]=cap.querySelectorAll(':scope > span:not(.gbar-range)'), G=8;
      r.style.left=r.dataset.at; r.style.transform='translateX(-50%)';
      const c=cap.getBoundingClientRect(), a=r.getBoundingClientRect(), L=lo.getBoundingClientRect(), H=hi.getBoundingClientRect();
      if(!c.width) continue;   // not laid out yet
      if(a.left < L.right+G){ r.style.left=`${L.right-c.left+G}px`; r.style.transform='none'; }
      else if(a.right > H.left-G){ r.style.left=`${H.left-c.left-G-a.width}px`; r.style.transform='none'; }
    }
  }
  addEventListener('resize', ()=>fitRanges(document.getElementById('pKpis')));
  // Normal height / painted height for a hill at blend e (1 in Normal): the shader scales the shape back to Normal's colour
  function setEvRatio(t,e){ const h=t.evidenceHeight+(t.perfHeight-t.evidenceHeight)*e; t.evRatio = h>1e-6 ? t.evidenceHeight/h : 1; }
  const evidenceLine = t => { const c=peakCounts(peakKey(t)); return !c || !c.docs ? 'no evidence yet' : `${c.docs} ${c.docs===1?'document':'documents'} · ${c.ex} excerpts`; };
  function showPerfTip(t){
    const p = t && perfMode && step==='landscape' ? t.perf : null;
    if(!p){ perfTip.hidden=true; return; }
    const esc=x=>String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const size = !t.isSubTheme && t.sizeLabel ? ` · ${esc(t.sizeLabel)}` : '';
    perfTip.innerHTML=`<b>${esc(t.name)}</b><br><span style="font-size:15px;font-weight:600">${p.r.toFixed(1)}%</span> a year${size}<br>`+
      `${esc(evidenceLine(t))}`;
    perfTip.hidden=false; placeTip();
  }
  spreadEl.addEventListener("input",()=>{                 // footprint change: repaint, once per frame
    spreadMul=spreadEl.value/100; $("spreadVal").textContent=spreadMul.toFixed(1)+"×";
    if(repaintQueued) return;
    repaintQueued=true;
    requestAnimationFrame(()=>{ repaintQueued=false; repaintTerrain(); rebuildArcs(); });
  });

  // ---------- resize ----------
  function resize(){
    const dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(canvas.clientWidth*dpr); canvas.height=Math.round(canvas.clientHeight*dpr);
  }
  window.addEventListener("resize",resize);

  // ---------- render loop: one pass per visible pane, scissored to its rectangle ----------

  // ---------- first load: loader, contours drawing on, terrain filling in, camera settling ----------
  // Before the data arrives the bar creeps towards 30%. Once it is in, the contours draw on over LINES
  // (the bar runs to 100%) while the camera orbits; then the solid fills in over FILL while the camera
  // eases out (exponentially, over SETTLE) onto the default bearing. The start bearing is chosen so the
  // orbit ends exactly there. Touching the camera hands it back to the viewer.
  const INTRO={LINES:2000, FILL:2000, SETTLE:3200, SPIN:0.5};           // ms, ms, ms, rad/s
  const intro={on:!reduceMotion, start:performance.now(), t0:null, p0:0, p:0, text:"", camera:true, theta0:0};
  const loaderEl=document.getElementById("loader"), loaderText=document.getElementById("loaderText"),
        loaderFill=document.getElementById("loaderFill");
  const LOAD_STEPS=[[0,"Loading industries"],[0.3,"Building terrain"],[0.5,"Drawing contours"],[0.75,"Mapping landscape"]];
  const settleDist=INTRO.SPIN*INTRO.SETTLE/1000/(10*Math.LN2);          // an expo ease-out leaves at the orbit's speed
  function setLoader(p){
    intro.p=p;
    loaderFill.style.transform=`scaleX(${p.toFixed(3)})`;
    const text=LOAD_STEPS.filter(st=>p>=st[0]).pop()[1];
    if(text!==intro.text){
      intro.text=text; loaderText.textContent=text;
      loaderText.classList.remove("swap"); void loaderText.offsetWidth; loaderText.classList.add("swap");
    }
  }
  (function whileFetching(){
    if(intro.t0!==null) return;
    // nothing is drawn until the data is in, and an undrawn canvas is black: show the floor colour instead
    gl.viewport(0,0,canvas.width,canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
    setLoader(0.3*(1-Math.exp(-(performance.now()-intro.start)/900)));
    requestAnimationFrame(whileFetching);
  })();
  setTimeout(()=>app.classList.remove("booting"), 2100);
  /** The terrain as it rests: full height, no blend in flight. Ends the intro early if something else needs the map. */
  function endIntro(){
    if(!introFlat) return;
    introFlat=false; intro.on=false; intro.camera=false;
    field.fill(0); fieldBytes.fill(0); uploadField();
    repaintTerrain();
    loaderEl.classList.add("done"); app.classList.remove("intro");
  }
  /** Advance the intro and return the shader's {intro, lines}. */
  function introFrame(now){
    if(!intro.on){
      if(intro.t0===null){ intro.t0=now; loaderEl.classList.add("done"); app.classList.remove("intro"); }
      return {intro:0, lines:1};
    }
    const c=paneA.cam;
    if(intro.t0===null){
      intro.t0=now; intro.p0=intro.p;
      intro.theta0=DEFAULT_THETA-(INTRO.SPIN*INTRO.LINES/1000+settleDist);
      c.theta=intro.theta0; c.thetaTarget=null;
      // the terrain starts flat (base) and grows into the full terrain (shrunk), exactly as a filter blends
      introFlat=true; flattenBase();
      field.fill(0); fieldBytes.fill(0); uploadField(); updatePeaks();
    }
    const t=now-intro.t0, L=INTRO.LINES, F=INTRO.FILL, S=INTRO.SETTLE;
    const lines=Math.min(1,t/L), f=Math.min(1,Math.max(0,(t-L)/F));
    setLoader(intro.p0+(1-intro.p0)*lines);
    if(t>=L) loaderEl.classList.add("done");
    if(introFlat && t>=L){
      // each column eases up (out-cubic, like a filter's resize), the right edge starting STAGGER later than the left
      const STAGGER=0.4;
      for(let i=0;i<FIELD_N;i++){
        const u=Math.min(1,Math.max(0,(f-STAGGER*i/(FIELD_N-1))/(1-STAGGER)));
        field[i]=1-Math.pow(1-u,3); fieldBytes[i]=Math.round(field[i]*255);
      }
      uploadField(); updatePeaks();
      for(const p of panes) for(const Lb of p.labelNodes){               // a label builds on once its hill is up
        if(!Lb.grown && fieldAt(Lb.t.x)>=0.99){ Lb.grown=true; Lb.el.classList.add("grown"); }
      }
    }
    if(intro.camera && (c.thetaTarget!==null || spin)) intro.camera=false;  // the viewer took over
    if(intro.camera){
      const st=Math.min(1,Math.max(0,(t-L)/S));
      c.theta = t<L ? intro.theta0+INTRO.SPIN*t/1000
              : st<1 ? intro.theta0+INTRO.SPIN*L/1000+settleDist*(1-Math.pow(2,-10*st))
              : DEFAULT_THETA;
    }
    if(t>=L+F && introFlat){
      introFlat=false;                              // grown: rest on the ordinary terrain, nothing in flight
      field.fill(0); fieldBytes.fill(0); uploadField(); repaintTerrain();
      app.classList.remove("intro");
    }
    if(t>=L+Math.max(F,S)) intro.on=false;
    return t<L+F ? {intro:1, lines} : {intro:0, lines:1};
  }
  gl.enable(gl.DEPTH_TEST);
  let lastT=performance.now();
  function frame(){
    const now=performance.now(), dt=Math.min(0.05,(now-lastT)/1000); lastT=now;
    if(stepRoll(now) || stepField(dt)) rebuildArcs();
    stepHillMix(dt);
    if(spin && !reduceMotion) paneA.cam.theta+=0.0016;
    const introNow=introFrame(now);
    stepViewFx(now);
    panelT += ((panelOpen?1:0)-panelT)*0.12;
    layoutPanes();
    const dpr=canvas.width/Math.max(1,canvas.clientWidth), H=canvas.clientHeight;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    for(const p of visiblePanes()){
      updateCamera(p);
      const [rx,ry,rw,rh]=p.rect;
      const vx=Math.round(rx*dpr), vy=Math.round((H-ry-rh)*dpr), vw=Math.round(rw*dpr), vh=Math.round(rh*dpr);
      gl.viewport(vx,vy,vw,vh); gl.scissor(vx,vy,vw,vh);
      const flat=p.mode==="2d";
      // mid hand-over the bubbles pane draws no floor of its own: the terrain, flattening beneath, is its floor
      const handing = !!viewFx && p===paneB;
      if(!handing){
        const tf = p===paneA ? terrainFx() : {sweep:0, collapse:1, undraw:1, arcs:1};
        gl.useProgram(prog);
        gl.uniform1f(U.sweep, tf.sweep); gl.uniform1f(U.collapse, tf.collapse); gl.uniform1f(U.undraw, tf.undraw);
        gl.uniformMatrix4fv(U.projView,false,p.projView);
        gl.uniform1f(U.amp,AMP*heightMul);
        gl.uniform1f(U.noise,noiseAmp);
        gl.uniform1f(U.floorT,FLOOR_T);
        gl.uniform1f(U.flat, flat?1:0);
        const ink=LIGHT_RAMPS.has(rampName)?0:1; gl.uniform3f(U.ink,ink,ink,ink);   // contours: white on dark scales, black on light
        gl.uniform1f(U.intro,introNow.intro); gl.uniform1f(U.lines,introNow.lines);
        gl.uniform1f(U.texel,2.0/HM);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,hmTexBase);   gl.uniform1i(U.map,0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,hmTexShrunk); gl.uniform1i(U.map2,1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,fieldTex);    gl.uniform1i(U.field,2);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D,rampTex);     gl.uniform1i(U.ramp,3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D,hmTexIndustry); gl.uniform1i(U.industry,4);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D,growthTex); gl.uniform1i(U.growth,5);
        gl.uniform1f(U.growthOn, step==='landscape' ? easeHill(colourP) : 0);
        const envelope=!flat && (shrinkTarget>0 || front!==Infinity || introNow.intro>0);   // the ghost pass below runs
        gl.uniform1f(U.envelope, envelope && !introNow.intro ? 1 : 0);   // mid-intro the growing terrain keeps its own contours
        gl.uniform1f(U.ghost,0);
        gl.bindVertexArray(vao);
        gl.drawElements(gl.TRIANGLES,geo.count,gl.UNSIGNED_INT,0);
        if(envelope){
          // ghost wireframe of the original terrain, only where a mountain has been reduced
          gl.uniform1f(U.ghost,1);
          if(introNow.intro){
            // lay down the full terrain's depth, uncoloured, so only its front contours draw
            gl.uniform1f(U.depthOnly,1); gl.colorMask(false,false,false,false);
            gl.drawElements(gl.TRIANGLES,geo.count,gl.UNSIGNED_INT,0);
            gl.colorMask(true,true,true,true); gl.uniform1f(U.depthOnly,0); gl.depthFunc(gl.LEQUAL);
          }
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
          gl.drawElements(gl.TRIANGLES,geo.count,gl.UNSIGNED_INT,0);
          gl.depthMask(true); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.bindVertexArray(null);
        if(p.arcVerts){
          gl.useProgram(arcProg);
          gl.uniformMatrix4fv(AU.projView,false,p.projView);
          // the scale's summit colour, pulled toward the label ink so the arcs stand off the terrain
          const ink=LIGHT_RAMPS.has(rampName)?0:1, ac=sampleRamp(rampStops,0.94).map(c=>(c/255)*0.5+ink*0.5);
          gl.uniform3f(AU.color,ac[0],ac[1],ac[2]); gl.uniform3f(AU.ink,ink,ink,ink);
          gl.uniform2f(AU.px,p.rect[2],p.rect[3]); gl.uniform1f(AU.width,2.4);
          gl.uniform1f(AU.time, reduceMotion ? -1 : now/1000);
          gl.uniform1f(AU.alpha, tf.arcs);
          gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
          gl.bindVertexArray(p.arcVao); gl.drawArrays(gl.TRIANGLES,0,p.arcVerts); gl.bindVertexArray(null);
          gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
        }
      }
      if(flat) updateBubbles(p);
      updateLabels(p);
      updateRangeLabels(p);
      updateDocHub(p);
    }
    gl.disable(gl.SCISSOR_TEST);
    updateCompass();
    requestAnimationFrame(frame);
  }

  if(IN_TOOL) window.__tl={panes, paneA, paneB, get cam(){return paneA.cam;}, get themes(){return paneA.world?.items || [];},
    get selectedId(){ const s=sel && inPane(paneA,sel); return s?.item ? s.item.id : null; },
    selectTheme:id=>select(id==null ? null : paneA.world.items[id] || null), get sel(){return sel;}, worlds, select, setLevels, focusOn, setView, setSubset, get tab(){return tab;}, get subset(){return subset;}, get landscape(){return subset;}, bubbleR, get packStats(){return packStats;},
    get pack(){return brandPack;}, get panelT(){return panelT;}, set panelT(v){panelT=v;}};  // debug/automation hook
  resize(); layoutPanes(); paneA.cam.zoom=defaultZoom(paneA);
  const booted=bootstrap();
  booted.then(()=>requestAnimationFrame(frame)).catch(()=>{ intro.t0=performance.now(); loaderEl.classList.add("done"); });

  // ---------- new data from the local tool that frames this page ----------
  /**
   * The tool sends new data (a changed map setting) and posts "pathways:data". The page reads the new bundle and
   * documents and morphs the terrain from what is on screen to the new heights and places, every column at once,
   * so it shows what moved. The camera, view, levels and selection stay as they are.
   */
  let refreshSeq=0;
  async function refresh(){
    const n=++refreshSeq;
    await booted.catch(()=>{});
    const [bundle, docs]=await Promise.all(["data/bundle","data/docs"].map(u=>fetch(u,{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null)));
    if(n!==refreshSeq || !bundle || !loaded()) return;           // only the latest answer counts
    const sim = await loadSimilarity(bundle); await Promise.all([loadGrowth(), loadPresence()]);   // the optional layers too
    if(n!==refreshSeq) return;
    if(viewFx) finishViewFx();
    SIM = sim;
    readBundle(bundle);
    docsData=cleanSummaries(docs); evidenceCache.clear();
    const levels={A:paneA.world.level, B:paneB.world.level}, was=sel && {slug:sel.slug, level:sel.level};
    setHover(null);
    const change=()=>{
      worlds.themes=worlds.subthemes=null;
      paneA.world=world(levels.A); paneB.world=world(levels.B);
      buildLabels(paneA);                                     // at once: each label rides its peak through the morph
    };
    if(paneA.visible && !reduceMotion) rollTerrain(change, [], {stagger:0});
    else { if(roll) endRoll(); change(); repaintTerrain(); }
    showWorld(paneB, paneB.world);
    buildRangeLabels();
    renderIndustryLegend();
    if(was) select(world(was.level).bySlug.get(was.slug) || null, {frame:false});
    else renderSelection();
  }
  if(IN_TOOL) addEventListener("message", e=>{ if(e.origin===location.origin && e.source===parent && e.data==="pathways:data") refresh(); });
})();
