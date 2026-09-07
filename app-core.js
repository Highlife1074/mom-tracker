// ===========================================================================
// app-core.js — Constants, date/permission helpers, shared components, App itself.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

const {useState,useEffect,useRef,useCallback}=React;

class ErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={err:null,info:null};}
  static getDerivedStateFromError(err){return{err,info:null};}
  componentDidCatch(err,info){this.setState({err,info});}
  render(){
    if(this.state.err){
      return React.createElement("div",{style:{padding:24,fontFamily:"monospace",color:"#c62828",whiteSpace:"pre-wrap",fontSize:13,background:"#fff",minHeight:"100vh"}},
        "REACT RENDER ERROR:\n"+(this.state.err.message||String(this.state.err))+"\n\nComponent stack:\n"+(this.state.info&&this.state.info.componentStack||"no stack"));
    }
    return this.props.children;
  }
}

const KEYS_IMP="pp_improvements";
const KEYS_PINS="pp_user_pins";
const KEYS_PREFS="pp_user_prefs";

const KEYS_CORR="pp_correspondences";
const KEYS_AWN="pp_awn";
const KEYS_ROOMS="pp_rooms";
const KEYS_KPIS="pp_kpis";
const KEYS_MEETINGS="pp_meetings";
const KEYS_MOMS="pp_moms";
const KEYS_SCHEDULES="pp_schedules";
// A schedule is a weekly bar-chart plan for one zone.
// rows = [{id, kind:"category"|"task", label, cells:{ "<mondayISO>": "plan"|"actual"|"both" }}]
function newSchedule(overrides){return Object.assign({id:uuid(),zone:"",title:"New schedule",startDate:today(),weeks:12,rows:[],holidayWeeks:[],groups:[],createdAt:today(),updatedAt:today(),updatedBy:window._currentUser?window._currentUser.name:""},overrides||{});}
// Reference documents attached to a schedule: setting-out plans, sections, details.
// The file itself lives on SharePoint — we only keep the link, so there is no size limit
// and access stays governed by SharePoint permissions.
// ---------------------------------------------------------------------------
// Printable reports.
// Each one opens a standalone tab holding plain HTML: the browser's own print
// dialog turns it into a PDF. Keeping them out of the app DOM means the app's
// own print rules can never crop or reflow them.
// ---------------------------------------------------------------------------
function newMeeting(overrides){return Object.assign({id:uuid(),zone:"",date:today(),attendance:{},createdAt:today(),createdBy:window._currentUser?window._currentUser.name:""},overrides||{});}
const KEYS={
  tasks:"pp_tasks", trackers:"pp_trackers", tenders:"pp_tenders",
  contractors:"pp_contractors", people:"pp_people", tags:"pp_tags",
  packages:"pp_packages", groups:"pp_groups", tagrules:"pp_tagrules", pkgrules:"pp_pkgrules",
  pkgowners:"pp_pkgowners", zones:"pp_zones", zoneowners:"pp_zoneowners", pkgsubcontractors:"pp_pkgsubcontractors",
  tenderrules:"pp_tenderrules",
  peopleemails:"pp_people_emails", defaultcc:"pp_default_cc", peopleaccess:"pp_people_access",
  durations:"pp_durations"
};
const SEED_ZONES=["P2/P1","LO"];
// The app owner: only this profile can change global durations.
const APP_ADMIN="HORN, Philippe";
// Tolerant match: ignores commas, extra spaces, accents and word order ("HORN Philippe" == "Philippe HORN")
function _normName(s){
  return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z ]/g," ").split(/\s+/).filter(Boolean).sort().join(" ");
}
function isAppAdmin(name){return _normName(name)===_normName(APP_ADMIN);}
// zoneOwners[zone] may be a single name (legacy) or an array of names
function zoneLeadersOf(zoneOwners,zone){
  var v=(zoneOwners||{})[zone];
  if(!v)return[];
  return Array.isArray(v)?v:[v];
}
// A read-only person can open everything they are allowed to see and change nothing.
// The check is deliberately in one place: scattered ad-hoc tests are how a "view only"
// account ends up able to delete something.
function isReadOnly(){return !!window._ppReadOnly;}
function mayDelete(){return !!window._ppMayDelete;}
function blockIfReadOnly(){
  if(!window._ppReadOnly)return false;
  safeAlert("Your account is set to read only.\n\nYou can open and print everything, but not change it. Ask "+APP_ADMIN+" if you need to edit.");
  return true;
}
function canEditZoneSchedule(zoneOwners,zone,user){
  if(window._ppReadOnly)return false;          // read-only beats every other rule
  if(isAppAdmin(user))return true;
  return zoneLeadersOf(zoneOwners,zone).indexOf(user)>=0;
}
// All configurable lead times, in the unit shown to the user. Editable in Settings > Durations.
const DEFAULT_DURATIONS={
  accToRequest:3,          // working days: ACC/Aconex approved -> subcontract request to be sent
  requestToCirculate:7,    // working days: request sent -> contract to circulate
  circulateToSign:14,      // working days: circulated -> signed by all
  accToSigned:28,          // working days: ACC approval -> signed contract target
  accApproval:14,          // working days: ACC submitted -> approval expected
  clientResponse:14,       // calendar days: any document submitted to client -> response expected
  sdAfterContract:14,      // working days: contract signed -> SD submission
  sdApproval:14,           // working days: SD submitted -> SD approval
  contractSigning:28,      // working days: used by the procurement timeline
  wmsBeforeStart:28,       // calendar days: WMS must be submitted this long BEFORE the target start
  marAfterContract:14,     // calendar days: MAR is due this long AFTER the contract is signed
  itpBeforeStart:28        // calendar days: ITP must be submitted this long BEFORE the target start
};
function getDur(key){
  var d=(window._ppDurations||{});
  var v=Number(d[key]);
  // fall back to the default whenever the stored value is missing or not a usable number
  if(!isFinite(v)||v<0)v=Number(DEFAULT_DURATIONS[key]);
  return isFinite(v)?v:0;
}
// Project subcontractor list = names declared in Settings > Subcontractors, merged with
// every subcontractor created in the Subcontractors tab. Case-insensitive de-duplication.
// Shared subcontractor palette: same swatches in Settings and in the Schedule, so a colour
// means the same company everywhere. Blue is deliberately absent — it is the "actual" bar.
function tenderRuleFor(rules,group,zone){
  if(!group)return null;
  var g=String(group).toLowerCase();
  var exact=null,any=null;
  (rules||[]).forEach(function(r){
    if(!r||!r.tenderId||String(r.group||"").toLowerCase()!==g)return;
    if(r.zone&&r.zone===zone){if(!exact)exact=r;}
    else if(!r.zone){if(!any)any=r;}
  });
  return exact||any;
}
function allSubcontractors(subList,contractors){
  var out=[];var seen={};
  function push(n){
    var v=String(n||"").trim();
    if(!v)return;
    var k=v.toLowerCase();
    if(seen[k])return;
    seen[k]=1;out.push(v);
  }
  (subList||[]).forEach(push);
  (contractors||[]).forEach(function(c){push(c&&c.name);});
  return out.sort(function(a,b){return a.localeCompare(b);});
}
function newKPI(overrides){return Object.assign({id:uuid(),zone:"",name:"",unit:"",totalTarget:0,startDate:"",endDate:"",weeklyActuals:{},createdAt:today()},overrides||{});}
function uuid(){return"id_"+Math.random().toString(36).slice(2)+Date.now().toString(36);}
function qualityTag(pkg){
  if(!pkg)return"Quality External";
  var p=pkg.toLowerCase();
  if(p.includes("podium"))return"Quality Podium";
  if(p.includes("external")||p.includes("works"))return"Quality External";
  return"Quality Tower";
}
var APP_BUILD="2026-08-16-j";
window._appBuild=APP_BUILD;
console.log("Pilot Tracker build",APP_BUILD);
function today(){return toISO(new Date());}
function fmtDate(d){if(!d)return"—";const p=String(d).split("-");return p.length===3?p[2]+"/"+p[1]+"/"+p[0].slice(2):d;}
// A date is usable only if it parses AND lands in a sane project range — a typo like "20255-01-01"
// used to reach toISOString() and crash the whole render with "Invalid time value".
function isValidDate(d){
  if(!d)return false;
  var t=new Date(d);
  if(isNaN(t.getTime()))return false;
  var y=t.getFullYear();
  return y>=1990&&y<=2200;
}
// Safe replacement for new Date(x).toISOString().slice(0,10): returns "" instead of throwing
function toISO(dt){
  try{
    if(!dt)return"";
    var t=(dt instanceof Date)?dt:new Date(dt);
    if(isNaN(t.getTime()))return"";
    var y=t.getFullYear();
    if(y<1990||y>2200)return"";
    var m=String(t.getMonth()+1);if(m.length<2)m="0"+m;
    var dd=String(t.getDate());if(dd.length<2)dd="0"+dd;
    return y+"-"+m+"-"+dd;
  }catch(e){return"";}
}
function fmtMonthYear(d){if(!d)return"—";var p=d.split("-");return p.length>=2?p[1]+"/"+p[0].slice(2):d;}
function calcScore(i,u){return (i||1)*(u||1);}
function textSimilarity(a,b){
  var wa=(a||"").toLowerCase().split(/[^a-z0-9]+/).filter(function(w){return w.length>2;});
  var wb=(b||"").toLowerCase().split(/[^a-z0-9]+/).filter(function(w){return w.length>2;});
  if(wa.length===0||wb.length===0)return 0;
  var setA={};wa.forEach(function(w){setA[w]=true;});
  var common=wb.filter(function(w){return setA[w];}).length;
  return common/Math.max(wa.length,wb.length);
}
function scoreStyle(s){
  if(s>=7)return{bg:"#ffeaea",color:"#c62828",label:"🔥 "+s};
  if(s>=4)return{bg:"#fff8e1",color:"#f57f17",label:"⚡ "+s};
  return{bg:"#f5f4f0",color:"#888",label:s>1?""+s:"—"};
}

const OWNER_COLORS=["#e8eaf6|#3949ab","#fce4ec|#c2185b","#e0f2f1|#00796b","#fff3e0|#e65100","#f3e5f5|#7b1fa2","#e8f5e9|#2e7d32","#fff8e1|#f57f17","#e3f2fd|#1565c0","#fbe9e7|#bf360c","#f9fbe7|#827717"];
function ownerColor(n){let h=0;if(!n)return{bg:"#f5f4f0",accent:"#888"};for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))%OWNER_COLORS.length;const p=OWNER_COLORS[h].split("|");return{bg:p[0],accent:p[1]};}
const TAG_COLORS=["#e8eaf6|#3949ab","#fce4ec|#c2185b","#e0f2f1|#00796b","#fff3e0|#e65100","#f3e5f5|#7b1fa2","#e8f5e9|#2e7d32","#fff8e1|#f57f17","#fbe9e7|#bf360c","#e3f2fd|#1565c0","#f9fbe7|#827717"];
function tagColor(t){
  if(t==="Blocking Point")return{bg:"#fce4ec",color:"#c62828"};
  if(t==="Warning")return{bg:"#fff3e0",color:"#ef6c00"};
  if(t==="Prerequisite")return{bg:"#fff8e1",color:"#f57f17"};
  let h=0;for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))%TAG_COLORS.length;const p=TAG_COLORS[h].split("|");return{bg:p[0],color:p[1]};}
function getCCsForTags(tags,tagrules){return[...new Set((tags||[]).flatMap(t=>tagrules[t]||[]))];}
function getCCsForPkg(pkg,pkgrules){return pkgrules[pkg]||[];}
function getAllCCs(tags,pkg,owner,tagrules,pkgrules){
  const all=[...getCCsForTags(tags,tagrules),...getCCsForPkg(pkg,pkgrules)];
  const currentUserName=window._currentUser?window._currentUser.name:null;
  const prefs=window._ppUserPrefs||{};
  return[...new Set(all)].filter(function(p){
    if(p===owner)return false;

    var pref=(prefs[p]||{});
    if(pref.noPkgCC)return false;
    return true;
  });
}

// Tender step statuses
const SEED_PEOPLE=["BALLAS, Antonios","CHATZIROUMPIS, Vasilis","FYTOPOULOU, Katerina","KLEFTOSPYROU, Georgia","KOUTOULAKI, Anna","MAKROVASILI, Anastasia","NASIS, Athanasios","PLOUMISTOS, Georgios","ROSIOS, Irodion","ROUSSIN, Yanis","TSIAMPAOS, Konstantinos","VRETTOU, Eirini"];
const SEED_TAGS=["Blocking Point","Prerequisite","Warning","Contract","Design","FCR","HR","Letter","Procurement","Production","Quality External","Quality Podium","Quality Tower","RFI","Top Management"];
const SEED_PACKAGES=["Facade","Structure","MEP","Civil","Podium","External Works"];

const STATUS_OPTS=["pending","in progress","done","blocked"];
const STATUS_ICONS={pending:"⏳","in progress":"🔄",done:"✅",blocked:"🚫"};

function stampModified(task){var u=Object.assign({},task);u.lastModifiedBy=window._currentUser?window._currentUser.name:"";u.lastModifiedAt=today();return u;}
function newTask(overrides){var base={id:uuid(),text:"",owner:"",package:"",zone:"",blockedRooms:[],scheduleRowRef:"",materialDocRef:"",status:"pending",importance:1,urgence:1,due:"",note:"",tags:[],tenderRef:"",contractorRef:"",trackerRef:"",createdAt:today(),rfiSubmission:"",rfiDue:"",rfiOverdue:false,addedBy:window._currentUser?window._currentUser.name:"",lastModifiedBy:"",lastModifiedAt:"",links:[]};return Object.assign(base,overrides||{});}
function newTracker(overrides){return Object.assign({id:uuid(),title:"",description:"",createdAt:today(),actions:[]},overrides||{});}
function newTrackerAction(){return{id:uuid(),text:"",owner:"",package:"",status:"pending",importance:1,urgence:1,due:"",tags:[],tenderRef:"",contractorRef:"",details:"",createdAt:today()};}
function newTender(overrides){return Object.assign({id:uuid(),title:"",package:"",ownerPackage:"",ownerTender:"",createdAt:today(),targetDate:"",steps:{bidders:"",pkg:"",process:"",acc:"",contract:"",mar:"",itp:"",wms:""},stepDates:{bidders:{target:"",done:""},pkg:{target:"",done:""},process:{target:"",done:""},acc:{target:"",done:"",approval:""},contract:{target:"",done:""},mar:{target:"",done:"",approval:""},itp:{target:"",done:"",approval:""},wms:{target:"",done:"",approval:""}},stepComments:{bidders:"",pkg:"",process:"",acc:"",contract:"",mar:"",itp:"",wms:""},stepLinks:{bidders:[],pkg:[],process:[],acc:[],contract:[],mar:[],itp:[],wms:[]},description:"",budget:"",instructionAmount:"",currency:"EUR",nextStep:""},overrides||{});}
function newContractor(overrides){return Object.assign({id:uuid(),name:"",package:"",owner:"",tenderRefs:[],contracts:[],createdAt:today()},overrides||{});}
function newContract(){return{id:uuid(),number:"",sapNumber:"",instructionNumber:"",instructionAmount:0,startDate:"",endDate:"",amount:0,currency:"EUR",package:"",tenderRef:"",owner:"",closed:false,cacSigned:false,addendums:[],certifications:[],description:"",accSigned:false,accDate:"",accStatus:"",aconexSigned:false,aconexDate:"",aconexStatus:"",wbs:""};}
function newAddendum(){return{id:uuid(),number:"",instructionNumber:"",instructionAmount:0,date:"",amount:0,description:"",comment:"",accSigned:false,accDate:"",accStatus:"",aconexSigned:false,aconexDate:"",aconexStatus:""};}
function newCertification(){return{id:uuid(),number:"",date:"",amount:0,description:"",comment:""};}

function _parseFirebaseVal(val){
  if(val===null||val===undefined)return null;
  if(typeof val==="string"){try{return JSON.parse(val);}catch(e){return null;}}
  return val;
}
const cloudStore={
  get:async(key)=>{if(!window._db)return null;return _parseFirebaseVal(await window._db.get(key));},
  set:async(key,val)=>{if(!window._db)return;await window._db.set(key,typeof val==="string"?val:JSON.stringify(val));}
};

function GlobalPdfModal({contractors,saveContractors,onClose}){
  const [cert,setCert]=useState({number:"",date:"",amount:"",sap:""});
  const [matched,setMatched]=useState(null);
  const [error,setError]=useState("");

  function set(f,v){
    var u=Object.assign({},cert);u[f]=v;setCert(u);

    if(f==="sap"){
      var found=null;
      (contractors||[]).forEach(function(ctr){
        (ctr.contracts||[]).forEach(function(ct){
          if((ct.sapNumber||"").trim()===v.trim()){found={ctr:ctr,ct:ct};}
        });
      });
      setMatched(found);
    }
  }

  function confirm(){
    if(!matched){setError("No contract matched this SAP number. Check the SAP # in the Subcontractors tab.");return;}
    var cf=newCertification();
    cf.number=cert.number;
    cf.date=cert.date?cert.date+"-01":"";
    cf.amount=Number(cert.amount)||0;
    var d=(contractors||[]).map(function(ctr){
      if(ctr.id!==matched.ctr.id)return ctr;
      return Object.assign({},ctr,{contracts:(ctr.contracts||[]).map(function(ct){
        if(ct.id!==matched.ct.id)return ct;
        return Object.assign({},ct,{certifications:[...(ct.certifications||[]),cf]});
      })});
    });
    saveContractors(d);
    onClose();
  }

  return <div className="overlay"><div className="modal" style={{maxWidth:460}}>
    <div className="modal-hdr">
      <div className="modal-title">📄 Add Certification</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
    </div>
    <div className="modal-body">
      {error&&<div style={{padding:"8px 12px",background:"#fce4ec",borderRadius:8,color:"#c62828",fontSize:12,marginBottom:12}}>{error}</div>}
      <div className="fg">
        <label>SAP Contract # <span style={{color:"#888",fontWeight:400,textTransform:"none"}}>(auto-matches subcontractor)</span></label>
        <input type="text" value={cert.sap} onChange={function(e){set("sap",e.target.value);}} placeholder="e.g. 9001032541" autoFocus/>
        {matched&&<div style={{marginTop:5,padding:"5px 8px",background:"#e8f5e9",borderRadius:6,fontSize:11,color:"#2e7d32",fontWeight:600}}>
          ✅ {matched.ctr.name} · {matched.ct.number||"(no contract number)"}
        </div>}
        {cert.sap&&!matched&&<div style={{marginTop:5,fontSize:11,color:"#f57f17"}}>⚠️ No contract found for this SAP number</div>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <div className="fg" style={{flex:1}}>
          <label>Valuation #</label>
          <input type="text" value={cert.number} onChange={function(e){set("number",e.target.value);}} placeholder="003"/>
        </div>
        <div className="fg" style={{flex:1}}>
          <label>Period (MM/YY)</label>
          <input type="month" value={cert.date||""} onChange={function(e){set("date",e.target.value);}}/>
        </div>
      </div>
      <div className="fg">
        <label>Amount incl. tax (this period)</label>
        <input type="number" value={cert.amount} onChange={function(e){set("amount",e.target.value);}} placeholder="34249.84"/>
      </div>
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!matched||!cert.amount} onClick={confirm}>✓ Add Certification</button>
    </div>
  </div></div>;
}

