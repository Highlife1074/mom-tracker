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
  // Direct purchases (Submissions › Purchases): for a material or equipment Package the PO is
  // its contract, and once every purchase is delivered the Package is delivered on site.
  var pur=(td.purchases||[]).filter(Boolean);
  if(pur.length){
    var ty=ppType(td);
    var pos=pur.map(function(x){return x.poDate;}),dls=pur.map(function(x){return x.deliveryDone;});
    if(!a.contract&&(ty==="material"||ty==="equipment")&&pos.every(isValidDate))a.contract={date:pos.slice().sort().pop(),po:true};
    if(ty!=="subcontract"&&dls.every(isValidDate))a.delivered={date:dls.slice().sort().pop()};
  }
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
  // need on site: Target start, or — once that is past — the next linked schedule task not
  // started yet (tenderNeedDate): the rooms still to come keep the package under watch.
  var nd=tenderNeedDate(td,now);
  var need=isValidDate(nd.date)?nd.date:"";
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
  var deliveredOn=act.delivered&&isValidDate(act.delivered.date)?act.delivered.date:"";
  // Same rule as the schedule and the Package list: late when the forecast lands after the
  // end of the need week. Landing after the latest delivery date but before that only eats
  // the float (deliveryTight).
  var dst=!past&&!deliveredOn&&fcDelivery&&need?procDeliveryState(fcDelivery,need):null;
  return {need:need,needNext:!!nd.next,needTask:nd.task||null,leads:leads,total:total,latest:latest,actual:act,done:done,next:next,daysLeft:daysLeft,status:status,
    fcDelivery:fcDelivery,deliveredOn:deliveredOn,
    deliveryLate:!!(dst&&dst.late),
    deliveryTight:!!(dst&&!dst.late&&latest.delivered&&fcDelivery>latest.delivered)};
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
      // A package linked to a schedule task takes its need date from the schedule only.
      if(r.need&&!(r.existing&&tenderScheduleStart(r.existing)))patch.startOnSite=r.need;
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
        Type: subcontract, supply &amp; install, equipment or material. A package that already exists (same name) is updated with the columns filled. Need on site is ignored for a package linked to a schedule task: the schedule gives it.</div>
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
              {r.existing&&tenderScheduleStart(r.existing)
                ?<td style={Object.assign({},cell,{color:"#00695c"})} title="Linked to a schedule task: the need date comes from the schedule, the pasted date is ignored">🗓 schedule{r.need?" (ignored)":""}</td>
                :<td style={Object.assign({},cell,{color:r.needRaw&&!r.need?"#b3302a":"inherit"})}>{r.need?fmtDate(r.need):r.needRaw?r.needRaw+" ?":"—"}</td>}
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

// ---- Shared by the screen, the print and the Excel export -----------------------------------
// The status families shown as KPI tiles and used as filters. "Late" also takes a package
// whose forecast delivery lands after its latest delivery date.
// Starts on site within 21 days (and not delivered yet): the packages to watch this month.
var PP_SOON_DAYS=21;
function ppStartsSoon(p,now){
  now=now||today();
  return !!p.need&&p.need>=now&&p.need<=addCalDays(now,PP_SOON_DAYS)&&!p.deliveredOn&&p.status!=="cancelled";
}
// Open actions of every package, read once per render: Blocking points (tag "Blocking Point")
// and the other open actions = next steps, soonest due first.
function ppActionsIndex(tasks){
  var m={};
  (tasks||[]).forEach(function(t){
    if(!t||!t.tenderRef||t.status==="done")return;
    var e=m[t.tenderRef]||(m[t.tenderRef]={next:[],block:[]});
    ((t.tags||[]).indexOf("Blocking Point")>=0?e.block:e.next).push(t);
  });
  function byDue(a,b){var x=a.due||"9999",y=b.due||"9999";return x<y?-1:x>y?1:0;}
  Object.keys(m).forEach(function(k){m[k].next.sort(byDue);m[k].block.sort(byDue);});
  return m;
}
function ppActText(t){
  var o=String(t.owner||"").split(",")[0].trim();
  return (t.text||"")+(o?" — "+o:"")+(t.due?" ("+fmtDate(t.due)+")":"");
}
var PP_KPIS=[
  {k:"start21",label:"Starts ≤ 21 d",cls:"warn",tip:"Needed on site within the next 21 days and not delivered yet: highlighted in the list"},
  {k:"late",label:"Late",cls:"bad",tip:"Next milestone past its latest date, or forecast delivery after the latest delivery date"},
  {k:"soon",label:"Due ≤ 14 d",cls:"warn",tip:"Next milestone due within 14 days"},
  {k:"ok",label:"On track",cls:"good",tip:"Next milestone more than 14 days away, or every milestone reached"},
  {k:"notlaunched",label:"Not launched",cls:"",tip:"Tender not issued yet (and the package not started on site)"},
  {k:"started",label:"Started",cls:"",tip:"Need on site already past: started on site, never flagged late"},
  {k:"noneed",label:"No need date",cls:"",tip:"No Target start and no schedule task linked: nothing can be worked back"}
];
function ppKpiOf(r,k){
  var p=r.p;
  if(k==="start21")return ppStartsSoon(p);
  if(k==="late")return p.status==="late"||p.deliveryLate;
  if(k==="soon")return p.status==="soon"&&!p.deliveryLate;
  if(k==="ok")return (p.status==="ok"||p.status==="done")&&!p.deliveryLate;
  if(k==="notlaunched")return !p.done.issue&&p.status!=="past";
  if(k==="started")return p.status==="past";
  if(k==="noneed")return !p.need;
  return true;
}
function ppMoney(n){
  n=Number(n)||0;
  if(!n)return "—";
  if(Math.abs(n)>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,"")+" M";
  if(Math.abs(n)>=1e3)return Math.round(n/1e3)+" k";
  return String(Math.round(n));
}
function ppBudget(td){var n=Number(td&&td.budget);return isFinite(n)&&n>0?n:0;}
// Sort keys of the table. Empty values always go last, whatever the direction.
var PP_SORTS={
  title:function(r){return String(r.td.title||"").toLowerCase();},
  dept:function(r){return String(r.td.package||"").toLowerCase()||null;},
  type:function(r){return ppTypeLabel(ppType(r.td));},
  budget:function(r){return ppBudget(r.td)||null;},
  need:function(r){return r.p.need||null;},
  deadline:function(r){return r.p.status==="past"?null:r.p.daysLeft;}
};
function ppSortRows(list,sort){
  var get=PP_SORTS[sort.k]||PP_SORTS.deadline,d=sort.dir<0?-1:1;
  return list.slice().sort(function(a,b){
    // on the default order, started packages sink to the bottom: nothing left to anticipate
    if(sort.k==="deadline"){var pa=a.p.status==="past"?1:0,pb=b.p.status==="past"?1:0;if(pa!==pb)return pa-pb;}
    var va=get(a),vb=get(b);
    var na=va===null||va===undefined||va==="",nb=vb===null||vb===undefined||vb==="";
    if(na!==nb)return na?1:-1;
    if(!na&&va!==vb)return (va<vb?-1:1)*d;
    return String(a.td.title||"").localeCompare(String(b.td.title||""));
  });
}
// Rows grouped by department, in the order of the rows themselves.
function ppGroups(list){
  var map={},order=[];
  list.forEach(function(r){var k=r.td.package||"";if(!map[k]){map[k]=[];order.push(k);}map[k].push(r);});
  order.sort(function(a,b){if(!a)return 1;if(!b)return -1;return a.localeCompare(b);});
  return order.map(function(k){return {dept:k,rows:map[k]};});
}

