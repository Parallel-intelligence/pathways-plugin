(() => {
  "use strict";
  const canvas=document.getElementById("gl");
  const gl=canvas.getContext("webgl2",{antialias:true,alpha:false});
  if(!gl){ document.getElementById("line").textContent="This needs WebGL2."; return; }
  const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- the map's constants ----------
  const SPAN=10, HALF=5, FLOOR=600, AMP=2.6, HM=512, SEG=400, R=12, P=4;   // heightmap texels and plane segments a side: fine enough to stay smooth when the terrain grows (WORLD)
  const GOANDCO=["#003830","#055257","#0b6d80","#2c8581","#3f9e7e","#4cb87b","#7ad07d","#a6e780","#cef585","#f2f48e"];
  // the first step's data (flowInto, below): a time axis of `w` texels `dt` seconds apart, one row per hill; packets
  // (a document's words) run `v` units a second along the `run` units of grid line from the document's edge to a
  // hill's centre, then up to its peak; rings run out at `ringV` and are gone by `ringMax` from the centre
  const FLOW={dt:.005, w:4096, rows:5, v:4.2, run:2, ringV:1.6, ringMax:.9};
  const glf=(n)=>Number.isInteger(n)?n+".0":String(n);

  // ---------- the map's shader, without the brand, sweep and intro passes ----------
  const VERT=`#version 300 es
  precision highp float;
  in vec2 aPos; in vec2 aUv;
  uniform mat4 uProjView; uniform sampler2D uMap; uniform float uAmp; uniform float uLift; uniform float uScale;   // uScale: WORLD
  out float vH; out vec2 vUv; out vec3 vWorld;
  void main(){
    float mask=1.0-smoothstep(4.5,5.0,max(abs(aPos.x),abs(aPos.y)));
    float h=texture(uMap,aUv).r*uAmp*mask+uLift;
    vec3 world=vec3(aPos.x*uScale,h,aPos.y*uScale);
    vH=h/uAmp; vUv=aUv; vWorld=world;
    gl_Position=uProjView*vec4(world,1.0);
  }`;
  const FRAG=`#version 300 es
  precision highp float;
  in float vH; in vec2 vUv; in vec3 vWorld;
  uniform sampler2D uMap; uniform sampler2D uRamp; uniform float uAmp; uniform float uTexel; uniform vec3 uInk; uniform vec3 uPeak; uniform float uScale;
  uniform highp sampler2D uFlow; uniform float uFlowT; uniform int uFlowN; uniform vec3 uFlowC[${FLOW.rows}];   // each hill's centre (x, z) and peak height
  uniform vec2 uFlowD[${FLOW.rows}];   // and the direction its lane runs out to its document (step 1: +z)
  uniform float uMesh; uniform float uLift;            // > 0: drawing the light mesh (its opacity), not the terrain; and how far it's lifted
  uniform float uMeshTop;                              // the mesh's rings above this height are undrawn
  uniform vec4 uPulse;                                 // a wave of light across the landscape: its centre (x, z), radius, strength (0 off)
  float pulseAt(vec2 p){ if(uPulse.w<=0.0) return 0.0; float d=(length(p-uPulse.xy)-uPulse.z)/0.7; return exp(-d*d)*uPulse.w; }
  out vec4 frag;
  const float LINE_ALPHA=0.2;
  const float FLOW_DT=${glf(FLOW.dt)}, FLOW_V=${glf(FLOW.v)}, FLOW_RUN=${glf(FLOW.run)}, RING_V=${glf(FLOW.ringV)}, RING_MAX=${glf(FLOW.ringMax)};
  float contour(float w){ return 1.0-min(abs(fract(w-0.5)-0.5)/max(fwidth(w),1e-5)*1.25,1.0); }
  // a hill's packets at time t: x = when the last one to arrive by then arrived, y = when the next one arrives, z = how
  // long the last one is, w = 1 if it was highlighted (it runs in the peaks' colour)
  vec4 flowAt(int i,float t){ return texelFetch(uFlow,ivec2(clamp(int(floor(t/FLOW_DT)),0,${FLOW.w-1}),i),0); }
  vec3 ramp(float t){ return texture(uRamp,vec2(clamp(t,0.0,1.0),0.5)).rgb; }
  void main(){
    if(uMesh>0.0){                                     // the light mesh: the terrain's own contour rings (24 a unit), with no surface
      float y=vWorld.y-uLift, foot=smoothstep(0.02,0.12,y)*(1.0-smoothstep(uMeshTop-0.05,uMeshTop,y));   // under them, fading
      if(foot<=0.0) discard;                                                                           // out at its foot and top
      float pw=pulseAt(vWorld.xz);                     // the wave brightens the rings it passes, in the peaks' colour
      frag=vec4(mix(uInk,uPeak,pw),(contour(y*24.0)*0.42+0.02)*foot*uMesh*(1.0+pw*1.4)); return;
    }
    vec3 col=ramp(clamp(vH,0.0,1.0));
    float tx=uTexel;
    float hl=texture(uMap,vUv-vec2(tx,0.0)).r, hr=texture(uMap,vUv+vec2(tx,0.0)).r;
    float hd=texture(uMap,vUv-vec2(0.0,tx)).r, hu=texture(uMap,vUv+vec2(0.0,tx)).r;
    vec3 n=normalize(vec3((hl-hr)*uAmp,tx*6.0*uScale,(hd-hu)*uAmp));   // (a texel spans uScale times more ground)
    vec3 sun=normalize(vec3(-0.6,0.9,0.5));
    float shade=clamp(dot(n,sun)*0.5+0.5,0.0,1.0);
    col*=1.0+(shade-(sun.y*0.5+0.5))*0.2;
    float w=vWorld.y*24.0;
    col=mix(col,uInk,contour(w)*smoothstep(0.0,0.08,vWorld.y)*LINE_ALPHA);
    vec2 fw=max(fwidth(vWorld.xz),vec2(1e-5));
    vec2 g=abs(fract(vWorld.xz-0.5)-0.5)/fw;
    float grid=1.0-min(min(g.x,g.y),1.0);
    float onFloor=1.0-smoothstep(0.0,0.12,vWorld.y);
    float gridFade=1.0-smoothstep(0.25,0.6,max(fw.x,fw.y));
    col=mix(col,ramp(0.24),grid*0.30*onFloor*gridFade);
    // the first step's data, on the surface: packets running along the grid line into each hill's centre, and a ring
    // running out over the hill for each one that has arrived
    if(uFlowN>0){
      vec2 ddx=dFdx(vWorld.xz), ddy=dFdy(vWorld.xz);
      float lit=0.0, hot=0.0;
      for(int i=0;i<${FLOW.rows};i++){
        if(i>=uFlowN) break;
        vec2 p=vWorld.xz-uFlowC[i].xy, dl=uFlowD[i], dp=vec2(dl.y,-dl.x);
        float along=dot(p,dl), side=dot(p,dp), px=abs(side)/max(abs(dot(ddx,dp))+abs(dot(ddy,dp)),1e-5);
        if(px<1.5 && along>0.0 && along<FLOW_RUN){        // from the document's edge, then up the hill to its peak: what's here
          float T=uFlowT+(along+max(uFlowC[i].z-vWorld.y,0.0))/FLOW_V;   // now arrives that far on (the climb counts, so packets keep their length up the slope)
          vec4 f=flowAt(i,T);
          float on=step(0.0,T-f.x)*step(T-f.x,f.z);
          float v=on*(1.0-smoothstep(0.4,1.5,px));
          if(f.w>0.5) hot=max(hot,v*0.95); else lit=max(lit,v*0.85);
        }
        float rho=length(p);
        if(rho<RING_MAX){                                  // a ring here left the centre rho/RING_V seconds ago
          vec2 n=p/max(rho,1e-4);
          float fr=max(abs(dot(n,ddx))+abs(dot(n,ddy)),1e-5);
          float tau=uFlowT-rho/RING_V; vec4 f=flowAt(i,tau);
          float off=min(abs(tau-f.x), f.y<=uFlowT ? abs(f.y-tau) : 1e3)*RING_V/fr;
          float ring=1.0-min(off*1.25,1.0);
          lit=max(lit,ring*(1.0-smoothstep(0.4,RING_MAX,rho))*mix(0.3,1.0,smoothstep(0.0,0.12,vWorld.y))*0.6);
        }
      }
      col=mix(col,uInk,lit);
      col=mix(col,uPeak,hot);
    }
    {
      float pw=pulseAt(vWorld.xz);                     // the wave, over the ground and the hills alike
      col=mix(col,uPeak,pw*mix(0.3,0.6,smoothstep(0.0,0.1,vWorld.y)));
    }
    frag=vec4(col,1.0);
  }`;
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog=gl.createProgram();
  gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));
  gl.bindAttribLocation(prog,0,"aPos"); gl.bindAttribLocation(prog,1,"aUv"); gl.linkProgram(prog);
  const U={}; for(const n of ["uProjView","uMap","uRamp","uAmp","uTexel","uInk","uFlow","uFlowT","uFlowN","uFlowC","uFlowD","uPeak","uMesh","uLift","uMeshTop","uScale","uPulse"]) U[n]=gl.getUniformLocation(prog,n);

  // the plane: a fine grid over the terrain plus a ring out to the far floor
  const xs=[-FLOOR]; for(let i=0;i<=SEG;i++) xs.push((i/SEG-0.5)*SPAN); xs.push(FLOOR);
  const N=xs.length, pos=new Float32Array(N*N*2), uv=new Float32Array(N*N*2);
  for(let j=0,p=0;j<N;j++) for(let i=0;i<N;i++,p+=2){ pos[p]=xs[i]; pos[p+1]=xs[j]; uv[p]=(xs[i]+HALF)/SPAN; uv[p+1]=(xs[j]+HALF)/SPAN; }
  const idx=new Uint32Array((N-1)*(N-1)*6);
  for(let j=0,k=0;j<N-1;j++) for(let i=0;i<N-1;i++){ const a=j*N+i,b=a+1,c=a+N,d=c+1; idx.set([a,c,b,b,c,d],k); k+=6; }
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf=(data,loc)=>{ const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0); };
  buf(pos,0); buf(uv,1);
  const ib=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const tex=(w,h)=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
    return t; };
  // the map's two themes: goandco (dark, the default) and lagoon (light). Both floors sit at the ramp's first stop.
  const LAGOON=["#fdfde8","#ffffdb","#d6f79b","#acf84b","#6cec60","#38e17c","#00b998","#008f9a","#006187","#002f61"];
  const rampTex=tex();
  let INK="#fff", INK_GL=1, FLOOR_RGB=[0,56,48], PEAK="#cef585", PEAK_GL=[0.81,0.96,0.52];
  function setTheme(light){
    const stops=(light?LAGOON:GOANDCO).map(h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)));
    const W=256, d=new Uint8Array(W*4);
    for(let i=0;i<W;i++){ const f=i/(W-1)*(stops.length-1), a=Math.floor(f), b=Math.min(a+1,stops.length-1), u=f-a;
      for(let c=0;c<3;c++) d[i*4+c]=Math.round(stops[a][c]*(1-u)+stops[b][c]*u); d[i*4+3]=255; }
    gl.bindTexture(gl.TEXTURE_2D,rampTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,W,1,0,gl.RGBA,gl.UNSIGNED_BYTE,d);
    FLOOR_RGB=stops[0]; INK=light?"#000":"#fff"; INK_GL=light?0:1;
    const pk=d.subarray(Math.round(.9*(W-1))*4).slice(0,3);   // near the top of the peaks: the highlight in the first step
    PEAK=`rgb(${pk.join(",")})`; PEAK_GL=[...pk].map(c=>c/255);
    const root=document.documentElement;
    root.style.setProperty("--ground",`rgb(${FLOOR_RGB})`);
    root.style.setProperty("--accent",INK);
    root.style.setProperty("--peak",PEAK);
    root.style.setProperty("--on-accent",light?"#fff":"#000");
    root.toggleAttribute("data-light",light);
  }
  // the theme: what the map says (the pop-up tells us), else the map's remembered scale in this browser
  const LIGHT_RAMPS=new Set(["ember","orchid","lemon","dusk","lagoon"]);
  const qs=new URLSearchParams(location.search);
  // (the welcome page's walkthrough asks for the dark scale, so it opens on the same ground as the welcome page)
  const askedLight=typeof window.PathwaysScenesLight==="boolean" ? window.PathwaysScenesLight : null;
  setTheme(qs.has("light") ? qs.get("light")==="1" : askedLight!==null ? askedLight : (()=>{ try{ return LIGHT_RAMPS.has(localStorage.getItem("ramp-default")); }catch(e){ return false; } })());
  const mapTex=tex(), hm=new Float32Array(HM*HM), meshTex=tex(), mhm=new Float32Array(HM*HM);

  // ---------- hills: made-up peaks, painted the map's way (super-gaussian, soft max so neighbours merge) ----------
  // meshes: hills drawn only as a light mesh over the terrain (an industry around its markets), at MESH.a opacity
  let hills=[], meshes=[];
  const MESH={a:0, top:99};                                // its opacity, and the height its rings are drawn up to
  const PULSE={x:0, z:0, r:0, a:0};                        // a wave of light running out across the landscape (the shader's uPulse)
  // the terrain covers SPAN*WORLD units a side. WORLD is 1 except while a scene lets it follow the camera (growing): then
  // the terrain is wide enough to reach the edges of the screen however the camera turns (worldAt), with the same
  // detail on screen throughout (HM and SEG are fine enough for it)
  let WORLD=1, growing=false; const worldAt=(zoom)=>Math.max(1,2.5/zoom);
  const hill=(o)=>{ const h={x:0,z:0,h:0,s:0.4,...o}; hills.push(h); return h; };
  const meshHill=(o)=>{ const h={x:0,z:0,h:0,s:0.4,...o}; meshes.push(h); return h; };
  function paint(){ paintInto(hills,hm,mapTex); if(meshes.length) paintInto(meshes,mhm,meshTex); }
  function paintInto(list, hm, texture){
    hm.fill(0);
    const k=HM/(SPAN*WORLD), half=HALF*WORLD;
    for(const t of list){
      if(t.h<=0.001) continue;
      const cx=(t.x+half)*k, cy=(t.z+half)*k, sig=t.s*0.95*1.2*k, inv=1/(2*sig*sig), Rr=Math.ceil(sig*2.6);
      const x0=Math.max(0,Math.floor(cx-Rr)), x1=Math.min(HM-1,Math.ceil(cx+Rr)), y0=Math.max(0,Math.floor(cy-Rr)), y1=Math.min(HM-1,Math.ceil(cy+Rr));
      for(let y=y0;y<=y1;y++){ const dy=y-cy, row=y*HM;
        for(let x=x0;x<=x1;x++){ const dx=x-cx, u=(dx*dx+dy*dy)*inv, g=t.h*Math.exp(-u*Math.sqrt(u)); hm[row+x]+=g*g*g*g; } }
    }
    const F=12;   // (the soft max's root: P is 4, so two square roots, and only where a hill reaches)
    for(let y=0;y<HM;y++) for(let x=0;x<HM;x++){ const i=y*HM+x, v=hm[i]; hm[i]=(x<F||y<F||x>=HM-F||y>=HM-F||v<=0)?0:Math.sqrt(Math.sqrt(v)); }
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,HM,HM,0,gl.RED,gl.FLOAT,hm);
  }
  const heightAt=(x,z)=>{ const w=SPAN*WORLD, i=Math.round((z+HALF*WORLD)/w*HM)*HM+Math.round((x+HALF*WORLD)/w*HM); return (hm[i]||0)*AMP; };
  const CONTOURS=24;                                       // contour lines per unit of height: the shader's 24.0
  const levelH=(n)=>n>0?(n+.5)/(CONTOURS*AMP):0;          // a hill's h when it has n contour lines (the top one a small ring)

  // ---------- the first step's data: each hill has a document (a grid square of made-up text lines) that empties into
  // it a line at a time. The top line sits on the hill's grid line and slides out across the page's edge; its words run
  // on into the hill's centre as packets, and each one that arrives sends a ring out over the hill and lifts it by one
  // contour line, until the hill has as many lines as its full height needs. The shader draws the packets and rings
  // from one small texture: per hill, along a time axis, the last packet to have arrived (when, and how long it is)
  // and when the next one arrives. The pages are drawn in the overlay (docLines). ----------
  const RISE=.18, FEED=.06, SP=.075, MARGIN=.95;          // one lift and the shortest pause between lines (seconds); line spacing; where lines start, from the page's right edge (the text spans 90% of its grid square)
  const flowTex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,flowTex);
  for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,new Float32Array(4));
  let flow=null;
  const easeOut=u=>1-Math.pow(1-u,3);
  const liftAt=(ps,t)=>{ let h=0;                          // what a row's packets have lifted its hill by at time t: each its own lift
    for(const [k,p] of ps.entries()){ const u=(t-p.a)/RISE; if(u<=0) continue; h+=(p.dh??(levelH(k+1)-levelH(k)))*easeOut(Math.min(1,u)); }   // (dh), or one contour line, eased in over RISE
    return h; };
  // made-up pages: lines of word-shaped dashes, ragged on the right, with exactly as many words as the hill has lines
  function pages(counts, hot=.22){
    let seed=11, pick=5; const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;   // the same pages every time round
    const lucky=()=>(pick=(pick*16807)%2147483647)/2147483647<hot;          // about one word in five is highlighted (hot)
    return counts.map(n=>{ const lines=[]; let left=n;
      while(left>0){ const end=.05+rnd()*.15, words=[]; let u=MARGIN;   // ragged right, the longest lines ending 5% from the edge
        while(left>0){ const len=.03+rnd()*.12; if(u-len<end && words.length) break; words.push({lo:Math.max(u-len,.05),hi:u,hl:lucky()}); u-=len+.035; left--; }
        lines.push({words}); }
      return lines; });
  }
  // when each line moves and each word arrives: a document's lines go one after another from `start`; a word reaches
  // the page's edge after its distance over v, then crosses the lane and climbs the hill (as tall as it is by then).
  // The hills finish together: the fullest document pauses FEED between lines, and the others pause longer (d.feed),
  // so their last word lands at the same moment.
  function schedule(docs, start){
    const v=FLOW.v, first=(i)=>start+i*.08;
    const endAt=(d,i,f)=>first(i)+(d.lines.length-1)*(MARGIN/v+f)                     // the last line moves, then its last word
      +Math.max(...d.lines[d.lines.length-1].words.map(w=>w.lo))/v+(FLOW.run+levelH(d.n)*AMP)/v;   // leaves and climbs the full hill
    const end=Math.max(...docs.map((d,i)=>endAt(d,i,FEED)));
    return docs.map((d,i)=>{ let s=first(i); const ps=[];
      d.feed=d.lines.length>1 ? Math.max(FEED,(end-endAt(d,i,0))/(d.lines.length-1)) : FEED;
      for(const L of d.lines){
        L.s=s; L.e=s+MARGIN/v;
        for(const w of [...L.words].sort((a,b)=>a.lo-b.lo)){   // the word nearest the edge goes first
          const te=s+w.lo/v;
          ps.push({a:te+(FLOW.run+liftAt(ps,te)*AMP)/v, dur:(w.hi-w.lo)/v, hl:w.hl});
        }
        s=L.e+d.feed;
      }
      return ps; });
  }
  // made-up pages of excerpts: n lines a page, each a few word-shaped dashes, ragged on the right (Controlling impact)
  function excerptPages(counts, hot=.45, seed=29, pick=7){ const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    const lucky=()=>(pick=(pick*16807)%2147483647)/2147483647<hot;
    return counts.map(n=>Array.from({length:n},()=>{ const end=.05+rnd()*.25, words=[]; let u=MARGIN;
      for(;;){ const len=.05+rnd()*.14; if(u-len<end && words.length) break; words.push({lo:Math.max(u-len,.05),hi:u,hl:lucky()}); u-=len+.035; }
      return {words}; }));
  }
  // several sources' pages as one stack, `gap` blank lines between each, so they read as separate documents (each
  // line knows its source, src, and its place in it, k)
  const stacked=(pages, gap)=>pages.flatMap((pg,i)=>[...Array(i?gap:0)].map(()=>({words:[]})).concat(pg.map((L,k)=>({...L,k,src:i}))));
  // one hill fed by several documents (Controlling impact), each in its own row: each line is an excerpt, and a document's
  // lines start one after another from d.start, d.every seconds apart (closer than a line takes to leave, they stream
  // out together); the scene sets when each line appears (L.b). Its first excerpt
  // lifts the hill by d.d0 and each one after it by d.r times the one before (diminishing), shared between its words.
  // A page can carry several sources (stacked()): a line's L.k counts from its own source's first, and its gap lines
  // carry nothing. The hill starts at base.
  function feedOne(docs, base){
    const v=FLOW.v, out=docs.map(()=>[]), lifted=(t)=>out.reduce((a,ps)=>a+liftAt(ps,t),0);
    docs.forEach((d,i)=>{ let s=d.start; const d0=d.d0, r=d.r; d.feed=d.every;   // (feed: how fast the lines left shift up)
      d.lines.forEach((L,k)=>{
        L.s=s; L.e=s+MARGIN/v;
        const dh=d0*Math.pow(r,L.k??k)/Math.max(1,L.words.length);
        for(const w of [...L.words].sort((a,b)=>a.lo-b.lo)){ const te=s+w.lo/v;
          out[i].push({a:te+(FLOW.run+(base+lifted(te))*AMP)/v, dur:(w.hi-w.lo)/v, hl:w.hl, dh}); }
        s=L.s+d.every;
      });
    });
    return out;
  }
  function flowInto(H, packets, base=0, dirs=null){        // returns when the last packet arrives, in seconds from now
    const d=new Float32Array(FLOW.w*FLOW.rows*4);
    packets=packets.map(ps=>[...ps].sort((p,q)=>p.a-q.a));   // in arrival order (a fast document's lines overlap)
    packets.forEach((ps,row)=>{ let k=0;
      for(let j=0;j<FLOW.w;j++){ const end=(j+1)*FLOW.dt, o=(row*FLOW.w+j)*4;
        while(k<ps.length && ps[k].a<=end) k++;
        d[o]=k?ps[k-1].a:-1e3; d[o+1]=k<ps.length?ps[k].a:1e3; d[o+2]=k?ps[k-1].dur:0; d[o+3]=k&&ps[k-1].hl?1:0; } });
    gl.bindTexture(gl.TEXTURE_2D,flowTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,FLOW.w,FLOW.rows,0,gl.RGBA,gl.FLOAT,d);
    const last=Math.max(...packets.map(ps=>ps[ps.length-1].a));
    const D=new Float32Array(FLOW.rows*2); for(let i=0;i<FLOW.rows;i++) D.set(dirs?.[i]||[0,1],i*2);   // each row's lane (step 1: +z)
    flow={t0:performance.now(), t:0, hills:H, packets, base, dirs:D, settled:last+RISE, end:last+FLOW.ringMax/FLOW.ringV+.1, centres:new Float32Array(FLOW.rows*3)};
    return last;
  }
  function stepFlow(now){                                  // lifts each hill one contour per arrival; true while they move
    if(!flow) return false;
    flow.t=(now-flow.t0)/1000;
    if(flow.t>flow.settled+.05) return false;
    const up=new Map(); flow.hills.forEach((hl,i)=>up.set(hl,(up.get(hl)||0)+liftAt(flow.packets[i],flow.t)));   // rows feeding one hill add up
    for(const [hl,v] of up) hl.h=flow.base+v;
    return true;
  }
  // The pages, flat on the ground (drawn over the canvas: they lie in front of every hill). Each builds on after the
  // one to its left, its lines typing in. A page's top line sits on its hill's grid line and leaves across the page's
  // right edge; the moving line is brighter and the rest feed up as each one clears. From `flood`, a sweep crosses the
  // row left to right (top down: towards -z) and the highlighted words it reaches turn the peaks' colour: each pops
  // (thicker, with a glow), then beats gently until it leaves the page, and stays that colour through the lane into
  // the hill. The other words don't change. A page can be brighter (d.ink, the resting lines' opacity), light its own
  // lines' highlights at their own time (L.flood), and draw a faint outline round each document on it (d.outline: each
  // run of lines with the same L.src), the width of its grid square, which feeds up with its lines and shrinks as they
  // leave, fading in as the document appears and out as its last line goes.
  const FLOOD_S=1.2, POP=.6, BEAT=1.2;
  function docLines(docs, flood){
    return ()=>{ if(!flow) return ""; const t=flow.t; let s="", hot="";
      const at3=(off,u,d)=>{ const [dx,dz]=d.dir||[0,1], [qx,qz]=d.perp||[1,0]; return project([d.x+off*qx+u*dx,0,d.z0+off*qz+u*dz]); };   // off: across the lane
      const seg=(off,a,b,d)=>{ const p=at3(off,a,d), q=at3(off,b,d); return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`; };
      for(const d of docs){
        const up=Math.min(d.feed,.2); let feed=0; for(const L of d.lines) feed+=easeIO(Math.min(1,Math.max(0,(t-L.e)/up)));   // lines feed up over the pause (at most .2 s)
        let rest="", live="";
        if(d.outline){
          const blocks=new Map(); d.lines.forEach((L,j)=>{ if(!L.words.length) return; const k=L.src??0, B=blocks.get(k);
            if(B) B.j1=j; else blocks.set(k,{j0:j, j1:j, b:L.b}); });
          for(const B of blocks.values()){
            const end=d.lines[B.j1].e, a=Math.min(1,Math.max(0,(t-B.b)/.3))*Math.min(1,Math.max(0,(end-t)/.25));
            if(a<=0) continue;
            const pad=SP*.6, top=Math.max(B.j0-feed,0)*SP-pad, bot=(B.j1-feed)*SP+pad; if(bot<=top) continue;
            const c=[at3(top,0,d),at3(top,1,d),at3(bot,1,d),at3(bot,0,d)].map(p=>p.map(v=>v.toFixed(1)).join(",")).join(" ");
            s+=`<polygon points="${c}" fill="none" stroke="${INK}" stroke-opacity="${(.3*a).toFixed(2)}" stroke-width="1"/>`;
          }
        }
        d.lines.forEach((L,j)=>{
          if(t>=L.e) return;
          const reveal=easeOut(Math.min(1,Math.max(0,(t-L.b)/.3))); if(reveal<=0) return;
          const from=MARGIN*(1-reveal), shift=t>L.s?(t-L.s)*FLOW.v:0, x=(j-feed)*SP;
          for(const w of L.words){ const a=Math.max(w.lo-shift,0,from), b=w.hi-shift; if(b<=a) continue;
            const g=seg(x,a,b,d), at=L.flood??d.flood??flood+(5.3-(d.z0+(w.lo+w.hi)/2))*FLOOD_S/5.9;   // when the sweep reaches this word
            if(w.hl && t>=at){
              const u=Math.min(1,(t-at)/POP), pop=(1-u)*(1-u), beat=.5+.5*Math.cos((t-at)*Math.PI*2/BEAT);
              if(pop>.02) hot+=`<path d="${g}" stroke-width="${(1+6*pop).toFixed(1)}" stroke-opacity="${(.35*pop).toFixed(2)}"/>`;
              hot+=`<path d="${g}" stroke-width="${(1.5+1.5*pop).toFixed(2)}" stroke-opacity="${(.55+.45*Math.max(pop,beat)).toFixed(2)}"/>`;
            } else if(shift>0) live+=g; else rest+=g; }
        });
        const ink=d.ink??.5;
        if(rest) s+=`<path d="${rest}" fill="none" stroke="${INK}" stroke-opacity="${ink}" stroke-width="1.5"/>`;
        if(live) s+=`<path d="${live}" fill="none" stroke="${INK}" stroke-opacity="${Math.max(.85,Math.min(1,ink+.15))}" stroke-width="1.5"/>`;
      }
      if(hot) s+=`<g fill="none" stroke="${PEAK}">${hot}</g>`;
      return s; };
  }

  // ---------- the map's camera: orthographic, orbiting a centre ----------
  // where the walkthrough opens: the first step's view, top down on its documents (welcome.js lands its camera here)
  const OPENING={theta:Math.PI/2,phi:0.02,zoom:2,center:[0.5,0,2.5]};
  const cam={...OPENING,center:[...OPENING.center]}, goal={...cam,center:[...cam.center]};
  let projView=new Float32Array(16);
  function ortho(l,r,b,t,n,f){ const m=new Float32Array(16); m[0]=2/(r-l); m[5]=2/(t-b); m[10]=-2/(f-n); m[12]=-(r+l)/(r-l); m[13]=-(t+b)/(t-b); m[14]=-(f+n)/(f-n); m[15]=1; return m; }
  function lookAt(e,c,u){
    let z=[e[0]-c[0],e[1]-c[1],e[2]-c[2]], l=Math.hypot(...z); z=z.map(v=>v/l);
    let x=[u[1]*z[2]-u[2]*z[1],u[2]*z[0]-u[0]*z[2],u[0]*z[1]-u[1]*z[0]]; l=Math.hypot(...x)||1; x=x.map(v=>v/l);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    const m=new Float32Array(16); m[0]=x[0];m[4]=x[1];m[8]=x[2];m[1]=y[0];m[5]=y[1];m[9]=y[2];m[2]=z[0];m[6]=z[1];m[10]=z[2];m[15]=1;
    m[12]=-(x[0]*e[0]+x[1]*e[1]+x[2]*e[2]); m[13]=-(y[0]*e[0]+y[1]*e[1]+y[2]*e[2]); m[14]=-(z[0]*e[0]+z[1]*e[1]+z[2]*e[2]); return m; }
  function mul(a,b){ const o=new Float32Array(16); for(let c=0;c<4;c++) for(let r=0;r<4;r++) o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3]; return o; }
  function updateCamera(){
    const ease=reduceMotion?1:0.06;
    for(const k of ["theta","phi","zoom"]) cam[k]+=(goal[k]-cam[k])*ease;
    for(let i=0;i<3;i++) cam.center[i]+=(goal.center[i]-cam.center[i])*ease;
    const phi=Math.max(0.02,cam.phi), sp=Math.sin(phi), cp=Math.cos(phi), c=cam.center;
    const eye=[c[0]+R*sp*Math.sin(cam.theta),c[1]+R*cp,c[2]+R*sp*Math.cos(cam.theta)];
    const W=canvas.clientWidth, H=canvas.clientHeight, aspect=W/Math.max(1,H), s=6.2/cam.zoom;
    projView=mul(ortho(-s*aspect,s*aspect,-s,s,-900,1800), lookAt(eye,c,[0,1,0]));
  }
  function project(v){
    const m=projView, x=m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], y=m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], w=m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15];
    return [(x/w*0.5+0.5)*canvas.clientWidth, (1-(y/w*0.5+0.5))*canvas.clientHeight];
  }
  const screenRight=()=>[Math.cos(goal.theta),0,-Math.sin(goal.theta)];   // the ground direction that runs left → right on screen
  // the camera's slow turn round its centre, as the map's Spin does (rad/s; 0 still). A scene eases it in; play() stops it
  const SPIN={rate:0};

  // ---------- overlays that follow the terrain ----------
  const fx=document.getElementById("fx"), marks=document.getElementById("marks");
  let tracked=[], drawers=[];
  const el=(cls,html)=>{ const e=document.createElement("div"); e.className=cls; if(html!=null) e.innerHTML=html; fx.appendChild(e); return e; };
  const top=(t)=>[t.x, heightAt(t.x,t.z), t.z];
  // A label stands on a line down to the top of what it names: a hill, or a world point (at, a function) with the
  // hill-shaped thing there (shape: a mesh shell, say). Seen from above at a tilt, a summit sits below the top of its
  // hill's outline on screen, so place() makes each line long enough to rise LEAD px clear of that outline.
  const LEAD=24, STEM_MIN=30;
  function label(at, text, shape){
    const e=el("label hidden", `<span class="txt"></span><span class="stem"></span>`);
    e.querySelector(".txt").textContent=text;
    tracked.push({e, at:typeof at==="function"?at:()=>top(at), shape:typeof at==="function"?shape:at, stem:e.querySelector(".stem"), len:0});
    return e;
  }
  // how far a hill's outline rises above its summit on screen (px): its own profile, sampled away from the viewer
  function outlineRise(t, y0){
    const sg=t.s*1.14, dx=-Math.sin(cam.theta), dz=-Math.cos(cam.theta), H=t.h*AMP; let rise=0;
    for(let i=1;i<=24;i++){ const r=sg*3*i/24, y=project([t.x+dx*r, H*Math.exp(-Math.pow(r*r/(2*sg*sg),1.5)), t.z+dz*r])[1]; rise=Math.max(rise,y0-y); }
    return rise;
  }
  function tag(at, text, note){                      // text only: the wording comes from explainer.json
    const e=el("tag hidden"); e.textContent=text;
    if(note!=null){ const n=document.createElement("small"); n.textContent=note; e.appendChild(n); }
    tracked.push({e,at}); return e;
  }
  // a tag held just above the highest of some hills' peaks on screen, centred over them, so it stands clear of them all
  // the hill of hs whose full height (from hts, in the same order) is greatest: it may still be rising
  const tallest=(hs, hts)=>hs[hts.reduce((b,t,i)=>t.h>hts[b].h?i:b,0)];
  const show=(e,on=true)=>e.classList.toggle("hidden",!on);
  // put overlays in their current state at once (no transition), so hiding them straight after fades them out rather
  // than cutting them
  const drawn=(...es)=>{ for(const e of es){ e.style.transition="none"; void getComputedStyle(e).opacity; e.style.transition=""; } };
  // fade an overlay up into place: it rises a few pixels while its opacity transition runs
  function riseIn(e, px=10, ms=600){ const k=tracked.find(t=>t.e===e); k.dy=px; show(e); return to(k,{dy:0},ms,easeOut); }
  function place(){
    for(const k of tracked){
      const [x,y0]=k.screen?k.screen():project(k.at()), y=y0+(k.dy||0);
      if(k.stem && k.shape){ const len=Math.round(Math.max(STEM_MIN, outlineRise(k.shape,y0)+LEAD)); if(len!==k.len){ k.len=len; k.stem.style.height=`${len}px`; } }
      k.e.style.transform = k.raw ? `translate(${x}px,${y}px)` : (k.e.classList.contains("tag") ? `translate(${x}px,${y}px) translate(-50%,-50%)` : `translate(${x}px,${y}px) translate(-50%,-100%)`);
    }
    marks.innerHTML=drawers.map(d=>d()).join("");
  }
  const line=(a,b,o={})=>`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${INK}" stroke-width="${o.w||1.6}" stroke-opacity="${o.op??0.9}" ${o.dash?`stroke-dasharray="${o.dash}"`:""} stroke-linecap="round"/>`;

  // ---------- timeline: tweens and waits that a new scene cancels ----------
  let token=0, tweens=[];
  const easeIO=u=>u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
  function to(obj, target, ms=900, ease=easeIO){
    const tk=token; if(reduceMotion) ms=1;
    return new Promise(res=>{ const from={}; for(const k in target) from[k]=obj[k]; tweens.push({obj,from,target,t0:performance.now(),ms,ease,res,tk}); });
  }
  const wait=(ms)=>{ const tk=token; return new Promise(res=>setTimeout(()=>{ if(tk===token) res(); }, reduceMotion?Math.min(ms,600):ms)); };
  function stepTweens(now){
    let moved=false;
    tweens=tweens.filter(tw=>{
      if(tw.tk!==token) return false;
      const u=Math.min(1,(now-tw.t0)/tw.ms), e=tw.ease(u);
      for(const k in tw.target) tw.obj[k]=tw.from[k]+(tw.target[k]-tw.from[k])*e;
      moved=true;
      if(u>=1){ tw.res(); return false; }
      return true;
    });
    return moved;
  }

  // ---------- caption ----------
  const stepEl=document.getElementById("step"), lineEl=document.getElementById("line"), noteEl=document.getElementById("note");
  // the wording lives in explainer.json: each step's lines (in order) and its marks (the short labels)
  let STEP={lines:[],marks:{}};
  const M=(k,fallback)=>(STEP.marks&&STEP.marks[k])||fallback;
  // caption text, with **words like these** highlighted in the peaks' colour (built as nodes, never as HTML)
  function inked(el, text){ el.replaceChildren(...text.split(/\*\*(.+?)\*\*/).map((part,k)=>{
    if(k%2===0) return document.createTextNode(part); const e=document.createElement("span"); e.className="hl"; e.textContent=part; return e; })); }
  async function say(i){
    const text=(STEP.lines||[])[i]||"";
    if(lineEl.textContent){ lineEl.classList.add("out"); await wait(320); }
    inked(lineEl,text); noteEl.textContent=i===0?(STEP.note||""):""; lineEl.classList.remove("out");
  }
  // adds line i under what's showing instead of replacing it: the earlier text dims back, and the new paragraph opens
  // from nothing to its height as it fades up, so the caption grows smoothly (pushing the text up where the caption is
  // anchored at its foot, as on the welcome page). The next say() clears both.
  async function sayMore(i){
    const text=(STEP.lines||[])[i]||"";
    if(!lineEl.querySelector(".para")){ const a=document.createElement("span"); a.className="para"; a.append(...lineEl.childNodes); lineEl.replaceChildren(a); }
    const b=document.createElement("span"); b.className="para more"; inked(b,text); lineEl.append(b);
    const h=b.offsetHeight;                                // closed first with no transition (the gap above opens with it)
    b.style.transition="none"; b.style.height=b.style.paddingTop="0px"; void b.offsetHeight; b.style.transition="";
    for(const p of lineEl.querySelectorAll(".para:not(:last-child)")) p.classList.add("back");
    b.style.height=`${h}px`; b.style.paddingTop=""; b.classList.add("in"); markLines();
    await wait(700); b.style.height="";
  }
  const mock=document.getElementById("mock");
  const setLevel=(l)=>{ for(const t of mock.querySelectorAll(".tab")) t.setAttribute("aria-selected", t.dataset.l===l?"true":"false"); };
  // a step whose caption lines each go with a view (Two views) can let the viewer switch between them: the toggle's tab
  // for a view, or the paragraph that goes with it, calls pick(its line). The lines and tabs become buttons meanwhile.
  let chooser=null;
  const focusLine=(i)=>lineEl.querySelectorAll(".para").forEach((p,j)=>{ p.classList.toggle("back",j!==i); if(chooser) p.setAttribute("aria-pressed",j===i?"true":"false"); });
  function choose(tabs, pick){
    chooser={tabs, pick}; document.body.classList.add("choosing");
    const name=(e)=>e.textContent.trim();
    for(const t of mock.querySelectorAll(".tab")){ t.setAttribute("role","button"); t.tabIndex=0; t.setAttribute("aria-label",`Show ${name(t)}`); }
    markLines();
  }
  function markLines(){                                  // the caption's paragraphs as buttons, the current one pressed
    if(!chooser) return;
    const ps=[...lineEl.querySelectorAll(".para")];
    for(const p of ps){ p.setAttribute("role","button"); p.tabIndex=0; }
    focusLine(ps.findIndex(p=>!p.classList.contains("back")));
  }
  function unchoose(){
    chooser=null; document.body.classList.remove("choosing");
    for(const t of mock.querySelectorAll(".tab")){ t.removeAttribute("role"); t.removeAttribute("tabindex"); t.removeAttribute("aria-label"); }
  }
  const chosen=(e)=>{
    if(!chooser) return;
    const t=e.target.closest(".tab"), p=e.target.closest(".para");
    const i=t&&mock.contains(t) ? chooser.tabs[t.dataset.l] : p&&lineEl.contains(p) ? [...lineEl.children].indexOf(p) : -1;
    if(i==null || i<0) return;
    e.preventDefault(); chooser.pick(i);
  };
  for(const host of [mock,lineEl]){
    host.addEventListener("click",chosen);
    host.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" ") chosen(e); });
  }

  // ---------- the scenes (the explainer canvas boards) ----------
  const view=(o)=>{ Object.assign(goal,o); if(o.center) goal.center=[...o.center]; };
  const TILT=Math.PI*0.28;
  // the first step's hills: five in a row across the screen, tallest first (risen, or flat to rise). Each peak
  // stands on a crossing of the floor grid (its lines fall on whole units), one square on in both column and row from
  // the last, a diagonal that runs left to right on screen at the scenes' theta of 0.7. Later scenes use the grid too.
  // Slim enough (s .28) that neighbouring bases, a diagonal square (1.4) apart, stay just clear of each other.
  // Heights as contour-line counts: each hill rises one line per packet of data that reaches it.
  const LINES=[59,49,41,32,24], RANKS=LINES.map(levelH);
  const rankedRow=(risen)=>RANKS.map((h,i)=>hill({x:i-2, z:2-i, h:risen?h:0, s:.28}));
  // where Foundations ends, close in on the row with the middle hill at the centre: Defining the landscape opens here
  const RANK_END={theta:0.7,phi:TILT,zoom:1.75,center:[0,0.3,0]};
  // a point a across the screen and b towards the viewer, at the scenes' bearing (0.7), whatever the camera's doing
  const across=(a,b)=>{ const r=[Math.cos(0.7),0,-Math.sin(0.7)]; return {x:r[0]*a-r[2]*b, z:r[2]*a+r[0]*b}; };
  // a selection arc, as the map draws one from a selected theme to a related one (map.js, ARC_FS): a raised curve from
  // just above one summit to just above the other, rising more the further apart they are, 2.4px wide, in the summit
  // colour pulled halfway to the ink and fading along its length. u: how much has drawn on (0 to 1). Once drawn, and
  // from pulse (a time, ms), a bright tail runs along it from A to B every ~2.2 s, as on the map (still if reduced motion).
  function selArc(A, B, u, k, pulse){
    if(u<=0) return "";
    const a=[A.x,heightAt(A.x,A.z)+0.05,A.z], b=[B.x,heightAt(B.x,B.z)+0.05,B.z], rise=0.35+0.22*Math.hypot(b[0]-a[0],b[2]-a[2]);
    const at=(t)=>project([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t+Math.sin(t*Math.PI)*rise, a[2]+(b[2]-a[2])*t]);
    const run=(t0,t1)=>{ const n=Math.max(2,Math.ceil((t1-t0)*40)), pts=[]; for(let i=0;i<=n;i++) pts.push(at(t0+(t1-t0)*i/n).map(v=>v.toFixed(1)).join(",")); return pts.join(" "); };
    const grad=(id,p,q,c0,o0,c1,o1)=>`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}"><stop offset="0" stop-color="${c0}" stop-opacity="${o0}"/><stop offset="1" stop-color="${c1}" stop-opacity="${o1}"/></linearGradient>`;
    const ink=INK==="#fff"?255:0, c=`rgb(${PEAK_GL.map(v=>Math.round(v*255*.5+ink*.5)).join(",")})`;
    let svg=`<defs>${grad(`arc${k}`,at(0),at(1),c,.62,c,.34)}</defs><polyline points="${run(0,u)}" fill="none" stroke="url(#arc${k})" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    if(u>=1 && pulse!=null && !reduceMotion){
      const head=((performance.now()-pulse)/1000*0.45)%1, t0=Math.max(0,head-0.25);
      if(head-t0>0.01) svg+=`<defs>${grad(`arcp${k}`,at(t0),at(head),INK,0,INK,.6)}</defs><polyline points="${run(t0,head)}" fill="none" stroke="url(#arcp${k})" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    return svg;
  }
  // n peaks in random places, each well clear of a cluster and of each other, out to either side of it on screen, behind
  // or level with it (clear of the caption, which sits low on the left), and inside the ground (it fades out past 4.5).
  // rnd: where the randomness comes from; a seeded() one gives the same places every time
  function scatter(n, from, clear=2.2, apart=1.7, span=3.3, rnd=Math.random){
    let best=[];
    for(const ease of [1,.92,.84,.76,.68]){ const out=scatterOnce(n, from, clear*ease, apart*ease, span, rnd); if(out.length>best.length) best=out; if(best.length===n) break; }
    return best;
  }
  function scatterOnce(n, from, clear, apart, span, rnd){
    const out=[];
    for(let tries=0; out.length<n && tries<1200; tries++){
      const sa=(rnd()*2-1)*span, sb=-1.4+rnd()*1.7, {x,z}=across(sa,sb);   // sb > 0 is nearer the viewer
      if(Math.max(Math.abs(x),Math.abs(z))>4 || Math.hypot(x-from.x,z-from.z)<clear || out.some(o=>Math.hypot(x-o.x,z-o.z)<apart)) continue;
      out.push({x, z, near:sb, h:.3+rnd()*.35, s:.24+rnd()*.1});
    }
    return out;
  }
  const seeded=(s)=>()=>(s=(s*16807)%2147483647)/2147483647;
  const HILL_VIEW={theta:0.7,phi:TILT,zoom:1.7,center:[0,0.6,0]};
  // Out of Foundations, the middle hill of the row lowers and broadens into a small, wide mound (HILL_BASE high, MOUND_S
  // wide, framed by MOUND_VIEW) for Defining the landscape: its foot stays at the centre of the screen.
  // Controlling impact: that mound pulls apart into two on one grid line running top left to bottom right on screen,
  // three squares apart (PAIR), and documents feed each along a grid line from in front of it (down and left on
  // screen), laid out as step 1's are: lines read towards the hill and stack down and right. The top-left hill eats one
  // really long document (SINGLE): its first excerpts lift it quickly and each lifts it by less than the one before, so
  // it slows to a crawl as the page runs on (short enough to end well clear of the other hill's lane). The bottom-right
  // one is fed short documents (MULTI), all highlighted, stacked with a gap of MULTI.gap lines between each so they show
  // as separate sources, all on screen together: each one's first excerpt lifts it by the full amount again, so it
  // overtakes the first and keeps climbing to Two views' height. Both feed at the same pace and start at HILL_BASE.
  // PAIR_VIEW frames both hills and their pages, clear of the caption.
  const PAIR=[{x:-1,z:0}, {x:2,z:0}].map(p=>({...p, dir:[0,1], perp:[1,0]})), PAIR_S=.6;
  const SINGLE={n:30, d0:.045, r:.72, every:.13}, MULTI={pages:[4,3,3,3], gap:3, d0:.062, r:.6, every:.13};   // 1 document, 30 excerpts; 4 documents, 13
  const grown=(f)=>f.d0*(1-Math.pow(f.r,f.n))/(1-f.r);
  const HILL_TOP=.9, HILL_BASE=HILL_TOP-MULTI.pages.reduce((a,n)=>a+grown({...MULTI,n}),0), SINGLE_TOP=HILL_BASE+grown(SINGLE), MOUND_S=.68;   // base .40; the single source's hill ends near .56
  const MOUND_VIEW={theta:0.7,phi:TILT,zoom:1.9,center:[0,0,0]};   // the hill's foot stays at the centre of the screen
  const PAIR_VIEW={theta:0.7,phi:TILT,zoom:1.5,center:[0.25,0,1.3]};   // the hills above the middle, their pages below them and right of the caption
  const PAIR_END={theta:0.7,phi:TILT,zoom:1.7,center:[0.3,0,-0.25]};   // once the pages have gone: the two hills centred on screen
  // Two views' industry once it has broadened, and its three markets: spread evenly across the screen at the scenes'
  // theta (left, back, right), and placed so every market stays inside the industry's shell of rings with room to spare
  const INDUSTRY={h:.9,s:.72}, MARKETS=[{x:-.32,z:.47,s:.3,h:.5},{x:-.25,z:-.38,s:.3,h:.62},{x:.59,z:-.23,s:.28,h:.42}];
  let cameFrom=null, levelsEnd=1;                          // the step played just before, and the view Two views was left on
  // Positioning's layout, the same every time so the next step can open on it: the three markets' middle, the four
  // related markets that rise round them (across the screen and towards the viewer from it), four unrelated peaks well
  // away in places that look random (seeded), and the view it ends on
  function positioned(){
    const mid=[MARKETS.reduce((a,m)=>a+m.x,0)/3, MARKETS.reduce((a,m)=>a+m.z,0)/3];
    const more=[[-1.15,-.35,.28,.38],[.1,.8,.3,.34],[1.2,-.45,.26,.46],[-.6,-.95,.24,.3]].map(([a,b,s,h])=>{ const o=across(a,b); return {x:mid[0]+o.x, z:mid[1]+o.z, s, h}; });
    const far=scatter(4,{x:mid[0],z:mid[1]},2.6,1.6,3.5,seeded(41));
    return {mid, more, far, end:{theta:0.7,phi:TILT,zoom:1.7,center:[mid[0]*.5,0.45,mid[1]*.5]}};
  }
  // Growing the landscape: the camera draws back over GROW_MS to GROWN_VIEW, turning, while more made-up peaks rise round
  // Positioning's eleven, out to the edges of the screen in every direction: three big ones in the middle, just behind
  // the related markets, their feet running together; a few big and medium mountains further out (GROWN: [across the
  // screen, towards the viewer, width, height], from the markets' middle, as Positioning's are); and between and beyond
  // them clusters of small peaks (smallClusters, seeded: the same every time). Meanwhile Positioning's own peaks change
  // too, some growing and some shrinking (MORPHED: height and width factors, markets, then related, then unrelated).
  const GROW_MS=11000, GROWN_VIEW={theta:0.7,phi:TILT,zoom:.98,center:[-.8,0.4,-1.3]};
  const GROWN=[[-.9,-2.9,.85,.95],[1.3,-3.2,.9,.88],[.1,-4.6,.8,.8],
    [-4.4,-2.2,.7,.85],[4.6,-2.8,.75,.92],[-2.9,-3.6,.45,.5],[5.4,-.9,.45,.5]];
  // n clusters of small peaks spread out to R from the middle, clear of the peaks already there (keep) and of each
  // other: each a slightly larger peak with two to four small ones round it, their feet running together. Each peak
  // knows its cluster (g), so a cluster can rise together.
  function smallClusters(keep, n=10, R=10.3){
    const rnd=seeded(61), out=[], centres=[];
    const clear=(x,z,r)=>keep.every(k=>Math.hypot(x-k.x,z-k.z)>r+k.s*1.3) && out.every(o=>Math.hypot(x-o.x,z-o.z)>(r+o.s)*.8);
    for(let tries=0; centres.length<n && tries<4000; tries++){
      const a=rnd()*Math.PI*2, d=3.4+Math.sqrt(rnd())*(R-3.4), x=Math.cos(a)*d, z=Math.sin(a)*d;
      if(centres.every(c=>Math.hypot(x-c.x,z-c.z)>2.8) && keep.every(k=>Math.hypot(x-k.x,z-k.z)>k.s*1.3+1)) centres.push({x,z});
    }
    for(const c of centres){
      const m=3+Math.floor(rnd()*3);
      for(let k=0, tries=0; k<m && tries<50; tries++){
        const a=rnd()*Math.PI*2, d=k?.45+rnd()*.75:rnd()*.2, x=c.x+Math.cos(a)*d, z=c.z+Math.sin(a)*d;
        const s=k?.2+rnd()*.14:.3+rnd()*.12, h=k?.2+rnd()*.25:.4+rnd()*.25;
        if(Math.hypot(x,z)<R && clear(x,z,s)) { out.push({x,z,s,h,g:c}); k++; }
      }
    }
    // then fill the biggest empty patches left, a small cluster at a time, until none is wider than about two units
    // across (checked on a grid; the camera turns, so every direction counts)
    const all=()=>[...keep,...out], room=(x,z)=>Math.min(...all().map(k=>Math.hypot(x-k.x,z-k.z)-k.s*1.6));
    for(let fill=0; fill<14; fill++){
      let best=null;
      for(let x=-R; x<=R; x+=.5) for(let z=-R; z<=R; z+=.5){ if(Math.hypot(x,z)>R-.4) continue; const r=room(x,z); if(!best || r>best.r) best={x,z,r}; }
      if(!best || best.r<1.1) break;
      const c={x:best.x, z:best.z}, m=2+Math.floor(rnd()*2);
      for(let k=0, tries=0; k<m && tries<40; tries++){
        const a=rnd()*Math.PI*2, d=k?.4+rnd()*.6:0, x=c.x+Math.cos(a)*d, z=c.z+Math.sin(a)*d;
        const s=k?.2+rnd()*.12:.26+rnd()*.12, h=k?.18+rnd()*.22:.3+rnd()*.25;
        if(Math.hypot(x,z)<R && clear(x,z,s)) { out.push({x,z,s,h,g:c}); k++; }
      }
    }
    return out;
  }
  // Growing the landscape's arrangement: its big and medium mountains and its small clusters (Uniquely yours opens on it)
  function grownLayout(P){
    const big=GROWN.map(([a,b,s,h])=>{ const o=across(a,b); return {x:P.mid[0]+o.x, z:P.mid[1]+o.z, s, h}; });
    return {big, small:smallClusters([...MARKETS,...P.more,...P.far,...big])};
  }
  const MORPHED=[[1.5,1.2],[.72,1],[1.55,1.2], [.55,.9],[1.6,1.2],[.6,.9],[1.55,1.15], [1.5,1.4],[.6,.9],[1.3,1.3],[.55,.9]];
  // Controlling impact's two hills' labels, hidden: what fed each one (Two views opens on them)
  const pairLabels=(single,multi)=>[label(single,M("single","1 document · 30 excerpts")), label(multi,M("multi","4 documents · 13 excerpts"))];
  // Defining the landscape's hill and its measures, hidden: a height line beside it and a width line under it, drawn
  // out to m.h and m.w (0 to 1), and their labels. The width line runs just below the hill's front foot (where its
  // last contour ring ends, about 2.2 sigma out towards the viewer), with dashed lines down to it from the width's
  // ends, and its label under that. fit() sets the Height label's left edge 16px right of its line, however long the
  // note (call it once the label is laid out). Controlling impact opens on them.
  function hillMeasures(t){
    const r=screenRight(), m={h:0,w:0}, rad=1.35, base=[r[0]*rad*1.25,0,r[2]*rad*1.25], GAP=16;
    const foot=()=>{ const R=t.s*1.14*2.2; return [t.x+Math.sin(goal.theta)*R, 0, t.z+Math.cos(goal.theta)*R]; };
    drawers.push(()=>{ let s="";
      const pk=top(t), b=project(base), tp=project([base[0],pk[1],base[2]]);
      if(m.h>0){ s+=line(project(pk),tp,{op:.35*Math.min(1,m.h*3),dash:"3 4",w:1}); s+=line(b,[b[0]+(tp[0]-b[0])*m.h, b[1]+(tp[1]-b[1])*m.h],{w:2}); }
      if(m.w>0){ const a=project([-r[0]*rad,0,-r[2]*rad]), c=project([r[0]*rad,0,r[2]*rad]), mid=[(a[0]+c[0])/2,(a[1]+c[1])/2];
        const off=project(foot())[1]-mid[1]+GAP, A=[mid[0]+(a[0]-mid[0])*m.w, mid[1]+(a[1]-mid[1])*m.w+off], C=[mid[0]+(c[0]-mid[0])*m.w, mid[1]+(c[1]-mid[1])*m.w+off], op=.35*Math.min(1,m.w*3);
        s+=line(A,C,{w:2}); s+=line(a,[a[0],a[1]+off+6],{op,dash:"3 4",w:1})+line(c,[c[0],c[1]+off+6],{op,dash:"3 4",w:1}); }
      return s; });
    const hl=tag(()=>[base[0],heightAt(t.x,t.z)*0.55,base[2]],M("height","Height"),M("heightNote","strength of evidence")); hl.style.textAlign="left";
    const wl=tag(foot,M("width","Width"),M("widthNote","how often it's mentioned")); wl.style.marginTop=`${GAP+34}px`;
    return {m,hl,wl,fit:()=>{ hl.style.marginLeft=`${hl.offsetWidth/2+16}px`; }};
  }
  const SCENES={
    // Foundations: documents empty into a row of hills and lift each to its rank, and the camera ends close in on the
    // row, ready for the next step to pick out its middle hill
    rank:{ title:"Foundations", async run(){
        view(OPENING);
        const H=rankedRow(false);
        await say(0);
        if(reduceMotion){ view(RANK_END); H.forEach((t,i)=>to(t,{h:RANKS[i]})); await wait(9000); return; }
        // the documents build on top down, side by side in rank order; each sits `run` along its hill's grid line
        const docs=pages(LINES).map((lines,i)=>({lines, n:LINES[i], x:0, z0:2-i+FLOW.run}));
        docs.forEach((d,i)=>d.lines.forEach((L,j)=>{ L.b=.15+i*.16+j*.05; }));   // left to right, a page at a time
        // the documents settle into the hills' offset in SETTLE seconds; the feed starts then, while the camera is still turning
        const TURN=1.5, SETTLE=1.5, PULSE=TURN+SETTLE, last=flowInto(H,schedule(docs,PULSE));
        drawers.push(docLines(docs,TURN));                  // a sweep across the text picks out words in the peaks' colour
        await wait(TURN*1000);
        // as the flood starts, turn to the map's view as the documents move into the hills' offset (the camera's turn is
        // moved with its goal, so it doesn't trail them; its zoom follows the goal, so the pan below can take it over)
        to(goal,{theta:0.7,phi:TILT,zoom:1.6},2200); to(cam,{theta:0.7,phi:TILT},2200);
        docs.forEach((d,i)=>to(d,{x:i-2},SETTLE*1000));
        await wait(SETTLE*1000);
        to(goal.center,{...RANK_END.center},2800); to(goal,{zoom:RANK_END.zoom},2800);   // as the data runs, pan across so the hills take the centre
        await wait((last-PULSE)*1000+2400);
    }},
    hill:{ title:"Defining the landscape", async run(){
        // opens on the last step's end (its row of hills), so the two run on from each other. The middle hill already
        // stands where this step's hill goes, at the centre of the screen
        view(RANK_END);
        const H=rankedRow(true), t=H[2];
        await say(0);
        // the rest of the row sinks away while the middle hill lowers and broadens into a small, wide mound, and the
        // camera closes in (moved with its goal, so it has settled when the mound has)
        for(const o of H) if(o!==t) to(o,{h:0},1300);
        for(const c of [goal,cam]){ to(c,{zoom:MOUND_VIEW.zoom},1800); to(c.center,{...MOUND_VIEW.center},1800); }
        await to(t,{s:MOUND_S,h:HILL_BASE},1800);
        // then the measures draw on and their labels fade up
        const ms=hillMeasures(t);
        await to(ms.m,{h:1},900); ms.fit(); riseIn(ms.hl); await wait(900);
        await to(ms.m,{w:1},900); riseIn(ms.wl);
        await wait(3600);
    }},
    impact:{ title:"Controlling impact", async run(){
        // opens on the last step's end (the mound and its measures). The measures and their labels fade and the camera
        // draws back, as the mound pulls apart into two, one up and left, the other down and right. Then both are fed in
        // step 1's style, their highlighted words pulsing in the peaks' colour: the first by one really long source, the
        // second by a stack of short separate ones
        view(MOUND_VIEW);
        const t=hill({x:0,z:0,h:HILL_BASE,s:MOUND_S}), ms=hillMeasures(t);
        ms.m.h=ms.m.w=1; ms.fit(); show(ms.hl); show(ms.wl); drawn(ms.hl,ms.wl);
        await say(0);
        show(ms.hl,false); show(ms.wl,false); to(ms.m,{h:0,w:0},700);
        // the mound becomes two halves in the same place (the peaks' soft max makes two alike 2^(1/P) as tall as one, so
        // each starts that much lower and together they look just like it), and they draw apart, each to the full height
        const [pa,pb]=PAIR, half=HILL_BASE*Math.pow(2,-1/P), twin=hill({x:t.x,z:t.z,h:half,s:MOUND_S}); t.h=half;
        for(const c of [goal,cam]){ to(c,{zoom:PAIR_VIEW.zoom},1600); to(c.center,{...PAIR_VIEW.center},1600); }
        await Promise.all([to(t,{x:pa.x,z:pa.z,s:PAIR_S,h:HILL_BASE},1600), to(twin,{x:pb.x,z:pb.z,s:PAIR_S,h:HILL_BASE},1600)]);
        if(reduceMotion){ to(t,{h:SINGLE_TOP}); to(twin,{h:HILL_TOP}); view(PAIR_END); for(const e of pairLabels(t,twin)) show(e); await wait(6000); return; }
        // the pages lie square to the grid, brighter than step 1's and each document outlined, and come in one document at
        // a time: the long one first, as one page, then each short one in turn, lighting up as it lands. Once all are on
        // screen, both feed together at the same pace
        const page=(p,lines,f)=>({lines, ...f, start:2.4, ink:.8, outline:true, dir:p.dir, perp:p.perp, x:p.x+p.dir[0]*FLOW.run, z0:p.z+p.dir[1]*FLOW.run});
        const long=page(pa, excerptPages([SINGLE.n],.3)[0], SINGLE);
        long.lines.forEach((L,j)=>{ L.b=.1+j*.012; L.flood=.6; });
        const many=page(pb, stacked(excerptPages(MULTI.pages,1,53,3), MULTI.gap), MULTI);
        many.lines.forEach(L=>{ if(L.src==null){ L.b=0; return; } const at=.6+L.src*.32; L.b=at+L.k*.03; L.flood=at+.3; });
        const last=flowInto([t,twin],[feedOne([long],HILL_BASE)[0], feedOne([many],HILL_BASE)[0]],HILL_BASE,[pa.dir,pb.dir]);
        drawers.push(docLines([long,many],0));
        // as the documents start to feed in, the camera eases in to centre the two hills, landing as the last excerpts do
        // (the pages empty as it goes); then each hill's label fades up: what fed it
        await wait(2000);
        const panMs=(last+.3-2)*1000;
        for(const c of [goal,cam]){ to(c,{zoom:PAIR_END.zoom},panMs); to(c.center,{...PAIR_END.center},panMs); }
        await wait(panMs-400);
        const fed=pairLabels(t,twin); riseIn(fed[0]); await wait(250); riseIn(fed[1]);
        await wait(2000);
    }},
    levels:{ title:"Two views", async run(){
        // opens on the last step's end (its two hills as the documents left them): the shorter sinks away, and the taller
        // moves to the centre and broadens into this step's industry as the camera closes in on it (moved with its goal);
        // once it has settled, the view's toggle and the Industry label fade up
        view(PAIR_END);
        const [pa,pb]=PAIR, lone=hill({x:pa.x,z:pa.z,h:SINGLE_TOP,s:PAIR_S}), ind=hill({x:pb.x,z:pb.z,h:HILL_TOP,s:PAIR_S});
        const mk=MARKETS.map(m=>hill({...m,h:0})), mh=MARKETS.map(m=>m.h), fed=pairLabels(lone,ind);
        for(const e of fed) show(e); drawn(...fed);
        await say(0);
        for(const e of fed) show(e,false);
        to(lone,{h:0},1100);
        for(const c of [goal,cam]){ to(c,{zoom:HILL_VIEW.zoom},1400); to(c.center,{0:0,1:0.5,2:0},1400); }
        levelsEnd=0;
        await to(ind,{x:0,z:0,s:INDUSTRY.s},1400);
        // Markets: the industry stays as a light shell of rings while its own surface sinks and its markets rise inside
        // it. Industries: the reverse. Once the toggle shows, either view can be picked, by its tab or by the paragraph
        // that goes with it (choose(), which play() clears). Left alone, the step switches to Markets once and ends there;
        // a pick by hand stops that, and a pick mid-switch takes over from wherever the hills are.
        meshHill({x:ind.x,z:ind.z,h:ind.h,s:ind.s});
        const il=label(ind,M("industry","Industry")), loz=label(()=>[0,AMP*INDUSTRY.h,0],M("industry","Industry"),{x:0,z:0,...INDUSTRY}),   // on the top of its shell
          ml=mk.map(t=>label(t,M("market","Market"))), moving=[MESH,ind,...mk];
        let at=0, gen=0, byHand=false;
        async function markets(g){
          setLevel("markets"); show(il,false);
          await Promise.all([to(MESH,{a:1},900), to(ind,{h:0},1100), ...mk.map((t,i)=>to(t,{h:mh[i]},1300))]);
          if(g!==gen) return;
          riseIn(loz); for(const e of ml){ if(g!==gen) return; riseIn(e); await wait(160); }
        }
        async function industries(g){
          setLevel("industries"); show(loz,false); for(const e of ml) show(e,false);
          await Promise.all([to(MESH,{a:0},900), to(ind,{h:INDUSTRY.h},1100), ...mk.map(t=>to(t,{h:0},900))]);
          if(g===gen) riseIn(il);
        }
        async function pick(i, auto=false){
          if(!auto) byHand=true;
          if(i===at) return;
          at=levelsEnd=i; const g=++gen;
          tweens=tweens.filter(tw=>!moving.includes(tw.obj));          // the switch under way stops where it is
          if(!lineEl.querySelector(".para.more")){ sayMore(1); await wait(320); if(g!==gen) return; }   // Markets' line, the first time
          else focusLine(i);
          await (i===1 ? markets(g) : industries(g));
        }
        show(mock); setLevel("industries"); riseIn(il);
        choose({industries:0, markets:1}, (i)=>pick(i));
        await wait(4200);
        if(!byHand) await pick(1,true);
        await wait(3200);
    }},
    proximity:{ title:"Positioning", async run(){
        // opens on Two views' end: the markets inside the industry's shell of rings (or, if Two views was left on
        // Industries, the industry itself). The labels fade and the shell undraws from its summit down (or the industry
        // sinks as its markets rise), while the camera closes in on the three markets; then four more related markets rise
        // around them, seven in all: this step's first screen
        const fromIndustry=cameFrom==="levels" && levelsEnd===0;
        view({...HILL_VIEW, center:[0,0.5,0]});
        const ind=hill({x:0,z:0,h:fromIndustry?INDUSTRY.h:0,s:INDUSTRY.s}), mk=MARKETS.map(m=>hill({...m,h:fromIndustry?0:m.h}));
        let held;
        if(fromIndustry) held=[label(ind,M("industry","Industry"))];
        else { meshHill({x:0,z:0,...INDUSTRY}); MESH.a=1;
          held=[label(()=>[0,AMP*INDUSTRY.h,0],M("industry","Industry"),{x:0,z:0,...INDUSTRY}), ...mk.map(t=>label(t,M("market","Market")))]; }
        for(const e of held) show(e); drawn(...held);
        await say(0);
        for(const e of held) show(e,false);
        const P=positioned(), mid=P.mid;
        for(const c of [goal,cam]){ to(c,{zoom:2.05},1800); to(c.center,{0:mid[0],1:0.55,2:mid[1]},1800); }
        if(fromIndustry) await Promise.all([to(ind,{h:0},1100), ...mk.map((t,i)=>to(t,{h:MARKETS[i].h},1300))]);
        else { MESH.top=AMP*INDUSTRY.h+0.06; await to(MESH,{top:0},1600); MESH.a=0; }   // from just over its summit
        const more=P.more.map(m=>({t:hill({x:m.x, z:m.z, h:0, s:m.s}), h:m.h}));
        await Promise.all(more.map((m,k)=>wait(k*150).then(()=>to(m.t,{h:m.h},1000))));
        await wait(1200);
        // then the seven light up as the map shows a selection: arcs draw from the tallest out to the other six and pulse,
        // and Related fades up over them. Meanwhile a few unrelated peaks rise in random-looking places well
        // away from the cluster and each other, each labelled Unrelated. The camera draws back a little.
        const sel=mk[1], rel=[mk[0],mk[2],...more.map(m=>m.t)].map(t=>({a:sel,b:t,u:0})), lit={at:null};
        drawers.push(()=>rel.map((r,k)=>selArc(r.a,r.b,r.u,k,lit.at)).join(""));
        const far=P.far.map(f=>{ const t=hill({x:f.x,z:f.z,h:0,s:f.s}); return {...f, t, label:label(t,M("unrelated","Unrelated"))}; });
        for(const c of [goal,cam]){ to(c,{zoom:P.end.zoom},2200); to(c.center,{...P.end.center},2200); }
        const related=label(tallest([...mk,...more.map(m=>m.t)],[...MARKETS,...P.more]),M("related","Related"));   // on the tallest of the seven
        wait(500).then(()=>Promise.all(rel.map((r,k)=>wait(k*90).then(()=>to(r,{u:1},1000,easeOut))))).then(()=>{ lit.at=performance.now(); });
        wait(1800).then(()=>riseIn(related));
        far.forEach((f,k)=>{ wait(300+k*220).then(()=>to(f.t,{h:f.h},1100)).then(()=>riseIn(f.label)); });
        await wait(6000);
    }},
    growth:{ title:"Growing the landscape", async run(){
        // opens on Positioning's end: the seven related markets with their pulsing arcs and Related over them, and the four
        // unrelated peaks with their labels. The labels fade and the arcs draw back in. Then the camera draws slowly back
        // (the terrain grows with it) as more peaks rise around them, big ones in the middle first, then out to the edges
        const P=positioned();
        view(P.end);
        const mk=MARKETS.map(m=>hill({...m})), more=P.more.map(m=>hill({...m})), far=P.far.map(f=>hill({x:f.x,z:f.z,h:f.h,s:f.s}));
        const rel=[mk[0],mk[2],...more].map(t=>({a:mk[1],b:t,u:1})), lit={at:performance.now()};
        drawers.push(()=>rel.map((r,k)=>selArc(r.a,r.b,r.u,k,lit.at)).join(""));
        const held=[label(tallest([...mk,...more],[...MARKETS,...P.more]),M("related","Related")), ...far.map(t=>label(t,M("unrelated","Unrelated")))];
        for(const e of held) show(e); drawn(...held);
        growing=true;
        await say(0);
        for(const e of held) show(e,false);
        await Promise.all(rel.map(r=>to(r,{u:0},700)));
        const L=grownLayout(P);
        const peaks=[...L.big, ...L.small].map(p=>({...p, d:Math.hypot(p.x-P.mid[0],p.z-P.mid[1]), t:hill({x:p.x,z:p.z,h:0,s:p.s})}));
        if(reduceMotion){ view(GROWN_VIEW); peaks.forEach(p=>to(p.t,{h:p.h})); await wait(6000); return; }
        to(goal,{zoom:GROWN_VIEW.zoom},GROW_MS); to(goal.center,{...GROWN_VIEW.center},GROW_MS);
        to(SPIN,{rate:.11},4000);                          // and starts turning slowly round its centre, as the map's Spin does, and keeps on
        // when the terrain will reach a point (it spans 4.4 units either way per unit of WORLD, which follows the zoom)
        const zoomAt=(u)=>P.end.zoom+(GROWN_VIEW.zoom-P.end.zoom)*easeIO(u), reach=(u)=>4.4*worldAt(zoomAt(u));
        // each rises once the terrain reaches it, the nearer (the big ones in the middle) first; a cluster together, its
        // peaks a moment apart
        const reachOut=Math.max(...peaks.map(p=>p.d)), rnd=seeded(5), when=new Map();
        for(const p of peaks){ const k=p.g||p, need=Math.max(Math.abs(p.x),Math.abs(p.z))+p.s*1.2; let u=0; while(u<1 && reach(u)<need) u+=.01;
          when.set(k, Math.max(when.get(k)||0, u*GROW_MS, p.d/reachOut*GROW_MS*.6)); }
        for(const [k,at] of when) when.set(k, at+rnd()*600);
        for(const p of peaks){
          const at=when.get(p.g||p)+(p.g?rnd()*450:0), ms=p.s>.7?2200:1100+rnd()*500;
          wait(at).then(()=>to(p.t,{h:p.h},ms,easeOut));
        }
        [...mk,...more,...far].forEach((t,k)=>{ const [fh,fs]=MORPHED[k], h=Math.min(1,t.h*fh), s=t.s*fs;
          wait(1500+rnd()*6000).then(()=>to(t,{h,s},1800+rnd()*600)); });
        await wait(GROW_MS+1500);
    }},
    unique:{ title:"Uniquely yours", async run(){
        // opens on Growing the landscape's end, the camera where it was and still turning (or at its end view). The
        // landscape as it stands becomes a skeleton of contour rings; a wave of light in the peaks' colour runs out
        // across it, then another, and as the second passes, the ground beneath reshapes: some peaks rise through their
        // old rings, others sink and leave them floating, a few flatten. The peaks that rose most, and a few others,
        // are labelled as possible opportunities. The camera keeps turning.
        const P=positioned(), L=grownLayout(P);
        const was=[...MARKETS,...P.more,...P.far].map((p,k)=>{ const [fh,fs]=MORPHED[k]; return {x:p.x, z:p.z, h:Math.min(1,p.h*fh), s:p.s*fs}; }).concat(L.big, L.small);
        if(cameFrom!=="growth") view(GROWN_VIEW);
        growing=true; SPIN.rate=reduceMotion?0:.11;
        const H=was.map(p=>hill({x:p.x, z:p.z, h:p.h, s:p.s}));
        await say(0);
        for(const p of was) meshHill({x:p.x, z:p.z, h:p.h, s:p.s});
        await to(MESH,{a:1},1000);
        const rnd=seeded(13), change=was.map((p,k)=>{ const u=rnd(), f=u<.2?1.5+rnd()*.6:u<.55?.2+rnd()*.45:u<.65?0:.85+rnd()*.3;
          return {k, h:Math.min(1,p.h*f), s:p.s*(u<.2?1.15:1), gain:p.h*f-p.h}; });
        // a wave of light runs out across the landscape, and then a second, and each peak changes as the second reaches it
        const PULSE_R=14, PULSE_MS=2200, linear=(u)=>u;
        const pulse=()=>{ Object.assign(PULSE,{x:P.mid[0], z:P.mid[1], r:0, a:1}); wait(PULSE_MS*.7).then(()=>to(PULSE,{a:0},PULSE_MS*.3)); return to(PULSE,{r:PULSE_R},PULSE_MS,linear); };
        if(!reduceMotion){ await pulse(); await wait(250); pulse(); }
        await Promise.all(change.map(c=>{ const p=was[c.k], d=Math.hypot(p.x-P.mid[0],p.z-P.mid[1]);
          return wait(reduceMotion?0:d/PULSE_R*PULSE_MS+rnd()*250).then(()=>to(H[c.k],{h:c.h,s:c.s},1600)); }));
        // the three that rose most are labelled as possible opportunities, and four more peaks picked at random across the
        // landscape (seeded), each well apart from the others so the labels don't crowd
        const picked=[...change].sort((a,b)=>b.gain-a.gain).slice(0,3), apart=(c)=>picked.every(q=>Math.hypot(was[c.k].x-was[q.k].x, was[c.k].z-was[q.k].z)>2.6);
        for(let tries=0; picked.length<7 && tries<400; tries++){ const c=change[Math.floor(rnd()*change.length)]; if(c.h>.2 && apart(c)) picked.push(c); }
        for(const c of picked){ riseIn(label(H[c.k],M("opportunity","Opportunity?"))); await wait(220); }
        await wait(4000);
    }},
  };

  // ---------- player ----------
  const dotsEl=document.getElementById("dots");
  const params=new URLSearchParams(location.search), embedded=params.has("embed");
  if(embedded) document.body.classList.add("embed");
  let STEPS=Object.keys(SCENES).map(id=>({scene:id,title:SCENES[id].title,lines:[],marks:{}}));   // used only if explainer.json can't be read
  let current=0, opened=false;
  function buildDots(){
    dotsEl.innerHTML="";
    STEPS.forEach((s,i)=>{ const b=document.createElement("button"); b.type="button"; b.textContent=i+1; b.title=s.title; b.setAttribute("aria-label",`${i+1}. ${s.title}`);
      b.addEventListener("click",()=>play(i)); dotsEl.appendChild(b); });
  }
  async function play(i){
    cameFrom=opened?STEPS[current].scene:null;
    current=(i+STEPS.length)%STEPS.length; token++;
    STEP=STEPS[current];
    if(embedded) parent.postMessage({type:"explainer:scene", index:current}, location.origin);
    const spun=SPIN.rate>0; SPIN.rate=0;
    tweens=[]; hills=[]; meshes=[]; MESH.a=0; MESH.top=99; PULSE.a=0; WORLD=1; growing=false; tracked=[]; drawers=[]; flow=null; fx.innerHTML=""; marks.innerHTML=""; show(mock,false); unchoose();
    lineEl.textContent=""; noteEl.textContent="";
    stepEl.textContent=STEP.title;
    document.dispatchEvent(new CustomEvent("scenes:step",{detail:{index:current,total:STEPS.length,title:STEP.title}}));
    for(const [j,b] of [...dotsEl.children].entries()) b.setAttribute("aria-current", j===current?"true":"false");
    const running=SCENES[STEP.scene].run();
    // leaving a turning camera: cut to the new step's view rather than swinging back round (its view is set by now)
    if(spun){ Object.assign(cam,{theta:goal.theta,phi:goal.phi,zoom:goal.zoom,center:[...goal.center]}); }
    if(!opened){ opened=true; Object.assign(cam,{theta:goal.theta,phi:goal.phi,zoom:goal.zoom,center:[...goal.center]}); }   // the first step shown starts in place
    // a scene plays once and holds its last frame; Replay (or the step's dot) plays it again
    try{ await running; }catch(err){ console.error(err); }
  }
  document.getElementById("prev").addEventListener("click",()=>play(current-1));
  document.getElementById("next").addEventListener("click",()=>play(current+1));
  document.getElementById("replay").addEventListener("click",()=>play(current));
  addEventListener("keydown",e=>{ if(e.key==="ArrowRight") play(current+1); else if(e.key==="ArrowLeft") play(current-1); });
  // the pop-up on the map drives the player: it picks a step and forwards the arrow keys
  addEventListener("message",e=>{
    if(e.origin!==location.origin || e.source!==parent || !e.data) return;
    if(e.data.type==="explainer:play") play(Number(e.data.index)||0);
    else if(e.data.type==="explainer:theme") setTheme(!!e.data.light);
    else if(e.data.type==="explainer:key") play(current+(e.data.key==="ArrowRight"?1:-1));
  });
  const start=Number(params.get("scene"));
  // The welcome page's walkthrough (welcome/welcome.js) holds the first scene until its own landscape has handed
  // over to this one, then drives the player through window.PathwaysScenes and listens for "scenes:step".
  const hold=window.PathwaysScenesHold===true;
  let loaded;
  // camera: where the player's camera is right now (a copy), so the welcome page's landscape can move with it;
  // opening: where it starts, so the welcome page can land its own camera there first.
  window.PathwaysScenes={ play:(i)=>play(i), get index(){ return current; }, get total(){ return STEPS.length; },
    get camera(){ return {theta:cam.theta, phi:cam.phi, zoom:cam.zoom, center:[...cam.center]}; },
    opening:{...OPENING, center:[...OPENING.center]}, ready:new Promise(r=>{ loaded=r; }) };
  // ---------- render loop ----------
  function resize(){ const d=Math.min(devicePixelRatio||1,2); canvas.width=canvas.clientWidth*d; canvas.height=canvas.clientHeight*d; }
  addEventListener("resize",resize); resize();
  let painted=false, placeFailed=false;
  let lastFrame=0;
  function frame(now){
    const lifted=stepFlow(now), moved=stepTweens(now)||lifted, dt=Math.min(.1,Math.max(0,(now-lastFrame)/1000)); lastFrame=now;
    if(SPIN.rate && !reduceMotion){ goal.theta+=SPIN.rate*dt; cam.theta+=SPIN.rate*dt; }
    if(!canvas.clientWidth || !canvas.clientHeight){ requestAnimationFrame(frame); return; }   // hidden (a locked section is showing): nothing to draw
    if(canvas.width!==Math.round(canvas.clientWidth*Math.min(devicePixelRatio||1,2))) resize();
    const w=growing?worldAt(cam.zoom):1, grew=Math.abs(w-WORLD)>1e-4; if(grew) WORLD=w;
    if(moved || grew || !painted){ paint(); painted=true; }
    updateCamera();
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(FLOOR_RGB[0]/255,FLOOR_RGB[1]/255,FLOOR_RGB[2]/255,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(U.uProjView,false,projView);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,mapTex); gl.uniform1i(U.uMap,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,rampTex); gl.uniform1i(U.uRamp,1);
    gl.uniform1f(U.uAmp,AMP); gl.uniform1f(U.uScale,WORLD); gl.uniform4f(U.uPulse,PULSE.x,PULSE.z,PULSE.r,PULSE.a); gl.uniform1f(U.uTexel,1/HM); gl.uniform3f(U.uInk,INK_GL,INK_GL,INK_GL); gl.uniform3fv(U.uPeak,PEAK_GL);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,flowTex); gl.uniform1i(U.uFlow,2);
    const flowing=!!flow && flow.t<flow.end;
    gl.uniform1i(U.uFlowN,flowing?flow.hills.length:0);
    if(flowing){
      flow.hills.forEach((t,i)=>flow.centres.set([t.x,t.z,heightAt(t.x,t.z)],i*3));
      gl.uniform1f(U.uFlowT,flow.t); gl.uniform3fv(U.uFlowC,flow.centres); gl.uniform2fv(U.uFlowD,flow.dirs);
    }
    gl.drawElements(gl.TRIANGLES,idx.length,gl.UNSIGNED_INT,0);
    if(meshes.length && MESH.a>0.002){
      // the light mesh, a hair above the terrain: first its depth alone, so only its nearest surface draws (no lines from
      // its far side), then its lines blended over whatever it covers
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,meshTex);
      gl.uniform1i(U.uFlowN,0); gl.uniform1f(U.uMesh,MESH.a); gl.uniform1f(U.uLift,0.01); gl.uniform1f(U.uMeshTop,MESH.top);
      gl.colorMask(false,false,false,false); gl.drawElements(gl.TRIANGLES,idx.length,gl.UNSIGNED_INT,0);
      gl.colorMask(true,true,true,true); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES,idx.length,gl.UNSIGNED_INT,0);
      gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); gl.depthMask(true);
    }
    gl.uniform1f(U.uMesh,0); gl.uniform1f(U.uLift,0);
    try{ place(); }catch(err){ if(!placeFailed){ placeFailed=true; console.error("explainer overlay:", err); } }   // an overlay's fault mustn't stop the scene
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  fetch("data/explainer").then(r=>r.ok?r.json():Promise.reject(r.status)).then(c=>{
    const sec=(c.sections||[]).find(s=>s.status==="available" && s.steps);
    if(sec) STEPS=sec.steps.filter(s=>SCENES[s.scene]);
  }).catch(e=>console.warn("explainer.json not read; captions are empty",e)).finally(()=>{
    buildDots(); loaded();
    if(!hold) play(Number.isInteger(start)&&start>0 ? start-1 : 0);
  });
})();