function ImprovementBox({improvements,saveImprovements,currentPage}){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState("");
  const ref=useRef();

  function submit(){
    if(!text.trim())return;
    var entry={id:uuid(),text:text.trim(),page:currentPage,date:today(),ts:Date.now()};
    saveImprovements([entry,...improvements]);
    setText("");setOpen(false);
  }

  return <div className="imp-btn-wrap" style={{position:"fixed",bottom:16,right:276,zIndex:500}}>
    {open&&<div style={{position:"absolute",bottom:44,right:0,width:280,background:"#fff",borderRadius:12,boxShadow:"0 8px 30px rgba(0,0,0,.18)",border:"1.5px solid #e8e6df",padding:14}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>💡 Improvement idea</div>
      <div style={{fontSize:11,color:"#aaa",marginBottom:6}}>Page: <strong>{currentPage}</strong></div>
      <textarea ref={ref} autoFocus value={text} onChange={function(e){setText(e.target.value);}}
        onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}}
        placeholder="Describe the improvement..." style={{width:"100%",minHeight:80,padding:"6px 8px",fontSize:12,border:"1.5px solid #e8e6df",borderRadius:7,fontFamily:"inherit",resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
      <div style={{display:"flex",gap:6,marginTop:8}}>
        <button className="btn" style={{flex:1}} onClick={function(){setOpen(false);setText("");}}>Cancel</button>
        <button className="btn btn-gold" style={{flex:1}} onClick={submit}>✓ Add</button>
      </div>
    </div>}
    <button onClick={function(){setOpen(!open);}} title="Suggest an improvement"
      style={{width:36,height:36,borderRadius:"50%",background:"#c9a84c",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",color:"#1c1c1e",transition:"all .15s"}}>
      💡
    </button>
  </div>;
}

function QuickAdd({people,packages,tenders,contractors,trackers,tags,zones,tasks,onAdd,improvements,saveImprovements,currentPage}){
  const [text,setText]=useState("");
  const [due,setDue]=useState(today());
  const [owner,setOwner]=useState("");
  const [pkg,setPkg]=useState("");
  const [zone,setZone]=useState("");
  const [tenderRef,setTenderRef]=useState("");
  const [contractorRef,setContractorRef]=useState("");
  const [importance,setImportance]=useState(1);
  const [urgence,setUrgence]=useState(1);
  const [selTags,setSelTags]=useState([]);
  const [isInfo,setIsInfo]=useState(false);
  const [rfiSub,setRfiSub]=useState("");
  const [rfiDue,setRfiDue]=useState("");
  const inputRef=useRef();

  function submit(){
    if(!text.trim())return;
    var td={text:text.trim(),owner,package:pkg,zone,due,tenderRef,contractorRef,importance,urgence,tags:selTags};
    if(isInfo)td.isInfo=true;
    if(selTags.includes("RFI")||selTags.includes("FCR")){td.rfiSubmission=rfiSub;td.rfiDue=rfiDue;}
    onAdd(newTask(td));
    setText("");setDue(today());setOwner("");setPkg("");setZone("");setTenderRef("");setContractorRef("");setImportance(1);setUrgence(1);setSelTags([]);setIsInfo(false);
    if(inputRef.current)inputRef.current.focus();
  }
  function toggleTag(t){setSelTags(function(prev){return prev.includes(t)?prev.filter(function(x){return x!==t;}):[...prev,t];});}
  function onTenderChange(tid){
    setTenderRef(tid);
    if(tid){var td2=(tenders||[]).find(function(t){return t.id===tid;});if(td2&&td2.package)setPkg(td2.package);}
  }

  var sc=calcScore(importance,urgence);
  var ss=scoreStyle(sc);

  var filteredTenders=(tenders||[]).filter(function(t){return !pkg||t.package===pkg;})
    .slice().sort(function(a,b){return (a.title||"").localeCompare(b.title||"");});
  var filteredContractors=(contractors||[]).filter(function(ctr){return !pkg||ctr.package===pkg||(ctr.contracts||[]).some(function(ct){return ct.package===pkg;});})
    .slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");});

  var possibleDupes=[];
  if(text.trim().length>6){
    possibleDupes=(tasks||[]).filter(function(t){
      if(t.status==="done"||t.isInfo)return false;
      if(pkg&&t.package===pkg)return true;
      if(zone&&t.zone===zone)return true;
      return false;
    }).map(function(t){return{t:t,sim:textSimilarity(text,t.text)};})
      .filter(function(x){return x.sim>=0.45;})
      .sort(function(a,b){return b.sim-a.sim;})
      .slice(0,3);
  }

  return <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
    <div style={{padding:"14px 14px 10px",borderBottom:"1.5px solid #e8e6df"}}>
      <div style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:15,marginBottom:2}}>Quick Add</div>
      <div style={{fontSize:11,color:"#bbb"}}>Enter to add · {today().split("-").reverse().join("/")}</div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:12}} className="sform">

      <div className="fg">
        <label>Date</label>
        <input type="date" min="1990-01-01" max="2200-12-31" value={due} onChange={function(e){setDue(e.target.value);}}/>
      </div>

      <div className="fg">
        <label>Action *</label>
        <textarea ref={inputRef} value={text} onChange={function(e){setText(e.target.value);}}
          onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}}
          placeholder="What needs to be done?" style={{minHeight:60}}/>
      </div>

      {possibleDupes.length>0&&<div style={{marginBottom:10,padding:"8px 10px",background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:8}}>
        <div style={{fontSize:11,fontWeight:700,color:"#b45309",marginBottom:4}}>⚠️ Similar action{possibleDupes.length!==1?"s":""} already open — check before adding a duplicate:</div>
        {possibleDupes.map(function(x){return <div key={x.t.id} style={{fontSize:11,color:"#555",padding:"3px 0",borderTop:"1px solid #fed7aa"}}>
          <strong>{x.t.text}</strong>{x.t.owner&&" — "+x.t.owner.split(",")[0]}{x.t.package&&" ("+x.t.package+")"}{x.t.zone&&" ["+x.t.zone+"]"}
        </div>;})}
      </div>}

      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,fontWeight:600,marginBottom:8,color:isInfo?"#1565c0":"#888",background:isInfo?"#e3f2fd":"transparent",padding:"3px 8px",borderRadius:8,border:"1.5px solid "+(isInfo?"#1565c0":"#ddd"),alignSelf:"flex-start"}}>
        <input type="checkbox" checked={isInfo} onChange={function(e){setIsInfo(e.target.checked);setImportance(1);setUrgence(1);}} style={{width:13,height:13}}/>
        ℹ️ Info only
      </label>

      <div className="fg">
        <label>Owner</label>
        <select value={owner} onChange={function(e){setOwner(e.target.value);}} style={{fontFamily:"inherit"}}>
          <option value="">— none —</option>
          {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
        </select>
      </div>

      <div className="fg">
        <label>Tender</label>
        <select value={tenderRef} onChange={function(e){onTenderChange(e.target.value);}} style={{fontFamily:"inherit"}}>
          <option value="">— none —</option>
          {filteredTenders.map(function(t){return <option key={t.id} value={t.id}>{t.title}{t.package?" ("+t.package+")":""}</option>;})}
        </select>
      </div>

      <div className="fg">
        <label>Package</label>
        <select value={pkg} onChange={function(e){setPkg(e.target.value);if(tenderRef){var td2=(tenders||[]).find(function(t){return t.id===tenderRef;});if(td2&&td2.package!==e.target.value)setTenderRef("");}}} style={{fontFamily:"inherit"}}>
          <option value="">— none —</option>
          {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
        </select>
      </div>

      <div className="fg">
        <label>Zone</label>
        <select value={zone} onChange={function(e){setZone(e.target.value);}} style={{fontFamily:"inherit",color:zone?"#7b1fa2":"inherit",fontWeight:zone?700:400}}>
          <option value="">— none —</option>
          {(zones||[]).map(function(z){return <option key={z} value={z}>{z}</option>;})}
        </select>
      </div>

      {!isInfo&&<div className="fg">
        <label>Score I×U {sc>1&&<span style={{padding:"1px 7px",borderRadius:10,background:ss.bg,color:ss.color,fontWeight:700,fontSize:10}}>{ss.label} [{sc}]</span>}</label>
        <div style={{display:"flex",gap:12,alignItems:"center",marginTop:2}}>
          <div>
            <div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:3}}>IMPACT</div>
            <div style={{display:"flex",gap:3}}>
              {[1,2,3].map(function(v){return <button key={v} onClick={function(){setImportance(v);}} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(importance===v?"#1c1c1e":"#ddd"),background:importance===v?"#1c1c1e":"#fff",color:importance===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}
            </div>
          </div>
          <span style={{color:"#ccc",fontSize:16}}>×</span>
          <div>
            <div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:3}}>URGENCY</div>
            <div style={{display:"flex",gap:3}}>
              {[1,2,3].map(function(v){return <button key={v} onClick={function(){setUrgence(v);}} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(urgence===v?"#1c1c1e":"#ddd"),background:urgence===v?"#1c1c1e":"#fff",color:urgence===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}
            </div>
          </div>
        </div>
      </div>}

      {(tags||[]).length>0&&<div className="fg">
        <label>Tags</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:2}}>
          {(tags||[]).map(function(t){var on=selTags.includes(t);var tc=tagColor(t);return <button key={t} onClick={function(){toggleTag(t);}} style={{padding:"2px 9px",borderRadius:20,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{t}</button>;})}
        </div>
      </div>}
      {(selTags.includes("RFI")||selTags.includes("FCR"))&&<div className="fg">
        <label style={{color:"#b45309"}}>📋 {selTags.includes("FCR")?"FCR":"RFI"} Dates</label>
        <div style={{display:"flex",gap:6,padding:"8px",background:"#fff8f0",borderRadius:8,border:"1px solid #fed7aa"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:9,fontWeight:800,color:"#b45309",marginBottom:2}}>SUBMISSION</div>
            <input type="date" min="1990-01-01" max="2200-12-31" value={rfiSub||""} onChange={function(e){setRfiSub(e.target.value);if(e.target.value){var d=new Date(e.target.value);d.setDate(d.getDate()+getDur("clientResponse"));setRfiDue(toISO(d));}}} style={{padding:"3px 6px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:9,fontWeight:800,color:"#b45309",marginBottom:2}}>DUE (+14d)</div>
            <input type="date" min="1990-01-01" max="2200-12-31" value={rfiDue||""} onChange={function(e){setRfiDue(e.target.value);}} style={{padding:"3px 6px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5}}/>
          </div>
        </div>
      </div>}

      <div className="fg">
        <label>Subcontractor</label>
        <select value={contractorRef} onChange={function(e){setContractorRef(e.target.value);}} style={{fontFamily:"inherit"}}>
          <option value="">— none —</option>
          {filteredContractors.map(function(ctr){return <option key={ctr.id} value={ctr.id}>{ctr.name}</option>;})}
        </select>
      </div>

      <div style={{display:"flex",gap:6,marginTop:4}}>
        <button className="btn" onClick={function(){setText("");setDue(today());setOwner("");setPkg("");setTenderRef("");setContractorRef("");setImportance(1);setUrgence(1);setSelTags([]);setIsInfo(false);setRfiSub("");setRfiDue("");}} style={{flex:"0 0 auto"}}>✕ Cancel</button>
        <button className="btn btn-gold" style={{flex:1,justifyContent:"center"}} onClick={submit}>＋ Add {isInfo?"Info":"Task"}</button>
      </div>
    </div>
  </div>;
}

function ActionItem({task,onStatusChange,onUpdate,onDelete,people,packages,tags,tenders,contractors,showCreated,onNavTender,zones,onOpenRooms}){
  const [editMode,setEditMode]=useState(false);
  const [localTags,setLocalTags]=useState(task.tags||[]);
  const [localRfiSub,setLocalRfiSub]=useState(task.rfiSubmission||"");
  const [localRfiDue,setLocalRfiDue]=useState(task.rfiDue||"");
  const [localZone,setLocalZone]=useState(task.zone||"");
  useEffect(function(){setLocalZone(task.zone||"");},[task.id,task.zone]);
  const sc=calcScore(task.importance||1,task.urgence||1);

  useEffect(function(){setLocalTags(task.tags||[]);},[task.tags]);
  useEffect(function(){setLocalRfiSub(task.rfiSubmission||"");setLocalRfiDue(task.rfiDue||"");},[task.id]);
  const ss=scoreStyle(sc);
  const tdr=task.tenderRef?(tenders||[]).find(function(t){return t.id===task.tenderRef;}):null;
  const ctr=task.contractorRef?(contractors||[]).find(function(c){return c.id===task.contractorRef;}):null;

  function upd(field,val){if(onUpdate)onUpdate(field,val,true);}

  return <div className="ac-item" style={{background:editMode?"#f8f9ff":task.status==="done"?"#fafaf8":"#fff",borderColor:editMode?"#3949ab":"#e8e6df",flexDirection:"column",gap:0}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:8,width:"100%"}}>
      <div className={"ac-check"+(task.status==="done"?" done":"")} style={{flexShrink:0,marginTop:3,cursor:"pointer"}}
        onClick={function(){if(onStatusChange)onStatusChange(task.status==="done"?"pending":"done");}}>
        {task.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        {editMode
          ?<div style={{display:"flex",flexDirection:"column",gap:6}}>
            <textarea value={task.text||""} autoFocus onChange={function(e){upd("text",e.target.value);}} style={{width:"100%",padding:"5px 8px",border:"1.5px solid #3949ab",borderRadius:6,fontFamily:"inherit",fontSize:13,resize:"vertical",outline:"none",minHeight:44,boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:6}}>
              <select value={task.status||"pending"} onChange={function(e){upd("status",e.target.value);}} style={{flex:1,padding:"4px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5,border:"1px solid #ddd"}}>
                {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
              </select>
              <input type="date" min="1990-01-01" max="2200-12-31" value={task.due||""} onChange={function(e){upd("due",e.target.value);}} style={{flex:1,padding:"4px 6px",fontSize:11,borderRadius:5,border:"1px solid #ddd"}}/>
            </div>
            <div style={{display:"flex",gap:6}}>
              <select value={task.owner||""} onChange={function(e){upd("owner",e.target.value);}} style={{flex:1,padding:"4px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5,border:"1px solid #ddd"}}>
                <option value="">No owner</option>
                {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
              </select>
              <select value={task.package||""} onChange={function(e){upd("package",e.target.value);}} style={{flex:1,padding:"4px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5,border:"1px solid #ddd"}}>
                <option value="">No package</option>
                {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
              </select>
            </div>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,fontWeight:600,color:task.isInfo?"#1565c0":"#888",background:task.isInfo?"#e3f2fd":"transparent",padding:"5px 8px",borderRadius:8,border:"1.5px solid "+(task.isInfo?"#1565c0":"#ddd"),alignSelf:"flex-start"}}>
              <input type="checkbox" checked={!!task.isInfo} onChange={function(e){upd("isInfo",e.target.checked);}} style={{width:13,height:13,cursor:"pointer"}}/>
              ℹ️ Info only (no action needed)
            </label>
            {!task.isInfo&&<div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:10,color:"#aaa"}}>I</span>
              {[1,2,3].map(function(v){return <button key={v} onClick={function(){upd("importance",v);}} style={{width:22,height:22,borderRadius:4,border:"1.5px solid "+((task.importance||1)===v?"#1c1c1e":"#ddd"),background:(task.importance||1)===v?"#1c1c1e":"#fff",color:(task.importance||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:10,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}
              <span style={{fontSize:10,color:"#aaa",marginLeft:4}}>U</span>
              {[1,2,3].map(function(v){return <button key={v} onClick={function(){upd("urgence",v);}} style={{width:22,height:22,borderRadius:4,border:"1.5px solid "+((task.urgence||1)===v?"#1c1c1e":"#ddd"),background:(task.urgence||1)===v?"#1c1c1e":"#fff",color:(task.urgence||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:10,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}
            </div>}
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {(tags||[]).map(function(tg){var on=(task.tags||[]).includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){var cur=task.tags||[];var newTags=on?cur.filter(function(x){return x!==tg;}):[...cur,tg];setLocalTags(newTags);upd("tags",newTags);}} style={{padding:"5px 7px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
            </div>
            <textarea value={task.note||""} onChange={function(e){upd("note",e.target.value);}} placeholder="Notes..." style={{minHeight:32,fontSize:11,padding:"4px 8px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit",resize:"vertical"}}/>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"#aaa",marginBottom:4,textTransform:"uppercase",letterSpacing:".4px"}}>🔗 Links</div>
              {(task.links||[]).map(function(lk,li){return <div key={li} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
                <input type="text" value={lk.label||""} onChange={function(e){var ls=(task.links||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{label:e.target.value});});upd("links",ls);}} placeholder="Label" style={{width:100,padding:"5px 6px",fontSize:11,border:"1px solid #e0ddd8",borderRadius:5}}/>
                <input type="url" value={lk.url||""} onChange={function(e){var ls=(task.links||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{url:e.target.value});});upd("links",ls);}} placeholder="https://..." style={{flex:1,padding:"5px 6px",fontSize:11,border:"1px solid #e0ddd8",borderRadius:5}}/>
                <button onClick={function(){var ls=(task.links||[]).filter(function(_,j){return j!==li;});upd("links",ls);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:13,flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>✕</button>
              </div>;})}
              <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#666",marginLeft:8}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#2e7d32",display:"inline-block"}}/>
        Released (in totals)
      </div>
      <button className="btn btn-sm" onClick={function(){upd("links",[...(task.links||[]),{label:"",url:""}]);}} style={{fontSize:10,padding:"5px 8px"}}>＋ Add link</button>
            </div>
            {(localTags.includes("RFI")||localTags.includes("FCR"))&&<div style={{display:"flex",gap:8,padding:"8px",background:"#fff8f0",borderRadius:7,border:"1px solid #fed7aa"}}>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>RFI Submission date</label>
                <input type="date" min="1990-01-01" max="2200-12-31" value={localRfiSub} onChange={function(e){
                  setLocalRfiSub(e.target.value);
                  upd("rfiSubmission",e.target.value);
                  if(e.target.value){var d=new Date(e.target.value);d.setDate(d.getDate()+getDur("clientResponse"));var dd=toISO(d);setLocalRfiDue(dd);upd("rfiDue",dd);}
                }} style={{padding:"5px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>RFI Due date (+14 days)</label>
                <input type="date" min="1990-01-01" max="2200-12-31" value={localRfiDue} onChange={function(e){setLocalRfiDue(e.target.value);upd("rfiDue",e.target.value);}} style={{padding:"5px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
              </div>
            </div>}
            {localTags.includes("Blocking Point")&&<div style={{padding:"8px",background:"#fff5f7",borderRadius:7,border:"1px solid #f48fb1"}}>
              <div style={{fontSize:11,fontWeight:800,color:"#c62828",textTransform:"uppercase",letterSpacing:".4px",marginBottom:5}}>🚧 Blocking point — which rooms are affected?</div>
              <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:130}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",display:"block",marginBottom:2}}>Zone</label>
                  <select value={localZone} onChange={function(e){var z=e.target.value;setLocalZone(z);if(onUpdate)onUpdate({zone:z,blockedRooms:[]},null,true);}} style={{padding:"5px 7px",fontSize:11,border:"1px solid #f48fb1",borderRadius:5,width:"100%"}}>
                    <option value="">— pick a zone —</option>
                    {(zones||[]).map(function(z){return <option key={z} value={z}>{z}</option>;})}
                  </select>
                </div>
                {localZone&&<button className="btn btn-sm" onClick={function(){if(onOpenRooms)onOpenRooms(Object.assign({},task,{zone:localZone}));}}
                  style={{background:"#fce4ec",color:"#c62828",border:"1px solid #f48fb1"}}>
                  🚪 {task.blockedRooms==="all"?"All rooms":((task.blockedRooms||[]).length||0)+" room"+(((task.blockedRooms||[]).length||0)!==1?"s":"")}
                </button>}
              </div>
              {!localZone&&<div style={{fontSize:10,color:"#888",marginTop:4}}>Pick a zone first — the action will then show up in that zone's report and turn the selected rooms red.</div>}
            </div>}
            <button className="btn btn-sm btn-pri" onClick={function(){setEditMode(false);}} style={{alignSelf:"flex-start"}}>✓ Done editing</button>
          </div>
          :<div onClick={function(){setEditMode(true);}} style={{cursor:"pointer"}}>
            <div className={"ac-text"+(task.status==="done"?" done":"")} style={{fontWeight:500}}>
              {task.isInfo&&<span style={{display:"inline-flex",alignItems:"center",gap:2,padding:"5px 6px",borderRadius:8,background:"#e3f2fd",color:"#1565c0",fontSize:10,fontWeight:700,marginRight:5}}>ℹ️ INFO</span>}
              {task.text||<span style={{color:"#ccc",fontStyle:"italic"}}>No text</span>}
            </div>
            {task.note&&<div style={{fontSize:11,color:"#888",fontStyle:"italic",marginTop:2}}>{task.note}</div>}
            <div className="ac-meta" style={{marginTop:4,display:"flex",flexWrap:"wrap",alignItems:"center",gap:4}}>
              {task.due&&<span style={{fontSize:11,color:task.due<today()&&task.status!=="done"?"#c62828":"#bbb"}}>📅 {fmtDate(task.due)}</span>}
              {task.owner&&<OwnerChip owner={task.owner}/>}
              {task.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{task.package}</span>}
              {!task.isInfo&&sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label}</span>}
              {(task.tags||[]).map(function(tg){return <TagChip key={tg} tag={tg}/>;} )}
              {tdr&&(onNavTender?<button onClick={function(e){e.stopPropagation();onNavTender(tdr.id,"global");}} style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10,padding:"5px 8px",borderRadius:20,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>📑 {tdr.title}</button>:<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {tdr.title}</span>)}
              {ctr&&<span className="badge" style={{background:"#e8f0fe",color:"#1a73e8",border:"1px solid #c5d8fc",fontSize:10}}>🤝 {ctr.name}</span>}
            </div>
            {((task.tags||[]).includes("RFI")||(task.tags||[]).includes("FCR"))&&<div style={{fontSize:10,color:"#b45309",marginTop:3,background:"#fff8f0",padding:"5px 8px",borderRadius:5,display:"inline-block"}}>
              📋 {(task.tags||[]).includes("FCR")?"FCR":"RFI"} {task.rfiSubmission?"submitted: "+fmtDate(task.rfiSubmission):"⚠️ No submission date"} {task.rfiDue&&"· due: "+fmtDate(task.rfiDue)}
            </div>}
            {(task.links||[]).length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:3}}>
              {(task.links||[]).map(function(lk,li){return lk.url?<a key={li} href={lk.url} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:"#3949ab",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:2,padding:"5px 6px",borderRadius:6,background:"#f0f0ff",border:"1px solid #d0d0f0"}} onMouseEnter={function(e){e.currentTarget.style.textDecoration="underline";}} onMouseLeave={function(e){e.currentTarget.style.textDecoration="none";}}>🔗 {lk.label||lk.url}</a>:null;})}
            </div>}
            {(showCreated!==false)&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:3,alignItems:"center"}}>
              {task.addedBy&&<span style={{fontSize:11,color:"#bbb",display:"inline-flex",alignItems:"center",gap:2}}>
                <span style={{color:"#ddd"}}>✚</span>{task.addedBy.split(",")[0]}
                {task.createdAt&&<span style={{color:"#ddd"}}>{fmtDate(task.createdAt)}</span>}
              </span>}
              {task.lastModifiedBy&&task.lastModifiedAt&&<span style={{fontSize:11,color:"#bbb",display:"inline-flex",alignItems:"center",gap:2}}>
                <span style={{color:"#ddd"}}>✎</span>{task.lastModifiedBy.split(",")[0]}
                <span style={{color:"#ddd"}}>{fmtDate(task.lastModifiedAt)}</span>
              </span>}
            </div>}
          </div>}
      </div>
      {!editMode&&<div style={{display:"flex",gap:4,flexShrink:0}}>
        <select className="btn btn-sm" value={task.status||"pending"} onChange={function(e){if(onStatusChange)onStatusChange(e.target.value);}} style={{width:"auto",padding:"5px 6px",fontSize:10,border:"1px solid #ddd"}}>
          {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
        </select>
        <button className="btn btn-sm" onClick={function(){setEditMode(true);}} style={{padding:"5px 7px"}}>✏️</button>
        {onDelete&&<button className="btn btn-sm btn-danger" onClick={function(){onDelete();}} style={{padding:"5px 7px"}}>🗑</button>}
      </div>}
    </div>
  </div>;
}

function StatusChip({status}){
  const cls={"pending":"s-default","in progress":"s-pending","done":"s-approved-a","blocked":"s-notdone"}[status]||"s-default";
  return <span className={"chip "+cls}>{STATUS_ICONS[status]} {status}</span>;
}

function OwnerChip({owner}){
  if(!owner)return null;
  const c=ownerColor(owner);
  return <span className="pill" style={{background:c.bg,color:c.accent,fontSize:11,fontWeight:700}}>{owner.split(",")[0]}</span>;
}

function TagChip({tag}){
  if(tag==="Blocking Point")return <span className="tag" style={{background:"#c62828",color:"#fff",fontWeight:800}}>🔴 {tag}</span>;
  const c=tagColor(tag);
  return <span className="tag" style={{background:c.bg,color:c.color}}>{tag}</span>;
}

// ── QuickAddTask: inline contextual task creation ─────────────────
function QuickAddTask({prefill,onAdd,people,tags,label}){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState("");
  const [due,setDue]=useState("");
  const [owner,setOwner]=useState(prefill.owner||"");
  const [selTags,setSelTags]=useState(prefill.tags||[]);
  const [importance,setImportance]=useState(1);
  const [urgence,setUrgence]=useState(1);
  const [isInfo,setIsInfo]=useState(false);
  const [rfiSub,setRfiSub]=useState("");
  const [rfiDue,setRfiDue]=useState("");
  const inputRef=useRef();

  useEffect(function(){
    setOwner(prefill.owner||"");
    setSelTags(prefill.tags||[]);
  },[prefill.owner,prefill.tenderRef,prefill.contractorRef]);

  function reset(){setText("");setDue("");setOwner(prefill.owner||"");setSelTags(prefill.tags||[]);setImportance(1);setUrgence(1);setIsInfo(false);setRfiSub("");setRfiDue("");setOpen(false);}
  function submit(){
    if(!text.trim())return;
    var td=Object.assign({},prefill,{text:text.trim(),due:due,owner:owner,tags:selTags,importance:importance,urgence:urgence});
    if(isInfo)td.isInfo=true;
    onAdd(newTask(td));
    reset();
  }
  function toggleTag(tg){setSelTags(function(prev){return prev.includes(tg)?prev.filter(function(x){return x!==tg;}):[...prev,tg];});}

  var sc=calcScore(importance,urgence);
  var ss=scoreStyle(sc);

  if(!open)return <button className="btn btn-sm" onClick={function(){setOpen(true);setTimeout(function(){if(inputRef.current)inputRef.current.focus();},50);}} style={{marginTop:8}}>＋ {label||"Add Task"}</button>;

  return <div style={{marginTop:8,padding:"12px",background:"#f8f9ff",borderRadius:10,border:"1.5px solid #3949ab"}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
      <div style={{fontWeight:700,fontSize:12,color:"#3949ab",flex:1}}>＋ {label||"Add Task"}
        {prefill.package&&<span style={{marginLeft:6,padding:"1px 6px",borderRadius:10,background:"#f0ede6",color:"#555",fontSize:10,fontWeight:600}}>{prefill.package}</span>}
        {prefill.tenderRef&&<span style={{marginLeft:3,fontSize:12}}>📑</span>}
        {prefill.contractorRef&&<span style={{marginLeft:3,fontSize:12}}>🤝</span>}
      </div>
      <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:11,fontWeight:600,textTransform:"none",letterSpacing:"normal",color:isInfo?"#1565c0":"#888",background:isInfo?"#e3f2fd":"transparent",padding:"2px 8px",borderRadius:10,border:"1.5px solid "+(isInfo?"#1565c0":"#ddd")}}>
        <input type="checkbox" checked={isInfo} onChange={function(e){setIsInfo(e.target.checked);setImportance(1);setUrgence(1);}} style={{width:12,height:12,cursor:"pointer"}}/>
        ℹ️ Info only
      </label>
    </div>
    <textarea ref={inputRef} value={text} onChange={function(e){setText(e.target.value);}}
      onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}}
      placeholder={isInfo?"Information to record...":"What needs to be done? (Enter to add)"} style={{width:"100%",padding:"6px 8px",border:"1.5px solid #ddd",borderRadius:6,fontFamily:"inherit",fontSize:12,resize:"vertical",outline:"none",minHeight:44,boxSizing:"border-box"}}/>
    <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap",alignItems:"center"}}>
      <input type="date" min="1990-01-01" max="2200-12-31" value={due} onChange={function(e){setDue(e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #ddd",borderRadius:5}}/>
      <select value={owner} onChange={function(e){setOwner(e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #ddd",borderRadius:5,fontFamily:"inherit"}}>
        <option value="">No owner</option>
        {(people||window._ppPeople||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
    </div>
    {!isInfo&&<div style={{display:"flex",gap:10,marginTop:8,alignItems:"center"}}>
      <div>
        <div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:3}}>IMPACT</div>
        <div style={{display:"flex",gap:3}}>
          {[1,2,3].map(function(v){return <button key={v} onClick={function(){setImportance(v);}} style={{width:24,height:24,borderRadius:5,border:"1.5px solid "+(importance===v?"#1c1c1e":"#ddd"),background:importance===v?"#1c1c1e":"#fff",color:importance===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}
        </div>
      </div>
      <span style={{color:"#ccc",fontSize:14}}>×</span>
      <div>
        <div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:3}}>URGENCY</div>
        <div style={{display:"flex",gap:3}}>
          {[1,2,3].map(function(v){return <button key={v} onClick={function(){setUrgence(v);}} style={{width:24,height:24,borderRadius:5,border:"1.5px solid "+(urgence===v?"#1c1c1e":"#ddd"),background:urgence===v?"#1c1c1e":"#fff",color:urgence===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}
        </div>
      </div>
      {sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label} [{sc}]</span>}
    </div>}
    {(tags||window._ppTags||[]).length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
      {(tags||window._ppTags||[]).map(function(tg){var on=selTags.includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){toggleTag(tg);}} style={{padding:"2px 7px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
    </div>}
    {(selTags.includes("RFI")||selTags.includes("FCR"))&&<div style={{display:"flex",gap:8,padding:"8px 10px",background:"#fff8f0",borderRadius:8,border:"1px solid #fed7aa",marginTop:8}}>
      <div style={{flex:1}}>
        <label style={{fontSize:9,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:3}}>RFI Submission date</label>
        <input type="date" min="1990-01-01" max="2200-12-31" value={rfiSub} onChange={function(e){setRfiSub(e.target.value);if(e.target.value){var d=new Date(e.target.value);d.setDate(d.getDate()+getDur("clientResponse"));setRfiDue(toISO(d));}}} style={{padding:"4px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
      </div>
      <div style={{flex:1}}>
        <label style={{fontSize:9,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:3}}>Due date (+14 days)</label>
        <input type="date" min="1990-01-01" max="2200-12-31" value={rfiDue} onChange={function(e){setRfiDue(e.target.value);}} style={{padding:"4px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
      </div>
    </div>}
    <div style={{display:"flex",gap:6,marginTop:10}}>
      <button className="btn" onClick={reset} style={{padding:"4px 10px",fontSize:11}}>Cancel</button>
      <button className="btn btn-pri" onClick={submit} disabled={!text.trim()} style={{padding:"4px 10px",fontSize:11}}>＋ Add</button>
    </div>
  </div>;
}

function ActionsView({tasks,setTasks,people,packages,tags,tenders,contractors,trackers,saveT,tagrules,pkgrules}){
  const [filterPkg,setFilterPkg]=useState("all");
  const [filterStatus,setFilterStatus]=useState("all");
  const [filterOwner,setFilterOwner]=useState("all");
  const [q,setQ]=useState("");
  const [editId,setEditId]=useState(null);

  const allPkgs=[...new Set(tasks.map(t=>t.package).filter(Boolean))].sort();
  const allOwners=[...new Set(tasks.map(t=>t.owner).filter(Boolean))].sort();

  const filtered=tasks.filter(t=>{
    if(filterPkg!=="all"&&t.package!==filterPkg)return false;
    if(filterStatus!=="all"&&t.status!==filterStatus)return false;
    if(filterOwner!=="all"&&t.owner!==filterOwner)return false;
    if(q){const lq=q.toLowerCase();if(![t.text,t.owner,t.package,t.note].some(s=>(s||"").toLowerCase().includes(lq)))return false;}
    return true;
  });

  const toggleDone=id=>{
    saveT(tasks.map(t=>t.id===id?Object.assign({},t,{status:t.status==="done"?"pending":"done",completedAt:t.status==="done"?"":today()}):t));
  };

  const updateTask=(id,field,val)=>{
    saveT(tasks.map(function(t){if(t.id!==id)return t;var u=Object.assign({},t);u[field]=val;return u;}));
  };
  const deleteTask=id=>{if(safeConfirm("Delete this task?"))saveT(tasks.filter(t=>t.id!==id));};

  const pending=tasks.filter(t=>t.status==="pending"||t.status==="in progress").length;
  const done=tasks.filter(t=>t.status==="done").length;

  return <div style={{height:"100%",overflowY:"auto",display:"flex",flexDirection:"column"}}>
    <div className="page-hdr" style={{position:"sticky",top:0,zIndex:20,background:"#f4f3f0",paddingBottom:8,flexShrink:0}}>
      <div><div className="page-title">Actions</div>
        <div className="page-sub">{pending} pending · {done} done · {tasks.length} total</div>
      </div>
    </div>

    <div className="filter-bar">
      <input type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="🔍 Search…" style={{width:180,padding:"5px 10px",fontSize:12}}/>
      <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{width:"auto",padding:"5px 8px",fontSize:11}}>
        <option value="all">All statuses</option>
        {STATUS_OPTS.map(s=><option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>)}
      </select>
      <select value={filterPkg} onChange={e=>setFilterPkg(e.target.value)} style={{width:"auto",padding:"5px 8px",fontSize:11}}>
        <option value="all">All packages</option>
        {allPkgs.map(p=><option key={p} value={p}>{p}</option>)}
      </select>
      <select value={filterOwner} onChange={e=>setFilterOwner(e.target.value)} style={{width:"auto",padding:"5px 8px",fontSize:11}}>
        <option value="all">All owners</option>
        {allOwners.map(o=><option key={o} value={o}>{o.split(",")[0]}</option>)}
      </select>
      {(filterPkg!=="all"||filterStatus!=="all"||filterOwner!=="all"||q)&&
        <button className="btn btn-sm" onClick={()=>{setFilterPkg("all");setFilterStatus("all");setFilterOwner("all");setQ("");}}>✕ Reset</button>}
    </div>

    {filtered.length===0?<div className="empty"><div className="empty-ico">📋</div><div className="empty-txt">No actions found. Add one using the sidebar →</div></div>
    :filtered.map(t=>{
      const c=ownerColor(t.owner||"");
      const sc=calcScore(t.importance||1,t.urgence||1);
      const ss=scoreStyle(sc);
      const isEdit=editId===t.id;
      const ccs=getAllCCs(t.tags||[],t.package||"",t.owner||"",tagrules,pkgrules);
      return <div key={t.id} className="ac-item" style={{background:isEdit?"#f8f9ff":t.status==="done"?"#fafaf8":"#fff",borderColor:isEdit?"#3949ab":"#e8e6df"}}>
        <div className="ac-check" style={{borderColor:t.status==="done"?"#2e7d32":"#ddd",background:t.status==="done"?"#2e7d32":"transparent",flexShrink:0,marginTop:2}}
          onClick={()=>toggleDone(t.id)}>
          {t.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          {isEdit
          ?<div style={{display:"flex",flexDirection:"column",gap:7}}>

            <textarea value={t.text} onChange={e=>updateTask(t.id,"text",e.target.value)} autoFocus style={{fontSize:13,fontWeight:500,minHeight:50,resize:"vertical"}}/>

            <div style={{display:"flex",gap:6}}>
              <div style={{flex:1}}><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Due date</label>
                <input type="date" min="1990-01-01" max="2200-12-31" value={t.due||""} onChange={e=>updateTask(t.id,"due",e.target.value)}/></div>
              <div style={{flex:1}}><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Status</label>
                <select value={t.status} onChange={e=>updateTask(t.id,"status",e.target.value)}>
                  {STATUS_OPTS.map(s=><option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>)}
                </select></div>
            </div>

            <div style={{display:"flex",gap:6}}>
              <div style={{flex:1}}><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Owner</label>
                <select value={t.owner||""} onChange={e=>updateTask(t.id,"owner",e.target.value)}>
                  <option value="">— none —</option>{people.map(p=><option key={p} value={p}>{p.split(",")[0]}</option>)}
                </select></div>
              <div style={{flex:1}}><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Package</label>
                <select value={t.package||""} onChange={e=>updateTask(t.id,"package",e.target.value)}>
                  <option value="">— none —</option>{packages.map(p=><option key={p} value={p}>{p}</option>)}
                </select></div>
            </div>

            <div><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:4}}>Score I×U</label>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:11,fontWeight:700,color:"#555",minWidth:60}}>Importance</span>
                  {[1,2,3].map(v=><button key={v} onClick={()=>updateTask(t.id,"importance",v)}
                    style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+((t.importance||1)===v?"#1c1c1e":"#ddd"),background:(t.importance||1)===v?"#1c1c1e":"#fff",color:(t.importance||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:12,fontWeight:800,cursor:"pointer"}}>{v}</button>)}
                </div>
                <span style={{color:"#ccc"}}>×</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:11,fontWeight:700,color:"#555",minWidth:50}}>Urgency</span>
                  {[1,2,3].map(v=><button key={v} onClick={()=>updateTask(t.id,"urgence",v)}
                    style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+((t.urgence||1)===v?"#1c1c1e":"#ddd"),background:(t.urgence||1)===v?"#1c1c1e":"#fff",color:(t.urgence||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:12,fontWeight:800,cursor:"pointer"}}>{v}</button>)}
                </div>
                {sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,marginLeft:4,fontSize:11,fontWeight:700}}>{ss.label}</span>}
              </div>
            </div>

            <div><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:4}}>Tags</label>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {tags.map(tg=>{const on=(t.tags||[]).includes(tg);const tc=tagColor(tg);return <button key={tg} onClick={()=>{const cur=t.tags||[];updateTask(t.id,"tags",on?cur.filter(x=>x!==tg):[...cur,tg]);}}
                  style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
              </div>
              {getAllCCs(t.tags||[],t.package||"",t.owner||"",tagrules,pkgrules).length>0&&<div style={{marginTop:6,display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#aaa"}}>CC:</span>
                {getAllCCs(t.tags||[],t.package||"",t.owner||"",tagrules,pkgrules).map((p,i)=><span key={p} style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:"#e8f5e9",color:"#2e7d32",fontWeight:700,border:"1px solid #c8e6c9"}}>CC{i+1} {p.split(",")[0]}</span>)}
              </div>}
            </div>

            <div style={{display:"flex",gap:6}}>
              <div style={{flex:1}}><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Link Tender</label>
                <select value={t.tenderRef||""} onChange={e=>updateTask(t.id,"tenderRef",e.target.value)}>
                  <option value="">— none —</option>{tenders.map(td=><option key={td.id} value={td.id}>{td.title}</option>)}
                </select></div>
              <div style={{flex:1}}><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Link Subcontractor</label>
                <select value={t.contractorRef||""} onChange={e=>updateTask(t.id,"contractorRef",e.target.value)}>
                  <option value="">— none —</option>{contractors.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            </div>

            <div><label style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>Note</label>
              <textarea value={t.note||""} onChange={e=>updateTask(t.id,"note",e.target.value)} placeholder="Notes, context…" style={{minHeight:36,fontSize:12}}/></div>
            <button className="btn btn-sm btn-pri" onClick={()=>setEditId(null)} style={{alignSelf:"flex-start"}}>✓ Close editor</button>
          </div>
          :<div onClick={()=>setEditId(t.id)} style={{cursor:"pointer"}}>
            <div className={"ac-text"+(t.status==="done"?" done":"")} style={{fontWeight:500}}>{t.text||<span style={{color:"#ccc",fontStyle:"italic"}}>Click to edit…</span>}</div>
            {t.note&&<div style={{fontSize:11,color:"#888",fontStyle:"italic",marginTop:2}}>{t.note}</div>}
            <div className="ac-meta">
              {t.due&&<span style={{fontSize:11,color:t.due<today()&&t.status!=="done"?"#c62828":"#bbb"}}>📅 {fmtDate(t.due)}</span>}
              {t.owner&&<OwnerChip owner={t.owner}/>}
              {t.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{t.package}</span>}
              {sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label}</span>}
              {(t.tags||[]).map(tg=><TagChip key={tg} tag={tg}/>)}
              {ccs.map((p,i)=><span key={p} style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:"#e8f5e9",color:"#2e7d32",fontWeight:700,border:"1px solid #c8e6c9"}}>CC{i+1} {p.split(",")[0]}</span>)}
              {t.tenderRef&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa"}}>📑 {(tenders.find(x=>x.id===t.tenderRef)||{}).title||""}</span>}
              {t.contractorRef&&<span className="badge" style={{background:"#e8f0fe",color:"#1a73e8",border:"1px solid #c5d8fc"}}>🤝 {(contractors.find(x=>x.id===t.contractorRef)||{}).name||""}</span>}
            </div>
            <div style={{fontSize:9,color:"#ddd",marginTop:3}}>✏️ click to edit</div>
          </div>}
        </div>
        <div style={{display:"flex",gap:4,flexShrink:0,alignItems:"flex-start",paddingTop:2}}>
          {!isEdit&&<select className="btn btn-sm" value={t.status} onChange={e=>updateTask(t.id,"status",e.target.value)} style={{width:"auto",padding:"3px 6px",fontSize:10,border:"1px solid #ddd"}}>
            {STATUS_OPTS.map(s=><option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>)}
          </select>}
          {isEdit&&<button className="btn btn-sm btn-danger" onClick={()=>deleteTask(t.id)} style={{padding:"3px 7px"}}>🗑</button>}
          {!isEdit&&<button className="btn btn-sm btn-danger" onClick={()=>deleteTask(t.id)} style={{padding:"3px 7px"}}>🗑</button>}
        </div>
      </div>;
    })}
  </div>;
}

function ExcelImportModal({onImport,onClose,people,packages}){
  const [rows,setRows]=useState([]);
  const [headers,setHeaders]=useState([]);
  const [fileName,setFileName]=useState("");
  const [colText,setColText]=useState(-1);
  const [colOwner,setColOwner]=useState(-1);
  const [colDue,setColDue]=useState(-1);
  const [colPkg,setColPkg]=useState(-1);
  const [error,setError]=useState("");

  function parseDateCell(v){
    if(v===undefined||v===null||v==="")return"";
    if(typeof v==="number"){
      try{
        var d=window.XLSX.SSF.parse_date_code(v);
        if(d)return d.y+"-"+String(d.m).padStart(2,"0")+"-"+String(d.d).padStart(2,"0");
      }catch(e){}
      return"";
    }
    var s=String(v).trim();
    var m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if(m)return m[3]+"-"+String(m[2]).padStart(2,"0")+"-"+String(m[1]).padStart(2,"0");
    var m2=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(m2)return m2[1]+"-"+String(m2[2]).padStart(2,"0")+"-"+String(m2[3]).padStart(2,"0");
    return"";
  }

  function handleFile(e){
    var file=e.target.files&&e.target.files[0];
    if(!file)return;
    setFileName(file.name);setError("");
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var data=new Uint8Array(ev.target.result);
        var wb=window.XLSX.read(data,{type:"array"});
        var sheet=wb.Sheets[wb.SheetNames[0]];
        var arr=window.XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});
        if(arr.length<2){setError("No data rows found in this sheet.");return;}
        var hdr=arr[0].map(function(h){return String(h||"").trim();});
        setHeaders(hdr);
        var dataRows=arr.slice(1).filter(function(r){return r.some(function(c){return String(c||"").trim();});});
        setRows(dataRows);
        function findCol(names){
          for(var i=0;i<hdr.length;i++){
            var h=hdr[i].toLowerCase();
            if(names.some(function(n){return h.indexOf(n)>=0;}))return i;
          }
          return -1;
        }
        setColText(findCol(["action","task","description","texte","activit"]));
        setColOwner(findCol(["owner","responsable","resp","assigned","who"]));
        setColDue(findCol(["due","date","deadline","echeance","échéance"]));
        setColPkg(findCol(["package","pkg","lot"]));
      }catch(err){setError("Could not read this file: "+(err.message||err));}
    };
    reader.readAsArrayBuffer(file);
  }

  function matchOwner(raw){
    if(!raw)return"";
    var r=String(raw).trim().toLowerCase();
    if(!r)return"";
    var found=(people||[]).find(function(p){return p.toLowerCase()===r||p.split(",")[0].toLowerCase().trim()===r;});
    return found||String(raw).trim();
  }
  function matchPackage(raw){
    if(!raw)return"";
    var r=String(raw).trim().toLowerCase();
    var found=(packages||[]).find(function(p){return p.toLowerCase()===r;});
    return found||"";
  }

  var preview=rows.map(function(r){
    return{
      text:colText>=0?String(r[colText]||"").trim():"",
      owner:colOwner>=0?matchOwner(r[colOwner]):"",
      due:colDue>=0?parseDateCell(r[colDue]):"",
      package:colPkg>=0?matchPackage(r[colPkg]):""
    };
  }).filter(function(r){return r.text;});

  function colSelect(val,setVal,label){
    return <div style={{flex:1,minWidth:120}}>
      <label style={{fontSize:9}}>{label}</label>
      <select value={val} onChange={function(e){setVal(Number(e.target.value));}} style={{fontSize:11,padding:"4px 6px"}}>
        <option value={-1}>— not mapped —</option>
        {headers.map(function(h,i){return <option key={i} value={i}>{h||"Column "+(i+1)}</option>;})}
      </select>
    </div>;
  }

  return <div className="overlay"><div className="modal" style={{maxWidth:680}}>
    <div className="modal-hdr">
      <div className="modal-title">📥 Import actions from Excel</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
    </div>
    <div className="modal-body">
      <label style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 16px",borderRadius:8,border:"1.5px dashed #c9a84c",background:"#fffdf0",cursor:"pointer",fontSize:13,fontWeight:600,color:"#7b1fa2",marginBottom:14,textTransform:"none",letterSpacing:"normal"}}>
        📎 {fileName||"Choose .xlsx / .xls file…"}
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{display:"none"}}/>
      </label>
      {error&&<div style={{padding:"8px 12px",background:"#fce4ec",borderRadius:8,color:"#c62828",fontSize:12,marginBottom:12}}>{error}</div>}

      {headers.length>0&&<div>
        <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6}}>Map columns</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
          {colSelect(colText,setColText,"Action text *")}
          {colSelect(colOwner,setColOwner,"Owner")}
          {colSelect(colDue,setColDue,"Due date")}
          {colSelect(colPkg,setColPkg,"Package")}
        </div>

        <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6}}>Preview ({preview.length} action{preview.length!==1?"s":""} will be created)</div>
        <div style={{maxHeight:260,overflowY:"auto",border:"1px solid #e8e6df",borderRadius:8}}>
          <table className="tbl" style={{fontSize:11}}>
            <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Package</th></tr></thead>
            <tbody>
              {preview.slice(0,50).map(function(r,i){return <tr key={i}>
                <td>{r.text}</td>
                <td>{r.owner?r.owner.split(",")[0]:<span style={{color:"#ddd"}}>—</span>}</td>
                <td>{r.due?fmtDate(r.due):<span style={{color:"#ddd"}}>—</span>}</td>
                <td>{r.package||<span style={{color:"#ddd"}}>—</span>}</td>
              </tr>;})}
            </tbody>
          </table>
          {preview.length>50&&<div style={{padding:8,fontSize:11,color:"#888",textAlign:"center"}}>+{preview.length-50} more rows…</div>}
        </div>
      </div>}
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={preview.length===0||colText<0} onClick={function(){onImport(preview);}}>＋ Import {preview.length} action{preview.length!==1?"s":""}</button>
    </div>
  </div></div>;
}

function TrackerFormModal({data,onChange,onSave,onClose,people,packages,tags}){
  if(!data)return null;
  const set=function(f,v){var u=Object.assign({},data);u[f]=v;onChange(u);};
  return <div className="overlay"><div className="modal" style={{maxWidth:640}}>
    <div className="modal-hdr"><div className="modal-title">{data.createdAt===today()&&!data.title?"New Tracker":data.title||"Edit Tracker"}</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div className="fg"><label>Title *</label><input type="text" value={data.title} onChange={e=>set("title",e.target.value)} placeholder="e.g. Procurement Follow-up, Safety Visits…"/></div>
      <div className="fg"><label>Description</label><textarea value={data.description||""} onChange={e=>set("description",e.target.value)} placeholder="Context, objective…"/></div>
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!data.title.trim()} onClick={()=>onSave(data)}>Save Tracker</button>
    </div>
  </div></div>;
}

function LetterRow({letter,tc,correspondences,saveCorrespondences,delLetter}){
  const [editing,setEditing]=useState(false);
  return <div style={{padding:"8px 10px",borderRadius:7,border:"1px solid #f0ede6",marginBottom:5,background:"#fafaf8"}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
      <span style={{padding:"2px 8px",borderRadius:12,background:tc.bg,color:tc.color,fontSize:10,fontWeight:700,flexShrink:0}}>{tc.label}</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:700,fontSize:12}}>#{letter.number} <span style={{color:"#888",fontWeight:400}}>· {fmtDate(letter.date)}</span></div>
        {letter.description&&<div style={{fontSize:11,color:"#555",marginTop:1}}>{letter.description}</div>}
        {letter.type==="received"&&<div style={{marginTop:4}}>
          {!editing&&!letter.replied&&<button onClick={function(){setEditing(true);}} style={{fontSize:10,padding:"1px 8px",borderRadius:8,background:"#fce4ec",color:"#c62828",fontWeight:600,border:"none",cursor:"pointer"}}>⏳ Awaiting reply — click to mark</button>}
          {!editing&&letter.replied&&<div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:10,padding:"1px 7px",borderRadius:8,background:"#e8f5e9",color:"#2e7d32",fontWeight:600}}>✅ Replied</span>
            {letter.replyNumber&&<span style={{fontSize:10,color:"#2e7d32"}}>N° {letter.replyNumber} — {fmtDate(letter.replyDate)}</span>}
            <button onClick={function(){setEditing(true);}} style={{fontSize:10,color:"#888",background:"none",border:"none",cursor:"pointer"}}>✏️</button>
          </div>}
          
        </div>}
      </div>
      <button onClick={function(){delLetter(letter.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:13,flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
    </div>
  </div>;
}

function CorrespondenceLog({ctrId,ctrName,correspondences,saveCorrespondences,saveT,tasks}){
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({number:"",type:"received",date:today(),description:"",replied:false,replyNumber:"",replyDate:""});

  var ctrCorr=(correspondences||[]).filter(function(l){return l.ctrId===ctrId;}).sort(function(a,b){return b.date.localeCompare(a.date);});

  function addLetter(){
    var entry=Object.assign({id:uuid(),ctrId:ctrId,ctrName:ctrName},form);
    var newCorr=[entry,...(correspondences||[])];
    saveCorrespondences(newCorr);

    if(form.type==="received"&&!form.replied&&saveT&&tasks){
      var dueDate=new Date(form.date);dueDate.setDate(dueDate.getDate()+7);
      var duStr=toISO(dueDate);

      var ctrOwner="";
      if(window._ppContractors){
        var ctrObj=(window._ppContractors||[]).find(function(c){return c.id===ctrId;});
        if(ctrObj){var ownerCt=(ctrObj.contracts||[]).find(function(ct){return ct.owner;});if(ownerCt)ctrOwner=ownerCt.owner;}
      }
      var action=newTask({
        text:"Respond to letter "+form.number+" from "+ctrName+" received "+fmtDate(form.date),
        due:duStr,status:"pending",note:"Auto-created from correspondence log",
        tags:["Contract"],owner:ctrOwner,
        contractorRef:ctrId
      });
      saveT([action,...(tasks||[])]);
    }
    setShowAdd(false);
    setForm({number:"",type:"received",date:today(),description:"",replied:false,replyNumber:"",replyDate:""});
  }

  function delLetter(id){if(safeConfirm("Delete this correspondence entry?"))saveCorrespondences((correspondences||[]).filter(function(l){return l.id!==id;}));}

  function set(f,v){setForm(function(prev){return Object.assign({},prev,{[f]:v});});}

  const TYPE_COLORS={received:{bg:"#e3f2fd",color:"#1565c0",label:"Received"},sent:{bg:"#e8f5e9",color:"#2e7d32",label:"Sent"}};

  return <div className="card" style={{marginBottom:12}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <div style={{fontWeight:700,fontSize:13}}>Correspondence ({ctrCorr.length})</div>
      <button className="btn btn-sm btn-gold" onClick={function(){setShowAdd(!showAdd);}}>＋ Add Letter</button>
    </div>

    {showAdd&&<div style={{padding:"12px",background:"#fafaf8",borderRadius:8,border:"1px solid #e8e6df",marginBottom:10}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1,minWidth:110}}>
          <label>Letter # *</label>
          <input type="text" value={form.number} onChange={function(e){set("number",e.target.value);}} placeholder="e.g. LTR-001"/>
        </div>
        <div style={{flex:1,minWidth:100}}>
          <label>Type</label>
          <select value={form.type} onChange={function(e){set("type",e.target.value);}} style={{fontFamily:"inherit"}}>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
          </select>
        </div>
        <div style={{flex:1,minWidth:120}}>
          <label>Date</label>
          <input type="date" min="1990-01-01" max="2200-12-31" value={form.date} onChange={function(e){set("date",e.target.value);}}/>
        </div>
      </div>
      <div className="fg" style={{marginBottom:8}}>
        <label>Description / Subject</label>
        <input type="text" value={form.description} onChange={function(e){set("description",e.target.value);}} placeholder="Brief description of the letter..."/>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,color:"#333"}}>
          <input type="checkbox" checked={form.replied} onChange={function(e){set("replied",e.target.checked);}} style={{width:15,height:15}}/>
          Replied
        </label>
        {form.replied&&<div style={{display:"flex",gap:8,flex:1}}>
          <div style={{flex:1}}>
            <label>Reply letter #</label>
            <input type="text" value={form.replyNumber} onChange={function(e){set("replyNumber",e.target.value);}} placeholder="Reply #"/>
          </div>
          <div style={{flex:1}}>
            <label>Reply date</label>
            <input type="date" min="1990-01-01" max="2200-12-31" value={form.replyDate} onChange={function(e){set("replyDate",e.target.value);}}/>
          </div>
        </div>}
      </div>
      {form.type==="received"&&!form.replied&&<div style={{padding:"6px 10px",background:"#fff8e1",borderRadius:6,fontSize:11,color:"#f57f17",marginBottom:8}}>
        ⚠️ An action "Respond to letter" will be auto-created with due date 7 days from receipt.
      </div>}
      <div style={{display:"flex",gap:6}}>
        <button className="btn" onClick={function(){setShowAdd(false);}}>Cancel</button>
        <button className="btn btn-pri" disabled={!form.number.trim()} onClick={addLetter}>Save</button>
      </div>
    </div>}

    {ctrCorr.length===0&&!showAdd&&<div style={{color:"#bbb",fontSize:12}}>No correspondence recorded yet.</div>}
    {ctrCorr.map(function(letter){
      var tc=TYPE_COLORS[letter.type]||TYPE_COLORS.received;
      return <LetterRow key={letter.id} letter={letter} tc={tc} correspondences={correspondences} saveCorrespondences={saveCorrespondences} delLetter={delLetter}/>;
    })}
  </div>;
}

function ContractorFormModal({data,onChange,onSave,onClose,people,packages,tenders}){
  function set(f,v){var u=Object.assign({},data);u[f]=v;onChange(u);}
  var selRefs=data.tenderRefs||[];
  function toggleTender(tid){
    var cur=data.tenderRefs||[];
    var updated=cur.includes(tid)?cur.filter(function(x){return x!==tid;}):[...cur,tid];
    set("tenderRefs",updated);
  }
  return <div className="overlay"><div className="modal" style={{maxWidth:480}}>
    <div className="modal-hdr"><div className="modal-title">{data.name||"New Subcontractor"}</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div className="fg"><label>Subcontractor name *</label><input type="text" value={data.name||""} onChange={function(e){set("name",e.target.value);}} placeholder="e.g. ACME Construction"/></div>
      <div className="frow">
        <div className="fg"><label>Package</label>
          <select value={data.package||""} onChange={function(e){set("package",e.target.value);}}>
            <option value="">— none —</option>{(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div className="fg"><label>Owner</label>
          <select value={data.owner||""} onChange={function(e){set("owner",e.target.value);}}>
            <option value="">— none —</option>{(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
          </select>
        </div>
      </div>
      <div className="fg">
        <label>Linked Tenders ({selRefs.length} selected)</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>
          {(tenders||[]).map(function(t){
            var on=selRefs.includes(t.id);
            return <button key={t.id} onClick={function(){toggleTender(t.id);}}
              style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(on?"#b45309":"#ddd"),background:on?"#fff8f0":"#fff",color:on?"#b45309":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              {on?"✓ ":""}{t.title}{t.package?" ("+t.package+")":""}
            </button>;
          })}
        </div>
        {selRefs.length>0&&<div style={{marginTop:6,fontSize:11,color:"#2e7d32",fontWeight:600}}>Linked: {selRefs.map(function(id){var t=(tenders||[]).find(function(x){return x.id===id;});return t?t.title:"?";}).join(", ")}</div>}
      </div>
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!(data.name||"").trim()} onClick={function(){onSave(data);}}>Save Subcontractor</button>
    </div>
  </div></div>;
}

function EmailModal({em,onClose}){
  var toList=(em.to||[]).filter(Boolean);
  var ccList=(em.cc||[]).filter(function(e){return e&&toList.indexOf(e)===-1;});
  var missingCount=(em.missing||[]).length;
  function openOutlook(){
    var params=[];
    if(ccList.length)params.push("cc="+encodeURIComponent(ccList.join("; ")));
    params.push("subject="+encodeURIComponent(em.subject||""));
    params.push("body="+encodeURIComponent(em.body||""));
    var href="mailto:"+encodeURIComponent(toList.join("; "))+"?"+params.join("&");
    window.location.href=href;
  }
  return <div className="overlay"><div className="modal" style={{maxWidth:640}}>
    <div className="modal-hdr"><div className="modal-title">📧 Action email</div><button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div style={{marginBottom:12,padding:"10px 12px",background:toList.length>0?"#f0f8ff":"#fff8e1",borderRadius:8,border:"1px solid "+(toList.length>0?"#bbdefb":"#ffe082")}}>
        {toList.length>0&&<div style={{fontSize:12,marginBottom:ccList.length>0?4:0}}><strong>To:</strong> {toList.join("; ")}</div>}
        {ccList.length>0&&<div style={{fontSize:12}}><strong>Cc:</strong> {ccList.join("; ")}</div>}
        {toList.length===0&&ccList.length===0&&<div style={{fontSize:12,color:"#f57f17"}}><strong>No recipients yet.</strong> Recipients are auto-filled from the owners of the actions in this report, plus anyone set as default Cc.<br/>Set it up once: <strong>Settings → People</strong> (add an email to each person) and optionally <strong>Settings → Report CC</strong> (people always in copy).</div>}
        {missingCount>0&&<div style={{fontSize:11,color:"#c62828",marginTop:6}}>⚠️ {missingCount} recipient{missingCount!==1?"s have":" has"} no email on file — set it in Settings → People. They're not included above.</div>}
      </div>
      <div className="fg" style={{marginBottom:10}}><label>Subject</label><input type="text" value={em.subject} readOnly style={{fontWeight:600}}/></div>
      <div className="fg"><label>Body</label><textarea value={em.body} readOnly style={{minHeight:320,fontFamily:"monospace",fontSize:12,lineHeight:1.6,background:"#fafaf8"}}/></div>
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn" onClick={()=>navigator.clipboard.writeText("Subject: "+em.subject+"\n\n"+em.body)}>📋 Copy all</button>
      <button className="btn btn-pri" onClick={openOutlook} disabled={toList.length===0&&ccList.length===0}>📧 Open in Outlook</button>
    </div>
  </div></div>;
}

function SettingsView({subList,saveSubList,subColors,saveSubColors,contractors,tenderRules,saveTenderRules,tenders,tags,saveTags,people,savePeople,packages,savePackages,tagrules,saveTagrules,pkgrules,savePkgrules,apiKey,saveApiKey,improvements,saveImprovements,pkgOwners,savePkgOwners,pkgSubcontractors,savePkgSubcontractors,peopleEmails,savePeopleEmails,defaultCC,saveDefaultCC,peopleAccess,savePeopleAccess,durations,saveDurations,isAdmin,zones,saveZones,zoneOwners,saveZoneOwners,userPrefs,saveUserPrefs,allData,onImport}){
  const [tab,setTab]=useState("tags");
  const [newTag,setNewTag]=useState("");
  const [newPerson,setNewPerson]=useState("");
  const [newPackage,setNewPackage]=useState("");
  const [newZone,setNewZone]=useState("");
  const [newSub,setNewSub]=useState("");
  const [colorPick,setColorPick]=useState("");

  const addTag=()=>{const t=newTag.trim();if(t&&!tags.includes(t)){saveTags([...tags,t].sort());setNewTag("");}};
  const removeTag=t=>{if(safeConfirm("Remove tag '"+t+"'? CC rules for this tag will also be removed.")){saveTags(tags.filter(x=>x!==t));const nr=Object.assign({},tagrules);delete nr[t];saveTagrules(nr);}};
  const addPerson=()=>{const p=newPerson.trim();if(p&&!people.includes(p)){savePeople([...people,p].sort());setNewPerson("");}};
  const removePerson=p=>{if(safeConfirm("Remove "+p+"?"))savePeople(people.filter(x=>x!==p));};
  const addPackage=()=>{const p=newPackage.trim();if(p&&!packages.includes(p)){savePackages([...packages,p].sort());setNewPackage("");}};
  const removePackage=p=>{if(safeConfirm("Remove package '"+p+"'?"))savePackages(packages.filter(x=>x!==p));};
  const addZone=()=>{const z=newZone.trim();if(z&&!(zones||[]).includes(z)){saveZones([...(zones||[]),z].sort());setNewZone("");}};
  const removeZone=z=>{if(safeConfirm("Remove zone '"+z+"'? Existing actions tagged to this zone will keep their zone value."))saveZones((zones||[]).filter(x=>x!==z));};
  var ctrNames=(contractors||[]).map(function(c){return String(c.name||"").trim();}).filter(Boolean);
  var ctrLower={};ctrNames.forEach(function(n){ctrLower[n.toLowerCase()]=n;});
  var mergedSubs=allSubcontractors(subList,contractors);
  const addSub=()=>{const v=newSub.trim();if(!v)return;
    if((subList||[]).some(function(x){return x.toLowerCase()===v.toLowerCase();})){setNewSub("");return;}
    saveSubList([...(subList||[]),v].sort(function(a,b){return a.localeCompare(b);}));setNewSub("");};
  const removeSub=v=>{if(safeConfirm("Remove subcontractor '"+v+"' from the list? Schedule rows already tagged with it keep their value."))saveSubList((subList||[]).filter(x=>x!==v));};

  const toggleTagRule=(tag,person)=>{
    const cur=tagrules[tag]||[];
    const updated=cur.includes(person)?cur.filter(x=>x!==person):[...cur,person];
    var ntr=Object.assign({},tagrules);ntr[tag]=updated;saveTagrules(ntr);
  };
  const togglePkgRule=(pkg,person)=>{
    const cur=pkgrules[pkg]||[];
    const updated=cur.includes(person)?cur.filter(x=>x!==person):[...cur,person];
    var npr=Object.assign({},pkgrules);npr[pkg]=updated;savePkgrules(npr);
  };

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Settings</div><div className="page-sub">Manage tags, people, packages and CC rules</div></div>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
      {["tags","people","packages","zones","subcontractors","tender-rules","pkg-owners","cc-rules","report-cc","access","my-prefs","improvements","backup"].concat(isAdmin?["durations"]:[]).map(function(t){return <button key={t} className={"fchip"+(tab===t?" on":"")} onClick={function(){setTab(t);}} style={{textTransform:"capitalize"}}>{t==="cc-rules"?"CC Rules":t==="improvements"?"💡 Improvements":t==="pkg-owners"?"📦 Pkg Owners":t==="backup"?"💾 Backup":t==="my-prefs"?"👤 My Prefs":t==="tender-rules"?"🔗 Tender rules":t==="subcontractors"?"👷 Subcontractors":t==="zones"?"🏢 Zones":t==="report-cc"?"📧 Report CC":t==="access"?"🔐 Access":t==="durations"?"⏱ Durations":t.charAt(0).toUpperCase()+t.slice(1)}</button>;})}
    </div>

    {tab==="tags"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Tags ({tags.length})</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input type="text" value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="New tag name…" style={{flex:1}}/>
        <button className="btn btn-pri" onClick={addTag}>＋ Add</button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {tags.map(t=>{const tc=tagColor(t);return <div key={t} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,background:tc.bg,border:"1.5px solid "+tc.color}}>
          <span style={{fontSize:12,fontWeight:700,color:tc.color}}>{t}</span>
          <button onClick={()=>removeTag(t)} style={{background:"none",border:"none",cursor:"pointer",color:tc.color,fontSize:12,padding:"0 2px",lineHeight:1}}>×</button>
        </div>;})}
      </div>
    </div>}

    {tab==="people"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>People ({people.length})</div>
      <div style={{fontSize:12,color:"#888",marginBottom:12}}>Add an email address to each person so they can be included as recipients when opening reports in Outlook.</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input type="text" value={newPerson} onChange={e=>setNewPerson(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPerson()} placeholder="LASTNAME, Firstname" style={{flex:1}}/>
        <button className="btn btn-pri" onClick={addPerson}>＋ Add</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {people.map(p=>{const c=ownerColor(p);return <div key={p} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:c.bg}}>
          <div style={{width:28,height:28,borderRadius:"50%",background:c.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,flexShrink:0}}>{p[0]}</div>
          <span style={{flex:1,fontSize:13,fontWeight:600,color:c.accent}}>{p}</span>
          <input type="email" value={(peopleEmails||{})[p]||""} onChange={function(e){var u=Object.assign({},peopleEmails||{});u[p]=e.target.value;savePeopleEmails(u);}} placeholder="email@company.com" style={{flex:1,padding:"4px 8px",fontSize:12,border:"1px solid #e0ddd6",borderRadius:6}}/>
          <button onClick={()=>removePerson(p)} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14}} onMouseEnter={e=>e.currentTarget.style.color="#c62828"} onMouseLeave={e=>e.currentTarget.style.color="#ddd"}>🗑</button>
        </div>;})}
      </div>
    </div>}

    {tab==="packages"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Packages ({packages.length})</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input type="text" value={newPackage} onChange={e=>setNewPackage(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPackage()} placeholder="Package name…" style={{flex:1}}/>
        <button className="btn btn-pri" onClick={addPackage}>＋ Add</button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {packages.map(p=><div key={p} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,background:"#f0ede6",border:"1.5px solid #e0ddd6"}}>
          <span style={{fontSize:12,fontWeight:600,color:"#555"}}>{p}</span>
          <button onClick={()=>removePackage(p)} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:12,padding:"0 2px"}} onMouseEnter={e=>e.currentTarget.style.color="#c62828"} onMouseLeave={e=>e.currentTarget.style.color="#bbb"}>×</button>
        </div>)}
      </div>
    </div>}

    {tab==="tender-rules"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>🔗 Tender rules ({(tenderRules||[]).length})</div>
      <div style={{fontSize:12,color:"var(--ink-3,#6f6b62)",marginBottom:14}}>
        “Every schedule task of <b>this subcontractor</b> in <b>this zone</b> belongs to <b>this tender</b>.”
        A rule fills the tender in as soon as the subcontractor is set on a task, and the schedule has a
        <b> 🔗 Apply rules</b> button to sweep the existing ones. A task that already points at another
        tender is never overwritten.
      </div>

      {(tenderRules||[]).length===0&&<div style={{fontSize:12,color:"var(--ink-4,#9b968b)",marginBottom:12}}>No rule yet.</div>}
      {(tenderRules||[]).map(function(r,i){
        var td=(tenders||[]).find(function(x){return x.id===r.tenderId;});
        return <div key={i} style={{display:"flex",gap:7,alignItems:"center",padding:"8px 10px",border:"1.5px solid var(--rule,#ddd9cf)",borderRadius:8,marginBottom:6,background:"#fafaf8",flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"var(--ink-3,#6f6b62)"}}>Tasks of</span>
          <select value={r.group||""} onChange={function(e){var d=(tenderRules||[]).slice();d[i]=Object.assign({},r,{group:e.target.value});saveTenderRules(d);}}
            style={{width:"auto",minWidth:130,fontSize:11,padding:"4px 7px"}}>
            <option value="">— subcontractor —</option>
            {allSubcontractors(subList,contractors).map(function(g){return <option key={g} value={g}>{g}</option>;})}
          </select>
          <span style={{fontSize:11,color:"var(--ink-3,#6f6b62)"}}>in</span>
          <select value={r.zone||""} onChange={function(e){var d=(tenderRules||[]).slice();d[i]=Object.assign({},r,{zone:e.target.value});saveTenderRules(d);}}
            style={{width:"auto",minWidth:110,fontSize:11,padding:"4px 7px"}}>
            <option value="">all zones</option>
            {(zones||[]).map(function(z){return <option key={z} value={z}>{z}</option>;})}
          </select>
          <span style={{fontSize:11,color:"var(--ink-3,#6f6b62)"}}>→</span>
          <select value={r.tenderId||""} onChange={function(e){var d=(tenderRules||[]).slice();d[i]=Object.assign({},r,{tenderId:e.target.value});saveTenderRules(d);}}
            style={{flex:1,minWidth:180,fontSize:11,padding:"4px 7px",fontWeight:600,color:r.tenderId?"var(--blue,#0f5299)":"var(--ink-4,#9b968b)"}}>
            <option value="">— tender —</option>
            {(function(){
              var byPkg={};
              (tenders||[]).forEach(function(t){var p=t.package||"— no package —";(byPkg[p]=byPkg[p]||[]).push(t);});
              return Object.keys(byPkg).sort().map(function(p){
                return <optgroup key={p} label={p}>
                  {byPkg[p].slice().sort(function(a,b){return (a.title||"").localeCompare(b.title||"");})
                    .map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
                </optgroup>;
              });
            })()}
          </select>
          {!r.zone&&<span className="badge" style={{background:"var(--gold-soft,#faf3e0)",color:"var(--gold-ink,#8a6a1e)"}} title="A rule set on a specific zone wins over this one">default</span>}
          {(!r.group||!r.tenderId)&&<span className="badge" style={{background:"var(--red-soft,#fbe6e8)",color:"var(--red,#b3302a)"}}>incomplete</span>}
          <button className="btn btn-sm btn-danger" style={{padding:"3px 8px"}}
            onClick={function(){if(safeConfirm("Delete this rule? Tasks already linked keep their tender."))saveTenderRules((tenderRules||[]).filter(function(_,j){return j!==i;}));}}>🗑</button>
        </div>;
      })}

      <button className="btn btn-sm btn-gold" onClick={function(){saveTenderRules([...(tenderRules||[]),{group:"",zone:"",tenderId:""}]);}}>＋ Add rule</button>
    </div>}

    {tab==="subcontractors"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>👷 Subcontractors ({mergedSubs.length})</div>
      <div style={{fontSize:12,color:"#888",marginBottom:12}}>The list used to tag each Schedule task with the company doing the work. Names created in the <strong>Subcontractors</strong> tab are added here automatically — you only need to type a name below for a company that has no record yet (e.g. a trade not yet contracted).</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input type="text" value={newSub} onChange={e=>setNewSub(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addSub()} placeholder="Company or trade name…" style={{flex:1}}/>
        <button className="btn btn-pri" onClick={addSub}>＋ Add</button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {mergedSubs.map(function(v){
          var fromCtr=!!ctrLower[v.toLowerCase()];
          var manual=(subList||[]).some(function(x){return x.toLowerCase()===v.toLowerCase();});
          var col=(subColors||{})[v]||"";
          return <div key={v} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 12px",borderRadius:20,background:fromCtr?"#e8f5e9":"#f0ede6",border:"1.5px solid "+(fromCtr?"#c8e6c9":"#e0ddd6")}}>
            <span onClick={function(){setColorPick(colorPick===v?"":v);}} title={col?"Schedule colour: "+paletteName(col)+" — click to change":"No colour yet — click to pick one"}
              style={{width:14,height:14,borderRadius:4,cursor:"pointer",flexShrink:0,background:col||"repeating-linear-gradient(45deg,#ddd,#ddd 2px,#fff 2px,#fff 4px)",border:"1px solid rgba(0,0,0,.2)"}}></span>
            <span style={{fontSize:12,fontWeight:600,color:fromCtr?"#2e7d32":"#555"}}>{v}</span>
            {fromCtr&&<span title="Comes from the Subcontractors tab — remove it there" style={{fontSize:9,color:"#2e7d32",fontWeight:700}}>AUTO</span>}
            {manual&&<button onClick={function(){removeSub(v);}} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:12,padding:"0 2px"}}>×</button>}
          </div>;
        })}
      </div>
      {mergedSubs.length===0&&<div style={{fontSize:12,color:"#bbb"}}>No subcontractor yet. Add one above, or create it in the Subcontractors tab.</div>}
      {colorPick&&<div style={{marginTop:14,padding:"12px 14px",border:"1.5px solid #e0ddd6",borderRadius:10,background:"#fafaf8"}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Schedule colour for <span style={{color:"#00695c"}}>{colorPick}</span></div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {SCHED_PALETTE.map(function(c){
            var on=(subColors||{})[colorPick]===c.hex;
            return <button key={c.hex} title={c.name} onClick={function(){var m=Object.assign({},subColors||{});m[colorPick]=c.hex;saveSubColors(m);}}
              style={{width:30,height:30,borderRadius:7,cursor:"pointer",background:c.hex,border:on?"3px solid #1c1c1e":"1px solid rgba(0,0,0,.15)"}}></button>;
          })}
          <button onClick={function(){var m=Object.assign({},subColors||{});delete m[colorPick];saveSubColors(m);}}
            title="No colour — back to the default gold"
            style={{width:30,height:30,borderRadius:7,cursor:"pointer",fontSize:14,color:"#aaa",background:"#fff",border:"1px dashed #ccc"}}>×</button>
          <button className="btn btn-sm" onClick={function(){setColorPick("");}} style={{marginLeft:8}}>Done</button>
        </div>
        <div style={{fontSize:10,color:"#aaa",marginTop:8}}>Used for this company's planned bars in every zone schedule. A single task can still be given its own colour from the schedule.</div>
      </div>}
    </div>}

    {tab==="zones"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>🏢 Zones ({(zones||[]).length})</div>
      <div style={{fontSize:12,color:"#888",marginBottom:12}}>Zones are dedicated workspaces for zone pilots (e.g. P2/P1, LO), separate from packages. Actions created inside a zone are auto-tagged to it.</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input type="text" value={newZone} onChange={e=>setNewZone(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addZone()} placeholder="Zone name, e.g. P2/P1…" style={{flex:1}}/>
        <button className="btn btn-pri" onClick={addZone}>＋ Add</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {(zones||[]).map(z=><div key={z} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,background:"#fafaf8",border:"1.5px solid #e8e6df"}}>
          <span style={{fontSize:13,fontWeight:700,color:"#555",minWidth:110}}>🏢 {z}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase",marginBottom:3}}>Leaders (can edit the zone schedule)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {(people||[]).map(function(p){
                var cur=zoneLeadersOf(zoneOwners,z);
                var on=cur.indexOf(p)>=0;
                var c=ownerColor(p);
                return <button key={p} onClick={function(){
                  var next=on?cur.filter(function(x){return x!==p;}):[...cur,p];
                  var u=Object.assign({},zoneOwners||{});
                  if(next.length)u[z]=next;else delete u[z];
                  saveZoneOwners(u);
                }} style={{padding:"2px 9px",borderRadius:14,border:"1.5px solid "+(on?c.accent:"#ddd"),background:on?c.bg:"#fff",color:on?c.accent:"#bbb",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{on?"✓ ":""}{p.split(",")[0]}</button>;
              })}
            </div>
          </div>
          <button onClick={()=>removeZone(z)} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14}} onMouseEnter={e=>e.currentTarget.style.color="#c62828"} onMouseLeave={e=>e.currentTarget.style.color="#ddd"}>🗑</button>
        </div>)}
      </div>
    </div>}

    {tab==="report-cc"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>📧 Report Default CC</div>
      <div style={{fontSize:12,color:"#888",marginBottom:14}}>These people are always added in CC when you click "Open in Outlook" on any report (Zone report, Global actions email...), on top of the owners mentioned in the actions themselves. Make sure they have an email set in the People tab.</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {people.map(function(p){
          var on=(defaultCC||[]).includes(p);
          var c=ownerColor(p);
          var hasEmail=!!(peopleEmails||{})[p];
          return <button key={p} onClick={function(){var cur=defaultCC||[];saveDefaultCC(on?cur.filter(function(x){return x!==p;}):[...cur,p]);}}
            style={{padding:"5px 12px",borderRadius:20,border:"1.5px solid "+(on?c.accent:"#ddd"),background:on?c.bg:"#fff",color:on?c.accent:"#aaa",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer",opacity:hasEmail?1:0.5}}>
            {on?"✓ ":""}{p.split(",")[0]}{!hasEmail&&" ⚠️"}
          </button>;
        })}
      </div>
      {(defaultCC||[]).some(function(p){return !(peopleEmails||{})[p];})&&<div style={{marginTop:10,fontSize:11,color:"#c62828"}}>⚠️ Some selected people have no email set — add one in the People tab or they'll be skipped when opening Outlook.</div>}
    </div>}

    {tab==="durations"&&isAdmin&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>⏱ Durations &amp; lead times</div>
      <div style={{fontSize:12,color:"#888",marginBottom:14}}>These drive every automatic target date in the app. Changing a value re-computes all future dates immediately; dates you typed manually are never overwritten.</div>
      {[
        {group:"Contract chain (working days)",items:[
          {k:"accToRequest",label:"ACC/Aconex approved → subcontract request sent"},
          {k:"requestToCirculate",label:"Request sent → contract to circulate"},
          {k:"circulateToSign",label:"Circulated → signed by all parties"},
          {k:"accToSigned",label:"ACC approval → signed contract (overall target)"},
          {k:"contractSigning",label:"Procurement timeline: ACC approval → contract signing"}
        ]},
        {group:"Client review (working days)",items:[
          {k:"accApproval",label:"ACC/Aconex submitted → approval expected"},
          {k:"sdApproval",label:"Shop drawing submitted → approval expected"}
        ]},
        {group:"Method statements & inspection (calendar days)",items:[
          {k:"wmsBeforeStart",label:"WMS submitted this long BEFORE the target start on site"},
          {k:"itpBeforeStart",label:"ITP submitted this long BEFORE the target start on site"},
          {k:"marAfterContract",label:"MAR due this long AFTER the contract is signed"}
        ]},
        {group:"Other",items:[
          {k:"sdAfterContract",label:"Contract signed → shop drawing submission (working days)"},
          {k:"clientResponse",label:"Any document with client → response due (calendar days)"}
        ]}
      ].map(function(sec){
        return <div key={sec.group} style={{marginBottom:16}}>
          <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6,letterSpacing:".4px"}}>{sec.group}</div>
          {sec.items.map(function(it){
            var cur=(durations||{})[it.k];
            var isCustom=cur!==undefined&&cur!==null&&cur!==""&&Number(cur)!==DEFAULT_DURATIONS[it.k];
            return <div key={it.k} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderRadius:8,background:isCustom?"#fffdf0":"#fafaf8",marginBottom:4,border:"1px solid "+(isCustom?"#f0e2b8":"#f0ede6")}}>
              <span style={{flex:1,fontSize:12}}>{it.label}</span>
              {isCustom&&<span style={{fontSize:9,color:"#b45309",fontWeight:700}}>default {DEFAULT_DURATIONS[it.k]}</span>}
              <input type="number" min="0" value={cur===undefined||cur===null?"":cur}
                onChange={function(e){var u=Object.assign({},durations||{});if(e.target.value==="")delete u[it.k];else u[it.k]=Number(e.target.value);saveDurations(u);}}
                placeholder={String(DEFAULT_DURATIONS[it.k])}
                style={{width:70,padding:"4px 8px",fontSize:12,textAlign:"right",fontWeight:700}}/>
              <span style={{fontSize:10,color:"#aaa",width:30}}>days</span>
            </div>;
          })}
        </div>;
      })}
      <button className="btn btn-sm" onClick={function(){if(safeConfirm("Reset every duration back to its default value?"))saveDurations({});}}>↺ Reset all to defaults</button>
    </div>}

    {tab==="access"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>🔐 Navigation Access</div>
      <div style={{fontSize:12,color:"#888",marginBottom:6}}>Controls what each person sees when they open the app.</div>
      <div style={{fontSize:12,color:"#555",marginBottom:14,padding:"8px 12px",background:"#f0f8ff",borderRadius:8,border:"1px solid #bbdefb"}}>
        <strong>Not configured = full access.</strong> A person only becomes restricted once you press <strong>"Restrict"</strong> on their line. Restricted people see: My Procurement (their own tenders/packages + extra packages granted below), Zone if marked Zone Pilot, Actions, and Settings.
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {people.map(function(p){
          var accRaw=(peopleAccess||{})[p];
          var isConfigured=!!accRaw;
          var acc=accRaw||{};
          var isRestricted=isConfigured&&!acc.fullAccess;
          function toggle(field){
            var u=Object.assign({},peopleAccess||{});
            var pu=Object.assign({},acc);
            pu[field]=!pu[field];
            u[p]=pu;
            savePeopleAccess(u);
          }
          function restrict(){
            var u=Object.assign({},peopleAccess||{});
            u[p]=Object.assign({},acc,{fullAccess:false});
            savePeopleAccess(u);
          }
          function grantFull(){
            var u=Object.assign({},peopleAccess||{});
            delete u[p];
            savePeopleAccess(u);
          }
          function toggleExtraPkg(pkgName){
            var u=Object.assign({},peopleAccess||{});
            var pu=Object.assign({},acc);
            var cur=pu.extraPackages||[];
            pu.extraPackages=cur.includes(pkgName)?cur.filter(function(x){return x!==pkgName;}):[...cur,pkgName];
            u[p]=pu;
            savePeopleAccess(u);
          }
          return <div key={p} style={{padding:"10px 12px",borderRadius:10,border:"1.5px solid "+(isRestricted?"#ffe082":"#e8e6df"),background:isRestricted?"#fffdf5":"#fafaf8"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:isRestricted?8:0}}>
              <span style={{fontWeight:700,fontSize:13,minWidth:130}}>{p.split(",")[0]}</span>
              <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:12,background:isRestricted?"#fff3e0":"#e8f5e9",color:isRestricted?"#e65100":"#2e7d32"}}>
                {isRestricted?"Restricted":"Full access"}
              </span>
              {isRestricted
                ?<button className="btn btn-sm" onClick={grantFull}>Give full access</button>
                :<button className="btn btn-sm" onClick={restrict}>Restrict</button>}
              <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:600,color:acc.readOnly?"#0f5299":"#888"}}
                title="Sees everything they are allowed to see, but cannot create, modify or delete anything. Works with full access as well as with a restricted profile.">
                <input type="checkbox" checked={!!acc.readOnly} onChange={function(){toggle("readOnly");}} style={{width:14,height:14}}/>
                👁 Read only
              </label>
              <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:600,color:acc.canDelete?"#b3302a":"#888"}}
                title="Allows deleting minutes of meeting, actions and documents. Deleting a schedule stays reserved for the app admin.">
                <input type="checkbox" checked={!!acc.canDelete} onChange={function(){toggle("canDelete");}} style={{width:14,height:14}}/>
                🗑 May delete
              </label>
              {isRestricted&&<label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:600,color:acc.zonePilot?"#7b1fa2":"#888"}}>
                <input type="checkbox" checked={!!acc.zonePilot} onChange={function(){toggle("zonePilot");}} style={{width:14,height:14}}/>
                Zone Pilot
              </label>}
            </div>
            {isRestricted&&<div>
              <div style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase",marginBottom:4}}>Extra package access (beyond owned tenders/packages)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {(packages||[]).map(function(pkgName){
                  var on=(acc.extraPackages||[]).includes(pkgName);
                  return <button key={pkgName} onClick={function(){toggleExtraPkg(pkgName);}} style={{padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(on?"#1a73e8":"#ddd"),background:on?"#e8f0fe":"#fff",color:on?"#1a73e8":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{on?"✓ ":""}{pkgName}</button>;
                })}
              </div>
            </div>}
          </div>;
        })}
      </div>
    </div>}

    {tab==="cc-rules"&&<div>
      <div className="card" style={{marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Tag → Auto CC</div>
        <div style={{fontSize:12,color:"#888",marginBottom:14}}>When a tag is assigned to an action, the selected people are automatically CC-ed.</div>
        {tags.map(t=>{const tc=tagColor(t);const ccs=tagrules[t]||[];return <div key={t} style={{marginBottom:12,padding:"10px 12px",borderRadius:10,border:"1.5px solid #e8e6df",background:"#fafaf8"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{padding:"3px 10px",borderRadius:20,background:tc.bg,color:tc.color,fontSize:12,fontWeight:700}}>{t}</span>
            {ccs.length>0&&<span style={{fontSize:11,color:"#2e7d32",fontWeight:600}}>→ CC: {ccs.map(p=>p.split(",")[0]).join(", ")}</span>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {people.map(p=>{const on=ccs.includes(p);const c=ownerColor(p);return <button key={p} onClick={()=>toggleTagRule(t,p)}
              style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(on?c.accent:"#ddd"),background:on?c.bg:"#fff",color:on?c.accent:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              {on?"✓ ":""}{p.split(",")[0]}
            </button>;})}
          </div>
        </div>;})}
      </div>
      <div className="card">
        <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Package → Auto CC</div>
        <div style={{fontSize:12,color:"#888",marginBottom:14}}>When an action belongs to a package, selected people are automatically CC-ed.</div>
        {packages.map(pkg=>{const ccs=pkgrules[pkg]||[];return <div key={pkg} style={{marginBottom:12,padding:"10px 12px",borderRadius:10,border:"1.5px solid #e8e6df",background:"#fafaf8"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{padding:"3px 10px",borderRadius:20,background:"#f0ede6",color:"#555",fontSize:12,fontWeight:700}}>📦 {pkg}</span>
            {ccs.length>0&&<span style={{fontSize:11,color:"#2e7d32",fontWeight:600}}>→ CC: {ccs.map(p=>p.split(",")[0]).join(", ")}</span>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {people.map(p=>{const on=ccs.includes(p);const c=ownerColor(p);return <button key={p} onClick={()=>togglePkgRule(pkg,p)}
              style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(on?c.accent:"#ddd"),background:on?c.bg:"#fff",color:on?c.accent:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              {on?"✓ ":""}{p.split(",")[0]}
            </button>;})}
          </div>
        </div>;})}
      </div>
    </div>}

    {tab==="pkg-owners"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📦 Package Owners &amp; Subcontractors</div>
      <div style={{fontSize:12,color:"#888",marginBottom:10}}>Assign a default owner (auto-fills new tenders) and the subcontractor name for each package.</div>
      {(packages||[]).map(function(pkg){return <div key={pkg} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
        <div style={{flex:1,fontWeight:600,fontSize:13}}>{pkg}</div>
        <select value={(pkgOwners||{})[pkg]||""} onChange={function(e){var u=Object.assign({},pkgOwners||{});u[pkg]=e.target.value;savePkgOwners(u);}} style={{flex:2,padding:"4px 8px",fontSize:12,fontFamily:"inherit",border:"1px solid #e8e6df",borderRadius:6}}>
          <option value="">— no default owner —</option>
          {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
        </select>
        <input type="text" value={(pkgSubcontractors||{})[pkg]||""} onChange={function(e){var u=Object.assign({},pkgSubcontractors||{});u[pkg]=e.target.value;savePkgSubcontractors(u);}} placeholder="Subcontractor name" style={{flex:2,padding:"4px 8px",fontSize:12,fontFamily:"inherit",border:"1px solid #e8e6df",borderRadius:6}}/>
      </div>;})}
    </div>}
    {tab==="backup"&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>💾 Backup & Restore</div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Export</div>
        <div style={{fontSize:12,color:"#888",marginBottom:8}}>Download all your data as a JSON file. Keep it safe as a backup.</div>
        <button className="btn btn-gold" onClick={function(){
          var NL=String.fromCharCode(10);
          var now=new Date();
          var stamp=now.toISOString().slice(0,10);
          var json=JSON.stringify(Object.assign({},allData,{exportedAt:now.toISOString(),version:"1.0"}),null,2);
          var blob=new Blob([json],{type:"application/json"});
          var url=URL.createObjectURL(blob);
          var a=document.createElement("a");
          a.href=url;a.download="riviera-tower-backup-"+stamp+".json";
          document.body.appendChild(a);a.click();document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }}>📥 Download Backup</button>
      </div>
      <div style={{borderTop:"1px solid #f0ede6",paddingTop:16}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Restore</div>
        <div style={{fontSize:12,color:"#888",marginBottom:8}}>Upload a previously exported JSON file to restore your data. This will overwrite current data.</div>
        <label style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:7,border:"1.5px solid #e8e6df",background:"#fafaf8",cursor:"pointer",fontSize:12,fontWeight:600,color:"#555",textTransform:"none",letterSpacing:"normal"}}>
          📤 Upload Backup File
          <input type="file" accept=".json" style={{display:"none"}} onChange={function(e){
            var file=e.target.files&&e.target.files[0];
            if(!file)return;
            var reader=new FileReader();
            reader.onload=function(ev){
              try{
                var d=JSON.parse(ev.target.result);
                if(safeConfirm("This will replace all current data with the backup. Are you sure?")){
                  onImport(d);
                  alert("Data restored successfully!");
                }
              }catch(err){alert("Invalid backup file: "+err.message);}
            };
            reader.readAsText(file);
            e.target.value="";
          }}/>
        </label>
        <div style={{fontSize:11,color:"#c62828",marginTop:8}}>⚠️ Restore overwrites current data. Export first if needed.</div>
      </div>
    </div>}
    {tab==="my-prefs"&&<div className="card">
      {!isAdmin&&<div style={{padding:"8px 12px",background:"#fafaf8",border:"1px solid #e8e6df",borderRadius:8,marginBottom:12,fontSize:11,color:"#888"}}>
        Signed in as <strong>{window._currentUser?window._currentUser.name:"—"}</strong>. The ⏱ Durations tab is reserved for <strong>{APP_ADMIN}</strong>; if that should be you, make sure your name in Settings → People matches.
      </div>}
      <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>👤 My Preferences</div>
      <div style={{fontSize:12,color:"#888",marginBottom:16}}>Logged in as: <strong>{window._currentUser?window._currentUser.name:"—"}</strong></div>
      {window._currentUser&&<div>
        <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",textTransform:"none",letterSpacing:"normal",padding:"12px 14px",borderRadius:10,border:"1.5px solid #e8e6df",background:"#fafaf8"}}>
          <input type="checkbox"
            checked={!!((userPrefs||{})[window._currentUser.name]||{}).noPkgCC}
            onChange={function(e){
              var name=window._currentUser.name;
              var cur=Object.assign({},(userPrefs||{})[name]||{});
              cur.noPkgCC=e.target.checked;
              var updated=Object.assign({},userPrefs||{});
              updated[name]=cur;
              saveUserPrefs(updated);
              window._ppUserPrefs=updated;
            }}
            style={{width:16,height:16,marginTop:2,cursor:"pointer",flexShrink:0}}/>
          <div>
            <div style={{fontWeight:600,fontSize:13}}>Never receive CC notifications from package rules</div>
            <div style={{fontSize:11,color:"#888",marginTop:3}}>When checked, you will never appear as CC on any action — even if you are assigned as package owner in CC rules. Useful if you manage a package and do not need to be notified of your own tasks.</div>
          </div>
        </label>
        {((userPrefs||{})[window._currentUser.name]||{}).noPkgCC&&<div style={{marginTop:10,padding:"8px 12px",background:"#e8f5e9",borderRadius:8,fontSize:12,color:"#2e7d32",fontWeight:600}}>✅ You will never appear as CC from package rules.</div>}
      </div>}
    </div>}
    {tab==="improvements"&&<div className="card">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:14}}>💡 Improvement Register ({(improvements||[]).length})</div>
        <button className="btn btn-sm" onClick={function(){
          var NL=String.fromCharCode(10);
          var txt=(improvements||[]).map(function(imp){return "["+imp.date+"] ["+imp.page+"] "+imp.text;}).join(NL);
          navigator.clipboard.writeText(txt);
        }}>📋 Copy all</button>
      </div>
      {(improvements||[]).length===0
        ?<div style={{color:"#bbb",fontSize:13}}>No improvements recorded yet. Click the 💡 button on any page to add one.</div>
        :(improvements||[]).map(function(imp){return <div key={imp.id} style={{padding:"8px 12px",borderRadius:8,background:"#fffbf0",border:"1px solid #fed7aa",marginBottom:6,display:"flex",gap:8,alignItems:"flex-start"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13}}>{imp.text}</div>
            <div style={{fontSize:11,color:"#aaa",marginTop:3}}>📅 {imp.date} · 📍 {imp.page}</div>
          </div>
          <button onClick={function(){saveImprovements((improvements||[]).filter(function(x){return x.id!==imp.id;}));}}
            style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14,flexShrink:0}}
            onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}}
            onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
        </div>;})}
    </div>}
  </div>;
}
function safeConfirm(msg){try{return window.confirm(msg);}catch(e){return true;}}
function safeAlert(msg){try{window.alert(msg);}catch(e){}}
function calcProcurementUrgence(due){
  if(!due)return 1;
  var todayStr=today();
  if(due<todayStr)return 3;
  var todayD=new Date(todayStr);
  var dow=todayD.getDay();
  var monday=new Date(todayD);monday.setDate(todayD.getDate()-(dow===0?6:dow-1));
  var sunday=new Date(monday);sunday.setDate(monday.getDate()+6);
  var mondayStr=toISO(monday);
  var sundayStr=toISO(sunday);
  if(due>=mondayStr&&due<=sundayStr)return 3;
  if(!isValidDate(due))return 1;
  var diffDays=Math.round((new Date(due)-todayD)/(1000*60*60*24));
  if(diffDays<=14)return 2;
  return 1;
}
function addWorkingDays(dateStr,days){
  if(!isValidDate(dateStr))return"";
  var n=Number(days);
  if(!isFinite(n)||n<0||n>3650)return"";      // guards against a typo turning into an endless loop
  var d=new Date(dateStr);var added=0;
  while(added<n){d.setDate(d.getDate()+1);var dow=d.getDay();if(dow!==0&&dow!==6)added++;}
  return toISO(d);
}
function workingDaysDiff(dateStr1,dateStr2){
  if(!isValidDate(dateStr1)||!isValidDate(dateStr2))return 0;
  var d1=new Date(dateStr1);var d2=new Date(dateStr2);
  if(d1>=d2)return 0;
  return Math.round((d2-d1)/(1000*60*60*24));
}
function contractFinancials(ct){
  var base=Number(ct.amount)||0;
  var addTotal=(ct.addendums||[]).reduce(function(s,a){return s+Number(a.amount||0);},0);
  var total=base+addTotal;
  var certified=(ct.certifications||[]).reduce(function(s,cf){return s+Number(cf.amount||0);},0);
  var remaining=total-certified;
  var pct=total>0?Math.round(certified/total*100):0;
  var totalInstructed=Number(ct.instructionAmount||0)+(ct.addendums||[]).reduce(function(s,a){return s+Number(a.instructionAmount||0);},0);
  var forecast="";
  if(ct.startDate&&certified>0&&remaining>0){
    var start=new Date(ct.startDate);var now=new Date();
    var months=Math.max((now-start)/(1000*60*60*24*30),1);
    var burn=certified/months;
    if(burn>0){var fd=new Date(now.getTime()+(remaining/burn)*30*24*60*60*1000);forecast=toISO(fd);}
  }
  return{base,addTotal,total,certified,remaining,pct,totalInstructed,forecast};
}