// ---- Timeline (Gantt) ------------------------------------------------------------------
// Each package as its procurement chain on a calendar: one bar per step between its two
// latest dates, ✓ marks on the dates really reached, the need on site, the forecast delivery
// and today. Built as a model of percentages, drawn by the screen (React) and by the print
// (HTML) from the same numbers.
var PP_GANTT_COL={prep:"#d6d1c4",bidding:"#c4bdab",evaluation:"#b1a993",approval:"#9fb9d8",contract:"#d6bd70",
  submittals:"#93bfb3",fab:"#8d887d",transport:"#b0ab9f",buffer:"#ece9e2"};
var PP_GANTT_GROUPS=[
  {label:"Tender",steps:["prep","bidding","evaluation"]},{label:"Approval",steps:["approval"]},{label:"Contract / PO",steps:["contract"]},
  {label:"Submittals",steps:["submittals"]},{label:"Fabrication",steps:["fab"]},{label:"Transport",steps:["transport"]},{label:"Float",steps:["buffer"]}
];
var PP_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function _ppDay(iso){var p=String(iso||"").split("-");return Date.UTC(+p[0],(+p[1])-1,+p[2])/864e5;}
function ppGanttModel(vis,now){
  now=now||today();
  var ds=[now];
  vis.forEach(function(r){
    var p=r.p;if(!p.need)return;
    ds.push(p.need);if(p.latest.start)ds.push(p.latest.start);
    if(p.fcDelivery)ds.push(p.fcDelivery);if(p.deliveredOn)ds.push(p.deliveredOn);
    PP_MS_ORDER.forEach(function(m){var a=p.actual[m];if(a&&isValidDate(a.date))ds.push(a.date);});
  });
  ds=ds.filter(isValidDate).sort();
  var a=parseISODate(addCalDays(ds[0],-7)),b=parseISODate(addCalDays(ds[ds.length-1],14));
  var from=toISO(new Date(a.getFullYear(),a.getMonth(),1)),to=toISO(new Date(b.getFullYear(),b.getMonth()+1,1));
  // at most 36 months, kept around today: older history and far future are clipped
  var maxD=1100;
  if(_ppDay(to)-_ppDay(from)>maxD){
    var t0=parseISODate(addCalDays(now,-180));
    from=toISO(new Date(t0.getFullYear(),t0.getMonth(),1));
    var t1=parseISODate(addCalDays(from,maxD));to=toISO(new Date(t1.getFullYear(),t1.getMonth()+1,1));
  }
  var f0=_ppDay(from),span=Math.max(1,_ppDay(to)-f0);
  function x(d){return (_ppDay(d)-f0)/span*100;}
  function clip(l,w){var L=Math.max(0,l),R=Math.min(100,l+w);return R>L?{left:L,width:R-L}:null;}
  var months=[],cur=parseISODate(from),n=0;
  while(toISO(cur)<to&&n++<60){
    var nx=new Date(cur.getFullYear(),cur.getMonth()+1,1);
    months.push({iso:toISO(cur),left:x(toISO(cur)),width:x(toISO(nx))-x(toISO(cur)),label:PP_MONTHS[cur.getMonth()]+(cur.getMonth()===0||months.length===0?" "+String(cur.getFullYear()).slice(2):""),jan:cur.getMonth()===0});
    cur=nx;
  }
  var every=months.length>30?3:months.length>18?2:1;
  months.forEach(function(m,i){m.show=i%every===0;});
  var rows=vis.map(function(r){
    var p=r.p,out={r:r,segs:[],marks:[],need:null,fc:null};
    if(!p.need)return out;
    PP_STEPS.forEach(function(s,i){
      var prev=i===0?"start":PP_STEPS[i-1].ms;
      var d0=p.latest[prev],d1=p.latest[s.ms];
      if(!d0||!d1||d1<=d0)return;
      var c=clip(x(d0),x(d1)-x(d0));if(!c)return;
      var reached=!!p.done[s.ms];
      out.segs.push({k:s.k,label:s.label,from:d0,to:d1,days:p.leads[s.k].days,left:c.left,width:c.width,
        done:reached,overdue:!reached&&p.status!=="past"&&d1<now,next:p.next===s.ms&&p.status!=="past"});
    });
    PP_MS_ORDER.forEach(function(m){
      var ac=p.actual[m];if(!ac||!isValidDate(ac.date))return;
      var l=x(ac.date);if(l<0||l>100)return;
      var lat=p.latest[m]||"";
      out.marks.push({m:m,date:ac.date,latest:lat,left:l,late:!!(lat&&ac.date>lat)});
    });
    var ln=x(p.need);if(ln>=0&&ln<=100)out.need={left:ln,date:p.need};
    var dd=p.deliveredOn||p.fcDelivery;
    if(dd){var lf=x(dd);if(lf>=0&&lf<=100)out.fc={left:lf,date:dd,actual:!!p.deliveredOn,late:!!p.deliveryLate};}
    return out;
  });
  var tl=x(now);
  return {from:from,to:to,months:months,rows:rows,today:tl>=0&&tl<=100?tl:null};
}
var PP_GANTT_CSS=
  '.ppg{position:relative;min-width:980px;border:1px solid var(--rule,#ddd9cf);border-radius:6px;background:#fff;overflow:hidden}'+
  '.ppg-row{display:flex;align-items:stretch;border-bottom:1px solid #f0ede6;min-height:28px}'+
  '.ppg-row:last-child{border-bottom:none}'+
  '.ppg-l{flex:0 0 300px;width:300px;padding:4px 10px;display:flex;align-items:center;gap:8px;border-right:1px solid var(--rule,#ddd9cf);background:#fff;min-width:0}'+
  '.ppg-l .t{font-weight:600;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}'+
  '.ppg-l .d{font-size:10px;color:#9b968b;white-space:nowrap}'+
  '.ppg-tr{position:relative;flex:1;min-width:0}'+
  '.ppg-hd{background:#f7f6f2;border-bottom:1px solid var(--rule,#ddd9cf);min-height:24px}'+
  '.ppg-hd .ppg-l{background:#f7f6f2;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6f6b62}'+
  '.ppg-mo{position:absolute;top:0;bottom:0;font-size:9.5px;color:#6f6b62;padding:6px 0 0 4px;white-space:nowrap;border-left:1px solid #e6e2d8;font-family:var(--font-mono,monospace)}'+
  '.ppg-mo.jan{border-left-color:#b9b4a8;color:#16181d;font-weight:600}'+
  '.ppg-grp{background:#fafaf8;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#4a4740}'+
  '.ppg-grp .ppg-l{background:#fafaf8}'+
  '.ppg-ov{position:absolute;top:0;bottom:0;right:0;left:300px;pointer-events:none}'+
  '.ppg-ov .ml{position:absolute;top:24px;bottom:0;border-left:1px solid #f2f0eb}'+
  '.ppg-ov .ml.jan{border-left-color:#e2ded4}'+
  '.ppg-ov .td{position:absolute;top:0;bottom:0;border-left:1.5px solid #16181d;z-index:3}'+
  '.ppg-ov .td span{position:absolute;bottom:2px;left:3px;font-size:9px;font-weight:700;background:#16181d;color:#fff;border-radius:3px;padding:0 4px;white-space:nowrap}'+
  '.ppg-sg{position:absolute;top:8px;height:12px;box-sizing:border-box;border-radius:2px;z-index:1}'+
  '.ppg-sg.done{opacity:.45}'+
  '.ppg-sg.overdue{box-shadow:inset 0 0 0 1.5px #b3302a}'+
  '.ppg-sg.next{outline:2px solid var(--ppg-st,#16181d);outline-offset:1px;z-index:2}'+
  '.ppg-sg.buf{background:repeating-linear-gradient(45deg,#ece9e2,#ece9e2 3px,#f7f6f2 3px,#f7f6f2 6px)!important;border:1px solid #ddd9cf}'+
  '.ppg-mk{position:absolute;top:6px;width:9px;height:9px;margin-left:-4.5px;transform:rotate(45deg);border:1.5px solid #fff;z-index:4;background:#1e6b3a}'+
  '.ppg-mk.late{background:#b35c00}'+
  '.ppg-nd{position:absolute;top:3px;bottom:3px;border-left:2px solid #16181d;z-index:4}'+
  '.ppg-nd:after{content:"";position:absolute;top:0;left:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:7px solid #16181d}'+
  '.ppg-fc{position:absolute;top:17px;width:0;height:0;margin-left:-5px;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #1e6b3a;z-index:4}'+
  '.ppg-fc.late{border-bottom-color:#b3302a}.ppg-fc.act{border-bottom-color:#16181d}'+
  '.ppg-st{font-size:9.5px;font-weight:700;border-radius:4px;padding:0 5px;white-space:nowrap}'+
  '.ppg-leg{display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:10.5px;color:#6f6b62;margin-top:8px}'+
  '.ppg-leg i{display:inline-block;width:16px;height:9px;border-radius:2px;vertical-align:middle;margin-right:4px}'+
  // phone: a narrow name column, the status under the name, the calendar scrolls sideways
  '@media(max-width:768px){.ppg{min-width:760px}.ppg-l{flex-basis:150px;width:150px;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;padding:3px 8px}'+
  '.ppg-l .t{flex:none;max-width:100%}.ppg-hd .ppg-l{flex-direction:row;align-items:center}.ppg-ov{left:150px}}';
