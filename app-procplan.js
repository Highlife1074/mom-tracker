// ===========================================================================
// app-procplan.js — Procurement plan.
//
// Every package of the project (subcontracts, supply & install, equipment, materials) is
// listed from day one as a Package (tender record), with:
//   td.procType    "subcontract" | "supply_install" | "equipment" | "material" | "manpower" (missing = subcontract)
//                  manpower = labour only: no fabrication, transport or delivery (Ready to ship and
//                  Delivered are N/A); the crew can come once the contract is signed
//   td.startOnSite the date it is needed on site ("Target start", typed or from a schedule task)
//   td.planLeads   {step: days} overrides of the lead times of its type (calendar days)
// From the need date, the plan works BACKWARD through the lead time of each step and gives
// the LATEST date of every milestone (start the tender documents, issue the tender, receive
// the bids, approval, contract, submittals, order, delivery). Each milestone is compared to
// what has already happened: the next milestone not reached yet and its days left make the
// status of the package (late / due soon / on track).
// Lead time templates per type: pp_durations.procTemplates (Settings › Durations).
// ProcPlanView is the list of the Package view (TendersView renders it): the former Package
// list and the Procurement plan merged, the "procplan" view id now lands on Package.
// ===========================================================================

const PP_TYPES=[
  {k:"subcontract",label:"Subcontract"},
  {k:"supply_install",label:"Supply & install"},
  {k:"equipment",label:"Equipment"},
  {k:"material",label:"Material"},
  {k:"manpower",label:"Manpower (no delivery)"}
];
// In chronological order. Each step ends on its milestone (ms) and starts on the milestone of
// the step before it (ppStepFrom), except MAR / MSS and shop drawings: both start at the
// contract and run in parallel; the fabrication starts once BOTH are approved.
// WMS / ITP are not in the chain: they hang off the start on site (Settings wms/itpBeforeStart),
// like in the package sheet.
const PP_STEPS=[
  {k:"prep",label:"Tender documents",ms:"issue",msLabel:"Issue tender"},
  {k:"bidding",label:"Bidding period",ms:"bids",msLabel:"Bids in"},
  {k:"evaluation",label:"Evaluation & negotiation",ms:"recommend",msLabel:"Recommendation"},
  {k:"approval",label:"Approval (internal / ACC / Aconex)",ms:"approved",msLabel:"Approved"},
  {k:"contract",label:"Contract / PO signature",ms:"contract",msLabel:"Contract / PO"},
  {k:"submittals",label:"MAR / MSS approval",ms:"submittals",msLabel:"MAR / MSS approved"},
  {k:"sd",label:"Shop drawings approval",ms:"sdok",msLabel:"SD approved"},
  {k:"fab",label:"Fabrication / manufacturing",ms:"ready",msLabel:"Ready to ship"},
  {k:"transport",label:"Transport & delivery",ms:"delivered",msLabel:"Delivered"},
  {k:"buffer",label:"Float before start on site",ms:"need",msLabel:"Start on site"}
];
const PP_MS_LABEL={start:"Start tender docs"};
// The next milestone said as the thing to do (Next deadline column, badges): "Approved" in
// red read like a status; "Get the approval" + its latest date reads as the action that is late.
const PP_MS_TODO={start:"Start the tender documents",issue:"Issue the tender",bids:"Receive the bids",recommend:"Send the recommendation",
  approved:"Get the approval",contract:"Sign the contract / PO",submittals:"Get the submittals approved",sdok:"Get the shop drawings approved",ready:"Have it ready to ship",delivered:"Deliver to site"};