function AwnView({awns,saveAwns,people}){
  const [showForm,setShowForm]=useState(false);
  const [form,setForm]=useState({number:"",date:today(),subject:"",description:"",type:"sent",replied:false,replyNumber:"",replyDate:"",replyDescription:""});
  const [filterType,setFilterType]=useState("all");
  const [filterReplied,setFilterReplied]=useState("all");
  const [q,setQ]=useState("");

  function fset(f,v){setForm(function(p){return Object.assign({},p,{[f]:v});});}

  var filtered=(awns||[]).filter(function(a){
    if(filterType!=="all"&&a.type!==filterType)return false;
    if(filterReplied==="yes"&&!a.replied)return false;
    if(filterReplied==="no"&&a.replied)return false;
    if(q){var lq=q.toLowerCase();if(!(a.number||"").toLowerCase().includes(lq)&&!(a.subject||"").toLowerCase().includes(lq))return false;}
    return true;
  }).sort(function(a,b){return b.date.localeCompare(a.date);});

  function saveForm(){
    saveAwns([Object.assign({id:uuid()},form),...(awns||[])]);
    setShowForm(false);
    setForm({number:"",date:today(),subject:"",description:"",type:"sent",replied:false,replyNumber:"",replyDate:"",replyDescription:""});
  }
  function del(id){if(safeConfirm("Delete AWN?"))saveAwns((awns||[]).filter(function(a){return a.id!==id;}));}
  function toggleReply(id){saveAwns((awns||[]).map(function(a){return a.id!==id?a:Object.assign({},a,{replied:!a.replied});}));}

  var pending=(awns||[]).filter(function(a){return !a.replied;}).length;

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Letters & AWN</div>
        <div className="page-sub">{(awns||[]).length} total · {pending} pending response</div>
      </div>
      <button className="btn btn-gold" onClick={function(){setShowForm(true);}}>+ New Entry</button>
    </div>

    {showForm&&<div className="card" style={{marginBottom:16,border:"1.5px solid #c9a84c"}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>New Letter / AWN</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1,minWidth:110}}><label>AWN # *</label><input type="text" value={form.number} onChange={function(e){fset("number",e.target.value);}} placeholder="AWN-001" autoFocus/></div>
        <div style={{flex:1,minWidth:130}}><label>Type</label>
          <select value={form.type} onChange={function(e){fset("type",e.target.value);}} style={{fontFamily:"inherit"}}>
            <option value="letter-sent">Letter sent to client</option><option value="letter-received">Letter received</option><option value="sent">AWN sent to client</option>
            <option value="letter-received">Letter received</option><option value="received">AWN received</option>
          </select>
        </div>
        <div style={{flex:1,minWidth:120}}><label>Date</label><input type="date" min="1990-01-01" max="2200-12-31" value={form.date} onChange={function(e){fset("date",e.target.value);}}/></div>
      </div>
      <div className="fg" style={{marginBottom:8}}><label>Subject *</label><input type="text" value={form.subject} onChange={function(e){fset("subject",e.target.value);}} placeholder="AWN subject..."/></div>
      <div className="fg" style={{marginBottom:8}}><label>Description</label><textarea value={form.description} onChange={function(e){fset("description",e.target.value);}} style={{minHeight:50}}/></div>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,marginBottom:8}}>
        <input type="checkbox" checked={form.replied} onChange={function(e){fset("replied",e.target.checked);}} style={{width:15,height:15}}/>
        Response received
      </label>
      {form.replied&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1}}><label>Response #</label><input type="text" value={form.replyNumber} onChange={function(e){fset("replyNumber",e.target.value);}}/></div>
        <div style={{flex:1}}><label>Response date</label><input type="date" min="1990-01-01" max="2200-12-31" value={form.replyDate} onChange={function(e){fset("replyDate",e.target.value);}}/></div>
        <div style={{flex:2}}><label>Response summary</label><input type="text" value={form.replyDescription} onChange={function(e){fset("replyDescription",e.target.value);}}/></div>
      </div>}
      <div style={{display:"flex",gap:6}}>
        <button className="btn" onClick={function(){setShowForm(false);}}>Cancel</button>
        <button className="btn btn-pri" disabled={!form.number.trim()||!form.subject.trim()} onClick={saveForm}>Save</button>
      </div>
    </div>}

    <div className="filter-bar">
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="Search AWN #, subject..." style={{width:200,padding:"5px 10px",fontSize:12}}/>
      <select value={filterType} onChange={function(e){setFilterType(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All types</option><option value="sent">Sent</option><option value="received">Received</option>
      </select>
      <select value={filterReplied} onChange={function(e){setFilterReplied(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All status</option><option value="no">Pending</option><option value="yes">Responded</option>
      </select>
      {(filterType!=="all"||filterReplied!=="all"||q)&&<button className="btn btn-sm" onClick={function(){setFilterType("all");setFilterReplied("all");setQ("");}}>Reset</button>}
    </div>

    {filtered.length===0?<div className="empty"><div className="empty-ico">⚠️</div><div className="empty-txt">No AWNs found.</div></div>
    :<table className="tbl">
      <thead><tr><th>AWN #</th><th>Type</th><th>Date</th><th>Subject</th><th>Status</th><th>Response</th><th></th></tr></thead>
      <tbody>{filtered.map(function(a){
        var isSent=a.type==="sent";
        return <tr key={a.id}>
          <td style={{fontWeight:700}}>{a.number}</td>
          <td><span className={"chip "+(isSent?"s-approved-a":"s-pending")} style={{fontSize:10}}>{isSent?"Sent":"Received"}</span></td>
          <td style={{fontSize:12,whiteSpace:"nowrap"}}>{fmtDate(a.date)}</td>
          <td style={{minWidth:180}}><div style={{fontWeight:500}}>{a.subject}</div>{a.description&&<div style={{fontSize:11,color:"#888"}}>{a.description}</div>}</td>
          <td>{a.replied?<span className="chip s-approved-a" style={{fontSize:10}}>Responded</span>:<span className="chip s-notdone" style={{fontSize:10,cursor:"pointer"}} onClick={function(){toggleReply(a.id);}}>Pending</span>}</td>
          <td style={{fontSize:11}}>{a.replied&&<div><div style={{fontWeight:600}}>{a.replyNumber}</div><div style={{color:"#888"}}>{fmtDate(a.replyDate)}</div><div style={{color:"#555"}}>{a.replyDescription}</div></div>}</td>
          <td><button onClick={function(){del(a.id);}} className="btn btn-sm btn-danger" style={{padding:"2px 6px"}}>🗑</button></td>
        </tr>;
      })}</tbody>
    </table>}
  </div>;
}

function WeeklyView({tasks,trackers,people,tags,tagrules,pkgrules,packages,tenders,contractors}){
  const [selPeople,setSelPeople]=useState([]);
  const [selTags,setSelTags]=useState([]);
  const [copied,setCopied]=useState(false);

  var allActions=(tasks||[]).map(function(t){return Object.assign({},t,{_src:"task"});});
  (trackers||[]).forEach(function(tr){(tr.actions||[]).forEach(function(a){allActions.push(Object.assign({},a,{_src:"tracker",_srcTitle:tr.title}));});});

  var relevant=allActions.filter(function(a){
    if(a.isInfo)return false;
    if(a.status==="done"||a.status==="blocked")return false;
    var ccs=getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});
    var allInvolved=[a.owner||""].concat(ccs);
    if(selPeople.length>0&&!selPeople.some(function(p){return allInvolved.includes(p);}))return false;
    if(selTags.length>0&&!(a.tags||[]).some(function(t){return selTags.includes(t);}))return false;
    return true;
  }).sort(function(a,b){
    var sa=calcScore(a.importance||1,a.urgence||1);
    var sb=calcScore(b.importance||1,b.urgence||1);
    return sb-sa;
  });

  function buildReport(){
    var NL=String.fromCharCode(10);
    var now=new Date();
    var weekStr="Week of "+now.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
    var lines=["PROJECT PILOT — WEEKLY ACTION REPORT","=".repeat(50),weekStr,""];

    var high=relevant.filter(function(a){return calcScore(a.importance||1,a.urgence||1)>=7;});
    var mid=relevant.filter(function(a){var s=calcScore(a.importance||1,a.urgence||1);return s>=4&&s<7;});
    var low=relevant.filter(function(a){return calcScore(a.importance||1,a.urgence||1)<4;});
    var categories=[{label:"HIGH PRIORITY - Score 7 to 9",items:high},{label:"MEDIUM PRIORITY - Score 4 to 6",items:mid},{label:"STANDARD - Score 1 to 3",items:low}];

    function formatAction(a){
      var sc=calcScore(a.importance||1,a.urgence||1);
      var scoreStr="[Score "+sc+"]";
      var owner=a.owner?"@"+a.owner.split(",")[0]:"";
      var due=a.due?"due "+fmtDate(a.due):"";
      var ccs=getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});
      var ccStr=ccs.length>0?" cc:"+ccs.map(function(p){return "@"+p.split(",")[0];}).join(" "):"";
      var tags=(a.tags||[]).length>0?" ["+a.tags.join(",")+"]":"";
      return "  "+scoreStr+" "+a.text+" — "+owner+(due?" "+due:"")+(a.package?" ("+a.package+")":"")+ccStr+tags;
    }

    if(high.length>0){lines.push("HIGH PRIORITY - Score 7 to 9 ("+high.length+")");lines.push("-".repeat(40));high.forEach(function(a){lines.push(formatAction(a));});lines.push("");}
    if(mid.length>0){lines.push("MEDIUM PRIORITY - Score 4 to 6 ("+mid.length+")");lines.push("-".repeat(40));mid.forEach(function(a){lines.push(formatAction(a));});lines.push("");}
    if(low.length>0){lines.push("LOW PRIORITY ("+low.length+")");lines.push("-".repeat(40));low.forEach(function(a){lines.push(formatAction(a));});lines.push("");}

    lines.push("=".repeat(50));
    lines.push("Total: "+relevant.length+" actions pending");
    lines.push("Generated: "+now.toLocaleDateString("en-GB")+" at "+now.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}));
    return lines.join(NL);
  }

  function copyReport(){
    navigator.clipboard.writeText(buildReport());
    setCopied(true);
    setTimeout(function(){setCopied(false);},2000);
  }

  var isFriday=new Date().getDay()===5;

  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">Weekly Report</div>
        <div className="page-sub">{relevant.length} actions · {isFriday?<span style={{color:"#2e7d32",fontWeight:700}}>Today is Friday — time to send!</span>:<span style={{color:"#888"}}>To be prepared every Friday at 17:00</span>}</div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn btn-gold" onClick={copyReport}>{copied?"✅ Copied!":"📋 Copy report"}</button>
      </div>
    </div>

    <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
      <div style={{flex:2,minWidth:200}}>
        <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:6}}>Filter by person</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {(people||[]).map(function(p){var on=selPeople.includes(p);var col=ownerColor(p);return <button key={p} onClick={function(){setSelPeople(function(prev){return prev.includes(p)?prev.filter(function(x){return x!==p;}):[...prev,p];});}} style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(on?col.accent:"#ddd"),background:on?col.bg:"#fff",color:on?col.accent:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{p.split(",")[0]}</button>;})}
        </div>
      </div>
      <div style={{flex:1,minWidth:160}}>
        <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:6}}>Filter by tag</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {(tags||[]).map(function(t){var on=selTags.includes(t);var tc=tagColor(t);return <button key={t} onClick={function(){setSelTags(function(prev){return prev.includes(t)?prev.filter(function(x){return x!==t;}):[...prev,t];});}} style={{padding:"3px 10px",borderRadius:20,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{t}</button>;})}
        </div>
      </div>
    </div>

    {(selPeople.length>0||selTags.length>0)&&<button className="btn btn-sm" style={{marginBottom:10}} onClick={function(){setSelPeople([]);setSelTags([]);}}>✕ Reset filters</button>}

    <div className="card" style={{background:"#fafaf8"}}>
      <pre style={{fontFamily:"Arial,sans-serif",fontSize:12,lineHeight:1.7,whiteSpace:"pre-wrap",color:"#1a1a1a",margin:0}}>{buildReport()}</pre>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Duplicate finder.
// Procurement raises an action on a tender; the zone leader writes the same thing
// again in their own list. Both are real objects, so nothing catches it — until the
// same job is chased twice and closed once.
// ---------------------------------------------------------------------------
function findDuplicateActions(tasks,threshold){
  var open=(tasks||[]).filter(function(t){return t.status!=="done"&&(t.text||"").trim().length>6;});
  var pairs=[];
  for(var i=0;i<open.length;i++){
    for(var j=i+1;j<open.length;j++){
      var a=open[i],b=open[j];
      var sim=textSimilarity(a.text,b.text);
      if(sim<threshold)continue;
      // Signals that raise confidence: same tender, same package, same zone, close due dates.
      var why=[];
      if(a.tenderRef&&a.tenderRef===b.tenderRef)why.push("same tender");
      if(a.package&&a.package===b.package)why.push("same package");
      if(a.zone&&a.zone===b.zone)why.push("same zone");
      if(a.scheduleRowRef&&a.scheduleRowRef===b.scheduleRowRef)why.push("same schedule task");
      if(a.due&&b.due&&Math.abs((new Date(a.due)-new Date(b.due))/86400000)<=7)why.push("due within a week");
      if((a.owner||"")!==(b.owner||""))why.push("different owners");
      var score=sim+(why.length*0.06);
      pairs.push({a:a,b:b,sim:sim,score:score,why:why});
    }
  }
  return pairs.sort(function(x,y){return y.score-x.score;});
}

function DuplicateFinder({tasks,saveTasks,tenders,onClose,canDelete}){
  const [threshold,setThreshold]=useState(0.45);
  const [dismissed,setDismissed]=useState({});
  var pairs=findDuplicateActions(tasks,threshold).filter(function(p){return !dismissed[p.a.id+"|"+p.b.id];});

  function tenderOf(t){var x=(tenders||[]).find(function(y){return y.id===t.tenderRef;});return x?x.title:"";}
  function keep(keepTask,dropTask){
    if(!canDelete){safeAlert("Merging is reserved for the app admin.");return;}
    if(!safeConfirm("Keep:\n  “"+keepTask.text+"”\n\nDelete:\n  “"+dropTask.text+"”\n\nThe kept action inherits the earliest due date and any tender, zone or room link the other one had. This cannot be undone."))return;
    var merged=Object.assign({},keepTask);
    if(dropTask.due&&(!merged.due||dropTask.due<merged.due))merged.due=dropTask.due;
    ["tenderRef","scheduleRowRef","package","zone"].forEach(function(f){if(!merged[f]&&dropTask[f])merged[f]=dropTask[f];});
    if(dropTask.blockedRooms&&!merged.blockedRooms)merged.blockedRooms=dropTask.blockedRooms;
    merged.tags=[...new Set([].concat(merged.tags||[],dropTask.tags||[]))];
    var note=(merged.note||"").trim();
    merged.note=(note?note+"\n":"")+"Merged with a duplicate raised by "+(dropTask.owner||"someone")+": “"+dropTask.text+"”";
    saveTasks((tasks||[]).map(function(t){return t.id===keepTask.id?stampModified(merged):t;}).filter(function(t){return t.id!==dropTask.id;}));
  }

  function Card({t,other}){
    return <div style={{flex:1,minWidth:0,border:"1.5px solid var(--rule,#ddd9cf)",borderRadius:8,padding:"10px 12px",background:"#fff"}}>
      <div style={{fontSize:13,lineHeight:1.4,marginBottom:6}}>{t.text}</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",fontSize:11,color:"var(--ink-3,#6f6b62)"}}>
        <span style={{fontWeight:600}}>{t.owner||"no owner"}</span>
        <span>{t.due?fmtDate(t.due):"no date"}</span>
        {t.zone&&<span className="badge" style={{background:"var(--blue-soft,#e8f0fe)",color:"var(--blue,#0f5299)"}}>🏢 {t.zone}</span>}
        {t.tenderRef&&<span className="badge" style={{background:"var(--gold-soft,#faf3e0)",color:"var(--gold-ink,#8a6a1e)"}}>🔗 {tenderOf(t)}</span>}
        {(t.tags||[]).indexOf("Blocking Point")>=0&&<span className="badge" style={{background:"var(--red-soft,#fbe6e8)",color:"var(--red,#b3302a)"}}>blocking</span>}
        {t.addedBy==="System"&&<span className="badge" style={{background:"#eee",color:"#777"}}>auto</span>}
      </div>
      <button className="btn btn-sm" style={{marginTop:9,width:"100%"}} disabled={!canDelete}
        onClick={function(){keep(t,other);}}>Keep this one</button>
    </div>;
  }

  return <div className="overlay" style={{zIndex:1400}} onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:820}}>
      <div className="modal-hdr">
        <div>
          <div className="modal-title">Duplicate finder</div>
          <div style={{fontSize:12,color:"var(--ink-3,#6f6b62)",marginTop:2}}>Open actions that look like the same job written twice</div>
        </div>
        <button className="btn btn-sm" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:600,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em"}}>Sensitivity</span>
          {[[0.6,"Strict"],[0.45,"Balanced"],[0.3,"Loose"]].map(function(o){
            return <button key={o[0]} className={"fchip"+(threshold===o[0]?" on":"")} onClick={function(){setThreshold(o[0]);}}>{o[1]}</button>;
          })}
          <span style={{fontSize:12,color:"var(--ink-3,#6f6b62)",marginLeft:"auto"}}>{pairs.length} pair{pairs.length!==1?"s":""} found</span>
        </div>

        {!canDelete&&<div style={{padding:"10px 12px",borderRadius:8,background:"var(--gold-soft,#faf3e0)",border:"1.5px solid #efe0b8",fontSize:12,color:"#8a6d1f",marginBottom:12}}>
          You can review the pairs, but merging is reserved for the app admin.
        </div>}

        {pairs.length===0&&<div className="empty"><div className="empty-ico">✅</div>
          <div className="empty-txt">No duplicate found at this sensitivity.{threshold>0.3?" Try a looser setting to catch reworded ones.":""}</div></div>}

        {pairs.slice(0,40).map(function(p){
          return <div key={p.a.id+"|"+p.b.id} style={{border:"1.5px solid var(--rule,#ddd9cf)",borderRadius:10,padding:12,marginBottom:10,background:"#faf9f7"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9,flexWrap:"wrap"}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:12,fontWeight:700,
                color:p.sim>=0.6?"var(--red,#b3302a)":"var(--amber,#b35c00)"}}>{Math.round(p.sim*100)}% alike</span>
              {p.why.map(function(w){return <span key={w} className="badge" style={{background:"#fff",color:"var(--ink-3,#6f6b62)",border:"1px solid var(--rule,#ddd9cf)"}}>{w}</span>;})}
              <button className="btn btn-sm" style={{marginLeft:"auto"}}
                onClick={function(){setDismissed(Object.assign({},dismissed,{[p.a.id+"|"+p.b.id]:1}));}}>Not a duplicate</button>
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <Card t={p.a} other={p.b}/>
              <Card t={p.b} other={p.a}/>
            </div>
          </div>;
        })}
        {pairs.length>40&&<div style={{fontSize:12,color:"var(--ink-3,#6f6b62)"}}>Showing the 40 most likely of {pairs.length}. Deal with these, then reopen.</div>}
      </div>
      <div className="modal-footer"><button className="btn" onClick={onClose}>Close</button></div>
    </div>
  </div>;
}