// The same chart as HTML, for the printed report.
function ppGanttHtml(model,grouped){
  function seg(s,st){
    return '<div class="ppg-sg'+(s.done?' done':'')+(s.overdue?' overdue':'')+(s.next?' next':'')+(s.k==="buffer"?' buf':'')+'" style="left:'+s.left.toFixed(3)+'%;width:'+s.width.toFixed(3)+'%;background:'+PP_GANTT_COL[s.k]+(s.next&&st?';--ppg-st:'+st.fg:'')+'"></div>';
  }
  function row(g){
    var r=g.r,st=PP_STATUS[r.p.status];
    var soon=ppStartsSoon(r.p);
    var h='<div class="ppg-row"'+(soon?' style="background:#fdf1e0"':'')+'><div class="ppg-l"'+(soon?' style="background:#fdf1e0;box-shadow:inset 3px 0 0 #b35c00"':'')+'><span class="t">'+esc(r.td.title||"(untitled)")+'</span><span class="ppg-st" style="background:'+st.bg+';color:'+st.fg+'">'+
      esc(r.p.next&&r.p.need&&r.p.status!=="past"?PP_MS_LABEL[r.p.next]:st.label)+(r.p.daysLeft!==null?' · '+ppDaysText(r.p.daysLeft):'')+'</span></div><div class="ppg-tr">';
    g.segs.forEach(function(s){h+=seg(s,st);});
    if(g.need)h+='<div class="ppg-nd" style="left:'+g.need.left.toFixed(3)+'%"></div>';
    if(g.fc)h+='<div class="ppg-fc'+(g.fc.actual?' act':g.fc.late?' late':'')+'" style="left:'+g.fc.left.toFixed(3)+'%"></div>';
    g.marks.forEach(function(m){h+='<div class="ppg-mk'+(m.late?' late':'')+'" style="left:'+m.left.toFixed(3)+'%"></div>';});
    return h+'</div></div>';
  }
  var h='<div class="ppg"><div class="ppg-row ppg-hd"><div class="ppg-l">Package · next deadline</div><div class="ppg-tr">';
  model.months.forEach(function(m){h+='<div class="ppg-mo'+(m.jan?' jan':'')+'" style="left:'+m.left.toFixed(3)+'%">'+(m.show?esc(m.label):'')+'</div>';});
  h+='</div></div>';
  if(grouped){
    var byId={};model.rows.forEach(function(g){byId[g.r.td.id]=g;});
    ppGroups(model.rows.map(function(g){return g.r;})).forEach(function(gr){
      h+='<div class="ppg-row ppg-grp"><div class="ppg-l">'+esc(gr.dept||"No department")+' · '+gr.rows.length+'</div><div class="ppg-tr"></div></div>';
      gr.rows.forEach(function(r){h+=row(byId[r.td.id]);});
    });
  }else model.rows.forEach(function(g){h+=row(g);});
  h+='<div class="ppg-ov">';
  model.months.forEach(function(m){h+='<div class="ml'+(m.jan?' jan':'')+'" style="left:'+m.left.toFixed(3)+'%"></div>';});
  if(model.today!==null)h+='<div class="td" style="left:'+model.today.toFixed(3)+'%"><span>Today</span></div>';
  return h+'</div></div>'+ppGanttLegendHtml();
}
function ppGanttLegendHtml(){
  return '<div class="ppg-leg">'+PP_GANTT_GROUPS.map(function(g){
    var k=g.steps[g.steps.length-1];
    return '<span><i style="background:'+(k==="buffer"?'repeating-linear-gradient(45deg,#ece9e2,#ece9e2 3px,#f7f6f2 3px,#f7f6f2 6px);border:1px solid #ddd9cf':PP_GANTT_COL[k])+'"></i>'+esc(g.label)+'</span>';
  }).join("")+
  '<span><i style="background:#1e6b3a;width:9px;height:9px;transform:rotate(45deg)"></i>Reached (orange: after its latest date)</span>'+
  '<span><i style="background:#16181d;width:2px"></i>Need on site</span>'+
  '<span><i style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #b3302a;border-radius:0"></i>Forecast delivery (red: late · black: delivered)</span>'+
  '<span>Faded bar = step done · red outline = latest date passed · framed = next deadline</span></div>';
}
function ProcPlanGantt({vis,grouped,onNavTender}){
  var model=ppGanttModel(vis);
  var withNeed=vis.filter(function(r){return !!r.p.need;}).length;
  function row(g){
    var r=g.r,td=r.td,p=r.p,st=PP_STATUS[p.status];
    var soon=ppStartsSoon(p);
    return <div key={td.id} className="ppg-row" style={soon?{background:"var(--amber-soft,#fdf1e0)"}:null}>
      <div className="ppg-l" style={soon?{background:"var(--amber-soft,#fdf1e0)",boxShadow:"inset 3px 0 0 var(--amber,#b35c00)"}:null}>
        <span className="t" style={{cursor:onNavTender?"pointer":"default"}} title={(td.title||"")+(td.package?" · "+td.package:"")+" — open the package"}
          onClick={function(){if(onNavTender)onNavTender(td.id,"procplan");}}>{td.title||"(untitled)"}</span>
        <span className="ppg-st" style={{background:st.bg,color:st.fg}}>
          {p.next&&p.need&&p.status!=="past"?PP_MS_LABEL[p.next]:st.label}{p.daysLeft!==null?" · "+ppDaysText(p.daysLeft):""}</span>
      </div>
      <div className="ppg-tr">
        {g.segs.map(function(s){
          return <div key={s.k} className={"ppg-sg"+(s.done?" done":"")+(s.overdue?" overdue":"")+(s.next?" next":"")+(s.k==="buffer"?" buf":"")}
            title={s.label+" · "+s.days+" d\nLatest window "+fmtDate(s.from)+" → "+fmtDate(s.to)+(s.done?"\nReached":s.overdue?"\nLatest date passed, not reached":"")}
            style={Object.assign({left:s.left+"%",width:s.width+"%",background:PP_GANTT_COL[s.k]},s.next?{"--ppg-st":st.fg}:{})}></div>;
        })}
        {g.need&&<div className="ppg-nd" style={{left:g.need.left+"%"}} title={"Need on site "+fmtDate(g.need.date)}></div>}
        {g.fc&&<div className={"ppg-fc"+(g.fc.actual?" act":g.fc.late?" late":"")} style={{left:g.fc.left+"%"}}
          title={(g.fc.actual?"Delivered ":"Forecast delivery ")+fmtDate(g.fc.date)+(g.fc.late?" — after the latest delivery date "+fmtDate(p.latest.delivered):"")}></div>}
        {g.marks.map(function(m){
          return <div key={m.m} className={"ppg-mk"+(m.late?" late":"")} style={{left:m.left+"%"}}
            title={PP_MS_LABEL[m.m]+" ✓ "+fmtDate(m.date)+(m.latest?" (latest "+fmtDate(m.latest)+")":"")}></div>;
        })}
      </div>
    </div>;
  }
  var byId={};model.rows.forEach(function(g){byId[g.r.td.id]=g;});
  return <div>
    <style>{PP_GANTT_CSS}</style>
    {withNeed<vis.length&&<div style={{fontSize:11,color:"#9b968b",marginBottom:6}}>{vis.length-withNeed} package{vis.length-withNeed!==1?"s":""} without a need date: listed with no bar.</div>}
    <div className="phone-scroll" style={{overflowX:"auto"}}>
      <div className="ppg">
        <div className="ppg-row ppg-hd">
          <div className="ppg-l">Package · next deadline</div>
          <div className="ppg-tr">{model.months.map(function(m){return <div key={m.iso} className={"ppg-mo"+(m.jan?" jan":"")} style={{left:m.left+"%"}}>{m.show?m.label:""}</div>;})}</div>
        </div>
        {grouped
          ?ppGroups(vis).map(function(gr){
            return <React.Fragment key={gr.dept||"—"}>
              <div className="ppg-row ppg-grp"><div className="ppg-l">{gr.dept||"No department"} · {gr.rows.length}</div><div className="ppg-tr"></div></div>
              {gr.rows.map(function(r){return row(byId[r.td.id]);})}
            </React.Fragment>;
          })
          :model.rows.map(row)}
        <div className="ppg-ov">
          {model.months.map(function(m){return <div key={m.iso} className={"ml"+(m.jan?" jan":"")} style={{left:m.left+"%"}}></div>;})}
          {model.today!==null&&<div className="td" style={{left:model.today+"%"}}><span>Today</span></div>}
        </div>
      </div>
    </div>
    <div dangerouslySetInnerHTML={{__html:ppGanttLegendHtml()}}/>
  </div>;
}

