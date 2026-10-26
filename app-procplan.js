// ===========================================================================
// app-procplan.js — Procurement plan.
//
// Every package of the project (subcontracts, supply & install, equipment, materials) is
// listed from day one as a Package (tender record), with:
//   td.procType    "subcontract" | "supply_install" | "equipment" | "material" (missing = subcontract)
//   td.startOnSite the date it is needed on site ("Target start", typed or from a schedule task)
//   td.planLeads   {step: days} overrides of the lead times of its type (calendar days)
// From the need date, the plan works BACKWARD through the lead time of each step and gives
// the LATEST date of every milestone (start the tender documents, issue the tender, receive
// the bids, approval, contract, submittals, order, delivery). Each milestone is compared to
// what has already happened: the next milestone not reached yet and its days left make the
// status of the package (late / due soon / on track).
// Lead time templates per type: pp_durations.procTemplates (Settings › Durations).
// ===========================================================================

const PP_TYPES=[
  {k:"subcontract",label:"Subcontract"},
  {k:"supply_install",label:"Supply & install"},
  {k:"equipment",label:"Equipment"},
  {k:"material",label:"Material"}
];
// In chronological order. Each step ends on its milestone (ms); "start" comes before the first.
const PP_STEPS=[
  {k:"prep",label:"Tender documents",ms:"issue",msLabel:"Issue tender"},
  {k:"bidding",label:"Bidding period",ms:"bids",msLabel:"Bids in"},
  {k:"evaluation",label:"Evaluation & negotiation",ms:"recommend",msLabel:"Recommendation"},
  {k:"approval",label:"Approval (internal / ACC / Aconex)",ms:"approved",msLabel:"Approved"},
  {k:"contract",label:"Contract / PO signature",ms:"contract",msLabel:"Contract / PO"},
  {k:"submittals",label:"Shop drawings / MAR approval",ms:"submittals",msLabel:"Submittals OK"},
  {k:"fab",label:"Fabrication / manufacturing",ms:"ready",msLabel:"Ready to ship"},
  {k:"transport",label:"Transport & delivery",ms:"delivered",msLabel:"Delivered"},
  {k:"buffer",label:"Float before start on site",ms:"need",msLabel:"Start on site"}
];
const PP_MS_LABEL={start:"Start tender docs"};
PP_STEPS.forEach(function(s){PP_MS_LABEL[s.ms]=s.msLabel;});
// Calendar days. A subcontract has no fabrication of its own: its float covers mobilisation.
const PP_DEFAULT_TEMPLATES={
  subcontract:   {prep:14,bidding:21,evaluation:14,approval:21,contract:28,submittals:28,fab:0,  transport:0, buffer:14},
  supply_install:{prep:14,bidding:21,evaluation:14,approval:21,contract:28,submittals:42,fab:56, transport:14,buffer:7},
  equipment:     {prep:14,bidding:28,evaluation:14,approval:21,contract:21,submittals:28,fab:112,transport:21,buffer:14},
  material:      {prep:7, bidding:14,evaluation:7, approval:21,contract:14,submittals:28,fab:42, transport:14,buffer:7}
};
function ppType(td){var t=td&&td.procType;return PP_DEFAULT_TEMPLATES[t]?t:"subcontract";}
function ppTypeLabel(k){var x=PP_TYPES.find(function(t){return t.k===k;});return x?x.label:"Subcontract";}
function ppTemplate(type){
  var stored=(((window._ppDurations||{}).procTemplates)||{})[type]||{};
  var def=PP_DEFAULT_TEMPLATES[type]||PP_DEFAULT_TEMPLATES.subcontract;
  var out={};
  PP_STEPS.forEach(function(s){var v=Number(stored[s.k]);out[s.k]=stored[s.k]!==undefined&&stored[s.k]!==""&&isFinite(v)&&v>=0?v:def[s.k];});
  return out;
}
function _ppNum(v){if(v===undefined||v===null||v==="")return null;var n=Number(v);return isFinite(n)&&n>=0?n:null;}
// Lead time of each step for this package, and where it comes from.
//   pkg       typed on the package (td.planLeads)
//   materials fabrication = longest lead time of the package's materials
//   route     approval = 7 days when the amount needs no client approval (internal only)
//   template  the type's template
function ppLeads(td){
  var tpl=ppTemplate(ppType(td)),own=(td&&td.planLeads)||{},out={};
  var route=(function(){try{return tenderApprovalRoute(td).route;}catch(e){return"";}})();
  var matLead=((td&&td.materials)||[]).reduce(function(m,x){var d=parseLeadDays(x.leadTime||"");return d>m?d:m;},0);
  PP_STEPS.forEach(function(s){
    var v=_ppNum(own[s.k]);
    if(v!==null){out[s.k]={days:v,src:"pkg"};return;}
    if(s.k==="fab"&&matLead>0){out[s.k]={days:matLead,src:"materials"};return;}
    if(s.k==="approval"&&route==="none"){out[s.k]={days:Math.min(7,tpl.approval),src:"route"};return;}
    out[s.k]={days:tpl[s.k],src:"template"};
  });
  return out;
}
// What has really happened, milestone by milestone: {date} or {done:true} when it is
// reached without a date (e.g. internal approval once a bidder is awarded).
function ppActuals(td){
  var a={};
  var steps=td.steps||{},sd=td.stepDates||{};
  if(td.tenderIssued||/prep|submitted|approved/i.test(steps.pkg||""))a.start={date:"",done:true};
  if(isValidDate(td.tenderIssued))a.issue={date:td.tenderIssued};
  if(isValidDate(td.bidsReceived))a.bids={date:td.bidsReceived};
  var acc=cyclesOfStep(td,"acc"),st=cycleStats(acc);
  var awarded=biddersOf(td).some(function(b){return b.result==="awarded";});
  var internal=(function(){try{return tenderApprovalRoute(td).route==="none";}catch(e){return false;}})();
  if(isValidDate(st.firstSubmitted))a.recommend={date:st.firstSubmitted};
  else if(internal&&awarded)a.recommend={date:"",done:true};
  if(isValidDate(st.approvedOn))a.approved={date:st.approvedOn};
  else if(internal&&awarded)a.approved={date:"",done:true};
  var ct=sd.contract||{};
  var signed=ct.signedAllDone||ct.signedDone||"";
  if(isValidDate(signed))a.contract={date:signed};
  else if(/signed/i.test(steps.contract||""))a.contract={date:"",done:true};
  var subs=tenderDocs(td).filter(function(d){return d.kind==="sd"||d.kind==="mar"||d.kind==="mss";});
  if(subs.length){
    var sums=subs.map(function(d){return cycleStats(d.cycles);});
    if(sums.every(function(x){return !!x.approvedOn;}))a.submittals={date:sums.map(function(x){return x.approvedOn;}).sort().pop()};
  }else if(a.contract)a.submittals={date:"",done:true};
  return a;
}
var PP_MS_ORDER=["start"].concat(PP_STEPS.map(function(s){return s.ms;}));
function ppPlan(td,now){
  now=now||today();
  var leads=ppLeads(td);
  var total=PP_STEPS.reduce(function(n,s){return n+leads[s.k].days;},0);
  var need=isValidDate(td.startOnSite)?td.startOnSite:"";
  var latest={};
  if(need){
    latest.need=need;
    for(var i=PP_STEPS.length-1;i>=0;i--){
      var s=PP_STEPS[i];
      var prevMs=i===0?"start":PP_STEPS[i-1].ms;
      latest[prevMs]=addCalDays(latest[s.ms],-leads[s.k].days);
    }
  }
  var act=ppActuals(td);
  // A milestone is reached when it has happened, or when a later one has.
  var done={},later=false;
  for(var j=PP_MS_ORDER.length-1;j>=0;j--){
    var m=PP_MS_ORDER[j];
    if(act[m])later=true;
    done[m]=later;
  }
  var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
  var next=PP_MS_ORDER.find(function(m){return m!=="need"&&!done[m];})||"";
  // Once the order is placed, fabrication and delivery are judged on the delivery forecast.
  var fcDelivery=isValidDate(proc.deliveryDate)?proc.deliveryDate:"";
  var daysLeft=null,status="none";
  // The past is the past: once the need date is reached, the package is no longer late or due.
  var past=!!need&&need<now;
  if(td.cancelled)status="cancelled";
  else if(past)status="past";
  else if(need&&next){
    var ref=(next==="ready"||next==="delivered")&&fcDelivery?fcDelivery:now;
    var lim=next==="ready"&&fcDelivery?latest.delivered:latest[next];
    daysLeft=Math.round((parseISODate(lim)-parseISODate(ref))/86400000);
    status=daysLeft<0?"late":daysLeft<=14?"soon":"ok";
  }else if(need)status="done";
  return {need:need,leads:leads,total:total,latest:latest,actual:act,done:done,next:next,daysLeft:daysLeft,status:status,
    fcDelivery:fcDelivery,deliveryLate:!past&&!!(fcDelivery&&latest.delivered&&fcDelivery>latest.delivered)};
}
const PP_STATUS={
  late:{label:"Late",fg:"#b3302a",bg:"#fbe6e8"},
  soon:{label:"Due soon",fg:"#b35c00",bg:"#fdf1e0"},
  ok:{label:"On track",fg:"#1e6b3a",bg:"#e6f2e9"},
  done:{label:"Delivered path",fg:"#1e6b3a",bg:"#e6f2e9"},
  past:{label:"Started",fg:"#6f6b62",bg:"#f2f0eb"},
  none:{label:"No need date",fg:"#9b968b",bg:"#f2f0eb"},
  cancelled:{label:"Cancelled",fg:"#9b968b",bg:"#f2f0eb"}
};
function ppDaysText(n){if(n===null||n===undefined)return"";if(n<0)return (-n)+" d late";if(n===0)return"today";return n+" d left";}

