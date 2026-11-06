(() => {
  "use strict";
  const canvas=document.getElementById("gl");
  const gl=canvas.getContext("webgl2",{antialias:true,alpha:false});
  if(!gl){ document.getElementById("line").textContent="This needs WebGL2."; return; }
  const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- the map's constants ----------
  const SPAN=10, HALF=5, FLOOR=600, AMP=2.6, HM=256, SEG=200, R=12, P=4;
  const GOANDCO=["#003830","#055257","#0b6d80","#2c8581","#3f9e7e","#4cb87b","#7ad07d","#a6e780","#cef585","#f2f48e"];

  // ---------- the map's shader, without the brand, sweep and intro passes ----------
  const VERT=`#version 300 es
  precision highp float;
  in vec2 aPos; in vec2 aUv;
  uniform mat4 uProjView; uniform sampler2D uMap; uniform float uAmp;
  out float vH; out vec2 vUv; out vec3 vWorld;
  void main(){
    float mask=1.0-smoothstep(4.5,5.0,max(abs(aPos.x),abs(aPos.y)));
    float h=texture(uMap,aUv).r*uAmp*mask;
    vec3 world=vec3(aPos.x,h,aPos.y);
    vH=h/uAmp; vUv=aUv; vWorld=world;
    gl_Position=uProjView*vec4(world,1.0);
  }`;
  const FRAG=`#version 300 es
  precision highp float;
  in float vH; in vec2 vUv; in vec3 vWorld;
  uniform sampler2D uMap; uniform sampler2D uRamp; uniform float uAmp; uniform float uTexel; uniform vec3 uInk;
  out vec4 frag;
  const float LINE_ALPHA=0.2;
  float contour(float w){ return 1.0-min(abs(fract(w-0.5)-0.5)/max(fwidth(w),1e-5)*1.25,1.0); }
  vec3 ramp(float t){ return texture(uRamp,vec2(clamp(t,0.0,1.0),0.5)).rgb; }
  void main(){
    vec3 col=ramp(clamp(vH,0.0,1.0));
    float tx=uTexel;
    float hl=texture(uMap,vUv-vec2(tx,0.0)).r, hr=texture(uMap,vUv+vec2(tx,0.0)).r;
    float hd=texture(uMap,vUv-vec2(0.0,tx)).r, hu=texture(uMap,vUv+vec2(0.0,tx)).r;
    vec3 n=normalize(vec3((hl-hr)*uAmp,tx*6.0,(hd-hu)*uAmp));
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
    frag=vec4(col,1.0);
  }`;
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog=gl.createProgram();
  gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));
  gl.bindAttribLocation(prog,0,"aPos"); gl.bindAttribLocation(prog,1,"aUv"); gl.linkProgram(prog);
  const U={}; for(const n of ["uProjView","uMap","uRamp","uAmp","uTexel","uInk"]) U[n]=gl.getUniformLocation(prog,n);

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
  let INK="#fff", INK_GL=1, FLOOR_RGB=[0,56,48];
  function setTheme(light){
    const stops=(light?LAGOON:GOANDCO).map(h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)));
    const W=256, d=new Uint8Array(W*4);
    for(let i=0;i<W;i++){ const f=i/(W-1)*(stops.length-1), a=Math.floor(f), b=Math.min(a+1,stops.length-1), u=f-a;
      for(let c=0;c<3;c++) d[i*4+c]=Math.round(stops[a][c]*(1-u)+stops[b][c]*u); d[i*4+3]=255; }
    gl.bindTexture(gl.TEXTURE_2D,rampTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,W,1,0,gl.RGBA,gl.UNSIGNED_BYTE,d);
    FLOOR_RGB=stops[0]; INK=light?"#000":"#fff"; INK_GL=light?0:1;
    const root=document.documentElement;
    root.style.setProperty("--ground",`rgb(${FLOOR_RGB})`);
    root.style.setProperty("--accent",INK);
    root.style.setProperty("--on-accent",light?"#fff":"#000");
    root.toggleAttribute("data-light",light);
  }
  // the theme: what the map says (the pop-up tells us), else the map's remembered scale in this browser
  const LIGHT_RAMPS=new Set(["ember","orchid","lemon","dusk","lagoon"]);
  const qs=new URLSearchParams(location.search);
  setTheme(qs.has("light") ? qs.get("light")==="1" : (()=>{ try{ return LIGHT_RAMPS.has(localStorage.getItem("ramp-default")); }catch(e){ return false; } })());
  const mapTex=tex(), hm=new Float32Array(HM*HM);

  // ---------- hills: made-up peaks, painted the map's way (super-gaussian, soft max so neighbours merge) ----------
  let hills=[];
  const hill=(o)=>{ const h={x:0,z:0,h:0,s:0.4,...o}; hills.push(h); return h; };
  function paint(){
    hm.fill(0);
    const k=HM/SPAN;
    for(const t of hills){
      if(t.h<=0.001) continue;
      const cx=(t.x+HALF)*k, cy=(t.z+HALF)*k, sig=t.s*0.95*1.2*k, inv=1/(2*sig*sig), Rr=Math.ceil(sig*2.6);
      const x0=Math.max(0,Math.floor(cx-Rr)), x1=Math.min(HM-1,Math.ceil(cx+Rr)), y0=Math.max(0,Math.floor(cy-Rr)), y1=Math.min(HM-1,Math.ceil(cy+Rr));
      for(let y=y0;y<=y1;y++){ const dy=y-cy, row=y*HM;
        for(let x=x0;x<=x1;x++){ const dx=x-cx, g=t.h*Math.exp(-Math.pow((dx*dx+dy*dy)*inv,1.5)); hm[row+x]+=g*g*g*g; } }
    }
    const F=6;
    for(let y=0;y<HM;y++) for(let x=0;x<HM;x++){ const i=y*HM+x; hm[i]=(x<F||y<F||x>=HM-F||y>=HM-F)?0:Math.pow(hm[i],1/P); }
    gl.bindTexture(gl.TEXTURE_2D,mapTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,HM,HM,0,gl.RED,gl.FLOAT,hm);
  }
  const heightAt=(x,z)=>{ const i=Math.round((z+HALF)/SPAN*HM)*HM+Math.round((x+HALF)/SPAN*HM); return (hm[i]||0)*AMP; };

  // ---------- the map's camera: orthographic, orbiting a centre ----------
  const cam={theta:0.7,phi:Math.PI*0.28,zoom:1.4,center:[0,0.4,0]}, goal={...cam,center:[...cam.center]};
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

  // ---------- overlays that follow the terrain ----------
  const fx=document.getElementById("fx"), marks=document.getElementById("marks");
  let tracked=[], drawers=[];
  const el=(cls,html)=>{ const e=document.createElement("div"); e.className=cls; if(html!=null) e.innerHTML=html; fx.appendChild(e); return e; };
  const top=(t)=>[t.x, heightAt(t.x,t.z), t.z];
  function label(at, text, cls=""){                    // at: a hill, or a function giving a world point
    const e=el("label hidden "+cls, `<span class="txt"></span><span class="dot"></span>`);
    e.querySelector(".txt").textContent=text;
    tracked.push({e, at:typeof at==="function"?at:()=>top(at)});
    return e;
  }
  function tag(at, text, note){                      // text only: the wording comes from explainer.json
    const e=el("tag hidden"); e.textContent=text;
    if(note!=null){ const n=document.createElement("small"); n.textContent=note; e.appendChild(n); }
    tracked.push({e,at}); return e;
  }
  const DOC_ICON=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;
  function hub(at){ const e=el("hub hidden",DOC_ICON); tracked.push({e,at,raw:true}); return e; }
  const show=(e,on=true)=>e.classList.toggle("hidden",!on);
  function place(){
    for(const k of tracked){
      const [x,y]=project(k.at());
      k.e.style.transform = k.raw ? `translate(${x}px,${y}px)` : (k.e.classList.contains("tag") ? `translate(${x}px,${y}px) translate(-50%,-50%)` : `translate(${x}px,${y}px) translate(-50%,-100%)`);
    }
    marks.innerHTML=drawers.map(d=>d()).join("");
  }
  const P2=(v)=>project(v).map(n=>n.toFixed(1)).join(",");
  const line=(a,b,o={})=>`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${INK}" stroke-width="${o.w||1.6}" stroke-opacity="${o.op??0.9}" ${o.dash?`stroke-dasharray="${o.dash}"`:""} stroke-linecap="round"/>`;
  const lerp3=(a,b,u)=>a.map((v,i)=>v+(b[i]-v)*u);

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
  async function say(i){
    const text=(STEP.lines||[])[i]||"";
    if(lineEl.textContent){ lineEl.classList.add("out"); await wait(320); }
    lineEl.textContent=text; noteEl.textContent=i===0?(STEP.note||""):""; lineEl.classList.remove("out");
  }
  const mock=document.getElementById("mock");
  const setLevel=(l)=>{ for(const t of mock.querySelectorAll(".tab")) t.setAttribute("aria-selected", t.dataset.l===l?"true":"false"); };

  // ---------- the seven scenes (the explainer canvas boards) ----------
  const view=(o)=>{ Object.assign(goal,o); if(o.center) goal.center=[...o.center]; };
  const TILT=Math.PI*0.28;
  const SCENES={
    why:{ title:"Why a landscape", async run(){
        view({theta:0.7,phi:TILT,zoom:1.15,center:[0,0.3,0]});
        const r=screenRight(), hs=[.95,.8,.66,.52,.4];
        const H=hs.map((h,i)=>hill({x:r[0]*(i-2)*1.9, z:r[2]*(i-2)*1.9, h:0, s:.4}));
        await say(0);
        H.forEach((t,i)=>setTimeout(()=>to(t,{h:hs[i]},900),i*120)); await wait(2600);
        await say(1);
        const goals=[[-2.3,-0.5],[-1.3,0.45],[1.6,-1.2],[2.5,-0.2],[1.7,1.0]];
        await Promise.all(H.map((t,i)=>to(t,{x:goals[i][0],z:goals[i][1]},1800)));
        const n1=tag(()=>[-1.8,heightAt(-2.3,-0.5)+0.6,0],M("neighbours","Neighbours")), n2=tag(()=>[1.95,heightAt(1.6,-1.2)+0.6,-0.1],M("neighbours","Neighbours"));
        const gap=tag(()=>[-0.1,0,0.1],M("gap","Gap"));
        drawers.push(()=>{ if(gap.classList.contains("hidden")) return ""; let pts=[]; for(let a=0;a<=48;a++){ const q=a/48*Math.PI*2; pts.push(P2([-0.1+Math.cos(q)*0.9,0,0.1+Math.sin(q)*0.9])); }
          return `<polyline points="${pts.join(" ")}" fill="none" stroke="${INK}" stroke-opacity=".7" stroke-width="1.4" stroke-dasharray="4 5"/>`; });
        show(n1); await wait(250); show(n2); await wait(400); show(gap);
        await wait(4200);
    }},
    hill:{ title:"What's a hill", async run(){
        view({theta:0.7,phi:TILT,zoom:1.7,center:[0,0.6,0]});
        const t=hill({x:0,z:0,h:0,s:.55});
        await say(0);
        await to(t,{h:.9},1400);
        const r=screenRight(), m={h:0,w:0}, rad=1.35;
        const base=[r[0]*rad*1.25,0,r[2]*rad*1.25];
        drawers.push(()=>{ let s="";
          const pk=top(t), b=project(base), tp=project([base[0],pk[1],base[2]]);
          if(m.h>0){ s+=line(project(pk),tp,{op:.35,dash:"3 4",w:1}); s+=line(b,[b[0]+(tp[0]-b[0])*m.h, b[1]+(tp[1]-b[1])*m.h],{w:2}); }
          if(m.w>0){ const a=project([-r[0]*rad,0,-r[2]*rad]), c=project([r[0]*rad,0,r[2]*rad]), mid=[(a[0]+c[0])/2,(a[1]+c[1])/2];
            const off=26, A=[mid[0]+(a[0]-mid[0])*m.w, mid[1]+(a[1]-mid[1])*m.w+off], C=[mid[0]+(c[0]-mid[0])*m.w, mid[1]+(c[1]-mid[1])*m.w+off];
            s+=line(A,C,{w:2}); s+=line(a,[a[0],a[1]+off+6],{op:.35,dash:"3 4",w:1})+line(c,[c[0],c[1]+off+6],{op:.35,dash:"3 4",w:1}); }
          return s; });
        const hl=tag(()=>[base[0],heightAt(0,0)*0.55,base[2]],M("height","Height"),M("heightNote","more evidence")); hl.style.marginLeft="58px";
        await to(m,{h:1},900); show(hl); await wait(900);
        const wl=tag(()=>[0,0,0],M("width","Width"),M("widthNote","more evidence, gently")); wl.style.marginTop="70px";
        await to(m,{w:1},900); show(wl); await wait(1100);
        const flat=hill({x:-r[0]*3.2+1.0, z:-r[2]*3.2+1.6, h:0, s:.3});
        const fl=label(()=>[flat.x,0,flat.z],M("flat","no evidence yet"),"small"); show(fl);
        await wait(4200);
    }},
    proximity:{ title:"Positioning", async run(){
        view({theta:0.7,phi:TILT,zoom:1.35,center:[0,0.5,0]});
        const a=hill({x:-0.5,z:0,h:0,s:.45}), b=hill({x:3.6,z:0.6,h:0,s:.4}), c=hill({x:-3.4,z:-1.2,h:0,s:.34});
        await say(0);
        await to(a,{h:.85},1100);
        await to(b,{h:.68},800); await wait(300);
        await to(b,{x:0.55,z:0.25},1800);
        const rel=tag(()=>[0.02,heightAt(a.x,a.z)+0.55,0.1],M("related","Related")); show(rel);
        drawers.push(()=>{ if(rel.classList.contains("hidden")) return ""; const p=project(top(a)), q=project(top(b)), mx=(p[0]+q[0])/2, my=Math.min(p[1],q[1])-34;
          return `<path d="M${p[0]} ${p[1]-14} Q${mx} ${my} ${q[0]} ${q[1]-14}" fill="none" stroke="${INK}" stroke-opacity=".75" stroke-width="1.4" stroke-dasharray="4 5"/>`; });
        await wait(1500);
        await say(1);
        await to(c,{h:.55},1000);
        const ap=tag(()=>[-2.0,0,-0.6],M("apart","Apart")); ap.style.marginTop="18px";
        drawers.push(()=>{ if(ap.classList.contains("hidden")) return ""; return line(project([-3.0,0,-1.05]),project([-1.1,0,-0.25]),{w:1.6,op:.8,dash:"2 5"}); });
        show(ap);
        await wait(4200);
    }},
    levels:{ title:"Two views", async run(){
        view({theta:0.7,phi:TILT,zoom:1.7,center:[0,0.5,0]});
        show(mock); setLevel("industries");
        const ind=hill({x:0,z:0,h:0,s:.62});
        const mk=[hill({x:-0.6,z:0.35,h:0,s:.3}),hill({x:0.2,z:-0.45,h:0,s:.3}),hill({x:0.7,z:0.45,h:0,s:.28})], mh=[.5,.62,.42];
        await say(0);
        await to(ind,{h:.9},1200);
        const il=label(ind,M("industry","Industry")); show(il);
        await wait(1800);
        setLevel("markets"); await say(1);
        show(il,false);
        await Promise.all([to(ind,{h:0},1100), ...mk.map((t,i)=>to(t,{h:mh[i]},1300))]);
        const loz=label(()=>[0.05,heightAt(0.2,-0.45)+0.75,-0.05],M("industry","Industry"),"lozenge"); show(loz);
        const ml=mk.map(t=>label(t,M("market","Market"),"small")); for(const e of ml){ show(e); await wait(160); }
        await wait(2600);
        setLevel("industries"); for(const e of [...ml,loz]) show(e,false);
        await Promise.all([to(ind,{h:.9},1100), ...mk.map(t=>to(t,{h:0},900))]);
        show(il); await wait(1600);
    }},
    height:{ title:"How height is made", async run(){
        view({theta:0.7,phi:TILT,zoom:1.45,center:[0.4,0.5,0]});
        const t=hill({x:1.0,z:0.2,h:0.02,s:.34});
        const dA=[-2.4,0,-1.2], dB=[-2.2,0,1.4];
        const hA=hub(()=>dA), hB=hub(()=>dB);
        const arcs={a:0,b:0};
        drawers.push(()=>{ let s=""; const pk=project(top(t));
          if(arcs.a>0) s+=line(project(dA),pk,{w:2.4,op:.55*arcs.a}); if(arcs.b>0) s+=line(project(dB),pk,{w:2.4,op:.55*arcs.b}); return s; });
        await say(0);
        show(hA); await to(arcs,{a:1},500);
        const lift=[[.36,.40],[.55,.47],[.66,.51],[.71,.53]];
        const ex=tag(()=>lerp3(dA,top(t),.5),M("excerpt","Excerpt")); ex.style.marginTop="-18px";
        for(let i=0;i<lift.length;i++){
          if(i===1) say(1);
          await spark(dA,t,i===0?ex:null);
          await to(t,{h:lift[i][0],s:lift[i][1]},600);
          await wait(250);
        }
        show(ex,false); await wait(700);
        await say(2);
        show(hB); await to(arcs,{b:1},500);
        await spark(dB,t); await to(t,{h:.95,s:.62},900);
        await wait(4000);
    }},
    basemap:{ title:"The base map", async run(){
        view({theta:0.7,phi:0.02,zoom:1.15,center:[0,0,0]});
        await say(0);
        const sectors=[[-2.4,-1.4],[0.4,-2.0],[2.6,-0.6],[-1.8,1.6],[1.2,1.6]];
        const L=[];
        for(const [x,z] of sectors){ const e=label(()=>[x,heightAt(x,z-0.95),z-0.95],M("sector","Sector"),"lozenge"); L.push(e); show(e); await wait(140); }
        await wait(600);
        const inds=[];
        for(const [x,z] of sectors) for(const d of [[-0.35,0.05],[0.4,0.3]]){ const p=[x+d[0],z+d[1]]; inds.push(p);
          const e=label(()=>[p[0],0,p[1]],M("industry","Industry")); L.push(e); }
        for(const e of L.slice(sectors.length)){ show(e); await wait(70); }
        await wait(600);
        const mk=[];
        inds.forEach((p,i)=>{ for(let k=0;k<3;k++){ const a=k*2.1+i; const q=[p[0]+Math.cos(a)*0.32,p[1]+Math.sin(a)*0.32+0.25]; mk.push(label(()=>[q[0],heightAt(q[0],q[1]),q[1]],"","small")); } });
        for(const e of mk){ show(e); } await wait(1600);
        await say(1);
        view({phi:TILT,zoom:1.15,center:[0,0.4,0]});
        await wait(500);
        for(const e of L.slice(sectors.length)) show(e,false);
        const H=inds.map(([x,z])=>hill({x,z,h:0,s:.3}));
        H.forEach((t,i)=>setTimeout(()=>to(t,{h:.25+((i*37)%60)/100},1100),i*60));
        await wait(5200);
    }},
    emergent:{ title:"Established and emergent", async run(){
        view({theta:0.7,phi:TILT,zoom:1.4,center:[0,0.5,0]});
        const a=hill({x:-1.9,z:-0.2,h:0,s:.42}), b=hill({x:1.9,z:0.2,h:0,s:.4}), e=hill({x:0.15,z:1.5,h:0,s:.3});
        await say(0);
        await Promise.all([to(a,{h:.82},1100), to(b,{h:.7},1100)]);
        const la=label(a,M("established","Established")), lb=label(b,M("established","Established")); show(la); show(lb);
        await wait(1500);
        await say(1);
        const d1=[-0.9,0,3.4], d2=[1.3,0,3.5];
        const h1=hub(()=>d1), h2=hub(()=>d2); show(h1); await wait(200); show(h2);
        const arcs={v:0};
        drawers.push(()=> arcs.v>0 ? line(project(d1),project(top(e)),{w:2.4,op:.55*arcs.v})+line(project(d2),project(top(e)),{w:2.4,op:.55*arcs.v}) : "");
        await to(arcs,{v:1},500);
        await Promise.all([spark(d1,e),spark(d2,e)]);
        await to(e,{h:.55},1300);
        const le=label(e,M("emergent","Emergent"),"emergent"); show(le);
        await wait(4200);
    }},
  };
  // a bright dot that runs from a document to a peak
  function spark(from, t, follow){
    const s=el("spark"), m={u:0};
    tracked.push({e:s, at:()=>lerp3(from,top(t),m.u), raw:true});
    if(follow) show(follow);
    return to(m,{u:1},650).then(()=>{ s.remove(); tracked=tracked.filter(k=>k.e!==s); });
  }

  // ---------- player ----------
  const dotsEl=document.getElementById("dots");
  const params=new URLSearchParams(location.search), embedded=params.has("embed");
  if(embedded) document.body.classList.add("embed");
  let STEPS=Object.keys(SCENES).map(id=>({scene:id,title:SCENES[id].title,lines:[],marks:{}}));   // used only if explainer.json can't be read
  let current=0;
  function buildDots(){
    dotsEl.innerHTML="";
    STEPS.forEach((s,i)=>{ const b=document.createElement("button"); b.type="button"; b.textContent=i+1; b.title=s.title; b.setAttribute("aria-label",`${i+1}. ${s.title}`);
      b.addEventListener("click",()=>play(i)); dotsEl.appendChild(b); });
  }
  async function play(i){
    current=(i+STEPS.length)%STEPS.length; token++;
    STEP=STEPS[current];
    if(embedded) parent.postMessage({type:"explainer:scene", index:current}, location.origin);
    tweens=[]; hills=[]; tracked=[]; drawers=[]; fx.innerHTML=""; marks.innerHTML=""; show(mock,false);
    lineEl.textContent=""; noteEl.textContent="";
    stepEl.textContent=`${current+1} / ${STEPS.length} · ${STEP.title}`;
    for(const [j,b] of [...dotsEl.children].entries()) b.setAttribute("aria-current", j===current?"true":"false");
    const tk=token;
    try{ await SCENES[STEP.scene].run(); }catch(err){ console.error(err); }
    if(tk===token) play(current);                         // a scene loops until the viewer moves on
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
  // ---------- render loop ----------
  function resize(){ const d=Math.min(devicePixelRatio||1,2); canvas.width=canvas.clientWidth*d; canvas.height=canvas.clientHeight*d; }
  addEventListener("resize",resize); resize();
  let painted=false;
  function frame(now){
    const moved=stepTweens(now);
    if(!canvas.clientWidth || !canvas.clientHeight){ requestAnimationFrame(frame); return; }   // hidden (a locked section is showing): nothing to draw
    if(canvas.width!==Math.round(canvas.clientWidth*Math.min(devicePixelRatio||1,2))) resize();
    if(moved || !painted){ paint(); painted=true; }
    updateCamera();
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(FLOOR_RGB[0]/255,FLOOR_RGB[1]/255,FLOOR_RGB[2]/255,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(U.uProjView,false,projView);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,mapTex); gl.uniform1i(U.uMap,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,rampTex); gl.uniform1i(U.uRamp,1);
    gl.uniform1f(U.uAmp,AMP); gl.uniform1f(U.uTexel,1/HM); gl.uniform3f(U.uInk,INK_GL,INK_GL,INK_GL);
    gl.drawElements(gl.TRIANGLES,idx.length,gl.UNSIGNED_INT,0);
    place();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  fetch("data/explainer").then(r=>r.ok?r.json():Promise.reject(r.status)).then(c=>{
    const sec=(c.sections||[]).find(s=>s.status==="available" && s.steps);
    if(sec) STEPS=sec.steps.filter(s=>SCENES[s.scene]);
  }).catch(e=>console.warn("explainer.json not read; captions are empty",e)).finally(()=>{
    buildDots(); play(Number.isInteger(start)&&start>0 ? start-1 : 0);
  });
})();