// Excel export of the rows shown (same filters, same order): one line per package, the latest
// and actual date of every milestone, real dates so Excel can sort and filter them.
function ppExportXlsx(vis,acts){
  acts=acts||{};
  if(!window.XLSX||!window.XLSX.utils||!window.XLSX.writeFile){safeAlert("The Excel library is not loaded.");return;}
  // Dates as Excel day numbers (formatted dd/mm/yyyy): a JS Date picks up the timezone's
  // historic offset in SheetJS (a few seconds off in Cyprus); a day number is exact everywhere.
  var EPOCH=_ppDay("1899-12-30"),dateCells=[];
  function d(v){return isValidDate(v)?{xlDate:_ppDay(v)-EPOCH}:"";}
  var head=["Package","Department","Type","Budget","Need on site","Need from","Status","Next milestone","Days left","Total lead (d)"];
  PP_MS_ORDER.forEach(function(m){if(m==="need")return;head.push(PP_MS_LABEL[m]+" — latest");head.push(PP_MS_LABEL[m]+" — actual");});
  head.push("Forecast delivery","Delivered","Delivery late","Starts ≤ 21 d","Next steps","Blocking points");
  var aoa=[head];
  vis.forEach(function(r){
    var td=r.td,p=r.p,st=PP_STATUS[p.status];
    var line=[td.title||"",td.package||"",ppTypeLabel(ppType(td)),ppBudget(td)||"",d(p.need),
      tenderScheduleStart(td)?"schedule":p.need?"typed":"",st.label,p.next&&p.status!=="past"?PP_MS_LABEL[p.next]:"",
      p.daysLeft===null?"":p.daysLeft,p.total];
    PP_MS_ORDER.forEach(function(m){
      if(m==="need")return;
      var a=p.actual[m];
      line.push(d(p.latest[m]));
      line.push(a?(a.date?d(a.date):"done"):"");
    });
    var a=acts[td.id]||{next:[],block:[]};
    line.push(d(p.fcDelivery),d(p.deliveredOn),p.deliveryLate?"yes":"",ppStartsSoon(p)?"yes":"",
      [td.nextStep||""].concat(a.next.map(ppActText)).filter(Boolean).join("\n"),a.block.map(ppActText).join("\n"));
    aoa.push(line);
  });
  aoa=aoa.map(function(line,ri){return line.map(function(v,ci){if(v&&typeof v==="object"&&"xlDate" in v){dateCells.push([ri,ci]);return v.xlDate;}return v;});});
  var ws=window.XLSX.utils.aoa_to_sheet(aoa);
  dateCells.forEach(function(rc){var c=ws[window.XLSX.utils.encode_cell({r:rc[0],c:rc[1]})];if(c){c.t="n";c.z="dd/mm/yyyy";}});
  ws["!cols"]=head.map(function(h,i){return {wch:i===0?34:i<3?16:14};});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Procurement plan");
  window.XLSX.writeFile(wb,"Procurement plan "+today()+".xlsx");
}