// One milestone cell: the latest date, or ✓ and the real date once reached.
function PpMsCell({p,m}){
  var lat=p.latest[m]||"";
  var a=p.actual[m];
  if(p.done[m]){
    var late=a&&a.date&&lat&&a.date>lat;
    return <span title={"Latest "+fmtDate(lat)+(a&&a.date?" · done "+fmtDate(a.date):" · done")}
      style={{fontSize:11,color:late?"#b35c00":"#1e6b3a",fontWeight:600,whiteSpace:"nowrap"}}>✓ {a&&a.date?fmtDate(a.date):"done"}</span>;
  }
  if(!lat)return <span style={{color:"#ddd"}}>—</span>;
  var isNext=p.next===m&&p.status!=="past",st=isNext?PP_STATUS[p.status]:null;
  var past=p.status!=="past"&&lat<today();
  return <span title={"Latest date: "+fmtDate(lat)}
    style={{fontSize:11,whiteSpace:"nowrap",fontWeight:isNext?700:400,padding:isNext?"1px 6px":0,borderRadius:5,
      background:st?st.bg:"transparent",color:st?st.fg:past?"#b3302a":"#6f6b62"}}>{fmtDate(lat)}</span>;
}

// Plan card in the package sheet: type, need date and the lead time of every step.
function ProcPlanCard({td,updTd}){
  const [open,setOpen]=useState(false);
  var p=ppPlan(td);
  var ro=isReadOnly();
  var tpl=ppTemplate(ppType(td));
  var st=PP_STATUS[p.status];
  function setLead(k,v){
    if(blockIfReadOnly())return;
    var n=Object.assign({},td.planLeads||{});
    if(v==="")delete n[k];else n[k]=Number(v);
    updTd("planLeads",n);
  }
  var SRC={pkg:"this package",materials:"longest material lead time",route:"internal approval (below ACC threshold)",template:"template"};
  return <div className="card" style={{marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",cursor:"pointer"}} onClick={function(){setOpen(!open);}}>
      <span style={{fontSize:10,color:"#9b968b",width:10}}>{open?"▾":"▸"}</span>
      <b style={{fontSize:13}}>📅 Procurement plan</b>
      <span onClick={function(e){e.stopPropagation();}}>
        <select value={ppType(td)} disabled={ro} onChange={function(e){if(blockIfReadOnly())return;updTd("procType",e.target.value);}}
          style={{fontSize:11,padding:"2px 6px",fontWeight:600}}>
          {PP_TYPES.map(function(t){return <option key={t.k} value={t.k}>{t.label}</option>;})}
        </select>
      </span>
      <span style={{fontSize:11.5,color:"#6f6b62"}}>Need on site <b>{p.need?fmtDate(p.need):"—"}</b></span>
      {p.need&&<span style={{fontSize:11.5,color:"#6f6b62"}}>Start tender docs by <b>{fmtDate(p.latest.start)}</b></span>}
      <span style={{fontSize:11.5,color:"#6f6b62"}}>Total lead {p.total} d</span>
      <span className="badge" style={{background:st.bg,color:st.fg,marginLeft:"auto"}}>
        {st.label}{p.next&&p.daysLeft!==null?" · "+PP_MS_LABEL[p.next]+" "+ppDaysText(p.daysLeft):""}</span>
    </div>
    {open&&<div style={{marginTop:10}}>
      {!p.need&&<div style={{fontSize:11.5,color:"#b35c00",marginBottom:8}}>Fill the Target start (need on site) of this package: every latest date is computed back from it.</div>}
      <table className="tbl" style={{fontSize:12}}>
        <thead><tr><th>Step</th><th style={{width:90,textAlign:"right"}}>Template</th><th style={{width:120,textAlign:"right"}}>This package (d)</th>
          <th>Milestone</th><th style={{width:110}}>Latest date</th><th style={{width:120}}>Actual</th></tr></thead>
        <tbody>
          <tr><td colSpan={3} style={{color:"#9b968b"}}>—</td><td>{PP_MS_LABEL.start}</td><td><PpMsCell p={p} m="start"/></td><td></td></tr>
          {PP_STEPS.map(function(s){
            var L=p.leads[s.k],own=(td.planLeads||{})[s.k];
            var a=p.actual[s.ms];
            return <tr key={s.k}>
              <td>{s.label}</td>
              <td style={{textAlign:"right",color:"#9b968b"}}>{tpl[s.k]} d</td>
              <td style={{textAlign:"right"}}>
                <input type="number" min="0" value={own===undefined?"":own} disabled={ro} placeholder={String(L.days)}
                  title={"Used: "+L.days+" d ("+SRC[L.src]+")"} onChange={function(e){setLead(s.k,e.target.value);}}
                  style={{width:70,textAlign:"right",fontSize:11,padding:"2px 5px",fontWeight:L.src==="pkg"?700:400}}/>
                {L.src!=="template"&&L.src!=="pkg"&&<div style={{fontSize:9.5,color:"#9b968b"}}>{SRC[L.src]}</div>}
              </td>
              <td>{s.msLabel}</td>
              <td>{s.ms==="need"?<b style={{fontSize:11}}>{fmtDate(p.need)}</b>:<PpMsCell p={p} m={s.ms}/>}</td>
              <td style={{fontSize:11,color:"#6f6b62"}}>{a&&a.date?fmtDate(a.date):a?"✓":""}
                {s.ms==="delivered"&&p.fcDelivery&&<span style={{color:p.deliveryLate?"#b3302a":"#6f6b62"}}>forecast {fmtDate(p.fcDelivery)}</span>}</td>
            </tr>;
          })}
        </tbody>
      </table>
      <div style={{fontSize:10.5,color:"#9b968b",marginTop:6}}>Calendar days. Empty = the template of the type (Settings › Durations › Procurement plan templates). Fabrication falls back on the longest lead time of the materials; approval is 7 days when the amount needs no client approval.</div>
    </div>}
  </div>;
}

// Paste a list from Excel: one package per line.
//   Package ⇥ Department ⇥ Type ⇥ Budget ⇥ Need on site
// A line whose name matches an existing package updates it (only the columns filled).
function _ppParseType(v){
  var t=String(v||"").toLowerCase();
  if(!t)return"";
  if(/equip/.test(t))return"equipment";
  if(/install|s&i|s & i|supply.*install/.test(t))return"supply_install";
  if(/mat|supply|purchase|achat/.test(t))return"material";
  if(/sub|sous/.test(t))return"subcontract";
  return"";
}
function _ppParseDate(v){
  var s=String(v||"").trim();
  if(!s)return"";
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  var m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if(m){var y=m[3].length===2?"20"+m[3]:m[3];var d=y+"-"+("0"+m[2]).slice(-2)+"-"+("0"+m[1]).slice(-2);return isValidDate(d)?d:"";}
  if(/^\d{5}$/.test(s)){var dt=new Date(Date.UTC(1899,11,30)+Number(s)*86400000);return toISO(new Date(dt.getUTCFullYear(),dt.getUTCMonth(),dt.getUTCDate()));}
  return"";
}
function ProcPlanPasteModal({tenders,saveTenders,packages,onClose}){
  const [txt,setTxt]=useState("");
  var known={};(tenders||[]).forEach(function(t){known[String(t.title||"").trim().toLowerCase()]=t;});
  var rows=String(txt).split(/\r?\n/).map(function(l){return l.split(/\t|;/).map(function(c){return c.trim();});})
    .filter(function(c){return c[0];})
    .filter(function(c,i){return !(i===0&&/package|name|nom/i.test(c[0])&&/dep|type|budget/i.test(c.slice(1).join(" ")));})
    .map(function(c){
      var budget=String(c[3]||"").replace(/[^\d,.\-]/g,"").replace(/\s/g,"");
      if(/,\d{1,2}$/.test(budget))budget=budget.replace(/\./g,"").replace(",",".");else budget=budget.replace(/,/g,"");
      var r={title:c[0],dept:c[1]||"",type:_ppParseType(c[2]),typeRaw:c[2]||"",budget:budget,need:_ppParseDate(c[4]),needRaw:c[4]||""};
      r.existing=known[r.title.toLowerCase()]||null;
      r.unknownDept=r.dept&&(packages||[]).indexOf(r.dept)<0;
      return r;
    });
  function apply(){
    if(blockIfReadOnly())return;
    var list=(tenders||[]).slice(),nNew=0,nUpd=0;
    rows.forEach(function(r){
      var patch={};
      if(r.dept)patch.package=r.dept;
      if(r.type)patch.procType=r.type;
      if(r.budget)patch.budget=r.budget;
      if(r.need)patch.startOnSite=r.need;
      if(r.existing){
        list=list.map(function(t){return t.id===r.existing.id?Object.assign({},t,patch):t;});nUpd++;
      }else{
        list.unshift(newTender(Object.assign({title:r.title,procType:r.type||"subcontract"},patch)));nNew++;
      }
    });
    saveTenders(list);
    safeAlert(nNew+" package"+(nNew!==1?"s":"")+" created, "+nUpd+" updated.");
    onClose();
  }
  var cell={padding:"3px 6px",fontSize:11.5,borderBottom:"1px solid #f0ede6"};
  return <div className="overlay" onClick={onClose}>
    <div className="modal" style={{maxWidth:900,width:"95vw"}} onClick={function(e){e.stopPropagation();}}>
      <div className="modal-hdr"><div className="modal-title">📋 Paste the procurement list</div>
        <button className="btn btn-sm" onClick={onClose}>✕</button></div>
      <div className="modal-body">
      <div style={{fontSize:12,color:"#6f6b62",marginBottom:8}}>Copy the columns from Excel, in this order: <b>Package ⇥ Department ⇥ Type ⇥ Budget ⇥ Need on site</b>.
        Type: subcontract, supply &amp; install, equipment or material. A package that already exists (same name) is updated with the columns filled.</div>
      <textarea value={txt} onChange={function(e){setTxt(e.target.value);}} rows={8} placeholder={"Facade curtain wall\tFACADE\tSupply & install\t2 400 000\t15/03/2027\nGenerators\tMEP\tEquipment\t380000\t01/06/2027"}
        style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12}}/>
      {rows.length>0&&<div style={{maxHeight:300,overflow:"auto",marginTop:8}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr style={{fontSize:10,color:"#9b968b",textTransform:"uppercase",textAlign:"left"}}>
            <th style={cell}></th><th style={cell}>Package</th><th style={cell}>Department</th><th style={cell}>Type</th><th style={cell}>Budget</th><th style={cell}>Need on site</th></tr></thead>
          <tbody>{rows.map(function(r,i){
            return <tr key={i}>
              <td style={cell}><span className="badge" style={r.existing?{background:"#e8f0fe",color:"#0f5299"}:{background:"#e6f2e9",color:"#1e6b3a"}}>{r.existing?"update":"new"}</span></td>
              <td style={Object.assign({},cell,{fontWeight:600})}>{r.title}</td>
              <td style={Object.assign({},cell,{color:r.unknownDept?"#b35c00":"inherit"})} title={r.unknownDept?"Not in the department list (Settings) — it is kept as typed":""}>{r.dept||"—"}{r.unknownDept?" ⚠":""}</td>
              <td style={Object.assign({},cell,{color:r.typeRaw&&!r.type?"#b3302a":"inherit"})}>{r.type?ppTypeLabel(r.type):r.typeRaw?r.typeRaw+" ?":"—"}</td>
              <td style={Object.assign({},cell,{textAlign:"right",fontFamily:"var(--font-mono)"})}>{r.budget?Number(r.budget).toLocaleString():"—"}</td>
              <td style={Object.assign({},cell,{color:r.needRaw&&!r.need?"#b3302a":"inherit"})}>{r.need?fmtDate(r.need):r.needRaw?r.needRaw+" ?":"—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" disabled={!rows.length} onClick={apply}>Import {rows.length||""} line{rows.length!==1?"s":""}</button>
      </div>
    </div>
  </div>;
}

// The plan of the whole project: every package, sorted by its next deadline.
function ProcPlanView({tenders,saveTenders,packages,onNavTender}){
  const [q,setQ]=useState("");
  const [typeF,setTypeF]=useState("all");
  const [deptF,setDeptF]=useState("all");
  const [horizon,setHorizon]=useState(function(){try{return localStorage.getItem("pp_procplan_horizon")||"all";}catch(e){return"all";}});
  const [paste,setPaste]=useState(false);
  useEffect(function(){try{localStorage.setItem("pp_procplan_horizon",horizon);}catch(e){}},[horizon]);
  var ro=isReadOnly();
  var now=today();
  var rows=(tenders||[]).filter(function(t){return !t.cancelled;}).map(function(t){return {td:t,p:ppPlan(t,now)};});
  var depts=[...new Set(rows.map(function(r){return r.td.package||"";}).filter(Boolean))].sort();
  var counts={late:0,soon:0,none:0,past:0};rows.forEach(function(r){if(r.p.deliveryLate&&r.p.status!=="late")counts.late++;if(counts[r.p.status]!==undefined)counts[r.p.status]++;});
  var vis=rows.filter(function(r){
    if(typeF!=="all"&&ppType(r.td)!==typeF)return false;
    if(deptF!=="all"&&(r.td.package||"")!==deptF)return false;
    if(q&&String(r.td.title||"").toLowerCase().indexOf(q.toLowerCase())<0)return false;
    if(horizon==="late")return r.p.status==="late"||r.p.deliveryLate;
    if(horizon==="started")return r.p.status==="past";
    if(horizon!=="all"&&r.p.status==="past")return false;
    if(horizon==="4w")return r.p.daysLeft!==null&&r.p.daysLeft<=28;
    if(horizon==="8w")return r.p.daysLeft!==null&&r.p.daysLeft<=56;
    if(horizon==="notlaunched")return !r.p.done.issue;
    if(horizon==="noneed")return !r.p.need;
    return true;
  }).sort(function(a,b){
    // started packages at the bottom: nothing left to anticipate on them
    var pa=a.p.status==="past"?1:0,pb=b.p.status==="past"?1:0;
    if(pa!==pb)return pa-pb;
    var da=a.p.daysLeft===null?1e9:a.p.daysLeft,db=b.p.daysLeft===null?1e9:b.p.daysLeft;
    if(da!==db)return da-db;
    return String(a.td.title||"").localeCompare(String(b.td.title||""));
  });
  function upd(td,patch){if(blockIfReadOnly())return;saveTenders((tenders||[]).map(function(t){return t.id===td.id?Object.assign({},t,patch):t;}));}
  var MS=["start","issue","approved","contract","submittals","delivered"];
  var HZ=[["all","All"],["late","Late ("+counts.late+")"],["4w","Next 4 weeks"],["8w","Next 8 weeks"],["notlaunched","Not launched"],["noneed","No need date ("+counts.none+")"],["started","Already started ("+counts.past+")"]];
  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Procurement plan</div>
        <div className="page-sub">Every package with its latest dates, worked back from the need on site through the lead time of each step</div></div>
      {!ro&&<button className="btn btn-gold" style={{marginLeft:"auto"}} onClick={function(){setPaste(true);}}>📋 Paste list from Excel</button>}
    </div>
    {paste&&<ProcPlanPasteModal tenders={tenders} saveTenders={saveTenders} packages={packages} onClose={function(){setPaste(false);}}/>}
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search package…" style={{width:190,padding:"5px 10px",fontSize:12}}/>
      {HZ.map(function(h){return <button key={h[0]} className={"fchip"+(horizon===h[0]?" on":"")} onClick={function(){setHorizon(h[0]);}}>{h[1]}</button>;})}
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
      <button className={"fchip"+(typeF==="all"?" on":"")} onClick={function(){setTypeF("all");}}>All types</button>
      {PP_TYPES.map(function(t){return <button key={t.k} className={"fchip"+(typeF===t.k?" on":"")} onClick={function(){setTypeF(typeF===t.k?"all":t.k);}}>{t.label}</button>;})}
      <select value={deptF} onChange={function(e){setDeptF(e.target.value);}} style={{fontSize:12,padding:"4px 8px",marginLeft:8,width:"auto"}}>
        <option value="all">All departments</option>
        {depts.map(function(d){return <option key={d} value={d}>{d}</option>;})}
      </select>
      <span style={{fontSize:11,color:"#9b968b",marginLeft:"auto"}}>{vis.length} / {rows.length} packages</span>
    </div>
    <div className="phone-scroll" style={{overflowX:"auto"}}>
    <table className="tbl" style={{fontSize:12}}>
      <thead><tr>
        <th style={{minWidth:200}}>Package</th><th>Department</th><th style={{minWidth:130}}>Type</th><th style={{textAlign:"right"}}>Budget</th>
        <th style={{minWidth:120}} title="Target start of the package: typed here or in the sheet, or taken from its linked schedule task">Need on site</th>
        <th style={{minWidth:150}}>Next deadline</th>
        {MS.map(function(m){return <th key={m} style={{minWidth:86}} title={"Latest date to reach: "+PP_MS_LABEL[m]}>{PP_MS_LABEL[m]}</th>;})}
        <th style={{minWidth:100}} title="Forecast delivery of the package (fabrication cascade) against the latest delivery date">Forecast delivery</th>
      </tr></thead>
      <tbody>{vis.map(function(r){
        var td=r.td,p=r.p,st=PP_STATUS[p.status];
        return <tr key={td.id}>
          <td><span style={{fontWeight:600,cursor:onNavTender?"pointer":"default",color:"var(--ink,#16181d)"}} onClick={function(){if(onNavTender)onNavTender(td.id,"procplan");}}
            title="Open the package">{td.title||"(untitled)"}</span></td>
          <td style={{fontSize:11,color:"#6f6b62"}}>{td.package||"—"}</td>
          <td><select value={ppType(td)} disabled={ro} onChange={function(e){upd(td,{procType:e.target.value});}} style={{fontSize:11,padding:"2px 5px"}}>
            {PP_TYPES.map(function(t){return <option key={t.k} value={t.k}>{t.label}</option>;})}</select></td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11}}>{Number(td.budget)>0?Number(td.budget).toLocaleString():"—"}</td>
          <td><input type="date" min="1990-01-01" max="2200-12-31" value={td.startOnSite||""} disabled={ro}
            onChange={function(e){upd(td,{startOnSite:e.target.value});}} style={{fontSize:11,padding:"2px 5px"}}/></td>
          <td><span className="badge" style={{background:st.bg,color:st.fg}}>{p.next&&p.need&&p.status!=="past"?PP_MS_LABEL[p.next]:st.label}</span>
            {p.daysLeft!==null&&<div style={{fontSize:10.5,fontWeight:700,color:st.fg,marginTop:2}}>{ppDaysText(p.daysLeft)}</div>}</td>
          {MS.map(function(m){return <td key={m}><PpMsCell p={p} m={m}/></td>;})}
          <td style={{fontSize:11,whiteSpace:"nowrap",color:p.deliveryLate?"#b3302a":"#6f6b62",fontWeight:p.deliveryLate?700:400}}>
            {p.fcDelivery?fmtDate(p.fcDelivery):"—"}{p.deliveryLate?" ⚠":""}</td>
        </tr>;
      })}</tbody>
    </table>
    </div>
    {vis.length===0&&<div style={{color:"#9b968b",fontSize:12,padding:"14px 0"}}>No package here. Paste the project list from Excel to start the plan.</div>}
    <div style={{fontSize:10.5,color:"#9b968b",marginTop:8}}>Each date is the LATEST date to reach the milestone so the package is on site when needed. Late = will start late; a package whose need date is past is "Started" and never flagged. ✓ = reached (green on time, orange later than the latest date). Lead times: Settings › Durations › Procurement plan templates, adjustable per package in its sheet (Submissions › 📅 Procurement plan).</div>
  </div>;
}

// Settings › Durations: lead time of each step, per type.
function ProcPlanTemplatesEditor({durations,saveDurations}){
  var cur=(durations&&durations.procTemplates)||{};
  function set(type,k,v){
    var t=Object.assign({},cur);var row=Object.assign({},t[type]||{});
    if(v==="")delete row[k];else row[k]=Number(v);
    t[type]=row;
    saveDurations(Object.assign({},durations||{},{procTemplates:t}));
  }
  return <div style={{marginBottom:16}}>
    <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6,letterSpacing:".4px"}}>Procurement plan templates (calendar days per step)</div>
    <div style={{overflowX:"auto"}}>
    <table className="tbl" style={{fontSize:11.5}}>
      <thead><tr><th>Step</th>{PP_TYPES.map(function(t){return <th key={t.k} style={{textAlign:"right"}}>{t.label}</th>;})}</tr></thead>
      <tbody>{PP_STEPS.map(function(s){
        return <tr key={s.k}><td>{s.label}</td>
          {PP_TYPES.map(function(t){
            var v=(cur[t.k]||{})[s.k];var def=PP_DEFAULT_TEMPLATES[t.k][s.k];
            return <td key={t.k} style={{textAlign:"right"}}><input type="number" min="0" value={v===undefined?"":v} placeholder={String(def)}
              onChange={function(e){set(t.k,s.k,e.target.value);}} style={{width:64,textAlign:"right",fontSize:11.5,padding:"3px 6px",fontWeight:v!==undefined?700:400}}/></td>;
          })}</tr>;
      })}</tbody>
    </table>
    </div>
  </div>;
}
