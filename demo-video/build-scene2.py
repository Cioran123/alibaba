"""Compose scene2.html: the real Mobilerun Task runner page (saved DOM) + the animated phone screens from scene.html
placed exactly over the device stream, new task rows in Recent runs, a camera, and captions."""
import re

snap = open("mr-snapshot.html").read()
scene = open("scene.html").read()

# ── phone CSS from scene.html, scoped under #mrPhone ──
css = re.search(r"<style>(.*?)</style>", scene, re.S).group(1)
scoped = []
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
    sel, body = m.group(1).strip(), m.group(2)
    if sel.startswith((":root", "html", "body", "*")) or sel.startswith("/*"):
        sel = re.sub(r"/\*.*?\*/", "", sel, flags=re.S).strip()
        if not sel or sel.startswith((":root", "html", "body", "*")):
            continue
    sel = re.sub(r"/\*.*?\*/", "", sel, flags=re.S).strip()
    scoped.append(",".join("#mrPhone " + s.strip() for s in sel.split(",")) + "{" + body + "}")
phone_css = "\n".join(scoped)
root_vars = re.search(r":root\{([^}]*)\}", css).group(1)

# ── phone DOM ──
start = scene.index('<div id="screen">') + len('<div id="screen">')
end = scene.index('<div class="touch" id="touch"></div>') + len('<div class="touch" id="touch"></div>')
phone_dom = scene[start:end].replace('<div class="island"></div>', "")

# ── phone JS (screens/touch/phoneDetails) from scene.html ──
js = re.search(r"<script>(.*?)</script>", scene, re.S).group(1)
helpers = js[: js.index("const T_END")]
phone_fns = js[js.index("// ── phone screens"): js.index("// ── scrolling lists")]
scroll_fn = js[js.index("function scrollFor"): js.index("function agents")]
details_fn = js[js.index("function phoneDetails"): js.index("// ── task panel ──")]
phone_fns = phone_fns.replace('["s_inq", 34.4, 47]', '["s_inq", 34.4, 50]')

# ── strip old Recent runs rows except real completed ones ──
def keep_completed(m):
    ul = m.group(0)
    lis = re.findall(r"<li>.*?</li>", ul, re.S)
    kept = [li for li in lis if 'aria-label="Completed"' in li]
    return '<ul class="flex flex-col gap-0.5 pr-1" id="runsList">' + "".join(kept) + "</ul>"
snap = re.sub(r'<ul class="flex flex-col gap-0\.5 pr-1">.*?</ul>', keep_completed, snap, count=1, flags=re.S)
# wechat-iphone chip "in use" → Ready (current state of the fleet in the demo)
snap = snap.replace('<span class="absolute inline-flex h-full w-full rounded-full bg-warning opacity-75 animate-ping"></span><span class="relative inline-flex rounded-full bg-warning size-2"></span></span><span class="text-warning">in use</span>',
                    '<span class="relative inline-flex rounded-full bg-success size-2"></span></span><span>Ready</span>', 1)

inject_css = """
<style id="demoCss">
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent}
html,body{width:1920px;height:1080px;overflow:hidden!important}
body{transform-origin:0 0}
#mrPhone{position:absolute;left:1386.36px;top:324.01px;width:243.77px;height:545.98px;overflow:hidden;z-index:40;background:#fff;border-radius:31.4px;-webkit-mask-image:-webkit-radial-gradient(white,black);isolation:isolate}
#mrPhone #screen{font-family:-apple-system,"SF Pro Text","Helvetica Neue",Arial,sans-serif;font-size:16px;line-height:normal;letter-spacing:0;color:#17181A;-webkit-font-smoothing:antialiased;text-align:left;position:absolute;left:0;top:0;width:376px;height:846px;transform:scale(0.64832,0.64536);transform-origin:0 0;overflow:hidden;background:#fff}
#mrPhone .scr{height:846px}
#mrPhone #chatBody{height:676px}
#mrPhone{""" + root_vars + """}
""" + phone_css + """
#mrPhone #screen{left:0!important;top:0!important;height:846px!important;border-radius:0!important}
#mrPhone .scr{height:846px!important}
#mrPhone #chatBody{height:676px!important}
#demoCap{position:absolute;left:50%;top:996px;transform:translateX(-50%);z-index:100;display:flex;align-items:center;gap:12px;
  background:rgba(255,255,255,.96);border:1px solid rgba(0,0,0,.08);box-shadow:0 12px 32px -12px rgba(0,0,0,.25);border-radius:999px;padding:13px 24px 13px 14px;
  font-family:diatypeSans,-apple-system,Helvetica,sans-serif;font-size:21px;color:#17181A;white-space:nowrap}
#demoCap .k{font-size:13px;font-weight:600;letter-spacing:.6px;color:#fff;background:#2B44E6;border-radius:999px;padding:5px 11px;text-transform:uppercase}
#demoTag{position:absolute;right:22px;bottom:14px;z-index:100;font:12px "SF Mono",Menlo,monospace;color:rgba(0,0,0,.38)}
</style>"""