// The plan of the whole project: every package, sorted by its next deadline.
// Printable procurement plan: the rows shown on screen (same filters, same order), A4 landscape.
// mode "timeline" prints the Gantt, otherwise the table of latest dates.
function ppOpenReport(vis,filterLabel,mode,grouped,acts){
  acts=acts||{};
  var MS=["start","issue","approved","contract","submittals","delivered"];
  var now=today();
  function ms(p,m){
    var lat=p.latest[m]||"",a=p.actual[m];
    if(p.done[m]){
      var late=a&&a.date&&lat&&a.date>lat;
      return '<td class="'+(late?"c-soon":"c-ok")+'">✓ '+(a&&a.date?fmtDate(a.date):"done")+'</td>';
    }
    if(!lat)return '<td class="c-none">—</td>';
    var isNext=p.next===m&&p.status!=="past",st=isNext?PP_STATUS[p.status]:null;
    if(st)return '<td><span class="pill" style="background:'+st.bg+';color:'+st.fg+'">'+fmtDate(lat)+'</span></td>';
    return '<td'+(p.status!=="past"&&lat<now?' class="c-late"':'')+'>'+fmtDate(lat)+'</td>';
  }
  var html='<style>@page{size:A4 landscape;margin:10mm 9mm 11mm}body{max-width:none}'+
    '.pp h1{font-size:19px;margin:0 0 2px}.pp .sub{color:#666;font-size:11px;margin-bottom:10px}'+
    '.pp .kpis{display:flex;gap:6px;margin-bottom:10px}.pp .k{border:1px solid #e6e2d8;border-radius:6px;padding:4px 10px;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.04em}'+
    '.pp .k b{display:block;font-size:15px;color:#14171c;letter-spacing:0}.pp .k small{display:block;font-size:9px;text-transform:none;letter-spacing:0;color:#888}'+
    '.pp table{border-collapse:collapse;width:100%;font-size:9.5px}.pp th,.pp td{border-bottom:1px solid #e6e2d8;padding:3px 4px;text-align:left;white-space:nowrap;vertical-align:top}'+
    '.pp th{background:#f5f3ee;font-weight:700;font-size:8.5px;text-transform:uppercase;letter-spacing:.03em}.pp td.t{white-space:normal;font-weight:600;min-width:150px}'+
    '.pp td.r,.pp th.r{text-align:right}.pp .pill{border-radius:4px;padding:0 5px;font-weight:700}.pp .d{font-size:8.5px;font-weight:700}'+
    '.pp .c-ok{color:#1e6b3a;font-weight:600}.pp .c-soon{color:#b35c00;font-weight:600}.pp .c-late{color:#b3302a}.pp .c-none{color:#ccc}'+
    '.pp tr.s21 td{background:#fdf1e0}.pp tr.s21 td.t{box-shadow:inset 3px 0 0 #b35c00}.pp td.a{white-space:normal;min-width:110px;max-width:170px;font-size:8.5px}.pp td.b{color:#b3302a;font-weight:600}.pp tr.g td{background:#fafaf8;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:9px}'+
    '.pp .leg{font-size:9px;color:#777;margin-top:8px}.pp thead{display:table-header-group}@media print{.pp tr,.pp .ppg-row{break-inside:avoid}}'+
    PP_GANTT_CSS+'.pp .ppg{min-width:0}.pp .ppg-l{flex-basis:230px;width:230px;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;padding:3px 8px}'+
    '.pp .ppg-l .t{white-space:normal;flex:none;font-size:10.5px;line-height:1.2}.pp .ppg-l .ppg-st{font-size:8.5px}.pp .ppg-hd .ppg-l{flex-direction:row;align-items:center}.pp .ppg-ov{left:230px}</style><div class="pp">';
  html+='<h1>Riviera Tower — Procurement plan</h1><div class="sub">Printed '+fmtDate(now)+' · '+vis.length+' package'+(vis.length>1?"s":"")+
    (filterLabel?' · '+esc(filterLabel):'')+'</div>';
  html+='<div class="kpis">'+PP_KPIS.map(function(k){
    var l=vis.filter(function(r){return ppKpiOf(r,k.k);});
    var b=l.reduce(function(s,r){return s+ppBudget(r.td);},0);
    var col=k.cls==="bad"?PP_STATUS.late.fg:k.cls==="warn"?PP_STATUS.soon.fg:k.cls==="good"?PP_STATUS.ok.fg:"#14171c";
    return '<div class="k">'+esc(k.label)+'<b style="color:'+col+'">'+l.length+'</b><small>'+ppMoney(b)+'</small></div>';
  }).join("")+'</div>';
  if(mode==="timeline"){
    html+=ppGanttHtml(ppGanttModel(vis,now),grouped).replace('<div class="ppg-leg">','<div class="ppg-leg leg">');
    html+='<div class="leg">Each bar is a step between its two LATEST dates, worked back from the need on site through the lead time of each step.</div></div>';
    openReport("Procurement plan "+now,html);
    return;
  }
  html+='<table><thead><tr><th>Package</th><th>Department</th><th>Type</th><th class="r">Budget</th><th>Need on site</th><th>Next deadline</th><th>Next steps</th><th>Blocking points</th>'+
    MS.map(function(m){return '<th>'+esc(PP_MS_LABEL[m])+'</th>';}).join("")+'<th>Forecast delivery</th></tr></thead><tbody>';
  function line(r){
    var td=r.td,p=r.p,st=PP_STATUS[p.status],soon=ppStartsSoon(p,now);
    var a=acts[td.id]||{next:[],block:[]};
    function li(l){return l.length?l.map(function(x){return '<div>'+esc(x)+'</div>';}).join(""):'<span class="c-none">—</span>';}
    return '<tr'+(soon?' class="s21"':'')+'><td class="t">'+esc(td.title||"(untitled)")+(soon?'<div class="d" style="color:#b35c00">starts ≤ 21 d</div>':'')+'</td><td>'+esc(td.package||"—")+'</td><td>'+esc(ppTypeLabel(ppType(td)))+'</td>'+
      '<td class="r">'+(ppBudget(td)?ppBudget(td).toLocaleString():"—")+'</td>'+
      '<td>'+(p.need?fmtDate(p.need):"—")+'</td>'+
      '<td><span class="pill" style="background:'+st.bg+';color:'+st.fg+'">'+esc(p.next&&p.need&&p.status!=="past"?PP_MS_LABEL[p.next]:st.label)+'</span>'+
        (p.daysLeft!==null?'<div class="d" style="color:'+st.fg+'">'+ppDaysText(p.daysLeft)+'</div>':'')+'</td>'+
      '<td class="a">'+li([td.nextStep||""].concat(a.next.map(ppActText)).filter(Boolean))+'</td>'+
      '<td class="a b">'+li(a.block.map(ppActText))+'</td>'+
      MS.map(function(m){return ms(p,m);}).join("")+
      '<td'+(p.deliveryLate?' class="c-late" style="font-weight:700"':'')+'>'+(p.deliveredOn?"✓ "+fmtDate(p.deliveredOn):p.fcDelivery?fmtDate(p.fcDelivery):"—")+(p.deliveryLate?" ⚠":"")+'</td></tr>';
  }
  if(grouped)ppGroups(vis).forEach(function(g){
    html+='<tr class="g"><td colspan="'+(9+MS.length)+'">'+esc(g.dept||"No department")+' · '+g.rows.length+' · '+ppMoney(g.rows.reduce(function(s,r){return s+ppBudget(r.td);},0))+'</td></tr>';
    g.rows.forEach(function(r){html+=line(r);});
  });
  else vis.forEach(function(r){html+=line(r);});
  html+='</tbody></table><div class="leg">Each date is the LATEST date to reach the milestone so the package is on site when needed, worked back from the need date through the lead time of each step. '+
    '✓ = reached (green on time, orange later than the latest date). Highlighted = next deadline. Red = latest date already past. A package whose need date is past is "Started" and never flagged late.</div></div>';
  openReport("Procurement plan "+now,html);
}
// One cell of the Next steps / Blocking points columns: the open actions of the package
// (the same actions as everywhere else — Actions, the package sheet, the zone), ticked off
// here, and a box to add one. Next steps also shows the package's own "Next Step" text.
function PpActionsCell({td,list,kind,tasks,saveTasks}){
  const [open,setOpen]=useState(false);
  const [txt,setTxt]=useState("");
  const [all,setAll]=useState(false);
  var ro=isReadOnly()||!saveTasks;
  var now=today();
  var block=kind==="block";
  var shown=all?list:list.slice(0,3);
  function add(){
    var v=txt.trim();if(!v||blockIfReadOnly())return;
    saveTasks([newTask({text:v,tenderRef:td.id,package:td.package||"",tags:block?["Blocking Point"]:[],
      importance:block?3:2,urgence:block?3:2,owner:td.ownerTender||"",note:"From the Procurement plan"})].concat(tasks||[]));
    setTxt("");setOpen(false);
  }
  function close(t){
    if(blockIfReadOnly())return;
    saveTasks((tasks||[]).map(function(x){return x.id!==t.id?x:stampModified(Object.assign({},x,{status:"done",completedAt:now}));}));
  }
  var col=block?"#b3302a":"#16181d";
  return <div style={{minWidth:190,maxWidth:280,fontSize:11,lineHeight:1.35}}>
    {!block&&td.nextStep&&<div title="Next Step of the package (Follow-up)" style={{color:"#4a4740",fontStyle:"italic",marginBottom:3,whiteSpace:"pre-wrap"}}>{td.nextStep}</div>}
    {shown.map(function(t){
      var late=t.due&&t.due<now;
      return <div key={t.id} style={{display:"flex",gap:5,alignItems:"flex-start",marginBottom:2}}>
        {!ro&&<input type="checkbox" checked={false} onChange={function(){close(t);}} title="Mark done" style={{width:12,height:12,margin:"2px 0 0",flex:"0 0 auto"}}/>}
        {ro&&<span style={{color:col}}>{block?"■":"•"}</span>}
        <span style={{color:block?col:"inherit",fontWeight:block?600:400}} title={ppActText(t)+(t.note?"\n"+t.note:"")}>
          {t.text||"(no text)"}
          {t.owner&&<span style={{color:"#9b968b",fontWeight:400}}> · {String(t.owner).split(",")[0]}</span>}
          {t.due&&<span style={{color:late?"#b3302a":"#9b968b",fontWeight:late?700:400,fontFamily:"var(--font-mono)",fontSize:10}}> {fmtDate(t.due)}</span>}
        </span>
      </div>;
    })}
    {list.length>3&&<button onClick={function(){setAll(!all);}} style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:"#0f5299",fontFamily:"inherit"}}>
      {all?"show less":"+ "+(list.length-3)+" more"}</button>}
    {ro&&!list.length&&!(!block&&td.nextStep)&&<span style={{color:"#ccc"}}>—</span>}
    {!ro&&(open
      ?<div style={{display:"flex",gap:3,marginTop:3}}>
        <input type="text" autoFocus value={txt} onChange={function(e){setTxt(e.target.value);}}
          onKeyDown={function(e){if(e.key==="Enter")add();if(e.key==="Escape"){setOpen(false);setTxt("");}}}
          placeholder={block?"Blocking point…":"Next step…"} style={{flex:1,minWidth:0,fontSize:11,padding:"2px 6px"}}/>
        <button className="btn btn-sm" onClick={add} disabled={!txt.trim()} style={{padding:"1px 7px",fontSize:10.5}}>Add</button>
      </div>
      :<button onClick={function(){setOpen(true);}} title={block?"Add a blocking point (an action tagged Blocking Point, linked to this package)":"Add a next step (an action linked to this package)"}
        style={{background:"none",border:"none",padding:0,marginTop:2,cursor:"pointer",fontSize:10.5,color:"#9b968b",fontFamily:"inherit",display:"block"}}>+ add</button>)}
  </div>;
}
function ProcPlanView({tenders,saveTenders,packages,tasks,saveTasks,onNavTender,onNavZone}){
  function lsGet(k,d){try{var v=localStorage.getItem(k);return v===null?d:v;}catch(e){return d;}}
  function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
  const [q,setQ]=useState("");
  const [typeF,setTypeF]=useState("all");
  const [deptF,setDeptF]=useState("all");
  const [horizon,setHorizon]=useState(function(){var h=lsGet("pp_procplan_horizon","all");return h==="noneed"||h==="late"||h==="started"||h==="notlaunched"?"all":h;});
  const [kpiF,setKpiF]=useState("");                   // status tile used as a filter
  const [mode,setMode]=useState(function(){return lsGet("pp_procplan_view","table")==="timeline"?"timeline":"table";});
  const [grouped,setGrouped]=useState(function(){return lsGet("pp_procplan_group","0")==="1";});
  const [sort,setSort]=useState({k:"deadline",dir:1});
  const [paste,setPaste]=useState(false);
  useEffect(function(){lsSet("pp_procplan_horizon",horizon);},[horizon]);
  useEffect(function(){lsSet("pp_procplan_view",mode);},[mode]);
  useEffect(function(){lsSet("pp_procplan_group",grouped?"1":"0");},[grouped]);
  var ro=isReadOnly();
  var now=today();
  var rows=(tenders||[]).filter(function(t){return !t.cancelled;}).map(function(t){return {td:t,p:ppPlan(t,now)};});
  var depts=[...new Set(rows.map(function(r){return r.td.package||"";}).filter(Boolean))].sort();
  // type / department / search first: the tiles count what those filters leave
  var base=rows.filter(function(r){
    if(typeF!=="all"&&ppType(r.td)!==typeF)return false;
    if(deptF!=="all"&&(r.td.package||"")!==deptF)return false;
    if(q){
      var s=q.toLowerCase();
      if(String(r.td.title||"").toLowerCase().indexOf(s)<0&&String(r.td.package||"").toLowerCase().indexOf(s)<0)return false;
    }
    return true;
  });
  var vis=ppSortRows(base.filter(function(r){
    if(kpiF&&!ppKpiOf(r,kpiF))return false;
    if(horizon==="4w"||horizon==="8w"){
      if(r.p.status==="past")return false;
      return r.p.daysLeft!==null&&r.p.daysLeft<=(horizon==="4w"?28:56);
    }
    return true;
  }),sort);
  var budgetVis=vis.reduce(function(s,r){return s+ppBudget(r.td);},0);
  var acts=ppActionsIndex(tasks);
  var NOACT={next:[],block:[]};
  function upd(td,patch){if(blockIfReadOnly())return;saveTenders((tenders||[]).map(function(t){return t.id===td.id?Object.assign({},t,patch):t;}));}
  var MS=["start","issue","approved","contract","submittals","delivered"];
  var HZ=[["all","Any date"],["4w","Next deadline ≤ 4 weeks"],["8w","≤ 8 weeks"]];
  function filterLabel(){
    var f=[];
    if(kpiF)f.push((PP_KPIS.find(function(k){return k.k===kpiF;})||{}).label);
    if(horizon!=="all")f.push((HZ.find(function(h){return h[0]===horizon;})||[0,""])[1]);
    if(typeF!=="all")f.push(ppTypeLabel(typeF));if(deptF!=="all")f.push(deptF);if(q)f.push('"'+q+'"');
    return f.join(" · ");
  }
  function th(k,label,style,tip){
    var on=sort.k===k;
    return <th style={Object.assign({cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"},style||{})} title={(tip?tip+"\n":"")+"Click to sort"}
      onClick={function(){setSort(on?{k:k,dir:-sort.dir}:{k:k,dir:1});}}>{label}<span style={{color:on?"var(--ink,#16181d)":"#ccc",marginLeft:3}}>{on?(sort.dir>0?"▲":"▼"):"↕"}</span></th>;
  }
  function line(r){
    var td=r.td,p=r.p,st=PP_STATUS[p.status];
    var soon=ppStartsSoon(p,now),a=acts[td.id]||NOACT;
    var dLeft=soon?Math.round((parseISODate(p.need)-parseISODate(now))/86400000):null;
    // starts within 21 days: amber background and rule on the left, days to go under the name
    var hl=soon?{background:"var(--amber-soft,#fdf1e0)"}:null;
    return <tr key={td.id} style={hl}>
      <td style={soon?{boxShadow:"inset 3px 0 0 var(--amber,#b35c00)"}:null}><span style={{fontWeight:600,cursor:onNavTender?"pointer":"default",color:"var(--ink,#16181d)"}} onClick={function(){if(onNavTender)onNavTender(td.id,"procplan");}}
        title="Open the package">{td.title||"(untitled)"}</span>
        {soon&&<div style={{fontSize:10,fontWeight:700,color:"var(--amber,#b35c00)",marginTop:2}}>starts on site {dLeft===0?"today":"in "+dLeft+" d"}</div>}</td>
      <td style={{fontSize:11,color:"#6f6b62"}}>{td.package||"—"}</td>
      <td><select value={ppType(td)} disabled={ro} onChange={function(e){upd(td,{procType:e.target.value});}} style={{fontSize:11,padding:"2px 5px"}}>
        {PP_TYPES.map(function(t){return <option key={t.k} value={t.k}>{t.label}</option>;})}</select></td>
      <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11}}>{ppBudget(td)?ppBudget(td).toLocaleString():"—"}</td>
      <td>{(function(){
        // From the schedule when a task is linked (read-only); typed by hand only without one.
        var f=tenderScheduleStart(td);
        if(f)return <span onClick={function(){openScheduleStart(f,td,onNavZone);}}
          title={"From the schedule: \""+(f.r.label||"task")+"\" in "+(f.sc.zone||"?")+" ("+(f.sc.title||"")+")\nChange it in the schedule. Click to open that task."}
          style={{fontSize:11,fontWeight:700,color:"#00695c",background:"#e6f2e9",border:"1px solid #cfe3d5",borderRadius:5,padding:"2px 7px",cursor:"pointer",whiteSpace:"nowrap"}}>
          🗓 {fmtDate(td.startOnSite||f.r.startWeek)}</span>;
        return <input type="date" min="1990-01-01" max="2200-12-31" value={td.startOnSite||""} disabled={ro}
          title="No schedule task is linked to this package: set the date by hand. As soon as a task is linked, the schedule takes over."
          onChange={function(e){upd(td,{startOnSite:e.target.value});}} style={{fontSize:11,padding:"2px 5px"}}/>;
      })()}
        {p.needNext&&p.needTask&&<div style={{fontSize:10,color:"#b35c00",marginTop:2,whiteSpace:"nowrap",cursor:"pointer"}}
          onClick={function(){openScheduleStart(p.needTask,td,onNavZone);}}
          title={"The first task has started; the next linked task not started yet is \""+(p.needTask.r.label||"task")+"\" in "+(p.needTask.sc.zone||"?")+" — the plan is worked back from it. Click to open it."}>
          next task {fmtDate(p.need)}</div>}</td>
      <td><span className="badge" style={{background:st.bg,color:st.fg}}>{p.next&&p.need&&p.status!=="past"?PP_MS_LABEL[p.next]:st.label}</span>
        {p.daysLeft!==null&&<div style={{fontSize:10.5,fontWeight:700,color:st.fg,marginTop:2}}>{ppDaysText(p.daysLeft)}</div>}</td>
      <td style={{verticalAlign:"top"}}><PpActionsCell td={td} list={a.next} kind="next" tasks={tasks} saveTasks={saveTasks}/></td>
      <td style={{verticalAlign:"top"}}><PpActionsCell td={td} list={a.block} kind="block" tasks={tasks} saveTasks={saveTasks}/></td>
      {MS.map(function(m){return <td key={m}><PpMsCell p={p} m={m}/></td>;})}
      <td style={{fontSize:11,whiteSpace:"nowrap",color:p.deliveryLate?"#b3302a":p.deliveryTight?"#b35c00":p.deliveredOn?"#1e6b3a":"#6f6b62",fontWeight:p.deliveryLate||p.deliveryTight||p.deliveredOn?700:400}}
        title={p.deliveredOn?"Every purchase of the package is delivered":p.deliveryLate?"Forecast delivery after the week the package is needed on site ("+fmtDate(p.need)+")":p.deliveryTight?"Before the need on site, but after the latest delivery date "+fmtDate(p.latest.delivered)+": the float is used up":""}>
        {p.deliveredOn?"✓ "+fmtDate(p.deliveredOn):p.fcDelivery?fmtDate(p.fcDelivery):"—"}{p.deliveryLate?" ⚠":""}</td>
    </tr>;
  }
  var nCols=9+MS.length;
  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Procurement plan</div>
        <div className="page-sub">Every package with its latest dates, worked back from the need on site through the lead time of each step</div></div>
      <span style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
        <button className="btn" disabled={!vis.length} title="Excel file of the packages shown (current filters and order): latest and actual date of every milestone"
          onClick={function(){ppExportXlsx(vis,acts);}}>Excel</button>
        <button className="btn" disabled={!vis.length} title={"Printable A4 landscape report of the packages shown (current filters)"+(mode==="timeline"?", as the timeline":", as the table")}
          onClick={function(){ppOpenReport(vis,filterLabel(),mode,grouped,acts);}}>Print</button>
        {!ro&&<button className="btn btn-gold" onClick={function(){setPaste(true);}}>Paste list from Excel</button>}
      </span>
    </div>
    {paste&&<ProcPlanPasteModal tenders={tenders} saveTenders={saveTenders} packages={packages} onClose={function(){setPaste(false);}}/>}
    <div className="kpi-strip">
      {PP_KPIS.map(function(k){
        var l=base.filter(function(r){return ppKpiOf(r,k.k);});
        var b=l.reduce(function(s,r){return s+ppBudget(r.td);},0);
        var on=kpiF===k.k;
        return <div key={k.k} className={"kpi kpi-flag"+(k.cls&&l.length?" "+k.cls:"")} title={k.tip+" — click to show only these"}
          onClick={function(){setKpiF(on?"":k.k);}}
          style={{cursor:"pointer",background:on?"var(--rule-2,#efece5)":undefined}}>
          <div className="kpi-l" style={{color:on?"var(--ink,#16181d)":undefined}}>{k.label}{on?" ✕":""}</div>
          <div className="kpi-v">{l.length}</div>
          <div className="kpi-s">{ppMoney(b)} budget</div>
        </div>;
      })}
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Package or department…" style={{width:200,padding:"5px 10px",fontSize:12}}/>
      {HZ.map(function(h){return <button key={h[0]} className={"fchip"+(horizon===h[0]?" on":"")} onClick={function(){setHorizon(h[0]);}}>{h[1]}</button>;})}
      <span style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
        <button className={"fchip"+(grouped?" on":"")} onClick={function(){setGrouped(!grouped);}} title="Group the packages by department">By department</button>
        <span style={{width:1,height:18,background:"var(--rule,#ddd9cf)",margin:"0 2px"}}></span>
        <button className={"fchip"+(mode==="table"?" on":"")} onClick={function(){setMode("table");}} title="Latest date of every milestone">Table</button>
        <button className={"fchip"+(mode==="timeline"?" on":"")} onClick={function(){setMode("timeline");}} title="Each package as its procurement chain on a calendar">Timeline</button>
      </span>
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
      <button className={"fchip"+(typeF==="all"?" on":"")} onClick={function(){setTypeF("all");}}>All types</button>
      {PP_TYPES.map(function(t){return <button key={t.k} className={"fchip"+(typeF===t.k?" on":"")} onClick={function(){setTypeF(typeF===t.k?"all":t.k);}}>{t.label}</button>;})}
      <select value={deptF} onChange={function(e){setDeptF(e.target.value);}} style={{fontSize:12,padding:"4px 8px",marginLeft:8,width:"auto"}}>
        <option value="all">All departments</option>
        {depts.map(function(d){return <option key={d} value={d}>{d}</option>;})}
      </select>
      {(kpiF||horizon!=="all"||typeF!=="all"||deptF!=="all"||q)&&<button className="btn btn-sm" onClick={function(){setKpiF("");setHorizon("all");setTypeF("all");setDeptF("all");setQ("");}}>Clear filters</button>}
      <span style={{fontSize:11,color:"#9b968b",marginLeft:"auto"}}>{vis.length} / {rows.length} packages · {ppMoney(budgetVis)} budget</span>
    </div>
    {mode==="timeline"
      ?(vis.length>0&&<ProcPlanGantt vis={vis} grouped={grouped} onNavTender={onNavTender}/>)
      :<div className="phone-scroll" style={{overflowX:"auto"}}>
      <table className="tbl" style={{fontSize:12}}>
        <thead><tr>
          {th("title","Package",{minWidth:200})}{th("dept","Department")}{th("type","Type",{minWidth:130})}{th("budget","Budget",{textAlign:"right"})}
          {th("need","Need on site",{minWidth:120},"Start of the package on site: from its linked schedule task (🗓, change it in the schedule), typed by hand only when no task is linked")}
          {th("deadline","Next deadline",{minWidth:150},"Next milestone not reached yet and the days left to its latest date")}
          <th title="Open actions linked to the package (not Blocking Point), soonest due first, and its Next Step text. Tick to close, + add to create one.">Next steps</th>
          <th title="Open actions tagged Blocking Point linked to the package — including the automatic “Procurement late” ones from the schedule">Blocking points</th>
          {MS.map(function(m){return <th key={m} style={{minWidth:86}} title={"Latest date to reach: "+PP_MS_LABEL[m]}>{PP_MS_LABEL[m]}</th>;})}
          <th style={{minWidth:100}} title="Forecast delivery of the package (fabrication cascade) against the latest delivery date; ✓ once every purchase is delivered">Forecast delivery</th>
        </tr></thead>
        <tbody>{grouped
          ?ppGroups(vis).map(function(g){
            var b=g.rows.reduce(function(s,r){return s+ppBudget(r.td);},0);
            var nl=g.rows.filter(function(r){return ppKpiOf(r,"late");}).length;
            return <React.Fragment key={g.dept||"—"}>
              <tr><td colSpan={nCols} style={{background:"#fafaf8",fontSize:10.5,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#4a4740"}}>
                {g.dept||"No department"} <span style={{fontWeight:400,textTransform:"none",letterSpacing:0,color:"#9b968b",marginLeft:6}}>
                  {g.rows.length} package{g.rows.length!==1?"s":""} · {ppMoney(b)}{nl?" · ":""}{nl?<b style={{color:"#b3302a"}}>{nl} late</b>:null}</span></td></tr>
              {g.rows.map(line)}
            </React.Fragment>;
          })
          :vis.map(line)}</tbody>
      </table>
      </div>}
    {vis.length===0&&<div style={{color:"#9b968b",fontSize:12,padding:"14px 0"}}>{rows.length?"No package matches these filters.":"No package here. Paste the project list from Excel to start the plan."}</div>}
    <div style={{fontSize:10.5,color:"#9b968b",marginTop:8}}>Each date is the LATEST date to reach the milestone so the package is on site when needed. Late = will start late; a package whose need date is past is "Started" and never flagged. ✓ = reached (green on time, orange later than the latest date). For a material or equipment package bought through Purchases, the PO dates count as Contract / PO and the deliveries as Delivered. Lead times: Settings › Durations › Procurement plan templates, adjustable per package in its sheet (Submissions › 📅 Procurement plan).</div>
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