function GlobalView({tasks,trackers,tenders,contractors,people,packages,tags,saveTasks,saveTrackers,tagrules,pkgrules,jumpOwner,clearJump,onNavTender,memory,setMemory,peopleEmails,defaultCC,zones,actionsOnly,currentUser}){
  var mem=memory||{};
  const [fStatus,setFStatus]=useState(mem.fStatus||"all");
  const [fAddedBy,setFAddedBy]=useState(mem.fAddedBy||"all");
  const [preset,setPreset]=useState(mem.preset||"");
  // Actions-only users land pre-filtered on their own actions (they can clear it to see team context)
  const [fOwners,setFOwners]=useState(mem.fOwners!==undefined?mem.fOwners:(actionsOnly&&currentUser?[currentUser]:[]));
  useEffect(function(){if(jumpOwner){setFOwners([jumpOwner]);if(clearJump)clearJump();}},[jumpOwner]);
  const [fTags,setFTags]=useState(mem.fTags||[]);
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fTender,setFTender]=useState(mem.fTender||"all");
  const [fContractor,setFContractor]=useState(mem.fContractor||"all");
  const [fCC,setFCC]=useState(mem.fCC||"all");
  const [fScore,setFScore]=useState(mem.fScore||"all");
  const [showInfo,setShowInfo]=useState(mem.showInfo||false);
  const [sortBy,setSortBy]=useState(mem.sortBy||"none");
  const [sortDir,setSortDir]=useState(mem.sortDir||"asc");
  const [q,setQ]=useState(mem.q||"");
  const [editId,setEditId]=useState(null);
  const [showEmail,setShowEmail]=useState(false);
  const [showWeekly,setShowWeekly]=useState(false);
  const [showDupes,setShowDupes]=useState(false);
  const [selIds,setSelIds]=useState([]);
  const [bulkOwner,setBulkOwner]=useState("");
  const [bulkStatus,setBulkStatus]=useState("");
  const [bulkDue,setBulkDue]=useState("");
  useEffect(function(){if(setMemory)setMemory({fStatus:fStatus,fAddedBy:fAddedBy,preset:preset,fOwners:fOwners,fTags:fTags,fPkg:fPkg,fTender:fTender,fContractor:fContractor,fCC:fCC,fScore:fScore,showInfo:showInfo,sortBy:sortBy,sortDir:sortDir,q:q});},[fStatus,fAddedBy,preset,fOwners,fTags,fPkg,fTender,fContractor,fCC,fScore,showInfo,sortBy,sortDir,q]);

  const taskActions=(tasks||[]).map(function(t){return Object.assign({},t,{_source:"task",_sourceTitle:"Task",_sourceId:t.id});});
  const trackerActions=(trackers||[]).flatMap(function(tr){return (tr.actions||[]).map(function(a){return Object.assign({},a,{_source:"tracker",_sourceTitle:tr.title,_sourceId:tr.id});});});
  const allActions=[...taskActions,...trackerActions];

  const allOwners=[...new Set(allActions.map(function(a){return a.owner;}).filter(Boolean))].sort();
  const allPkgs=[...new Set(allActions.map(function(a){return a.package;}).filter(Boolean))].sort();
  const allCCs=[...new Set(allActions.flatMap(function(a){return getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});}))].filter(Boolean).sort();
  const allTendersUsed=[...new Set(allActions.map(function(a){return a.tenderRef;}).filter(Boolean))];

  function matchScore(a){
    if(fScore==="all")return true;
    var sc=calcScore(a.importance||1,a.urgence||1);
    if(fScore==="high")return sc>=7;
    if(fScore==="mid")return sc>=4&&sc<7;
    if(fScore==="low")return sc<4;
    return true;
  }

  var filtered=allActions.filter(function(a){
    if(fStatus==="all"&&a.status==="done")return false;
    if(fStatus!=="all"&&a.status!==fStatus)return false;
    if(!showInfo&&a.isInfo)return false;
    if(fOwners.length>0&&!fOwners.includes(a.owner||""))return false;
    if(fTags.length>0&&!(a.tags||[]).some(function(tg){return fTags.includes(tg);}))return false;
    if(fPkg!=="all"&&a.package!==fPkg)return false;
    if(fTender!=="all"&&a.tenderRef!==fTender)return false;
    if(fContractor!=="all"&&a.contractorRef!==fContractor)return false;
    if(fCC!=="all"){var ccs=getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});if(!ccs.includes(fCC))return false;}
    if(fAddedBy!=="all"){
      if(fAddedBy==="__team__"){if((a.addedBy||"")==="System"||(a.addedBy||"").startsWith("Email"))return false;}
      else if(fAddedBy==="__auto__"){if((a.addedBy||"")!=="System")return false;}
      else if((a.addedBy||"")!==fAddedBy)return false;
    }
    if(preset==="blocking"&&!(a.tags||[]).includes("Blocking Point"))return false;
    if(preset==="topmgmt"&&!(a.tags||[]).includes("Top Management"))return false;
    if(preset==="overdue"&&!(a.due&&a.due<today()&&a.status!=="done"))return false;
    if(!matchScore(a))return false;
    if(q){var lq=q.toLowerCase();if(![a.text,a.owner,a.package].some(function(s){return (s||"").toLowerCase().includes(lq);}))return false;}
    return true;
  });

  if(sortBy!=="none"){
    filtered=filtered.slice().sort(function(a,b){
      var r=0;
      if(sortBy==="owner"){r=(a.owner||"").localeCompare(b.owner||"");}
      else if(sortBy==="due"){r=((a.due||"9999")<(b.due||"9999")?-1:(a.due||"9999")>(b.due||"9999")?1:0);}
      else if(sortBy==="score"){var sa=calcScore(a.importance||1,a.urgence||1);var sb=calcScore(b.importance||1,b.urgence||1);r=sa-sb;}
      else if(sortBy==="tender"){var ta=(tenders||[]).find(function(t){return t.id===a.tenderRef;});var tb=(tenders||[]).find(function(t){return t.id===b.tenderRef;});r=((ta?ta.title:"")).localeCompare((tb?tb.title:""));}
      else if(sortBy==="status"){r=(a.status||"").localeCompare(b.status||"");}
      else if(sortBy==="package"){r=(a.package||"").localeCompare(b.package||"");}
      return sortDir==="asc"?r:-r;
    });
  }

  function toggleSort(col){
    if(sortBy===col){setSortDir(function(d){return d==="asc"?"desc":"asc";});}
    else{setSortBy(col);setSortDir("asc");}
  }
  function sortIcon(col){if(sortBy!==col)return " ↕";return sortDir==="asc"?" ↑":" ↓";}

  function updateField(a,field,val){
    if(a._source==="task"){
      saveTasks((tasks||[]).map(function(t){if(t.id!==a.id)return t;var u=Object.assign({},t);u[field]=val;return u;}));
    } else {
      saveTrackers((trackers||[]).map(function(tr){
        if(tr.id!==a._sourceId)return tr;
        return Object.assign({},tr,{actions:(tr.actions||[]).map(function(ac){if(ac.id!==a.id)return ac;var u=Object.assign({},ac);u[field]=val;return u;})});
      }));
    }
  }
  function updateMulti(a,fields){
    if(a._source==="task"){
      saveTasks((tasks||[]).map(function(t){if(t.id!==a.id)return t;return Object.assign({},t,fields);}));
    } else {
      saveTrackers((trackers||[]).map(function(tr){
        if(tr.id!==a._sourceId)return tr;
        return Object.assign({},tr,{actions:(tr.actions||[]).map(function(ac){if(ac.id!==a.id)return ac;return Object.assign({},ac,fields);})});
      }));
    }
  }

  // ---- Bulk edit -------------------------------------------------------
  function toggleSel(id){setSelIds(function(prev){return prev.includes(id)?prev.filter(function(x){return x!==id;}):[...prev,id];});}
  function clearSel(){setSelIds([]);setBulkOwner("");setBulkStatus("");setBulkDue("");}
  // Applies the same field changes to every selected action, in one save per collection
  function applyBulk(fields,label){
    var sel=allActions.filter(function(a){return selIds.includes(a.id);});
    if(sel.length===0)return;
    if(!safeConfirm(label+" for "+sel.length+" action"+(sel.length!==1?"s":"")+"?"))return;
    var selTaskIds=sel.filter(function(a){return a._source==="task";}).map(function(a){return a.id;});
    var selTrackerIds=sel.filter(function(a){return a._source==="tracker";}).map(function(a){return a.id;});
    if(selTaskIds.length>0){
      saveTasks((tasks||[]).map(function(t){return selTaskIds.includes(t.id)?stampModified(Object.assign({},t,fields)):t;}));
    }
    if(selTrackerIds.length>0){
      var parentIds=sel.filter(function(a){return a._source==="tracker";}).map(function(a){return a._sourceId;});
      saveTrackers((trackers||[]).map(function(tr){
        if(parentIds.indexOf(tr.id)===-1)return tr;
        return Object.assign({},tr,{actions:(tr.actions||[]).map(function(ac){return selTrackerIds.includes(ac.id)?Object.assign({},ac,fields):ac;})});
      }));
    }
    clearSel();
  }
  function bulkDelete(){
    var sel=allActions.filter(function(a){return selIds.includes(a.id);});
    if(sel.length===0)return;
    if(!safeConfirm("Delete "+sel.length+" action"+(sel.length!==1?"s":"")+"? This cannot be undone."))return;
    var selTaskIds=sel.filter(function(a){return a._source==="task";}).map(function(a){return a.id;});
    var selTrackerIds=sel.filter(function(a){return a._source==="tracker";}).map(function(a){return a.id;});
    if(selTaskIds.length>0)saveTasks((tasks||[]).filter(function(t){return!selTaskIds.includes(t.id);}));
    if(selTrackerIds.length>0){
      var parentIds2=sel.filter(function(a){return a._source==="tracker";}).map(function(a){return a._sourceId;});
      saveTrackers((trackers||[]).map(function(tr){
        if(parentIds2.indexOf(tr.id)===-1)return tr;
        return Object.assign({},tr,{actions:(tr.actions||[]).filter(function(ac){return!selTrackerIds.includes(ac.id);})});
      }));
    }
    clearSel();
  }

  function buildEmail(){
    var now=new Date();
    var todayStr=now.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
    var subject="Global Action View — "+todayStr;
    if(fOwners.length===1)subject="Actions @"+fOwners[0].split(",")[0]+" — "+todayStr;
    else if(fOwners.length>1)subject="Actions ("+fOwners.length+" owners) — "+todayStr;
    else if(fCC!=="all")subject="CC "+fCC.split(",")[0]+" Actions — "+todayStr;
    var NL=String.fromCharCode(10);
    var realActions=filtered.filter(function(a){return !a.isInfo;});
    var pendingCount=realActions.filter(function(a){return a.status!=="done";}).length;
    var doneCount=realActions.filter(function(a){return a.status==="done";}).length;

    var lines=[];
    lines.push("ACTIONS REPORT");
    lines.push(now.toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}));
    lines.push("");
    lines.push(realActions.length+" action"+(realActions.length!==1?"s":"")+" - "+doneCount+" done - "+pendingCount+" pending");
    lines.push("");

    var CAT_ORDER=["Blocking Point","Prerequisite","Top Management",...(tags||[]).filter(function(t){return t!=="Blocking Point"&&t!=="Prerequisite"&&t!=="Top Management";})];
    var groups2={};
    realActions.forEach(function(a){
      var tg=a.tags||[];
      var cat=tg.indexOf("Prerequisite")>=0?"Prerequisite":tg.indexOf("Blocking Point")>=0?"Blocking Point":(CAT_ORDER.find(function(c){return tg.indexOf(c)>=0;})||"General");
      if(!groups2[cat])groups2[cat]=[];
      groups2[cat].push(a);
    });
    var orderedCats2=[...CAT_ORDER.filter(function(c){return groups2[c];}),...(groups2["General"]?["General"]:[])];

    orderedCats2.forEach(function(cat){
      var items=groups2[cat];
      lines.push(cat.toUpperCase()+" — "+items.length+" item"+(items.length!==1?"s":""));
      lines.push("-".repeat(40));
      items.forEach(function(a){
        var isBlocking=(a.tags||[]).includes("Blocking Point");
        var mark=isBlocking?"[BLOCKING] ":"    ["+(a.status||"pending").toUpperCase()+"] ";
        var owner=a.owner?" — "+a.owner.split(",")[0]:"";
        var due="";
        if(a.due){
          var isLate=a.due<today()&&a.status!=="done";
          due=" — due "+fmtDate(a.due)+(isLate?" (late)":"");
        }
        var ccs=getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});
        var ccStr=ccs.length>0?" — cc "+ccs.map(function(p){return p.split(",")[0];}).join(", "):"";
        var tr=a.tenderRef?(tenders||[]).find(function(t){return t.id===a.tenderRef;}):null;
        var trStr=tr?" — "+tr.title:"";
        lines.push(mark+a.text+owner+due+ccStr+trStr);
      });
      lines.push("");
    });

    lines.push("Generated automatically — Riviera Tower Project Pilot");
    var body=lines.join(NL);

    // Resolve recipients: owners of the filtered actions (To) + defaultCC people (Cc)
    var ownerNames=[...new Set(filtered.map(function(a){return a.owner;}).filter(Boolean))];
    var missing=[];
    var to=ownerNames.map(function(n){var em2=(peopleEmails||{})[n];if(!em2)missing.push(n);return em2;}).filter(Boolean);
    var cc=(defaultCC||[]).map(function(n){var em2=(peopleEmails||{})[n];if(!em2)missing.push(n);return em2;}).filter(Boolean);
    return{subject,body,to,cc,missing};
  }

  // Weekly team report: everything overdue + everything targeted this week (Mon-Sun), grouped by owner.
  // Ignores current screen filters on purpose — this is the full team picture for the week.
  function buildWeeklyReport(){
    var NL=String.fromCharCode(10);
    var now=new Date();
    var todayStr=today();
    var dow=now.getDay();
    var monday=new Date(now);monday.setDate(now.getDate()-(dow===0?6:dow-1));
    var sunday=new Date(monday);sunday.setDate(monday.getDate()+6);
    var mondayStr=toISO(monday);
    var sundayStr=toISO(sunday);

    var scope=allActions.filter(function(a){
      if(a.isInfo||a.status==="done")return false;
      if(!a.due)return false;
      if(a.due<todayStr)return true;               // overdue
      return a.due>=mondayStr&&a.due<=sundayStr;   // due this week
    });

    var subject="Weekly Actions — week of "+fmtDate(mondayStr);
    var lines=[];
    lines.push("WEEKLY ACTIONS REPORT");
    lines.push("Week of "+fmtDate(mondayStr)+" to "+fmtDate(sundayStr));
    lines.push("");

    var overdueList=scope.filter(function(a){return a.due<todayStr;});
    var thisWeekList=scope.filter(function(a){return a.due>=todayStr;});
    lines.push(scope.length+" action"+(scope.length!==1?"s":"")+" to close this week - "+overdueList.length+" overdue - "+thisWeekList.length+" due this week");
    lines.push("");

    // Group by owner so each person immediately finds their own lines
    var byOwner={};
    scope.forEach(function(a){
      var key=a.owner||"UNASSIGNED";
      if(!byOwner[key])byOwner[key]=[];
      byOwner[key].push(a);
    });
    var ownerKeys=Object.keys(byOwner).sort(function(a,b){
      if(a==="UNASSIGNED")return 1;
      if(b==="UNASSIGNED")return -1;
      return a.localeCompare(b);
    });

    ownerKeys.forEach(function(k){
      var items=byOwner[k].slice().sort(function(a,b){return(a.due||"").localeCompare(b.due||"");});
      var lateCount=items.filter(function(a){return a.due<todayStr;}).length;
      lines.push((k==="UNASSIGNED"?"UNASSIGNED":k.split(",")[0].toUpperCase())+" — "+items.length+" item"+(items.length!==1?"s":"")+(lateCount>0?" ("+lateCount+" overdue)":""));
      lines.push("-".repeat(40));
      items.forEach(function(a){
        var isLate=a.due<todayStr;
        var isBlocking=(a.tags||[]).includes("Blocking Point");
        var mark=isBlocking?"[BLOCKING] ":isLate?"[OVERDUE] ":"    ";
        var due=" — due "+fmtDate(a.due)+(isLate?" (late "+workingDaysDiff(a.due,todayStr)+"d)":"");
        var ctx=[];
        if(a.package)ctx.push(a.package);
        if(a.zone)ctx.push(a.zone);
        var ctxStr=ctx.length?" ["+ctx.join(" / ")+"]":"";
        lines.push(mark+a.text+due+ctxStr);
      });
      lines.push("");
    });

    lines.push("Generated automatically — Riviera Tower Project Pilot");
    var body=lines.join(NL);

    // Recipients: every owner appearing in the report + default CC
    var ownerNames2=ownerKeys.filter(function(k){return k!=="UNASSIGNED";});
    var missing2=[];
    var to2=ownerNames2.map(function(n){var em2=(peopleEmails||{})[n];if(!em2)missing2.push(n);return em2;}).filter(Boolean);
    var cc2=(defaultCC||[]).map(function(n){var em2=(peopleEmails||{})[n];if(!em2)missing2.push(n);return em2;}).filter(Boolean);
    return{subject:subject,body:body,to:to2,cc:cc2,missing:missing2};
  }

  var pending=filtered.filter(function(a){return a.status==="pending";}).length;
  var inprog=filtered.filter(function(a){return a.status==="in progress";}).length;
  var done=allActions.filter(function(a){return a.status==="done";}).length;

  return <div>
    {showDupes&&<DuplicateFinder tasks={tasks} saveTasks={saveTasks} tenders={tenders}
      canDelete={isAppAdmin(currentUser||(window._currentUser?window._currentUser.name:""))}
      onClose={function(){setShowDupes(false);}}/>}
    <div className="page-hdr">
      <div>
        <div className="page-title">Actions</div>
        <div className="page-sub">{filtered.length} actions · {pending} pending · {inprog} in progress · {done} done (hidden — filter by status to view)</div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {(function(){
          var dupes=findDuplicateActions(tasks,0.45).length;
          return <button className={"btn"+(dupes>0?" btn-danger":"")} onClick={function(){setShowDupes(true);}}
            title="Find open actions that look like the same job written twice — typically procurement and the zone raising it separately">
            🔍 Duplicates{dupes>0?" ("+dupes+")":""}</button>;
        })()}
        <button className="btn btn-gold" onClick={function(){setShowWeekly(true);}}>📅 Report for the week</button>
        {filtered.length>0&&<button className="btn btn-gold" onClick={function(){setShowEmail(true);}}>📧 Email</button>}
      </div>
    </div>

    {showEmail&&<EmailModal em={buildEmail()} onClose={function(){setShowEmail(false);}}/>}
    {showWeekly&&<EmailModal em={buildWeeklyReport()} onClose={function(){setShowWeekly(false);}}/>}

    {actionsOnly&&<div style={{marginBottom:10,padding:"8px 12px",background:"#f0f8ff",border:"1px solid #bbdefb",borderRadius:8,fontSize:12,color:"#1565c0",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <span>👤 Showing <strong>your actions</strong> by default.</span>
      {fOwners.length>0&&<button className="btn btn-sm" onClick={function(){setFOwners([]);}}>Show all team actions</button>}
      {fOwners.length===0&&<button className="btn btn-sm" onClick={function(){setFOwners([currentUser]);}}>Back to my actions only</button>}
    </div>}

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
      <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Quick:</span>
      {[
        {k:"blocking",label:"🔴 Blocking",activeBg:"#fce4ec",activeColor:"#c62828"},
        {k:"topmgmt",label:"👔 Top Mgmt",activeBg:"#ede7f6",activeColor:"#5e35b1"},
        {k:"overdue",label:"⚠️ Overdue",activeBg:"#fff3e0",activeColor:"#e65100"}
      ].map(function(p){
        var on=preset===p.k;
        return <button key={p.k} onClick={function(){setPreset(on?"":p.k);}} style={{padding:"3px 11px",borderRadius:20,border:"1.5px solid "+(on?p.activeColor:"#ddd"),background:on?p.activeBg:"#fff",color:on?p.activeColor:"#888",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{p.label}</button>;
      })}
      <span style={{width:1,height:18,background:"#e0ddd6",margin:"0 4px"}}></span>
      <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Added by:</span>
      <select value={fAddedBy} onChange={function(e){setFAddedBy(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">Everyone</option>
        <option value="__team__">✍️ Team (manual)</option>
        <option value="__auto__">🤖 Auto (System)</option>
        {[...new Set(allActions.map(function(a){return a.addedBy;}).filter(function(x){return x&&x!=="System"&&!x.startsWith("Email");}))].sort().map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search…" style={{width:160,padding:"5px 10px",fontSize:12}}/>
      <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All status</option>
        {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
      </select>
      <select value={fPkg} onChange={function(e){
        var newPkg=e.target.value;
        setFPkg(newPkg);
        if(fTender!=="all"&&newPkg!=="all"){var td=(tenders||[]).find(function(t){return t.id===fTender;});if(td&&td.package!==newPkg)setFTender("all");}
        if(fContractor!=="all"&&newPkg!=="all"){var ctr=(contractors||[]).find(function(c){return c.id===fContractor;});if(ctr&&ctr.package!==newPkg&&!(ctr.contracts||[]).some(function(ct){return ct.package===newPkg;}))setFContractor("all");}
      }} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All packages</option>
        {allPkgs.map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      <select value={fTender} onChange={function(e){setFTender(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All tenders</option>
        {(tenders||[]).filter(function(t){
          if(fPkg==="all")return true;
          return t.package===fPkg;
        }).slice().sort(function(a,b){return (a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
      </select>
      <select value={fContractor} onChange={function(e){setFContractor(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All subcontractors</option>
        {(contractors||[]).filter(function(ctr){
          if(fPkg==="all")return true;
          return ctr.package===fPkg||(ctr.contracts||[]).some(function(ct){return ct.package===fPkg;});
        }).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(c){return <option key={c.id} value={c.id}>{c.name}</option>;})}
      </select>
      <select value={fCC} onChange={function(e){setFCC(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All CC</option>
        {allCCs.map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
      <select value={fScore} onChange={function(e){setFScore(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All scores</option>
        <option value="high">🔴 High (7-9)</option>
        <option value="mid">🟠 Medium (4-6)</option>
        <option value="low">Low (1-3)</option>
      </select>
    </div>
    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
      <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Owners:</span>
      {allOwners.map(function(o){var on=fOwners.includes(o);var col=ownerColor(o);return <button key={o} onClick={function(){setFOwners(function(prev){return prev.includes(o)?prev.filter(function(x){return x!==o;}):[...prev,o];});}} style={{padding:"2px 9px",borderRadius:20,border:"1.5px solid "+(on?col.accent:"#ddd"),background:on?col.bg:"#fff",color:on?col.accent:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{o.split(",")[0]}</button>;})}
      <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginLeft:8}}>Tags:</span>
      {(tags||[]).map(function(tg){var on=fTags.includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){setFTags(function(prev){return prev.includes(tg)?prev.filter(function(x){return x!==tg;}):[...prev,tg];});}} style={{padding:"2px 9px",borderRadius:20,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
      <button onClick={function(){setShowInfo(!showInfo);}} style={{padding:"3px 10px",borderRadius:10,border:"1.5px solid "+(showInfo?"#1565c0":"#ddd"),background:showInfo?"#e3f2fd":"#fff",color:showInfo?"#1565c0":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>ℹ️ Info</button>
      {(fStatus!=="all"||fOwners.length>0||fTags.length>0||fPkg!=="all"||fTender!=="all"||fContractor!=="all"||fCC!=="all"||fScore!=="all"||q||preset||fAddedBy!=="all")&&
        <button className="btn btn-sm" style={{marginLeft:8}} onClick={function(){setFStatus("all");setFOwners([]);setFTags([]);setFPkg("all");setFTender("all");setFContractor("all");setFCC("all");setFScore("all");setQ("");setPreset("");setFAddedBy("all");}}>✕ Reset all</button>}
    </div>

    {selIds.length>0&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:"10px 14px",background:"#1c1c1e",borderRadius:10,marginBottom:10,position:"sticky",top:0,zIndex:40}}>
      <span style={{color:"#fff",fontWeight:700,fontSize:13}}>{selIds.length} selected</span>
      <button className="btn btn-sm" onClick={clearSel} style={{background:"transparent",color:"#bbb",border:"1px solid #444"}}>✕ Clear</button>
      <span style={{width:1,height:20,background:"#444"}}></span>

      <select value={bulkOwner} onChange={function(e){setBulkOwner(e.target.value);}} style={{padding:"4px 8px",fontSize:11,borderRadius:6,border:"none",fontFamily:"inherit",width:"auto"}}>
        <option value="">Change owner…</option>
        <option value="__none__">— Remove owner —</option>
        {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
      {bulkOwner&&<button className="btn btn-sm btn-gold" onClick={function(){applyBulk({owner:bulkOwner==="__none__"?"":bulkOwner},"Change owner to "+(bulkOwner==="__none__"?"nobody":bulkOwner.split(",")[0]));}}>Apply</button>}

      <select value={bulkStatus} onChange={function(e){setBulkStatus(e.target.value);}} style={{padding:"4px 8px",fontSize:11,borderRadius:6,border:"none",fontFamily:"inherit",width:"auto"}}>
        <option value="">Change status…</option>
        {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
      </select>
      {bulkStatus&&<button className="btn btn-sm btn-gold" onClick={function(){applyBulk({status:bulkStatus,completedAt:bulkStatus==="done"?today():""},"Set status to "+bulkStatus);}}>Apply</button>}

      <input type="date" min="1990-01-01" max="2200-12-31" value={bulkDue} onChange={function(e){setBulkDue(e.target.value);}} style={{padding:"4px 8px",fontSize:11,borderRadius:6,border:"none",width:"auto"}}/>
      {bulkDue&&<button className="btn btn-sm btn-gold" onClick={function(){applyBulk({due:bulkDue},"Set due date to "+fmtDate(bulkDue));}}>Apply</button>}

      <span style={{width:1,height:20,background:"#444"}}></span>
      <button className="btn btn-sm btn-danger" onClick={bulkDelete}>🗑 Delete</button>
    </div>}

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">🔍</div><div className="empty-txt">No actions match the filters.</div></div>
      :<div style={{overflowX:"auto"}}>
        <table className="tbl">
          <thead><tr>
            <th style={{width:30,textAlign:"center"}}>
              <input type="checkbox"
                checked={filtered.length>0&&filtered.every(function(a){return selIds.includes(a.id);})}
                onChange={function(e){setSelIds(e.target.checked?filtered.map(function(a){return a.id;}):[]);}}
                style={{width:14,height:14,cursor:"pointer"}} title="Select all visible"/>
            </th>
            <th>Action</th>
            <th className="sortable" onClick={function(){toggleSort("status");}}>Status{sortIcon("status")}</th>
            <th className="sortable" onClick={function(){toggleSort("owner");}}>Owner{sortIcon("owner")}</th>
            <th className="sortable" onClick={function(){toggleSort("package");}}>Package{sortIcon("package")}</th>
            <th className="sortable" onClick={function(){toggleSort("due");}}>Due{sortIcon("due")}</th>
            <th className="sortable" onClick={function(){toggleSort("score");}}>Score{sortIcon("score")}</th>
            <th>Source</th>
            <th className="sortable" onClick={function(){toggleSort("tender");}}>Tender{sortIcon("tender")}</th>
          </tr></thead>
          <tbody>{filtered.map(function(a,idx){
            var sc=calcScore(a.importance||1,a.urgence||1);
            var ss=scoreStyle(sc);
            var tdr=a.tenderRef?(tenders||[]).find(function(t){return t.id===a.tenderRef;}):null;
            var ctr=a.contractorRef?(contractors||[]).find(function(c){return c.id===a.contractorRef;}):null;
            var ccs=getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});
            var isEdit=editId===a.id;
            var isSel=selIds.includes(a.id);
            return <tr key={a.id||idx} style={{background:isSel?"#fffdf0":isEdit?"#f8f9ff":"transparent",verticalAlign:"top"}}>
              <td style={{width:30,textAlign:"center"}} onClick={function(e){e.stopPropagation();}}>
                <input type="checkbox" checked={isSel} onChange={function(){toggleSel(a.id);}} style={{width:14,height:14,cursor:"pointer",marginTop:6}}/>
              </td>
              <td style={{minWidth:220}}>
                {isEdit
                  ?<div style={{display:"flex",flexDirection:"column",gap:5,padding:"4px 0"}}>
                    <textarea value={a.text||""} autoFocus onChange={function(e){updateField(a,"text",e.target.value);}} style={{width:"100%",padding:"5px 8px",border:"1.5px solid #3949ab",borderRadius:6,fontFamily:"inherit",fontSize:12,resize:"vertical",outline:"none",minHeight:50,boxSizing:"border-box"}}/>
                    <textarea value={a.note||a.details||""} onChange={function(e){updateField(a,a._source==="task"?"note":"details",e.target.value);}} placeholder="Notes..." style={{width:"100%",padding:"4px 8px",border:"1.5px solid #ddd",borderRadius:6,fontFamily:"inherit",fontSize:11,resize:"vertical",outline:"none",minHeight:30,boxSizing:"border-box"}}/>
                    <div style={{marginTop:4}}>
                      {(a.links||[]).map(function(lk,li){return <div key={li} style={{display:"flex",gap:4,marginBottom:3,alignItems:"center"}}>
                        <input type="text" value={lk.label||""} onChange={function(e){var ls=(a.links||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{label:e.target.value});});updateField(a,"links",ls);}} placeholder="Label" style={{width:90,padding:"2px 5px",fontSize:10,border:"1px solid #ddd",borderRadius:4}}/>
                        <input type="url" value={lk.url||""} onChange={function(e){var ls=(a.links||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{url:e.target.value});});updateField(a,"links",ls);}} placeholder="https://..." style={{flex:1,padding:"2px 5px",fontSize:10,border:"1px solid #ddd",borderRadius:4}}/>
                        <button onClick={function(){updateField(a,"links",(a.links||[]).filter(function(_,j){return j!==li;}));}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:11}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>✕</button>
                      </div>;})}
                      <button onClick={function(){updateField(a,"links",[...(a.links||[]),{label:"",url:""}]);}} style={{fontSize:10,padding:"1px 7px",border:"1px solid #ddd",borderRadius:4,background:"#fafaf8",fontFamily:"inherit",cursor:"pointer"}}>＋ link</button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:3}}>{(tags||[]).map(function(tg){var on=(a.tags||[]).includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){var cur=a.tags||[];updateField(a,"tags",on?cur.filter(function(x){return x!==tg;}):[...cur,tg]);}} style={{padding:"2px 7px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
                    </div>
                    <button className="btn btn-sm btn-pri" style={{alignSelf:"flex-start"}} onClick={function(){setEditId(null);}}>✓ Done</button>
                  </div>
                  :<div style={{cursor:"pointer"}} onClick={function(){setEditId(a.id);}}>
                    <div style={{fontWeight:500,fontSize:13,color:a.status==="done"?"#bbb":"#1a1a1a",textDecoration:a.status==="done"?"line-through":"none"}}>{a.text}</div>
                    {(a.note||a.details)&&<div style={{fontSize:11,color:"#888",fontStyle:"italic",marginTop:2}}>{a.note||a.details}</div>}
                    {(a.tags||[]).length>0&&<div style={{marginTop:3,display:"flex",gap:3,flexWrap:"wrap"}}>{(a.tags||[]).map(function(tg){return <TagChip key={tg} tag={tg}/>;})}</div>}
                    {(a.links||[]).length>0&&<div style={{marginTop:3,display:"flex",gap:4,flexWrap:"wrap"}}>{(a.links||[]).map(function(lk,li){return lk.url?<a key={li} href={lk.url} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{fontSize:10,color:"#3949ab",textDecoration:"none",padding:"1px 6px",borderRadius:5,background:"#f0f0ff",border:"1px solid #d0d0f0"}}>🔗 {lk.label||"link"}</a>:null;})}</div>}
                    {ccs.length>0&&<div style={{marginTop:3,display:"flex",gap:3,flexWrap:"wrap"}}>{ccs.map(function(p,i){return <span key={p} style={{fontSize:10,padding:"1px 6px",borderRadius:20,background:"#e8f5e9",color:"#2e7d32",fontWeight:700,border:"1px solid #c8e6c9"}}>CC {p.split(",")[0]}</span>;})}</div>}
                    <div style={{fontSize:9,color:"#ddd",marginTop:2}}>✏️ click to edit</div>
                  </div>}
              </td>
              <td>
                <select className="btn btn-sm" value={a.status||"pending"} onChange={function(e){updateField(a,"status",e.target.value);}} style={{width:"auto",padding:"3px 6px",fontSize:10,border:"1px solid #ddd"}}>
                  {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
                </select>
              </td>
              <td>
                {isEdit
                  ?<select value={a.owner||""} onChange={function(e){updateField(a,"owner",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit"}}>
                    <option value="">—</option>{(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
                  </select>
                  :<span>{a.owner&&<OwnerChip owner={a.owner}/>}</span>}
              </td>
              <td>
                {isEdit
                  ?<div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <select value={a.package||""} onChange={function(e){updateField(a,"package",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit"}}>
                      <option value="">— package —</option>{(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
                    </select>
                    <select value={a.zone||""} onChange={function(e){updateField(a,"zone",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit",color:a.zone?"#7b1fa2":"inherit",fontWeight:a.zone?700:400}}>
                      <option value="">📍 — zone —</option>{(zones||[]).map(function(z){return <option key={z} value={z}>📍 {z}</option>;})}
                    </select>
                  </div>
                  :<span>{a.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>{a.package}</span>}{a.zone&&<span className="badge" style={{background:"#f3e5f5",color:"#7b1fa2",fontSize:10,marginLeft:3}}>📍 {a.zone}</span>}</span>}
              </td>
              <td style={{whiteSpace:"nowrap"}}>
                {isEdit
                  ?<input type="date" min="1990-01-01" max="2200-12-31" value={a.due||""} onChange={function(e){updateField(a,"due",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd"}}/>
                  :<span style={{fontSize:12,color:a.due&&a.due<today()&&a.status!=="done"?"#c62828":"#888"}}>{fmtDate(a.due)}</span>}
              </td>
              <td>
                {isEdit
                  ?<div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <div style={{display:"flex",gap:3}}>
                      <span style={{fontSize:10,color:"#aaa"}}>I</span>{[1,2,3].map(function(v){return <button key={v} onClick={function(){updateField(a,"importance",v);}} style={{width:20,height:20,borderRadius:3,border:"1.5px solid "+((a.importance||1)===v?"#1c1c1e":"#ddd"),background:(a.importance||1)===v?"#1c1c1e":"#fff",color:(a.importance||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:9,cursor:"pointer",fontWeight:700}}>{v}</button>;})}
                    </div>
                    <div style={{display:"flex",gap:3}}>
                      <span style={{fontSize:10,color:"#aaa"}}>U</span>{[1,2,3].map(function(v){return <button key={v} onClick={function(){updateField(a,"urgence",v);}} style={{width:20,height:20,borderRadius:3,border:"1.5px solid "+((a.urgence||1)===v?"#1c1c1e":"#ddd"),background:(a.urgence||1)===v?"#1c1c1e":"#fff",color:(a.urgence||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:9,cursor:"pointer",fontWeight:700}}>{v}</button>;})}
                    </div>
                  </div>
                  :<span>{sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label}</span>}</span>}
              </td>
              <td><span className="badge" style={{background:"#f0ede6",color:"#666",fontSize:10}}>{a._source==="task"?"📋 Task":"📊 "+a._sourceTitle}</span></td>
              <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{a._source==="tracker"?<span className="badge" style={{background:"#e8f0fe",color:"#1a73e8",fontSize:10}}>📊 {a._sourceTitle}</span>:a.trackerRef?(trackers||[]).find(function(tr){return tr.id===a.trackerRef;})?<span className="badge" style={{background:"#e8f0fe",color:"#1a73e8",fontSize:10}}>📊 {((trackers||[]).find(function(tr){return tr.id===a.trackerRef;})||{}).title}</span>:null:null}</td>
              <td>
                {isEdit
                  ?<select value={a.tenderRef||""} onChange={function(e){updateField(a,"tenderRef",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit"}}>
                    <option value="">—</option>{(tenders||[]).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
                  </select>
                  :<span>{tdr&&(onNavTender?<button onClick={function(e){e.stopPropagation();onNavTender(tdr.id,"global");}} style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10,padding:"2px 8px",borderRadius:20,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>📑 {tdr.title}</button>:<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {tdr.title}</span>)}</span>}
              </td>
              <td style={{whiteSpace:"nowrap"}}>
                <div style={{display:"flex",gap:4}}>
                  <button className="btn btn-sm" onClick={function(){setEditId(isEdit?null:a.id);}} style={{padding:"3px 7px"}}>
                    {isEdit?"✓":"✏️"}
                  </button>
                  {a._source==="task"&&<button className="btn btn-sm btn-danger" onClick={function(){saveTasks((tasks||[]).filter(function(x){return x.id!==a.id;}));}} style={{padding:"3px 7px"}}>🗑</button>}
                </div>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </div>;
}

function WeeklyPopup({tasks,trackers,people,tenders,contractors,saveT,saveX,onClose}){

  var now=new Date();
  var dayOfWeek=now.getDay();// 0=Sun
  var monday=new Date(now);monday.setDate(now.getDate()-(dayOfWeek===0?6:dayOfWeek-1));monday.setHours(0,0,0,0);
  var saturday=new Date(monday);saturday.setDate(monday.getDate()+5);saturday.setHours(23,59,59,999);
  var monStr=toISO(monday);
  var satStr=toISO(saturday);
  var todayStr=today();
  var weekLabel=monday.toLocaleDateString("en-GB",{day:"2-digit",month:"long"})+" – "+saturday.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});

  var currentUserName=window._currentUser?window._currentUser.name:"";

  var allActions=[];
  (tasks||[]).forEach(function(t){if(!t.isInfo)allActions.push(Object.assign({},t,{_src:"task"}));});
  (trackers||[]).forEach(function(tr){(tr.actions||[]).forEach(function(a){if(!a.isInfo)allActions.push(Object.assign({},a,{_src:"tracker",_trId:tr.id}));});});

  var myActions=allActions.filter(function(a){
    if(a.status==="done"||a.status==="blocked")return false;
    if(!a.due)return false;
    if(currentUserName&&a.owner!==currentUserName)return false;
    return true;
  });

  var overdue=myActions.filter(function(a){return a.due<monStr;})
    .sort(function(a,b){return calcScore(b.importance||1,b.urgence||1)-calcScore(a.importance||1,a.urgence||1);});
  var thisWeek=myActions.filter(function(a){return a.due>=monStr&&a.due<=satStr;})
    .sort(function(a,b){return a.due.localeCompare(b.due)||calcScore(b.importance||1,b.urgence||1)-calcScore(a.importance||1,a.urgence||1);});
  var upcoming=myActions.filter(function(a){return a.due>satStr;})
    .sort(function(a,b){return a.due.localeCompare(b.due);});

  function changeStatus(a,val){
    if(a._src==="task"){saveT((tasks||[]).map(function(t){return t.id!==a.id?t:Object.assign({},t,{status:val});}));}
    else{saveX((trackers||[]).map(function(tr){if(tr.id!==a._trId)return tr;return Object.assign({},tr,{actions:(tr.actions||[]).map(function(ac){return ac.id!==a.id?ac:Object.assign({},ac,{status:val});})});}));}
  }

  function ActionRow({a,showDate}){
    var sc=calcScore(a.importance||1,a.urgence||1);var ss=scoreStyle(sc);
    var ctr2=a.contractorRef?(contractors||[]).find(function(c){return c.id===a.contractorRef;}):null;
    var tdr2=a.tenderRef?(tenders||[]).find(function(t){return t.id===a.tenderRef;}):null;
    var isOverdue=a.due&&a.due<todayStr;
    return <div style={{display:"flex",gap:8,alignItems:"flex-start",padding:"7px 8px",borderRadius:7,background:isOverdue?"#fff9f9":"#fafaf8",border:"1px solid "+(isOverdue?"#fcc":"#f0ede6"),marginBottom:4}}>
      <select value={a.status||"pending"} onChange={function(e){changeStatus(a,e.target.value);}} style={{fontSize:10,padding:"2px 3px",border:"1px solid #e0ddd8",borderRadius:5,fontFamily:"inherit",cursor:"pointer",flexShrink:0,width:90}}>
        {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
      </select>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:500,color:"#1a1a1a",lineHeight:1.3,marginBottom:2}}>{a.text}</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
          {showDate&&<span style={{fontSize:10,fontWeight:700,color:isOverdue?"#c62828":"#f57f17"}}>📅 {fmtDate(a.due)}{isOverdue?" ⚠️":""}</span>}
          {a.package&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:5,background:"#f0ede6",color:"#666"}}>{a.package}</span>}
          {tdr2&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:5,background:"#fff8f0",color:"#b45309"}}>📑 {tdr2.title}</span>}
          {ctr2&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:5,background:"#e8f0fe",color:"#1a73e8"}}>🤝 {ctr2.name}</span>}
          {sc>1&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:5,background:ss.bg,color:ss.color,fontWeight:700}}>{sc}</span>}
        </div>
      </div>
    </div>;
  }

  function Section({label,color,items,showDate}){
    if(items.length===0)return null;
    return <div style={{marginBottom:16}}>
      <div style={{fontWeight:800,fontSize:11,color:color,textTransform:"uppercase",letterSpacing:".6px",marginBottom:6,paddingBottom:4,borderBottom:"2px solid "+color,display:"flex",justifyContent:"space-between"}}>
        <span>{label}</span><span style={{fontWeight:400,color:"#aaa",fontSize:10}}>({items.length})</span>
      </div>
      {items.map(function(a){return <ActionRow key={a.id} a={a} showDate={showDate}/>;} )}
    </div>;
  }

  return <div className="overlay" style={{zIndex:700}} onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"#fff",borderRadius:16,width:"88vw",maxWidth:580,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 48px rgba(0,0,0,.2)"}}>
      <div style={{background:"#1c1c1e",borderRadius:"16px 16px 0 0",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontWeight:700,fontFamily:"var(--font-display)",fontSize:15,color:"#f97316",letterSpacing:"1px"}}>📋 My Week</div>
          <div style={{fontSize:11,color:"#888",marginTop:2}}>{weekLabel} · {currentUserName||"All users"}</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#888",lineHeight:1,padding:"0 4px"}}>×</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        {myActions.length===0
          ?<div style={{textAlign:"center",padding:"32px 0",color:"#bbb"}}>
            <div style={{fontSize:40,marginBottom:8}}>✅</div>
            <div style={{fontSize:14}}>No scheduled actions for this week!</div>
            {!currentUserName&&<div style={{fontSize:12,color:"#aaa",marginTop:4}}>Log in to see your personal actions.</div>}
          </div>
          :<div>
            <Section label="⚠️ Overdue" color="#c62828" items={overdue} showDate={true}/>
            <Section label={"This week ("+monStr.slice(5).replace("-","/")+"-"+satStr.slice(5).replace("-","/")+")"}color="#f57f17" items={thisWeek} showDate={true}/>
            <Section label="Upcoming" color="#aaa" items={upcoming} showDate={true}/>
          </div>}
      </div>
      <div style={{padding:"10px 20px",borderTop:"1px solid #f0ede6",display:"flex",justifyContent:"flex-end",flexShrink:0}}>
        <button className="btn btn-pri" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}

function simpleHash(str){
  var hash=0;
  for(var i=0;i<str.length;i++){hash=((hash<<5)-hash)+str.charCodeAt(i);hash|=0;}
  return Math.abs(hash).toString(36);
}

function UserLogin({people,onLogin}){
  const [step,setStep]=useState("pick");
  const [selName,setSelName]=useState("");
  const [pin,setPin]=useState("");
  const [newPin,setNewPin]=useState("");
  const [newPin2,setNewPin2]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [pins,setPins]=useState({});

  useEffect(function(){

    if(window._db){
      window._db.get(KEYS_PINS).then(function(data){
        if(data)setPins(data);
      }).catch(function(){});
    }
  },[]);

  function savePinToDb(name,pinVal){
    var updated=Object.assign({},pins);
    updated[name]=simpleHash(name+pinVal);
    setPins(updated);
    if(window._db)window._db.set(KEYS_PINS,updated);
  }

  function pickPerson(name){
    setSelName(name);setError("");setPin("");
    if(pins[name]){setStep("pin");}
    else{setStep("newpin");}
  }

  function checkPin(pinVal){
    var hashed=simpleHash(selName+pinVal);
    if(hashed===pins[selName]){
      window._currentUser={name:selName};
      try{localStorage.setItem("pp_current_user",selName);}catch(e){}
      onLogin(selName);
    } else {
      setError("Wrong PIN. Try again.");
      setPin("");
    }
  }

  function handlePinDigit(k){
    if(k==="⌫"){setPin(function(p){return p.slice(0,-1);});setError("");return;}
    if(k===""||pin.length>=4)return;
    var np=pin+k;
    setPin(np);
    if(np.length===4){setTimeout(function(){checkPin(np);},100);}
  }

  function setNewPinFn(){
    if(newPin.length!==4||!/^[0-9]{4}$/.test(newPin)){setError("PIN must be 4 digits.");return;}
    if(newPin!==newPin2){setError("PINs do not match.");return;}
    setLoading(true);
    savePinToDb(selName,newPin);
    window._currentUser={name:selName};
    try{localStorage.setItem("pp_current_user",selName);}catch(e){}
    onLogin(selName);
  }

  return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#1c1c1e"}}>
    <div style={{marginBottom:24,textAlign:"center"}}>
      <div style={{fontWeight:700,color:"#f97316",fontSize:20,letterSpacing:"2px",fontFamily:"var(--font-display)",marginBottom:2}}>RIVIERA TOWER TRACKER</div>
      <div style={{fontWeight:700,color:"#f97316",fontSize:13,letterSpacing:"1.5px",fontFamily:"var(--font-display)"}}>MAGIC TEAM</div>
    </div>
    <div style={{background:"#fff",borderRadius:16,padding:"28px 32px",width:340,boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
      {step==="pick"&&<div>
        <div style={{fontWeight:700,fontFamily:"var(--font-display)",fontSize:18,marginBottom:4}}>Who are you?</div>
        <div style={{fontSize:12,color:"#888",marginBottom:18}}>Select your name to continue</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:340,overflowY:"auto"}}>
          {(people||[]).slice().sort().map(function(p){var shortName=p.split(",")[0];return <button key={p} onClick={function(){pickPerson(p);}} style={{padding:"10px 14px",borderRadius:8,border:"1.5px solid #e8e6df",background:"#fafaf8",fontFamily:"inherit",fontSize:13,fontWeight:500,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:8}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#c9a84c";e.currentTarget.style.background="#fffbf0";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#e8e6df";e.currentTarget.style.background="#fafaf8";}}>
            <span style={{width:28,height:28,borderRadius:"50%",background:"#f0ede6",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,flexShrink:0}}>{shortName[0]}</span>
            {shortName}
            {pins[p]?<span style={{marginLeft:"auto",fontSize:10,color:"#aaa"}}>🔒 PIN set</span>:<span style={{marginLeft:"auto",fontSize:10,color:"#c9a84c",fontWeight:600}}>new</span>}
          </button>;})}
        </div>
      </div>}

      {step==="pin"&&<div>
        <div style={{fontWeight:700,fontFamily:"var(--font-display)",fontSize:18,marginBottom:2}}>Hello, {selName.split(",")[0]}</div>
        <div style={{fontSize:12,color:"#888",marginBottom:18}}>Enter your 4-digit PIN</div>
        {error&&<div style={{padding:"6px 10px",background:"#fce4ec",borderRadius:7,color:"#c62828",fontSize:12,marginBottom:12}}>{error}</div>}
        <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:20}}>
          {[0,1,2,3].map(function(i){return <div key={i} style={{width:44,height:52,border:"2px solid "+(pin.length>i?"#c9a84c":"#e8e6df"),borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#1c1c1e"}}>{pin[i]?"●":""}</div>;} )}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(function(k,i){return <button key={i} onClick={function(){handlePinDigit(String(k));}} disabled={k===""} style={{padding:"13px",borderRadius:8,border:"1.5px solid "+(k===""?"transparent":"#e8e6df"),background:k===""?"transparent":"#fafaf8",fontFamily:"inherit",fontSize:17,fontWeight:600,cursor:k===""?"default":"pointer",color:"#1c1c1e",opacity:k===""?0:1}}>{k}</button>;})}
        </div>
        <button onClick={function(){setStep("pick");setPin("");setError("");}} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:12,fontFamily:"inherit",width:"100%",textAlign:"center"}}>← Back</button>
      </div>}

      {step==="newpin"&&<div>
        <div style={{fontWeight:700,fontFamily:"var(--font-display)",fontSize:18,marginBottom:2}}>Hi, {selName.split(",")[0]}!</div>
        <div style={{fontSize:12,color:"#888",marginBottom:16}}>First time? Choose your PIN</div>
        <div style={{padding:"8px 12px",background:"#e8f5e9",borderRadius:7,fontSize:11,color:"#2e7d32",marginBottom:12}}>Your PIN will be stored securely and required next time.</div>
        {error&&<div style={{padding:"6px 10px",background:"#fce4ec",borderRadius:7,color:"#c62828",fontSize:12,marginBottom:10}}>{error}</div>}
        <div className="fg" style={{marginBottom:10}}>
          <label>Choose PIN (4 digits)</label>
          <input type="password" maxLength={4} value={newPin} onChange={function(e){setNewPin(e.target.value.replace(/[^0-9]/g,""));}} placeholder="••••" style={{fontSize:22,letterSpacing:10,textAlign:"center"}}/>
        </div>
        <div className="fg" style={{marginBottom:16}}>
          <label>Confirm PIN</label>
          <input type="password" maxLength={4} value={newPin2} onChange={function(e){setNewPin2(e.target.value.replace(/[^0-9]/g,""));}} placeholder="••••" style={{fontSize:22,letterSpacing:10,textAlign:"center"}} onKeyDown={function(e){if(e.key==="Enter")setNewPinFn();}}/>
        </div>
        <button className="btn btn-pri" onClick={setNewPinFn} disabled={loading} style={{width:"100%",justifyContent:"center",padding:"10px"}}>{loading?"Saving...":"Set PIN & Continue"}</button>
        <button onClick={function(){setStep("pick");setNewPin("");setNewPin2("");setError("");}} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:12,fontFamily:"inherit",width:"100%",textAlign:"center",marginTop:8}}>← Back</button>
      </div>}
    </div>
    <div style={{marginTop:12,fontSize:11,color:"#555",textAlign:"center"}}>PINs are stored securely in the shared database.<br/>Only you know your PIN.</div>
  </div>;
}

function MyProcurementView({myPkgs,myTenders,tenders,tasks,onNavTender}){
  var grouped=myPkgs.map(function(pkg){
    var pkgTenders=myTenders.filter(function(t){return t.package===pkg;});
    var openActions=(tasks||[]).filter(function(t){return t.package===pkg&&t.status!=="done"&&!t.isInfo;}).length;
    return{pkg:pkg,tenders:pkgTenders,openActions:openActions};
  });
  var orphanTenders=myTenders.filter(function(t){return!myPkgs.includes(t.package);});

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">📦 My Procurement</div>
        <div className="page-sub">Tenders and packages assigned to you</div>
      </div>
    </div>

    {grouped.length===0&&orphanTenders.length===0&&<div className="empty"><div className="empty-ico">📦</div><div className="empty-txt">No packages or tenders are assigned to you yet. Ask your project manager to set you as owner, or grant you package access in Settings → Access.</div></div>}

    {grouped.map(function(g){
      return <div key={g.pkg} className="card" style={{marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontWeight:700,fontSize:14}}>{g.pkg}</div>
          {g.openActions>0&&<span className="badge" style={{background:"#1c1c1e",color:"#fff"}}>{g.openActions} open action{g.openActions!==1?"s":""}</span>}
        </div>
        {g.tenders.length===0
          ?<div style={{fontSize:12,color:"#bbb"}}>No tenders yet in this package.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6}}>
            {g.tenders.map(function(t){
              return <div key={t.id} onClick={function(){if(onNavTender)onNavTender(t.id,"myprocurement");}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e8e6df",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:600}}>📑 {t.title}</span>
                <span style={{fontSize:11,color:"#aaa"}}>›</span>
              </div>;
            })}
          </div>}
      </div>;
    })}

    {orphanTenders.length>0&&<div className="card" style={{marginBottom:10}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Other tenders you own</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {orphanTenders.map(function(t){
          return <div key={t.id} onClick={function(){if(onNavTender)onNavTender(t.id,"myprocurement");}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e8e6df",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600}}>📑 {t.title}{t.package?" ("+t.package+")":""}</span>
            <span style={{fontSize:11,color:"#aaa"}}>›</span>
          </div>;
        })}
      </div>
    </div>}
  </div>;
}

function DocumentsView({tasks,tenders,contractors,packages,people,saveTasks,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [fTender,setFTender]=useState(mem.fTender||"all");
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fOwner,setFOwner]=useState(mem.fOwner||"all");
  const [fStage,setFStage]=useState(mem.fStage||"all");
  const [fStatus,setFStatus]=useState(mem.fStatus||"overdue");
  useEffect(function(){if(setMemory)setMemory({fTender:fTender,fPkg:fPkg,fOwner:fOwner,fStage:fStage,fStatus:fStatus});},[fTender,fPkg,fOwner,fStage,fStatus]);

  var STAGES=[
    {key:"rfi",label:"RFI",color:"#b45309",bg:"#fff8f0"},
    {key:"fcr",label:"FCR",color:"#8d6e63",bg:"#efebe9"},
    {key:"contract_acc",label:"Contract ACC",color:"#1a73e8",bg:"#e8f0fe"},
    {key:"contract_aconex",label:"Contract ACONEX",color:"#7b1fa2",bg:"#f3e5f5"},
    {key:"acc",label:"Tender ACC",color:"#1a73e8",bg:"#dce8ff"},
    {key:"itp",label:"ITP",color:"#2e7d32",bg:"#e8f5e9"},
    {key:"wms",label:"WMS",color:"#00838f",bg:"#e0f7fa"},
    {key:"mss",label:"MSS",color:"#1565c0",bg:"#e3f2fd"},
    {key:"mar",label:"MAR",color:"#6a1b9a",bg:"#f3e5f5"},
    {key:"sd_approval",label:"SD",color:"#00695c",bg:"#e0f2f1"}
  ];

  var docs=buildTrackedDocs(tasks,tenders,contractors);
  var todayStr=today();

  var filtered=docs.filter(function(d){
    if(fTender!=="all"&&d.tenderRef!==fTender)return false;
    if(fPkg!=="all"&&d.package!==fPkg)return false;
    if(fOwner!=="all"&&d.owner!==fOwner)return false;
    if(fStage!=="all"&&d.stage!==fStage)return false;
    if(fStatus==="overdue"&&!d.overdue)return false;
    if(fStatus==="ok"&&d.overdue)return false;
    return true;
  }).sort(function(a,b){
    if(a.overdue&&!b.overdue)return -1;
    if(!a.overdue&&b.overdue)return 1;
    return (b.daysOverdue-a.daysOverdue)||(a.dueDate||"").localeCompare(b.dueDate||"");
  });

  var overdueCount=docs.filter(function(d){return d.overdue;}).length;

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">⚠️ Overdue</div>
        <div className="page-sub">Overdue submissions by client — RFI, FCR, ACC/ACONEX, MAR, MSS, ITP, WMS, SD</div>
      </div>
      {overdueCount>0&&<div style={{padding:"8px 16px",background:"#fce4ec",border:"1.5px solid #f5c6cb",borderRadius:10,color:"#c62828",fontWeight:700,fontSize:13}}>
        ⚠️ {overdueCount} overdue
      </div>}
    </div>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1.5px solid "+(fStatus==="overdue"?"#c62828":"#e8e6df"),borderRadius:8,fontFamily:"inherit",color:fStatus==="overdue"?"#c62828":"#555",fontWeight:fStatus==="overdue"?700:400,background:fStatus==="overdue"?"#fce4ec":"#fff"}}>
        <option value="overdue">⚠️ Overdue only</option>
        <option value="all">All documents</option>
        <option value="ok">On track</option>
      </select>
      <select value={fStage} onChange={function(e){setFStage(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All stages</option>
        {STAGES.map(function(s){return <option key={s.key} value={s.key}>{s.label}</option>;})}
      </select>
      <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All packages</option>
        {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      <select value={fTender} onChange={function(e){setFTender(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All tenders</option>
        {(tenders||[]).slice().sort(function(a,b){return (a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
      </select>
      <select value={fOwner} onChange={function(e){setFOwner(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All owners</option>
        {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
      {(fTender!=="all"||fPkg!=="all"||fOwner!=="all"||fStage!=="all"||fStatus!=="overdue")&&
        <button className="btn btn-sm" onClick={function(){setFTender("all");setFPkg("all");setFOwner("all");setFStage("all");setFStatus("overdue");}}>✕ Reset</button>}
    </div>

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">✅</div><div className="empty-txt">{fStatus==="overdue"?"No overdue documents!":"No documents matching filters."}</div></div>
      :<div>

        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {STAGES.map(function(s){
            var cnt=docs.filter(function(d){return d.stage===s.key&&d.overdue;}).length;
            if(cnt===0)return null;
            return <div key={s.key} onClick={function(){setFStage(s.key);setFStatus("overdue");}} style={{padding:"6px 12px",borderRadius:8,background:s.bg,border:"1.5px solid "+s.color,cursor:"pointer",display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:13,color:s.color}}>{cnt}</span>
              <span style={{fontSize:11,color:s.color}}>{s.label}</span>
            </div>;
          })}
        </div>

        <div style={{background:"#fff",borderRadius:12,border:"1px solid #ede9e3",overflow:"hidden"}}>
          <table className="tbl" style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Document / Action</th>
                <th>Tender</th>
                <th>Package</th>
                <th>Owner</th>
                <th>Target → Due (+14d)</th>
                <th>Days overdue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(d){
                var stage=STAGES.find(function(s){return s.key===d.stage;})||{color:"#888",bg:"#f5f5f5",label:d.stage};
                return <tr key={d.id} style={{background:d.overdue?"#fffaf9":"#fff"}}>
                  <td><span style={{padding:"2px 8px",borderRadius:8,background:stage.bg,color:stage.color,fontWeight:700,fontSize:11}}>{stage.label}</span></td>
                  <td style={{maxWidth:300}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:d.tenderRef?"pointer":"default",color:d.tenderRef?"#1a1a1a":"#555"}} onClick={function(){if(d.tenderRef&&onNavTender)onNavTender(d.tenderRef,"documents");}}>{d.text}</div>
                    {d.submissionDate&&<div style={{fontSize:10,color:"#aaa"}}>Submitted: {fmtDate(d.submissionDate)}</div>}
                  </td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.tenderTitle&&d.tenderRef?<button onClick={function(){if(onNavTender)onNavTender(d.tenderRef,"documents");}} style={{background:"none",border:"none",cursor:"pointer",color:"#3949ab",fontSize:11,fontWeight:500,textDecoration:"underline",padding:0,fontFamily:"inherit"}}>{d.tenderTitle}</button>:<span style={{color:"#888"}}>{d.tenderTitle||"—"}</span>}</td>
                  <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{d.package||"—"}</td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.owner?(d.owner.split(",")[0]):"—"}</td>
                  <td style={{whiteSpace:"nowrap"}}>
                    {d.submissionDate&&<div style={{fontSize:11,color:"#888"}}>Submittal: {fmtDate(d.submissionDate)}</div>}
                    <div style={{fontSize:11,fontWeight:d.overdue?700:400,color:d.overdue?"#c62828":"#2e7d32"}}>+14d: {d.dueDate?fmtDate(d.dueDate):"—"}</div>
                  </td>
                  <td style={{textAlign:"center"}}>{d.overdue?<span style={{fontWeight:700,color:"#c62828",fontSize:12}}>+{d.daysOverdue}d</span>:<span style={{color:"#2e7d32",fontSize:11}}>✓</span>}</td>
                  <td><span style={{fontSize:11,padding:"2px 7px",borderRadius:8,background:d.status==="done"?"#e8f5e9":"#f5f5f5",color:d.status==="done"?"#2e7d32":"#888",fontWeight:600}}>{d.stepStatus||d.status}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

      </div>}
  </div>;
}

function KPICurveChart({kpi,weeks}){
  if(!weeks||weeks.length===0)return <div style={{padding:20,textAlign:"center",color:"#bbb",fontSize:12}}>No date range set.</div>;
  var W=680,H=220,padL=50,padR=16,padT=14,padB=28;
  var chartW=W-padL-padR,chartH=H-padT-padB;
  var maxVal=Math.max(Number(kpi.totalTarget)||0,...weeks.map(function(w){return w.actualCum;}),1);
  function xAt(i){return padL+(weeks.length<=1?0:(chartW*i/(weeks.length-1)));}
  function yAt(v){return padT+chartH-(chartH*v/maxVal);}
  var plannedPts=weeks.map(function(w,i){return xAt(i)+","+yAt(w.plannedCum);}).join(" ");
  var actualWeeks=weeks.filter(function(w){return w.isPast||w.isCurrent||(kpi.weeklyActuals||{})[w.monday]!==undefined;});
  var actualPts=actualWeeks.map(function(w){var i=weeks.indexOf(w);return xAt(i)+","+yAt(w.actualCum);}).join(" ");
  var gridLines=[0,0.25,0.5,0.75,1].map(function(f){return Math.round(maxVal*f);});

  return <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",marginBottom:14,background:"#fafaf8",borderRadius:8,border:"1px solid #e8e6df"}}>
    {gridLines.map(function(v,i){var y=yAt(v);return <g key={i}>
      <line x1={padL} y1={y} x2={W-padR} y2={y} stroke="#e8e6df" strokeWidth="1"/>
      <text x={padL-6} y={y+3} fontSize="9" fill="#aaa" textAnchor="end">{v.toLocaleString()}</text>
    </g>;})}
    {weeks.filter(function(w,i){return i%Math.ceil(weeks.length/8||1)===0||i===weeks.length-1;}).map(function(w){
      var i=weeks.indexOf(w);
      return <text key={w.monday} x={xAt(i)} y={H-8} fontSize="8" fill="#aaa" textAnchor="middle">{fmtDate(w.monday).slice(0,5)}</text>;
    })}
    <polyline points={plannedPts} fill="none" stroke="#c9a84c" strokeWidth="2" strokeDasharray="5,4"/>
    {actualPts&&<polyline points={actualPts} fill="none" stroke="#1a73e8" strokeWidth="2.5"/>}
    {actualWeeks.map(function(w){var i=weeks.indexOf(w);return <circle key={w.monday} cx={xAt(i)} cy={yAt(w.actualCum)} r="3" fill="#1a73e8"/>;})}
    <line x1={padL} y1={padT} x2={padL} y2={H-padB} stroke="#ccc" strokeWidth="1"/>
    <line x1={padL} y1={H-padB} x2={W-padR} y2={H-padB} stroke="#ccc" strokeWidth="1"/>
    <g transform={"translate("+(W-160)+",10)"}>
      <line x1="0" y1="4" x2="16" y2="4" stroke="#c9a84c" strokeWidth="2" strokeDasharray="5,4"/>
      <text x="20" y="8" fontSize="9" fill="#888">Planned</text>
      <line x1="80" y1="4" x2="96" y2="4" stroke="#1a73e8" strokeWidth="2.5"/>
      <text x="100" y="8" fontSize="9" fill="#888">Actual</text>
    </g>
  </svg>;
}

function NewTasksPopup({tasks,tenders,contractors,onClose}){
  return <div className="overlay" style={{zIndex:800}} onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"#fff",borderRadius:16,width:480,maxWidth:"92vw",maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:"0 16px 48px rgba(0,0,0,.25)"}}>
      <div style={{background:"#3949ab",borderRadius:"16px 16px 0 0",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontWeight:700,fontFamily:"var(--font-display)",fontSize:15,color:"#fff",letterSpacing:".5px"}}>🔔 New tasks assigned to you</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.6)",marginTop:2}}>Since your last visit · {tasks.length} action{tasks.length>1?"s":""}</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"rgba(255,255,255,.6)",lineHeight:1}}>×</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        {tasks.slice().sort(function(a,b){return calcScore(b.importance||1,b.urgence||1)-calcScore(a.importance||1,a.urgence||1);}).map(function(t){
          var sc=calcScore(t.importance||1,t.urgence||1);var ss=scoreStyle(sc);
          var tdr=t.tenderRef?(tenders||[]).find(function(x){return x.id===t.tenderRef;}):null;
          var ctr=t.contractorRef?(contractors||[]).find(function(x){return x.id===t.contractorRef;}):null;
          return <div key={t.id} style={{padding:"8px 10px",borderRadius:8,border:"1px solid #f0ede6",marginBottom:6,background:"#fafaf8"}}>
            <div style={{fontSize:12,fontWeight:500,marginBottom:3}}>{t.text}</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
              {t.due&&<span style={{fontSize:10,color:t.due<today()?"#c62828":"#888"}}>📅 {fmtDate(t.due)}</span>}
              {t.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>{t.package}</span>}
              {tdr&&<span style={{fontSize:10,color:"#b45309"}}>📑 {tdr.title}</span>}
              {ctr&&<span style={{fontSize:10,color:"#1a73e8"}}>🤝 {ctr.name}</span>}
              {sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label}</span>}
              {t.addedBy&&<span style={{fontSize:9,color:"#aaa"}}>by {t.addedBy.split(",")[0]}</span>}
            </div>
          </div>;
        })}
      </div>
      <div style={{padding:"12px 20px",borderTop:"1px solid #f0ede6",display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button className="btn btn-pri" onClick={onClose}>Got it 👍</button>
      </div>
    </div>
  </div>;
}

function App(){
  const [currentUser,setCurrentUser]=useState(function(){try{var u=localStorage.getItem("pp_current_user");return u||null;}catch(e){return null;}});
  const [view,setViewState]=useState(function(){try{return localStorage.getItem("pp_view")||"global";}catch(e){return "global";}});
  function setView(v){setViewState(v);try{localStorage.setItem("pp_view",v);}catch(e){}}
  const [jumpOwner,setJumpOwner]=useState(null);
  window._navToTender=navToTender;
  const [newTasksPopup,setNewTasksPopup]=useState(null);

  const [viewMemory,setViewMemory]=useState({});
  function memoryFor(key){return viewMemory[key]||{};}
  function setMemoryFor(key,patch){setViewMemory(function(prev){return Object.assign({},prev,{[key]:Object.assign({},prev[key]||{},patch)});});}
  const [jumpTender,setJumpTender]=useState(null);
  const [jumpFrom,setJumpFrom]=useState(null);
  function navToTender(tenderId,fromView){setJumpTender(tenderId);setJumpFrom(fromView||view);setView("tenders");}
  function navToContractor(ctrId,fromView){setJumpFrom(fromView||view);setView("contractors");}
  const [showWeeklyPopup,setShowWeeklyPopup]=useState(function(){var now=new Date();var isMonday=now.getDay()===1;var key="pp_weekly_shown_"+now.toISOString().slice(0,10);var shown=false;try{shown=!!localStorage.getItem(key);}catch(e){}if(isMonday&&!shown){try{localStorage.setItem(key,"1");}catch(e){}return true;}return false;});
  const [loaded,setLoaded]=useState(false);
  const [syncStatus,setSyncStatus]=useState("ok");

  const [tasks,setTasks]=useState([]);
  const [trackers,setTrackers]=useState([]);
  const [tenders,setTenders]=useState([]);
  const [contractors,setContractors]=useState([]);
  const [people,setPeople]=useState(SEED_PEOPLE);
  const [packages,setPackages]=useState(SEED_PACKAGES);
  const [tags,setTags]=useState(SEED_TAGS);
  const [tagrules,setTagrules]=useState({});
  const [pkgrules,setPkgrules]=useState({});
  const [pkgOwners,setPkgOwners]=useState({});
  function savePkgOwners(d){setPkgOwners(d);sync(KEYS.pkgowners,d);}
  // "Every task of subcontractor X in zone Y belongs to tender Z" — saves retyping the same
  // link on dozens of schedule rows.
  const [tenderRules,setTenderRules]=useState([]);
  function saveTenderRules(d){setTenderRules(d);sync(KEYS.tenderrules,d);}
  const [pkgSubcontractors,setPkgSubcontractors]=useState({});
  function savePkgSubcontractors(d){setPkgSubcontractors(d);sync(KEYS.pkgsubcontractors,d);}
  const [peopleEmails,setPeopleEmails]=useState({});
  function savePeopleEmails(d){setPeopleEmails(d);sync(KEYS.peopleemails,d);}
  const [defaultCC,setDefaultCC]=useState([]);
  function saveDefaultCC(d){setDefaultCC(d);sync(KEYS.defaultcc,d);}
  const [peopleAccess,setPeopleAccess]=useState({});
  function savePeopleAccess(d){setPeopleAccess(d);sync(KEYS.peopleaccess,d);}
  const [durations,setDurations]=useState({});
  function saveDurations(d){setDurations(d);window._ppDurations=d;sync(KEYS.durations,d);}
  const [zones,setZones]=useState(SEED_ZONES);
  function saveZones(d){setZones(d);sync(KEYS.zones,d);}
  const [zoneOwners,setZoneOwners]=useState({});
  function saveZoneOwners(d){setZoneOwners(d);sync(KEYS.zoneowners,d);}
  // Project-wide subcontractor list (Settings > Subcontractors). Names from the
  // Subcontractors tab are merged in at read time so the list stays in sync.
  const [subList,setSubList]=useState([]);
  function saveSubList(d){setSubList(d);sync(KEYS.groups,d);}
  const [subColors,setSubColors]=useState({});
  function saveSubColors(d){setSubColors(d);sync(KEYS.pkgsubcontractors,d);}
  const [rooms,setRooms]=useState([]);
  const saveRooms=d=>{setRooms(d);sync(KEYS_ROOMS,d);};
  const [kpis,setKpis]=useState([]);
  const saveKpis=d=>{setKpis(d);sync(KEYS_KPIS,d);};
  const [meetings,setMeetings]=useState([]);
  const saveMeetings=d=>{setMeetings(d);sync(KEYS_MEETINGS,d);};
  const [moms,setMoms]=useState([]);
  const saveMoms=d=>{setMoms(d);sync(KEYS_MOMS,d);};
  // Which grouped nav entry is expanded. Declared here with the other hooks: App has an
  // early "if(!loaded) return" further down, so any hook after it would be skipped on the
  // first render and appear on the next — React error #310.
  const [navGroup,setNavGroup]=useState("");
  const [schedules,setSchedules]=useState([]);
  const saveSchedules=d=>{setSchedules(d);sync(KEYS_SCHEDULES,d);};
  const [pdfGlobal,setPdfGlobal]=useState(null);
  const [sidebarOpen,setSidebarOpen]=useState(true);
  const [mobileQAOpen,setMobileQAOpen]=useState(false);
  const [correspondences,setCorrespondences]=useState([]);
  const [awns,setAwns]=useState([]);
  function saveAwns(d){setAwns(d);sync(KEYS_AWN,d);}
  function saveCorrespondences(d){setCorrespondences(d);sync(KEYS_CORR,d);}
  const [userPrefs,setUserPrefs]=useState({});
  function saveUserPrefs(d){setUserPrefs(d);sync(KEYS_PREFS,d);}

  const [improvements,setImprovements]=useState([]);
  function saveImprovements(d){setImprovements(d);sync(KEYS_IMP,d);}
  const [apiKey,setApiKey]=useState(function(){try{return localStorage.getItem('pp_apikey')||'';}catch(e){return '';}});
  function saveApiKey(k){setApiKey(k);try{localStorage.setItem('pp_apikey',k);}catch(e){}}

  const sync=useCallback(async(key,val)=>{
    setSyncStatus("syncing");
    try{await cloudStore.set(key,val);setSyncStatus("ok");}
    catch(e){setSyncStatus("err");}
  },[]);

  const mergeSync=useCallback(async(key,localVal,idField)=>{
    setSyncStatus("syncing");
    try{
      if(!idField){

        await cloudStore.set(key,localVal);
      } else {

        var remote=await cloudStore.get(key)||[];
        var localIds=new Set((localVal||[]).map(function(x){return x[idField];}));

        var remoteOnly=remote.filter(function(x){return !localIds.has(x[idField]);});

        var merged=[...(localVal||[]),...remoteOnly];
        await cloudStore.set(key,merged);

        if(remoteOnly.length>0){
          if(key===KEYS.tasks)setTasks(merged);
          else if(key===KEYS.trackers)setTrackers(merged);
          else if(key===KEYS.tenders)setTenders(merged);
          else if(key===KEYS.contractors)setContractors(merged);
        }
      }
      setSyncStatus("ok");
    }
    catch(e){console.error("Merge sync error",e);setSyncStatus("err");}
  },[]);

  const saveT=d=>{setTasks(d);sync(KEYS.tasks,d);};
  const saveX=d=>{setTrackers(d);sync(KEYS.trackers,d);};
  const saveTenders=d=>{setTenders(d);sync(KEYS.tenders,d);};

  // A tender's "start on site" is not typed by hand: it is the start week of the earliest
  // task linked to that tender, across every zone schedule. Kept in sync automatically.
  useEffect(function(){
    if(!schedules||!tenders||tenders.length===0)return;
    var earliest={};
    schedules.forEach(function(sc){
      (sc.rows||[]).forEach(function(r){
        if(!r.tenderRef||!r.startWeek)return;
        if(!earliest[r.tenderRef]||r.startWeek<earliest[r.tenderRef])earliest[r.tenderRef]=r.startWeek;
      });
    });
    var changed=false;
    var next=tenders.map(function(t){
      var e=earliest[t.id];
      if(!e||t.startOnSite===e)return t;
      changed=true;
      return Object.assign({},t,{startOnSite:e});
    });
    if(changed)saveTenders(next);
  },[schedules,tenders]);
  const saveContractors=d=>{setContractors(d);sync(KEYS.contractors,d);};
  const savePeople=d=>{setPeople(d);sync(KEYS.people,d);};
  const savePackages=d=>{setPackages(d);sync(KEYS.packages,d);};
  const saveTags=d=>{setTags(d);sync(KEYS.tags,d);};
  const saveTagrules=d=>{setTagrules(d);sync(KEYS.tagrules,d);};
  const savePkgrules=d=>{setPkgrules(d);sync(KEYS.pkgrules,d);};

  useEffect(()=>{
    const load=async()=>{
      // These outlive the try block so the migration passes below can use the loaded data
      var loadedTasks=[],loadedRooms=[],loadedScheds=[];
      try{
        const [t,x,td,ct,p,pk,g,tr,pr,imp,corr,awn,pko,prefs,zn,rm,pkgsub,pemail,dcc,kp,pacc,mtg,zown,sched,durs]=await Promise.all([
          cloudStore.get(KEYS.tasks),cloudStore.get(KEYS.trackers),cloudStore.get(KEYS.tenders),
          cloudStore.get(KEYS.contractors),cloudStore.get(KEYS.people),cloudStore.get(KEYS.packages),
          cloudStore.get(KEYS.tags),cloudStore.get(KEYS.tagrules),cloudStore.get(KEYS.pkgrules),cloudStore.get(KEYS_IMP),cloudStore.get(KEYS_CORR),cloudStore.get(KEYS_AWN),cloudStore.get(KEYS.pkgowners),cloudStore.get(KEYS_PREFS),cloudStore.get(KEYS.zones),cloudStore.get(KEYS_ROOMS),cloudStore.get(KEYS.pkgsubcontractors),cloudStore.get(KEYS.peopleemails),cloudStore.get(KEYS.defaultcc),cloudStore.get(KEYS_KPIS),cloudStore.get(KEYS.peopleaccess),cloudStore.get(KEYS_MEETINGS),cloudStore.get(KEYS.zoneowners),cloudStore.get(KEYS_SCHEDULES),cloudStore.get(KEYS.durations)
        ]);
        loadedTasks=t||[];loadedRooms=rm||[];loadedScheds=sched||[];
        if(t){setTasks(t);}
        else{

          const oldTasks=await cloudStore.get("tasks");
          if(oldTasks&&oldTasks.length){
            const migrated=oldTasks.map(t=>newTask({id:t.id,text:t.text||"",owner:t.owner||"",package:t.package||"",status:t.status||"pending",importance:t.importance||1,urgence:t.urgence||1,due:t.due||"",note:t.note||"",tags:t.tags||[],createdAt:t.createdAt||today()}));
            setTasks(migrated);sync(KEYS.tasks,migrated);
          }
        }
        if(x){setTrackers(x);}
        else{

          const oldRecords=await cloudStore.get("records");
          const oldTrackers=await cloudStore.get("trackers");
          const migratedTrackers=[];
          if(oldRecords&&oldRecords.length){
            oldRecords.forEach(r=>{
              const actions=(r.packages||[]).flatMap(pkg=>(pkg.actions||[]).map(a=>newTrackerAction({id:a.id,text:a.text||"",owner:pkg.owner||a.owner||"",package:pkg.name||"",status:a.status||"pending",importance:a.importance||1,urgence:a.urgence||1,due:a.due||"",tags:a.tags||[],details:a.details||"",createdAt:r.date||today()})));
              migratedTrackers.push(newTracker({id:r.id,title:r.title||"Untitled",description:r.summary||"",createdAt:r.date||today(),actions}));
            });
          }
          if(oldTrackers&&oldTrackers.length){
            oldTrackers.forEach(tr=>{
              const actions=(tr.packages||[]).flatMap(pkg=>(pkg.actions||[]).map(a=>newTrackerAction({id:a.id,text:a.text||"",owner:pkg.owner||a.owner||"",package:pkg.name||"",status:a.status||"pending",importance:a.importance||1,urgence:a.urgence||1,due:a.due||"",tags:a.tags||[],details:a.details||"",createdAt:tr.createdAt||today()})));
              migratedTrackers.push(newTracker({id:tr.id,title:tr.title||"Untitled",description:tr.description||"",createdAt:tr.createdAt||today(),actions}));
            });
          }
          if(migratedTrackers.length){setTrackers(migratedTrackers);sync(KEYS.trackers,migratedTrackers);}
        }
        if(td)setTenders(td);
        if(ct)setContractors(ct);
        if(p){setPeople(p);}
        else{
          const op=await cloudStore.get("people");
          const finalP=op||SEED_PEOPLE;
          setPeople(finalP);sync(KEYS.people,finalP);
        }
        if(pk)setPackages(pk);
        if(g){
          // "Warning" was added after the first releases: make sure existing tag lists get it
          var gg=g.slice();
          ["Warning","Prerequisite"].forEach(function(t){if(gg.indexOf(t)<0)gg=[t].concat(gg);});
          setTags(gg);
          if(gg.length!==g.length)sync(KEYS.tags,gg);
        }
        else{
          const og=await cloudStore.get("tags");
          const finalG=og&&og.length?og:SEED_TAGS;
          setTags(finalG);sync(KEYS.tags,finalG);
        }
        if(imp)setImprovements(imp);
        if(corr)setCorrespondences(corr);
        if(awn)setAwns(awn);
        if(pko)setPkgOwners(pko);
        if(pkgsub)setPkgSubcontractors(pkgsub);
        if(pemail)setPeopleEmails(pemail);
        if(dcc)setDefaultCC(dcc);
        if(kp)setKpis(kp);
        if(pacc)setPeopleAccess(pacc);
        if(mtg)setMeetings(mtg);
        if(zown)setZoneOwners(zown);
        if(sched)setSchedules(sched);
        if(durs){setDurations(durs);window._ppDurations=durs;}
        // Ensure "External Works" zone exists for KPI tracking (auto-added once)
        if(zn&&zn.length&&zn.indexOf("External Works")===-1){
          var zn2=[...zn,"External Works"];
          setZones(zn2);sync(KEYS.zones,zn2);
        }else if(!zn||!zn.length){
          var seedZ=[...SEED_ZONES,"External Works"];
          setZones(seedZ);sync(KEYS.zones,seedZ);
        }
        if(zn&&zn.length)setZones(zn);
        try{var sbl=await cloudStore.get(KEYS.groups);if(Array.isArray(sbl))setSubList(sbl);}catch(e){}
        try{var sbc=await cloudStore.get(KEYS.pkgsubcontractors);if(sbc&&typeof sbc==="object"&&!Array.isArray(sbc))setSubColors(sbc);}catch(e){}
        try{var trl=await cloudStore.get(KEYS.tenderrules);if(Array.isArray(trl))setTenderRules(trl);}catch(e){}
        try{var mm=await cloudStore.get(KEYS_MOMS);if(Array.isArray(mm))setMoms(mm);}catch(e){}
        if(rm)setRooms(rm);
        if(prefs)setUserPrefs(prefs);

        startListeners({setTasks,setTrackers,setTenders,setContractors,setCorrespondences});

        setTimeout(function(){
          var currentName=window._currentUser?window._currentUser.name:"";
          if(!currentName)return;
          var lastKey="pp_last_visit_"+currentName.replace(/[^a-z0-9]/gi,"_");
          var lastVisit="";try{lastVisit=localStorage.getItem(lastKey)||"";}catch(e){}
          var now=new Date().toISOString();
          try{localStorage.setItem(lastKey,now);}catch(e){}
          if(!lastVisit)return;
          var myNew=(t||[]).filter(function(task){
            if(!task.createdAt||!task.owner)return false;
            if(task.owner!==currentName)return false;
            if(task.addedBy===currentName)return false;
            if(task.createdAt<=lastVisit.slice(0,10))return false;
            return true;
          });
          if(myNew.length>0)setNewTasksPopup(myNew);
        },500);
        if(tr){setTagrules(tr);}
        else{
          const otr=await cloudStore.get("tagrules");
          if(otr){setTagrules(otr);sync(KEYS.tagrules,otr);}
        }
        if(pr){setPkgrules(pr);}
        else{
          const opr=await cloudStore.get("pkgrules");
          if(opr){setPkgrules(opr);sync(KEYS.pkgrules,opr);}
        }
      }catch(e){console.error("Load error",e);}

      // One-off migration: schedule categories are the source of truth for rooms.
      // Any category without a linked room gets one created; the link is written back on the category.
      try{
        var curScheds=loadedScheds;
        var curRooms=loadedRooms;
        if(curScheds.length>0){
          var newRooms=[];
          var schedsChanged=false;
          var migratedScheds=curScheds.map(function(s){
            var rowsChanged=false;
            var rows=(s.rows||[]).map(function(r){
              if(r.kind!=="category")return r;
              if(r.roomId&&curRooms.some(function(x){return x.id===r.roomId;}))return r;
              var existing=curRooms.concat(newRooms).find(function(x){return x.zone===s.zone&&(x.name||"").trim().toLowerCase()===(r.label||"").trim().toLowerCase();});
              if(!existing){
                existing=newRoom({name:r.label||"Room",zone:s.zone});
                newRooms.push(existing);
              }
              rowsChanged=true;
              return Object.assign({},r,{roomId:existing.id});
            });
            if(rowsChanged){schedsChanged=true;return Object.assign({},s,{rows:rows});}
            return s;
          });
          if(newRooms.length>0){
            var allRooms=[...curRooms,...newRooms];
            setRooms(allRooms);sync(KEYS_ROOMS,allRooms);
          }
          if(schedsChanged){setSchedules(migratedScheds);sync(KEYS_SCHEDULES,migratedScheds);}
        }
      }catch(e){console.error("Room/category sync error",e);}

      // One-off rename of older auto-tasks. "t" is a const from the Promise.all destructuring,
      // so the renamed list is kept in its own variable and reused by the resync pass below.
      var tasksForResync=loadedTasks;
      try{
        var renameMap=[
          ["Submit the ITP Result — ","Submit the ITP — "],
          ["Submit the WMS Result — ","Submit the WMS — "],
          ["Submit the Tender ITP — ","Submit the ITP — "],
          ["Submit the Tender WMS — ","Submit the WMS — "],
          ["Submit the Tender Result ITP — ","Submit the ITP — "],
          ["Submit the Tender Result WMS — ","Submit the WMS — "]
        ];
        var tRenamed=false;
        var renamedTasks=tasksForResync.map(function(tk){
          var nt=tk;
          renameMap.forEach(function(pair){
            if((nt.text||"").indexOf(pair[0])===0){
              nt=Object.assign({},nt,{text:pair[1]+nt.text.slice(pair[0].length)});
              tRenamed=true;
            }
          });
          return nt;
        });
        if(tRenamed){tasksForResync=renamedTasks;setTasks(renamedTasks);sync(KEYS.tasks,renamedTasks);}
      }catch(e){console.error("Task rename error",e);}

      // Resync ACC/ITP/WMS auto-created task importance/urgence based on current date (self-healing on each app load)
      try{
        var curTasks=tasksForResync||[];
        if(curTasks.length>0){
          var needsSync=false;
          var AUTO_RESULT_PREFIXES=["Submit the Tender Result — ","Submit the ITP — ","Submit the WMS — ","Submit the ITP Result — ","Submit the WMS Result — ","Get the approval of the Tender result from the client — "];
          var syncedTasks=curTasks.map(function(tk){
            var isAutoResult=tk.addedBy==="System"&&AUTO_RESULT_PREFIXES.some(function(p){return(tk.text||"").indexOf(p)===0;});
            if(!isAutoResult||tk.status==="done")return tk;
            var wantUrg=calcProcurementUrgence(tk.due||"");
            if(tk.importance!==3||tk.urgence!==wantUrg){
              needsSync=true;
              return Object.assign({},tk,{importance:3,urgence:wantUrg});
            }
            return tk;
          });

          // Dedup: remove duplicate System-created pending tasks (same tenderRef+text), keep the oldest
          var seen={};
          var dedupedTasks=[];
          var removedDupes=false;
          syncedTasks.slice().sort(function(a,b){return(a.createdAt||"").localeCompare(b.createdAt||"");}).forEach(function(tk){
            if(tk.addedBy==="System"&&tk.status!=="done"&&tk.tenderRef){
              var dkey=tk.tenderRef+"||"+tk.text;
              if(seen[dkey]){removedDupes=true;return;}
              seen[dkey]=true;
            }
            dedupedTasks.push(tk);
          });
          if(removedDupes){
            // restore original relative order (dedup pass sorted by createdAt; re-sort back to original array order)
            var keepIds=new Set(dedupedTasks.map(function(tk){return tk.id;}));
            syncedTasks=syncedTasks.filter(function(tk){return keepIds.has(tk.id);});
            needsSync=true;
          }

          if(needsSync){setTasks(syncedTasks);sync(KEYS.tasks,syncedTasks);}
        }
      }catch(e){console.error("Procurement urgency sync error",e);}

      setLoaded(true);

      if(window._dbListen){
        window._dbListen(KEYS.tasks,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTasks(v);});
          window._dbListen(KEYS.groups,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setSubList(v);});
          window._dbListen(KEYS.tenderrules,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTenderRules(v);});
          window._dbListen(KEYS.pkgsubcontractors,function(val){var v=_parseFirebaseVal(val);if(v&&typeof v==="object"&&!Array.isArray(v))setSubColors(v);});
        window._dbListen(KEYS.trackers,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTrackers(v);});
        window._dbListen(KEYS.tenders,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTenders(v);});
        window._dbListen(KEYS.contractors,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setContractors(v);});
        window._dbListen(KEYS_ROOMS,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setRooms(v);});
        window._dbListen(KEYS_KPIS,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setKpis(v);});
        window._dbListen(KEYS_MEETINGS,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setMeetings(v);});
        window._dbListen(KEYS_MOMS,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setMoms(v);});
        window._dbListen(KEYS_SCHEDULES,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setSchedules(v);});
        window._dbListen(KEYS_CORR,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setCorrespondences(v);});
      }
    };
    if(window._dbReady)load();
    else window.addEventListener("db-ready",load,{once:true});
  },[]);

  const addTask=t=>{saveT([t,...tasks]);};

  if(!loaded)return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",flexDirection:"column",gap:12,color:"#888"}}>
    <div style={{width:36,height:36,border:"3px solid #c9a84c",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
    <div style={{fontSize:14}}>Connecting to Firebase…</div>
    <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}
</style>
  </div>;

  window._ppPeople=people;
  window._ppUserPrefs=userPrefs;
  window._ppContractors=contractors;
  window._ppTags=tags;
  window._ppZones=zones;
  window._ppSchedules=schedules;
  window._ppSubList=allSubcontractors(subList,contractors);
  window._ppSubColors=subColors;
  window._ppTenderRules=tenderRules;
  window._ppRooms=rooms;
  const NAV=[
    {id:"packages",icon:"📦",label:"Packages"},
    {id:"zone",icon:"🏢",label:"Zone"},
    {id:"tenders",icon:"📑",label:"Tenders"},
    {id:"materials",icon:"🏗️",label:"Materials"},
    {id:"qadocs",icon:"🛡️",label:"WMS/ITP"},
    {id:"timeline",icon:"🗓",label:"Timeline"},
    {id:"moms",icon:"📝",label:"MoM"},
    {id:"global",icon:"🌐",label:"Actions"},
    {id:"submissions",icon:"📬",label:"Client F-up"},
    {id:"trackers",icon:"📊",label:"Trackers"},
    // Commercial group: three views that all deal with what has been signed.
    {id:"contracts",icon:"📋",label:"Contract",group:"contract",
      children:[
        {id:"contracts",icon:"📋",label:"Contracts"},
        {id:"awn",icon:"✉️",label:"Letters"},
        {id:"contractors",icon:"🤝",label:"Subcontractors"}
      ]},
    {id:"dashboard",icon:"📈",label:"Dashboard"},
    {id:"settings",icon:"⚙️",label:"Settings"},
  ];

  // Access model: a person is restricted ONLY if they have an explicit entry in Settings > Access
  // with fullAccess unchecked. People never configured keep full access (safe default, no accidental lockout).
  var myAccess=(peopleAccess||{})[currentUser];
  var isConfigured=!!myAccess;
  var hasFullAccess=!isConfigured||!!myAccess.fullAccess;
  // Two orthogonal permissions on top of the scope model:
  //   readOnly  — can look at everything in scope, can change nothing
  //   canDelete — may delete MoMs, actions and documents (schedules stay admin-only)
  var isReadOnly=!!(myAccess&&myAccess.readOnly);
  var mayDelete=isAppAdmin(currentUser)||!!(myAccess&&myAccess.canDelete);
  window._ppReadOnly=isReadOnly;
  window._ppMayDelete=mayDelete;
  var myPkgs=[],myTenders=[],effectiveNAV=NAV,actionsOnly=false;
  if(!hasFullAccess){
    var extraPkgs=myAccess.extraPackages||[];
    myPkgs=[...new Set([...(packages||[]).filter(function(pg){return(pkgOwners||{})[pg]===currentUser;}),...extraPkgs])];
    myTenders=(tenders||[]).filter(function(t){return t.ownerTender===currentUser||myPkgs.includes(t.package);});
    // Actions-only profile: no package/tender ownership and not a zone pilot → they just need their task list
    actionsOnly=myPkgs.length===0&&myTenders.length===0&&!myAccess.zonePilot;
    effectiveNAV=actionsOnly
      ?[
        {id:"global",icon:"🌐",label:"My Actions"},
        {id:"settings",icon:"⚙️",label:"Settings"},
      ]
      :[
        {id:"myprocurement",icon:"📦",label:"My Procurement"},
        ...(myAccess.zonePilot?[{id:"zone",icon:"🏢",label:"Zone"}]:[]),
        {id:"global",icon:"🌐",label:"Actions"},
        {id:"settings",icon:"⚙️",label:"Settings"},
      ];
    // "tenders" isn't shown as a nav button, but must stay reachable so clicking a tender from My Procurement works
    // A grouped entry contributes its children too, otherwise a sub-view would be treated
    // as forbidden and the person bounced back to the first tab.
    var allowedViews=[];
    effectiveNAV.forEach(function(n){
      allowedViews.push(n.id);
      (n.children||[]).forEach(function(k){allowedViews.push(k.id);});
    });
    if(!actionsOnly)allowedViews.push("tenders");
    // If the last-restored view isn't allowed for this person, fall back to their first available tab
    if(allowedViews.indexOf(view)===-1){
      setTimeout(function(){setView(effectiveNAV[0].id);},0);
    }
  }

  const syncDot=<div className={"sync-dot sync-"+syncStatus} title={syncStatus==="ok"?"Synced":syncStatus==="syncing"?"Syncing…":"Sync error"}/>;

  if(!currentUser)return <UserLogin people={people} onLogin={function(name){setCurrentUser(name);window._currentUser={name:name};}}/>;  return <div className="layout">

    <nav className="leftnav">
      <div className="logo" style={{fontSize:11,lineHeight:1.2,textAlign:"center",letterSpacing:".5px"}}>Project<br/>Tracker</div>
      {/* Deployment is a manual copy-paste, so the running build must be visible without
          opening the console — otherwise "it doesn't work" and "it isn't deployed" look alike. */}
      <div title={"Running build "+APP_BUILD+"\nIf this is not the build you just uploaded, GitHub Pages is still serving the old file: hard-reload with Ctrl+Shift+R."}
        style={{fontSize:7,color:"#c9a84c",fontFamily:"monospace",letterSpacing:0,marginTop:-8,marginBottom:6,cursor:"help"}}>{APP_BUILD}</div>
      {currentUser&&<div style={{marginTop:4,padding:"4px 2px",textAlign:"center"}}>
        <div style={{fontSize:9,color:"#c9a84c",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:52}}>{currentUser}</div>
        <button onClick={function(){try{localStorage.removeItem("pp_current_user");}catch(e){}setCurrentUser(null);}} title="Change user" style={{background:"none",border:"1px solid #444",borderRadius:4,color:"#888",cursor:"pointer",fontSize:8,padding:"1px 3px",fontFamily:"inherit",marginTop:2}}>change</button>
      </div>}

      <div style={{marginBottom:4,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>{syncDot}<span style={{fontSize:7,color:"#888",textAlign:"center"}}>{syncStatus==="syncing"?"saving...":syncStatus==="ok"?"saved":"err"}</span></div>
      {effectiveNAV.map(function(n){
        var kids=n.children||null;
        var activeHere=kids?kids.some(function(k){return view===k.id;}):view===n.id;
        // navGroup holds "id" for forced-open and "-id" for forced-closed, so a click can
        // always collapse the group even while one of its views is on screen.
        var groupOpen=kids?(navGroup===n.id?true:navGroup==="-"+n.id?false:activeHere):false;
        return <React.Fragment key={n.id}>
          <button className={"navbtn"+(activeHere?" on":"")} title={kids?n.label+" — "+kids.map(function(k){return k.label;}).join(", "):n.label}
            onClick={function(){
              if(kids){
                setNavGroup(groupOpen?"-"+n.id:n.id);
                if(!activeHere&&!groupOpen)setView(kids[0].id);
              }
              else setView(n.id);
            }}>
            <span style={{fontSize:20}}>{n.icon}</span>
            <span className="lbl">{n.label}</span>
            {kids&&<span style={{fontSize:8,lineHeight:1,marginTop:-1,opacity:.7}}>{groupOpen?"▾":"▸"}</span>}
          </button>
          {kids&&groupOpen&&kids.map(function(k){
            return <button key={k.id} className={"navbtn navsub"+(view===k.id?" on":"")} title={k.label}
              onClick={function(){setView(k.id);}}>
              <span style={{fontSize:14}}>{k.icon}</span>
              <span className="lbl" style={{fontSize:7}}>{k.label.length>9?k.label.slice(0,8)+"…":k.label}</span>
            </button>;
          })}
        </React.Fragment>;
      })}
      <div className="nav-sep"/>
    </nav>

    <div className="main-area">
      <div className="content">
        {view==="actions"&&<ActionsView tasks={tasks} setTasks={setTasks} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors} trackers={trackers} saveT={saveT} tagrules={tagrules} pkgrules={pkgrules}/>}
        {view==="trackers"&&<TrackersView trackers={trackers} setTrackers={setTrackers} saveX={saveX} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors} tagrules={tagrules} pkgrules={pkgrules} tasks={tasks} saveTasks={saveT} zones={zones}/>}
        {view==="tenders"&&<TendersView tenders={hasFullAccess?tenders:myTenders} saveTenders={saveTenders} packages={hasFullAccess?packages:myPkgs} people={people} tasks={tasks} saveTasks={saveT} contractors={contractors} pkgOwners={pkgOwners} jumpTender={jumpTender} clearJumpTender={function(){setJumpTender(null);}} jumpFrom={jumpFrom} clearJumpFrom={function(){setJumpFrom(null);}} onBack={jumpFrom?function(){setView(jumpFrom);setJumpTender(null);setJumpFrom(null);}:null} onNavZone={function(){setView("zone");}}/>}
        {view==="contractors"&&<ContractorsView contractors={contractors} saveContractors={saveContractors} packages={packages} people={people} tasks={tasks} tenders={tenders} apiKey={apiKey} correspondences={correspondences} saveCorrespondences={saveCorrespondences} saveT={saveT} onNavTender={navToTender} memory={memoryFor("contractors")} setMemory={function(p){setMemoryFor("contractors",p);}}/>}
        {view==="contracts"&&<ContractsView contractors={contractors} saveContractors={saveContractors} tenders={tenders} packages={packages} tasks={tasks} saveTasks={saveT}/>}
        {view==="awn"&&<AwnView awns={awns} saveAwns={saveAwns} people={people}/>}
        {view==="myprocurement"&&<PackagesView tasks={tasks} tenders={myTenders} contractors={contractors} packages={myPkgs} people={people} pkgOwners={pkgOwners} pkgSubcontractors={pkgSubcontractors} saveTasks={saveT} tags={tags} onNavTender={navToTender} memory={memoryFor("myprocurement")} setMemory={function(p){setMemoryFor("myprocurement",p);}}/>}
        {view==="packages"&&<PackagesView tasks={tasks} tenders={tenders} contractors={contractors} packages={packages} people={people} pkgOwners={pkgOwners} pkgSubcontractors={pkgSubcontractors} saveTasks={saveT} tags={tags} onNavTender={navToTender} memory={memoryFor("packages")} setMemory={function(p){setMemoryFor("packages",p);}}/>}
        {view==="weekly"&&<WeeklyView tasks={tasks} trackers={trackers} people={people} tags={tags} tagrules={tagrules} pkgrules={pkgrules} packages={packages} tenders={tenders} contractors={contractors}/>}
        {view==="zone"&&<ZoneView tasks={tasks} saveTasks={saveT} rooms={rooms} saveRooms={saveRooms} zones={zones} people={people} tags={tags} memory={memoryFor("zone")} setMemory={function(p){setMemoryFor("zone",p);}} peopleEmails={peopleEmails} defaultCC={defaultCC} kpis={kpis} saveKpis={saveKpis} meetings={meetings} saveMeetings={saveMeetings} zoneOwners={zoneOwners} schedules={schedules} saveSchedules={saveSchedules} tenders={tenders} saveTenders={saveTenders} pkgOwners={pkgOwners} onNavTender={navToTender}/>}
        {view==="moms"&&<MomView moms={moms} saveMoms={saveMoms} tenders={tenders} packages={packages} people={people} contractors={contractors} tasks={tasks} saveTasks={saveT} onNavTender={navToTender} memory={memoryFor("moms")} setMemory={function(p){setMemoryFor("moms",p);}}/>}
        {view==="timeline"&&<TimelineView tasks={tasks} tenders={tenders} people={people} packages={packages} zones={zones} saveTasks={saveT} onNavTender={navToTender} memory={memoryFor("timeline")} setMemory={function(p){setMemoryFor("timeline",p);}}/>}
        {view==="qadocs"&&<QualityDocsView tenders={tenders} packages={packages} saveTenders={saveTenders} onNavTender={navToTender} memory={memoryFor("qadocs")} setMemory={function(p){setMemoryFor("qadocs",p);}}/>}
        {view==="materials"&&<MaterialsView tenders={tenders} packages={packages} people={people} saveTenders={saveTenders} onNavTender={navToTender} memory={memoryFor("materials")} setMemory={function(p){setMemoryFor("materials",p);}} tasks={tasks}/>}
        {view==="submissions"&&<ClientSubmissionsView tasks={tasks} tenders={tenders} contractors={contractors} packages={packages} people={people} saveTasks={saveT} onNavTender={navToTender} memory={memoryFor("submissions")} setMemory={function(p){setMemoryFor("submissions",p);}}/>}
    {view==="dashboard"&&<DashboardView tasks={tasks} trackers={trackers} people={people} tenders={tenders} contractors={contractors} packages={packages} tags={tags} tagrules={tagrules} pkgrules={pkgrules} onJumpOwner={function(name){setJumpOwner(name);setView("global");}} onNavTender={navToTender} memory={memoryFor("dashboard")} setMemory={function(p){setMemoryFor("dashboard",p);}}/>}
    {view==="global"&&<GlobalView tasks={tasks} trackers={trackers} tenders={tenders} contractors={contractors} people={people} packages={packages} tags={tags} saveTasks={saveT} saveTrackers={saveX} tagrules={tagrules} pkgrules={pkgrules} jumpOwner={jumpOwner} clearJump={function(){setJumpOwner(null);}} onNavTender={navToTender} memory={memoryFor("global")} setMemory={function(p){setMemoryFor("global",p);}} peopleEmails={peopleEmails} defaultCC={defaultCC} zones={zones} actionsOnly={actionsOnly} currentUser={currentUser}/>}
        {view==="settings"&&<SettingsView subList={subList} saveSubList={saveSubList} subColors={subColors} saveSubColors={saveSubColors} contractors={contractors} tenderRules={tenderRules} saveTenderRules={saveTenderRules} tenders={tenders} tags={tags} saveTags={saveTags} people={people} savePeople={savePeople} packages={packages} savePackages={savePackages} tagrules={tagrules} saveTagrules={saveTagrules} pkgrules={pkgrules} savePkgrules={savePkgrules} apiKey={apiKey} saveApiKey={saveApiKey} improvements={improvements} saveImprovements={saveImprovements} pkgOwners={pkgOwners} savePkgOwners={savePkgOwners} pkgSubcontractors={pkgSubcontractors} savePkgSubcontractors={savePkgSubcontractors} peopleEmails={peopleEmails} savePeopleEmails={savePeopleEmails} defaultCC={defaultCC} saveDefaultCC={saveDefaultCC} peopleAccess={peopleAccess} savePeopleAccess={savePeopleAccess} durations={durations} saveDurations={saveDurations} isAdmin={isAppAdmin(currentUser)} zones={zones} zoneOwners={zoneOwners} saveZoneOwners={saveZoneOwners} saveZones={saveZones} userPrefs={userPrefs} saveUserPrefs={saveUserPrefs} allData={{tasks,trackers,tenders,contractors,people,packages,tags,tagrules,pkgrules,improvements,correspondences,awns,pkgOwners}} onImport={function(d){if(d.tasks)saveT(d.tasks);if(d.trackers)saveX(d.trackers);if(d.tenders)saveTenders(d.tenders);if(d.contractors)saveContractors(d.contractors);if(d.people)savePeople(d.people);if(d.packages)savePackages(d.packages);if(d.tags)saveTags(d.tags);}}/>}
      </div>

      <aside className={"rsidebar "+(sidebarOpen?"open":"closed")}>
        <div style={{display:"flex",alignItems:"center",justifyContent:sidebarOpen?"flex-end":"center",padding:"8px 8px 0",flexShrink:0}}>
          <button onClick={function(){setSidebarOpen(!sidebarOpen);}} title={sidebarOpen?"Collapse sidebar":"Expand sidebar"}
            style={{background:"none",border:"1px solid #e8e6df",borderRadius:6,cursor:"pointer",padding:"3px 6px",fontSize:12,color:"#888",lineHeight:1}}>
            {sidebarOpen?"›":"‹"}
          </button>
        </div>
        {sidebarOpen&&<QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} trackers={trackers} tags={tags} zones={zones} tasks={tasks} onAdd={addTask} improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/>}
      </aside>
    <ImprovementBox improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/>
    <div style={{position:"fixed",bottom:16,right:360,zIndex:490}}>
      <button onClick={function(){setShowWeeklyPopup(true);}} title="Weekly Actions" style={{width:36,height:36,borderRadius:"50%",background:"#3949ab",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>📋</button>
    </div>
    {newTasksPopup&&<NewTasksPopup tasks={newTasksPopup} tenders={tenders} contractors={contractors} onClose={function(){setNewTasksPopup(null);}}/> }
    {showWeeklyPopup&&<WeeklyPopup tasks={tasks} trackers={trackers} people={people} tags={tags} tagrules={tagrules} pkgrules={pkgrules} tenders={tenders} contractors={contractors} saveT={saveT} saveX={saveX} onClose={function(){setShowWeeklyPopup(false);}}/>}
    <div className="mobile-qa-btn" onClick={function(){setMobileQAOpen(true);}} title="Quick Add Task" style={{display:"none",position:"fixed",bottom:62,right:16,zIndex:490,width:44,height:44,borderRadius:"50%",background:"#c9a84c",boxShadow:"0 2px 8px rgba(0,0,0,.2)",alignItems:"center",justifyContent:"center",fontSize:22,cursor:"pointer",color:"#1c1c1e"}}>＋</div>
    {mobileQAOpen&&<div className="overlay" style={{zIndex:600}} onClick={function(e){if(e.target===e.currentTarget)setMobileQAOpen(false);}}><div style={{background:"#fff",borderRadius:"16px 16px 0 0",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",position:"absolute",bottom:0}}><QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} trackers={trackers} tags={tags} zones={zones} tasks={tasks} onAdd={function(t){addTask(t);setMobileQAOpen(false);}} improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/></div></div>}
    <div style={{position:"fixed",bottom:16,right:318,zIndex:500}}>
      <button onClick={function(){setPdfGlobal({open:true});}} title="Import certification from PDF"
        style={{width:36,height:36,borderRadius:"50%",background:"#1a73e8",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",transition:"all .15s"}}>
        📄
      </button>
    </div>
    {pdfGlobal&&pdfGlobal.open&&<GlobalPdfModal contractors={contractors} saveContractors={saveContractors} onClose={function(){setPdfGlobal(null);}}/>}
    </div>
  </div>;
}