inject_js = r"""
<script>
""" + helpers + phone_fns + """
let chatItems, chatBottoms;
function measure(){
  chatItems=[...document.querySelectorAll("#chatInner > [data-t]")].map(el=>({el,t:+el.dataset.t,ty:el.dataset.ty?+el.dataset.ty:null}));
  chatBottoms=chatItems.map(({el})=>el.offsetTop+el.offsetHeight+10);
}
""" + scroll_fn + details_fn + r"""
// ── map video time → phone (scene.html) time ──
function oldT(t){
  if(t<4.5) return 12.0;
  if(t<36.4) return t+7.9;
  if(t<39) return 44.3+(t-36.4)*(50-44.3)/(39-36.4);
  return t+11;
}
// ── camera: full page ↔ phone ──
const FULL=[1,960,540], ZOOM=[1.85,1415,598];
const CAM=[];
function camera(t){
  let s=FULL; let out=FULL;
  for(const [a,dir] of CAM){ const tg=dir==="in"?ZOOM:FULL; if(t<a) break; const kk=p(t,a,a+1.5); out=[0,1,2].map(i=>s[i]+(tg[i]-s[i])*kk); s=kk>=1?tg:out; }
  const [sc,cx,cy]=out;
  document.body.style.transform=`translate(${960-cx*sc}px,${540-cy*sc}px) scale(${sc})`;
}
// ── recent runs ──
const RUNS=[
 {a:3.6,d:20.1,txt:"Find a verified manufacturer on Alibaba for a 60 GHz mmWave fall-detection radar module (500 pcs). Compare listings, open the best match and return supplier, price tiers and MOQ."},
 {a:22.0,d:32.7,txt:"Send our RFQ to Shenzhen Lumisense Technology Co., Ltd. from our Alibaba account (message on clipboard). Verify “sent successfully”."},
 {a:38.6,d:46.6,txt:"Open Alibaba Messenger and read new supplier replies, including quotation cards. Do not send anything."},
 {a:51.0,d:55.6,txt:"Reply to Cindy (Lumisense) in the same thread: counter $10.50 for 1,000 pcs, ask for 3 refundable samples and the CE/FCC reports."},
 {a:64.6,d:67.9,txt:"Confirm the 3-sample order with Cindy (Lumisense) in the same thread — founder approved, payment via Trade Assurance."},
];
const SPIN='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle size-3.5 shrink-0 text-warning" aria-label="Running"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>';
const DONE='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check size-3.5 shrink-0 text-success" aria-label="Completed"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
let rowTpl=null, runsKey="";
function runs(t){
  const list=document.getElementById("runsList");
  if(!rowTpl){ rowTpl=list.querySelector("li").cloneNode(true); window.__oldRows=[...list.children]; }
  const visible=RUNS.filter(r=>t>=r.a);
  const key=visible.map(r=>(t>=r.d?"d":"r")+(t>36?"L":"E")).join("");
  if(key!==runsKey){
    [...list.querySelectorAll("li[data-demo]")].forEach(n=>n.remove());
    visible.slice().reverse().forEach((r,i)=>{
      const li=rowTpl.cloneNode(true); li.dataset.demo=RUNS.indexOf(r);
      const btn=li.querySelector("button");
      btn.querySelector("svg").outerHTML=t>=r.d?DONE:SPIN;
      const spans=btn.querySelectorAll("span");
      spans[0].textContent=r.txt; spans[1].textContent="· alibaba-android";
      const idx=RUNS.indexOf(r);
      spans[2].textContent = t<r.d ? "just now" : (t>36 && idx<2 ? "3 hours ago" : (t-r.d>12 ? "2 minutes ago" : "1 minute ago"));
      list.insertBefore(li,list.firstChild);
    });
    // older real rows read as earlier in the day
    runsKey=key;
  }
  // slide-in of newest row + spinner rotation
  const newest=visible[visible.length-1];
  list.querySelectorAll("li[data-demo]").forEach(li=>{
    const r=RUNS[+li.dataset.demo]; const o=pe(t,r.a,r.a+.45);
    li.style.opacity=o; li.style.transform=`translateY(${(1-o)*-8}px)`;
    const sp=li.querySelector('[aria-label="Running"]'); if(sp) sp.style.transform=`rotate(${(t*400)%360}deg)`;
    li.firstElementChild.style.background = (r===newest && t<r.d) ? "rgba(43,68,230,.06)" : "";
  });
  // alibaba-android chip: in use while a run is active
  const active=RUNS.some(r=>t>=r.a&&t<r.d);
  const chip=[...document.querySelectorAll('[role="radio"]')].find(e=>e.textContent.includes("alibaba-andr"));
  if(chip){ const st=[...chip.querySelectorAll("span,div")].find(e=>e.children.length===0&&/^(Ready|in use)$/.test(e.textContent.trim()));
    if(st){ st.textContent=active?"in use":"Ready"; st.style.color=active?"var(--color-warning, #C27803)":""; const dot=st.previousElementSibling; if(dot) dot.style.filter=active?"hue-rotate(-80deg) saturate(1.6)":""; } }
}
// ── captions ──
const CAPS=[
 [0.4,3.7,"Request","Founder → Naïve: “Source 500 × 60 GHz fall-detection radar modules, CE/FCC, ≤ $12.50”"],
 [4.4,20.0,"Scout agent","Searches Alibaba on a real cloud phone and compares listings"],
 [20.4,26.0,"Scout agent","Best match: Shenzhen Lumisense · Verified · 9 yrs · 4.9★"],
 [26.2,33.4,"Envoy agent","Sends the RFQ from the company’s own Alibaba account"],
 [34.0,38.6,"3 hours later","The inbox sweep spots a reply from Lumisense"],
 [39.2,46.8,"Envoy agent","Reads the seller’s quote straight off the phone"],
 [47.2,51.4,"Envoy agent","record_quote ✓ · propose_offer $10.50 × 1k → within authority ✓"],
 [51.8,58.8,"Envoy agent","Counters in the same thread — seller comes back at $10.70 + CE/FCC reports"],
 [59.4,64.6,"Founder","Gets one decision memo in Naïve and clicks Proceed"],
 [65.0,69.8,"Envoy agent","Confirms the 3-sample order — payment only via Trade Assurance"],
 [70.4,75.5,"Result","1 request · 1 approval · 5 phone tasks · 0 human taps"],
];
function captions(t){
  const el=document.getElementById("demoCap"); const c=CAPS.find(([a,b])=>t>=a&&t<b);
  if(!c){el.style.opacity=0;return;}
  el.querySelector(".k").textContent=c[2]; el.querySelector(".v").textContent=c[3];
  const o=win(t,c[0],c[1],.35); el.style.opacity=o; el.style.transform=`translateX(-50%) translateY(${(1-pe(t,c[0],c[0]+.35))*10}px)`;
}
window.T_END=75.5;
window.renderAt=function(t){ const o=oldT(t); screens(o); touch(o); phoneDetails(o); runs(t); camera(t); captions(t); };
document.fonts.ready.then(()=>{ ["demoCap","demoTag"].forEach(id=>document.documentElement.appendChild(document.getElementById(id))); measure(); renderAt(0); window.__ready=true;
  const q=new URLSearchParams(location.search); if(q.has("t")) renderAt(+q.get("t"));
  else if(q.has("play")){ const s=performance.now(); (function loop(){ renderAt(((performance.now()-s)/1000)%(T_END+1)); requestAnimationFrame(loop); })(); } });
</script>"""

overlay_dom = '<div id="mrPhone"><div id="screen">' + phone_dom + "</div></div>"
html_overlays = '<div id="demoCap"><span class="k"></span><span class="v"></span></div><div id="demoTag">simulated walkthrough · ideal flow</div>'

snap = snap.replace("</head>", inject_css + "</head>", 1)
snap = snap.replace("</body>", overlay_dom + "</body>" + html_overlays + inject_js, 1)
open("scene2.html", "w").write(snap)
print("ok", len(snap))
