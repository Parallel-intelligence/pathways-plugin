/* The landscape explainer on the map: a button in the bottom left, a first-visit prompt, and a pop-up.
 * The pop-up lists the sections from explainer.json (Landscape and Your data now; Brand, Uniqueness and Your
 * projects locked) and plays each Landscape step in the scene player (/explainer-scenes), drawn with the map's
 * own renderer. How we use your data shows the privacy notice and the services we use, scrolling in the panel, in
 * every version (portal, tool, plugin). The portal's public /privacy and /subprocessors pages are built from the
 * same text in explainer.json. Text only: everything is set with textContent.
 * The map page needs <script src="explainer.js" defer></script> and its styles, <link rel="stylesheet" href="explainer.css">
 * (a file, not injected, so a strict content security policy needs no 'unsafe-inline').
 * Progress is remembered in this browser only. */
(() => {
  "use strict";
  const KEY="explainer-v1";
  const load=()=>{ try{ return JSON.parse(localStorage.getItem(KEY))||{}; }catch(e){ return {}; } };
  const save=(s)=>{ try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} };
  let state=load();
  state.visited=Array.isArray(state.visited)?state.visited:[];

  // Lucide icons, inline
  const ICON={
    help:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
  };
  const svg=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  const el=(tag,cls,text)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; };

  fetch("data/explainer").then(r=>r.ok?r.json():Promise.reject(r.status)).then(build).catch(e=>console.warn("explainer: no content",e));

  function build(C){
    const app=document.getElementById("app")||document.body;
    const sections=C.sections||[];
    const live=sections.find(s=>s.status==="available" && Array.isArray(s.steps));
    if(!live) return;

    // the way in
    const launch=el("button","xp-launch"); launch.type="button";
    launch.innerHTML=svg("help"); launch.append(el("span",null,C.button||"How it works"));
    launch.setAttribute("aria-haspopup","dialog");
    app.appendChild(launch);

    // the first-visit prompt
    const prompt=el("div","xp-prompt"); prompt.setAttribute("role","status");
    const P=C.prompt||{};
    prompt.append(el("b",null,P.title||"New here?"), el("p",null,P.body||""));
    const row=el("div","row"), go=el("button","xp-btn primary",P.start||"Show me"), later=el("button","xp-btn",P.dismiss||"Not now");
    go.type=later.type="button"; row.append(go,later); prompt.appendChild(row);
    app.appendChild(prompt);
    const hidePrompt=()=>{ prompt.classList.remove("on"); state.dismissed=true; save(state); };
    go.addEventListener("click",()=>{ hidePrompt(); open(); });
    later.addEventListener("click",hidePrompt);

    // the pop-up
    const xp=el("div","xp"); xp.hidden=true;
    const dialog=el("div","xp-dialog"); dialog.setAttribute("role","dialog"); dialog.setAttribute("aria-modal","true"); dialog.setAttribute("aria-label",C.button||"How it works");
    const rail=el("nav","xp-rail"); rail.setAttribute("aria-label","Sections");
    const head=el("div","xp-head"), h2=el("h2",null,C.button||"How it works"), close=el("button","xp-close"); close.type="button";
    close.innerHTML=svg("x"); close.setAttribute("aria-label","Close");
    head.append(h2,close); rail.appendChild(head);
    const stage=el("div","xp-stage"), locked=el("div","xp-locked"), info=el("div","xp-info"); locked.hidden=true; info.hidden=true;
    info.tabIndex=0; info.setAttribute("role","region");   // focusable, so the keyboard can scroll it
    let frame=null;

    const secButtons=[], stepButtons=[];
    let currentSection=live.id, currentStep=Math.min(Number(state.last)||0, live.steps.length-1);
    for(const s of sections){
      const wrap=el("div");
      const b=el("button","xp-sec"); b.type="button";
      b.append(el("span",null,s.title));
      if(s.status!=="available"){
        b.classList.add("locked");
        const soon=el("span","soon"); soon.innerHTML=svg("lock"); soon.append(s.lockedNote||"Later"); b.appendChild(soon);
        b.setAttribute("aria-label",`${s.title}, ${s.lockedNote||"later"}`);
      }
      b.addEventListener("click",()=>showSection(s));
      secButtons.push([s,b]); wrap.appendChild(b);
      if(s===live){
        const ol=el("ol","xp-steps");
        s.steps.forEach((st,i)=>{
          const li=el("li"), sb=el("button","xp-step"); sb.type="button";
          const n=el("span","n",String(i+1)); sb.append(n, el("span",null,st.title));
          sb.addEventListener("click",()=>{ showSection(live); playStep(i); });
          stepButtons.push([sb,n,i]); li.appendChild(sb); ol.appendChild(li);
        });
        wrap.appendChild(ol);
      }
      rail.appendChild(wrap);
    }
    stage.append(locked, info);
    dialog.append(rail,stage); xp.appendChild(dialog); document.body.appendChild(xp);

    function renderRail(){
      for(const [s,b] of secButtons) b.setAttribute("aria-current", s.id===currentSection?"true":"false");
      for(const [sb,n,i] of stepButtons){
        const on=currentSection===live.id && i===currentStep, seen=state.visited.includes(i);
        sb.setAttribute("aria-current", on?"true":"false");
        sb.classList.toggle("seen", seen);
        if(seen && !on) n.innerHTML=svg("check"); else n.textContent=String(i+1);
      }
    }
    function ensureFrame(){
      if(frame) return;
      frame=el("iframe"); frame.title="How the landscape works";
      frame.src=`explainer-scenes?embed=1&scene=${currentStep+1}&light=${isLight()?1:0}`;
      stage.insertBefore(frame, locked);
    }
    // An info section (How we use your data): its parts, each a run of headings, paragraphs, lists and a table.
    // A paragraph with "withContact" uses that wording, with the address as a mail link, once "contact" is set.
    function infoDoc(s){
      const doc=el("div","xp-doc");
      const contact=typeof s.contact==="string" && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.contact) ? s.contact : null;
      doc.append(el("h3",null,s.title));
      if(s.updated) doc.append(el("p","xp-updated",`Updated ${s.updated}`));
      for(const part of s.parts||[]){
        doc.append(el("h4",null,part.title));
        for(const b of part.blocks||[]){
          if(typeof b.h==="string") doc.append(el("h5",null,b.h));
          else if(typeof b.p==="string"){
            const p=el("p"), text=contact && typeof b.withContact==="string" ? b.withContact : b.p;
            (contact ? text.split("{contact}") : [text]).forEach((bit,i)=>{
              if(i){ const a=el("a",null,contact); a.href=`mailto:${contact}`; p.append(a); }
              p.append(bit);
            });
            doc.append(p);
          }
          else if(Array.isArray(b.ul)){
            const ul=el("ul");
            for(const it of b.ul){
              const li=el("li");
              if(Array.isArray(it)) li.append(el("strong",null,String(it[0])), String(it[1]??""));
              else li.textContent=String(it);
              ul.append(li);
            }
            doc.append(ul);
          }
          else if(b.table && Array.isArray(b.table.rows)){
            const head=b.table.head||[];
            for(const row of b.table.rows){          // a card per row: the name, then the other columns as label and text
              const card=el("div","xp-card"), dl=el("dl");
              card.append(el("h5",null,String(row[0])));
              row.slice(1).forEach((v,i)=>dl.append(el("dt",null,String(head[i+1]??"")), el("dd",null,String(v))));
              card.append(dl); doc.append(card);
            }
          }
        }
      }
      return doc;
    }
    function showSection(s){
      currentSection=s.id;
      info.hidden=true;
      if(s.kind==="info"){
        locked.hidden=true; if(frame) frame.hidden=true;
        info.setAttribute("aria-label", s.title);
        info.replaceChildren(infoDoc(s)); info.hidden=false; info.scrollTop=0;
      }
      else if(s.status==="available"){ locked.hidden=true; ensureFrame(); frame.hidden=false; }
      else{
        if(frame) frame.hidden=true;
        locked.replaceChildren();
        const ic=el("div"); ic.innerHTML=svg("lock");
        locked.append(ic, el("b",null,s.title), el("span",null,s.lockedNote||"Later"));
        locked.hidden=false;
      }
      renderRail();
    }
    function playStep(i){
      currentStep=i;
      frame?.contentWindow?.postMessage({type:"explainer:play", index:i}, location.origin);
      renderRail();
    }
    // the scene player reports each step it starts, including its own prev / next
    addEventListener("message",e=>{
      if(e.origin!==location.origin || !e.data || e.data.type!=="explainer:scene" || e.source!==frame?.contentWindow) return;
      currentStep=e.data.index;
      if(!state.visited.includes(currentStep)) state.visited.push(currentStep);
      state.last=currentStep; save(state);
      renderRail();
    });

    // the scenes follow the map's theme: the map flags its light scale on <html data-light>
    const isLight=()=>document.documentElement.hasAttribute("data-light");
    new MutationObserver(()=>frame?.contentWindow?.postMessage({type:"explainer:theme", light:isLight()}, location.origin))
      .observe(document.documentElement,{attributes:true,attributeFilter:["data-light"]});
    let lastFocus=null;
    function open(){
      prompt.classList.remove("on");
      lastFocus=prompt.contains(document.activeElement) ? launch : document.activeElement;   // the prompt is gone once the pop-up opens
      xp.hidden=false; requestAnimationFrame(()=>xp.classList.add("on"));
      showSection(live);
      close.focus();
    }
    function shut(){
      xp.classList.remove("on");
      setTimeout(()=>{ xp.hidden=true; }, 250);
      (lastFocus && lastFocus!==document.body && lastFocus.isConnected ? lastFocus : launch).focus();
    }
    launch.addEventListener("click",open);
    close.addEventListener("click",shut);
    xp.addEventListener("click",e=>{ if(e.target===xp) shut(); });
    // over the pop-up the wheel scrolls the list, not the map behind it
    xp.addEventListener("wheel",e=>e.stopPropagation());
    // keys: Esc closes the pop-up before anything else on the page sees it; arrows step; ? opens
    document.addEventListener("keydown",e=>{
      if(!xp.hidden){
        if(e.key==="Escape"){ e.stopPropagation(); e.preventDefault(); shut(); }
        else if((e.key==="ArrowRight"||e.key==="ArrowLeft") && currentSection===live.id){
          e.preventDefault(); frame?.contentWindow?.postMessage({type:"explainer:key", key:e.key}, location.origin);
        }
        else if(e.key==="Tab"){                                   // keep focus inside the pop-up
          const f=[...dialog.querySelectorAll("button,iframe,a[href],.xp-info")].filter(n=>!n.hidden && n.offsetParent!==null);
          if(!f.length) return;
          const first=f[0], last=f[f.length-1];
          if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
          else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
        }
      } else if(e.key==="?" && !e.target.closest?.("input,textarea,select")){ open(); }
    }, true);

    // first visit: once the map has finished drawing itself in, offer the explainer (once, until dismissed or used),
    // but not to someone who has just been through the welcome page's walkthrough or chose to skip it
    // (welcome/welcome.js keeps "guided" or "skipped" for the session)
    const skipped=(()=>{ try{ return ["guided","skipped"].includes(sessionStorage.getItem("pathways-welcome")); }catch(e){ return false; } })();
    if(!state.dismissed && !state.visited.length && !skipped){
      const ready=()=>!app.classList.contains("intro") && !app.classList.contains("booting");
      const offer=()=>setTimeout(()=>{ if(xp.hidden) prompt.classList.add("on"); }, 900);
      if(ready()) offer();
      else{ const mo=new MutationObserver(()=>{ if(ready()){ mo.disconnect(); offer(); } }); mo.observe(app,{attributes:true,attributeFilter:["class"]}); }
    }
  }
})();