function ppNextAct(p){return p&&p.next&&p.need&&p.status!=="past"&&p.status!=="cancelled"?(PP_MS_TODO[p.next]||PP_MS_LABEL[p.next]):"";}
function ppNextBy(p){
  if(!ppNextAct(p))return "";
  var d=p.latest[p.next==="ready"&&p.fcDelivery?"delivered":p.next];
  return (isValidDate(d)?"by "+fmtDate(d):"")+(p.daysLeft!==null&&p.daysLeft!==undefined?(isValidDate(d)?" · ":"")+ppDaysText(p.daysLeft):"");
}
PP_STEPS.forEach(function(s){PP_MS_LABEL[s.ms]=s.msLabel;});
// Calendar days. A subcontract has no fabrication of its own: its float covers mobilisation.
const PP_DEFAULT_TEMPLATES={
  subcontract:   {prep:14,bidding:21,evaluation:14,approval:21,contract:28,submittals:14,sd:14,fab:0,  transport:0, buffer:14},
  supply_install:{prep:14,bidding:21,evaluation:14,approval:21,contract:28,submittals:21,sd:21,fab:56, transport:14,buffer:7},
  equipment:     {prep:14,bidding:28,evaluation:14,approval:21,contract:21,submittals:14,sd:14,fab:112,transport:21,buffer:14},
  material:      {prep:7, bidding:14,evaluation:7, approval:21,contract:14,submittals:21,sd:7, fab:42, transport:14,buffer:7},
  manpower:      {prep:7, bidding:14,evaluation:7, approval:21,contract:21,submittals:0, sd:0, fab:0,  transport:0, buffer:14}
};
// Labour only: nothing is made or delivered.
function ppNoDelivery(td){return ppType(td)==="manpower";}
function ppType(td){var t=td&&td.procType;return PP_DEFAULT_TEMPLATES[t]?t:"subcontract";}
function ppTypeLabel(k){var x=PP_TYPES.find(function(t){return t.k===k;});return x?x.label:"Subcontract";}
// Default of one step for a stored row (template or package overrides). The shop drawings
// step was split out of "submittals": a row that typed submittals before that split keeps
// covering the SD in it, so its SD step is 0 — the old total, and the old dates, stay.
function ppStepDefault(row,type,k){
  row=row||{};
  if(k==="sd"&&row.sd===undefined&&row.submittals!==undefined&&row.submittals!=="")return 0;
  return (PP_DEFAULT_TEMPLATES[type]||PP_DEFAULT_TEMPLATES.subcontract)[k];
}
function ppTemplate(type){
  var stored=(((window._ppDurations||{}).procTemplates)||{})[type]||{};
  var out={};
  PP_STEPS.forEach(function(s){var v=Number(stored[s.k]);out[s.k]=stored[s.k]!==undefined&&stored[s.k]!==""&&isFinite(v)&&v>=0?v:ppStepDefault(stored,type,s.k);});
  return out;
}
function _ppNum(v){if(v===undefined||v===null||v==="")return null;var n=Number(v);return isFinite(n)&&n>=0?n:null;}
// Lead time of each step for this package, and where it comes from.
//   pkg       typed on the package (td.planLeads)
//   manual    fabrication = lead time typed in the sheet (td.leadTimeDays, fabrication +
//             transport, as the delivery forecast reads it) minus the transport
//   materials fabrication = longest lead time of the package's materials
//   route     approval = 7 days when the amount needs no client approval (internal only)
//   settings  approval, contract, MAR / MSS and SD come from Settings › Durations (the same
//             durations as the delivery forecast and the document clocks): approval =
//             accApproval, contract = contractSigning, MAR / MSS = marAfterContract +
//             clientResponse, SD = sdAfterContract + sdApproval
//   template  the type's template
var PP_SETTINGS_STEPS=["approval","contract","submittals","sd"];
var PP_SETTINGS_KEYS={approval:["accApproval"],contract:["contractSigning"],submittals:["marAfterContract","clientResponse"],sd:["sdAfterContract","sdApproval"]};
// Lead of a step taken from Settings › Durations: its days (for totals) and its parts, each in
// its own unit (calendar / working days, chosen per line in Settings).
function ppSettingsLeadParts(k){
  var keys=PP_SETTINGS_KEYS[k];if(!keys)return null;
  return keys.map(function(key){return {n:Number(getDur(key))||0,unit:durUnit(key)};});
}
function ppSettingsLead(k){var p=ppSettingsLeadParts(k);return p?p.reduce(function(a,x){return a+x.n;},0):null;}
// A lead: {days, src, parts:[{n, unit}]}. Moves a date by it (sign −1 = backward).
function ppLead(days,src,unit,parts){return {days:days,src:src,parts:parts||[{n:days,unit:unit||"cd"}]};}
function ppShiftLead(date,L,sign){
  if(!isValidDate(date)||!L)return date||"";
  var d=date;(L.parts||[{n:L.days,unit:"cd"}]).forEach(function(x){d=shiftDays(d,(sign<0?-1:1)*x.n,x.unit);});
  return d;
}
function ppLeadTxt(L){
  if(!L)return "";
  var ps=L.parts||[];
  if(ps.length>1)return ps.map(function(x){return x.n+(x.unit==="wd"?" wd":" d");}).join(" + ");
  return L.days+(ps[0]&&ps[0].unit==="wd"?" wd":" d");
}
function ppLeads(td){
  var tpl=ppTemplate(ppType(td)),own=(td&&td.planLeads)||{},out={};
  var route=(function(){try{return tenderApprovalRoute(td).route;}catch(e){return"";}})();
  var matLead=((td&&td.materials)||[]).reduce(function(m,x){var d=parseLeadDays(x.leadTime||"");return d>m?d:m;},0);
  var manLead=Number(td&&td.leadTimeDays)||0;
  var noDel=ppNoDelivery(td);
  var trOwn=_ppNum(own.transport),trDays=trOwn!==null?trOwn:tpl.transport;
  PP_STEPS.forEach(function(s){
    var v=_ppNum(own[s.k]);
    var tu=durUnit("tpl_"+s.k);                         // unit chosen for this step in Settings
    if(v!==null){out[s.k]=ppLead(v,"pkg",PP_SETTINGS_KEYS[s.k]&&PP_SETTINGS_KEYS[s.k].length===1?durUnit(PP_SETTINGS_KEYS[s.k][0]):PP_SETTINGS_KEYS[s.k]?"cd":tu);return;}
    // SD typed together with the submittals before the split: covered by that lead time
    if(s.k==="sd"&&_ppNum(own.submittals)!==null){out[s.k]=ppLead(0,"pkg");return;}
    if(noDel&&(s.k==="fab"||s.k==="transport"||s.k==="submittals"||s.k==="sd")){out[s.k]=ppLead(0,"type","cd");return;}
    if(s.k==="fab"&&manLead>0){out[s.k]=ppLead(Math.max(0,manLead-trDays),"manual","cd");return;}
    if(s.k==="fab"&&matLead>0){out[s.k]=ppLead(matLead,"materials","cd");return;}
    if(s.k==="approval"&&route==="none"){out[s.k]=ppLead(7,"route","cd");return;}
    var sp=ppSettingsLeadParts(s.k);
    if(sp){out[s.k]=ppLead(ppSettingsLead(s.k),"settings","",sp);return;}
    out[s.k]=ppLead(tpl[s.k],"template",tu);
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
  // Delivered on site, typed in the sheet header (any type of package): the real delivery.
  if(isValidDate(td.deliveredOn))a.delivered={date:td.deliveredOn};
  // MAR / MSS approved = every MAR and MSS approved (WMS / ITP have their own deadline from the
  // start on site and do not hold the fabrication);
  // SD approved = every shop drawing approved. No document of the kind: reached with the contract.
  // Steps set to N/A / Not needed in the sheet: not applicable, so never late. They do not
  // count as reached for the milestones before them (ppPlan: na does not cascade).
  function isNa(v){return v==="N/A"||v==="Not needed";}
  var NA={date:"",done:true,na:true};
  if(isNa(steps.pkg)){if(!a.start)a.start=NA;if(!a.issue)a.issue=NA;if(!a.bids)a.bids=NA;}
  if(isNa(steps.acc)){if(!a.recommend)a.recommend=NA;if(!a.approved)a.approved=NA;}
  if(isNa(steps.contract)&&!a.contract)a.contract=NA;
  var docs=tenderDocs(td);
  function reached(list){
    if(!list.length)return a.contract?{date:"",done:true}:null;
    var ds=[];
    for(var i=0;i<list.length;i++){
      var d=list[i];
      if((d.kind==="wms"||d.kind==="itp")&&String(steps[d.kind]||"")==="N/A")continue;
      var s=docSummary(d);
      if(s.state!=="approved")return null;
      if(isValidDate(s.stats&&s.stats.approvedOn))ds.push(s.stats.approvedOn);
    }
    return ds.length?{date:ds.sort().pop()}:a.contract?{date:"",done:true}:null;
  }
  var sub=reached(docs.filter(function(d){return d.kind==="mar"||d.kind==="mss";}));
  if(sub)a.submittals=sub;
  var sdr=reached(docs.filter(function(d){return d.kind==="sd";}));
  if(sdr)a.sdok=sdr;
  // Manpower: nothing to make or deliver — Ready to ship and Delivered are not applicable.
  if(ppNoDelivery(td)){a.ready=NA;a.delivered=NA;}
  return a;
}
var PP_MS_ORDER=["start"].concat(PP_STEPS.map(function(s){return s.ms;}));
// The milestone a step starts from: the previous one, except MAR / MSS and SD (parallel,
// both from the contract) and the fabrication (from SD approved, reached together with MAR / MSS).
function ppStepFrom(i){
  var s=PP_STEPS[i];
  if(s&&(s.k==="submittals"||s.k==="sd"))return "contract";
  return i<=0?"start":PP_STEPS[i-1].ms;
}
function ppPlan(td,now){
  now=now||today();
  var leads=ppLeads(td);
  var total=PP_STEPS.reduce(function(n,s){return n+(s.k==="submittals"||s.k==="sd"?0:leads[s.k].days);},0)+Math.max(leads.submittals.days,leads.sd.days);
  // need on site: Target start, or — once that is past — the next linked schedule task not
  // started yet (tenderNeedDate): the rooms still to come keep the package under watch.
  var nd=tenderNeedDate(td,now);
  var need=isValidDate(nd.date)?nd.date:"";
  var latest={};
  if(need){
    latest.need=need;
    for(var i=PP_STEPS.length-1;i>=0;i--){
      var s=PP_STEPS[i];
      if(s.k==="fab"){                                   // fabrication starts once MAR / MSS AND SD are approved
        latest.sdok=latest.submittals=ppShiftLead(latest.ready,leads.fab,-1);continue;
      }
      var from=ppStepFrom(i),d=ppShiftLead(latest[s.ms],leads[s.k],-1);
      if(!latest[from]||d<latest[from])latest[from]=d;   // contract: the longer of MAR / MSS and SD
    }
  }
  var act=ppActuals(td);
  // A milestone is reached when it has happened, or when a later one has.
  // SD approved and Submittals OK run side by side: one does not reach the other.
  var done={},later=false;
  for(var j=PP_MS_ORDER.length-1;j>=0;j--){
    var m=PP_MS_ORDER[j];
    if(m==="sdok"){done[m]=later||!!act[m];continue;}
    if(act[m]&&act[m].na){done[m]=true;continue;}
    if(act[m]||act.sdok&&PP_MS_ORDER.indexOf(m)<PP_MS_ORDER.indexOf("submittals"))later=true;
    done[m]=later;
  }
  // Procurement closed by hand (self perform, …): every milestone counts as reached.
  var closed=procClosedOf(td);
  if(closed)PP_MS_ORDER.forEach(function(m){done[m]=true;});
  var proc=closed?{}:(function(){try{return calcProcurement(td);}catch(e){return{};}})();
  var next=PP_MS_ORDER.find(function(m){return m!=="need"&&!done[m];})||"";
  // Once the order is placed, fabrication and delivery are judged on the delivery forecast.
  var fcDelivery=isValidDate(proc.deliveryDate)?proc.deliveryDate:"";
  var daysLeft=null,status="none";
  // The past is the past: once the need date is reached, the package is no longer late or due.
  // The past is the past — but only once the package has really started on site (a linked
  // task with an actual week, or delivered / contract signed / closed). A need date gone by
  // while nothing has started is a package LATE: needPassed.
  var needPassed=!!need&&need<now;
  var past=needPassed&&tenderStartedOnSite(td);
  if(td.cancelled)status="cancelled";
  else if(closed)status="closed";
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
  return {closed:closed,needPassed:needPassed&&!past,type:ppType(td),need:need,needNext:!!nd.next,needTask:nd.task||null,leads:leads,total:total,latest:latest,actual:act,done:done,next:next,daysLeft:daysLeft,status:status,
    fcDelivery:fcDelivery,deliveredOn:deliveredOn,
    deliveryLate:!!(dst&&dst.late),
    deliveryTight:!!(dst&&!dst.late&&latest.delivered&&fcDelivery>latest.delivered)};
}
const PP_STATUS={
  late:{label:"Late",fg:"#b3302a",bg:"#fbe6e8"},
  soon:{label:"Due soon",fg:"#b35c00",bg:"#fdf1e0"},
  ok:{label:"On track",fg:"#1e6b3a",bg:"#e6f2e9"},
  done:{label:"Delivered path",fg:"#1e6b3a",bg:"#e6f2e9"},
  closed:{label:"Procurement closed",fg:"#1e6b3a",bg:"#e6f2e9"},
  past:{label:"Started",fg:"#6f6b62",bg:"#f2f0eb"},
  none:{label:"No need date",fg:"#9b968b",bg:"#f2f0eb"},
  cancelled:{label:"Cancelled",fg:"#9b968b",bg:"#f2f0eb"}
};
function ppDaysText(n){if(n===null||n===undefined)return"";if(n<0)return (-n)+" d late";if(n===0)return"today";return n+" d left";}
// Cells of the table: a date said with its month ("7 Dec 26", never the ambiguous 07/12/26)
// and the deadline said as the action ("Approve by 7 Dec 26", not a bare "by 07/12/26").
var PP_MON3=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function ppDay(d){if(!isValidDate(d))return "";var p=String(d).split("-");return (+p[2])+" "+PP_MON3[(+p[1])-1]+" "+p[0].slice(2);}
// Done: on time, or how many days after the deadline.
function ppDoneVs(ad,lat){
  if(!ad||!lat)return "";
  var over=Math.round((parseISODate(ad)-parseISODate(lat))/86400000);
  return over>0?over+" d after deadline":"on time";
}
// The client's answer for the documents now at the client (calendar days: docResponseDue /
// docOverdue): the worst overdue
// one in red, else the earliest due date in green. null when nothing is at the client.
function ppClientDue(docs,now){
  now=now||today();
  var worst=null,first="";
  (docs||[]).forEach(function(d){
    var s=docSummary(d,now);if(s.state!=="pending")return;
    var last=d.cycles[d.cycles.length-1]||{},due=docResponseDue(d,last.submitted);
    if(s.overdue){if(!worst||s.overdue.days>worst.days)worst=s.overdue;}
    else if(isValidDate(due)&&(!first||due<first))first=due;
  });
  if(worst)return {late:true,txt:"Client answer due "+ppDay(worst.due)+" · "+fmtOverdue(worst),
    tip:"The client has not answered: answer was due "+fmtDate(worst.due)+(worst.unit==="wd"?" (working days)":" (calendar days)")};
  if(first){var n=Math.round((parseISODate(first)-parseISODate(now))/86400000);
    return {late:false,txt:"Client answer due "+ppDay(first)+" · "+(n>0?n+" d left":"today"),tip:"Client answer expected by "+fmtDate(first)};}
  return null;
}

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
function ProcPlanCard({td,updTd,tasks,saveTasks}){
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
  var SRC={type:"manpower: nothing made or delivered",settings:"Settings › Durations",pkg:"this package",manual:"lead time typed in the sheet − transport",materials:"longest material lead time",route:"internal approval (below ACC threshold)",template:"template"};
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
    {(open||p.closed)&&<PpProcCloseBar td={td} tasks={tasks} saveTasks={saveTasks} updTd={function(patch){Object.keys(patch).forEach(function(k){updTd(k,patch[k]);});}}/>}
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
                  title={"Used: "+ppLeadTxt(L)+" ("+SRC[L.src]+")"} onChange={function(e){setLead(s.k,e.target.value);}}
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
  if(/man ?power|labou?r|main[- ]d/.test(t))return"manpower";
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
// Everything validated: every milestone of the chain reached or N/A (contract signed, delivered
// or no delivery) and every document approved (WMS / ITP set to N/A left aside). The whole
// row is then shown pale green (screen, timeline, print) instead of any other highlight.
function ppAllValid(td,p){
  if(!td||td.cancelled||!p)return false;
  if(p.closed)return true;                       // closed by hand: nothing left to validate
  if(p.next)return false;
  var st=td.steps||{};
  return tenderDocs(td).every(function(d){
    if((d.kind==="wms"||d.kind==="itp")&&String(st[d.kind]||"")==="N/A")return true;
    return docSummary(d).state==="approved";
  });
}
function ppStartsSoon(p,now){
  now=now||today();
  return !!p.need&&p.need>=now&&p.need<=addCalDays(now,PP_SOON_DAYS)&&!p.deliveredOn&&p.status!=="cancelled";
}
// Open actions of every package, read once per render: Blocking points (tag "Blocking Point")
// and the other open actions = next steps, soonest due first.
// RFI / FCR (actions tagged RFI or FCR) have their own column: open ones in rfi (answer due
// soonest first), answered ones (action done) in rfiDone — kept in the package sheet only.
function ppIsRfi(t){var g=(t&&t.tags)||[];return g.indexOf("RFI")>=0||g.indexOf("FCR")>=0;}
function ppActionsIndex(tasks){
  var m={};
  (tasks||[]).forEach(function(t){
    if(!t||!t.tenderRef)return;
    var rfi=ppIsRfi(t);
    if(t.status==="done"&&!rfi)return;
    var e=m[t.tenderRef]||(m[t.tenderRef]={next:[],block:[],rfi:[],rfiDone:[]});
    if(rfi)(t.status==="done"?e.rfiDone:e.rfi).push(t);
    else ((t.tags||[]).indexOf("Blocking Point")>=0?e.block:e.next).push(t);
  });
  function byDue(a,b){var x=a.due||"9999",y=b.due||"9999";return x<y?-1:x>y?1:0;}
  function byAns(a,b){var x=ppRfiInfo(a).due||"9999",y=ppRfiInfo(b).due||"9999";return x<y?-1:x>y?1:0;}
  function byDone(a,b){var x=a.completedAt||"",y=b.completedAt||"";return x<y?1:x>y?-1:0;}
  Object.keys(m).forEach(function(k){m[k].next.sort(byDue);m[k].block.sort(byDue);m[k].rfi.sort(byAns);m[k].rfiDone.sort(byDone);});
  return m;
}
// One RFI / FCR: sent on (rfiSubmission), client answer due (rfiDue, else sent + Settings ›
// Durations clientResponse), answered (action done, on completedAt).
function ppRfiInfo(t,now){
  now=now||today();
  var kind=((t.tags||[]).indexOf("FCR")>=0)?"FCR":"RFI";
  var sent=isValidDate(t.rfiSubmission)?t.rfiSubmission:"";
  var due=isValidDate(t.rfiDue)?t.rfiDue:sent?addDur(sent,"clientResponse"):"";
  var done=t.status==="done",ans=done&&isValidDate(t.completedAt)?t.completedAt:"";
  var n=due?Math.round((parseISODate(due)-parseISODate(done&&ans?ans:now))/86400000):null;
  var txt;
  if(done)txt="Answered"+(ans?" "+ppDay(ans):"")+(n!==null&&n<0?" · "+(-n)+" d late":"");
  else if(!sent)txt="Not sent yet";
  else txt="Sent "+ppDay(sent)+" · answer due "+ppDay(due)+" · "+(n<0?(-n)+" d overdue":n===0?"today":n+" d left");
  return {kind:kind,sent:sent,due:due,done:done,answered:ans,days:n,late:!done&&!!sent&&n!==null&&n<0,txt:txt};
}
function ppRfiText(t,now){return ppRfiInfo(t,now).kind+" "+(t.text||"")+" — "+ppRfiInfo(t,now).txt;}
function ppActText(t){
  var o=String(t.owner||"").split(",")[0].trim();
  return (t.text||"")+(o?" — "+o:"")+(t.due?" ("+fmtDate(t.due)+")":"");
}
var PP_KPIS=[
  {k:"start21",label:"Starts ≤ 21 d",cls:"warn",tip:"Needed on site within the next 21 days and not delivered yet: highlighted in the list"},
  {k:"late",label:"Late",cls:"bad",tip:"Next milestone past its latest date, or forecast delivery after the latest delivery date"},
  {k:"soon",label:"Due ≤ 14 d",cls:"warn",tip:"Next milestone due within 14 days"},
  {k:"ok",label:"On track",cls:"good",tip:"Next milestone more than 14 days away, every milestone reached, or procurement closed"},
  {k:"notlaunched",label:"Not launched",cls:"",tip:"Tender not issued yet (and the package not started on site)"},
  {k:"started",label:"Started",cls:"",tip:"Need on site already past AND really started (an actual week on its schedule task, or delivered / contract signed / closed): never flagged late. A need date past with nothing started counts as late."},
  {k:"noneed",label:"No need date",cls:"",tip:"No Target start and no schedule task linked: nothing can be worked back"}
];
function ppKpiOf(r,k){
  var p=r.p;
  if(k==="start21")return ppStartsSoon(p);
  if(k==="late")return p.status==="late"||p.deliveryLate;
  if(k==="soon")return p.status==="soon"&&!p.deliveryLate;
  if(k==="ok")return (p.status==="ok"||p.status==="done"||p.status==="closed")&&!p.deliveryLate;
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
  deadline:function(r){return r.p.status==="past"?null:r.p.daysLeft;},
  awarded:function(r){return ppAwardedNames(r.td).join(", ").toLowerCase()||null;},
  proposed:function(r){return ppProposed(r.td)||null;},
  instructed:function(r){return ppInstructed(r.td)||null;},
  instr:function(r){return String(r.td.instructionNumber||"").trim().toLowerCase()||null;},
  variance:function(r){return ppVariance(r.td);},
  route:function(r){try{return tenderRouteLabel(r.td)||null;}catch(e){return null;}},
  owner:function(r){return String(r.td.ownerTender||"").trim().toLowerCase()||null;},
  next:function(r,acts){var a=(acts||{})[r.td.id];var n=(a?a.next.length:0)+(r.td.nextStep?1:0);return n||null;},
  block:function(r,acts){var a=(acts||{})[r.td.id];return (a&&a.block.length)||null;},
  notes:function(r){return tenderNotesOf(r.td).length||null;},
  rfi:function(r,acts){var a=(acts||{})[r.td.id];return (a&&a.rfi.length)||null;}
};
// One sort per milestone column: by its LATEST date (bottom line of the cell).
["start","issue","bids","recommend","approved","contract","submittals","sdok","ready","delivered"].forEach(function(m){
  PP_SORTS["ms_"+m]=function(r){return r.p.latest[m]||null;};
});
["sd","mar","mss","wms","itp"].forEach(function(k){PP_SORTS["ms_sub_"+k]=function(r){return k==="wms"||k==="itp"?ppQualityDue(r.p,k).appr||null:r.p.latest[k==="sd"?"sdok":"submittals"]||null;};});
// Subcontractor column of the Package list (screen and print): the awarded names, else
// "Self perform" for a procurement closed as such, else "" (not awarded).
function ppSubName(td){
  var n=ppAwardedNames(td);
  if(n.length)return n.join(", ");
  var c=procClosedOf(td);
  return c&&c.reason==="self"?"Self perform":"";
}
function ppAwardedNames(td){
  var aw=(td.awards||[]).filter(function(x){return x.subcontractor;}).map(function(x){return String(x.subcontractor).trim();});
  return aw.length?aw:(td.contractor?[String(td.contractor).trim()]:[]);
}
function ppSortRows(list,sort,acts){
  var g=PP_SORTS[sort.k]||PP_SORTS.deadline,d=sort.dir<0?-1:1;
  function get(r){return g(r,acts);}
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
  submittals:"#93bfb3",sd:"#7fb0c4",fab:"#8d887d",transport:"#b0ab9f",buffer:"#ece9e2"};
var PP_GANTT_GROUPS=[
  {label:"Tender",steps:["prep","bidding","evaluation"]},{label:"Approval",steps:["approval"]},{label:"Contract / PO",steps:["contract"]},
  {label:"Submittals",steps:["submittals"]},{label:"Shop drawings",steps:["sd"]},{label:"Fabrication",steps:["fab"]},{label:"Transport",steps:["transport"]},{label:"Float",steps:["buffer"]}
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
      var prev=ppStepFrom(i);
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
    var allOk=ppAllValid(r.td,r.p),soon=!allOk&&ppStartsSoon(r.p);
    var bg=allOk?'#e6f2e9':'#fdf1e0',ln=allOk?'#1e6b3a':'#b35c00';
    var h='<div class="ppg-row"'+(soon||allOk?' style="background:'+bg+'"':'')+'><div class="ppg-l"'+(soon||allOk?' style="background:'+bg+';box-shadow:inset 3px 0 0 '+ln+'"':'')+'><span class="t">'+esc(r.td.title||"(untitled)")+'</span><span class="ppg-st" style="background:'+st.bg+';color:'+st.fg+'">'+
      esc(ppNextAct(r.p)||st.label)+(r.p.daysLeft!==null?' · '+ppDaysText(r.p.daysLeft):'')+'</span></div><div class="ppg-tr">';
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
  return h+'</div></div>'+ppLegendHtml("gantt");
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
    var allOk=ppAllValid(td,p),soon=!allOk&&ppStartsSoon(p);
    var bg=allOk?"var(--green-soft,#e6f2e9)":"var(--amber-soft,#fdf1e0)",ln=allOk?"var(--green,#1e6b3a)":"var(--amber,#b35c00)";
    return <div key={td.id} className="ppg-row" style={soon||allOk?{background:bg}:null}>
      <div className="ppg-l" style={soon||allOk?{background:bg,boxShadow:"inset 3px 0 0 "+ln}:null}>
        <span className="t" style={{cursor:onNavTender?"pointer":"default"}} title={(td.title||"")+(td.package?" · "+td.package:"")+" — open the package"}
          onClick={function(){if(onNavTender)onNavTender(td.id,"procplan");}}>{td.title||"(untitled)"}</span>
        <span className="ppg-st" style={{background:st.bg,color:st.fg}}>
          {ppNextAct(p)||st.label}{p.daysLeft!==null?" · "+ppDaysText(p.daysLeft):""}</span>
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
  head.push("Forecast delivery","Delivered","Delivery late","Starts ≤ 21 d","Awarded to","Proposed","Instructed","Instruction","Var. budget − instructed","Approval route","Owner","Next steps","Blocking points","RFI open","Notes");
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
    var a=acts[td.id]||{next:[],block:[],rfi:[]};
    var prop=ppProposed(td),bud=ppBudget(td);
    line.push(d(p.fcDelivery),d(p.deliveredOn),p.deliveryLate?"yes":"",ppStartsSoon(p)?"yes":"",
      (td.awards||[]).filter(function(x){return x.subcontractor;}).map(function(x){return x.subcontractor;}).join(", ")||td.contractor||"",
      prop||"",ppInstructed(td)||"",String(td.instructionNumber||"").trim(),ppVariance(td)===null?"":ppVariance(td),
      (function(){try{return tenderRouteLabel(td);}catch(e){return "";}})(),td.ownerTender||"",
      [td.nextStep||""].concat(a.next.map(ppActText)).filter(Boolean).join("\n"),a.block.map(ppActText).join("\n"),a.rfi.map(function(t){return ppRfiText(t);}).join("\n"),ppNotesText(td).join("\n"));
    aoa.push(line);
  });
  aoa=aoa.map(function(line,ri){return line.map(function(v,ci){if(v&&typeof v==="object"&&"xlDate" in v){dateCells.push([ri,ci]);return v.xlDate;}return v;});});
  var ws=window.XLSX.utils.aoa_to_sheet(aoa);
  dateCells.forEach(function(rc){var c=ws[window.XLSX.utils.encode_cell({r:rc[0],c:rc[1]})];if(c){c.t="n";c.z="dd/mm/yyyy";}});
  ws["!cols"]=head.map(function(h,i){return {wch:i===0?34:i<3?16:14};});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Packages");
  window.XLSX.writeFile(wb,"Packages "+today()+".xlsx");
}

// ---- The Package table (Package list and Procurement plan merged) --------------------------
// One row per package. A milestone cell answers two questions at once: top line what really
// happened (read from the package sheet), bottom line the LATEST date of the plan. Only the
// next milestone of a package is coloured, so each row reads left to right: ticks behind,
// one coloured cell where the package is now, grey ahead.
// Column sets (localStorage pp_procplan_cols): Plan / Finance / Follow-up / All in one.
// Under each row, an optional timeline strip (pp_procplan_tl): the plan chain of the Gantt,
// what was reached, the need on site, the delivery forecast and today.
var PP_COLSETS=[
  {k:"plan",label:"Plan",tip:"Milestones of the procurement chain and the need on site"},
  {k:"finance",label:"Finance",tip:"Budget, proposed, instructed, variance budget − instructed"},
  {k:"follow",label:"Follow-up",tip:"Owner, next steps, blocking points and notes"},
  {k:"all",label:"All in one",tip:"The three sets on one line: plan, finance and follow-up (scrolls sideways; print it on A3). Click Plan, Finance or Follow-up to show or hide one set: any one, two or three."}
];
// Columns of the table: the Submittals milestone is split by document kind (SD / MAR / MSS / WMS / ITP),
// each column = the documents of that kind in the package sheet, against the latest date of its milestone (SD approved for SD, Submittals OK for the others).
var PP_SUB_KINDS=[{k:"mar",label:"MAR"},{k:"mss",label:"MSS"},{k:"wms",label:"WMS"},{k:"itp",label:"ITP"},{k:"sd",label:"SD"}];
var PP_TABLE_COLS=["start","issue","approved","contract"].concat(PP_SUB_KINDS.map(function(x){return "sub_"+x.k;})).concat(["delivered"]);
function ppColLabel(c){
  if(c.indexOf("sub_")===0){var k=c.slice(4);return ((PP_SUB_KINDS.find(function(x){return x.k===k;})||{}).label||k.toUpperCase());}
  return PP_MS_LABEL[c];
}
function ppColTip(c){
  if(c.indexOf("sub_")===0)return ppColLabel(c)+" documents of the package (Submissions). Top: what is to be done and by when — to submit / to resubmit by the submission deadline (approval deadline minus the client answer time), to be approved by the approval deadline, worked back from the need on site (milestone "+(c==="sub_sd"?"SD approved":"Submittals OK")+"). Bottom: where the documents really are — sorted by the approval deadline";
  return "Top: what is to be done and by when (deadline to reach "+PP_MS_LABEL[c]+", worked back from the need on site; once reached: ✓ and the date). Bottom: the real status (on time or how late once reached) — sorted by that deadline";
}
function ppColCell(td,p,c,now){return c.indexOf("sub_")===0?ppSubCell(td,p,c.slice(4),now):ppMsCell(td,p,c,now);}
// One submittal kind (sd / mar / mss / wms / itp) of a package, as a milestone cell:
// on top what is to be done (to submit / to resubmit by the submission deadline, to be
// approved by the approval deadline), below where the documents really are.
function ppSubCell(td,p,k,now){
  now=now||today();
  var ms=k==="sd"?"sdok":"submittals",lab=ppColLabel("sub_"+k),lat=p.latest[ms]||"";
  var qd=k==="wms"||k==="itp"?ppQualityDue(p,k):null;
  if(qd){ms="q_"+k;lat=qd.appr;}
  if((k==="wms"||k==="itp")&&((td.steps||{})[k]||"")==="N/A")
    return {kind:"na",act:"N/A",due:"",real:"",tip:lab+" not applicable"};
  if(p.closed&&!tenderDocs(td).some(function(d){return d.kind===k;}))
    return {kind:"na",act:"N/A",due:"",real:"",tip:lab+": procurement closed — "+procClosedLabel(p.closed)};
  var docs=[];
  try{docs=tenderDocs(td).filter(function(d){return d.kind===k;});}catch(e){}
  if(!docs.length)return {kind:"none",act:"",due:"",real:"",tip:"No "+lab+" on this package"};
  var ok=0,cl=0,ret=0,nn=0,last="",sums=docs.map(function(d){return docSummary(d,now);});
  sums.forEach(function(s){
    if(s.state==="approved"){ok++;var a=s.stats&&s.stats.approvedOn;if(isValidDate(a)&&a>last)last=a;}
    else if(s.state==="pending")cl++;else if(s.state==="returned")ret++;else nn++;
  });
  var n=docs.length;
  var tip=lab+": "+docs.map(function(d,i){return (n>1?docShortName(d)+" — ":"")+sums[i].text;}).join("\n");
  var refs=ppDocRefs(td,docs),refsFull=ppDocRefs(td,docs,true);
  if(ok===n){var dc=ppDoneCell("✓ Approved"+(last?" "+ppDay(last):""),last,lat,n>1?"all "+n+" docs":"",
    tip+(lat?"\nApproval deadline "+fmtDate(lat):""));dc.refs=refs;dc.refsFull=refsFull;return dc;}
  var act,due,subBy=qd?qd.sub:ppSubmitBy(k,lat);
  if(nn){act="To submit"+(n>1?" ("+nn+")":"");due=subBy;}
  else if(ret){act="To resubmit"+(n>1?" ("+ret+")":"");due=subBy;}
  else{act="To be approved"+(n>1?" ("+cl+")":"");due=lat;}
  var real;
  if(n===1){
    var s0=sums[0],c0=docs[0].cycles[docs[0].cycles.length-1]||{};
    real=s0.state==="pending"?"At client"+(s0.rev?" · rev "+s0.rev:"")+" · "+_ppSince(c0.submitted,now)+" d":
      s0.state==="returned"?"Returned "+(c0.code||"")+" · "+_ppSince(c0.returned,now)+" d":"Not submitted yet";
  }else real=[ok+"/"+n+" approved",cl?cl+" at client":"",ret?ret+" returned":"",nn?nn+" not submitted":""].filter(Boolean).join(" · ");
  var cli=ppClientDue(docs,now);
  if(cli)tip+="\n"+cli.tip;
  if(lat)tip+="\nTo do: "+act.toLowerCase()+" by "+fmtDate(due)+"\n\n"+(qd?ppQualityTip(p,k,qd):ppChainTip(p,ms,(nn||ret)?k:"",due));
  return ppTodoCell(p,ms,act,due,real,{cli:cli,tip:tip,refs:refs,refsFull:refsFull},now);
}
// The column sets shown, as "plan,finance,follow" (any one, two or three; "all" = the three).
var PP_COLKEYS=["plan","finance","follow"];
function ppColsList(cols){
  if(cols==="all")return PP_COLKEYS.slice();
  var l=String(cols||"").split(",").filter(function(k){return PP_COLKEYS.indexOf(k)>=0;});
  return l.length?PP_COLKEYS.filter(function(k){return l.indexOf(k)>=0;}):["plan"];
}
function ppColsNorm(cols){return ppColsList(cols).join(",");}
function ppColsHas(cols,k){return ppColsList(cols).indexOf(k)>=0;}
function ppColsLabel(cols){
  var l=ppColsList(cols);
  if(l.length===PP_COLKEYS.length)return "All in one";
  return l.map(function(k){return (PP_COLSETS.find(function(c){return c.k===k;})||{}).label||k;}).join(" + ");
}
// Click on a set: shows or hides it (at least one stays); "all" shows the three.
function ppColsToggle(cols,k){
  if(k==="all")return PP_COLKEYS.join(",");
  var l=ppColsList(cols),i=l.indexOf(k);
  if(i>=0){if(l.length>1)l.splice(i,1);}else l.push(k);
  return ppColsNorm(l.join(","));
}
function ppColsOn(cols,k){return k==="all"?ppColsList(cols).length===PP_COLKEYS.length:ppColsHas(cols,k);}
// The column that carries the next milestone: Bids in / Recommendation have no column of
// their own (they come before Approved), Ready to ship comes before Delivered.
function ppShownNext(p){
  if(!p||!p.next||!p.need||p.status==="past"||p.status==="cancelled")return "";
  if(p.next==="bids"||p.next==="recommend")return "approved";
  if(p.next==="ready")return "delivered";
  return p.next;
}
function _ppSince(d,now){return isValidDate(d)?Math.max(0,Math.round((parseISODate(now)-parseISODate(d))/86400000)):0;}
// Top line of a milestone not reached yet: what the package sheet says about it.
function ppMsInfo(td,m,p,now){
  now=now||today();
  try{
    if(m==="start"||m==="issue"){
      var v=String((td.steps||{}).pkg||"");
      return v&&v!=="—"?v:(m==="start"?"Not started":"");
    }
    if(m==="approved"){
      var rl=tenderRouteLabel(td);
      if(p.next==="bids")return "Tender out"+(isValidDate(td.tenderIssued)?" · "+_ppSince(td.tenderIssued,now)+" d":"");
      if(p.next==="recommend")return "Bid evaluation · "+rl;
      var acc=tenderDocs(td).find(function(d){return d.id==="acc";});
      if(acc&&acc.cycles&&acc.cycles.length){
        var s=docSummary(acc,now),last=acc.cycles[acc.cycles.length-1];
        if(s.state==="pending")return rl+" at client"+(last.rev?" · rev "+last.rev:"")+" · "+_ppSince(last.submitted,now)+" d";
        if(s.state==="returned")return rl+" returned "+last.code+" · "+_ppSince(last.returned,now)+" d";
      }
      return rl;
    }
    if(m==="contract"){
      var pur=(td.purchases||[]).filter(Boolean),ty=ppType(td);
      if(pur.length&&(ty==="material"||ty==="equipment"))return "PO "+pur.filter(function(x){return isValidDate(x.poDate);}).length+"/"+pur.length;
      if(tenderPhase(td)==="ctr"){var n=tenderNow(td,now);return String(n.text||"").replace(/^Contract · /,"")+(n.days?" · "+n.days+" d":"");}
      return "";
    }
    if(m==="submittals"||m==="sdok"){
      var docs=tenderDocs(td).filter(function(d){return m==="sdok"?d.kind==="sd":d.kind==="mar"||d.kind==="mss"||d.kind==="wms"||d.kind==="itp";});
      if(!docs.length)return "";
      var ok=0,cl=0;
      docs.forEach(function(d){var st=docSummary(d,now).state;if(st==="approved")ok++;else if(st==="pending")cl++;});
      return ok+"/"+docs.length+" approved"+(cl?" · "+cl+" at client":"");
    }
    if(m==="delivered")return p.fcDelivery?"fc "+fmtDate(p.fcDelivery):"";
  }catch(e){}
  return "";
}
// A milestone / document cell, as data (drawn by the screen and by the print from the same
// object), in two parts: on top what is to be done — the action and its deadline (only the
// next milestone of the row is coloured) — and below, the real status today.
//   kind: done | doneLate | next | todo | none | na
//   act: "To be approved" / "✓ Approved 30 Jul 26"; due: "by 7 Dec 26 · 25 d left"
//   real: the status today; realFg: its colour (forecast delivery); cli: client answer pill
function _ppDaysTo(due,now){return Math.round((parseISODate(due)-parseISODate(now))/86400000);}
// Latest date to (re)submit a document so that the client's answer lands by the approval
// deadline: the same clock as docResponseDue (calendar days): SD approval time for shop
// drawings, ACC approval time for ACC / Aconex, client answer time for the others.
function ppSubmitBy(kind,lat){
  if(!isValidDate(lat))return "";
  return subDur(lat,docClientKey(kind));
}
// WMS / ITP: submitted wms/itpBeforeStart days before the start on site (the package sheet's
// rule), answered within the client answer time.
function ppQualityDue(p,k){
  if(!p||!p.need)return {sub:"",appr:""};
  var sub=subDur(p.need,k==="wms"?"wmsBeforeStart":"itpBeforeStart");
  return {sub:sub,appr:addDur(sub,docClientKey(k))};
}
function ppQualityTip(p,k,qd){
  return ["How this deadline is worked out:","Need on site "+ppDay(p.need),
    "− "+k.toUpperCase()+" before start "+durShort(k==="wms"?"wmsBeforeStart":"itpBeforeStart")+" (Settings › Durations)",
    "= to submit by "+ppDay(qd.sub),"+ client answer "+durShort(docClientKey(k))+" = approved by "+ppDay(qd.appr)].join("\n");
}
// How a deadline is worked back from the need on site, step by step, for the tooltips:
// need − float − transport − fabrication … = the milestone; then, for a document still to be
// (re)submitted, − the client's answer time = the submission deadline.
var PP_LEAD_SRC={settings:"Settings › Durations",pkg:"typed on this package",manual:"lead time typed in the sheet − transport",materials:"longest material lead time",route:"internal approval",template:"template"};
function ppChainTip(p,ms,subKind,submitBy){
  if(!p||!p.need||!p.leads||ms==="need")return "";
  var out=["How this deadline is worked out:","Need on site "+ppDay(p.need)];
  function src(L){return (PP_LEAD_SRC[L.src]||L.src)+(L.src==="template"?" "+ppTypeLabel(p.type||""):"");}
  for(var i=PP_STEPS.length-1;i>=0;i--){
    var s=PP_STEPS[i],L=p.leads[s.k]||{days:0};
    if(s.k==="sd")continue;                                 // drawn with MAR / MSS below
    if(s.k==="submittals"){
      var S=p.leads.sd||{days:0};
      out.push("− the longer of MAR / MSS "+ppLeadTxt(L)+" ("+src(L)+") and SD "+ppLeadTxt(S)+" ("+src(S)+"), in parallel");
    }else out.push("− "+s.label+" "+ppLeadTxt(L)+" ("+src(L)+")");
    var from=s.k==="fab"?"sdok":ppStepFrom(i);
    if(from===ms||(s.k==="fab"&&ms==="submittals"))break;
  }
  out.push("= "+(PP_MS_LABEL[ms]||ms)+" by "+ppDay(p.latest[ms]));
  if(subKind&&submitBy&&submitBy!==p.latest[ms]){
    var lbl=(subKind==="sd"?"SD approval ":docAccClock(subKind)?"client approval ":"client answer ")+durShort(docClientKey(subKind));
    out.push("− "+lbl+" (Settings › Durations)");
    out.push("= to submit by "+ppDay(submitBy));
  }
  out.push("Lead times: Submissions › Procurement plan card of the package, or Settings › Durations › templates.");
  return out.join("\n");
}
// Numbers of the documents (reference typed at submission, else the one of the latest
// revision), one after the other, for the bottom of the cell.
// An Aconex reference such as BIK-MAR-030-XX-32922 is shown by its last number only (32922);
// the full reference stays in the tooltip.
function ppShortRef(r){
  r=String(r||"").trim();
  var m=r.match(/-(\d{3,})$/);
  return m&&r.split("-").length>=3?m[1]:r;
}
function ppDocRefs(td,docs,full){
  var out=[];
  (docs||[]).forEach(function(d){
    var r="";
    try{r=docCurRef(td,d);}catch(e){}
    if(!r){var cs=d.cycles||[];for(var i=cs.length-1;i>=0&&!r;i--)r=String(cs[i].ref||"").trim();}
    if(r&&!full)r=ppShortRef(r);
    if(r&&out.indexOf(r)<0)out.push(r);
  });
  return out.join(", ");
}
function ppTodoCell(p,ms,act,due,real,o,now){
  o=o||{};
  var c={act:act,real:real||"",realFg:o.realFg||"",cli:o.cli||null,tip:o.tip||"",refs:o.refs||"",refsFull:o.refsFull||""};
  if(!isValidDate(due)){c.kind="none";c.due="";return c;}
  var n=_ppDaysTo(due,now);
  c.due="by "+ppDay(due)+(p.status==="past"?"":" · "+ppDaysText(n));
  if(ppShownNext(p)===ms){
    var st=PP_STATUS[n<0?"late":n<=14?"soon":"ok"];
    c.kind="next";c.fg=st.fg;c.bg=st.bg;
  }else c.kind="todo";
  return c;
}
function ppDoneCell(act,ad,lat,extra,tip){
  var over=!!(ad&&lat&&ad>lat);
  return {kind:over?"doneLate":"done",act:act,due:"",real:[extra,ppDoneVs(ad,lat)].filter(Boolean).join(" · "),tip:tip||""};
}
var PP_MS_DONE={start:"Started",issue:"Issued",approved:"Approved",contract:"Signed",delivered:"Delivered"};
function ppMsCell(td,p,m,now){
  now=now||today();
  var lat=p.latest[m]||"",a=p.actual[m];
  if(p.closed&&!(a&&(isValidDate(a.date)||a.done)))return {kind:"na",act:"N/A",due:"",real:"",tip:PP_MS_LABEL[m]+": procurement closed — "+procClosedLabel(p.closed)};
  if(a&&a.na)return {kind:"na",act:"N/A",due:"",real:"",tip:PP_MS_LABEL[m]+": not applicable"+((m==="ready"||m==="delivered")&&ppNoDelivery(td)?" (manpower — no delivery)":" (set to N/A in the package sheet)")};
  if(p.done[m]){
    var ad=a&&isValidDate(a.date)?a.date:"";
    var extra=m==="approved"?(function(){try{return tenderRouteLabel(td);}catch(e){return "";}})():"";
    var lbl=m==="contract"&&a&&a.po?"PO placed":PP_MS_DONE[m]||"Done";
    if(m==="approved"){var dc=ppDoneCell("✓ "+lbl+(ad?" "+ppDay(ad):""),ad,lat,extra,PP_MS_LABEL[m]+" reached"+(ad?" "+fmtDate(ad):"")+(lat?" · deadline "+fmtDate(lat):""));
      try{var _ad=tenderDocs(td).filter(function(d){return d.id==="acc";});dc.refs=ppDocRefs(td,_ad);dc.refsFull=ppDocRefs(td,_ad,true);}catch(e){}
      return dc;}
    return ppDoneCell("✓ "+lbl+(ad?" "+ppDay(ad):""),ad,lat,extra,
      PP_MS_LABEL[m]+" reached"+(ad?" "+fmtDate(ad):"")+(lat?" · deadline "+fmtDate(lat):""));
  }
  var real=ppMsInfo(td,m,p,now),act="",due=lat,o={};
  try{
    if(m==="start")act="To start";
    else if(m==="issue")act="To issue";
    else if(m==="approved"){
      var route=tenderApprovalRoute(td).route,rl=tenderRouteLabel(td);
      var acc=tenderDocs(td).find(function(d){return d.id==="acc";}),s=acc?docSummary(acc,now):{state:"none"};
      if(p.next==="bids"){act="Bids to receive";due=p.latest.bids||lat;}
      else if(p.next==="recommend"){act=route==="none"?"To award":"To submit ("+rl+")";due=p.latest.recommend||lat;}
      else if(s.state==="pending")act="To be approved ("+rl+")";
      else if(s.state==="returned"){act="To resubmit ("+rl+")";due=ppSubmitBy("acc",lat);}
      else act=route==="none"?"To approve (internal)":"To be approved ("+rl+")";
      if(acc){o.cli=ppClientDue([acc],now);o.refs=ppDocRefs(td,[acc]);o.refsFull=ppDocRefs(td,[acc],true);}
    }
    else if(m==="contract"){
      var pur=(td.purchases||[]).filter(Boolean),ty=ppType(td);
      act=pur.length&&(ty==="material"||ty==="equipment")?"PO to place":"To sign";
      if(!real)real="Not started";
    }
    else if(m==="delivered"){
      if(p.next==="ready"){act="To ship";due=p.latest.ready||lat;}else act="To deliver";
      real="";
      if(p.fcDelivery){
        var dd=isValidDate(lat)?_ppDaysTo(p.fcDelivery,lat):0;
        real="Forecast "+ppDay(p.fcDelivery)+(dd>0?" · "+dd+" d after deadline":"");
        // never green when the forecast lands after its deadline — even for a package already
        // started (status Started is never counted late, but the colour must not say "fine")
        o.realFg=p.deliveryLate?"#b3302a":p.deliveryTight||dd>0?"#b35c00":"#1e6b3a";
      }
    }
  }catch(e){}
  if(!act)act="To do";
  o.tip=isValidDate(due)?"To do: "+act.toLowerCase()+" by "+fmtDate(due)+(due!==lat&&lat?" ("+PP_MS_LABEL[m]+" deadline "+fmtDate(lat)+")":""):
    "No need on site: nothing can be worked back";
  if(isValidDate(due))o.tip+="\n\n"+ppChainTip(p,m===p.next||ppShownNext(p)!==m?m:p.next,"","");
  if(p.fcDelivery&&m==="delivered")o.tip+="\nForecast delivery "+fmtDate(p.fcDelivery)+(p.deliveryLate?" — after the week of the need on site":p.deliveryTight?" — after the latest delivery date: float used up":"");
  if(o.cli)o.tip+="\n"+o.cli.tip;
  return ppTodoCell(p,m,act,due,real,o,now);
}
function ppMsCellHtml(c){
  var top=c.act||c.due?'<div class="ppc-top"'+(c.kind==="next"?' style="background:'+c.bg+';border-color:'+c.fg+';color:'+c.fg+'"':'')+'>'+
    (c.act?'<div class="act">'+esc(c.act)+'</div>':'')+(c.due?'<div class="due">'+esc(c.due)+'</div>':'')+'</div>':'';
  var bot=c.real||c.cli?'<div class="ppc-real">'+
    (c.real?'<div'+(c.realFg?' style="color:'+c.realFg+';font-weight:700"':'')+'>'+esc(c.real)+'</div>':'')+
    (c.cli?'<div class="l3 '+(c.cli.late?'late':'ok')+'" title="'+esc(c.cli.tip||"")+'">'+esc(c.cli.txt)+'</div>':'')+'</div>':'';
  var ref=c.refs?'<div class="ppc-ref" title="'+esc(c.refsFull||c.refs)+'">'+esc(c.refs)+'</div>':'';
  return '<div class="ppc ppc-'+c.kind+'" title="'+esc(c.tip||"")+'">'+(top||bot?top+bot:'&nbsp;')+ref+'</div>';
}
// Where the package is now (who holds it, since when) and the step after it — tenderStage.
function ppStageOf(td,now){try{return tenderStage(td,now);}catch(e){return {text:"",who:"us",days:null,next:""};}}
function ppNowText(s){return (s.text||"")+(s.days!==null&&s.days!==undefined&&s.days>=0?" · "+s.days+" d":"");}
function ppWhoHtml(s){
  if(!s||!s.text)return "";
  var col=STAGE_WHO_COL[s.who]||STAGE_WHO_COL.us;
  return '<div class="pp-who" style="color:'+col+'" title="Held by: '+esc(STAGE_WHO_LABEL[s.who]||"Us")+'"><i style="background:'+col+'"></i><span>'+esc(ppNowText(s))+
    (s.overdue?' <b style="color:#b3302a">· '+esc(fmtOverdue(s.overdue))+'</b>':'')+'</span></div>';
}
function ppProposed(td){return (Number(td.accAmountSubcontract)||0)+(Number(td.accAmountOther)||0);}
// Totals of the rows shown — the five figures of the former Package list.
// Finance of the Package list: Budget, Proposed, Instructed and the variance Budget − Instructed
// (only for a package with both a budget and an instructed amount).
function ppInstructed(td){var n=Number(td&&td.instructionAmount);return isFinite(n)&&n>0?n:0;}
function ppVariance(td){var b=ppBudget(td),i=ppInstructed(td);return b&&i?b-i:null;}
function ppFinanceTotals(vis){
  var t={budget:0,proposed:0,instructed:0,variance:0,nVar:0};
  vis.forEach(function(r){
    t.budget+=ppBudget(r.td);t.proposed+=ppProposed(r.td);t.instructed+=ppInstructed(r.td);
    var v=ppVariance(r.td);if(v!==null){t.variance+=v;t.nVar++;}
  });
  return t;
}
function ppNum(n){n=Number(n)||0;return n?n.toLocaleString():"—";}
function ppSigned(n){return (n>0?"+":n<0?"−":"")+Math.abs(n).toLocaleString();}
// ---- timeline strip (screen and print) ----
function ppGanttX(model,d){var f=_ppDay(model.from),t=_ppDay(model.to);return (_ppDay(d)-f)/Math.max(1,t-f)*100;}
var PP_SVG_FLAG='<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style="display:block"><path d="M2 0.8v10.6" stroke="#6f6b62" stroke-width="1.5" stroke-linecap="round"/><path d="M2.7 1.2h7.6l-2.2 2.4 2.2 2.4H2.7z" fill="#6f6b62"/></svg>';
function ppSvgTruck(c){
  return '<svg width="15" height="11" viewBox="0 0 16 12" aria-hidden="true" style="display:block;flex-shrink:0"><path d="M0.5 1.5h9.5v6.5H0.5z M10 3.8h3.2l2.3 2.7v1.5H10z" fill="'+c+'"/>'+
    '<circle cx="3.8" cy="9.6" r="1.7" fill="'+c+'" stroke="#fff" stroke-width="0.9"/><circle cx="12.2" cy="9.6" r="1.7" fill="'+c+'" stroke="#fff" stroke-width="0.9"/></svg>';
}
// Legend of the timelines, drawn with the same symbols as the strips under the rows
// (kind "strip") or the Timeline chart (kind "gantt"). Screen (top of the table, can be
// folded, localStorage pp_procplan_leg) and print.
var PP_STEP_SHORT={prep:"Tender documents",bidding:"Bidding",evaluation:"Evaluation",approval:"Approval (internal / ACC / Aconex)",
  contract:"Contract / PO",submittals:"MAR / MSS / WMS / ITP",sd:"Shop drawings",fab:"Fabrication",transport:"Transport",buffer:"Float before start"};
function ppLegendHtml(kind){
  function it(sym,txt){return '<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap">'+sym+'<span>'+txt+'</span></span>';}
  var box='<div class="ppleg" style="display:flex;flex-wrap:wrap;align-items:center;gap:5px 16px;border:1px solid #e3dfd6;border-radius:8px;background:#fff;padding:6px 12px;font-size:11px;color:#4a4740;line-height:1.4">';
  var flag=PP_SVG_FLAG.replace('display:block','display:inline-block;vertical-align:middle');
  var today=it('<i style="display:inline-block;width:0;height:12px;border-left:2px solid #172a42"></i>',"today");
  if(kind!=="gantt"){
    // table: where we are, how late, where it lands
    return box+
      it('<i style="display:inline-block;width:24px;height:8px;border-radius:2px;background:#e6f2e9;box-shadow:inset 0 0 0 1.5px #1e6b3a"></i>',"step in progress (until its latest date)")+
      it('<i style="display:inline-block;width:18px;height:8px;border-radius:2px;background:repeating-linear-gradient(45deg,#b3302a,#b3302a 2px,#f6d5d8 2px,#f6d5d8 5px)"></i>',"delay: days past that date")+
      it('<i style="display:inline-block;width:22px;border-top:2px dashed #6f6b62"></i><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1e6b3a"></i><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#b3302a"></i>',"projection: arrival on site (green on time · red late)")+
      it(flag,"need on site")+today+
      '<span style="color:#9b968b">The history of every step is in the <b>Timeline</b> view.</span></div>';
  }
  // timeline (history): one colour per step + reached milestones
  return box+
    PP_GANTT_GROUPS.map(function(gr){
      var k=gr.steps[gr.steps.length-1];
      var bg=k==="buffer"?'repeating-linear-gradient(45deg,#ece9e2,#ece9e2 3px,#f7f6f2 3px,#f7f6f2 6px);border:1px solid #ddd9cf':PP_GANTT_COL[k];
      return it('<i style="display:inline-block;width:16px;height:9px;border-radius:2px;background:'+bg+'"></i>',esc(gr.label));
    }).join("")+
    it('<i style="display:inline-block;width:8px;height:8px;transform:rotate(45deg);background:#1e6b3a;margin:0 2px"></i>',"reached")+
    it('<i style="display:inline-block;width:0;height:12px;border-left:2px solid #16181d"></i>',"need on site")+
    it('<i style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid #1e6b3a"></i>',"delivery")+
    today+'<span style="color:#9b968b">Faded = done · framed = current step</span></div>';
}
// ---- Table strip: now, delay, projection -------------------------------------------------
// Under each row of the table only three things: the step in progress (between its two
// latest dates), how late it is (days past its latest end), and where the package lands:
// the need date pushed by that delay, or the delivery forecast once the order is placed.
// The history of every step stays in the Timeline view (ppGanttModel / ProcPlanGantt).
function _ppDiff(a,b){return Math.round((parseISODate(b)-parseISODate(a))/86400000);}
function ppNowInfo(p,now){
  now=now||today();
  if(!p||!p.need)return {kind:"none"};
  if(p.status==="cancelled")return {kind:"none"};
  if(p.status==="past")return {kind:"past",need:p.need};
  if(!p.next||p.status==="done")return {kind:"done",need:p.need,proj:p.deliveredOn||p.fcDelivery||""};
  var i=PP_STEPS.findIndex(function(s){return s.ms===p.next;});
  var step=i>=0?PP_STEPS[i]:null,prevMs=i<0?"start":ppStepFrom(i);
  var to=p.latest[p.next]||"",from=p.next==="start"?addCalDays(to,-7):(p.latest[prevMs]||to);
  var late=isValidDate(to)&&to<now?_ppDiff(to,now):0;
  var proj,projKind,gap;
  if(p.fcDelivery&&(p.next==="ready"||p.next==="delivered")){
    proj=p.fcDelivery;projKind="delivery";gap=p.latest.delivered?_ppDiff(p.latest.delivered,p.fcDelivery):0;
  }else{
    proj=addCalDays(p.need,late);projKind="site";gap=late;
  }
  return {kind:"run",label:step?step.label:"Tender documents (not started)",from:from,to:to,late:late,daysLeft:p.daysLeft,
    proj:proj,projKind:projKind,gap:gap,need:p.need,status:p.status};
}
// Text of the left cell under the row: Now · delay → projection.
function ppNowHtml(n){
  if(!n||n.kind==="none")return '<span style="color:#9b968b">No need date: nothing to plan</span>';
  if(n.kind==="past")return '<span style="color:#6f6b62">Started on site '+fmtDate(n.need)+'</span>';
  if(n.kind==="done")return '<span style="color:#1e6b3a;font-weight:600">All milestones reached</span>'+(n.proj?' <span style="color:#6f6b62">· delivered / due '+fmtDate(n.proj)+'</span>':'');
  var lateTxt=n.late>0?'<b style="color:#b3302a">'+n.late+' d late</b>':n.daysLeft!==null&&n.daysLeft!==undefined?'<span style="color:'+(n.daysLeft<=14?'#b35c00':'#1e6b3a')+'">'+n.daysLeft+' d left</span>':'';
  var pc=n.gap>0?'#b3302a':'#1e6b3a';
  var projTxt='→ '+(n.projKind==="delivery"?"delivery ":"on site ")+'<b style="color:'+pc+'">'+fmtDate(n.proj)+'</b>'+
    (n.gap>0?' <b style="color:#b3302a">(+'+n.gap+' d)</b>':' <span style="color:#1e6b3a">on time</span>');
  return '<span style="color:#172a42">Now: <b>'+esc(n.label)+'</b></span>'+(lateTxt?' · '+lateTxt:'')+' <span style="white-space:nowrap">'+projTxt+'</span>';
}
// Scale of the table strips: from a little before today to the latest projection.
function ppNowModel(vis,now){
  now=now||today();
  var rows={},lo=addCalDays(now,-21),hi=addCalDays(now,60);
  vis.forEach(function(r){
    var n=ppNowInfo(r.p,now);rows[r.td.id]=n;
    if(n.kind!=="run")return;
    [n.from,n.to,n.proj,n.need].forEach(function(d){if(!isValidDate(d))return;if(d<lo)lo=d;if(d>hi)hi=d;});
  });
  var minLo=addCalDays(now,-120),maxHi=addCalDays(now,730);
  if(lo<minLo)lo=minLo;if(hi>maxHi)hi=maxHi;
  var a=parseISODate(addCalDays(lo,-7)),b=parseISODate(addCalDays(hi,14));
  var from=toISO(new Date(a.getFullYear(),a.getMonth(),1)),to=toISO(new Date(b.getFullYear(),b.getMonth()+1,1));
  var f0=_ppDay(from),span=Math.max(1,_ppDay(to)-f0);
  function x(d){return (_ppDay(d)-f0)/span*100;}
  var months=[],cur=parseISODate(from),k=0;
  while(toISO(cur)<to&&k++<40){
    months.push({iso:toISO(cur),left:x(toISO(cur)),label:PP_MONTHS[cur.getMonth()]+(cur.getMonth()===0||months.length===0?" "+String(cur.getFullYear()).slice(2):""),jan:cur.getMonth()===0});
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  var every=months.length>24?3:months.length>14?2:1;
  months.forEach(function(m,i){m.show=i%every===0;});
  var t=x(now);
  return {from:from,to:to,months:months,rows:rows,x:x,today:t>=0&&t<=100?t:null};
}
function ppNowStripHtml(n,model){
  if(!n||!model)return "";
  var x=model.x;
  function pos(d){return Math.max(0,Math.min(100,x(d)));}
  var h='<div class="pps"><span class="pps-base"></span>';
  if(n.kind==="run"){
    var st=PP_STATUS[n.status]||PP_STATUS.ok;
    var l=pos(n.from),r=pos(n.to);
    if(r>l)h+='<span title="'+esc(n.label+": latest window "+fmtDate(n.from)+" → "+fmtDate(n.to))+'" style="position:absolute;top:4px;height:8px;border-radius:2px;left:'+l.toFixed(2)+'%;width:'+(r-l).toFixed(2)+'%;background:'+st.bg+';box-shadow:inset 0 0 0 1.5px '+st.fg+'"></span>';
    var now=today();
    if(n.late>0){var a=pos(n.to),b=pos(now);
      if(b>a)h+='<span title="'+esc(n.late+" d past the latest date of "+n.label)+'" style="position:absolute;top:4px;height:8px;left:'+a.toFixed(2)+'%;width:'+(b-a).toFixed(2)+'%;background:repeating-linear-gradient(45deg,#b3302a,#b3302a 2px,#f6d5d8 2px,#f6d5d8 5px);border-radius:0 2px 2px 0"></span>';}
    var p0=pos(n.late>0?now:n.to),p1=pos(n.proj),pc=n.gap>0?"#b3302a":"#1e6b3a";
    if(p1>p0)h+='<span style="position:absolute;top:7px;left:'+p0.toFixed(2)+'%;width:'+(p1-p0).toFixed(2)+'%;border-top:2px dashed #9b968b"></span>';
    h+='<span title="'+esc("Projected "+(n.projKind==="delivery"?"delivery ":"arrival on site ")+fmtDate(n.proj)+(n.gap>0?" — "+n.gap+" d late":" — on time"))+'" style="position:absolute;top:3px;left:'+p1.toFixed(2)+'%;margin-left:-5px;width:10px;height:10px;border-radius:50%;background:'+pc+';border:1.5px solid #fff;box-shadow:0 0 0 1px '+pc+';z-index:3"></span>';
  }
  if(isValidDate(n.need)){var nd=x(n.need);if(nd>=0&&nd<=100)h+='<span class="pps-nd" title="'+esc("Need on site "+fmtDate(n.need))+'" style="left:'+nd.toFixed(2)+'%">'+PP_SVG_FLAG+'</span>';}
  if(model.today!==null)h+='<span class="pps-td" style="left:'+model.today.toFixed(3)+'%"></span>';
  return h+'</div>';
}
function ppScaleHtml(model){
  if(!model)return "";
  var h='<div class="pps-sc">';
  model.months.forEach(function(m){if(m.show)h+='<span class="mo'+(m.jan?' jan':'')+'" style="left:'+m.left.toFixed(3)+'%">'+esc(m.label)+'</span>';});
  if(model.today!==null)h+='<span class="tdl" style="left:'+model.today.toFixed(3)+'%">TODAY '+esc(fmtDate(today()))+'</span>';
  return h+'</div>';
}
var PP_TABLE_CSS=
  '.ppt th,.ppt td{border-right:1px solid #e6e2d9}'+
  '.ppt th:last-child,.ppt td:last-child{border-right:none}'+
  '.ppt th.sep,.ppt td.sep{border-left:1.5px solid #c7d5e6}'+
  '.ppt td{vertical-align:top}'+
  '.ppt tr.ppt-g th{background:#f4f6fa;font-size:10px;letter-spacing:.08em;padding:5px 10px;border-bottom:1px solid #c7d5e6}'+
  // Widths: the cells must never be squeezed to a sliver (text stacked word by word). Words
  // break only between words (break-word, not anywhere: "anywhere" lets the browser shrink a
  // column to almost nothing and cut "ACONEX" in two).
  '.ppt td.ms{padding:4px 5px;min-width:118px;max-width:150px}'+
  '.ppt td.ms.sub{min-width:112px;max-width:140px}'+
  // the screen table scrolls inside its own box: the sideways scrollbar stays at the bottom
  // of the window and the headers stay on top (ppt-wrap; not in print)
  '.ppt-wrap{overflow:auto;max-height:calc(100vh - 170px);border:1px solid #e6e2d9;border-radius:6px}'+
  '.ppt-wrap .ppt{margin:0;overflow:visible!important}'+
  '.ppt-wrap .ppt thead{position:sticky;top:0;z-index:5}'+
  '.ppt-wrap .ppt thead th,.ppt-wrap .ppt thead td{background:#eef2f8}'+
  '.ppt-wrap .ppt thead tr.ppt-g th{background:#f4f6fa}'+
  '.ppt-wrap .ppt thead tr.ppt-scale td{background:#fafaf8}'+
  '@media(max-width:768px){.ppt-wrap{max-height:none}}'+
  // thicker scrollbars on the table box and on the bar fixed at the bottom of the screen
  '.ppt-wrap::-webkit-scrollbar,.pp-fscroll::-webkit-scrollbar{height:16px;width:12px}'+
  '.ppt-wrap::-webkit-scrollbar-track,.pp-fscroll::-webkit-scrollbar-track{background:#eef2f8}'+
  '.ppt-wrap::-webkit-scrollbar-thumb,.pp-fscroll::-webkit-scrollbar-thumb{background:#8ea6c4;border-radius:8px;border:3px solid #eef2f8}'+
  '.ppt-wrap::-webkit-scrollbar-thumb:hover,.pp-fscroll::-webkit-scrollbar-thumb:hover{background:#5f7ea6}'+
  '.ppt-wrap,.pp-fscroll{scrollbar-color:#8ea6c4 #eef2f8}'+
  // the Package column stays on the left while the table scrolls sideways
  '.ppt-wrap .ppt tr>:first-child{position:sticky;left:0;z-index:2;background:#fff;box-shadow:inset -1px 0 0 #d9d5ca}'+
  '.ppt-wrap .ppt tbody tr[style]>:first-child{background:inherit}'+
  '.ppt-wrap .ppt thead tr>:first-child{z-index:6;background:#eef2f8}'+
  '.ppt-wrap .ppt thead tr.ppt-g>:first-child{background:#f4f6fa}'+
  '.ppt-wrap .ppt thead tr.ppt-scale>:first-child{background:#fafaf8}'+
  '.ppt.ppt-tl tr.ppt-main td{border-bottom:none}'+
  '.ppt tr.ppt-strip td{border-right:none;border-left:none;padding-top:0;padding-bottom:7px}'+
  '.ppt tr.ppt-strip td.nx{font-size:11px;color:#6f6b62;line-height:1.35}'+
  '.ppt tr.ppt-scale td{background:#fafaf8;border-right:none;border-left:none;padding-top:4px;padding-bottom:4px}'+
  '.pp-act .pp-act-x{visibility:hidden}.pp-act:hover .pp-act-x{visibility:visible}'+
  '.ppc{border-radius:6px;min-height:34px;box-sizing:border-box;line-height:1.3;overflow-wrap:break-word}'+
  '.ppc-top{padding:2px 6px;border-radius:6px;border:1.5px solid transparent}'+
  '.ppc-top .act{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#4a4740}'+
  '.ppc-top .due{font-size:10.5px;color:#6f6b62}'+
  '.ppc-next .ppc-top .act,.ppc-next .ppc-top .due{color:inherit;font-weight:700}'+
  '.ppc-todo .ppc-top .act{color:#6f6b62}'+
  '.ppc-done .ppc-top .act,.ppc-doneLate .ppc-top .act,.ppc-na .ppc-top .act{text-transform:none;letter-spacing:0;font-size:11.5px}'+
  '.ppc-done .ppc-top .act{color:#1e6b3a}'+
  '.ppc-doneLate .ppc-top .act{color:#b35c00}'+
  '.ppc-none .ppc-top .act{color:#b9b4a8}'+
  '.ppc-na .ppc-top .act{color:#9b968b}'+
  '.ppc-ref{margin:2px 6px 0;font-family:var(--font-mono,monospace);font-size:9.5px;color:#5f7ea6;overflow-wrap:break-word}'+
  '.ppc-real{margin:2px 6px 0;padding:2px 0 1px;border-top:1px dashed #d9d5ca;font-size:10.5px;color:#8a857a}'+
  '.ppc .l3{font-size:10.5px;font-weight:700;margin:2px 0 0;padding:0 4px;border-radius:4px;background:#fff;display:inline-block}'+
  '.ppc .l3.ok{color:#1e6b3a;box-shadow:inset 0 0 0 1px #9cc9a8}'+
  '.ppc .l3.late{color:#fff;background:#b3302a}'+
  '.pp-who{font-size:10.5px;margin-top:3px;display:flex;gap:5px;align-items:baseline;line-height:1.3}'+
  '.pp-who i{width:7px;height:7px;border-radius:50%;flex-shrink:0;display:inline-block}'+
  '.pps{position:relative;height:16px;min-width:200px}'+
  '.pps-base{position:absolute;left:0;right:0;top:7px;height:1px;background:#e3dfd6}'+
  '.pps-sg{position:absolute;top:5px;height:6px;border-radius:2px}'+
  '.pps-sg.done{opacity:.4}'+
  '.pps-sg.overdue{box-shadow:0 0 0 1.5px #b3302a}'+
  '.pps-mk{position:absolute;top:4px;width:7px;height:7px;margin-left:-4.5px;transform:rotate(45deg);border:1px solid #fff;background:#1e6b3a;z-index:2}'+
  '.pps-mk.late{background:#b35c00}'+
  '.pps-dl{position:absolute;top:3px;width:7px;height:7px;margin-left:-5.5px;border-radius:50%;border:2px solid #172a42;background:#fff;z-index:3}'+
  '.pps-nd{position:absolute;top:2px;margin-left:-2px;z-index:3}'+
  '.pps-fc{position:absolute;top:2px;z-index:3;display:flex;align-items:center;gap:2px;white-space:nowrap;transform:translateX(-8px);font-size:9.5px;line-height:12px}'+
  '.pps-fc.rt{flex-direction:row-reverse;transform:translateX(calc(-100% + 8px))}'+
  '.pps-fc b{background:rgba(255,255,255,.9);border-radius:3px;padding:0 3px}'+
  '.pps-td{position:absolute;top:-4px;bottom:-4px;border-left:2px solid #172a42;margin-left:-1px;z-index:4}'+
  '.pps-sc{position:relative;height:16px;min-width:200px;font-size:9.5px;color:#6f6b62;font-family:var(--font-mono,monospace)}'+
  '.pps-sc .mo{position:absolute;top:2px;border-left:1px solid #d9d5ca;padding-left:3px;white-space:nowrap;line-height:12px}'+
  '.pps-sc .mo.jan{border-left-color:#9b968b;color:#172a42;font-weight:600}'+
  '.pps-sc .tdl{position:absolute;top:1px;transform:translateX(-50%);background:#172a42;color:#fff;font-size:9px;font-weight:700;border-radius:3px;padding:0 5px;line-height:13px;white-space:nowrap;z-index:5}';

// Printable Package table: the rows shown on screen (same filters, same order).
// mode "timeline" prints the Gantt; otherwise the table with the chosen column set
// (opts.cols), page size (opts.paper A4 | A3, landscape) and the timeline strips (opts.tl).
function ppOpenReport(vis,filterLabel,mode,grouped,acts,opts){
  acts=acts||{};opts=opts||{};
  var cols=ppColsNorm(opts.cols);
  var paper=opts.paper==="A3"?"A3":"A4",withTl=!!opts.tl;
  var plan=ppColsHas(cols,"plan"),fin=ppColsHas(cols,"finance"),fol=ppColsHas(cols,"follow");
  var now=today();
  var css='<style>@page{size:'+paper+' landscape;margin:9mm 8mm 10mm}body{max-width:none}'+
    '.pp h1{font-size:19px;margin:0 0 2px}.pp .sub{color:#666;font-size:11px;margin-bottom:8px}'+
    '.pp .kpis{display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap}.pp .k{border:1px solid #e6e2d8;border-radius:6px;padding:4px 10px;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.04em}'+
    '.pp .k b{display:block;font-size:15px;color:#14171c;letter-spacing:0}.pp .k small{display:block;font-size:9px;text-transform:none;letter-spacing:0;color:#888}'+
    '.pp .fin{font-size:10.5px;color:#666;margin-bottom:10px;display:flex;gap:16px;flex-wrap:wrap}.pp .fin b{color:#14171c;font-family:"IBM Plex Mono",monospace}'+
    '.pp .leg{font-size:9px;color:#777;margin-top:8px}.pp thead{display:table-header-group}@media print{.pp tr,.pp .ppg-row{break-inside:avoid}}'+
    '.pp table.ppt{border-collapse:collapse;font-size:11px;border:1px solid #ddd9cf}'+
    '.pp .ppt th,.pp .ppt td{border-bottom:1px solid #e6e2d8;padding:5px 6px;text-align:left}'+
    '.pp .ppt th{background:#e9eff7;font-weight:700;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}'+
    '.pp .ppt td.r,.pp .ppt th.r{text-align:right}.pp .ppt .mono{font-family:"IBM Plex Mono",monospace}.pp .ppt .sm{font-size:10px;color:#6f6b62}'+
    '.pp .ppt .pill{display:inline-block;border-radius:8px;padding:0 6px;font-weight:700;font-size:10px}.pp .ppt .dd{font-size:10px;font-weight:700;margin-top:2px}'+
    '.pp .ppt tr.s21 td{background:#fdf1e0}.pp .ppt tr.ppt-main.s21 td:first-child{box-shadow:inset 3px 0 0 #b35c00}'+
    '.pp .ppt tr.aok td{background:#e6f2e9}.pp .ppt tr.ppt-main.aok td:first-child{box-shadow:inset 3px 0 0 #1e6b3a}.pp .ppt td.a{min-width:120px;font-size:10px}.pp .ppt td.b{color:#b3302a;font-weight:600}'+
    '.pp .ppt tr.g td{background:#fafaf8;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:10px}'+
    PP_TABLE_CSS+PP_GANTT_CSS+'.pp .ppg{min-width:0}.pp .ppg-l{flex-basis:230px;width:230px;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;padding:3px 8px}'+
    '.pp .ppg-l .t{white-space:normal;flex:none;font-size:10.5px;line-height:1.2}.pp .ppg-l .ppg-st{font-size:8.5px}.pp .ppg-hd .ppg-l{flex-direction:row;align-items:center}.pp .ppg-ov{left:230px}</style>';
  var html=css+'<div class="pp">';
  html+='<h1>Riviera Tower — Packages</h1><div class="sub">Printed '+fmtDate(now)+' · '+vis.length+' package'+(vis.length>1?"s":"")+
    (filterLabel?' · '+esc(filterLabel):'')+(mode==="timeline"?' · Timeline':' · Columns: '+esc(ppColsLabel(cols))+(withTl?' · with timelines':''))+'</div>';
  html+='<div class="kpis">'+PP_KPIS.map(function(k){
    var l=vis.filter(function(r){return ppKpiOf(r,k.k);});
    var b=l.reduce(function(s,r){return s+ppBudget(r.td);},0);
    var col=k.cls==="bad"?PP_STATUS.late.fg:k.cls==="warn"?PP_STATUS.soon.fg:k.cls==="good"?PP_STATUS.ok.fg:"#14171c";
    return '<div class="k">'+esc(k.label)+'<b style="color:'+col+'">'+l.length+'</b>'+(fin?'<small>'+ppMoney(b)+'</small>':'')+'</div>';
  }).join("")+'</div>';
  var ft=ppFinanceTotals(vis);
  if(fin)html+='<div class="fin"><span>Budget <b>'+ppNum(ft.budget)+'</b></span><span>Proposed <b style="color:#0f5299">'+ppNum(ft.proposed)+'</b></span>'+
    '<span>Instructed <b style="color:#1e6b3a">'+ppNum(ft.instructed)+'</b></span><span>Var. budget − instructed <b style="color:'+(ft.variance<0?'#b3302a':'#1e6b3a')+'">'+(ft.nVar?ppSigned(ft.variance):'—')+'</b>'+
    (ft.nVar?' on '+ft.nVar+' instructed package'+(ft.nVar>1?'s':''):'')+'</span></div>';
  if(mode==="timeline"){
    html+=ppGanttHtml(ppGanttModel(vis,now),grouped).replace('<div class="ppg-leg">','<div class="ppg-leg leg">');
    html+='<div class="leg">Each bar is a step between its two LATEST dates, worked back from the need on site through the lead time of each step.</div></div>';
    openReport("Packages "+now,html);
    return;
  }
  var model=withTl&&vis.length?ppNowModel(vis,now):null;
  // Finance alone: no Next deadline column (and no timeline strip)
  var dl=plan||fol,nb=2+(fin?1:0)+(dl?2:0);   // Package + Subcontractor; Budget only with Finance; Next deadline + RFI with Plan or Follow-up
  if(!dl)model=null;
  var nCols=nb+(plan?PP_TABLE_COLS.length+1:0)+(fin?3:0)+(fol?4:0);
  var tlSpan=plan?PP_TABLE_COLS.length+1:nCols-nb,tlRest=nCols-nb-tlSpan;
  function tlCells(inner){return '<td colspan="'+tlSpan+'">'+inner+'</td>'+(tlRest>0?'<td colspan="'+tlRest+'"></td>':'');}
  // The table is laid out at screen width, then zoomed to the width of the page.
  var tableW=210+140+(fin?90:0)+(dl?370:0)+(plan?1280:0)+(fin?330:0)+(fol?770:0);
  var pageW=paper==="A3"?1520:1060;
  var zoom=Math.min(1,pageW/tableW);
  html+='<table class="ppt'+(withTl?' ppt-tl':'')+'" style="width:'+Math.max(tableW,Math.round(pageW/zoom))+'px;zoom:'+zoom.toFixed(3)+'"><thead>'+
    '<tr class="ppt-g"><th colspan="'+nb+'">Package</th>'+(plan?'<th colspan="'+PP_TABLE_COLS.length+'" class="sep">Procurement milestones · ✓ reached · “by” = latest date</th><th class="sep">Site</th>':'')+
    (fin?'<th colspan="3" class="sep">Finance</th>':'')+(fol?'<th colspan="4" class="sep">Follow-up</th>':'')+'</tr><tr>'+
    '<th>Package</th><th>Subcontractor</th>'+(fin?'<th class="r">Budget</th>':'')+(dl?'<th>Next deadline</th><th>RFI open</th>':'')+
    (plan?PP_TABLE_COLS.map(function(m,i){return '<th'+(i===0?' class="sep"':'')+'>'+esc(ppColLabel(m))+'</th>';}).join("")+'<th class="sep">Need on site</th>':'')+
    (fin?'<th class="sep r">Proposed</th><th class="r">Instructed</th><th class="r">Var. budget − instructed</th>':'')+
    (fol?'<th class="sep">Owner</th><th>Next steps</th><th>Blocking points</th><th>Notes</th>':'')+'</tr>'+
    (model?'<tr class="ppt-scale"><td colspan="'+nb+'" class="sm">Now · delay → projected arrival</td>'+tlCells(ppScaleHtml(model))+'</tr>':'')+
    '</thead><tbody>';
  function li(l,cls){return l.length?l.map(function(x){return '<div>'+esc(x)+'</div>';}).join(""):'<span style="color:#ccc">—</span>';}
  function line(r){
    var td=r.td,p=r.p,st=PP_STATUS[p.status],allOk=ppAllValid(td,p),soon=!allOk&&ppStartsSoon(p,now),stg=ppStageOf(td,now);
    var a=acts[td.id]||{next:[],block:[],rfi:[]};
    var hcls=allOk?' aok':soon?' s21':'';
    var h='<tr class="ppt-main'+hcls+'"><td><b>'+esc(td.title||"(untitled)")+'</b><div class="sm">'+esc(td.package||"No department")+' · '+esc(ppTypeLabel(ppType(td)))+'</div>'+
      (soon?'<div class="sm" style="color:#b35c00;font-weight:700">starts on site ≤ 21 d</div>':'')+
      (allOk?'<div class="sm" style="color:#1e6b3a;font-weight:700">✓ All validated</div>':'')+'</td>'+
      '<td>'+(ppSubName(td)?'<b>'+esc(ppSubName(td))+'</b>':'<span style="color:#b9b4a8">Not awarded</span>')+'</td>'+
      (fin?'<td class="r mono">'+(ppBudget(td)?ppBudget(td).toLocaleString():"—")+'</td>':'')+
      (dl?'<td><span class="pill" style="background:'+st.bg+';color:'+st.fg+'">'+esc(ppNextAct(p)||st.label)+'</span>'+
        (ppNextAct(p)?'<div class="dd" style="color:'+st.fg+'">'+esc(ppNextBy(p))+'</div>':p.daysLeft!==null?'<div class="dd" style="color:'+st.fg+'">'+ppDaysText(p.daysLeft)+'</div>':'')+ppWhoHtml(stg)+'</td>'+
        '<td class="a">'+(a.rfi.length?a.rfi.map(function(t){var r=ppRfiInfo(t,now);return '<div>'+esc(r.kind+" "+(t.text||""))+'<div class="sm" style="color:'+(r.late?'#b3302a;font-weight:700':r.sent?'#1e6b3a':'#9b968b')+'">'+esc(r.txt)+'</div></div>';}).join(""):'<span style="color:#ccc">—</span>')+'</td>':'');
    if(plan){
      PP_TABLE_COLS.forEach(function(m,i){h+='<td class="ms'+(i===0?' sep':'')+(m.indexOf("sub_")===0?' sub':'')+'">'+ppMsCellHtml(ppColCell(td,p,m,now))+'</td>';});
      h+='<td class="sep" style="white-space:nowrap">'+(p.need?fmtDate(p.need):"—")+'<div class="sm">'+(p.needNext?"next task":tenderScheduleStart(td)?"schedule":p.need?"typed":"")+'</div>'+(p.needPassed?'<div class="sm" style="color:#b3302a;font-weight:700">passed · not started</div>':'')+'</td>';
    }
    if(fin){
      var v=ppVariance(td);
      h+='<td class="sep r mono" style="color:#0f5299">'+ppNum(ppProposed(td))+'</td><td class="r mono" style="color:#1e6b3a">'+ppNum(ppInstructed(td))+'</td>'+
        '<td class="r mono" style="font-weight:700;color:'+(v===null?'#ccc':v<0?'#b3302a':'#1e6b3a')+'">'+(v===null?'—':ppSigned(v))+'</td>';
    }
    if(fol){
      h+='<td class="sep">'+esc(String(td.ownerTender||"—"))+'</td>'+
        '<td class="a">'+li([td.nextStep||""].concat(a.next.map(ppActText)).filter(Boolean))+'</td>'+
        '<td class="a b">'+li(a.block.map(ppActText))+'</td>'+
        '<td class="a">'+li(ppNotesText(td))+'</td>';
    }
    h+='</tr>';
    if(model)h+='<tr class="ppt-strip'+hcls+'"><td colspan="'+nb+'" class="nx">'+ppNowHtml(model.rows[td.id])+'</td>'+tlCells(ppNowStripHtml(model.rows[td.id],model))+'</tr>';
    return h;
  }
  if(grouped)ppGroups(vis).forEach(function(g){
    html+='<tr class="g"><td colspan="'+nCols+'">'+esc(g.dept||"No department")+' · '+g.rows.length+(fin?' · '+ppMoney(g.rows.reduce(function(s,r){return s+ppBudget(r.td);},0)):'')+'</td></tr>';
    g.rows.forEach(function(r){html+=line(r);});
  });
  else vis.forEach(function(r){html+=line(r);});
  html+='</tbody></table><div class="leg">Each milestone cell: top line = what really happened (from the package sheet), bottom line = the LATEST date to reach it, worked back from the need on site through the lead time of each step. '+
    '✓ = reached (green on time, orange later than the latest date). Coloured cell = next milestone (red late, orange ≤ 14 d, green on track). A package whose need date is past is "Started" and never flagged late.'+
    '</div>'+(model?'<div style="margin-top:8px">'+ppLegendHtml("strip")+'</div>':'')+'</div>';
  openReport("Packages "+now,html);
}
// One cell of the Next steps / Blocking points columns: the open actions of the package
// (the same actions as everywhere else — Actions, the package sheet, the zone) and, in Next
// steps, each line of the package's own "Next Step" text (td.nextStep). Every item can be
// ticked done, edited (click) or deleted (✕): a ticked Next Step line becomes a done action
// linked to the package (kept in its history) and leaves the text. + add creates an action.
function ppNextStepLines(td){return String((td&&td.nextStep)||"").split(/\n/).map(function(x){return x.trim();}).filter(Boolean);}
function PpActionsCell({td,list,kind,tasks,saveTasks,noNextStep,wide,updTd}){
  const [open,setOpen]=useState(false);
  const [txt,setTxt]=useState("");
  const [all,setAll]=useState(false);
  const [edit,setEdit]=useState(null);       // {key:"ns:<i>"|<task id>, text}
  var ro=isReadOnly()||!saveTasks;
  var now=today();
  var block=kind==="block";
  var nsLines=!block&&!noNextStep?ppNextStepLines(td):[];
  var nsEditable=!ro&&!!updTd;
  var items=nsLines.map(function(l,i){return {key:"ns:"+i,ns:true,i:i,text:l};})
    .concat(list.map(function(t){return {key:t.id,t:t,text:t.text||""};}));
  var shown=all||wide?items:items.slice(0,3);
  function newAct(o){
    return newTask(Object.assign({tenderRef:td.id,package:td.package||"",tags:block?["Blocking Point"]:[],
      importance:block?3:2,urgence:block?3:2,owner:td.ownerTender||"",note:"From the Package list"},o));
  }
  function add(){
    var v=txt.trim();if(!v||blockIfReadOnly())return;
    saveTasks([newAct({text:v})].concat(tasks||[]));
    setTxt("");setOpen(false);
  }
  function setLines(l){updTd({nextStep:l.join("\n")});}
  function done(it){
    if(blockIfReadOnly())return;
    if(it.ns){
      if(!nsEditable)return;
      saveTasks([newAct({text:it.text,status:"done",completedAt:now,note:"Next Step of the package, done from the Package list"})].concat(tasks||[]));
      setLines(nsLines.filter(function(x,j){return j!==it.i;}));
      return;
    }
    saveTasks((tasks||[]).map(function(x){return x.id!==it.t.id?x:stampModified(Object.assign({},x,{status:"done",completedAt:now}));}));
  }
  function del(it){
    if(blockIfReadOnly())return;
    if(it.ns){if(nsEditable&&safeConfirm("Delete this next step?"))setLines(nsLines.filter(function(x,j){return j!==it.i;}));return;}
    if(!mayDelete()||!safeConfirm("Delete this action?"))return;
    saveTasks((tasks||[]).filter(function(x){return x.id!==it.t.id;}));
  }
  function saveEdit(){
    if(!edit||blockIfReadOnly())return;
    var v=String(edit.text||"").trim(),it=items.find(function(x){return x.key===edit.key;});
    setEdit(null);
    if(!it||v===it.text)return;
    if(it.ns){if(!nsEditable)return;var l=nsLines.slice();if(v)l[it.i]=v;else l.splice(it.i,1);setLines(l);return;}
    if(!v)return;
    saveTasks((tasks||[]).map(function(x){return x.id!==it.t.id?x:stampModified(Object.assign({},x,{text:v}));}));
  }
  var col=block?"#b3302a":"#16181d";
  var canDel=function(it){return it.ns?nsEditable:mayDelete();};
  return <div style={{minWidth:wide?190:140,maxWidth:wide?"none":210,fontSize:wide?12:11,lineHeight:1.35,overflowWrap:"anywhere"}}>
    {shown.map(function(it){
      var t=it.t,late=t&&t.due&&t.due<now,canEdit=!ro&&(!it.ns||nsEditable);
      if(edit&&edit.key===it.key)return <div key={it.key} style={{display:"flex",gap:3,marginBottom:2}}>
        <input type="text" autoFocus value={edit.text} onChange={function(e){setEdit({key:it.key,text:e.target.value});}}
          onKeyDown={function(e){if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEdit(null);}} onBlur={saveEdit}
          style={{flex:1,minWidth:0,fontSize:11,padding:"2px 6px"}}/>
      </div>;
      return <div key={it.key} className="pp-act" style={{display:"flex",gap:5,alignItems:"flex-start",marginBottom:2}}>
        {canEdit&&<input type="checkbox" checked={false} onChange={function(){done(it);}} title={it.ns?"Done: becomes a done action of the package and leaves the Next Step text":"Mark done"} style={{width:12,height:12,margin:"2px 0 0",flex:"0 0 auto"}}/>}
        {!canEdit&&<span style={{color:col}}>{block?"■":"•"}</span>}
        <span onClick={function(){if(canEdit)setEdit({key:it.key,text:it.text});}}
          style={{flex:1,minWidth:0,cursor:canEdit?"text":"default",color:block?col:it.ns?"#4a4740":"inherit",fontWeight:block?600:400}}
          title={(it.ns?"Next Step of the package (free text)":ppActText(t)+(t.note?"\n"+t.note:""))+(canEdit?"\nClick to edit":"")}>
          {it.text||"(no text)"}
          {t&&t.owner&&<span style={{color:"#9b968b",fontWeight:400}}> · {String(t.owner).split(",")[0]}</span>}
          {t&&t.due&&<span style={{color:late?"#b3302a":"#9b968b",fontWeight:late?700:400,fontFamily:"var(--font-mono)",fontSize:10}}> {fmtDate(t.due)}</span>}
        </span>
        {canEdit&&canDel(it)&&<button className="pp-act-x" onClick={function(){del(it);}} title="Delete"
          style={{background:"none",border:"none",padding:"0 2px",cursor:"pointer",color:"#b9b4a8",fontSize:11,lineHeight:1,flex:"0 0 auto"}}>✕</button>}
      </div>;
    })}
    {!wide&&items.length>3&&<button onClick={function(){setAll(!all);}} style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:"#0f5299",fontFamily:"inherit"}}>
      {all?"show less":"+ "+(items.length-3)+" more"}</button>}
    {ro&&!items.length&&<span style={{color:"#ccc"}}>—</span>}
    {!ro&&(open
      ?<div style={{display:"flex",gap:3,marginTop:3}}>
        <input type="text" autoFocus value={txt} onChange={function(e){setTxt(e.target.value);}}
          onKeyDown={function(e){if(e.key==="Enter")add();if(e.key==="Escape"){setOpen(false);setTxt("");}}}
          placeholder={block?"Blocking point…":"Next step…"} style={{flex:1,minWidth:0,fontSize:11,padding:"2px 6px"}}/>
        <button className="btn btn-sm" onClick={add} disabled={!txt.trim()} style={{padding:"1px 7px",fontSize:10.5}}>Add</button>
      </div>
      :<button onClick={function(){setOpen(true);}} title={block?"Add a blocking point (an action tagged Blocking Point, linked to this package)":"Add a next step (an action linked to this package, to tick when done)"}
        style={{background:"none",border:"none",padding:0,marginTop:2,cursor:"pointer",fontSize:10.5,color:"#9b968b",fontFamily:"inherit",display:"block"}}>+ add</button>)}
  </div>;
}
// RFI column of the Package list, and the RFI block of the package sheet (wide): the open RFI /
// FCR of the package — actions tagged RFI / FCR, the same as in Actions and With client — with
// the date sent and the client's theoretical answer date (red when overdue). Ticked = answered:
// the action is closed, leaves the list and stays archived in the sheet (shown with wide).
// A click on one edits it (subject, sent, answer due, answered on); + RFI adds one.
function PpRfiCell({td,list,done,tasks,saveTasks,wide}){
  const [edit,setEdit]=useState(null);       // {id|null, text, kind, sent, due, dueTyped, answered}
  const [all,setAll]=useState(false);
  const [arch,setArch]=useState(false);
  var ro=isReadOnly()||!saveTasks;
  var now=today();
  list=list||[];done=done||[];
  var shown=all||wide?list:list.slice(0,3);
  function autoDue(sent){return isValidDate(sent)?addDur(sent,"clientResponse"):"";}
  function openEdit(t){
    if(ro)return;
    if(!t){setEdit({id:null,text:"",kind:"RFI",sent:now,due:autoDue(now),dueTyped:false,answered:""});return;}
    var r=ppRfiInfo(t,now);
    setEdit({id:t.id,text:t.text||"",kind:r.kind,sent:r.sent,due:r.due,dueTyped:isValidDate(t.rfiDue),answered:r.answered||(r.done?now:"")});
  }
  function answer(t,val){
    if(blockIfReadOnly())return;
    saveTasks((tasks||[]).map(function(x){return x.id!==t.id?x:stampModified(Object.assign({},x,val?{status:"done",completedAt:now}:{status:"pending",completedAt:""}));}));
  }
  function save(){
    if(blockIfReadOnly())return;
    var e=edit,txt=String(e.text||"").trim();if(!txt)return;
    var due=e.dueTyped?e.due:"";
    var patch={text:txt,rfiSubmission:isValidDate(e.sent)?e.sent:"",rfiDue:isValidDate(due)?due:"",status:isValidDate(e.answered)?"done":"pending",completedAt:isValidDate(e.answered)?e.answered:""};
    if(e.id)saveTasks((tasks||[]).map(function(x){
      if(x.id!==e.id)return x;
      var tg=(x.tags||[]).filter(function(g){return g!=="RFI"&&g!=="FCR";}).concat([e.kind]);
      return stampModified(Object.assign({},x,patch,{tags:tg}));
    }));
    else saveTasks([newTask(Object.assign({tenderRef:td.id,package:td.package||"",tags:[e.kind],importance:2,urgence:2,
      owner:td.ownerTender||"",note:"From the Package list",due:isValidDate(e.due)?e.due:""},patch))].concat(tasks||[]));
    setEdit(null);
  }
  function del(){
    if(!edit||!edit.id||blockIfReadOnly()||!mayDelete()||!safeConfirm("Delete this RFI?"))return;
    saveTasks((tasks||[]).filter(function(x){return x.id!==edit.id;}));setEdit(null);
  }
  function row(t){
    var r=ppRfiInfo(t,now);
    var col=r.done?"#9b968b":r.late?"#b3302a":r.sent?"#1e6b3a":"#9b968b";
    return <div key={t.id} style={{display:"flex",gap:5,alignItems:"flex-start",marginBottom:3}}>
      {!ro&&<input type="checkbox" checked={r.done} onChange={function(){answer(t,!r.done);}} title={r.done?"Answered — untick to reopen":"Tick when the client has answered: the RFI is archived in the package sheet"}
        style={{width:12,height:12,margin:"2px 0 0",flex:"0 0 auto"}}/>}
      <div onClick={function(){openEdit(t);}} style={{cursor:ro?"default":"pointer",minWidth:0}} title={(t.text||"")+"\n"+r.txt+(ro?"":"\nClick to edit")}>
        <span style={{fontWeight:600,color:r.done?"#9b968b":"var(--ink,#16181d)",textDecoration:r.done?"line-through":"none"}}>
          <span style={{fontSize:9.5,fontWeight:700,color:"#b45309",marginRight:4}}>{r.kind}</span>{t.text||"(no subject)"}</span>
        <div style={{fontSize:10.5,color:col,fontWeight:r.late?700:400}}>{r.txt}</div>
      </div>
    </div>;
  }
  return <div style={{minWidth:wide?200:150,maxWidth:wide?"none":220,fontSize:wide?12:11,lineHeight:1.35,overflowWrap:"anywhere"}}>
    {shown.map(row)}
    {!wide&&list.length>3&&<button onClick={function(){setAll(!all);}} style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:"#0f5299",fontFamily:"inherit"}}>
      {all?"show less":"+ "+(list.length-3)+" more"}</button>}
    {!list.length&&(ro||!wide)&&<span style={{color:"#ccc"}}>{ro?"—":""}</span>}
    {!wide&&done.length>0&&<div style={{fontSize:10,color:"#9b968b",marginTop:2}} title="Answered RFI are archived in the package sheet (Actions & notes)">{done.length} answered · in the sheet</div>}
    {wide&&done.length>0&&<div style={{marginTop:6}}>
      <button onClick={function(){setArch(!arch);}} style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:11,color:"#0f5299",fontFamily:"inherit"}}>
        {arch?"▾":"▸"} Answered — archive ({done.length})</button>
      {arch&&<div style={{marginTop:4,paddingLeft:6,borderLeft:"2px solid #eceae4"}}>{done.map(row)}</div>}
    </div>}
    {!ro&&<button onClick={function(){openEdit(null);}} title="Add an RFI to this package (an action tagged RFI, also in Actions and With client)"
      style={{background:"none",border:"none",padding:0,marginTop:2,cursor:"pointer",fontSize:10.5,color:"#9b968b",fontFamily:"inherit",display:"block"}}>+ RFI</button>}
    {edit&&<div className="overlay" onClick={function(e){if(e.target===e.currentTarget)setEdit(null);}}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-hdr">
          <div className="modal-title">{edit.id?edit.kind:"New "+edit.kind} · {td.title||"(untitled)"}</div>
          <button onClick={function(){setEdit(null);}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
        </div>
        <div className="modal-body" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:8}}>
            <select value={edit.kind} onChange={function(e){setEdit(Object.assign({},edit,{kind:e.target.value}));}} style={{flex:"0 0 80px"}}>
              <option value="RFI">RFI</option><option value="FCR">FCR</option></select>
            <input type="text" autoFocus value={edit.text} placeholder="Subject / reference of the RFI…" onChange={function(e){setEdit(Object.assign({},edit,{text:e.target.value}));}}
              onKeyDown={function(e){if(e.key==="Enter")save();}} style={{flex:1,minWidth:0,fontWeight:600}}/>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <label style={{fontSize:11,color:"#6f6b62",display:"flex",flexDirection:"column",gap:3}}>Sent to the client
              <input type="date" min="1990-01-01" max="2200-12-31" value={edit.sent||""} onChange={function(e){var v=e.target.value;setEdit(Object.assign({},edit,{sent:v},edit.dueTyped?{}:{due:autoDue(v)}));}}/></label>
            <label style={{fontSize:11,color:"#6f6b62",display:"flex",flexDirection:"column",gap:3}}>Answer due (theoretical)
              <input type="date" min="1990-01-01" max="2200-12-31" value={edit.due||""} onChange={function(e){setEdit(Object.assign({},edit,{due:e.target.value,dueTyped:!!e.target.value}));}}/></label>
            <label style={{fontSize:11,color:"#6f6b62",display:"flex",flexDirection:"column",gap:3}}>Answered on
              <input type="date" min="1990-01-01" max="2200-12-31" value={edit.answered||""} onChange={function(e){setEdit(Object.assign({},edit,{answered:e.target.value}));}}/></label>
          </div>
          <div style={{fontSize:11,color:"#9b968b"}}>Answer due = sent + {getDur("clientResponse")} {durUnitLabel("clientResponse")} (Settings › Durations, client answer time) unless typed. With an answer date the RFI is archived in the package sheet and leaves the Package list. Same action as in Actions and With client.</div>
        </div>
        <div className="modal-footer">
          {edit.id&&mayDelete()&&<button className="btn" onClick={del} style={{marginRight:"auto",color:"#b3302a"}}>Delete</button>}
          <button className="btn" onClick={function(){setEdit(null);}}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={!String(edit.text||"").trim()}>Save</button>
        </div>
      </div>
    </div>}
  </div>;
}
// The notes of a package as lines of text ("Title — content"), for the print and the Excel.
function ppNotesText(td){
  return tenderNotesOf(td).map(function(n){
    var t=String(n.title||"").trim(),c=String(n.content||"").trim().replace(/\s*\n\s*/g," · ");
    return t&&c?t+" — "+c:t||c;
  }).filter(Boolean);
}
// Notes column of the Package table: the package's notes (td.tenderNotes — the same notes as
// the sheet's Actions & notes tab), a click on one edits it in a small window, + note adds one.
function PpNotesCell({td,upd,wide}){
  const [edit,setEdit]=useState(null);       // {id|null, title, content}
  const [all,setAll]=useState(false);
  var ro=isReadOnly();
  var notes=tenderNotesOf(td);
  var shown=all||wide?notes:notes.slice(0,3);
  function save(){
    if(blockIfReadOnly())return;
    var e=edit,title=String(e.title||"").trim(),content=String(e.content||"");
    var ns;
    if(e.id)ns=notes.map(function(n){return n.id!==e.id?n:Object.assign({},n,{title:title,content:content});});
    else ns=notes.concat([newTenderNote({title:title||"Note "+(notes.length+1),content:content})]);
    var patch={tenderNotes:ns};
    if(e.id==="legacy-note")patch.notes="";            // the old free text now lives in tenderNotes
    upd(td,patch);setEdit(null);
  }
  function del(){
    if(blockIfReadOnly()||!safeConfirm("Delete note?"))return;
    var patch={tenderNotes:notes.filter(function(n){return n.id!==edit.id;})};
    if(edit.id==="legacy-note")patch.notes="";
    upd(td,patch);setEdit(null);
  }
  return <div style={{minWidth:wide?180:140,maxWidth:wide?"none":210,fontSize:wide?12:11,lineHeight:1.35,overflowWrap:"anywhere"}}>
    {shown.map(function(n,i){
      var c=String(n.content||"").trim();
      return <div key={n.id||i} onClick={function(){if(!ro)setEdit({id:n.id,title:n.title||"",content:n.content||""});}}
        title={(n.title||"")+(c?"\n"+c:"")+(n.by||n.at?"\n— "+[n.by||"",n.at?fmtDate(n.at):""].filter(Boolean).join(" · "):"")+(ro?"":"\nClick to edit")}
        style={{marginBottom:3,padding:"2px 5px",borderLeft:"2px solid var(--gold,#c9a84c)",background:"#fffdf6",cursor:ro?"default":"pointer",borderRadius:"0 4px 4px 0"}}>
        {n.title&&<div style={{fontWeight:600,color:"var(--ink,#16181d)"}}>{n.title}</div>}
        {c&&<div style={{color:"#4a4740",whiteSpace:"pre-wrap",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{c}</div>}
      </div>;
    })}
    {!wide&&notes.length>3&&<button onClick={function(){setAll(!all);}} style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:"#0f5299",fontFamily:"inherit"}}>
      {all?"show less":"+ "+(notes.length-3)+" more"}</button>}
    {ro&&!notes.length&&<span style={{color:"#ccc"}}>—</span>}
    {!ro&&<button onClick={function(){setEdit({id:null,title:"",content:""});}} title="Add a note to this package (also shown in the package sheet)"
      style={{background:"none",border:"none",padding:0,marginTop:2,cursor:"pointer",fontSize:10.5,color:"#9b968b",fontFamily:"inherit",display:"block"}}>+ note</button>}
    {edit&&<div className="overlay" onClick={function(e){if(e.target===e.currentTarget)setEdit(null);}}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-hdr">
          <div className="modal-title">{edit.id?"Note":"New note"} · {td.title||"(untitled)"}</div>
          <button onClick={function(){setEdit(null);}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
        </div>
        <div className="modal-body">
          <input type="text" autoFocus value={edit.title} placeholder="Note title…" onChange={function(e){setEdit(Object.assign({},edit,{title:e.target.value}));}}
            style={{width:"100%",boxSizing:"border-box",fontWeight:600,marginBottom:8}}/>
          <textarea value={edit.content} placeholder="Write your note here…" onChange={function(e){setEdit(Object.assign({},edit,{content:e.target.value}));}}
            onKeyDown={function(e){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))save();}}
            style={{width:"100%",minHeight:140,boxSizing:"border-box",fontFamily:"inherit",fontSize:13,resize:"vertical"}}/>
          <div style={{fontSize:11,color:"#9b968b",marginTop:6}}>Same notes as the package sheet (Actions & notes). Ctrl+Enter saves.</div>
        </div>
        <div className="modal-footer">
          {edit.id&&<button className="btn" onClick={del} style={{marginRight:"auto",color:"#b3302a"}}>Delete</button>}
          <button className="btn" onClick={function(){setEdit(null);}}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={!String(edit.title||"").trim()&&!String(edit.content||"").trim()}>Save</button>
        </div>
      </div>
    </div>}
  </div>;
}
// Change a start on site that comes from the schedule, from the Package list or sheet: the
// linked task (the earliest one) moves to the week of the new date, the tasks linked after it
// follow — the same as dragging its bar in the zone schedule (schedMoveTaskStart). The
// package's start on site then follows the schedule as always. Zone leaders and admin only.
function ppMayMoveTask(f){
  if(!f||isReadOnly()||!window._ppSaveSchedules)return false;
  try{return canEditZoneSchedule(window._ppZoneOwners,f.sc.zone,window._currentUser?window._currentUser.name:"");}catch(e){return false;}
}
function PpMoveStartBtn({td,f,onNavZone}){
  const [open,setOpen]=useState(false);
  if(!f)return null;
  var may=ppMayMoveTask(f);
  return <React.Fragment>
    <button type="button" onClick={function(e){e.stopPropagation();if(may)setOpen(true);}} disabled={!may}
      title={may?"Change the start on site: moves the schedule task \""+(f.r.label||"task")+"\" (and the tasks linked after it)"
        :isReadOnly()?"Read-only account":"Only the zone leader ("+(f.sc.zone||"")+") or the admin can move the schedule task"}
      style={{background:"none",border:"1px solid #cfe3d5",borderRadius:5,padding:"1px 5px",marginLeft:4,cursor:may?"pointer":"not-allowed",
        fontSize:11,color:may?"#00695c":"#bbb",lineHeight:"16px",verticalAlign:"middle"}}>✎</button>
    {open&&<PpMoveStartModal td={td} f={f} onNavZone={onNavZone} onClose={function(){setOpen(false);}}/>}
  </React.Fragment>;
}
function PpMoveStartModal({td,f,onNavZone,onClose}){
  const [d,setD]=useState(f.r.startWeek||td.startOnSite||"");
  const [err,setErr]=useState("");
  var res=isValidDate(d)?schedMoveTaskStart(window._ppSchedules||[],f.sc.id,f.r.id,d):null;
  var nDeps=(function(){
    // tasks that will follow (linked after it, directly or not), same schedule
    var rows=f.sc.rows||[],seen={},q=[f.r.id];
    while(q.length){var id=q.shift();rows.forEach(function(r){if(!seen[r.id]&&predIdsOf(r).indexOf(id)>=0){seen[r.id]=1;q.push(r.id);}});}
    return Object.keys(seen).length;
  })();
  var started=Object.keys(f.r.cells||{}).some(function(w){var v=f.r.cells[w];return v==="actual"||v==="both";});
  function go(){
    if(blockIfReadOnly())return;
    if(!res||!res.ok){setErr(res?res.msg:"Pick a date.");return;}
    if(res.weeks)window._ppSaveSchedules(res.schedules);
    onClose();
  }
  return <div className="overlay" onClick={function(e){e.stopPropagation();if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:480}} onClick={function(e){e.stopPropagation();}}>
      <div className="modal-hdr">
        <div className="modal-title">Start on site · {td.title||"(untitled)"}</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
      </div>
      <div className="modal-body">
        <div style={{fontSize:12,color:"#4a4740",marginBottom:10,lineHeight:1.5}}>
          This date comes from the schedule: <b>{f.r.label||"task"}</b> in <b>{f.sc.zone||"?"}</b> ({f.sc.title||""}), now from <b>{fmtDate(f.r.startWeek)}</b>{f.r.endWeek?" to "+fmtDate(f.r.endWeek):""}.
          Changing it moves that task in the schedule{nDeps?<span>, and the <b>{nDeps} task{nDeps>1?"s":""}</b> linked after it follow</span>:""}.
        </div>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:0,color:"var(--ink)"}}>
          New start on site
          <input type="date" min="1990-01-01" max="2200-12-31" value={d} onChange={function(e){setD(e.target.value);setErr("");}} style={{width:150}}/>
        </label>
        <div style={{fontSize:11,marginTop:8,minHeight:16,color:res&&!res.ok?"#b3302a":"#6f6b62"}}>
          {res?(res.ok?(res.weeks?"The task moves "+Math.abs(res.weeks)+" working week"+(Math.abs(res.weeks)>1?"s":"")+" "+(res.weeks>0?"later":"earlier")+" (it starts on the Monday of that week).":res.msg):res.msg):""}
        </div>
        {started&&<div style={{fontSize:11,color:"#b35c00",marginTop:4}}>This task has already started: only its planned weeks move, the weeks recorded as real stay where they are.</div>}
        {err&&<div style={{fontSize:11,color:"#b3302a",marginTop:4}}>{err}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={function(){onClose();openScheduleStart(f,td,onNavZone);}} style={{marginRight:"auto"}} title="Open the task in the zone schedule instead">Open in the schedule</button>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={go} disabled={!res||!res.ok||!res.weeks}>Move the task</button>
      </div>
    </div>
  </div>;
}
// ---- Quick update (meeting) ---------------------------------------------------------------
// One window, opened from a row of the Package list (new view or Classic list), to update a
// package during a meeting without going through the sheet: the steps still running with
// their target dates, every document with its status, submission / return dates and code,
// and the follow-up (next steps, blocking points, notes). Same data and same rules as the
// sheet: targets go through TendersView's updateStep (its automatic actions), documents
// through patchFor + flowTaskChanges (the Flow & history actions), the follow-up through
// TenderFollowUpCard.
var PP_QU_STEPS=["bidders","pkg","acc","contract","wms","itp","kickoff"];
function ppQuStepState(td,key){
  var v=((td.steps||{})[key])||"",sd=((td.stepDates||{})[key])||{};
  if(v==="N/A"||v==="Not needed")return {k:"na",text:"N/A"};
  if(key==="acc"||key==="wms"||key==="itp"){
    var d=flowDocOf(td,key);
    if(!d)return key==="acc"?{k:"na",text:"Internal approval only"}:{k:"todo",text:v||"—"};
    var sm=docSummary(d);
    return {k:sm.state==="approved"?"done":sm.state==="none"?"todo":"run",text:sm.text,doc:d};
  }
  if(key==="contract"){
    if(sd.signedDone||sd.signedAllDone||v==="Signed")return {k:"done",text:"Signed"+(sd.signedAllDone||sd.signedDone?" · "+fmtDate(sd.signedAllDone||sd.signedDone):"")};
    if(sd.circulateDone)return {k:"run",text:"In circulation · "+fmtDate(sd.circulateDone)};
    if(sd.requestDone)return {k:"run",text:"Request sent · "+fmtDate(sd.requestDone)};
    return {k:v&&v!=="—"?"run":"todo",text:v&&v!=="—"?v:"Not started"};
  }
  if(key==="kickoff"){
    var ks=kickoffState(td);
    return ks==="held"?{k:"done",text:"Held"+(sd.done?" · "+fmtDate(sd.done):"")}:ks==="planned"?{k:"run",text:"Scheduled"}:{k:"todo",text:"Not done"};
  }
  if(key==="bidders"&&(v==="Comments received"||v==="No comments received"))return {k:"done",text:v};
  if(key==="pkg"&&v==="Approved")return {k:"done",text:v};
  if(tenderStepClass(key,v)==="s-approved-a")return {k:"done",text:v};
  return {k:v&&v!=="—"?"run":"todo",text:v&&v!=="—"?v:"—"};
}
// Contract stages of Quick update, in order, with the date each one fills in
// stepDates.contract — the same fields as the sheet's Contract section.
var PP_QU_CT=[
  {k:"",       label:"Not started",   field:""},
  {k:"request",label:"Request sent",  field:"requestDone"},
  {k:"circ",   label:"In circulation",field:"circulateDone"},
  {k:"signed", label:"Signed",        field:"signedDone"}
];
function ppQuCtStage(td){
  var sd=((td.stepDates||{}).contract)||{};
  if(((td.steps||{}).contract||"")==="N/A")return "na";
  if(sd.signedDone||sd.signedAllDone)return "signed";
  if(sd.circulateDone)return "circ";
  if(sd.requestDone)return "request";
  return "";
}
// Close / reopen the procurement of a Package by hand (Quick update): self perform, bought
// another way… td.procClosed = {on, reason, note, by, autoClosed}. Every milestone then counts
// as reached. Closing also closes the Package's open AUTOMATIC actions (addedBy "System") —
// the ones typed by someone (RFI, blocking points…) stay open; their ids are kept in
// autoClosed so that a reopen reopens exactly those.
function PpProcCloseBar({td,updTd,tasks,saveTasks}){
  const [form,setForm]=useState(null);
  var c=procClosedOf(td),ro=isReadOnly();
  var autoOpen=(tasks||[]).filter(function(t){return t.tenderRef===td.id&&t.status!=="done"&&t.addedBy==="System";});
  function closeAuto(on){
    if(!saveTasks||!autoOpen.length)return [];
    var ids=autoOpen.map(function(t){return t.id;});
    saveTasks((tasks||[]).map(function(t){return ids.indexOf(t.id)>=0?stampModified(Object.assign({},t,{status:"done",completedAt:on||today()})):t;}));
    return ids;
  }
  function reopenAuto(){
    var ids=(c&&c.autoClosed)||[];
    if(!saveTasks||!ids.length)return;
    saveTasks((tasks||[]).map(function(t){return ids.indexOf(t.id)>=0&&t.status==="done"?stampModified(Object.assign({},t,{status:"pending",completedAt:""})):t;}));
  }
  var box={margin:"10px 0 0",padding:"8px 10px",borderRadius:8,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12};
  if(c)return <div style={Object.assign({},box,{background:"var(--green-soft,#e6f2e9)",border:"1px solid #cfe3d5",color:"#1e6b3a"})}>
    <b>✓ Procurement closed</b><span>{c.on?fmtDate(c.on)+" · ":""}{procClosedLabel(c)}</span>
    {c.by&&<span style={{color:"#6f6b62",fontSize:11}}>· by {c.by}</span>}
    {(c.autoClosed||[]).length>0&&<span style={{color:"#6f6b62",fontSize:11}}>· {c.autoClosed.length} automatic action{c.autoClosed.length>1?"s":""} closed</span>}
    {!ro&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){
      var n=((c.autoClosed)||[]).length;
      if(safeConfirm("Reopen the procurement of this Package? Its milestones are followed again."+(n?"\n\n"+n+" automatic action"+(n>1?"s":"")+" closed with it will be reopened.":""))){reopenAuto();updTd({procClosed:null});}}}>↺ Reopen</button>}
  </div>;
  if(!form)return <div style={Object.assign({},box,{background:"#fbfaf7",border:"1px dashed #d9d5ca",color:"#6f6b62"})}>
    <span>Special case — self perform, no contract needed, bought another way…?</span>
    {!ro&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){setForm({on:today(),reason:"self",note:""});}}>✓ Close the procurement…</button>}
  </div>;
  return <div style={Object.assign({},box,{background:"#fbfaf7",border:"1px solid #d9d5ca"})}>
    <b>Close the procurement</b>
    <select value={form.reason} onChange={function(e){setForm(Object.assign({},form,{reason:e.target.value}));}} style={{fontSize:11.5,padding:"2px 5px",width:"auto"}}>
      {PROC_CLOSE_REASONS.map(function(r){return <option key={r.k} value={r.k}>{r.label}</option>;})}</select>
    <DraftDateInput value={form.on} onCommit={function(v){setForm(Object.assign({},form,{on:v}));}} style={{fontSize:11.5,padding:"2px 5px",width:128}}/>
    <input type="text" value={form.note} placeholder="Note (optional)" onChange={function(e){setForm(Object.assign({},form,{note:e.target.value}));}}
      style={{fontSize:11.5,padding:"3px 6px",flex:1,minWidth:140}}/>
    <button className="btn btn-sm" onClick={function(){setForm(null);}}>Cancel</button>
    <button className="btn btn-sm btn-pri" onClick={function(){
      if(blockIfReadOnly())return;
      var ids=closeAuto(form.on);
      updTd({procClosed:{on:form.on||today(),reason:form.reason,note:(form.note||"").trim(),by:(window._currentUser&&window._currentUser.name)||"",autoClosed:ids}});
      setForm(null);
    }}>Close</button>
    <div style={{flexBasis:"100%",fontSize:10.5,color:"#9b968b"}}>Every milestone then counts as reached: nothing is late any more, the row turns green, the schedule stops waiting for a delivery.
      {autoOpen.length?" "+autoOpen.length+" open automatic action"+(autoOpen.length>1?"s":"")+" ("+autoOpen.map(function(t){return (t.text||"").split(" — ")[0];}).slice(0,3).join(", ")+(autoOpen.length>3?"…":"")+") will be closed; actions typed by someone stay open.":""} Reopen at any time.</div>
  </div>;
}
function PpQuickUpdateModal({tdId,tenders,saveTenders,tasks,saveTasks,updateStep,onOpenSheet,onClose}){
  const [allSteps,setAllSteps]=useState(false);
  const [allDocs,setAllDocs]=useState(false);
  const [keepRows,setKeepRows]=useState({});   // WMS / ITP just set to N/A: stay visible until the window closes
  const tRef=useRef(tenders);tRef.current=tenders;
  const kRef=useRef(tasks);kRef.current=tasks;
  var td=(tenders||[]).find(function(t){return t.id===tdId;});
  useEffect(function(){
    function k(e){if(e.key==="Escape"&&document.querySelectorAll(".overlay").length<=1)onClose();}
    window.addEventListener("keydown",k);return function(){window.removeEventListener("keydown",k);};
  },[]);
  if(!td)return null;
  var ro=isReadOnly(),now=today();
  function updTd(field,val){
    if(blockIfReadOnly())return;
    var patch=(field&&typeof field==="object")?field:{[field]:val};
    saveTenders((tRef.current||[]).map(function(t){return t.id!==tdId?t:Object.assign({},t,patch);}));
  }
  function afterSave(prev,next){
    if(!saveTasks)return;
    var owner=(window._ppPkgOwners||{})[next.package||""]||next.ownerTender||"";
    var n=flowTaskChanges(prev,next,kRef.current||[],owner);
    if(n)saveTasks(n);
  }
  function setStep(key,field,v){
    if(blockIfReadOnly())return;
    if(updateStep)updateStep(tdId,key,field,v);
    else{var sd=Object.assign({},td.stepDates||{});sd[key]=Object.assign({},sd[key]||{},{[field]:v});updTd({stepDates:sd});}
  }
  function saveDoc(d,list){var patch=d.patchFor(list);updTd(patch);afterSave(td,Object.assign({},td,patch));}
  // Contract: the chosen stage fills its date (today unless already set) and the earlier
  // ones left empty; going back clears the later ones. Same automatic actions as the sheet:
  // the action of the stage reached is closed, the next one opened (signed + SD → SD action).
  function setContract(stage,date){
    if(blockIfReadOnly())return;
    var cur=((td.stepDates||{}).contract)||{};
    var ct=Object.assign({},cur),steps=Object.assign({},td.steps||{});
    var idx=PP_QU_CT.findIndex(function(x){return x.k===stage;});
    if(stage==="na"){steps.contract="N/A";}
    else{
      if(!ct.signedDone&&ct.signedAllDone)ct.signedDone=ct.signedAllDone;   // older records
      PP_QU_CT.forEach(function(x,i){
        if(!x.field)return;
        if(i<=idx){
          if(i===idx&&date!==undefined)ct[x.field]=date;
          else if(!ct[x.field])ct[x.field]=date||now;
        }else ct[x.field]="";
      });
      ct.signedAllDone=ct.signedDone;   // the sheet writes both signature fields together
      steps.contract=PP_QU_CT[idx]&&PP_QU_CT[idx].k?PP_QU_CT[idx].label:"—";
    }
    var sdAll=Object.assign({},td.stepDates||{});sdAll.contract=ct;
    var next=Object.assign({},td,{stepDates:sdAll,steps:steps});
    updTd({stepDates:sdAll,steps:steps});
    if(!saveTasks)return;
    var owner=(window._ppPkgOwners||{})[td.package||""]||td.ownerTender||"";
    var base=flowTaskChanges(td,next,kRef.current||[],owner);
    var list=base||(kRef.current||[]).slice(),changed=false,title=td.title||"";
    function idxOf(text,open){return list.findIndex(function(t){return t.tenderRef===td.id&&t.text===text&&(open?t.status!=="done":true);});}
    function open(text,o){
      if(idxOf(text,true)>=0)return;
      var i=idxOf(text,false);
      if(i>=0&&list[i].addedBy==="System"){list[i]=Object.assign({},list[i],{status:"pending",completedAt:""});changed=true;return;}
      list.unshift(newTask(Object.assign({text:text,owner:owner,tenderRef:td.id,package:td.package||"",tags:["Contract"],status:"pending",
        note:"Auto-created from contract/SD status",addedBy:"System"},o||{})));changed=true;
    }
    function drop(text){var n=list.filter(function(t){return !(t.tenderRef===td.id&&t.text===text&&t.status!=="done"&&t.addedBy==="System");});if(n.length!==list.length){list=n;changed=true;}}
    var A1="Contract Request to be sent — "+title,A2="Contract to circulate — "+title,A3="Contract to be signed internally and by the sub — "+title;
    if(stage==="request"){open(A2);drop(A3);}
    else if(stage==="circ"){open(A3);}
    else if(stage===""){drop(A2);drop(A3);if(idxOf(A1,false)>=0)open(A1);}   // reopened, never created here
    if(stage==="signed"&&td.hasSD){
      var sdT=["Prepare the SD — "+title,"Get approval for SD — "+title,"Resubmit SD — "+title];
      var tracked=list.some(function(t){return t.tenderRef===td.id&&t.status!=="done"&&(sdT.indexOf(t.text)>=0||(t.text||"").indexOf("SD to be submitted: "+title)===0);});
      if(!tracked)open("SD to be submitted: "+title,{tags:[qualityTag(td.package||"")],due:td.sdTarget||""});
    }
    if(base||changed)saveTasks(list);
  }
  var p=ppPlan(td,now),stg=ppStageOf(td,now),st=PP_STATUS[p.status]||PP_STATUS.none;
  var cell={padding:"5px 6px",borderTop:"1px solid #f0ede6",verticalAlign:"middle",fontSize:12};
  var hd={padding:"4px 6px",fontSize:10,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#9b968b",textAlign:"left",whiteSpace:"nowrap"};
  var dIn={fontSize:11.5,padding:"2px 5px",width:128};
  var STC={done:"#1e6b3a",run:"#0f5299",todo:"#9b968b",na:"#c9c4b8"};
  // steps
  var steps=PP_QU_STEPS.map(function(k){
    var def=TENDER_STEPS.find(function(x){return x.key===k;});
    return def?{def:def,s:ppQuStepState(td,k),sd:((td.stepDates||{})[k])||{}}:null;
  }).filter(Boolean);
  var stepsShown=steps.filter(function(x){return allSteps||keepRows[x.def.key]||(x.s.k==="run"||x.s.k==="todo");});
  // documents (client approval, shop drawings, materials, purchases, quality)
  // WMS / ITP set to N/A: nothing to follow, left out like in the WMS/ITP view.
  var docs=tenderDocs(td).filter(function(d){return !((d.kind==="wms"||d.kind==="itp")&&((td.steps||{})[d.kind]||"")==="N/A");})
    .map(function(d){return {d:d,sm:docSummary(d,now)};});
  var docsShown=docs.filter(function(x){return allDocs||x.sm.state!=="approved";});
  var SC={approved:"#1e6b3a",pending:"#0f5299",returned:"#b35c00",none:"#9b968b"};
  function sec(title,sub,right){return <div style={{display:"flex",alignItems:"baseline",gap:8,margin:"14px 0 6px",flexWrap:"wrap"}}>
    <div style={{fontWeight:700,fontSize:14,color:"var(--ink)"}}>{title}</div><span style={{fontSize:11,color:"#9b968b"}}>{sub}</span>
    <span style={{marginLeft:"auto"}}>{right}</span></div>;}
  function tog(on,set,lbl){return <label style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,cursor:"pointer",textTransform:"none",letterSpacing:0,margin:0,color:"#6f6b62",fontWeight:500}}>
    <input type="checkbox" checked={on} onChange={function(e){set(e.target.checked);}} style={{width:"auto",margin:0}}/>{lbl}</label>;}
  var f=tenderScheduleStart(td);
  return <div className="overlay" onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:1080,width:"96vw"}}>
      <div className="modal-hdr">
        <div style={{minWidth:0}}>
          <div className="modal-title">{td.title||"(untitled)"}</div>
          <div style={{fontSize:11.5,color:"#6f6b62",marginTop:2,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            <span>{td.package||"No department"} · {ppTypeLabel(ppType(td))}</span>
            {td.ownerTender&&<span>· {td.ownerTender}</span>}
            <span className="badge" style={{background:st.bg,color:st.fg}}>{ppNextAct(p)||st.label}{p.daysLeft!==null?" · "+ppDaysText(p.daysLeft):""}</span>
            {stg.text&&<span>Now: <b>{ppNowText(stg)}</b>{stg.next?" · next: "+stg.next:""}</span>}
            <span>· Need on site <b>{p.need?fmtDate(p.need):"—"}</b>{f?<PpMoveStartBtn td={td} f={f}/>:null}</span>
          </div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#bbb",alignSelf:"flex-start"}}>×</button>
      </div>
      <div className="modal-body" style={{maxHeight:"72vh",overflowY:"auto",paddingTop:0}}>
        {ro&&<div style={{fontSize:11.5,color:"#b35c00",marginTop:8}}>Read-only account: nothing can be changed here.</div>}
        <PpProcCloseBar td={td} updTd={updTd} tasks={tasks} saveTasks={saveTasks}/>
        {sec("Steps",allSteps?"every step":"steps still to do or running — finished and N/A hidden",tog(allSteps,setAllSteps,"Show all steps"))}
        {stepsShown.length===0?<div style={{fontSize:12,color:"#9b968b"}}>Every step is done.</div>:
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><th style={hd}>Step</th><th style={hd}>Where it stands</th><th style={hd} title="Planned date of the step (submission for ACC / WMS / ITP)">Target</th><th style={hd}>Done</th></tr></thead>
          <tbody>{stepsShown.map(function(x){
            var k=x.def.key,ed=k==="bidders"||k==="pkg"||k==="kickoff";
            var tgt=k==="contract"?(x.sd.signedTarget||x.sd.target):x.sd.target;
            var late=x.s.k!=="done"&&x.s.k!=="na"&&isValidDate(tgt)&&tgt<now&&!(x.s.doc&&x.s.doc.cycles.length);
            return <tr key={k} style={x.s.k==="run"?{background:"#f5f8fc"}:null}>
              <td style={Object.assign({},cell,{fontWeight:600,whiteSpace:"nowrap"})}>{k==="acc"?tenderRouteLabel(td):x.def.label}</td>
              <td style={cell}>
                {k==="contract"&&!td.contractCircuit?<select value={ppQuCtStage(td)} disabled={ro} onChange={function(e){setContract(e.target.value);}}
                    title="Fills the date of the stage (today) in the Contract section of the sheet, with its automatic actions"
                    style={{fontSize:11.5,padding:"2px 5px",width:"auto",color:STC[x.s.k],fontWeight:600}}>
                    {PP_QU_CT.map(function(o){return <option key={o.k} value={o.k}>{o.label}</option>;})}
                    <option value="na">N/A</option></select>
                :k==="contract"?<span style={{color:STC[x.s.k],fontWeight:600}}>{x.s.text}<span style={{fontSize:10.5,color:"#9b968b",fontWeight:400}}> · tracked desk by desk: edit the desks just below</span></span>
                :(k==="wms"||k==="itp")&&(x.s.k==="na"||!(x.s.doc&&x.s.doc.cycles.length))
                  ?<select value={((td.steps||{})[k])||"—"} disabled={ro} title="Not submitted yet: — / N/A / Not done (same choice as the sheet). Submissions are recorded below in Documents."
                    onChange={function(e){var v=e.target.value;if(v==="N/A")setKeepRows(function(o){return Object.assign({},o,{[k]:true});});setStep(k,"status",v);}}
                    style={{fontSize:11.5,padding:"2px 5px",width:"auto",color:STC[x.s.k],fontWeight:600}}>
                    {flowPresubOpts(x.def.opts).map(function(o){return <option key={o} value={o}>{o}</option>;})}</select>
                :ed?<select value={((td.steps||{})[k])||"—"} disabled={ro} onChange={function(e){setStep(k,"status",e.target.value);}}
                    style={{fontSize:11.5,padding:"2px 5px",width:"auto",color:STC[x.s.k],fontWeight:600}}>
                    {x.def.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}</select>
                  :<span style={{color:STC[x.s.k],fontWeight:600}}>{x.s.text}</span>}
                {x.s.doc&&x.s.k!=="na"&&<span style={{fontSize:10.5,color:"#9b968b"}}> · {x.s.doc.cycles.length?"edit below in Documents":"submission: below in Documents"}</span>}
              </td>
              <td style={cell}><DraftDateInput value={(k==="contract"?(x.sd.signedTarget||x.sd.target):x.sd.target)||""} disabled={ro}
                title={k==="contract"?"Target date of the signature (same as Signed contract › Target in the sheet)":undefined}
                onCommit={function(v){setStep(k,k==="contract"?"signedTarget":"target",v);}}
                style={Object.assign({},dIn,late?{border:"1.5px solid #e8b4b8",background:"#fff6f6"}:{})}/>
                {late&&<div style={{fontSize:10,color:"#b3302a",fontWeight:700}}>target passed</div>}</td>
              <td style={cell}>{k==="contract"&&!td.contractCircuit&&(function(){var cs=ppQuCtStage(td),o=PP_QU_CT.find(function(z){return z.k===cs;});return o&&o.field;})()
                ?(function(){var cs=ppQuCtStage(td),o=PP_QU_CT.find(function(z){return z.k===cs;});
                  return <DraftDateInput value={(x.sd[o.field]||(cs==="signed"?x.sd.signedAllDone:""))||""} disabled={ro} title={"Date: "+o.label}
                    onCommit={function(v){if(v)setContract(cs,v);}} style={dIn}/>;})()
                :ed?<DraftDateInput value={x.sd.done||""} disabled={ro} onCommit={function(v){setStep(k,"done",v);}} style={dIn}/>
                :<span style={{fontSize:11.5,color:"#6f6b62"}}>{x.s.doc?(function(){var l=x.s.doc.cycles[x.s.doc.cycles.length-1];return l&&l.submitted?"sent "+fmtDate(l.submitted):"—";})():(x.sd.signedAllDone||x.sd.signedDone?fmtDate(x.sd.signedAllDone||x.sd.signedDone):"—")}</span>}</td>
            </tr>;
          })}</tbody>
        </table>}
        {td.contractCircuit&&((td.steps||{}).contract||"")!=="N/A"&&(allSteps||ppQuStepState(td,"contract").k!=="done")&&<div style={{marginTop:10,padding:"8px 10px",border:"1px solid #e6e2d9",borderRadius:8,background:"#fbfaf7"}}>
          <div style={{fontWeight:700,fontSize:12.5,marginBottom:6}}>Contract — desk-by-desk circuit</div>
          {ro?<div style={{fontSize:11.5,color:"#9b968b"}}>Read-only account.</div>
            :<ContractCircuitEditor td={td} updTd={function(patch){updTd(patch);}} afterSave={afterSave}/>}
        </div>}
        {sec("Documents",allDocs?"every document":"documents not approved yet — approved ones hidden",tog(allDocs,setAllDocs,"Show approved"))}
        {docsShown.length===0?<div style={{fontSize:12,color:"#9b968b"}}>{docs.length?"Every document is approved.":"No document for this package."}</div>:
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><th style={hd}>Document</th><th style={hd}>Status</th><th style={hd}>Ref.</th><th style={hd}>Submitted</th><th style={hd}>Returned</th><th style={hd}>Code</th><th style={hd}></th></tr></thead>
          <tbody>{docsShown.map(function(x){
            var d=x.d,list=d.cycles,last=list[list.length-1],sm=x.sm;
            var k=last&&FLOW_CODE_COL[last.code];
            return <tr key={d.id}>
              <td style={Object.assign({},cell,{minWidth:150})}><span style={{fontSize:10,color:"#9b968b",textTransform:"uppercase",letterSpacing:".04em"}}>{d.group}</span>
                <div style={{fontWeight:600}}>{docShortName(d)}</div></td>
              <td style={Object.assign({},cell,{color:SC[sm.state],fontWeight:600,minWidth:150})}>{sm.text}<OverdueTag o={sm.overdue}/></td>
              <td style={Object.assign({},cell,{fontFamily:"var(--font-mono)",fontSize:11,color:"#6f6b62"})}>{last?(last.ref||(docCurRef(td,d))||<span style={{color:"#b3302a"}}>ref. missing</span>):"—"}</td>
              <td style={cell}>{last?<DraftDateInput value={last.submitted||""} disabled={ro} onCommit={function(v){saveDoc(d,updCycle(list,last.id,{submitted:v}));}} style={dIn}/>
                :<span style={{fontSize:11,color:"#9b968b"}}>{isValidDate(d.theoSub)?"due "+fmtDate(d.theoSub):"—"}</span>}</td>
              <td style={cell}>{last&&last.submitted?<DraftDateInput value={last.returned||""} disabled={ro} onCommit={function(v){saveDoc(d,updCycle(list,last.id,{returned:v}));}} style={dIn}/>:<span style={{color:"#ccc"}}>—</span>}</td>
              <td style={cell}>{last&&last.submitted?<select value={last.code||""} disabled={ro}
                  style={Object.assign({fontSize:11.5,padding:"2px 5px",width:"auto"},k?{background:k[0],color:k[1],fontWeight:700}:{})}
                  onChange={function(e){var pt={code:e.target.value};if(e.target.value&&!last.returned)pt.returned=now;saveDoc(d,updCycle(list,last.id,pt));}}>
                  <option value="">pending</option>
                  {CYCLE_CODES.map(function(o){return <option key={o.k} value={o.k}>{o.k} — {o.label}</option>;})}
                </select>:<span style={{color:"#ccc"}}>—</span>}</td>
              <td style={Object.assign({},cell,{whiteSpace:"nowrap",textAlign:"right"})}>{!ro&&canAddCycle(list)&&<button className="btn btn-sm" style={{fontSize:10.5,padding:"2px 8px"}}
                onClick={function(){recordDocSubmission(td,d,function(patch){updTd(patch);},afterSave);}}>{list.length?"↻ Resubmit R"+(last.rev+1):"+ Submitted"}</button>}</td>
            </tr>;
          })}</tbody>
        </table>}
        <div style={{marginTop:14}}><TenderFollowUpCard td={td} tasks={tasks} saveTasks={saveTasks} updTd={updTd}/></div>
      </div>
      <div className="modal-footer">
        {onOpenSheet&&<button className="btn" style={{marginRight:"auto"}} onClick={function(){onClose();onOpenSheet(td);}}>Open the full sheet</button>}
        <span style={{fontSize:11,color:"#9b968b"}}>Each change is saved at once.</span>
        <button className="btn btn-gold" onClick={onClose}>Done</button>
      </div>
    </div>
  </div>;
}
// Print window of the Package table: column set, page size and timelines. Page size and
// timelines are remembered (localStorage pp_procplan_print); the column set starts from the
// one on screen.
function PpPrintModal({mode,cols,tl,onClose,onPrint}){
  var saved=(function(){try{return JSON.parse(localStorage.getItem("pp_procplan_print")||"{}")||{};}catch(e){return {};}})();
  const [c,setC]=useState(ppColsNorm(cols));
  const [paper,setPaper]=useState(ppColsList(cols).length===3?"A3":(saved.paper==="A3"?"A3":"A4"));
  const [withTl,setWithTl]=useState(saved.tl!==undefined?!!saved.tl:!!tl);
  function chip(on){return {borderRadius:16,background:on?"var(--brand,#173b63)":"#fff",color:on?"#fff":"var(--ink-3,#6f6b62)",borderColor:on?"var(--brand,#173b63)":"#d9d5ca"};}
  function go(){
    try{localStorage.setItem("pp_procplan_print",JSON.stringify({paper:paper,tl:withTl}));}catch(e){}
    onPrint({cols:c,paper:paper,tl:withTl});
  }
  var lbl={fontSize:10,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#9b968b",width:70};
  return <div className="overlay" onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:520}}>
      <div className="modal-hdr">
        <div className="modal-title">Print packages</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
      </div>
      <div className="modal-body">
        <div style={{fontSize:12,color:"#6f6b62",marginBottom:12}}>The packages shown print, with the current filters and order{mode==="timeline"?", as the timeline (Gantt)":""}. The table is scaled to the width of the page.</div>
        {mode!=="timeline"&&<div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
          <span style={lbl}>Columns</span>
          {PP_COLSETS.map(function(x){return <button key={x.k} className="btn btn-sm" title={x.tip} style={chip(ppColsOn(c,x.k))}
            onClick={function(){var n=ppColsToggle(c,x.k);setC(n);if(ppColsList(n).length===3)setPaper("A3");}}>{x.label}</button>;})}
        </div>}
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
          <span style={lbl}>Page</span>
          {["A4","A3"].map(function(z){return <button key={z} className="btn btn-sm" style={chip(paper===z)} onClick={function(){setPaper(z);}}>{z} landscape</button>;})}
          {mode!=="timeline"&&ppColsList(c).length===3&&paper==="A4"&&<span style={{fontSize:11,color:"#b35c00"}}>All in one is small on A4: A3 is better</span>}
        </div>
        {mode!=="timeline"&&<label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,textTransform:"none",letterSpacing:0,fontFamily:"inherit",color:"var(--ink)",fontWeight:600}}>
          <input type="checkbox" checked={withTl} onChange={function(e){setWithTl(e.target.checked);}} style={{width:"auto",margin:0}}/>
          Timelines<span style={{fontSize:11,color:"#9b968b",fontWeight:400}}>a strip under each package: plan chain, milestones reached, delivery forecast</span>
        </label>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={go}>Print</button>
      </div>
    </div>
  </div>;
}
// Approval route of a package, short: the route in force and Auto / forced.
function PpRouteCell({td,upd}){
  var r=(function(){try{return tenderApprovalRoute(td);}catch(e){return {route:"",auto:"",why:"",manual:false};}})();
  var col={acc:"#0f5299",aconex:"#4a4740",none:"#6f6b62"}[r.route]||"#6f6b62";
  return <div style={{fontSize:11,minWidth:120}} title={r.why}>
    <div style={{fontWeight:700,color:col}}>{(function(){try{return tenderRouteLabel(td);}catch(e){return "—";}})()}</div>
    <select value={td.approvalRoute||""} disabled={isReadOnly()} onChange={function(e){upd(td,{approvalRoute:e.target.value});}}
      style={{fontSize:10.5,padding:"1px 4px",marginTop:2,maxWidth:150,color:r.manual?"#b35c00":"#6f6b62"}}>
      <option value="">{"Auto"+(r.auto?" — "+APPROVAL_ROUTE_LABEL[r.auto]:" — amount unknown")}</option>
      <option value="acc">ACC (forced)</option>
      <option value="aconex">Aconex (forced)</option>
      <option value="none">Internal only (forced)</option>
    </select>
  </div>;
}
// Sideways scrollbar fixed at the bottom of the screen for a wide box (the Package table):
// shown while the box is wider than its frame and its own scrollbar is below the screen;
// both scroll together. Desktop only.
function PpFloatScroll({target}){
  const barRef=useRef(null);
  const [st,setSt]=useState(null);
  useEffect(function(){
    var lock=false;
    function upd(){
      var el=target.current;
      if(!el||window._ppPhone){setSt(null);return;}
      var r=el.getBoundingClientRect(),vh=window.innerHeight||document.documentElement.clientHeight;
      var need=el.scrollWidth>el.clientWidth+2&&r.bottom>vh-4&&r.top<vh-60;
      setSt(function(o){
        var n=need?{left:Math.round(r.left),width:el.clientWidth,sw:el.scrollWidth}:null;
        if(!o&&!n)return o;
        if(o&&n&&o.left===n.left&&o.width===n.width&&o.sw===n.sw)return o;
        return n;
      });
    }
    function fromBox(){var el=target.current,b=barRef.current;if(!el||!b||lock)return;lock=true;b.scrollLeft=el.scrollLeft;lock=false;}
    upd();
    window.addEventListener("scroll",upd,true);window.addEventListener("resize",upd);
    var el=target.current;if(el)el.addEventListener("scroll",fromBox);
    var ro=null;try{if(el&&window.ResizeObserver){ro=new ResizeObserver(upd);ro.observe(el);if(el.firstChild)ro.observe(el.firstChild);}}catch(e){}
    var t=setInterval(upd,1500);
    return function(){window.removeEventListener("scroll",upd,true);window.removeEventListener("resize",upd);if(el)el.removeEventListener("scroll",fromBox);if(ro)ro.disconnect();clearInterval(t);};
  },[]);
  useEffect(function(){var el=target.current,b=barRef.current;if(el&&b)b.scrollLeft=el.scrollLeft;},[st]);
  if(!st)return null;
  return <div ref={barRef} className="pp-fscroll" title="Scroll the table sideways"
    onScroll={function(e){var el=target.current;if(el&&Math.abs(el.scrollLeft-e.currentTarget.scrollLeft)>1)el.scrollLeft=e.currentTarget.scrollLeft;}}
    style={{position:"fixed",bottom:0,left:st.left,width:st.width,height:18,overflowX:"scroll",overflowY:"hidden",zIndex:60,
      background:"#eef2f8",borderTop:"1px solid #c7d5e6",boxShadow:"0 -2px 6px rgba(23,42,66,.08)"}}>
    <div style={{width:st.sw,height:1}}></div>
  </div>;
}
// The Package view: every package of the project (Package list and Procurement plan merged).
// Rendered by TendersView as its list; onOpenTender opens a package sheet in place.
// Owner of a Package in the list: the coloured chip, with a list of people laid over it to
// change it (same field as OWNER in the sheet header, td.ownerTender).
function PpOwnerCell({td,people,upd}){
  var ro=isReadOnly(),cur=td.ownerTender||"";
  var list=(people||[]).slice();if(cur&&list.indexOf(cur)<0)list.unshift(cur);
  var chip=cur?<OwnerChip owner={cur}/>:<span style={{color:ro?"#ccc":"#9b968b",fontSize:11}}>{ro?"—":"＋ owner"}</span>;
  if(ro)return chip;
  return <span style={{position:"relative",display:"inline-block",cursor:"pointer"}} title="Change the owner of this Package">
    {chip}
    <select value={cur} onChange={function(e){upd(td,{ownerTender:e.target.value});}} aria-label="Owner"
      style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0,cursor:"pointer"}}>
      <option value="">— no owner —</option>
      {list.map(function(p){return <option key={p} value={p}>{p}</option>;})}
    </select>
  </span>;
}
function ProcPlanView({tenders,saveTenders,packages,people,tasks,saveTasks,onNavTender,onOpenTender,onNavZone,onQuickUpdate,actions,primary}){
  function lsGet(k,d){try{var v=localStorage.getItem(k);return v===null?d:v;}catch(e){return d;}}
  function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
  const [q,setQ]=useState(function(){return lsGet("pp_procplan_q","");});
  const [typeF,setTypeF]=useState(function(){return lsGet("pp_procplan_type","all");});
  const [deptF,setDeptF]=useState(function(){return lsGet("pp_procplan_dept","all");});
  const [horizon,setHorizon]=useState(function(){var h=lsGet("pp_procplan_horizon","all");return h==="4w"||h==="8w"?h:"all";});
  const [kpiF,setKpiF]=useState(function(){return lsGet("pp_procplan_kpi","");});                   // status tile used as a filter
  const [quickF,setQuickF]=useState(function(){return lsGet("pp_procplan_quick","");});               // With client / Late delivery / Not awarded
  const [mode,setMode]=useState(function(){return lsGet("pp_procplan_view","table")==="timeline"?"timeline":"table";});
  const [grouped,setGrouped]=useState(function(){return lsGet("pp_procplan_group","0")==="1";});
  const [cols,setCols]=useState(function(){return ppColsNorm(lsGet("pp_procplan_cols","plan"));});
  const [ownerF,setOwnerF]=useState(function(){return lsGet("pp_procplan_owner","all");});            // package owner (ownerTender)
  const [awdF,setAwdF]=useState(function(){return lsGet("pp_procplan_awd","all");});                  // awarded to (subcontractor)
  const [tl,setTl]=useState(function(){return lsGet("pp_procplan_tl","1")!=="0";});
  const [leg,setLeg]=useState(function(){return lsGet("pp_procplan_leg","1")!=="0";});
  useEffect(function(){lsSet("pp_procplan_leg",leg?"1":"0");},[leg]);
  const [sort,setSort]=useState(function(){
    try{var o=JSON.parse(lsGet("pp_procplan_sort","")||"null");if(o&&PP_SORTS[o.k])return {k:o.k,dir:o.dir<0?-1:1};}catch(e){}
    return {k:"deadline",dir:1};
  });
  useEffect(function(){lsSet("pp_procplan_sort",JSON.stringify(sort));},[sort]);
  useEffect(function(){lsSet("pp_procplan_owner",ownerF);lsSet("pp_procplan_awd",awdF);},[ownerF,awdF]);
  const [paste,setPaste]=useState(false);
  const [printOpen,setPrintOpen]=useState(false);
  useEffect(function(){lsSet("pp_procplan_horizon",horizon);},[horizon]);
  useEffect(function(){lsSet("pp_procplan_view",mode);},[mode]);
  useEffect(function(){lsSet("pp_procplan_group",grouped?"1":"0");},[grouped]);
  useEffect(function(){lsSet("pp_procplan_cols",cols);},[cols]);
  useEffect(function(){lsSet("pp_procplan_tl",tl?"1":"0");},[tl]);
  useEffect(function(){lsSet("pp_procplan_q",q);lsSet("pp_procplan_type",typeF);lsSet("pp_procplan_dept",deptF);lsSet("pp_procplan_kpi",kpiF);lsSet("pp_procplan_quick",quickF);},[q,typeF,deptF,kpiF,quickF]);
  var ro=isReadOnly();
  var now=today();
  var rows=(tenders||[]).filter(function(t){return !t.cancelled;}).map(function(t){return {td:t,p:ppPlan(t,now)};});
  var depts=[...new Set(rows.map(function(r){return r.td.package||"";}).filter(Boolean))].sort();
  var owners=[...new Set(rows.map(function(r){return String(r.td.ownerTender||"").trim();}).filter(Boolean))].sort(function(a,b){return a.localeCompare(b);});
  var awds=[...new Set([].concat.apply([],rows.map(function(r){return ppAwardedNames(r.td);})).filter(Boolean))].sort(function(a,b){return a.localeCompare(b);});
  // type / department / search / quick filter first: the tiles count what those filters leave
  var base=rows.filter(function(r){
    if(typeF!=="all"&&ppType(r.td)!==typeF)return false;
    if(deptF!=="all"&&(r.td.package||"")!==deptF)return false;
    if(quickF&&!tenderQuick(r.td,quickF))return false;
    if(ownerF!=="all"){var ow=String(r.td.ownerTender||"").trim();if(ownerF==="—"?ow:ow!==ownerF)return false;}
    if(awdF!=="all"){var an=ppAwardedNames(r.td);if(awdF==="—"?an.length:an.indexOf(awdF)<0)return false;}
    if(q){
      var s=q.toLowerCase();
      if(String(r.td.title||"").toLowerCase().indexOf(s)<0&&String(r.td.package||"").toLowerCase().indexOf(s)<0&&String(r.td.ownerTender||"").toLowerCase().indexOf(s)<0
        &&ppAwardedNames(r.td).join(" ").toLowerCase().indexOf(s)<0)return false;
    }
    return true;
  });
  var acts=ppActionsIndex(tasks);
  var vis=ppSortRows(base.filter(function(r){
    if(kpiF&&!ppKpiOf(r,kpiF))return false;
    if(horizon==="4w"||horizon==="8w"){
      if(r.p.status==="past")return false;
      return r.p.daysLeft!==null&&r.p.daysLeft<=(horizon==="4w"?28:56);
    }
    return true;
  }),sort,acts);
  var budgetVis=vis.reduce(function(s,r){return s+ppBudget(r.td);},0);
  var ft=ppFinanceTotals(vis);
  var NOACT={next:[],block:[],rfi:[],rfiDone:[]};
  const tdRef=useRef(tenders);tdRef.current=tenders;
  const wrapRef=useRef(null);             // the table box, for the scrollbar fixed at the bottom
  function upd(td,patch){if(blockIfReadOnly())return;saveTenders((tdRef.current||[]).map(function(t){return t.id===td.id?Object.assign({},t,patch):t;}));}
  function openTd(id){
    if(onOpenTender){var t=(tenders||[]).find(function(x){return x.id===id;});if(t)onOpenTender(t);return;}
    if(onNavTender)onNavTender(id,"procplan");
  }
  var plan=ppColsHas(cols,"plan"),fin=ppColsHas(cols,"finance"),fol=ppColsHas(cols,"follow");
  // Finance alone: no Next deadline column (and no timeline strip)
  var dl=plan||fol,nb=2+(fin?1:0)+(dl?2:0);   // Package + Subcontractor; Budget only with Finance; Next deadline + RFI with Plan or Follow-up
  var nCols=nb+(plan?PP_TABLE_COLS.length+1:0)+(fin?3:0)+(fol?4:0);
  // The timeline strip sits under the milestone columns (or under everything without them).
  var tlSpan=plan?PP_TABLE_COLS.length+1:nCols-nb,tlRest=nCols-nb-tlSpan;
  var model=tl&&dl&&mode==="table"&&vis.length?ppNowModel(vis,now):null;
  var HZ=[["all","Any date"],["4w","Next deadline ≤ 4 weeks"],["8w","≤ 8 weeks"]];
  var QF=[["cl","With client","At least one document waits for the client's answer"],["late","Late delivery","Will start late: forecast delivery after a start on site still to come (packages already started are not listed)"],["na","Not awarded","No subcontractor recorded in Awards"]];
  function filterLabel(){
    var f=[];
    if(kpiF)f.push((PP_KPIS.find(function(k){return k.k===kpiF;})||{}).label);
    if(horizon!=="all")f.push((HZ.find(function(h){return h[0]===horizon;})||[0,""])[1]);
    if(quickF)f.push((QF.find(function(x){return x[0]===quickF;})||[0,""])[1]);
    if(typeF!=="all")f.push(ppTypeLabel(typeF));if(deptF!=="all")f.push(deptF);
    if(ownerF!=="all")f.push("Owner: "+(ownerF==="—"?"none":ownerF));if(awdF!=="all")f.push("Awarded to: "+(awdF==="—"?"nobody":awdF));
    if(q)f.push('"'+q+'"');
    return f.join(" · ");
  }
  function th(k,label,style,tip,cls){
    var on=sort.k===k;
    return <th className={cls||""} style={Object.assign({cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"},style||{})} title={(tip?tip+"\n":"")+"Click to sort"}
      onClick={function(){setSort(on?{k:k,dir:-sort.dir}:{k:k,dir:1});}}>{label}<span style={{color:on?"var(--ink,#16181d)":"#ccc",marginLeft:3}}>{on?(sort.dir>0?"▲":"▼"):"↕"}</span></th>;
  }
  function needCell(td,p){
    // From the schedule when a task is linked (read-only); typed by hand only without one.
    var f=tenderScheduleStart(td);
    return <React.Fragment>
      {f?<span onClick={function(){openScheduleStart(f,td,onNavZone);}}
          title={"From the schedule: \""+(f.r.label||"task")+"\" in "+(f.sc.zone||"?")+" ("+(f.sc.title||"")+")\nClick to open that task in the schedule; ✎ to change the date (moves the task)."}
          style={{fontSize:11,fontWeight:700,color:"#00695c",background:"#e6f2e9",border:"1px solid #cfe3d5",borderRadius:5,padding:"2px 7px",cursor:"pointer",whiteSpace:"nowrap"}}>
          🗓 {fmtDate(td.startOnSite||f.r.startWeek)}</span>
        :null}
      {f&&<PpMoveStartBtn td={td} f={f} onNavZone={onNavZone}/>}
      {!f&&<DraftDateInput value={td.startOnSite||""} disabled={ro}
          title="No schedule task is linked to this package: set the date by hand (saved when the date is complete: Enter, Tab or click elsewhere; Esc cancels). As soon as a task is linked, the schedule takes over."
          onCommit={function(v){upd(td,{startOnSite:v});}} style={{fontSize:11,padding:"2px 5px",width:126}}/>}
      {p.needNext&&p.needTask&&<div style={{fontSize:10,color:"#b35c00",marginTop:2,whiteSpace:"nowrap",cursor:"pointer"}}
        onClick={function(){openScheduleStart(p.needTask,td,onNavZone);}}
        title={"The first task has started; the next linked task not started yet is \""+(p.needTask.r.label||"task")+"\" in "+(p.needTask.sc.zone||"?")+" — the plan is worked back from it. Click to open it."}>
        next task {fmtDate(p.need)}</div>}
      {p.needPassed&&<div style={{fontSize:10,color:"#b3302a",fontWeight:700,marginTop:2,whiteSpace:"nowrap"}}
        title="The need date is past but nothing shows the package has started: no actual week on its schedule task(s), or no contract / delivery. It is late, not started.">
        passed · not started</div>}
    </React.Fragment>;
  }
  function line(r){
    var td=r.td,p=r.p,st=PP_STATUS[p.status];
    var allOk=ppAllValid(td,p);
    var soon=!allOk&&ppStartsSoon(p,now),a=acts[td.id]||NOACT,stg=ppStageOf(td,now);
    var dLeft=soon?Math.round((parseISODate(p.need)-parseISODate(now))/86400000):null;
    // starts within 21 days: amber background and rule on the left, days to go under the name;
    // everything validated: the whole row pale green
    var hl=allOk?{background:"var(--green-soft,#e6f2e9)"}:soon?{background:"var(--amber-soft,#fdf1e0)"}:null;
    var rule=allOk?{boxShadow:"inset 3px 0 0 var(--green,#1e6b3a)"}:soon?{boxShadow:"inset 3px 0 0 var(--amber,#b35c00)"}:null;
    var prop=ppProposed(td),bud=ppBudget(td),vr=ppVariance(td);
    return <React.Fragment key={td.id}>
      <tr className="ppt-main" style={hl}>
        <td style={Object.assign({minWidth:160,maxWidth:220},rule||{})}>
          <span style={{fontWeight:600,cursor:"pointer",color:"var(--ink,#16181d)"}} onClick={function(){openTd(td.id);}} title="Open the package">{td.title||"(untitled)"}</span>
          <div style={{fontSize:11,color:"#6f6b62",marginTop:2,display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
            <span>{td.package||"No department"}</span><span>·</span>
            <select value={ppType(td)} disabled={ro} onChange={function(e){upd(td,{procType:e.target.value});}} title="Type: sets the lead time template of the plan"
              style={{fontSize:10.5,padding:"0 2px",border:"none",background:"transparent",backgroundImage:"none",WebkitAppearance:"none",MozAppearance:"none",appearance:"none",color:"#6f6b62",width:"auto",cursor:ro?"default":"pointer",textDecoration:ro?"none":"underline dotted"}}>
              {PP_TYPES.map(function(t){return <option key={t.k} value={t.k}>{t.label}</option>;})}</select>
          </div>
          {soon&&<div style={{fontSize:10,fontWeight:700,color:"var(--amber,#b35c00)",marginTop:2}}>starts on site {dLeft===0?"today":"in "+dLeft+" d"}</div>}
          {allOk&&<div style={{fontSize:10,fontWeight:700,color:"var(--green,#1e6b3a)",marginTop:2}} title="Every milestone reached (or N/A) and every document approved">✓ All validated</div>}
          {onQuickUpdate&&<button className="btn btn-sm" onClick={function(){onQuickUpdate(td.id);}} title="Quick update (meeting): target dates of the running steps, document status and return dates, next steps, blocking points, notes — in one window"
            style={{fontSize:10.5,padding:"1px 8px",marginTop:4}}>⚡ Update</button>}
        </td>
        <td style={{minWidth:120,maxWidth:180,fontSize:11.5}}>{(function(){var sn=ppSubName(td);
          return sn?<span style={{fontWeight:600,color:"var(--ink)"}}>{sn}</span>:<span style={{color:"#b9b4a8",fontSize:11}}>Not awarded</span>;})()}</td>
        {fin&&<td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,whiteSpace:"nowrap"}}>{bud?bud.toLocaleString():"—"}</td>}
        {dl&&<td style={{minWidth:150,maxWidth:190}}>
          {ppNextAct(p)&&<div style={{fontSize:9.5,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#9b968b"}}>To do</div>}
          <span className="badge" style={{background:st.bg,color:st.fg}} title={ppNextAct(p)?"Next thing to do on this package, and its latest date (worked back from the need on site)":st.label}>{ppNextAct(p)||st.label}</span>
          {ppNextAct(p)?<div style={{fontSize:10.5,fontWeight:700,color:st.fg,marginTop:2}}>{ppNextBy(p)}</div>
            :p.daysLeft!==null&&<div style={{fontSize:10.5,fontWeight:700,color:st.fg,marginTop:2}}>{ppDaysText(p.daysLeft)}</div>}
          <div dangerouslySetInnerHTML={{__html:ppWhoHtml(stg)}}/>
        </td>}
        {dl&&<td><PpRfiCell td={td} list={a.rfi} done={a.rfiDone} tasks={tasks} saveTasks={saveTasks}/></td>}
        {plan&&PP_TABLE_COLS.map(function(m,i){
          return <td key={m} className={"ms"+(i===0?" sep":"")+(m.indexOf("sub_")===0?" sub":"")} dangerouslySetInnerHTML={{__html:ppMsCellHtml(ppColCell(td,p,m,now))}}></td>;
        })}
        {plan&&<td className="sep" style={{minWidth:112}}>{needCell(td,p)}</td>}
        {fin&&<td className="sep" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:"#0f5299",whiteSpace:"nowrap"}}>{prop?prop.toLocaleString():"—"}</td>}
        {fin&&<td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,color:"#1e6b3a",whiteSpace:"nowrap"}}>{ppInstructed(td)?ppInstructed(td).toLocaleString():"—"}</td>}
        {fin&&<td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,whiteSpace:"nowrap",color:vr===null?"#ccc":vr<0?"#b3302a":"#1e6b3a"}}
          title="Budget − instructed">{vr===null?"—":ppSigned(vr)}</td>}
        {fol&&<td className="sep"><PpOwnerCell td={td} people={people} upd={upd}/></td>}
        {fol&&<td><PpActionsCell td={td} list={a.next} kind="next" tasks={tasks} saveTasks={saveTasks} updTd={function(p){upd(td,p);}}/></td>}
        {fol&&<td><PpActionsCell td={td} list={a.block} kind="block" tasks={tasks} saveTasks={saveTasks}/></td>}
        {fol&&<td><PpNotesCell td={td} upd={upd}/></td>}
      </tr>
      {model&&<tr className="ppt-strip" style={hl}>
        <td colSpan={nb} className="nx" style={rule} dangerouslySetInnerHTML={{__html:ppNowHtml(model.rows[td.id])}}></td>
        <td colSpan={tlSpan} dangerouslySetInnerHTML={{__html:ppNowStripHtml(model.rows[td.id],model)}}></td>
        {tlRest>0&&<td colSpan={tlRest}></td>}
      </tr>}
    </React.Fragment>;
  }
  function chip(on){return "fchip"+(on?" on":"");}
  var sepBar=<span style={{width:1,height:18,background:"var(--rule,#ddd9cf)",margin:"0 2px"}}></span>;
  var capS={fontFamily:"var(--font-mono)",fontSize:10,fontWeight:600,letterSpacing:".06em",textTransform:"uppercase",color:"#6f6b62"};
  return <div>
    <style>{PP_TABLE_CSS}</style>
    <div className="page-hdr">
      <div><div className="page-title">Packages</div>
        <div className="page-sub">Every package: where it stands, and the latest date of each milestone worked back from the need on site</div></div>
      <div className="page-actions">
        {actions}
        <button className="btn" disabled={!vis.length} title="Excel file of the packages shown (current filters and order): latest and actual date of every milestone, finance and follow-up"
          onClick={function(){ppExportXlsx(vis,acts);}}>Excel</button>
        <button className="btn" disabled={!vis.length} title="Print the packages shown: choose the columns, A4 or A3, with or without the timelines"
          onClick={function(){setPrintOpen(true);}}>Print</button>
        {!ro&&<button className="btn" onClick={function(){setPaste(true);}} title="Create or update packages from a list pasted from Excel">Paste list from Excel</button>}
        {primary}
      </div>
    </div>
    {paste&&<ProcPlanPasteModal tenders={tenders} saveTenders={saveTenders} packages={packages} onClose={function(){setPaste(false);}}/>}
    {printOpen&&<PpPrintModal mode={mode} cols={cols} tl={tl} onClose={function(){setPrintOpen(false);}}
      onPrint={function(o){setPrintOpen(false);ppOpenReport(vis,filterLabel(),mode,grouped,acts,o);}}/>}
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
          {fin&&<div className="kpi-s">{ppMoney(b)} budget</div>}
        </div>;
      })}
    </div>
    {fin&&<div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"baseline",background:"#fff",border:"1px solid var(--rule,#ddd9cf)",borderRadius:8,padding:"7px 14px",margin:"0 0 10px",fontSize:12,color:"#6f6b62"}}
      title="Totals of the packages shown: budget, proposed (ACC / Aconex amount), instructed, and budget − instructed on the instructed packages">
      <span>Budget <b style={{color:"var(--ink)",fontFamily:"var(--font-mono)"}}>{ppNum(ft.budget)}</b></span>
      <span>Proposed <b style={{color:"#0f5299",fontFamily:"var(--font-mono)"}}>{ppNum(ft.proposed)}</b></span>
      <span>Instructed <b style={{color:"#1e6b3a",fontFamily:"var(--font-mono)"}}>{ppNum(ft.instructed)}</b></span>
      <span>Var. budget − instructed <b style={{color:ft.variance<0?"#b3302a":"#1e6b3a",fontFamily:"var(--font-mono)"}}>{ft.nVar?ppSigned(ft.variance):"—"}</b>
        {ft.nVar?<span style={{fontSize:10.5}}> on {ft.nVar} instructed package{ft.nVar>1?"s":""}</span>:null}</span>
    </div>}
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Package, department, owner…" style={{width:210,padding:"5px 10px",fontSize:12}}/>
      {HZ.map(function(h){return <button key={h[0]} className={chip(horizon===h[0])} onClick={function(){setHorizon(h[0]);}}>{h[1]}</button>;})}
      {sepBar}
      {QF.map(function(x){var on=quickF===x[0];return <button key={x[0]} className={chip(on)} title={x[2]} onClick={function(){setQuickF(on?"":x[0]);}}>{x[1]}</button>;})}
      <span style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
        {mode==="table"&&<React.Fragment>
          <span style={capS}>Columns</span>
          {PP_COLSETS.map(function(x){return <button key={x.k} className={chip(ppColsOn(cols,x.k))} title={x.tip+(x.k==="all"?"":" — click to show / hide this set")} onClick={function(){setCols(ppColsToggle(cols,x.k));}}>{x.label}</button>;})}
          {sepBar}
        </React.Fragment>}
        <span style={capS}>Display</span>
        <button className={chip(mode==="table")} onClick={function(){setMode("table");}} title="One row per package: where it stands and the latest date of every milestone">Table</button>
        <button className={chip(mode==="timeline")} onClick={function(){setMode("timeline");}} title="Each package as its procurement chain on a calendar">Timeline</button>
      </span>
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
      <button className={chip(typeF==="all")} onClick={function(){setTypeF("all");}}>All types</button>
      {PP_TYPES.map(function(t){return <button key={t.k} className={chip(typeF===t.k)} onClick={function(){setTypeF(typeF===t.k?"all":t.k);}}>{t.label}</button>;})}
      <select value={deptF} onChange={function(e){setDeptF(e.target.value);}} style={{fontSize:12,padding:"4px 8px",marginLeft:8,width:"auto"}}>
        <option value="all">All departments</option>
        {depts.map(function(d){return <option key={d} value={d}>{d}</option>;})}
      </select>
      <select value={ownerF} onChange={function(e){setOwnerF(e.target.value);}} title="Owner of the package" style={{fontSize:12,padding:"4px 8px",width:"auto",maxWidth:200}}>
        <option value="all">All owners</option>
        {owners.map(function(o){return <option key={o} value={o}>{o}</option>;})}
        <option value="—">No owner</option>
      </select>
      <select value={awdF} onChange={function(e){setAwdF(e.target.value);}} title="Subcontractor / supplier the package is awarded to" style={{fontSize:12,padding:"4px 8px",width:"auto",maxWidth:200}}>
        <option value="all">All awarded to</option>
        {awds.map(function(o){return <option key={o} value={o}>{o}</option>;})}
        <option value="—">Not awarded</option>
      </select>
      <button className={chip(grouped)} onClick={function(){setGrouped(!grouped);}} title="Group the packages by department">By department</button>
      {mode==="table"&&dl&&<label className="phone-hide" title="A strip under each package: the plan chain (latest dates), the milestones reached, the need on site, the delivery forecast and today"
        style={{display:"inline-flex",alignItems:"center",gap:6,margin:"0 0 0 6px",cursor:"pointer",fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:0,fontFamily:"inherit",color:"var(--ink)"}}>
        <input type="checkbox" checked={tl} onChange={function(e){setTl(e.target.checked);}} style={{width:"auto",margin:0}}/>Timelines</label>}
      {(mode==="timeline"||(tl&&dl))&&<button className={chip(leg)} onClick={function(){setLeg(!leg);}} title="Show / hide the legend of the timelines">{leg?"Hide legend":"Legend"}</button>}
      {(kpiF||horizon!=="all"||quickF||typeF!=="all"||deptF!=="all"||ownerF!=="all"||awdF!=="all"||q)&&<button className="btn btn-sm" onClick={function(){setKpiF("");setHorizon("all");setQuickF("");setTypeF("all");setDeptF("all");setOwnerF("all");setAwdF("all");setQ("");}}>Clear filters</button>}
      <span style={{fontSize:11,color:"#9b968b",marginLeft:"auto"}}>{vis.length} / {rows.length} packages{fin?" · "+ppMoney(budgetVis)+" budget":""}</span>
    </div>
    {leg&&(mode==="timeline"||model)&&<div style={{marginBottom:10}} dangerouslySetInnerHTML={{__html:ppLegendHtml(mode==="timeline"?"gantt":"strip")}}></div>}
    {mode==="table"&&<PpFloatScroll key={cols+"|"+(tl?1:0)} target={wrapRef}/>}
    {mode==="timeline"
      ?(vis.length>0&&<ProcPlanGantt vis={vis} grouped={grouped} onNavTender={function(id){openTd(id);}}/>)
      :<div className="phone-scroll ppt-wrap" ref={wrapRef}>
      <table className={"tbl ppt"+(model?" ppt-tl":"")} style={{fontSize:12}}>
        <thead>
          <tr className="ppt-g">
            <th colSpan={nb}>Package</th>
            {plan&&<th colSpan={PP_TABLE_COLS.length} className="sep">Procurement milestones · ✓ reached · “by” = latest date</th>}
            {plan&&<th className="sep">Site</th>}
            {fin&&<th colSpan={3} className="sep">Finance</th>}
            {fol&&<th colSpan={4} className="sep">Follow-up</th>}
          </tr>
          <tr>
            {th("title","Package",{minWidth:160})}
            {th("awarded","Subcontractor",{minWidth:120,maxWidth:180},"Subcontractor awarded the package (Awards of the sheet, else its contractor). Sorted by name.")}
            {fin&&th("budget","Budget",{textAlign:"right"})}
            {dl&&th("deadline","Next deadline",{minWidth:150},"What has to be done next on the package, by when at the latest (worked back from the need on site), how late or how many days left, and who holds it now. Red = late, orange = due within 14 days, green = on track.")}
            {dl&&th("rfi","RFI",null,"Open RFI / FCR of the package (actions tagged RFI or FCR): sent on, client answer due (sent + client answer time of Settings › Durations, or the date typed) — red when the client is late. Tick = answered: the RFI leaves this list and stays archived in the package sheet (Actions & notes). + RFI to add one. Sorted by number open.")}
            {plan&&PP_TABLE_COLS.map(function(m,i){return <React.Fragment key={m}>{th("ms_"+m,ppColLabel(m),null,ppColTip(m),i===0?"sep":"")}</React.Fragment>;})}
            {plan&&th("need","Need on site",{minWidth:112},"Start of the package on site: from its linked schedule task (🗓, change it in the schedule), typed by hand only when no task is linked","sep")}
            {fin&&th("proposed","Proposed",{textAlign:"right"},"ACC / Aconex amount proposed (subcontract + other)","sep")}
            {fin&&th("instructed","Instructed",{textAlign:"right"},"Amount instructed by the client")}
            {fin&&th("variance","Var. budget − instructed",{textAlign:"right"},"Budget − instructed: positive = under budget (green), negative = over budget (red). Empty until the package is instructed.")}
            {fol&&th("owner","Owner",null,"Owner of the package","sep")}
            {fol&&th("next","Next steps",null,"Open actions linked to the package (not Blocking Point), soonest due first, and its Next Step text. Tick to close, + add to create one. Sorted by number.")}
            {fol&&th("block","Blocking points",null,"Open actions tagged Blocking Point linked to the package — including the automatic “Procurement late” ones from the schedule. Sorted by number.")}
            {fol&&th("notes","Notes",null,"Notes of the package — the same notes as in the package sheet (Actions & notes). Click a note to edit it, + note to add one. Sorted by number.")}
          </tr>
          {model&&<tr className="ppt-scale">
            <td colSpan={nb} style={{fontSize:10.5,color:"#9b968b"}}>Now · delay → projected arrival</td>
            <td colSpan={tlSpan} dangerouslySetInnerHTML={{__html:ppScaleHtml(model)}}></td>
            {tlRest>0&&<td colSpan={tlRest}></td>}
          </tr>}
        </thead>
        <tbody>{grouped
          ?ppGroups(vis).map(function(g){
            var b=g.rows.reduce(function(s,r){return s+ppBudget(r.td);},0);
            var nl=g.rows.filter(function(r){return ppKpiOf(r,"late");}).length;
            return <React.Fragment key={g.dept||"—"}>
              <tr><td colSpan={nCols} style={{background:"#fafaf8",fontSize:10.5,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#4a4740"}}>
                {g.dept||"No department"} <span style={{fontWeight:400,textTransform:"none",letterSpacing:0,color:"#9b968b",marginLeft:6}}>
                  {g.rows.length} package{g.rows.length!==1?"s":""}{fin?" · "+ppMoney(b):""}{nl?" · ":""}{nl?<b style={{color:"#b3302a"}}>{nl} late</b>:null}</span></td></tr>
              {g.rows.map(line)}
            </React.Fragment>;
          })
          :vis.map(line)}</tbody>
      </table>
      </div>}
    {vis.length===0&&<div style={{color:"#9b968b",fontSize:12,padding:"14px 0"}}>{rows.length?"No package matches these filters.":"No package here. Paste the project list from Excel, or create a package."}</div>}
    {mode==="table"&&<div style={{fontSize:10.5,color:"#9b968b",marginTop:8,lineHeight:1.5}}>Each milestone cell: top line = what really happened (from the package sheet), bottom line = the LATEST date to reach it so the package is on site when needed. ✓ green on time, orange later than the latest date. Only the next milestone of each package is coloured: red late, orange ≤ 14 d, green on track. A package whose need date is past is "Started" and never flagged late. Amber row = starts on site within 21 days.
      {model?" Timeline: plan chain (tender · approval · contract · submittals · shop drawings · fabrication · float), faded once reached; ◆ reached (orange: late); ○ next deadline; flag = need on site; truck = delivery forecast and its gap to the need; navy line = today.":""} Lead times: Settings › Durations › Procurement plan templates, adjustable per package (Submissions › 📅 Procurement plan).</div>}
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
    <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6,letterSpacing:".4px"}}>Procurement plan templates (days per step — calendar or working, per step)</div>
    <div style={{overflowX:"auto"}}>
    <table className="tbl" style={{fontSize:11.5}}>
      <thead><tr><th>Step</th>{PP_TYPES.map(function(t){return <th key={t.k} style={{textAlign:"right"}}>{t.label}</th>;})}<th>Unit</th></tr></thead>
      <tbody>{PP_STEPS.map(function(s){
        if(PP_SETTINGS_STEPS.indexOf(s.k)>=0)return <tr key={s.k}><td>{s.label}</td>
          <td colSpan={PP_TYPES.length+1} style={{color:"#9b968b",fontSize:11}}>{ppLeadTxt(ppLead(ppSettingsLead(s.k),"settings","",ppSettingsLeadParts(s.k)))} — from the durations above, in their own unit (same for every type; can be typed per package)</td></tr>;
        return <tr key={s.k}><td>{s.label}</td>
          {PP_TYPES.map(function(t){
            var v=(cur[t.k]||{})[s.k];var def=ppStepDefault(cur[t.k],t.k,s.k);
            return <td key={t.k} style={{textAlign:"right"}}><input type="number" min="0" value={v===undefined?"":v} placeholder={String(def)}
              onChange={function(e){set(t.k,s.k,e.target.value);}} style={{width:64,textAlign:"right",fontSize:11.5,padding:"3px 6px",fontWeight:v!==undefined?700:400}}/></td>;
          })}<td><DurUnitPick k={"tpl_"+s.k} durations={durations} saveDurations={saveDurations}/></td></tr>;
      })}</tbody>
    </table>
    </div>
  </div>;
}
