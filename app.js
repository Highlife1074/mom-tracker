
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
const KEYS={
  tasks:"pp_tasks", trackers:"pp_trackers", tenders:"pp_tenders",
  contractors:"pp_contractors", people:"pp_people", tags:"pp_tags",
  packages:"pp_packages", groups:"pp_groups", tagrules:"pp_tagrules", pkgrules:"pp_pkgrules",
  pkgowners:"pp_pkgowners"
};

function uuid(){return"id_"+Math.random().toString(36).slice(2)+Date.now().toString(36);}
function qualityTag(pkg){
  if(!pkg)return"Quality External";
  var p=pkg.toLowerCase();
  if(p.includes("podium"))return"Quality Podium";
  if(p.includes("external")||p.includes("works"))return"Quality External";
  return"Quality Tower";
}
function today(){return new Date().toISOString().slice(0,10);}
function fmtDate(d){if(!d)return"—";const p=d.split("-");return p.length===3?p[2]+"/"+p[1]+"/"+p[0].slice(2):d;}
function fmtMonthYear(d){if(!d)return"—";var p=d.split("-");return p.length>=2?p[1]+"/"+p[0].slice(2):d;}
function calcScore(i,u){return (i||1)*(u||1);}
function scoreStyle(s){
  if(s>=7)return{bg:"#ffeaea",color:"#c62828",label:"🔥 "+s};
  if(s>=4)return{bg:"#fff8e1",color:"#f57f17",label:"⚡ "+s};
  return{bg:"#f5f4f0",color:"#888",label:s>1?""+s:"—"};
}

const OWNER_COLORS=["#e8eaf6|#3949ab","#fce4ec|#c2185b","#e0f2f1|#00796b","#fff3e0|#e65100","#f3e5f5|#7b1fa2","#e8f5e9|#2e7d32","#fff8e1|#f57f17","#e3f2fd|#1565c0","#fbe9e7|#bf360c","#f9fbe7|#827717"];
function ownerColor(n){let h=0;if(!n)return{bg:"#f5f4f0",accent:"#888"};for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))%OWNER_COLORS.length;const p=OWNER_COLORS[h].split("|");return{bg:p[0],accent:p[1]};}
const TAG_COLORS=["#e8eaf6|#3949ab","#fce4ec|#c2185b","#e0f2f1|#00796b","#fff3e0|#e65100","#f3e5f5|#7b1fa2","#e8f5e9|#2e7d32","#fff8e1|#f57f17","#fbe9e7|#bf360c","#e3f2fd|#1565c0","#f9fbe7|#827717"];
function tagColor(t){let h=0;for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))%TAG_COLORS.length;const p=TAG_COLORS[h].split("|");return{bg:p[0],color:p[1]};}
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
const TENDER_STEPS=[
  {key:"bidders",label:"Bidders list submission",opts:["—","N/A","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","N/A","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"acc",label:"ACC/Aconex",opts:["—","N/A","Internal review ongoing","Pending client approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"contract",label:"Contract",opts:["—","N/A","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"wms",label:"WMS",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"]}
];
function tenderStepClass(step,val){
  if(!val||val==="—")return"s-default";
  if(val==="N/A")return"s-na";
  var v=val.toLowerCase();
  if(v==="not approved"||v.includes("reject")||v.includes("not done"))return"s-notdone";
  if(v==="approved a"||v==="approved b"||v==="approved"||v==="signed")return"s-approved-a";
  if(v.includes("pending")||v.includes("ongoing")||v.includes("circulation")||v.includes("sent")||v.includes("preparation")||v.includes("submitted")||v.includes("request")||v.includes("bids"))return"s-pending";
  return"s-default";
}

// Defaults
const SEED_PEOPLE=["BALLAS, Antonios","CHATZIROUMPIS, Vasilis","FYTOPOULOU, Katerina","KLEFTOSPYROU, Georgia","KOUTOULAKI, Anna","MAKROVASILI, Anastasia","NASIS, Athanasios","PLOUMISTOS, Georgios","ROSIOS, Irodion","ROUSSIN, Yanis","TSIAMPAOS, Konstantinos","VRETTOU, Eirini"];
const SEED_TAGS=["Blocking Point","Contract","Design","FCR","HR","Letter","Procurement","Production","Quality External","Quality Podium","Quality Tower","RFI","Top Management"];
const SEED_PACKAGES=["Facade","Structure","MEP","Civil","Podium","External Works"];

const STATUS_OPTS=["pending","in progress","done","blocked"];
const STATUS_ICONS={pending:"⏳","in progress":"🔄",done:"✅",blocked:"🚫"};

function stampModified(task){var u=Object.assign({},task);u.lastModifiedBy=window._currentUser?window._currentUser.name:"";u.lastModifiedAt=today();return u;}
function newTask(overrides){var base={id:uuid(),text:"",owner:"",package:"",status:"pending",importance:1,urgence:1,due:"",note:"",tags:[],tenderRef:"",contractorRef:"",trackerRef:"",createdAt:today(),rfiSubmission:"",rfiDue:"",rfiOverdue:false,addedBy:window._currentUser?window._currentUser.name:"",lastModifiedBy:"",lastModifiedAt:"",links:[]};return Object.assign(base,overrides||{});}
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

function QuickAdd({people,packages,tenders,contractors,trackers,tags,onAdd,improvements,saveImprovements,currentPage}){
  const [text,setText]=useState("");
  const [due,setDue]=useState(today());
  const [owner,setOwner]=useState("");
  const [pkg,setPkg]=useState("");
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
    var td={text:text.trim(),owner,package:pkg,due,tenderRef,contractorRef,importance,urgence,tags:selTags};
    if(isInfo)td.isInfo=true;
    if(selTags.includes("RFI")||selTags.includes("FCR")){td.rfiSubmission=rfiSub;td.rfiDue=rfiDue;}
    onAdd(newTask(td));
    setText("");setDue(today());setOwner("");setPkg("");setTenderRef("");setContractorRef("");setImportance(1);setUrgence(1);setSelTags([]);setIsInfo(false);
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

  return <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
    <div style={{padding:"14px 14px 10px",borderBottom:"1.5px solid #e8e6df"}}>
      <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,marginBottom:2}}>Quick Add</div>
      <div style={{fontSize:11,color:"#bbb"}}>Enter to add · {today().split("-").reverse().join("/")}</div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:12}} className="sform">

      <div className="fg">
        <label>Date</label>
        <input type="date" value={due} onChange={function(e){setDue(e.target.value);}}/>
      </div>

      <div className="fg">
        <label>Action *</label>
        <textarea ref={inputRef} value={text} onChange={function(e){setText(e.target.value);}}
          onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}}
          placeholder="What needs to be done?" style={{minHeight:60}}/>
      </div>

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
            <input type="date" value={rfiSub||""} onChange={function(e){setRfiSub(e.target.value);if(e.target.value){var d=new Date(e.target.value);d.setDate(d.getDate()+14);setRfiDue(d.toISOString().slice(0,10));}}} style={{padding:"3px 6px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:9,fontWeight:800,color:"#b45309",marginBottom:2}}>DUE (+14d)</div>
            <input type="date" value={rfiDue||""} onChange={function(e){setRfiDue(e.target.value);}} style={{padding:"3px 6px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5}}/>
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

function ActionItem({task,onStatusChange,onUpdate,onDelete,people,packages,tags,tenders,contractors,showCreated,onNavTender}){
  const [editMode,setEditMode]=useState(false);
  const [localTags,setLocalTags]=useState(task.tags||[]);
  const [localRfiSub,setLocalRfiSub]=useState(task.rfiSubmission||"");
  const [localRfiDue,setLocalRfiDue]=useState(task.rfiDue||"");
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
              <input type="date" value={task.due||""} onChange={function(e){upd("due",e.target.value);}} style={{flex:1,padding:"4px 6px",fontSize:11,borderRadius:5,border:"1px solid #ddd"}}/>
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
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,fontWeight:600,color:task.isInfo?"#1565c0":"#888",background:task.isInfo?"#e3f2fd":"transparent",padding:"3px 8px",borderRadius:8,border:"1.5px solid "+(task.isInfo?"#1565c0":"#ddd"),alignSelf:"flex-start"}}>
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
              {(tags||[]).map(function(tg){var on=(task.tags||[]).includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){var cur=task.tags||[];var newTags=on?cur.filter(function(x){return x!==tg;}):[...cur,tg];setLocalTags(newTags);upd("tags",newTags);}} style={{padding:"2px 7px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
            </div>
            <textarea value={task.note||""} onChange={function(e){upd("note",e.target.value);}} placeholder="Notes..." style={{minHeight:32,fontSize:11,padding:"4px 8px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit",resize:"vertical"}}/>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:4,textTransform:"uppercase",letterSpacing:".4px"}}>🔗 Links</div>
              {(task.links||[]).map(function(lk,li){return <div key={li} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
                <input type="text" value={lk.label||""} onChange={function(e){var ls=(task.links||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{label:e.target.value});});upd("links",ls);}} placeholder="Label" style={{width:100,padding:"3px 6px",fontSize:11,border:"1px solid #e0ddd8",borderRadius:5}}/>
                <input type="url" value={lk.url||""} onChange={function(e){var ls=(task.links||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{url:e.target.value});});upd("links",ls);}} placeholder="https://..." style={{flex:1,padding:"3px 6px",fontSize:11,border:"1px solid #e0ddd8",borderRadius:5}}/>
                <button onClick={function(){var ls=(task.links||[]).filter(function(_,j){return j!==li;});upd("links",ls);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:13,flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>✕</button>
              </div>;})}
              <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#666",marginLeft:8}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:"#2e7d32",display:"inline-block"}}/>
        Released (in totals)
      </div>
      <button className="btn btn-sm" onClick={function(){upd("links",[...(task.links||[]),{label:"",url:""}]);}} style={{fontSize:10,padding:"2px 8px"}}>＋ Add link</button>
            </div>
            {(localTags.includes("RFI")||localTags.includes("FCR"))&&<div style={{display:"flex",gap:8,padding:"8px",background:"#fff8f0",borderRadius:7,border:"1px solid #fed7aa"}}>
              <div style={{flex:1}}>
                <label style={{fontSize:9,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>RFI Submission date</label>
                <input type="date" value={localRfiSub} onChange={function(e){
                  setLocalRfiSub(e.target.value);
                  upd("rfiSubmission",e.target.value);
                  if(e.target.value){var d=new Date(e.target.value);d.setDate(d.getDate()+14);var dd=d.toISOString().slice(0,10);setLocalRfiDue(dd);upd("rfiDue",dd);}
                }} style={{padding:"3px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:9,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:2}}>RFI Due date (+14 days)</label>
                <input type="date" value={localRfiDue} onChange={function(e){setLocalRfiDue(e.target.value);upd("rfiDue",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
              </div>
            </div>}
            <button className="btn btn-sm btn-pri" onClick={function(){setEditMode(false);}} style={{alignSelf:"flex-start"}}>✓ Done editing</button>
          </div>
          :<div>
            <div className={"ac-text"+(task.status==="done"?" done":"")} style={{fontWeight:500}}>
              {task.isInfo&&<span style={{display:"inline-flex",alignItems:"center",gap:2,padding:"1px 6px",borderRadius:8,background:"#e3f2fd",color:"#1565c0",fontSize:10,fontWeight:700,marginRight:5}}>ℹ️ INFO</span>}
              {task.text||<span style={{color:"#ccc",fontStyle:"italic"}}>No text</span>}
            </div>
            {task.note&&<div style={{fontSize:11,color:"#888",fontStyle:"italic",marginTop:2}}>{task.note}</div>}
            <div className="ac-meta" style={{marginTop:4,display:"flex",flexWrap:"wrap",alignItems:"center",gap:4}}>
              {task.due&&<span style={{fontSize:11,color:task.due<today()&&task.status!=="done"?"#c62828":"#bbb"}}>📅 {fmtDate(task.due)}</span>}
              {task.owner&&<OwnerChip owner={task.owner}/>}
              {task.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{task.package}</span>}
              {!task.isInfo&&sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label}</span>}
              {(task.tags||[]).map(function(tg){return <TagChip key={tg} tag={tg}/>;} )}
              {tdr&&(onNavTender?<button onClick={function(e){e.stopPropagation();onNavTender(tdr.id,"global");}} style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10,padding:"2px 8px",borderRadius:20,fontFamily:"inherit",cursor:"pointer",fontWeight:600}}>📑 {tdr.title}</button>:<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {tdr.title}</span>)}
              {ctr&&<span className="badge" style={{background:"#e8f0fe",color:"#1a73e8",border:"1px solid #c5d8fc",fontSize:10}}>🤝 {ctr.name}</span>}
            </div>
            {((task.tags||[]).includes("RFI")||(task.tags||[]).includes("FCR"))&&<div style={{fontSize:10,color:"#b45309",marginTop:3,background:"#fff8f0",padding:"3px 8px",borderRadius:5,display:"inline-block"}}>
              📋 {(task.tags||[]).includes("FCR")?"FCR":"RFI"} {task.rfiSubmission?"submitted: "+fmtDate(task.rfiSubmission):"⚠️ No submission date"} {task.rfiDue&&"· due: "+fmtDate(task.rfiDue)}
            </div>}
            {(task.links||[]).length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:3}}>
              {(task.links||[]).map(function(lk,li){return lk.url?<a key={li} href={lk.url} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:"#3949ab",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:2,padding:"1px 6px",borderRadius:6,background:"#f0f0ff",border:"1px solid #d0d0f0"}} onMouseEnter={function(e){e.currentTarget.style.textDecoration="underline";}} onMouseLeave={function(e){e.currentTarget.style.textDecoration="none";}}>🔗 {lk.label||lk.url}</a>:null;})}
            </div>}
            {(showCreated!==false)&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:3,alignItems:"center"}}>
              {task.addedBy&&<span style={{fontSize:9,color:"#bbb",display:"inline-flex",alignItems:"center",gap:2}}>
                <span style={{color:"#ddd"}}>✚</span>{task.addedBy.split(",")[0]}
                {task.createdAt&&<span style={{color:"#ddd"}}>{fmtDate(task.createdAt)}</span>}
              </span>}
              {task.lastModifiedBy&&task.lastModifiedAt&&<span style={{fontSize:9,color:"#bbb",display:"inline-flex",alignItems:"center",gap:2}}>
                <span style={{color:"#ddd"}}>✎</span>{task.lastModifiedBy.split(",")[0]}
                <span style={{color:"#ddd"}}>{fmtDate(task.lastModifiedAt)}</span>
              </span>}
            </div>}
          </div>}
      </div>
      {!editMode&&<div style={{display:"flex",gap:4,flexShrink:0}}>
        <select className="btn btn-sm" value={task.status||"pending"} onChange={function(e){if(onStatusChange)onStatusChange(e.target.value);}} style={{width:"auto",padding:"3px 6px",fontSize:10,border:"1px solid #ddd"}}>
          {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
        </select>
        <button className="btn btn-sm" onClick={function(){setEditMode(true);}} style={{padding:"3px 7px"}}>✏️</button>
        {onDelete&&<button className="btn btn-sm btn-danger" onClick={function(){onDelete();}} style={{padding:"3px 7px"}}>🗑</button>}
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
      <input type="date" value={due} onChange={function(e){setDue(e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #ddd",borderRadius:5}}/>
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
        <input type="date" value={rfiSub} onChange={function(e){setRfiSub(e.target.value);if(e.target.value){var d=new Date(e.target.value);d.setDate(d.getDate()+14);setRfiDue(d.toISOString().slice(0,10));}}} style={{padding:"4px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
      </div>
      <div style={{flex:1}}>
        <label style={{fontSize:9,fontWeight:800,color:"#b45309",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:3}}>Due date (+14 days)</label>
        <input type="date" value={rfiDue} onChange={function(e){setRfiDue(e.target.value);}} style={{padding:"4px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,width:"100%"}}/>
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
                <input type="date" value={t.due||""} onChange={e=>updateTask(t.id,"due",e.target.value)}/></div>
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

function TrackersView({trackers,setTrackers,saveX,people,packages,tags,tenders,contractors,tagrules,pkgrules}){
  const [trackerQ,setTrackerQ]=useState("");
  const [view,setView]=useState("list");
  const [sel,setSel]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [editActionId,setEditActionId]=useState(null);

  const openNew=()=>{setFormData(newTracker());setShowForm(true);};
  const openEdit=tr=>{setFormData(JSON.parse(JSON.stringify(tr)));setShowForm(true);};

  const saveTracker=td=>{
    const d=trackers.find(x=>x.id===td.id)?trackers.map(x=>x.id===td.id?td:x):[td,...trackers];
    saveX(d);setShowForm(false);
    if(sel&&sel.id===td.id)setSel(td);
  };
  const delTracker=id=>{if(safeConfirm("Delete tracker?"))saveX(trackers.filter(t=>t.id!==id));setSel(null);setView("list");};

  const updAction=(trId,acId,field,val)=>{
    const d=trackers.map(function(tr){if(tr.id!==trId)return tr;return Object.assign({},tr,{actions:tr.actions.map(function(a){if(a.id!==acId)return a;var u=Object.assign({},a);u[field]=val;return u;})});});
    saveX(d);if(sel&&sel.id===trId)setSel(d.find(t=>t.id===trId));
  };
  const addAction=trId=>{
    const ac=newTrackerAction();
    const d=trackers.map(tr=>tr.id!==trId?tr:Object.assign({},tr,{actions:[...tr.actions,ac]}));
    saveX(d);if(sel&&sel.id===trId)setSel(d.find(t=>t.id===trId));
  };
  const delAction=(trId,acId)=>{
    const d=trackers.map(tr=>tr.id!==trId?tr:Object.assign({},tr,{actions:tr.actions.filter(a=>a.id!==acId)}));
    saveX(d);if(sel&&sel.id===trId)setSel(d.find(t=>t.id===trId));
  };

  if(view==="detail"&&sel){
    const done=sel.actions.filter(a=>a.status==="done").length;
    const pct=sel.actions.length?Math.round(done/sel.actions.length*100):0;
    return <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <button className="btn btn-sm" onClick={()=>setView("list")}>← Back</button>
        <div style={{flex:1}}><div className="page-title">{sel.title}</div>
          {sel.description&&<div className="page-sub">{sel.description}</div>}
        </div>
        <button className="btn btn-sm" onClick={()=>openEdit(sel)}>✏️ Edit</button>
        <button className="btn btn-sm btn-danger" onClick={()=>delTracker(sel.id)}>🗑 Delete</button>
      </div>
      <div className="pbar"><div className="pfill" style={{width:pct+"%",background:"#2e7d32"}}/></div>
      <div style={{fontSize:11,color:"#888",marginBottom:14}}>{done}/{sel.actions.length} done ({pct}%)</div>
      {sel.actions.map(ac=>{
        const sc=calcScore(ac.importance||1,ac.urgence||1);const ss=scoreStyle(sc);
        const ccs=getAllCCs(ac.tags||[],ac.package||"",ac.owner||"",tagrules,pkgrules);
        return <div key={ac.id} className="ac-item">
          <div className="ac-check" style={{borderColor:ac.status==="done"?"#2e7d32":"#ddd",background:ac.status==="done"?"#2e7d32":"transparent",flexShrink:0}}
            onClick={()=>updAction(sel.id,ac.id,"status",ac.status==="done"?"pending":"done")}>
            {ac.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <input type="text" value={ac.text} onChange={e=>updAction(sel.id,ac.id,"text",e.target.value)} placeholder="Action…"
              style={{width:"100%",fontSize:13,fontWeight:500,border:"none",borderBottom:"1px solid #f0ede6",borderRadius:0,padding:"2px 0",background:"transparent",marginBottom:6}}/>
            <div style={{display:"flex",gap:6,marginBottom:5}}>
              <input type="date" value={ac.due||""} onChange={e=>updAction(sel.id,ac.id,"due",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}/>
              <select value={ac.status} onChange={e=>updAction(sel.id,ac.id,"status",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}>
                {STATUS_OPTS.map(s=><option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:5}}>
              <select value={ac.owner||""} onChange={e=>updAction(sel.id,ac.id,"owner",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}>
                <option value="">— owner —</option>{people.map(p=><option key={p} value={p}>{p.split(",")[0]}</option>)}
              </select>
              <select value={ac.package||""} onChange={e=>updAction(sel.id,ac.id,"package",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}>
                <option value="">— package —</option>{packages.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
              <span style={{fontSize:10,fontWeight:700,color:"#aaa",minWidth:20}}>I</span>
              {[1,2,3].map(v=><button key={v} onClick={()=>updAction(sel.id,ac.id,"importance",v)}
                style={{width:22,height:22,borderRadius:4,border:"1.5px solid "+((ac.importance||1)===v?"#1c1c1e":"#ddd"),background:(ac.importance||1)===v?"#1c1c1e":"#fff",color:(ac.importance||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>)}
              <span style={{fontSize:10,fontWeight:700,color:"#aaa",marginLeft:6,minWidth:20}}>U</span>
              {[1,2,3].map(v=><button key={v} onClick={()=>updAction(sel.id,ac.id,"urgence",v)}
                style={{width:22,height:22,borderRadius:4,border:"1.5px solid "+((ac.urgence||1)===v?"#1c1c1e":"#ddd"),background:(ac.urgence||1)===v?"#1c1c1e":"#fff",color:(ac.urgence||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>)}
              {sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10,marginLeft:4}}>{ss.label}</span>}
            </div>

            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
              {tags.map(tg=>{const on=(ac.tags||[]).includes(tg);const tc=tagColor(tg);return <button key={tg} onClick={()=>{const cur=ac.tags||[];updAction(sel.id,ac.id,"tags",on?cur.filter(x=>x!==tg):[...cur,tg]);}}
                style={{padding:"2px 8px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
            </div>

            {ccs.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:10,fontWeight:700,color:"#aaa"}}>CC:</span>
              {ccs.map((p,i)=><span key={p} style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:"#e8f5e9",color:"#2e7d32",fontWeight:700,border:"1px solid #c8e6c9"}}>CC{i+1} {p.split(",")[0]}</span>)}
            </div>}

            {ac.details!==undefined&&<textarea value={ac.details||""} onChange={e=>updAction(sel.id,ac.id,"details",e.target.value)} placeholder="Details…"
              style={{width:"100%",marginTop:5,fontSize:11,minHeight:30,border:"1px solid #f0ede6",borderRadius:5,padding:"3px 6px",background:"#fafaf8",resize:"vertical"}}/>}
          </div>
          <button className="btn btn-sm btn-danger" onClick={()=>delAction(sel.id,ac.id)} style={{padding:"3px 7px",flexShrink:0,alignSelf:"flex-start"}}>🗑</button>
        </div>;
      })}
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
        <button className="btn btn-sm" onClick={function(){addAction(sel.id,false);}}>＋ Add Action</button>
        <button className="btn btn-sm" onClick={function(){addAction(sel.id,true);}} style={{background:"#e3f2fd",color:"#1565c0",border:"1.5px solid #1565c0"}}>＋ Add Info</button>
      </div>
      {showForm&&formData&&<TrackerFormModal data={formData} onChange={setFormData} onSave={saveTracker} onClose={()=>setShowForm(false)} people={people} packages={packages} tags={tags}/>}
    </div>;
  }

  var filteredTr=trackerQ?trackers.filter(function(t){return (t.title||"").toLowerCase().includes(trackerQ.toLowerCase());}):trackers;
  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Trackers</div><div className="page-sub">Action groups by theme or project phase</div></div>
      <button className="btn btn-gold" onClick={openNew}>＋ New Tracker</button>
    </div>
    <div style={{marginBottom:12}}>
      <input type="text" value={trackerQ} onChange={function(e){setTrackerQ(e.target.value);}} placeholder="🔍 Search tracker..." style={{width:220,padding:"5px 10px",fontSize:12}}/>
    </div>
    {filteredTr.length===0?<div className="empty"><div className="empty-ico">📊</div><div className="empty-txt">{trackerQ?"No tracker matches your search.":"No trackers yet. Create one to track a recurring theme."}</div></div>
    :filteredTr.map(tr=>{
      const done=tr.actions.filter(a=>a.status==="done").length;
      const pct=tr.actions.length?Math.round(done/tr.actions.length*100):0;
      return <div key={tr.id} className="ctr-card" onClick={()=>{setSel(tr);setView("detail");}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14}}>{tr.title}</div>
            {tr.description&&<div style={{fontSize:12,color:"#888",marginTop:2}}>{tr.description}</div>}
            <div style={{fontSize:11,color:"#aaa",marginTop:4}}>📅 {fmtDate(tr.createdAt)} · {done}/{tr.actions.length} done</div>
          </div>
          <div style={{fontSize:13,fontWeight:700,color:pct===100?"#2e7d32":"#888"}}>{pct}%</div>
        </div>
        <div className="pbar" style={{marginTop:8}}><div className="pfill" style={{width:pct+"%",background:pct===100?"#2e7d32":"#c9a84c"}}/></div>
      </div>;
    })}
    {showForm&&formData&&<TrackerFormModal data={formData} onChange={setFormData} onSave={saveTracker} onClose={()=>setShowForm(false)} people={people} packages={packages} tags={tags}/>}
  </div>;
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

function parseLeadDays(str){
  if(!str)return 0;
  var s=String(str).toLowerCase().trim();
  var n=parseFloat(s)||0;
  if(!n)return 0;
  if(s.includes("week")||s.includes("sem")||s.includes("wk")||s.includes("sem"))return Math.round(n*6);
  if(s.includes("month")||s.includes("mois"))return Math.round(n*26);
  return Math.round(n);
}
function MaterialsPanel({td,updTd,saveT,tasks,tenders,saveTenders,setSelTender,pkgOwners}){
  const [open,setOpen]=useState(true);
  const [sectOpen,setSectOpen]=useState({});
  function isSectOpen(mi,sect){if(sectOpen[mi]&&sectOpen[mi][sect]!==undefined)return sectOpen[mi][sect];return false;}
  function toggleSect(mi,sect){setSectOpen(function(prev){var o=Object.assign({},prev);o[mi]=Object.assign({},o[mi]||{});o[mi][sect]=!isSectOpen(mi,sect);return o;});}
  var mats=td.materials||[];

  // Unified status cycle: — / under preparation / submitted / pending approval / approved / rejected
  var CYCLE_OPTS=["","under preparation","submitted","pending approval","approved","rejected"];
  var CYCLE_LABELS={"":"— Status —","under preparation":"Under preparation","submitted":"Submitted","pending approval":"Pending approval","approved":"✅ Approved","rejected":"❌ Rejected"};

  // Merge legacy data: if old approvalStatus exists it wins over old submission status
  function effStatus(mat,kind){
    var k=kind.toLowerCase();
    var app=mat[k+"ApprovalStatus"]||"";
    var sub=mat[k+"Status"]||"";
    if(app==="approved")return"approved";
    if(app&&app!=="")return"pending approval";
    return sub;
  }

  function pkgOwner(){return (pkgOwners||{})[td.package||""]||td.ownerTender||"";}

  // Auto-action engine: close previous step actions, open new one
  function stepAction(mat,kind,newStatus){
    if(!saveT||!tasks)return;
    var qtag=qualityTag(td.package||"");
    var base=kind+": "+(mat.name||"material")+" — "+td.title;
    var ACTIONS={
      "under preparation":{text:"Prepare the "+base,tags:[qtag]},
      "submitted":{text:"Get approval for "+base,tags:[qtag]},
      "pending approval":{text:"Get approval for "+base,tags:[qtag]},
      "rejected":{text:"Resubmit "+base,tags:[qtag]}
    };
    var allTexts=["Prepare the "+base,"Get approval for "+base,"Resubmit "+base,kind+" to be submitted: "+(mat.name||"")+" — "+td.title];
    var updated=(tasks||[]).map(function(t){
      if(t.tenderRef!==td.id)return t;
      if(allTexts.indexOf(t.text)>=0&&t.status!=="done"){
        // Close actions from previous steps
        var keepOpen=ACTIONS[newStatus]&&t.text===ACTIONS[newStatus].text;
        if(!keepOpen)return Object.assign({},t,{status:"done",completedAt:today()});
      }
      return t;
    });
    var target=ACTIONS[newStatus];
    if(target){
      var exists=updated.some(function(t){return t.tenderRef===td.id&&t.text===target.text&&t.status!=="done";});
      if(!exists){
        var tgtDate=newStatus==="under preparation"?(mat[kind.toLowerCase()+"Target"]||""):"";
        updated=[newTask({text:target.text,owner:pkgOwner(),due:tgtDate,tenderRef:td.id,package:td.package||"",importance:2,urgence:2,tags:target.tags,note:"Auto — "+kind+" status: "+newStatus,addedBy:"System"}),...updated];
      }
    }
    saveT(updated);
  }

  function updMat(mi,field,val){
    var ms=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,{[field]:val});});
    updTd("materials",ms);
  }
  function setStatus(mi,mat,kind,val){
    var k=kind.toLowerCase();
    var updates={};
    updates[k+"Status"]=val;
    // Keep legacy approval fields coherent (don't delete data, just sync)
    if(val==="approved")updates[k+"ApprovalStatus"]="approved";
    else if(val==="pending approval")updates[k+"ApprovalStatus"]="pending approval";
    else updates[k+"ApprovalStatus"]="";
    var ms=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,updates);});
    updTd("materials",ms);
    stepAction(Object.assign({},mat,updates),kind,val);
  }

  function statusColor(st){
    if(st==="approved")return"#2e7d32";
    if(st==="rejected")return"#c62828";
    if(st==="pending approval"||st==="submitted")return"#f57f17";
    if(st==="under preparation")return"#1a73e8";
    return"#888";
  }

  // One compact block per doc type (MSS / MAR)
  function DocBlock({mat,mi,kind,color,bg}){
    var k=kind.toLowerCase();
    var st=effStatus(mat,kind);
    var isOpen=isSectOpen(mi,k);
    var subDone=mat[k+"Done"]||"";
    var due14=subDone?(function(){var d=new Date(subDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
    var overdue=st!=="approved"&&due14&&due14<today();
    return <div style={{marginBottom:4}}>
      <div onClick={function(){toggleSect(mi,k);}} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 6px",background:isOpen?bg+"33":"transparent",borderRadius:5,marginBottom:isOpen?4:0}}>
        <span style={{fontSize:10,color:color}}>{isOpen?"▾":"▸"}</span>
        <span style={{fontSize:11,fontWeight:700,color:color}}>{kind}</span>
        {!isOpen&&mat[k+"Number"]&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:bg,color:color,fontFamily:"monospace",marginLeft:2}}>{mat[k+"Number"]}</span>}
        {!isOpen&&st&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:bg,color:statusColor(st),marginLeft:2,fontWeight:700}}>{CYCLE_LABELS[st]||st}</span>}
        {!isOpen&&overdue&&<span style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️+{workingDaysDiff(due14,today())}d</span>}
      </div>
      {isOpen&&<div style={{padding:"8px 10px",background:bg+"22",borderRadius:6,border:"1px solid "+color+"33"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:6}}>
          <select value={st} onChange={function(e){setStatus(mi,mat,kind,e.target.value);}} style={{fontSize:11,padding:"3px 7px",border:"1.5px solid "+color+"66",borderRadius:5,fontFamily:"inherit",fontWeight:700,color:statusColor(st)}}>
            {CYCLE_OPTS.map(function(o){return <option key={o} value={o}>{CYCLE_LABELS[o]}</option>;})}
          </select>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            <span style={{fontSize:9,color:"#555",fontWeight:600}}>N°</span>
            <input type="text" value={mat[k+"Number"]||""} onChange={function(e){updMat(mi,k+"Number",e.target.value);}} placeholder="Ref" style={{width:90,padding:"2px 6px",fontSize:10,border:"1px solid "+color+"44",borderRadius:4}}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            <span style={{fontSize:9,color:"#555",fontWeight:600}}>Target</span>
            <input type="date" value={mat[k+"Target"]||""} onChange={function(e){
              updMat(mi,k+"Target",e.target.value);
              if(e.target.value&&st==="under preparation"){
                // Update due date of open "Prepare" action
                var prepText="Prepare the "+kind+": "+(mat.name||"material")+" — "+td.title;
                if(saveT&&tasks)saveT((tasks||[]).map(function(t){return t.tenderRef===td.id&&t.text===prepText&&t.status!=="done"?Object.assign({},t,{due:e.target.value}):t;}));
              }
            }} style={{fontSize:10,padding:"2px 5px",border:"1px solid "+color+"44",borderRadius:4}}/>
          </div>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            <span style={{fontSize:9,color:"#555",fontWeight:600}}>Submitted</span>
            <input type="date" value={subDone} onChange={function(e){updMat(mi,k+"Done",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid "+color+"44",borderRadius:4}}/>
          </div>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            <span style={{fontSize:9,color:"#555",fontWeight:600}}>Approved</span>
            <input type="date" value={mat[k+"ApprovalDone"]||""} onChange={function(e){updMat(mi,k+"ApprovalDone",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid "+color+"44",borderRadius:4}}/>
          </div>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            <span style={{fontSize:9,color:"#555",fontWeight:600}}>Review</span>
            <select value={mat[k+"Review"]||""} onChange={function(e){updMat(mi,k+"Review",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid "+color+"44",borderRadius:4,fontFamily:"inherit",fontWeight:mat[k+"Review"]?"700":"400",color:mat[k+"Review"]==="A"?"#2e7d32":mat[k+"Review"]==="Rejected"?"#c62828":color}}>
              <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="Rejected">Rejected</option>
            </select>
          </div>
          <div style={{display:"flex",gap:2,alignItems:"center"}}>
            <input type="text" value={mat[k+"LinkLabel"]||""} onChange={function(e){updMat(mi,k+"LinkLabel",e.target.value);}} placeholder="Link label" style={{width:60,padding:"2px 4px",fontSize:9,border:"1px solid "+color+"44",borderRadius:4}}/>
            <input type="url" value={mat[k+"Link"]||""} onChange={function(e){updMat(mi,k+"Link",e.target.value);}} placeholder="https://..." style={{width:95,padding:"2px 4px",fontSize:9,border:"1px solid "+color+"44",borderRadius:4}}/>
            {mat[k+"Link"]&&<a href={mat[k+"Link"]} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{fontSize:9,color:color,padding:"1px 4px",borderRadius:4,background:bg,textDecoration:"none"}}>🔗</a>}
          </div>
          {overdue&&<span style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️ Overdue +{workingDaysDiff(due14,today())}d</span>}
        </div>
      </div>}
    </div>;
  }

  return <div className="card" style={{marginBottom:10}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:open&&mats.length>0?10:0}} onClick={function(){setOpen(!open);}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:13,color:"#aaa"}}>{open?"▾":"▸"}</span>
        <div style={{fontWeight:700,fontSize:13}}>🏗️ Materials {mats.length>0&&<span style={{fontWeight:400,color:"#aaa",fontSize:12}}>({mats.length})</span>}</div>
      </div>
      <button className="btn btn-sm" onClick={function(e){e.stopPropagation();
        var ms=[...mats,{id:uuid(),name:"",specified:"",proposed:"",leadTime:"",
          mssStatus:"",mssTarget:"",mssDone:"",mssApprovalStatus:"",mssApprovalTarget:"",mssApprovalDone:"",mssReview:"",mssLink:"",mssLinkLabel:"",mssNumber:"",
          marStatus:"",marTarget:"",marDone:"",marApprovalStatus:"",marApprovalTarget:"",marApprovalDone:"",marReview:"",marLink:"",marLinkLabel:"",marNumber:"",
          hasPO:false,poNumber:"",poStatus:""}];
        updTd("materials",ms);setOpen(true);
      }}>＋ Material</button>
    </div>

    {open&&<div>
      {mats.length===0&&<div style={{color:"#bbb",fontSize:12,padding:"4px 0"}}>No materials. Click "＋ Material" to add one.</div>}
      {mats.map(function(mat,mi){
        return <div key={mat.id||mi} style={{padding:"8px 10px",background:"#fafaf8",borderRadius:7,border:"1px solid #f0ede6",marginBottom:8}}>

          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6,alignItems:"flex-end"}}>
            <div style={{flex:2,minWidth:120}}>
              <div style={{fontSize:9,fontWeight:700,color:"#aaa",marginBottom:2,textTransform:"uppercase",letterSpacing:".4px"}}>Material name</div>
              <input type="text" value={mat.name||""} onChange={function(e){updMat(mi,"name",e.target.value);}} placeholder="Name" style={{width:"100%",padding:"4px 7px",fontSize:12,fontWeight:600,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box"}}/>
            </div>
            <div style={{flex:2,minWidth:100}}>
              <div style={{fontSize:9,fontWeight:700,color:"#aaa",marginBottom:2,textTransform:"uppercase",letterSpacing:".4px"}}>Specified</div>
              <input type="text" value={mat.specified||""} onChange={function(e){updMat(mi,"specified",e.target.value);}} placeholder="Specified material" style={{width:"100%",padding:"4px 7px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box"}}/>
            </div>
            <div style={{flex:2,minWidth:100}}>
              <div style={{fontSize:9,fontWeight:700,color:"#aaa",marginBottom:2,textTransform:"uppercase",letterSpacing:".4px"}}>Proposed</div>
              <input type="text" value={mat.proposed||""} onChange={function(e){updMat(mi,"proposed",e.target.value);}} placeholder="Proposed material" style={{width:"100%",padding:"4px 7px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box"}}/>
            </div>
            <div style={{flex:1,minWidth:70}}>
              <div style={{fontSize:9,fontWeight:700,color:"#aaa",marginBottom:2,textTransform:"uppercase",letterSpacing:".4px"}}>Lead time</div>
              <input type="text" value={mat.leadTime||""} onChange={function(e){
                var newLead=e.target.value;
                var updatedMats=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,{leadTime:newLead});});
                var maxDays=updatedMats.reduce(function(mx,m){var d=parseLeadDays(m.leadTime||"");return d>mx?d:mx;},0);
                var updates={materials:updatedMats};
                updates.leadTimeDays=maxDays>0?String(maxDays):"30";
                var combined=Object.assign({},td,updates);
                var d=(tenders||[]).map(function(t){return t.id!==combined.id?t:combined;});
                saveTenders(d);setSelTender(d.find(function(t){return t.id===combined.id;}));
              }} placeholder="e.g. 8 wks" style={{width:"100%",padding:"4px 7px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box"}}/>
            </div>
            <button onClick={function(){if(safeConfirm("Remove material?"))updTd("materials",mats.filter(function(_,j){return j!==mi;}));}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:13,flexShrink:0,marginBottom:2}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
            <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:500,fontSize:11}}>
              <input type="checkbox" checked={mat.hasPO||false} onChange={function(e){updMat(mi,"hasPO",e.target.checked);}} style={{width:13,height:13}}/>
              <span style={{color:mat.hasPO?"#b45309":"#888"}}>📦 PO</span>
            </label>
            {mat.hasPO&&<input type="text" value={mat.poNumber||""} onChange={function(e){updMat(mi,"poNumber",e.target.value);}} placeholder="PO number" style={{width:110,padding:"3px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5}}/>}
            {mat.hasPO&&<select value={mat.poStatus||""} onChange={function(e){updMat(mi,"poStatus",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #fed7aa",borderRadius:5,fontFamily:"inherit",color:mat.poStatus==="issued"?"#2e7d32":mat.poStatus==="pending"?"#f57f17":"#555"}}>
              <option value="">— PO status —</option>
              <option value="pending">Pending</option>
              <option value="issued">✅ Issued</option>
              <option value="on hold">On hold</option>
            </select>}
          </div>

          <DocBlock mat={mat} mi={mi} kind="MSS" color="#1a73e8" bg="#e8f0fe"/>
          <DocBlock mat={mat} mi={mi} kind="MAR" color="#7b1fa2" bg="#f3e5f5"/>
        </div>;
      })}
    </div>}
  </div>;
}


function SubmissionSteps({td,TENDER_STEPS,updateStep,tenders,saveTenders,setSelTender,tasks,saveTasks,pkgOwners}){
  var [stepsOpen,setStepsOpen]=useState(true);
  var APPROVAL_OPTS=["—","N/A","Approved A","Approved B","Not Approved C","Rejected D"];
  var HAS_APPROVAL=["acc","pkg","itp","wms"];

  function getDate(key,field){return((td.stepDates||{})[key]||{})[field]||"";}
  function getApprovalStatus(key){return((td.stepDates||{})[key]||{}).approvalStatus||"";}
  function getReference(key){return((td.stepDates||{})[key]||{}).reference||"";}

  function autoAction(text,tag,due){
    if(!saveTasks||!tasks)return;
    var exists=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status!=="done";});
    if(exists)return;
    var owner=(pkgOwners||{})[td.package||""]||td.ownerTender||"";
    var useTag=tag||"Contract";
    var useDue=due||"";
    saveTasks([newTask({text:text,owner:owner,tenderRef:td.id,package:td.package||"",tags:[useTag],status:"pending",due:useDue,note:"Auto-created from contract/SD status",addedBy:"System"}),...(tasks||[])]);
  }
  function linkCell(s){
    var key=s.key;
    return <div style={{marginTop:3}}>
      {((td.stepLinks||{})[key]||[]).map(function(lk,li){return <div key={li} style={{display:"flex",gap:3,marginBottom:2,alignItems:"center"}}>
        <input type="text" value={lk.label||""} onChange={function(e){var ls=((td.stepLinks||{})[key]||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{label:e.target.value});});updateStep(td.id,key,"links",ls);}} placeholder="Label" style={{width:70,padding:"2px 4px",fontSize:9,border:"1px solid #e0ddd8",borderRadius:4}}/>
        <input type="url" value={lk.url||""} onChange={function(e){var ls=((td.stepLinks||{})[key]||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{url:e.target.value});});updateStep(td.id,key,"links",ls);}} placeholder="https://..." style={{flex:1,padding:"2px 4px",fontSize:9,border:"1px solid #e0ddd8",borderRadius:4}}/>
        <button onClick={function(){var ls=((td.stepLinks||{})[key]||[]).filter(function(_,j){return j!==li;});updateStep(td.id,key,"links",ls);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:10,flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ccc";}}>✕</button>
      </div>;})}
      <button onClick={function(){var ls=[...((td.stepLinks||{})[key]||[]),{label:"",url:""}];updateStep(td.id,key,"links",ls);}} style={{fontSize:9,padding:"1px 5px",border:"1px solid #e0ddd8",borderRadius:4,background:"#fafal8",fontFamily:"inherit",cursor:"pointer",color:"#888"}}>＋ link</button>
      {((td.stepLinks||{})[key]||[]).filter(function(lk){return lk.url;}).map(function(lk,li){return <a key={li} href={lk.url} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:9,color:"#3949ab",textDecoration:"none",padding:"1px 5px",borderRadius:4,background:"#f0f0ff",border:"1px solid #d0d0f0",marginLeft:3}}>🔗 {lk.label||"link"}</a>;})}
    </div>;
  }

  // Steps excluding contract (rendered separately at bottom)
  var mainSteps=TENDER_STEPS.filter(function(s){return s.key!=="contract";});
  var contractStep=TENDER_STEPS.find(function(s){return s.key==="contract";});

  return <div>
    <div onClick={function(){setStepsOpen(!stepsOpen);}} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:stepsOpen?12:0}}>
      <span style={{fontSize:13,color:"#aaa"}}>{stepsOpen?"▾":"▸"}</span>
      <div style={{fontWeight:700,fontSize:14}}>Submission Steps</div>
    </div>
    {stepsOpen&&<div>
    <table className="tbl" style={{fontSize:12,marginBottom:16}}>
      <thead style={{position:"sticky",top:0,zIndex:10,background:"#f5f4f0"}}><tr>
        <th>Step</th>
        <th>Status</th>
        <th style={{textAlign:"center",minWidth:120}}>Submission target date</th>
        <th style={{textAlign:"center",minWidth:110}}>Date done</th>
        <th style={{minWidth:200}}>Date of approval / Status</th>
        <th style={{minWidth:100}}>Reference</th>
        <th style={{minWidth:180}}>Comments</th>
      </tr></thead>
      <tbody>{mainSteps.map(function(s){
        var val=(td.steps||{})[s.key]||"";
        var dates=(td.stepDates||{})[s.key]||{};
        var comment=(td.stepComments||{})[s.key]||"";
        var cls=tenderStepClass(s.key,val);
        var showApproval=HAS_APPROVAL.indexOf(s.key)>=0;
        var showReference=s.key==="acc";
        return <tr key={s.key}>
          <td style={{fontWeight:700,color:"#555",whiteSpace:"nowrap",padding:"8px 12px"}}>{s.label}</td>

          <td style={{minWidth:180}}>
            {s.special==="bidders"
              ?<div style={{display:"flex",flexDirection:"column",gap:4}}>
                <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}} style={{border:"1px solid #e8e6df",background:"#fff",fontFamily:"inherit",fontSize:12,cursor:"pointer",outline:"none",borderRadius:5,padding:"3px 7px"}}>
                  {s.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                </select>
                <textarea value={(td.stepComments||{}).bidders||""} onChange={function(e){updateStep(td.id,"bidders","comment",e.target.value);}} placeholder="List bidder names here..." style={{width:"100%",padding:"4px 7px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",resize:"vertical",minHeight:36,maxHeight:100,overflowY:"auto"}}/>
              </div>
              :<div style={{display:"flex",flexDirection:"column",gap:3}}>
                <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}} style={{border:"none",background:"transparent",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer",outline:"none",color:val&&val!=="—"?"inherit":"#bbb"}}>
                  {s.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                </select>
                {s.key==="acc"&&<div style={{display:"flex",gap:4}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:8,fontWeight:800,color:"#888",marginBottom:1}}>SUBCONT.</div>
                    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                      <input type="number" value={td.accAmountSubcontract||""} onChange={function(e){var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{accAmountSubcontract:e.target.value});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} placeholder="0" style={{width:"100%",padding:"2px 24px 2px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4}}/>
                      <span style={{position:"absolute",right:3,fontSize:8,color:"#aaa",pointerEvents:"none"}}>{td.currency||"EUR"}</span>
                    </div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:8,fontWeight:800,color:"#888",marginBottom:1}}>OTHER</div>
                    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                      <input type="number" value={td.accAmountOther||""} onChange={function(e){var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{accAmountOther:e.target.value});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} placeholder="0" style={{width:"100%",padding:"2px 24px 2px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4}}/>
                      <span style={{position:"absolute",right:3,fontSize:8,color:"#aaa",pointerEvents:"none"}}>{td.currency||"EUR"}</span>
                    </div>
                  </div>
                </div>}
              </div>}
          </td>

          <td style={{textAlign:"center"}}>
            <input type="date" value={dates.target||""} onChange={function(e){updateStep(td.id,s.key,"target",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
          </td>

          <td style={{textAlign:"center"}}>
            <input type="date" value={dates.done||""} onChange={function(e){updateStep(td.id,s.key,"done",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
          </td>

          <td style={{minWidth:200}}>
            {showApproval
              ?<div style={{display:"flex",flexDirection:"column",gap:4}}>
                <input type="date" value={dates.approval||""} onChange={function(e){updateStep(td.id,s.key,"approval",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%"}}/>
                <select value={getApprovalStatus(s.key)} onChange={function(e){var cur=Object.assign({},(td.stepDates||{})[s.key]||{});cur.approvalStatus=e.target.value;updateStep(td.id,s.key,"approvalDateObj",cur);var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var sd=Object.assign({},t.stepDates||{});sd[s.key]=Object.assign({},sd[s.key]||{},{approvalStatus:e.target.value});return Object.assign({},t,{stepDates:sd});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 5px",fontSize:10,fontFamily:"inherit",fontWeight:700,color:getApprovalStatus(s.key).includes("Approved")?"#2e7d32":getApprovalStatus(s.key).includes("Rejected")||getApprovalStatus(s.key).includes("Not Approved")?"#c62828":"#888"}}>
                  {APPROVAL_OPTS.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                </select>
              </div>
              :<span style={{color:"#e0ddd8"}}>—</span>}
          </td>

          <td style={{minWidth:100}}>
            {showReference
              ?<input type="text" value={getReference(s.key)} onChange={function(e){var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var sd=Object.assign({},t.stepDates||{});sd[s.key]=Object.assign({},sd[s.key]||{},{reference:e.target.value});return Object.assign({},t,{stepDates:sd});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} placeholder="Reference…" style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",boxSizing:"border-box"}}/>
              :<span style={{color:"#e0ddd8"}}>—</span>}
          </td>

          <td style={{minWidth:200}}>
            <textarea value={comment} onChange={function(e){updateStep(td.id,s.key,"comment",e.target.value);}} placeholder="Add comment..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:28,overflowY:"auto",boxSizing:"border-box"}}/>
            {linkCell(s)}
          </td>
        </tr>;
      })}</tbody>
    </table>

    {contractStep&&(function(){
      var ct=(td.stepDates||{}).contract||{};
      var accApproval=((td.stepDates||{}).acc||{}).approval||"";

      // Auto target dates (never overwrite existing manual values)
      var autoRequestTarget=accApproval?addWorkingDays(accApproval,3):"";
      var autoCirculateTarget=ct.requestDone?addWorkingDays(ct.requestDone,7):"";
      var autoSignedAllTarget=ct.circulateDone?addWorkingDays(ct.circulateDone,14):"";
      var autoSignedTarget=accApproval?addWorkingDays(accApproval,28):"";

      var requestTarget=ct.requestTarget||autoRequestTarget;
      var circulateTarget=ct.circulateTarget||autoCirculateTarget;
      var signedAllTarget=ct.signedAllTarget||autoSignedAllTarget;
      var signedTarget=ct.signedTarget||autoSignedTarget;
      var signedDone=ct.signedDone||ct.signedAllDone||"";

      function setCtField(field,val){
        var d=(tenders||[]).map(function(t){
          if(t.id!==td.id)return t;
          var sd=Object.assign({},t.stepDates||{});
          sd.contract=Object.assign({},sd.contract||{});
          sd.contract[field]=val;
          return Object.assign({},t,{stepDates:sd});
        });
        saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));
      }
      var dateStyle={border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11};
      var autoDateStyle={border:"1px dashed #c9a84c",borderRadius:5,padding:"3px 6px",fontSize:11,background:"#fffdf0",color:"#b45309"};
      var doneStyle={border:"1px solid #2e7d32",borderRadius:5,padding:"3px 6px",fontSize:11};
      var rowStyle={borderBottom:"1px solid #f5f4f0"};
      var labelStyle={padding:"8px 12px",fontWeight:600,fontSize:12,color:"#555",whiteSpace:"nowrap"};

      function targetStyle(autoVal,manualVal){
        if(!autoVal&&!manualVal)return dateStyle;
        if(!manualVal&&autoVal)return autoDateStyle;
        return dateStyle;
      }
      function targetHint(autoVal,manualVal,label){
        if(autoVal&&!manualVal)return <div style={{fontSize:9,color:"#c9a84c",marginTop:2}}>{label}</div>;
        return null;
      }

      return <div style={{background:"#fff",borderRadius:10,border:"1.5px solid #e8e6df",overflow:"hidden"}}>
        <div style={{padding:"8px 12px",background:"#f5f4f0",fontWeight:700,fontSize:13,borderBottom:"1.5px solid #e8e6df",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          Contract
          {accApproval&&<span style={{fontSize:10,color:"#888",fontWeight:400}}>
            ACC/Aconex approval: <strong style={{color:"#2e7d32"}}>{fmtDate(accApproval)}</strong>
            {autoRequestTarget&&<span style={{color:"#c9a84c"}}> · Request target: {fmtDate(autoRequestTarget)}</span>}
            {autoSignedTarget&&<span style={{color:"#c9a84c"}}> · Signed target: {fmtDate(autoSignedTarget)}</span>}
          </span>}
        </div>
        <table className="tbl" style={{fontSize:12}}>
          <thead style={{background:"#f5f4f0"}}><tr>
            <th style={{minWidth:220}}>Sub-step</th>
            <th style={{textAlign:"center",minWidth:140}}>Target date <span style={{color:"#c9a84c",fontWeight:400,fontSize:9}}>(auto)</span></th>
            <th style={{textAlign:"center",minWidth:130}}>Date done</th>
          </tr></thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={labelStyle}>
                📤 Request sent
                <div style={{fontSize:9,color:"#aaa",fontWeight:400}}>ACC/Aconex approval +3 days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={requestTarget}
                  onChange={function(e){setCtField("requestTarget",e.target.value);}}
                  style={targetStyle(autoRequestTarget,ct.requestTarget)}/>
                {targetHint(autoRequestTarget,ct.requestTarget,"Auto: ACC+3d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={ct.requestDone||""}
                  onChange={function(e){
                    setCtField("requestDone",e.target.value);
                    if(e.target.value)autoAction("Contract to circulate — "+td.title);
                  }}
                  style={ct.requestDone?doneStyle:dateStyle}/>
              </td>
            </tr>
            <tr style={rowStyle}>
              <td style={labelStyle}>
                📋 Contract to circulate
                <div style={{fontSize:9,color:"#aaa",fontWeight:400}}>Request done +7 days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={circulateTarget}
                  onChange={function(e){setCtField("circulateTarget",e.target.value);}}
                  style={targetStyle(autoCirculateTarget,ct.circulateTarget)}/>
                {targetHint(autoCirculateTarget,ct.circulateTarget,"Auto: request done+7d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={ct.circulateDone||""}
                  onChange={function(e){
                    setCtField("circulateDone",e.target.value);
                    if(e.target.value)autoAction("Contract to be signed internally and by the sub — "+td.title);
                  }}
                  style={ct.circulateDone?doneStyle:dateStyle}/>
              </td>
            </tr>
            <tr style={rowStyle}>
              <td style={labelStyle}>
                ✍️ Contract to be signed by all
                <div style={{fontSize:9,color:"#aaa",fontWeight:400}}>Circulate done +14 days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={signedAllTarget}
                  onChange={function(e){setCtField("signedAllTarget",e.target.value);}}
                  style={targetStyle(autoSignedAllTarget,ct.signedAllTarget)}/>
                {targetHint(autoSignedAllTarget,ct.signedAllTarget,"Auto: circulate done+14d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={ct.signedAllDone||""}
                  onChange={function(e){
                    setCtField("signedAllDone",e.target.value);
                    if(e.target.value)setCtField("signedDone",e.target.value);
                  }}
                  style={ct.signedAllDone?doneStyle:dateStyle}/>
              </td>
            </tr>
            <tr style={{background:"#fffdf0"}}>
              <td style={Object.assign({},labelStyle,{color:"#b45309"})}>
                🏁 Signed contract
                <div style={{fontSize:9,color:"#c9a84c",fontWeight:400}}>ACC/Aconex approval +28 working days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={signedTarget}
                  onChange={function(e){setCtField("signedTarget",e.target.value);}}
                  style={targetStyle(autoSignedTarget,ct.signedTarget)}
                  title={autoSignedTarget?"Auto: ACC approval + 28 working days":"Enter ACC approval date to auto-calculate"}/>
                {targetHint(autoSignedTarget,ct.signedTarget,"Auto: ACC+28wd")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" value={signedDone}
                  onChange={function(e){
                    setCtField("signedDone",e.target.value);
                    if(e.target.value&&td.hasSD){
                      var qtag=qualityTag(td.package||"");
                      var sdText="SD to be submitted: "+td.title;
                      autoAction(sdText,qtag,td.sdTarget||"");
                    }
                  }}
                  style={ct.signedAllDone&&!ct.signedDone?Object.assign({},autoDateStyle,{color:"#2e7d32"}):signedDone?doneStyle:dateStyle}/>
                {ct.signedAllDone&&!ct.signedDone&&<div style={{fontSize:9,color:"#2e7d32",marginTop:2}}>Auto from row above</div>}
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{padding:"8px 12px",borderTop:"1px solid #f0ede6"}}>
          <textarea value={(td.stepComments||{}).contract||""} onChange={function(e){updateStep(td.id,"contract","comment",e.target.value);}} placeholder="Contract comments..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"5px 8px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:36,boxSizing:"border-box"}}/>
        </div>
      </div>;
    })()}
    </div>}
  </div>;
}


function TendersView({tenders,saveTenders,packages,people,tasks,saveTasks,contractors,pkgOwners,jumpTender,clearJumpTender,jumpFrom,onBack}){

  const [pkgFilter,setPkgFilter]=useState("all");
  const [searchQ,setSearchQ]=useState("");
  const [sortCol,setSortCol]=useState("title");
  const [sortDir,setSortDir]=useState("asc");
  const [selTender,setSelTender]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [processPct,setProcessPct]=useState({});
  const [processBids,setProcessBids]=useState({});

  const allPkgs=[...new Set((tenders||[]).map(function(t){return t.package;}).filter(Boolean))].sort();

  function toggleSort(col){if(sortCol===col)setSortDir(function(d){return d==="asc"?"desc":"asc";});else{setSortCol(col);setSortDir("asc");}}
  function sortIcon(col){if(sortCol!==col)return " ↕";return sortDir==="asc"?" ↑":" ↓";}

  var filtered=React.useMemo(function(){
    var list=(tenders||[]).filter(function(t){
      if(pkgFilter!=="all"&&t.package!==pkgFilter)return false;
      if(searchQ){var q=searchQ.toLowerCase();if(!(t.title||"").toLowerCase().includes(q)&&!(t.ownerTender||"").toLowerCase().includes(q)&&!(t.package||"").toLowerCase().includes(q))return false;}
      return true;
    });
    return list.slice().sort(function(a,b){
      var r=0;
      if(sortCol==="package"){r=(a.package||"").localeCompare(b.package||"")||((a.title||"").localeCompare(b.title||""));}
      else if(sortCol==="owner"){r=(a.ownerTender||"").localeCompare(b.ownerTender||"");}
      else if(sortCol==="acc"){r=((a.steps||{}).acc||"").localeCompare(((b.steps||{}).acc)||"");}
      else if(sortCol==="contract"){r=((a.steps||{}).contract||"").localeCompare(((b.steps||{}).contract)||"");}
      else{r=(a.title||"").localeCompare(b.title||"");}
      return sortDir==="asc"?r:-r;
    });
  },[tenders,pkgFilter,searchQ,sortCol,sortDir]);

  function openNew(){var nt=newTender();var d=[nt,...(tenders||[])];saveTenders(d);setSelTender(nt);}
  function openEdit(td){setFormData(JSON.parse(JSON.stringify(td)));setShowForm(true);}
  function saveTender(td){
    var d=(tenders||[]).find(function(x){return x.id===td.id;})?(tenders||[]).map(function(x){return x.id===td.id?td:x;}):[td,...(tenders||[])];
    saveTenders(d);setShowForm(false);if(selTender&&selTender.id===td.id)setSelTender(td);
  }
  function delTender(id){saveTenders((tenders||[]).filter(function(t){return t.id!==id;}));setSelTender(null);}

  function autoActionForTender(td2,text){
    if(!saveTasks||!tasks)return;
    var exists=(tasks||[]).some(function(t){return t.tenderRef===td2.id&&t.text===text&&t.status!=="done";});
    if(exists)return;
    var owner=(pkgOwners||{})[td2.package||""]||td2.ownerTender||"";
    saveTasks([newTask({text:text,owner:owner,tenderRef:td2.id,package:td2.package||"",tags:["Contract"],status:"pending",note:"Auto-created from contract/ACC status",addedBy:"System"}),...(tasks||[])]);
  }
  function updateStep(tdId,step,field,val){
    var d=(tenders||[]).map(function(t){
      if(t.id!==tdId)return t;
      var sd=Object.assign({},t.stepDates||{});
      if(!sd[step])sd[step]={target:"",done:""};
      var steps=Object.assign({},t.steps||{});
      var sc=Object.assign({},t.stepComments||{});
      var sl=Object.assign({},t.stepLinks||{});
      if(!sl[step])sl[step]=[];
      if(field==="status")steps[step]=val;
      else if(field==="comment"){sc[step]=val;}
      else if(field==="links"){sl[step]=val;}
      else if(field==="approval"||field==="target"||field==="done"||field==="bids"){var cur=Object.assign({},sd[step]||{});cur[field]=val;sd[step]=cur;}
      else{var cur2=Object.assign({},sd[step]);cur2[field]=val;sd[step]=cur2;}
      return Object.assign({},t,{steps:steps,stepDates:sd,stepComments:sc,stepLinks:sl});
    });
    saveTenders(d);
    var updatedTd=d.find(function(t){return t.id===tdId;});
    if(selTender&&selTender.id===tdId)setSelTender(updatedTd);
    if(updatedTd&&(step==="acc")&&(field==="approvalDateObj")){
      var accApproved=(updatedTd.stepDates||{}).acc||{};
      var reqDone=((updatedTd.stepDates||{}).contract||{}).requestDone||"";
      if(!reqDone)autoActionForTender(updatedTd,"Request to be sent — "+updatedTd.title);
    }
  }

  var linkedTasks=selTender?(tasks||[]).filter(function(t){return t.tenderRef===selTender.id;}):[];

  if(selTender){
    var td=selTender;
    var linkedTasks=(tasks||[]).filter(function(t){return t.tenderRef===td.id;});
    function updTd(field,val){var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{[field]:val});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}
    var cur=td.currency||"EUR";
    var budget=Number(td.budget)||0;
    var accSub=Number(td.accAmountSubcontract)||0;
    var accOther=Number(td.accAmountOther)||0;
    var accTotal=accSub+accOther;
    var treated=Number(td.accAmountTreated)||0;
    var matProposedTotal=(td.materials||[]).reduce(function(s,m){return s+Number(m.proposed||0);},0);
    var proposed=matProposedTotal>0?matProposedTotal:accTotal;
    var instructed=Number(td.instructionAmount)||0;
    var isReleased=td.released||false;
    var effectiveCost=proposed;
    var variance=budget>0&&effectiveCost>0?budget-effectiveCost:0;
    var varianceLabel="Budget − Proposed";
    var linkedContracts=(contractors||[]).flatMap(function(ctr){return (ctr.contracts||[]).filter(function(ct){return ct.tenderRef===td.id;}).map(function(ct){return{ct,ctr};});});
    var contractTotal=linkedContracts.reduce(function(s,x){return s+Number(x.ct.amount||0);},0);
    var addendumTotal=linkedContracts.reduce(function(s,x){return s+(x.ct.addendums||[]).reduce(function(s2,ad){return s2+Number(ad.amount||0);},0);},0);
    var contractGrand=contractTotal+addendumTotal;
    // Use contract total as instructed if available
    var instructedAmount=contractGrand>0?contractGrand:Number(td.instructionAmount)||0;

    return <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>

      <div style={{width:200,flexShrink:0,background:"#fff",borderRadius:12,border:"1.5px solid #e8e6df",overflow:"hidden",position:"sticky",top:0,alignSelf:"flex-start"}}>
        <div style={{padding:"8px 10px",borderBottom:"1.5px solid #e8e6df",fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Tenders</div>
        <div style={{padding:"6px 8px",borderBottom:"1px solid #f0ede6"}}>
          <select value={pkgFilter} onChange={function(e){setPkgFilter(e.target.value);}} style={{fontSize:11,border:"none",background:"transparent",fontFamily:"inherit",width:"100%"}}>
            <option value="all">All packages</option>
            {allPkgs.map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div style={{maxHeight:600,overflowY:"auto"}}>
          {filtered.map(function(t){var isActive=t.id===selTender.id;return <div key={t.id} onClick={function(){setSelTender(t);}} style={{padding:"7px 10px",cursor:"pointer",background:isActive?"#f0ede6":"transparent",borderLeft:"3px solid "+(isActive?"#c9a84c":"transparent"),fontSize:11,fontWeight:isActive?700:400}}>{t.title}</div>;})}
        </div>
      </div>

      <div style={{flex:1,minWidth:0}}>

        <div className="page-hdr" style={{marginBottom:12}}>
          {onBack&&<button className="btn btn-sm" onClick={onBack} style={{marginRight:4,flexShrink:0,alignSelf:"flex-start",marginTop:4,color:"#3949ab",border:"1px solid #3949ab"}}>← Back to {jumpFrom}</button>}
          <button className="btn btn-sm" onClick={function(){setSelTender(null);onBack?null:null;}} style={{marginRight:8,flexShrink:0,alignSelf:"flex-start",marginTop:4}}>← Tenders</button>
          <div style={{flex:1}}>
            <input type="text" value={td.title||""} onChange={function(e){updTd("title",e.target.value);}} placeholder="Tender title" style={{fontSize:22,fontWeight:700,fontFamily:"'DM Serif Display',serif",border:"none",borderBottom:"1.5px solid #e8e6df",background:"transparent",outline:"none",width:"100%",padding:"2px 0",marginBottom:4}}/>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>PKG</span>
                <select value={td.package||""} onChange={function(e){updTd("package",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",fontFamily:"inherit"}}>
                  <option value="">—</option>
                  {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>OWNER</span>
                <select value={td.ownerTender||""} onChange={function(e){updTd("ownerTender",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",fontFamily:"inherit"}}>
                  <option value="">—</option>
                  {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>WBS</span>
                <input type="text" value={td.wbs||""} onChange={function(e){updTd("wbs",e.target.value);}} placeholder="WBS-001" style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",width:90}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>CURRENCY</span>
                <select value={td.currency||"EUR"} onChange={function(e){updTd("currency",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px",fontFamily:"inherit"}}>
                  {["EUR","USD","GBP","CHF","AED","SAR"].map(function(x){return <option key={x} value={x}>{x}</option>;})}
                </select>
              </div>

              <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:"#aaa",fontWeight:700}}>TARGET START</span>
                <input type="date" value={td.startOnSite||""} onChange={function(e){updTd("startOnSite",e.target.value);}} style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px"}}/>
                {(function(){
                  var proc=calcProcurement(td);
                  var procDelivery=proc.deliveryDate||"";
                  var startOnSite=td.startOnSite||"";
                  if(!procDelivery)return null;
                  var marginDays=startOnSite?(function(){var d1=new Date(procDelivery);var d2=new Date(startOnSite);return Math.round((d2-d1)/(1000*60*60*24));})():null;
                  return <div style={{display:"flex",gap:5,alignItems:"center"}}>
                    <span style={{fontSize:10,color:"#555"}}>→ Procurement delivers: <strong style={{color:marginDays!==null&&marginDays<0?"#c62828":"#2e7d32"}}>{fmtDate(procDelivery)}</strong></span>
                    {marginDays!==null&&<span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:6,background:marginDays<0?"#fce4ec":marginDays<7?"#fff8e1":"#e8f5e9",color:marginDays<0?"#c62828":marginDays<7?"#f57f17":"#2e7d32"}}>{marginDays>0?"+":""}{marginDays}d</span>}
                  </div>;
                })()}
              </div>
              <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:500,fontSize:11}}>
                <input type="checkbox" checked={isReleased} onChange={function(e){updTd("released",e.target.checked);}} style={{width:13,height:13}}/>
                <span style={{color:isReleased?"#2e7d32":"#888"}}>✅ Budget Release</span>
              </label>
            </div>
          </div>
          <button className="btn btn-sm btn-danger" onClick={function(){if(safeConfirm("Delete?"))delTender(td.id);}}>🗑</button>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
          <div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f8f7f4"}}>
            <div style={{fontSize:10,color:"#888",marginBottom:2}}>Budget</div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={td.budget||""} onChange={function(e){updTd("budget",e.target.value);}} placeholder="0" style={{fontSize:16,fontWeight:800,border:"1px solid #e8e6df",borderRadius:5,background:"#fff",width:"100%",padding:"2px 6px",outline:"none",fontFamily:"inherit"}}/>
              <span style={{fontSize:10,color:"#aaa"}}>{cur}</span>
            </div>
          </div>
          <div className="card" style={{flex:1,minWidth:130,marginBottom:0,padding:"10px 14px",background:"#f0f8ff"}}>
            <div style={{fontSize:10,color:"#1a73e8",marginBottom:2}}>ACC proposed</div>
            <div style={{fontSize:16,fontWeight:800,color:"#1a73e8"}}>{accTotal>0?accTotal.toLocaleString():"—"} {cur}</div>
            <div style={{fontSize:10,color:"#888"}}>Sub {accSub.toLocaleString()} + Other {accOther.toLocaleString()}</div>
          </div>
          <div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f0fff4"}}>
            <div style={{fontSize:10,color:"#2e7d32",marginBottom:2}}>Instructed</div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={td.instructionAmount||""} onChange={function(e){updTd("instructionAmount",e.target.value);}} placeholder="0" style={{fontSize:16,fontWeight:800,border:"1px solid #c8e6c9",borderRadius:5,background:"#fff",width:"100%",padding:"2px 6px",outline:"none",fontFamily:"inherit",color:"#2e7d32"}}/>
              <span style={{fontSize:10,color:"#aaa"}}>{cur}</span>
            </div>
          </div>
          {budget>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:effectiveCost>0&&variance<0?"#fff0f0":effectiveCost>0?"#f0fff4":"#f8f7f4"}}>
            <div style={{fontSize:10,color:effectiveCost>0?(variance<0?"#c62828":"#2e7d32"):"#888",marginBottom:2}}>{effectiveCost>0?varianceLabel:"Variance"}</div>
            <div style={{fontSize:16,fontWeight:800,color:effectiveCost>0?(variance<0?"#c62828":"#2e7d32"):"#bbb"}}>{effectiveCost>0?(variance>0?"+":"")+variance.toLocaleString()+" "+cur:"—"}</div>
            <div style={{fontSize:10,color:"#aaa"}}>{effectiveCost>0?(variance<0?"⚠️ Over budget":"✅ Under budget"):"No cost entered yet"}{effectiveCost>0&&treated===0?" (est.)":""}</div>
          </div>}
          {contractGrand>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#fff8f0"}}>
            <div style={{fontSize:10,color:"#b45309",marginBottom:2}}>Contracts ({linkedContracts.length})</div>
            <div style={{fontSize:16,fontWeight:800,color:"#b45309"}}>{contractGrand.toLocaleString()} {cur}</div>
            <div style={{fontSize:10,color:"#aaa"}}>Base {contractTotal.toLocaleString()} + Add. {addendumTotal.toLocaleString()}</div>
          </div>}
        </div>

        {(function(){
          var notes=Array.isArray(td.tenderNotes)?td.tenderNotes:(td.notes?[{id:uuid(),title:"Note",content:td.notes}]:[]);
          return <div className="card" style={{marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:notes.length>0?10:0}}>
              <div style={{fontWeight:700,fontSize:13}}>📝 Notes ({notes.length})</div>
              <button className="btn btn-sm" onClick={function(){var ns=[...notes,{id:uuid(),title:"Note "+(notes.length+1),content:"",open:true}];updTd("tenderNotes",ns);}}>＋ Note</button>
            </div>
            {notes.map(function(note,ni){
              function updNote(field,val){var ns=notes.map(function(n,j){return j!==ni?n:Object.assign({},n,{[field]:val});});updTd("tenderNotes",ns);}
              return <div key={note.id||ni} style={{border:"1px solid #e8e6df",borderRadius:8,marginBottom:8,overflow:"hidden"}}>
                <div onClick={function(){updNote("open",!note.open);}} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",cursor:"pointer",background:note.open?"#f8f7f4":"#fff"}}>
                  <span style={{fontSize:12,color:"#aaa"}}>{note.open?"▾":"▸"}</span>
                  <input type="text" value={note.title||""} onChange={function(e){e.stopPropagation();updNote("title",e.target.value);}} onClick={function(e){e.stopPropagation();}} placeholder="Note title..." style={{flex:1,border:"none",background:"transparent",fontWeight:600,fontSize:12,outline:"none",fontFamily:"inherit"}}/>
                  <button onClick={function(e){e.stopPropagation();if(safeConfirm("Delete note?"))updTd("tenderNotes",notes.filter(function(_,j){return j!==ni;}));}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:12}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
                </div>
                {note.open&&<div style={{padding:"8px 10px",borderTop:"1px solid #f0ede6"}}>
                  <textarea value={note.content||""} onChange={function(e){updNote("content",e.target.value);}} placeholder="Write your note here..." style={{width:"100%",minHeight:80,padding:"6px 8px",fontSize:12,border:"1px solid #e8e6df",borderRadius:6,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
                </div>}
              </div>;
            })}
          </div>;
        })()}

        <div className="card" style={{marginBottom:10}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:"#7b1fa2"}}>🎯 Next Step</div>
          <textarea value={td.nextStep||""} onChange={function(e){updTd("nextStep",e.target.value);}} placeholder="Describe the next step or action required for this tender…" style={{width:"100%",minHeight:60,padding:"7px 10px",fontSize:12,border:"1.5px solid #ce93d8",borderRadius:7,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
        </div>
        <MaterialsPanel td={td} updTd={updTd} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} saveT={saveTasks} tasks={tasks} pkgOwners={pkgOwners}/>

        {(function(){
          var hasSd=td.hasSD||false;
          // Unified SD status (merge legacy submission + approval statuses)
          var sdEff=(function(){
            var app=td.sdApprovalStatus||"";
            var sub=td.sdStatus||"";
            if(app==="approved")return"approved";
            if(app&&app!=="")return"pending approval";
            return sub;
          })();
          var CYCLE_OPTS=["","under preparation","submitted","pending approval","approved","rejected"];
          var CYCLE_LABELS={"":"— Status —","under preparation":"Under preparation","submitted":"Submitted","pending approval":"Pending approval","approved":"✅ Approved","rejected":"❌ Rejected"};
          function sdStatusColor(st){
            if(st==="approved")return"#2e7d32";
            if(st==="rejected")return"#c62828";
            if(st==="pending approval"||st==="submitted")return"#f57f17";
            if(st==="under preparation")return"#1a73e8";
            return"#888";
          }
          function sdStepAction(newStatus){
            if(!saveTasks||!tasks)return;
            var qtag=qualityTag(td.package||"");
            var base="SD — "+td.title;
            var ACTIONS={
              "under preparation":{text:"Prepare the "+base},
              "submitted":{text:"Get approval for "+base},
              "pending approval":{text:"Get approval for "+base},
              "rejected":{text:"Resubmit "+base}
            };
            var allTexts=["Prepare the "+base,"Get approval for "+base,"Resubmit "+base,"SD to be submitted: "+td.title];
            var owner=(pkgOwners||{})[td.package||""]||td.ownerTender||"";
            var updated=(tasks||[]).map(function(t){
              if(t.tenderRef!==td.id)return t;
              if(allTexts.indexOf(t.text)>=0&&t.status!=="done"){
                var keepOpen=ACTIONS[newStatus]&&t.text===ACTIONS[newStatus].text;
                if(!keepOpen)return Object.assign({},t,{status:"done",completedAt:today()});
              }
              return t;
            });
            var target=ACTIONS[newStatus];
            if(target){
              var exists=updated.some(function(t){return t.tenderRef===td.id&&t.text===target.text&&t.status!=="done";});
              if(!exists){
                var tgtDate=newStatus==="under preparation"?(td.sdTarget||""):"";
                updated=[newTask({text:target.text,owner:owner,due:tgtDate,tenderRef:td.id,package:td.package||"",importance:2,urgence:2,tags:[qtag],note:"Auto — SD status: "+newStatus,addedBy:"System"}),...updated];
              }
            }
            saveTasks(updated);
          }
          function setSdStatus(val){
            updTd("sdStatus",val);
            if(val==="approved")updTd("sdApprovalStatus","approved");
            else if(val==="pending approval")updTd("sdApprovalStatus","pending approval");
            else updTd("sdApprovalStatus","");
            sdStepAction(val);
          }
          var sdDue14=td.sdDone?(function(){var d=new Date(td.sdDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
          var sdOverdue=sdEff!=="approved"&&sdDue14&&sdDue14<today();
          return <div className="card" style={{marginBottom:10}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:600,fontSize:13,marginBottom:hasSd?10:0}}>
              <input type="checkbox" checked={hasSd} onChange={function(e){updTd("hasSD",e.target.checked);}} style={{width:14,height:14}}/>
              📐 Shop Drawing (SD)
              {!hasSd?null:sdEff&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:8,background:"#e0f2f1",color:sdStatusColor(sdEff),fontWeight:700,marginLeft:4}}>{CYCLE_LABELS[sdEff]||sdEff}</span>}
              {hasSd&&sdOverdue&&<span style={{fontSize:10,color:"#c62828",fontWeight:700}}>⚠️+{workingDaysDiff(sdDue14,today())}d</span>}
            </label>
            {hasSd&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:"8px 10px",background:"#e0f2f122",borderRadius:7,border:"1px solid #00695c33"}}>
              <select value={sdEff} onChange={function(e){setSdStatus(e.target.value);}} style={{padding:"3px 8px",fontSize:11,border:"1.5px solid #00695c66",borderRadius:5,fontFamily:"inherit",fontWeight:700,color:sdStatusColor(sdEff)}}>
                {CYCLE_OPTS.map(function(o){return <option key={o} value={o}>{CYCLE_LABELS[o]}</option>;})}
              </select>
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Target</span><input type="date" value={td.sdTarget||""} onChange={function(e){
                updTd("sdTarget",e.target.value);
                if(e.target.value&&sdEff==="under preparation"&&saveTasks&&tasks){
                  var prepText="Prepare the SD — "+td.title;
                  saveTasks((tasks||[]).map(function(t){return t.tenderRef===td.id&&t.text===prepText&&t.status!=="done"?Object.assign({},t,{due:e.target.value}):t;}));
                }
              }} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Submitted</span><input type="date" value={td.sdDone||""} onChange={function(e){updTd("sdDone",e.target.value);}} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Approved</span><input type="date" value={td.sdApprovalDone||""} onChange={function(e){updTd("sdApprovalDone",e.target.value);}} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                <span style={{fontSize:10,color:"#888",fontWeight:600}}>Review</span>
                <select value={td.sdReview||""} onChange={function(e){updTd("sdReview",e.target.value);}} style={{padding:"3px 6px",fontSize:11,border:"1px solid #00695c44",borderRadius:4,fontFamily:"inherit",fontWeight:td.sdReview?"700":"400",color:td.sdReview==="A"?"#2e7d32":td.sdReview==="Rejected"?"#c62828":"#555"}}>
                  <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="Rejected">Rejected</option>
                </select>
              </div>
              {sdOverdue&&<span style={{fontSize:10,color:"#c62828",fontWeight:700}}>⚠️ Overdue +{workingDaysDiff(sdDue14,today())}d</span>}
            </div>}
          </div>;
        })()}

      <div className="card">

        {(function(){
          var proc=calcProcurement(td);
          var todayStr=today();
          return <div className="card" style={{marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13}}>📊 Procurement Timeline</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {(function(){
                  var matMax=(td.materials||[]).reduce(function(m,mat){var d=parseLeadDays(mat.leadTime||"");return d>m?d:m;},0);
                  var useManual=td.leadTimeManual||false;
                  var displayVal=useManual?(td.leadTimeDays||""):(matMax>0?matMax:30);
                  return <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:9,fontWeight:700,color:"#7b1fa2"}}>LEAD</span>

                    <div style={{display:"flex",border:"1px solid #ce93d8",borderRadius:6,overflow:"hidden"}}>
                      <button onClick={function(e){e.stopPropagation();var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{leadTimeManual:false,leadTimeDays:String(matMax>0?matMax:30)});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}}
                        style={{padding:"2px 8px",fontSize:9,fontWeight:700,border:"none",cursor:"pointer",fontFamily:"inherit",
                          background:!useManual?"#ce93d8":"#fff",color:!useManual?"#fff":"#7b1fa2"}}>
                        📦 Material
                      </button>
                      <button onClick={function(e){e.stopPropagation();updTd("leadTimeManual",true);}}
                        style={{padding:"2px 8px",fontSize:9,fontWeight:700,border:"none",cursor:"pointer",fontFamily:"inherit",
                          background:useManual?"#ce93d8":"#fff",color:useManual?"#fff":"#7b1fa2"}}>
                        ✏️ Manual
                      </button>
                    </div>

                    {useManual
                      ?<input type="number" value={td.leadTimeDays||""} onChange={function(e){e.stopPropagation();updTd("leadTimeDays",e.target.value);}} onClick={function(e){e.stopPropagation();}} placeholder="30" autoFocus style={{width:55,padding:"2px 6px",fontSize:12,fontWeight:700,border:"1.5px solid #ce93d8",borderRadius:5,color:"#7b1fa2"}}/>
                      :<span style={{fontSize:12,fontWeight:800,color:"#7b1fa2",minWidth:30}}>{displayVal}</span>}
                    <span style={{fontSize:9,color:"#aaa"}}>days</span>
                    {!useManual&&matMax===0&&<span style={{fontSize:9,color:"#aaa"}}>(default)</span>}
                    {!useManual&&matMax>0&&<span style={{fontSize:9,color:"#888"}}>max of {(td.materials||[]).length} material{(td.materials||[]).length>1?"s":""}</span>}
                  </div>;
                })()}
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:9,fontWeight:700,color:"#aaa"}}>SD RESUB</span>
                  <select value={td.sdResubCount||0} onChange={function(e){updTd("sdResubCount",Number(e.target.value));}} style={{padding:"2px 5px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit"}}>
                    <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
              <div style={{flex:1,minWidth:110,padding:"7px 10px",borderRadius:8,background:"#f8f7f4",border:"1px solid #ede9e3"}}>
                <div style={{fontSize:9,color:"#888",fontWeight:700,marginBottom:2}}>PROCUREMENT START</div>
                <div style={{fontSize:13,fontWeight:800,color:proc.procStart&&proc.procStart<todayStr?"#c62828":"#1a1a1a"}}>{proc.procStart?fmtDate(proc.procStart):"—"}</div>
                {proc.procStart&&proc.procStart<todayStr&&<div style={{fontSize:9,color:"#c62828"}}>⚠️ Already past</div>}
              </div>
              <div style={{flex:1,minWidth:110,padding:"7px 10px",borderRadius:8,background:"#f0f8ff",border:"1px solid #bbdefb"}}>
                <div style={{fontSize:9,color:"#1a73e8",fontWeight:700,marginBottom:2}}>DELIVERY DATE</div>
                <div style={{fontSize:13,fontWeight:800,color:"#1a73e8"}}>{proc.deliveryDate?fmtDate(proc.deliveryDate):"—"}</div>
                <div style={{fontSize:9,color:"#aaa"}}>Total: {proc.totalDays}d incl. {proc.LEAD}d lead</div>
              </div>
              {proc.margin!==null&&proc.margin!==undefined&&<div style={{flex:1,minWidth:110,padding:"7px 10px",borderRadius:8,background:proc.margin<0?"#fff0f0":proc.margin<7?"#fff8e1":"#f0fff4",border:"1px solid "+(proc.margin<0?"#f5c6cb":proc.margin<7?"#ffe082":"#c8e6c9")}}>
                <div style={{fontSize:9,color:proc.margin<0?"#c62828":proc.margin<7?"#f57f17":"#2e7d32",fontWeight:700,marginBottom:2}}>MARGIN VS SITE DATE</div>
                <div style={{fontSize:13,fontWeight:800,color:proc.margin<0?"#c62828":proc.margin<7?"#f57f17":"#2e7d32"}}>{proc.margin>0?"+":""}{proc.margin}d</div>
                <div style={{fontSize:9,color:"#aaa"}}>{proc.margin<0?"⚠️ Late":proc.margin<7?"⚡ Tight":"✅ On track"}</div>
              </div>}
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#f8f7f4"}}>
                <th style={{padding:"5px 8px",textAlign:"left",fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",borderBottom:"1.5px solid #e8e6df"}}>Step</th>
                <th style={{padding:"5px 8px",textAlign:"center",fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",borderBottom:"1.5px solid #e8e6df"}}>Target date</th>
                <th style={{padding:"5px 8px",textAlign:"center",fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",borderBottom:"1.5px solid #e8e6df"}}>Date done</th>
                <th style={{padding:"5px 8px",textAlign:"center",fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",borderBottom:"1.5px solid #e8e6df"}}>Duration</th>
                <th style={{padding:"5px 8px",textAlign:"left",fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",borderBottom:"1.5px solid #e8e6df"}}>Status</th>
              </tr></thead>
              <tbody>{proc.steps.map(function(s){
                var isDone=!!s.done;
                var isOverdue=!isDone&&s.date&&s.date<todayStr;
                var daysLate=isOverdue?workingDaysDiff(s.date,todayStr):0;
                var bg=s.highlight?"#f0fff4":"#fff";
                return <tr key={s.key} style={{background:bg,borderBottom:"1px solid #f4f2ef"}}>
                  <td style={{padding:"6px 8px",fontWeight:s.highlight?700:500,color:s.highlight?"#2e7d32":"#333",whiteSpace:"nowrap"}}>
                    {s.sd&&<span style={{fontSize:9,padding:"1px 4px",borderRadius:4,background:"#e3f2fd",color:"#1565c0",marginRight:4}}>SD</span>}
                    {s.manual&&<span style={{fontSize:9,padding:"1px 4px",borderRadius:4,background:"#fff8e1",color:"#f57f17",marginRight:4}}>●</span>}
                    {s.label}
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>
                    {s.manual||s.key==="accSub"
                      ?<span style={{color:isOverdue?"#c62828":"#555",fontWeight:isOverdue?700:400}}>{s.date?fmtDate(s.date):"—"}</span>
                      :<div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>
                        <input type="date" value={s.date||""} onChange={function(e){
                          var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var ov2=Object.assign({},t.procOverrides||{});ov2[s.key]=e.target.value;return Object.assign({},t,{procOverrides:ov2});});
                          saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));
                        }} style={{fontSize:10,padding:"2px 4px",border:"1px solid "+(isOverdue?"#f48fb1":s.overridden?"#ffe082":"#e8e6df"),borderRadius:4,color:isOverdue?"#c62828":"#333",background:s.overridden?"#fffde7":"#fff"}}/>
                        {s.overridden&&<span title={"Auto date: "+fmtDate(s.autoDate||"")+"
Click to reset"} onClick={function(){
                          var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var ov2=Object.assign({},t.procOverrides||{});delete ov2[s.key];return Object.assign({},t,{procOverrides:ov2});});
                          saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));
                        }} style={{cursor:"pointer",fontSize:13,lineHeight:1}} title={"Modified — auto was "+fmtDate(s.autoDate||"")}>⚠️</span>}
                        {!s.overridden&&s.autoDate&&<span style={{fontSize:9,color:"#c9a84c"}} title="Auto-calculated">⚙️</span>}
                      </div>}
                  </td>
                  <td style={{padding:"6px 8px",textAlign:"center",color:isDone?"#2e7d32":"#aaa"}}>{s.done?fmtDate(s.done):"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"center"}}>{s.duration?<span style={{fontSize:10,padding:"1px 6px",borderRadius:10,background:"#e8f0fe",color:"#1a73e8",fontWeight:600}}>{s.duration}d</span>:s.note?<span style={{fontSize:10,color:"#7b1fa2",fontWeight:600}}>{s.note}</span>:"—"}</td>
                  <td style={{padding:"6px 8px"}}>
                    {isDone&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:"#e8f5e9",color:"#2e7d32",fontWeight:600}}>✅ Done</span>}
                    {isOverdue&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:"#fce4ec",color:"#c62828",fontWeight:700}}>⚠️ +{daysLate}d</span>}
                    {!isDone&&!isOverdue&&s.date&&<span style={{fontSize:10,padding:"1px 6px",borderRadius:8,background:"#f5f5f5",color:"#888"}}>Pending</span>}
                    {s.review&&<span style={{fontSize:10,marginLeft:4,padding:"1px 6px",borderRadius:8,background:s.review==="A"?"#e8f5e9":s.review==="Rejected"?"#fce4ec":"#fff8e1",color:s.review==="A"?"#2e7d32":s.review==="Rejected"?"#c62828":"#f57f17",fontWeight:700}}>{s.review}</span>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>;
        })()}

        <SubmissionSteps td={td} TENDER_STEPS={TENDER_STEPS} updateStep={updateStep} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} tasks={tasks} saveTasks={saveTasks} pkgOwners={pkgOwners}/>

      <div className="card" style={{marginTop:10}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Linked Actions ({linkedTasks.length})</div>
        {linkedTasks.length===0
          ?<div style={{color:"#bbb",fontSize:13}}>No actions linked to this tender yet.</div>
          :linkedTasks.map(function(t){
            return <ActionItem key={t.id} task={t}
              onStatusChange={function(val){saveTasks(tasks.map(function(x){return x.id!==t.id?x:Object.assign({},x,{status:val});}));}}
              onUpdate={function(field,val){saveTasks(tasks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));u[field]=val;return u;}));}}
              onDelete={function(){saveTasks((tasks||[]).filter(function(x){return x.id!==t.id;}));}}
              people={people} packages={packages} tags={window._ppTags||[]} tenders={tenders} contractors={contractors} onNavTender={null}/>;
          })}
        <QuickAddTask
          prefill={{tenderRef:td.id, package:td.package||"", owner:td.ownerTender||""}}
          onAdd={function(t){saveTasks([t,...(tasks||[])]);}} people={people}
          tags={window._ppTags||[]} label="Add Task to this tender"
        />
      </div>
      
      </div>
      </div>
    </div>;
  }

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Tenders</div><div className="page-sub">Track submission steps by package</div></div>
      <button className="btn btn-sm" onClick={function(){
  var leftnav=document.querySelector('.leftnav');
  var rsidebar=document.querySelector('.rsidebar');
  var prevL=leftnav?leftnav.style.display:'';
  var prevR=rsidebar?rsidebar.style.display:'';
  if(leftnav)leftnav.style.display='none';
  if(rsidebar)rsidebar.style.display='none';
  window.print();
  setTimeout(function(){
    if(leftnav)leftnav.style.display=prevL;
    if(rsidebar)rsidebar.style.display=prevR;
  },500);
}} style={{marginLeft:"auto"}}>🖨️ Print</button>
      <button className="btn btn-gold" onClick={openNew}>＋ New Tender</button>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input type="text" value={searchQ} onChange={function(e){setSearchQ(e.target.value);}} placeholder="🔍 Search tender, owner..." style={{width:200,padding:"5px 10px",fontSize:12}}/>
      <button className={"fchip"+(pkgFilter==="all"?" on":"")} onClick={function(){setPkgFilter("all");}}>All packages</button>
      {allPkgs.map(function(p){return <button key={p} className={"fchip"+(pkgFilter===p?" on":"")} onClick={function(){setPkgFilter(pkgFilter===p?"all":p);}}>{p}</button>;})}
      {(searchQ||pkgFilter!=="all")&&<button className="btn btn-sm" onClick={function(){setSearchQ("");setPkgFilter("all");}}>✕ Reset</button>}
    </div>
    {(function(){
      var releasedTenders=filtered.filter(function(t){return t.released;});
      var totBudget=releasedTenders.reduce(function(s,t){return s+Number(t.budget||0);},0);
      var totAcc=releasedTenders.reduce(function(s,t){return s+Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0);},0);
      var totInstructed=releasedTenders.reduce(function(s,t){return s+Number(t.instructionAmount||0);},0);
      var totVariance=totBudget-totAcc;
      var totTraite=releasedTenders.reduce(function(s,t){
        var mp=(t.materials||[]).reduce(function(s2,m){return s2+Number(m.proposed||0);},0);
        return s+(mp>0?mp:(Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0)));
      },0);
      var totRestant=totBudget-totTraite;
      if(!totBudget&&!totAcc&&!totInstructed&&releasedTenders.length===0)return null;
      var totAllBudget=filtered.reduce(function(s,t){return s+Number(t.budget||0);},0);
      var totRemainAwarded=totAllBudget-totBudget;
      return <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14,alignItems:"stretch"}}>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px"}}>
          <div style={{fontSize:9,color:"#888",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Total Budget</div>
          <div style={{fontSize:16,fontWeight:800}}>{totAllBudget.toLocaleString()}</div>
          <div style={{fontSize:9,color:"#aaa"}}>{filtered.length} tenders</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:"#e8f5e9"}}>
          <div style={{fontSize:9,color:"#2e7d32",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Total Budget Awarded</div>
          <div style={{fontSize:16,fontWeight:800,color:"#2e7d32"}}>{totBudget.toLocaleString()}</div>
          <div style={{fontSize:9,color:"#aaa"}}>{releasedTenders.length} released</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:"#f0f4ff"}}>
          <div style={{fontSize:9,color:"#3949ab",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Total Proposed</div>
          <div style={{fontSize:16,fontWeight:800,color:"#3949ab"}}>{totAcc>0?totAcc.toLocaleString():"—"}</div>
          <div style={{fontSize:9,color:"#aaa"}}>ACC/ACONEX (released)</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:totVariance<0?"#fff0f0":"#f0fff4",borderLeft:"3px solid "+(totVariance<0?"#c62828":"#2e7d32")}}>
          <div style={{fontSize:9,color:totVariance<0?"#c62828":"#2e7d32",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Variance</div>
          <div style={{fontSize:16,fontWeight:800,color:totVariance<0?"#c62828":"#2e7d32"}}>{(totBudget>0&&totAcc>0)?(totVariance>0?"+":"")+totVariance.toLocaleString():"—"}</div>
          <div style={{fontSize:9,color:"#aaa"}}>Awarded − Proposed</div>
        </div>
        <div className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 12px",background:totRemainAwarded>0?"#fff8e1":"#f0fff4"}}>
          <div style={{fontSize:9,color:totRemainAwarded>0?"#f57f17":"#2e7d32",marginBottom:2,textTransform:"uppercase",fontWeight:600}}>Remain to Award</div>
          <div style={{fontSize:16,fontWeight:800,color:totRemainAwarded>0?"#f57f17":"#2e7d32"}}>{totRemainAwarded.toLocaleString()}</div>
          <div style={{fontSize:9,color:"#aaa"}}>Total − Awarded</div>
        </div>
      </div>;
    })()}
    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">📑</div><div className="empty-txt">No tenders found.</div></div>
      :<table className="tbl">
        <thead><tr>
          <th className="sortable" onClick={function(){toggleSort("title");}}>Tender{sortIcon("title")}</th>
          <th className="sortable" onClick={function(){toggleSort("package");}}>Package{sortIcon("package")}</th>
          <th className="sortable" onClick={function(){toggleSort("owner");}}>Owner{sortIcon("owner")}</th>
          <th style={{textAlign:"right",borderLeft:"2px solid #e0d9cc"}}>Budget</th>
          <th style={{textAlign:"right"}}>Proposed</th>
          <th style={{textAlign:"right"}}>Instructed</th>
          <th style={{textAlign:"right",color:"#888"}}>Variance</th>
          <th style={{textAlign:"center",color:"#555",minWidth:90,borderLeft:"2px solid #e0d9cc"}}>Target start</th>
          <th style={{textAlign:"center",color:"#1a73e8",minWidth:90}}>New Starting Date</th>
          <th style={{textAlign:"center",color:"#888",minWidth:60}}>Proc Variance</th>
          {TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).map(function(s){
            var sortable=s.key==="acc"||s.key==="contract";
            return sortable
              ?<th key={s.key} className="sortable" onClick={function(){toggleSort(s.key);}}>{s.label}{sortIcon(s.key)}</th>
              :<th key={s.key}>{s.label}</th>;
          })}
          <th style={{minWidth:160,color:"#7b1fa2"}}>Next Step</th>
        </tr></thead>
        <tbody>{filtered.map(function(td){
          var steps=td.steps||{};
          return <tr key={td.id} style={{cursor:"pointer"}} onClick={function(){setSelTender(td);}}>
            <td style={{fontWeight:600}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                {td.released&&<span title="Released — included in totals" style={{width:7,height:7,borderRadius:"50%",background:"#2e7d32",flexShrink:0,display:"inline-block"}}/>}
                {td.title}
              </div>
            </td>
            <td>{td.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{td.package}</span>}</td>
            <td>{td.ownerTender&&<OwnerChip owner={td.ownerTender}/>}</td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {td.budget?<span style={{fontSize:11,fontWeight:600}}>{Number(td.budget).toLocaleString()}</span>:<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {(Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0))>0
                ?<span style={{fontSize:11,fontWeight:600,color:"#1a73e8"}}>{(Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0)).toLocaleString()}</span>
                :<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {td.instructionAmount?<span style={{fontSize:11,fontWeight:600,color:"#2e7d32"}}>{Number(td.instructionAmount).toLocaleString()}</span>:<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"right",whiteSpace:"nowrap"}}>
              {(function(){
                var budget=Number(td.budget||0);
                var proposed=Number(td.accAmountSubcontract||0)+Number(td.accAmountOther||0);
                if(!budget||!proposed)return <span style={{color:"#ddd"}}>—</span>;
                var v=budget-proposed;
                return <span style={{fontSize:11,fontWeight:700,color:v<0?"#c62828":"#2e7d32"}}>{v>0?"+":""}{v.toLocaleString()}</span>;
              })()}
            </td>
            <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap",color:"#555"}}>
              {td.startOnSite?fmtDate(td.startOnSite):<span style={{color:"#ddd"}}>—</span>}
            </td>
            <td style={{textAlign:"center",fontSize:11,whiteSpace:"nowrap",fontWeight:600,color:"#1a73e8"}}>
              {(function(){var proc=calcProcurement(td);return proc.deliveryDate?fmtDate(proc.deliveryDate):<span style={{color:"#ddd"}}>—</span>;})()}
            </td>
            <td style={{textAlign:"center",fontSize:11}}>
              {(function(){
                var proc=calcProcurement(td);
                if(!proc.deliveryDate||!td.startOnSite)return <span style={{color:"#ddd"}}>—</span>;
                var m=Math.round((new Date(td.startOnSite)-new Date(proc.deliveryDate))/(1000*60*60*24));
                return <span style={{fontWeight:700,fontSize:11,color:m<0?"#c62828":m<7?"#f57f17":"#2e7d32"}}>{m>0?"+":""}{m}d</span>;
              })()}
            </td>
            {TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).map(function(s){
              var v=steps[s.key]||"";var cls=tenderStepClass(s.key,v);
              var dates=(td.stepDates||{})[s.key]||{};
              var done=dates.done||"";
              var target=dates.target||"";
              var isNA=v==="N/A";
              var isOverdue=target&&target<today()&&!done&&!v.toLowerCase().includes("approved")&&!isNA;
              var isEmpty=!v||v==="—";
              var needsBorderLeft=s.key==="pkg";
              return <td key={s.key} style={{verticalAlign:"top",minWidth:90,borderLeft:needsBorderLeft?"2px solid #e0d9cc":""}}>
                {isNA
                  ?<span style={{fontSize:10,color:"#aaa",fontWeight:700,background:"#f5f5f5",padding:"1px 6px",borderRadius:4}}>N/A</span>
                  :!isEmpty
                  ?<span className={"chip "+cls} style={{fontSize:10,whiteSpace:"nowrap"}}>{v}</span>
                  :!target&&!done
                  ?<span style={{color:"#e8e6df",fontSize:11}}>—</span>
                  :null
                }
                {!isNA&&target&&<div style={{fontSize:9,marginTop:2,color:isOverdue&&!done?"#c62828":"#bbb",fontWeight:isOverdue&&!done?700:400}}>
                  {isOverdue&&!done?"⚠️ ":""}{fmtDate(target)}
                </div>}
                {!isNA&&done&&<div style={{fontSize:9,marginTop:1,color:"#2e7d32",fontWeight:600}}>✓ {fmtDate(done)}</div>}
              </td>;
            })}
            <td style={{minWidth:160,verticalAlign:"top"}} onClick={function(e){e.stopPropagation();}}>
              <textarea value={td.nextStep||""} onChange={function(e){var el=e.target;el.style.height="auto";el.style.height=el.scrollHeight+"px";var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{nextStep:e.target.value});});saveTenders(d);}} ref={function(el){if(el){el.style.height="auto";el.style.height=el.scrollHeight+"px";}}} placeholder="Next step…" rows={1} style={{width:"100%",fontSize:11,padding:"3px 7px",border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",boxSizing:"border-box",resize:"none",overflow:"hidden",lineHeight:1.4,minWidth:160,whiteSpace:"pre-wrap"}}/>
            </td>
          </tr>;
        })}</tbody>
        <tfoot>
          <tr style={{background:"#fafaf8",borderTop:"2px solid #e8e6df"}}>
            <td colSpan={3+TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).length+4} style={{padding:"8px 12px"}}>
              {(function(){
                var totBudget=filtered.reduce(function(s,t){return s+Number(t.budget||0);},0);
                var totInstructed=filtered.reduce(function(s,t){return s+Number(t.instructionAmount||0);},0);
                var totAccSub=filtered.reduce(function(s,t){return s+Number(t.accAmountSubcontract||0);},0);
                var totAccOther=filtered.reduce(function(s,t){return s+Number(t.accAmountOther||0);},0);
                var totAcc=totAccSub+totAccOther;
                var variance=totBudget-totAcc;
                if(totBudget===0&&totInstructed===0&&totAcc===0)return <span style={{fontSize:11,color:"#aaa"}}>No financial data yet — add Budget and Instruction amounts to tenders.</span>;
                return <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase",letterSpacing:".5px",marginRight:4}}>TOTALS ({filtered.length})</span>
                  {totBudget>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#f0ede6",fontSize:11}}><span style={{color:"#888"}}>Budget: </span><strong>{totBudget.toLocaleString()}</strong></div>}
                  {totAcc>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#e8f0fe",fontSize:11}}><span style={{color:"#888"}}>ACC proposed: </span><strong style={{color:"#1a73e8"}}>{totAcc.toLocaleString()}</strong></div>}
                  {totInstructed>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#e8f5e9",fontSize:11}}><span style={{color:"#888"}}>Instructed: </span><strong style={{color:"#2e7d32"}}>{totInstructed.toLocaleString()}</strong></div>}
                  {totBudget>0&&totAcc>0&&<div style={{padding:"3px 10px",borderRadius:7,background:variance<0?"#fce4ec":"#e8f5e9",fontSize:11}}><span style={{color:"#888"}}>Variance (B-C): </span><strong style={{color:variance<0?"#c62828":"#2e7d32"}}>{variance>0?"+":""}{variance.toLocaleString()}</strong><span style={{fontSize:10,marginLeft:4}}>{variance<0?"⚠️ over budget":"✅ under budget"}</span></div>}
                </div>;
              })()}
            </td>
          </tr>
        </tfoot>
      </table>}
    
  </div>;
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
      var duStr=dueDate.toISOString().slice(0,10);

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
          <input type="date" value={form.date} onChange={function(e){set("date",e.target.value);}}/>
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
            <input type="date" value={form.replyDate} onChange={function(e){set("replyDate",e.target.value);}}/>
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

function CollapsibleContract({ct,fin,children}){
  const [open,setOpen]=useState(false);
  var currency=ct.currency||"EUR";
  return <div style={{marginBottom:8,border:"1.5px solid #e8e6df",borderRadius:10,overflow:"hidden",background:"#fff"}}>
    <div onClick={function(){setOpen(!open);}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",background:open?"#f8f7f4":"#fff",userSelect:"none"}}>
      <span style={{fontSize:13,color:"#aaa",flexShrink:0,transition:"transform .15s",transform:open?"rotate(0deg)":"rotate(-90deg)",display:"inline-block"}}>{open?"▾":"▾"}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,fontSize:13,color:"#1a1a1a"}}>{ct.number||"(no #)"} {ct.sapNumber&&<span style={{fontSize:11,color:"#1a73e8",fontWeight:600,marginLeft:4}}>SAP {ct.sapNumber}</span>}</div>
        {ct.description&&<div style={{fontSize:11,color:"#888",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ct.description}</div>}
      </div>
      <div style={{textAlign:"right",flexShrink:0}}>
        {ct.closed
          ?<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#e8f5e9",color:"#2e7d32",fontWeight:700}}>✅ Closed</span>
          :<span style={{fontSize:12,fontWeight:700,color:"#1a1a1a"}}>{fin.total.toLocaleString()} {currency}</span>}
        <div style={{fontSize:10,color:fin.pct>=80?"#2e7d32":"#f57f17"}}>{fin.pct}% certified</div>
        {(function(){
          var certs=ct.certifications||[];
          if(ct.closed||certs.length===0)return null;
          var lastDate=(certs.slice().sort(function(a,b){return (b.date||"").localeCompare(a.date||"");})[0]||{}).date||"";
          if(!lastDate)return null;
          var d=new Date(lastDate);var now=new Date();
          var months=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
          if(months>=2)return <div style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️ Last cert: {fmtMonthYear(lastDate)}</div>;
          return null;
        })()}
      </div>
    </div>
    {open&&<div style={{borderTop:"1.5px solid #e8e6df",padding:"12px 14px"}} onClick={function(e){e.stopPropagation();}}>{children}</div>}
  </div>;
}

function ContractorsView({contractors,saveContractors,packages,people,tasks,tenders,apiKey,correspondences,saveCorrespondences,saveT,onNavTender}){
  var ctrs=contractors||[];
  var tnds=tenders||[];
  var pkgs=packages||[];
  var ppl=people||[];
  var tsks=tasks||[];
  const [pkgFilter,setPkgFilter]=useState("all");
  const [searchQ,setSearchQ]=useState("");
  const [sortCol,setSortCol]=useState("name");
  const [sortDir,setSortDir]=useState("asc");
  const [selCtr,setSelCtr]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [pdfExtracting,setPdfExtracting]=useState(null);
  const [pdfPreview,setPdfPreview]=useState(null);

  function toggleSort(col){if(sortCol===col)setSortDir(function(d){return d==="asc"?"desc":"asc";});else{setSortCol(col);setSortDir("asc");}}
  function sortIcon(col){if(sortCol!==col)return " ↕";return sortDir==="asc"?" ↑":" ↓";}

  const allPkgs=[...new Set(ctrs.map(function(c){return c.package;}).filter(Boolean))].sort();
  var filtered=React.useMemo(function(){
    var list=ctrs.filter(function(c){
      if(pkgFilter!=="all"&&c.package!==pkgFilter)return false;
      if(searchQ){var q=searchQ.toLowerCase();if(!(c.name||"").toLowerCase().includes(q)&&!(c.package||"").toLowerCase().includes(q))return false;}
      return true;
    });
    return list.slice().sort(function(a,b){
      var r=0;
      if(sortCol==="package"){r=(a.package||"").localeCompare(b.package||"")||((a.name||"").localeCompare(b.name||""));}
      else if(sortCol==="owner"){r=(a.owner||"").localeCompare(b.owner||"");}
      else{r=(a.name||"").localeCompare(b.name||"");}
      return sortDir==="asc"?r:-r;
    });
  },[ctrs,pkgFilter,searchQ,sortCol,sortDir]);

  function openNew(){var d=newContractor();setFormData(d);setShowForm(true);}
  function openEdit(ctr){setFormData(JSON.parse(JSON.stringify(ctr)));setShowForm(true);}
  function closeForm(){setShowForm(false);setFormData(null);}
  function saveCtr(cd){
    var d=ctrs.find(function(x){return x.id===cd.id;})?ctrs.map(function(x){return x.id===cd.id?cd:x;}):[cd,...ctrs];
    saveContractors(d);closeForm();if(selCtr&&selCtr.id===cd.id)setSelCtr(cd);
  }
  function delCtr(id){if(safeConfirm("Delete subcontractor?"))saveContractors(ctrs.filter(function(c){return c.id!==id;}));setSelCtr(null);}

  function addContract(ctrId){
    var nc=newContract();
    var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:[...(c.contracts||[]),nc]});});
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function updateContract(ctrId,contractId,field,val){
    var d=ctrs.map(function(c){
      if(c.id!==ctrId)return c;
      var newContracts=(c.contracts||[]).map(function(ct){if(ct.id!==contractId)return ct;var u=Object.assign({},ct);u[field]=val;return u;});
      return Object.assign({},c,{contracts:newContracts});
    });
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function addAddendum(ctrId,contractId){
    var ad=newAddendum();
    var d=ctrs.map(function(c){if(c.id!==ctrId)return c;var ncts=(c.contracts||[]).map(function(ct){if(ct.id!==contractId)return ct;return Object.assign({},ct,{addendums:[...(ct.addendums||[]),ad]});});return Object.assign({},c,{contracts:ncts});});
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function addCertification(ctrId,contractId){
    var cf=newCertification();
    var d=ctrs.map(function(c){if(c.id!==ctrId)return c;var ncts=(c.contracts||[]).map(function(ct){if(ct.id!==contractId)return ct;return Object.assign({},ct,{certifications:[...(ct.certifications||[]),cf]});});return Object.assign({},c,{contracts:ncts});});
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }
  function updateAdItem(ctrId,contractId,field,i,key,val){
    var d=ctrs.map(function(c){
      if(c.id!==ctrId)return c;
      var ncts=(c.contracts||[]).map(function(ct){
        if(ct.id!==contractId)return ct;
        var items=(ct[field]||[]).map(function(item,j){if(j!==i)return item;var u=Object.assign({},item);u[key]=val;return u;});
        var u2=Object.assign({},ct);u2[field]=items;return u2;
      });
      return Object.assign({},c,{contracts:ncts});
    });
    saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));
  }

  var linkedTasks=selCtr?tsks.filter(function(t){return t.contractorRef===selCtr.id;}):[];

  const [sidebarPkg,setSidebarPkg]=useState("all");
  function updateContract2(ctrId,ctId,field,val){if(field==="__delete__"){var d2=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).filter(function(ct2){return ct2.id!==ctId;})});});saveContractors(d2);if(selCtr&&selCtr.id===ctrId)setSelCtr(d2.find(function(c){return c.id===ctrId;}));return;}var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var u=Object.assign({},ct2);u[field]=val;return u;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function updateAdItem2(ctrId,ctId,field,i,key,val){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var items=(ct2[field]||[]).map(function(item,j){if(j!==i)return item;var u=Object.assign({},item);u[key]=val;return u;});var u2=Object.assign({},ct2);u2[field]=items;return u2;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function delAdItem2(ctrId,ctId,field,i){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var u=Object.assign({},ct2);u[field]=(ct2[field]||[]).filter(function(_,j){return j!==i;});return u;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  function addAdItem2(ctrId,ctId,field,newItem){var d=ctrs.map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct2){if(ct2.id!==ctId)return ct2;var u=Object.assign({},ct2);u[field]=[...(ct2[field]||[]),newItem];return u;})});});saveContractors(d);if(selCtr&&selCtr.id===ctrId)setSelCtr(d.find(function(c){return c.id===ctrId;}));}
  if(selCtr){
    var ctr=selCtr;
    var linkedTenders=(ctr.tenderRefs||[ctr.tenderRef].filter(Boolean)).map(function(id){return tnds.find(function(t){return t.id===id;});}).filter(Boolean);
    var sortedCtrs=(ctrs||[]).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");});
    return <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>

      <div style={{width:180,flexShrink:0,background:"#fff",borderRadius:12,border:"1.5px solid #e8e6df",overflow:"hidden",position:"sticky",top:0,alignSelf:"flex-start"}}>
        <div style={{padding:"8px 10px",borderBottom:"1.5px solid #e8e6df"}}>
          <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:4}}>Subcontractors</div>
          <select value={sidebarPkg||"all"} onChange={function(e){setSidebarPkg(e.target.value);}} style={{width:"100%",padding:"3px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",background:"#fafaf8"}}>
            <option value="all">All packages</option>
            {(pkgs||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div style={{maxHeight:"75vh",overflowY:"auto"}}>
          {sortedCtrs.filter(function(c2){return sidebarPkg==="all"||c2.package===sidebarPkg;}).map(function(c2){var isActive=c2.id===selCtr.id;return <div key={c2.id} onClick={function(){setSelCtr(c2);}} style={{padding:"7px 10px",cursor:"pointer",background:isActive?"#f0ede6":"transparent",borderLeft:"3px solid "+(isActive?"#c9a84c":"transparent"),fontSize:11,fontWeight:isActive?700:400}}>
            <div style={{color:isActive?"#1c1c1e":"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c2.name}</div>
            {c2.package&&<div style={{fontSize:9,color:"#aaa",marginTop:1}}>{c2.package}</div>}
          </div>;})}
        </div>
      </div>
      <div style={{flex:1,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <button className="btn btn-sm" onClick={function(){setSelCtr(null);}}>← Back</button>
        <div style={{flex:1}}>
          <div className="page-title">{ctr.name}</div>
          <div style={{fontSize:13,color:"#888",marginTop:2,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            {ctr.package&&<span>📦 {ctr.package}</span>}
            {ctr.owner&&<OwnerChip owner={ctr.owner}/>}
            {linkedTenders.map(function(lt){return lt?<span key={lt.id} style={{padding:"2px 8px",borderRadius:10,background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:11,fontWeight:700}}>📑 {lt.title}</span>:null;})}
          </div>
        </div>
        <button className="btn btn-sm" onClick={function(){openEdit(ctr);}}>✏️ Edit</button>
        <button className="btn btn-sm btn-danger" onClick={function(){delCtr(ctr.id);}}>🗑</button>
        <button className="btn btn-gold" onClick={function(){addContract(ctr.id);}} style={{marginLeft:"auto"}}>＋ Add Contract</button>
      </div>

      {(ctr.contracts||[]).length===0&&<div className="empty" style={{padding:"24px 0"}}><div className="empty-ico">📋</div><div className="empty-txt">No contracts yet. Click "＋ Add Contract" to create one.</div></div>}
      {(ctr.contracts||[]).map(function(ct){
        var fin=contractFinancials(ct);
        var linkedTender=ct.tenderRef?(tnds||[]).find(function(t){return t.id===ct.tenderRef;}):null;
        var navFake={ctrId:ctr.id,ctId:ct.id};
        return <CollapsibleContract key={ct.id} ct={ct} fin={fin}>
          <CollapseContractDetail ctr={ctr} ct={ct} fin={fin} linkedTender={linkedTender}
            updateCtField={updateContract2} updateAdItem={updateAdItem2} delAdItem={delAdItem2} addAdItem={addAdItem2}
            tenders={tnds} nav={navFake} setNav={function(){}} saveT={saveT} tasks={tsks} people={ppl} tags={window._ppTags||[]}/>
        </CollapsibleContract>;
      })}

      <CorrespondenceLog ctrId={selCtr.id} ctrName={selCtr.name} correspondences={correspondences||[]} saveCorrespondences={saveCorrespondences} saveT={saveT} tasks={tsks}/>

      <div className="card">
        <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>Linked Actions ({linkedTasks.length})</div>
        {linkedTasks.length===0
          ?<div style={{color:"#bbb",fontSize:13}}>No actions linked to this subcontractor.</div>
          :linkedTasks.map(function(t){return <ActionItem key={t.id} task={t}
            onStatusChange={function(val){saveT(tsks.map(function(x){return x.id!==t.id?x:Object.assign({},x,{status:val});}));}}
            onUpdate={function(field,val){saveT(tsks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));u[field]=val;return u;}));}}
            onDelete={function(){saveT((tsks||[]).filter(function(x){return x.id!==t.id;}));}}
            people={ppl} packages={pkgs} tags={window._ppTags||[]} tenders={tnds} contractors={ctrs}/>;} )}
        <QuickAddTask
          prefill={{contractorRef:ctr.id, package:ctr.package||"", owner:ctr.owner||""}}
          onAdd={function(t){saveT([t,...(tsks||[])]);}}
          people={ppl} tags={window._ppTags||[]} label="Add Task to this subcontractor"
        />
      </div>
      {showForm&&formData&&<ContractorFormModal data={formData} onChange={setFormData} onSave={saveCtr} onClose={closeForm} people={ppl} packages={pkgs} tenders={tnds}/>}
      
      </div>
    </div>;
  }

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Subcontractors</div><div className="page-sub">Subcontractors, contracts and certifications</div></div>
      <button className="btn btn-gold" onClick={openNew}>+ New Subcontractor</button>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input type="text" value={searchQ} onChange={function(e){setSearchQ(e.target.value);}} placeholder="🔍 Search..." style={{width:180,padding:"5px 10px",fontSize:12}}/>
      <button className={"fchip"+(pkgFilter==="all"?" on":"")} onClick={function(){setPkgFilter("all");}}>All packages</button>
      {allPkgs.map(function(p){return <button key={p} className={"fchip"+(pkgFilter===p?" on":"")} onClick={function(){setPkgFilter(pkgFilter===p?"all":p);}}>{p}</button>;})}
      {(searchQ||pkgFilter!=="all")&&<button className="btn btn-sm" onClick={function(){setSearchQ("");setPkgFilter("all");}}>✕ Reset</button>}
    </div>
    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">🤝</div><div className="empty-txt">No subcontractors found.</div></div>
      :<table className="tbl">
        <thead><tr>
          <th className="sortable" onClick={function(){toggleSort("name");}}>Name{sortIcon("name")}</th>
          <th className="sortable" onClick={function(){toggleSort("package");}}>Package{sortIcon("package")}</th>
          <th className="sortable" onClick={function(){toggleSort("owner");}}>Owner{sortIcon("owner")}</th>
          <th>Corresp.</th><th>Linked Tenders</th><th>Contracts</th><th>Total</th><th>Total Instructed</th><th>Certified</th><th>Remaining</th>
        </tr></thead>
        <tbody>{filtered.map(function(ctr){
          var totVal=(ctr.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).total;},0);
          var totCert=(ctr.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).certified;},0);
          var totRem=totVal-totCert;
          var linkedT=(ctr.tenderRefs||[ctr.tenderRef].filter(Boolean)).map(function(id){return tnds.find(function(t){return t.id===id;});}).filter(Boolean);
          var ctrLetters=(correspondences||[]).filter(function(l){return l.ctrId===ctr.id;});
          var unread=ctrLetters.filter(function(l){return l.type==="received"&&!l.replied;}).length;
          return <tr key={ctr.id} style={{cursor:"pointer"}} onClick={function(){setSelCtr(ctr);}}>
            <td style={{fontWeight:700}}>
              {ctr.name}
              {unread>0&&<span style={{marginLeft:6,display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:"50%",background:"#c62828",color:"#fff",fontSize:10,fontWeight:800,verticalAlign:"middle"}} title={unread+" unanswered letter"+(unread>1?"s":"")}>{unread}</span>}
            </td>
            <td>{ctr.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{ctr.package}</span>}</td>
            <td>{ctr.owner&&<OwnerChip owner={ctr.owner}/>}</td>
            <td style={{textAlign:"center"}}>
              {ctrLetters.length>0
                ?<div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                  {unread>0&&<span style={{fontSize:10,fontWeight:700,color:"#c62828"}}>⚠️ {unread} unanswered</span>}
                  <span style={{fontSize:10,color:"#888"}}>{ctrLetters.length} total</span>
                </div>
                :<span style={{color:"#ddd",fontSize:12}}>—</span>}
            </td>
            <td>{linkedT.length>0?<div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{linkedT.map(function(lt){return lt?<span key={lt.id} className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {lt.title}</span>:null;})}</div>:<span style={{color:"#ddd"}}>—</span>}</td>
            <td><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{[...new Set((ctr.contracts||[]).map(function(ct){return ct.tenderRef;}).filter(Boolean))].map(function(tid){var td=tnds.find(function(t){return t.id===tid;});return td?<span key={tid} className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {td.title}</span>:null;})}</div></td>
            <td style={{textAlign:"center"}}>{(ctr.contracts||[]).length}</td>
            <td style={{fontWeight:600}}>{totVal.toLocaleString()}</td>
            <td style={{color:"#1a73e8",fontWeight:600}}>{(ctr.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).totalInstructed;},0).toLocaleString()}</td>
            <td style={{color:"#2e7d32",fontWeight:600}}>{totCert.toLocaleString()}</td>
            <td style={{color:totRem<0?"#c62828":"#1a1a1a",fontWeight:600}}>{totRem.toLocaleString()}</td>
          </tr>;
        })}</tbody>
      </table>}
    {showForm&&formData&&<ContractorFormModal data={formData} onChange={setFormData} onSave={saveCtr} onClose={closeForm} people={ppl} packages={pkgs} tenders={tnds}/>}
    
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
  return <div className="overlay"><div className="modal" style={{maxWidth:640}}>
    <div className="modal-hdr"><div className="modal-title">📧 Action email</div><button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div className="fg" style={{marginBottom:10}}><label>Subject</label><input type="text" value={em.subject} readOnly style={{fontWeight:600}}/></div>
      <div className="fg"><label>Body</label><textarea value={em.body} readOnly style={{minHeight:320,fontFamily:"monospace",fontSize:12,lineHeight:1.6,background:"#fafaf8"}}/></div>
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn btn-pri" onClick={()=>navigator.clipboard.writeText("Subject: "+em.subject+"\n\n"+em.body)}>📋 Copy all</button>
    </div>
  </div></div>;
}

function SettingsView({tags,saveTags,people,savePeople,packages,savePackages,tagrules,saveTagrules,pkgrules,savePkgrules,apiKey,saveApiKey,improvements,saveImprovements,pkgOwners,savePkgOwners,userPrefs,saveUserPrefs,allData,onImport}){
  const [tab,setTab]=useState("tags");
  const [newTag,setNewTag]=useState("");
  const [newPerson,setNewPerson]=useState("");
  const [newPackage,setNewPackage]=useState("");

  const addTag=()=>{const t=newTag.trim();if(t&&!tags.includes(t)){saveTags([...tags,t].sort());setNewTag("");}};
  const removeTag=t=>{if(safeConfirm("Remove tag '"+t+"'? CC rules for this tag will also be removed.")){saveTags(tags.filter(x=>x!==t));const nr=Object.assign({},tagrules);delete nr[t];saveTagrules(nr);}};
  const addPerson=()=>{const p=newPerson.trim();if(p&&!people.includes(p)){savePeople([...people,p].sort());setNewPerson("");}};
  const removePerson=p=>{if(safeConfirm("Remove "+p+"?"))savePeople(people.filter(x=>x!==p));};
  const addPackage=()=>{const p=newPackage.trim();if(p&&!packages.includes(p)){savePackages([...packages,p].sort());setNewPackage("");}};
  const removePackage=p=>{if(safeConfirm("Remove package '"+p+"'?"))savePackages(packages.filter(x=>x!==p));};

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

    <div style={{display:"flex",gap:8,marginBottom:20}}>
      {["tags","people","packages","pkg-owners","cc-rules","my-prefs","improvements","backup"].map(function(t){return <button key={t} className={"fchip"+(tab===t?" on":"")} onClick={function(){setTab(t);}} style={{textTransform:"capitalize"}}>{t==="cc-rules"?"CC Rules":t==="improvements"?"💡 Improvements":t==="pkg-owners"?"📦 Pkg Owners":t==="backup"?"💾 Backup":t==="my-prefs"?"👤 My Prefs":t.charAt(0).toUpperCase()+t.slice(1)}</button>;})}
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
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input type="text" value={newPerson} onChange={e=>setNewPerson(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPerson()} placeholder="LASTNAME, Firstname" style={{flex:1}}/>
        <button className="btn btn-pri" onClick={addPerson}>＋ Add</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {people.map(p=>{const c=ownerColor(p);return <div key={p} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,background:c.bg}}>
          <div style={{width:28,height:28,borderRadius:"50%",background:c.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,flexShrink:0}}>{p[0]}</div>
          <span style={{flex:1,fontSize:13,fontWeight:600,color:c.accent}}>{p}</span>
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
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📦 Package Owners</div>
      <div style={{fontSize:12,color:"#888",marginBottom:10}}>Assign a default owner to each package. This will auto-fill the Package Owner field when creating a tender.</div>
      {(packages||[]).map(function(pkg){return <div key={pkg} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
        <div style={{flex:1,fontWeight:600,fontSize:13}}>{pkg}</div>
        <select value={(pkgOwners||{})[pkg]||""} onChange={function(e){var u=Object.assign({},pkgOwners||{});u[pkg]=e.target.value;savePkgOwners(u);}} style={{flex:2,padding:"4px 8px",fontSize:12,fontFamily:"inherit",border:"1px solid #e8e6df",borderRadius:6}}>
          <option value="">— no default owner —</option>
          {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
        </select>
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
function addWorkingDays(dateStr,days){
  if(!dateStr)return"";
  var d=new Date(dateStr);var added=0;
  while(added<days){d.setDate(d.getDate()+1);var dow=d.getDay();if(dow!==0&&dow!==6)added++;}
  return d.toISOString().slice(0,10);
}
function workingDaysDiff(dateStr1,dateStr2){
  var d1=new Date(dateStr1);var d2=new Date(dateStr2);
  if(d1>=d2)return 0;
  return Math.round((d2-d1)/(1000*60*60*24));
}
function calcProcurement(td){

  var matMaxLead = (td.materials||[]).reduce(function(max,mat){
    var d=parseLeadDays(mat.leadTime||"");return d>max?d:max;
  },0);

  var manualLead = Number(td.leadTimeDays||0);
  var LEAD = manualLead>0 ? manualLead : (matMaxLead>0 ? matMaxLead : 30);
  var hasSd = td.hasSD||false;
  var sdResubCount = Number(td.sdResubCount||0);

  var accSubmittal = ((td.stepDates||{}).acc||{}).done || ((td.stepDates||{}).acc||{}).target || "";
  var accApproval = ((td.stepDates||{}).acc||{}).approval||"";
  // contractDone from "Signed contract → Date done" row in the contract section
  var _ct=(td.stepDates||{}).contract||{};
  var contractDone = _ct.signedDone||_ct.signedAllDone||"";

  function addWorkDays(dateStr, days){
    if(!dateStr) return "";
    var d = new Date(dateStr);
    d.setDate(d.getDate()+days);
    return d.toISOString().slice(0,10);
  }

  var steps = [];
  var ov=td.procOverrides||{};

  steps.push({key:"accSub", label:"ACC Submittal (Date done)", date:accSubmittal, done:accSubmittal, duration:null, manual:true, note:"From 'Date done' of ACC step"});

  var accApprTargetAuto = addWorkDays(accSubmittal, 14);
  var accApprTarget = ov.accApp||accApprTargetAuto;
  steps.push({key:"accApp", label:"ACC Approval", date:accApprTarget, done:accApproval, duration:14, manual:false, autoDate:accApprTargetAuto, overridden:!!(ov.accApp&&ov.accApp!==accApprTargetAuto)});

  var contractTargetAuto = addWorkDays(accApproval||accApprTarget, 28);
  var contractTarget = ov.contract||contractTargetAuto;
  steps.push({key:"contract", label:"Contract Signing", date:contractTarget, done:contractDone, duration:28, manual:false, autoDate:contractTargetAuto, overridden:!!(ov.contract&&ov.contract!==contractTargetAuto)});

  var fabStart = contractDone||contractTarget;

  if(hasSd){

    var sdSubDate = td.sdDone||(addWorkDays(contractDone||contractTarget, 14));
    var sdSubTargetAuto = addWorkDays(contractDone||contractTarget, 14);
    var sdSubTarget = ov.sdSub||sdSubTargetAuto;
    steps.push({key:"sdSub", label:"SD Submission", date:sdSubTarget, done:td.sdDone||"", duration:14, manual:false, sd:true, autoDate:sdSubTargetAuto, overridden:!!(ov.sdSub&&ov.sdSub!==sdSubTargetAuto)});

    var sdAppTargetAuto = addWorkDays(td.sdDone||sdSubTarget, 14);
    var sdAppTarget = ov.sdApp||sdAppTargetAuto;
    steps.push({key:"sdApp", label:"SD Approval", date:sdAppTarget, done:td.sdApprovalDone||"", duration:14, manual:false, sd:true,
      review:td.sdReview||"", autoDate:sdAppTargetAuto, overridden:!!(ov.sdApp&&ov.sdApp!==sdAppTargetAuto)});

    var lastSdDate = td.sdApprovalDone||sdAppTarget;
    for(var r=0; r<sdResubCount; r++){
      var rSubTarget = addWorkDays(lastSdDate, 14);
      var rAppTarget = addWorkDays(rSubTarget, 14);
      steps.push({key:"sdResub"+(r+1), label:"SD Resubmission "+(r+1), date:rSubTarget, done:"", duration:14, manual:false, sd:true});
      steps.push({key:"sdReapp"+(r+1), label:"SD Approval "+(r+1), date:rAppTarget, done:"", duration:14, manual:false, sd:true});
      lastSdDate = rAppTarget;
    }
    fabStart = lastSdDate;
  }

  steps.push({key:"fab", label:"Fabrication Launch", date:fabStart, done:"", duration:null, manual:false,
    note:"Lead: "+LEAD+"d"});

  var deliveryDate = addWorkDays(fabStart, LEAD);
  steps.push({key:"delivery", label:"🚚 Delivery on site", date:deliveryDate, done:"", duration:LEAD, manual:false, highlight:true});

  var startOnSite = td.startOnSite||"";
  var margin = "";
  var procStart = "";
  var totalDays = steps.filter(function(s){return s.duration;}).reduce(function(a,s){return a+(s.duration||0);},0) + LEAD;
  if(startOnSite){
    var sos = new Date(startOnSite);
    var del = deliveryDate ? new Date(deliveryDate) : null;
    margin = del ? Math.round((sos - del)/(1000*60*60*24)) : null;
    var ps = new Date(startOnSite);
    ps.setDate(ps.getDate() - totalDays);
    procStart = ps.toISOString().slice(0,10);
  }

  return {steps:steps, deliveryDate:deliveryDate, procStart:procStart, margin:margin, totalDays:totalDays, LEAD:LEAD};
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
    if(burn>0){var fd=new Date(now.getTime()+(remaining/burn)*30*24*60*60*1000);forecast=fd.toISOString().slice(0,10);}
  }
  return{base,addTotal,total,certified,remaining,pct,totalInstructed,forecast};
}

function CollapseContractDetail({ctr,ct,fin,linkedTender,updateCtField,updateAdItem,delAdItem,addAdItem,tenders,nav,setNav,saveT,tasks,people,tags}){
  const [showAdd,setShowAdd]=useState(false);
  const [showCert,setShowCert]=useState(true);
  var addCumul=0;var certCumul=0;

  return <div>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
      <div style={{flex:1}}>
        <div style={{fontSize:11,color:"#888"}}>{ctr.name}</div>
        <div className="page-title" style={{fontSize:18}}>{ct.number||"Contract"} {ct.sapNumber&&<span style={{fontSize:13,color:"#1a73e8",fontWeight:600}}>· SAP {ct.sapNumber}</span>}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:3}}>
          {ct.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>📦 {ct.package}</span>}
          {linkedTender&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa"}}>📑 {linkedTender.title}</span>}
        </div>
      </div>
      <button onClick={function(){if(safeConfirm("Delete this contract? This cannot be undone.")){var d=(window._ppContractors||[]).map(function(c){return c.id!==ctr.id?c:Object.assign({},c,{contracts:(c.contracts||[]).filter(function(ct2){return ct2.id!==ct.id;})});});if(updateCtField){updateCtField(ctr.id,ct.id,"__delete__","");if(typeof setNav==="function")setNav(null);}}}} style={{background:"none",border:"1px solid #f5c6c6",borderRadius:6,color:"#c62828",cursor:"pointer",fontSize:11,padding:"4px 10px",fontFamily:"inherit",flexShrink:0}}>🗑 Delete contract</button>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      {[
        {label:"Contract Value excl. tax",val:fin.total.toLocaleString()+" EUR",sub:"Base "+fin.base.toLocaleString()+" + Add. "+fin.addTotal.toLocaleString(),color:"#1a1a1a"},
        {label:"Total Instructed excl. tax",val:fin.totalInstructed.toLocaleString()+" EUR",sub:"",color:"#1a73e8"},
        {label:"Certified excl. tax",val:fin.certified.toLocaleString()+" EUR",sub:fin.pct+"% of contract",color:"#2e7d32"},
        {label:"Remaining excl. tax",val:fin.remaining.toLocaleString()+" EUR",sub:fin.forecast?"Forecast: "+fmtMonthYear(fin.forecast):"",color:fin.remaining<0?"#c62828":"#1a1a1a"}
      ].map(function(k){return <div key={k.label} className="card" style={{flex:1,minWidth:130,marginBottom:0,padding:"10px 14px"}}>
        <div style={{fontSize:10,color:"#888",marginBottom:2}}>{k.label}</div>
        <div style={{fontSize:15,fontWeight:800,color:k.color}}>{k.val}</div>
        {k.sub&&<div style={{fontSize:10,color:"#aaa"}}>{k.sub}</div>}
      </div>;})}
    </div>
    <div className="pbar" style={{height:6,marginBottom:14}}><div className="pfill" style={{width:fin.pct+"%",background:fin.pct>=90?"#c62828":fin.pct>=70?"#f57f17":"#2e7d32"}}/></div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Contract Details</div>

      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{flex:"0 0 130px"}}>
          <label>Contract #</label>
          <input type="text" value={ct.number||""} onChange={function(e){updateCtField(ctr.id,ct.id,"number",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label>WBS</label>
          <input type="text" value={ct.wbs||""} onChange={function(e){updateCtField(ctr.id,ct.id,"wbs",e.target.value);}} style={{padding:"4px 8px",fontSize:12}} placeholder="WBS-001"/>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label>SAP #</label>
          <input type="text" value={ct.sapNumber||""} onChange={function(e){updateCtField(ctr.id,ct.id,"sapNumber",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
        </div>
        <div style={{flex:"0 0 150px"}}>
          <label>Amount excl. tax</label>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <input type="number" value={ct.amount||""} onChange={function(e){updateCtField(ctr.id,ct.id,"amount",e.target.value);}} style={{width:"100%",padding:"4px 32px 4px 8px",fontSize:12,boxSizing:"border-box"}}/>
            <span style={{position:"absolute",right:6,fontSize:10,fontWeight:700,color:"#888",pointerEvents:"none"}}>{ct.currency||"EUR"}</span>
          </div>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label>INS #</label>
          <input type="text" value={ct.instructionNumber||""} onChange={function(e){updateCtField(ctr.id,ct.id,"instructionNumber",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
        </div>
        <div style={{flex:"0 0 150px"}}>
          <label>INS Amount excl. tax</label>
          <div style={{position:"relative",display:"flex",alignItems:"center"}}>
            <input type="number" value={ct.instructionAmount||""} onChange={function(e){updateCtField(ctr.id,ct.id,"instructionAmount",e.target.value);}} style={{width:"100%",padding:"4px 32px 4px 8px",fontSize:12,boxSizing:"border-box"}}/>
            <span style={{position:"absolute",right:6,fontSize:10,fontWeight:700,color:"#888",pointerEvents:"none"}}>{ct.currency||"EUR"}</span>
          </div>
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"0 0 140px"}}>
          <label>Start date</label>
          <input type="date" value={ct.startDate||""} onChange={function(e){updateCtField(ctr.id,ct.id,"startDate",e.target.value);}} style={{padding:"4px 8px",fontSize:11}}/>
        </div>
        <div style={{flex:"0 0 140px"}}>
          <label>End date</label>
          <input type="date" value={ct.endDate||""} onChange={function(e){updateCtField(ctr.id,ct.id,"endDate",e.target.value);}} style={{padding:"4px 8px",fontSize:11}}/>
        </div>
        {fin.forecast&&<div style={{flex:"0 0 auto",paddingBottom:6}}>
          <span style={{fontSize:11,color:fin.forecast>(ct.endDate||"9999")?"#c62828":"#2e7d32",fontWeight:700}}>📅 Forecast: {fmtMonthYear(fin.forecast)}</span>
        </div>}
        <div style={{flex:1,minWidth:160}}>
          <label>Linked Tender</label>
          <select value={ct.tenderRef||""} onChange={function(e){updateCtField(ctr.id,ct.id,"tenderRef",e.target.value);}} style={{padding:"4px 8px",fontSize:11,fontFamily:"inherit"}}>
            <option value="">— none —</option>
            {(tenders||[]).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1,minWidth:160}}>
          <label>Owner</label>
          <select value={ct.owner||""} onChange={function(e){updateCtField(ctr.id,ct.id,"owner",e.target.value);}} style={{padding:"4px 8px",fontSize:11,fontFamily:"inherit",width:"100%"}}>
            <option value="">— none —</option>
            {(window._ppPeople||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
          </select>
        </div>
        <div style={{flex:2,minWidth:180}}>
          <label>Description</label>
          <input type="text" value={ct.description||""} onChange={function(e){updateCtField(ctr.id,ct.id,"description",e.target.value);}} style={{padding:"4px 8px",fontSize:11,width:"100%",boxSizing:"border-box"}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center",padding:"8px 0 0"}}>
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,color:"#333"}}>
          <input type="checkbox" checked={!!ct.closed} onChange={function(e){updateCtField(ctr.id,ct.id,"closed",e.target.checked);}} style={{width:15,height:15}}/>
          Contract closed
        </label>
        {ct.closed&&<label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,color:"#2e7d32"}}>
          <input type="checkbox" checked={!!ct.cacSigned} onChange={function(e){updateCtField(ctr.id,ct.id,"cacSigned",e.target.checked);}} style={{width:15,height:15}}/>
          Certificate at Completion signed
        </label>}
      </div>
    </div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>ACC / ACONEX Status</div>
      {[
        {key:"acc",label:"ACC",color:"#1a73e8",bg:"#e8f0fe"},
        {key:"aconex",label:"ACONEX",color:"#7b1fa2",bg:"#f3e5f5"}
      ].map(function(doc){
        var signed=ct[doc.key+"Signed"]||false;
        var subDate=ct[doc.key+"Date"]||"";
        var status=ct[doc.key+"Status"]||"";
        var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
        var overdue=status!=="approved"&&due14&&due14<today();
        return <div key={doc.key} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 10px",borderRadius:8,background:doc.bg+"44",border:"1px solid "+doc.color+"33",marginBottom:6}}>
          <div style={{flex:"0 0 80px"}}>
            <label style={{color:doc.color,fontSize:11,fontWeight:800,display:"block",marginBottom:4}}>{doc.label}</label>
            <label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:11,fontWeight:500}}>
              <input type="checkbox" checked={signed} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Signed",e.target.checked);}} style={{width:13,height:13}}/>
              Signed
            </label>
          </div>
          <div style={{flex:1}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
              <select value={status} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Status",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid "+doc.color+"55",borderRadius:5,fontFamily:"inherit",color:status==="approved"?"#2e7d32":status==="rejected"?"#c62828":"#555",fontWeight:status?"600":"400"}}>
                <option value="">— status —</option>
                <option value="not submitted">Not submitted</option>
                <option value="pending approval">Pending approval</option>
                <option value="rejected">Rejected</option>
                <option value="approved">Approved</option>
              </select>
              {status&&status!=="not submitted"&&<div style={{flex:"0 0 120px"}}>
                <div style={{fontSize:9,fontWeight:700,color:"#888",marginBottom:2}}>SUBMISSION DATE</div>
                <input type="date" value={subDate} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Date",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid "+doc.color+"55",borderRadius:5}}/>
              </div>}
              {due14&&<div style={{fontSize:10,color:overdue?"#c62828":"#888",fontWeight:overdue?700:400}}>
                {overdue?"⚠️ Overdue +"+workingDaysDiff(due14,today())+"d (due "+fmtDate(due14)+")":"Due: "+fmtDate(due14)}
              </div>}
            </div>
          </div>
        </div>;
      })}
    </div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setShowAdd(!showAdd);}}>
        <div style={{fontWeight:700,fontSize:13}}>Addendums ({(ct.addendums||[]).length}){(ct.addendums||[]).length>0&&<span style={{marginLeft:8,fontSize:11,color:"#1a73e8"}}>Total: {(ct.addendums||[]).reduce(function(s,a){return s+Number(a.amount||0);},0).toLocaleString()} EUR</span>}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className="btn btn-sm" onClick={function(e){e.stopPropagation();addAdItem(ctr.id,ct.id,"addendums",newAddendum());}}>+ Add</button>
          <span style={{fontSize:16,color:"#aaa"}}>{showAdd?"▾":"▸"}</span>
        </div>
      </div>
      {showAdd&&<div style={{marginTop:10}}>
        {(ct.addendums||[]).length===0?<div style={{color:"#bbb",fontSize:12}}>No addendums yet.</div>
        :(ct.addendums||[]).map(function(ad,i){
          addCumul+=Number(ad.amount||0);
          return <div key={ad.id} style={{padding:"8px 10px",background:"#fafaf8",borderRadius:7,border:"1px solid #f0ede6",marginBottom:6}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
              <input type="text" value={ad.number||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"number",e.target.value);}} placeholder="Add #" style={{width:80,padding:"3px 6px",fontSize:11,fontWeight:700}}/>
              <input type="text" value={ad.instructionNumber||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"instructionNumber",e.target.value);}} placeholder="INS #" style={{width:80,padding:"3px 6px",fontSize:11}}/>
              <input type="date" value={ad.date||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"date",e.target.value);}} style={{width:130,padding:"3px 6px",fontSize:11}}/>
              <input type="number" value={ad.amount||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"amount",e.target.value);}} placeholder="Amount excl. tax EUR" style={{width:110,padding:"3px 6px",fontSize:11}}/>
<div style={{position:"relative",display:"inline-flex",alignItems:"center"}}><input type="number" value={ad.instructionAmount||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"instructionAmount",e.target.value);}} placeholder="INS Amt" style={{width:110,padding:"3px 28px 3px 6px",fontSize:11}}/><span style={{position:"absolute",right:4,fontSize:9,fontWeight:700,color:"#aaa",pointerEvents:"none"}}>{ct.currency||"EUR"}</span></div>
              <span style={{fontSize:10,color:"#888"}}>Cumul: <strong>{addCumul.toLocaleString()} EUR</strong></span>
              <button onClick={function(){if(safeConfirm("Delete addendum?"))delAdItem(ctr.id,ct.id,"addendums",i);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14,marginLeft:"auto"}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
            </div>
            <input type="text" value={ad.comment||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"comment",e.target.value);}} placeholder="Comment..." style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box",marginBottom:6}}/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["acc","aconex"].map(function(dk){
                var dLabel=dk==="acc"?"ACC":"ACONEX";var dColor=dk==="acc"?"#1a73e8":"#7b1fa2";
                var adStatus=ad[dk+"Status"]||"";var adDate=ad[dk+"Date"]||"";
                var due14=adDate?(function(){var d=new Date(adDate);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
                var overdue=adStatus!=="approved"&&due14&&due14<today();
                return <div key={dk} style={{display:"flex",gap:5,alignItems:"center",padding:"4px 7px",borderRadius:6,background:dk==="acc"?"#e8f0fe55":"#f3e5f555",border:"1px solid "+dColor+"33",flex:1,minWidth:180}}>
                  <span style={{fontSize:10,fontWeight:700,color:dColor,flexShrink:0}}>{dLabel}</span>
                  <select value={adStatus} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,dk+"Status",e.target.value);}} style={{fontSize:10,padding:"2px 4px",border:"1px solid "+dColor+"44",borderRadius:4,fontFamily:"inherit",flex:1}}>
                    <option value="">— status —</option>
                    <option value="not submitted">Not submitted</option>
                    <option value="pending approval">Pending approval</option>
                    <option value="rejected">Rejected</option>
                    <option value="approved">✅ Approved</option>
                  </select>
                  <input type="date" value={adDate} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,dk+"Date",e.target.value);}} style={{fontSize:10,padding:"2px 4px",border:"1px solid "+dColor+"44",borderRadius:4,width:105}}/>
                  {overdue&&<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(due14,today())}d</span>}
                </div>;
              })}
            </div>
          </div>;
        })}
      </div>}
    </div>

    <div className="card" style={{marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setShowCert(!showCert);}}>
        <div style={{fontWeight:700,fontSize:13}}>Certifications ({(ct.certifications||[]).length}){(ct.certifications||[]).length>0&&<span style={{marginLeft:8,fontSize:11,color:"#2e7d32"}}>Certified: {(ct.certifications||[]).reduce(function(s,cf){return s+Number(cf.amount||0);},0).toLocaleString()} EUR</span>}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className="btn btn-sm" onClick={function(e){e.stopPropagation();addAdItem(ctr.id,ct.id,"certifications",newCertification());}}>+ Add</button>
          <span style={{fontSize:16,color:"#aaa"}}>{showCert?"▾":"▸"}</span>
        </div>
      </div>
      {showCert&&<div style={{marginTop:10}}>
        {(ct.certifications||[]).length===0?<div style={{color:"#bbb",fontSize:12}}>No certifications yet.</div>
        :(ct.certifications||[]).map(function(cf,i){
          certCumul+=Number(cf.amount||0);
          var rem=fin.total-certCumul;
          return <div key={cf.id} style={{padding:"8px 10px",background:"#fafaf8",borderRadius:7,border:"1px solid #f0ede6",marginBottom:6}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
              <input type="text" value={cf.number||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"number",e.target.value);}} placeholder="Cert #" style={{width:80,padding:"3px 6px",fontSize:11,fontWeight:700}}/>
              <input type="month" value={cf.date?cf.date.slice(0,7):""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"date",e.target.value+"-01");}} style={{width:130,padding:"3px 6px",fontSize:11}}/>
              <input type="number" value={cf.amount||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"amount",e.target.value);}} placeholder="Amount excl. tax EUR" style={{width:130,padding:"3px 6px",fontSize:11}}/>
              <span style={{fontSize:10,color:"#2e7d32"}}>Cumul: <strong>{certCumul.toLocaleString()} EUR</strong></span>
              <span style={{fontSize:10,color:rem<0?"#c62828":"#888"}}>Left: <strong>{rem.toLocaleString()} EUR</strong></span>
              <button onClick={function(){if(safeConfirm("Delete certification?"))delAdItem(ctr.id,ct.id,"certifications",i);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:14,marginLeft:"auto"}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
            </div>
            <input type="text" value={cf.comment||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"certifications",i,"comment",e.target.value);}} placeholder="Comment..." style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,boxSizing:"border-box"}}/>
          </div>;
        })}
      </div>}
    </div>
  </div>;
}

function ContractsView({contractors,saveContractors,tenders,packages,saveTasks,tasks}){

  const [nav,setNav]=useState(null);
  const [q,setQ]=useState("");
  const [fPkg,setFPkg]=useState("all");
  const [fCtr,setFCtr]=useState("all");

  function save(d){
    saveContractors(d);
    if(nav&&nav.ctId){
      var newCtr=d.find(function(c){return c.id===nav.ctrId;});
      var newCt=newCtr?(newCtr.contracts||[]).find(function(c){return c.id===nav.ctId;}):null;
      if(!newCt)setNav({ctrId:nav.ctrId});
    }
  }

  function addContract(ctrId){
    var nc=newContract();
    nc.package=(contractors||[]).find(function(c){return c.id===ctrId;})?((contractors||[]).find(function(c){return c.id===ctrId;}).package||""):"";
    var d=(contractors||[]).map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:[...(c.contracts||[]),nc]});});
    save(d);
    setNav({ctrId:ctrId,ctId:nc.id});
  }

  function updateCtField(ctrId,ctId,field,val){
    if(field==="__delete__"){
      var d2=(contractors||[]).map(function(c){if(c.id!==ctrId)return c;return Object.assign({},c,{contracts:(c.contracts||[]).filter(function(ct){return ct.id!==ctId;})});});
      save(d2);return;
    }
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;var u=Object.assign({},ct);u[field]=val;return u;
      })});
    });
    save(d);
  }

  function updateAdItem(ctrId,ctId,field,i,key,val){
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;
        var items=(ct[field]||[]).map(function(item,j){if(j!==i)return item;var u=Object.assign({},item);u[key]=val;return u;});
        var u2=Object.assign({},ct);u2[field]=items;return u2;
      })});
    });
    save(d);
  }

  function delAdItem(ctrId,ctId,field,i){
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;var u=Object.assign({},ct);u[field]=(ct[field]||[]).filter(function(_,j){return j!==i;});return u;
      })});
    });
    save(d);
  }

  function addAdItem(ctrId,ctId,field,newItem){
    var d=(contractors||[]).map(function(c){
      if(c.id!==ctrId)return c;
      return Object.assign({},c,{contracts:(c.contracts||[]).map(function(ct){
        if(ct.id!==ctId)return ct;var u=Object.assign({},ct);u[field]=[...(ct[field]||[]),newItem];return u;
      })});
    });
    save(d);
  }

  if(nav&&nav.ctId){
    var ctr=(contractors||[]).find(function(c){return c.id===nav.ctrId;})||{contracts:[]};
    var ct=(ctr.contracts||[]).find(function(c){return c.id===nav.ctId;})||{addendums:[],certifications:[]};
    var fin=contractFinancials(ct);
    var linkedTender=ct.tenderRef?(tenders||[]).find(function(t){return t.id===ct.tenderRef;}):null;
    var allCtrContracts=(contractors||[]).flatMap(function(c){return (c.contracts||[]).map(function(ct2){return {ct:ct2,ctr:c};});});

    return <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>

      <div style={{width:200,flexShrink:0,background:"#fff",borderRadius:12,border:"1.5px solid #e8e6df",overflow:"hidden",position:"sticky",top:0,alignSelf:"flex-start"}}>
        <div style={{padding:"8px 10px",borderBottom:"1.5px solid #e8e6df"}}>
          <div style={{fontSize:11,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:4}}>Contracts</div>
          <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{width:"100%",padding:"3px 5px",fontSize:10,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit",background:"#fafaf8"}}>
            <option value="all">All packages</option>
            {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
          </select>
        </div>
        <div style={{maxHeight:"75vh",overflowY:"auto"}}>
          {(contractors||[]).filter(function(c){return (c.contracts||[]).length>0&&(fPkg==="all"||(c.contracts||[]).some(function(ct){return ct.package===fPkg;}));}).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(c){
            var hasSel=c.id===nav.ctrId;
            return <div key={c.id}>
              <div style={{padding:"6px 10px",fontSize:10,fontWeight:800,color:"#888",background:"#fafaf8",textTransform:"uppercase",letterSpacing:".3px"}}>{c.name}</div>
              {(c.contracts||[]).map(function(ct2){
                var isActive=ct2.id===nav.ctId;
                var f2=contractFinancials(ct2);
                return <div key={ct2.id} onClick={function(){setNav({ctrId:c.id,ctId:ct2.id});}} style={{padding:"6px 10px",cursor:"pointer",background:isActive?"#f0ede6":"transparent",borderLeft:"3px solid "+(isActive?"#c9a84c":"transparent")}}>
                  <div style={{fontSize:11,fontWeight:isActive?700:400,color:isActive?"#1c1c1e":"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ct2.number||"(no #)"} {ct2.sapNumber&&<span style={{color:"#1a73e8",fontSize:9}}>SAP</span>}</div>
                  <div style={{fontSize:9,color:"#aaa"}}>{f2.pct}% certified</div>
                </div>;
              })}
            </div>;
          })}
        </div>
      </div>

      <div style={{flex:1,minWidth:0}}>
        <CollapseContractDetail ctr={ctr} ct={ct} fin={fin} linkedTender={linkedTender}
          updateCtField={updateCtField} updateAdItem={updateAdItem} delAdItem={delAdItem} addAdItem={addAdItem}
          tenders={tenders} nav={nav} setNav={setNav} saveT={saveTasks} tasks={tasks} people={window._ppPeople||[]} tags={window._ppTags||[]}/>
      </div>
    </div>;
  }

  if(nav&&nav.ctrId&&!nav.ctId){
    var ctr2=(contractors||[]).find(function(c){return c.id===nav.ctrId;})||{contracts:[]};
    var totVal2=(ctr2.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).total;},0);
    var totCert2=(ctr2.contracts||[]).reduce(function(s,ct){return s+contractFinancials(ct).certified;},0);
    var linkedTenders2=(ctr2.tenderRefs||[ctr2.tenderRef].filter(Boolean)).map(function(id){return (tenders||[]).find(function(t){return t.id===id;});}).filter(Boolean);
    return <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <button className="btn btn-sm" onClick={function(){setNav(null);}}>← Back</button>
        <div style={{flex:1}}>
          <div className="page-title">{ctr2.name}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4,alignItems:"center"}}>
            {ctr2.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>📦 {ctr2.package}</span>}
            {ctr2.owner&&<OwnerChip owner={ctr2.owner}/>}
            {linkedTenders2.map(function(lt){return lt?<span key={lt.id} className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa"}}>📑 {lt.title}</span>:null;})}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:13,fontWeight:700}}>{totVal2.toLocaleString()} EUR</div>
          <div style={{fontSize:11,color:"#2e7d32"}}>Certified: {totCert2.toLocaleString()}</div>
        </div>
      </div>

      {(ctr2.contracts||[]).length===0
        ?<div className="empty"><div className="empty-ico">📋</div><div className="empty-txt">No contracts for this subcontractor.</div></div>
        :(ctr2.contracts||[]).map(function(ct){
          var fin=contractFinancials(ct);
          var lt2=ct.tenderRef?(tenders||[]).find(function(t){return t.id===ct.tenderRef;}):null;
          return <div key={ct.id} className="ctr-card" onClick={function(){setNav({ctrId:ctr2.id,ctId:ct.id});}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14}}>{ct.number||"(no number)"} {ct.sapNumber&&<span style={{fontSize:12,color:"#1a73e8",fontWeight:600}}>· SAP {ct.sapNumber}</span>}</div>
                <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                  {ct.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>📦 {ct.package}</span>}
                  {lt2&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {lt2.title}</span>}
                  {ct.description&&<span style={{fontSize:11,color:"#888"}}>{ct.description}</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:15,fontWeight:800}}>{fin.total.toLocaleString()} <span style={{fontSize:11}}>{ct.currency||"EUR"}</span></div>
                <div style={{fontSize:11,color:"#2e7d32"}}>Certified: {fin.certified.toLocaleString()} ({fin.pct}%)</div>
                <div style={{fontSize:11,color:fin.remaining<0?"#c62828":"#888"}}>Left: {fin.remaining.toLocaleString()}</div>
              </div>
            </div>
            <div className="pbar" style={{marginTop:8}}><div className="pfill" style={{width:fin.pct+"%",background:fin.pct>=90?"#c62828":fin.pct>=70?"#f57f17":"#2e7d32"}}/></div>
            <div style={{fontSize:11,color:"#aaa",marginTop:4}}>
              {(ct.addendums||[]).length} addendum{(ct.addendums||[]).length!==1?"s":""} · {(ct.certifications||[]).length} certification{(ct.certifications||[]).length!==1?"s":""}
              {fin.forecast&&<span style={{marginLeft:8,color:fin.forecast>(ct.endDate||"9999")?"#c62828":"#2e7d32",fontWeight:600}}>Forecast: {fmtMonthYear(fin.forecast)}</span>}
            </div>
          </div>;
        })}
    </div>;
  }

  var allContracts=[];
  (contractors||[]).forEach(function(ctr){(ctr.contracts||[]).forEach(function(ct){allContracts.push({ct:ct,ctr:ctr});});});
  var allPkgs=[...new Set(allContracts.map(function(x){return x.ct.package;}).filter(Boolean))].sort();
  var allCtrs=[...new Set((contractors||[]).map(function(c){return c.name;}).filter(Boolean))].sort();
  var filtered=allContracts.filter(function(x){
    if(fPkg!=="all"&&x.ct.package!==fPkg)return false;
    if(fCtr!=="all"&&x.ctr.name!==fCtr)return false;
    if(q){var lq=q.toLowerCase();if(!(x.ct.number||"").toLowerCase().includes(lq)&&!(x.ct.sapNumber||"").toLowerCase().includes(lq)&&!(x.ctr.name||"").toLowerCase().includes(lq))return false;}
    return true;
  });

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Contracts</div>
        <div className="page-sub">{allContracts.length} contracts · {(contractors||[]).length} subcontractors</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <select id="new-contract-ctr" style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
          <option value="">Select subcontractor…</option>
          {(contractors||[]).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(c){return <option key={c.id} value={c.id}>{c.name}</option>;})}
        </select>
        <button className="btn btn-gold" onClick={function(){
          var sel=document.getElementById("new-contract-ctr");
          if(!sel||!sel.value){alert("Please select a subcontractor first.");return;}
          addContract(sel.value);
          setNav({ctrId:sel.value});
        }}>＋ New Contract</button>
      </div>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search contract, SAP..." style={{width:220,padding:"5px 10px",fontSize:12}}/>
      <select value={fCtr} onChange={function(e){setFCtr(e.target.value);}} style={{width:"auto",padding:"4px 7px",fontSize:11}}>
        <option value="all">All subcontractors</option>
        {allCtrs.map(function(n){return <option key={n} value={n}>{n}</option>;})}
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
      {(q||fCtr!=="all"||fPkg!=="all")&&<button className="btn btn-sm" onClick={function(){setQ("");setFCtr("all");setFPkg("all");}}>✕ Reset</button>}
    </div>

    {(contractors||[]).filter(function(ctr){
      if(fCtr!=="all"&&ctr.name!==fCtr)return false;
      if((ctr.contracts||[]).length===0)return false;
      if(q){return (ctr.contracts||[]).some(function(ct){var lq=q.toLowerCase();return (ct.number||"").toLowerCase().includes(lq)||(ct.sapNumber||"").toLowerCase().includes(lq)||(ctr.name||"").toLowerCase().includes(lq);});}
      return true;
    }).slice().sort(function(a,b){return (a.name||"").localeCompare(b.name||"");}).map(function(ctr){
      var ctrs=ctr.contracts||[];
      var totV=ctrs.reduce(function(s,ct){return s+contractFinancials(ct).total;},0);
      var totC=ctrs.reduce(function(s,ct){return s+contractFinancials(ct).certified;},0);
      return <div key={ctr.id} style={{marginBottom:16}}>
        <div className="ctr-card" style={{borderBottom:"2px solid #e8e6df",borderRadius:"12px 12px 0 0",cursor:"pointer",background:"#f8f7f4"}} onClick={function(){setNav({ctrId:ctr.id});}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15}}>{ctr.name}</div>
              <div style={{fontSize:12,color:"#888"}}>{ctr.package&&"📦 "+ctr.package} · {ctrs.length} contract{ctrs.length!==1?"s":""}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontWeight:700,fontSize:13}}>{totV.toLocaleString()} EUR</div>
              <div style={{fontSize:11,color:"#2e7d32"}}>Certified: {totC.toLocaleString()}</div>
            </div>
            <span style={{fontSize:16,color:"#aaa"}}>›</span>
          </div>
        </div>
        <div style={{borderRadius:"0 0 12px 12px",border:"1.5px solid #e8e6df",borderTop:"none",overflow:"hidden"}}>
          {ctrs.filter(function(ct){if(!q)return true;var lq=q.toLowerCase();return (ct.number||"").toLowerCase().includes(lq)||(ct.sapNumber||"").toLowerCase().includes(lq);}).map(function(ct){
            var fin=contractFinancials(ct);
            var lt=ct.tenderRef?(tenders||[]).find(function(t){return t.id===ct.tenderRef;}):null;
            return <div key={ct.id} style={{padding:"10px 14px",borderBottom:"1px solid #f5f4f0",cursor:"pointer",background:"#fff",display:"flex",alignItems:"center",gap:10}} onClick={function(){setNav({ctrId:ctr.id,ctId:ct.id});}}
              onMouseEnter={function(e){e.currentTarget.style.background="#fafaf8";}} onMouseLeave={function(e){e.currentTarget.style.background="#fff";}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{ct.number||"(no number)"} {ct.sapNumber&&<span style={{color:"#1a73e8",fontSize:11}}>SAP {ct.sapNumber}</span>}</div>
                <div style={{display:"flex",gap:5,marginTop:3,flexWrap:"wrap"}}>
                  {lt&&<span className="badge" style={{background:"#fff8f0",color:"#b45309",border:"1px solid #fed7aa",fontSize:10}}>📑 {lt.title}</span>}
                  {ct.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>📦 {ct.package}</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontWeight:600,fontSize:12}}>{fin.total.toLocaleString()} {ct.currency||"EUR"}</div>
                <div style={{fontSize:10,color:"#2e7d32"}}>{fin.pct}% certified</div>
                {(function(){
                  if(ct.closed)return <div style={{fontSize:9,color:"#2e7d32",fontWeight:700}}>✅ Closed{ct.cacSigned?" · CAC":""}</div>;
                  var certs=ct.certifications||[];
                  if(certs.length===0)return null;
                  var lastDate=(certs.slice().sort(function(a,b){return (b.date||"").localeCompare(a.date||"");})[0]||{}).date||"";
                  if(!lastDate)return null;
                  var d=new Date(lastDate);var now=new Date();
                  var months=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
                  var late=months>=2;
                  return <div style={{fontSize:9,fontWeight:late?700:400,color:late?"#c62828":"#aaa"}}>{late?"⚠️ ":""}Last cert: {fmtMonthYear(lastDate)}</div>;
                })()}
              </div>
              <div style={{width:50}}>
                <div style={{height:4,background:"#f0ede6",borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:fin.pct+"%",height:"100%",background:fin.pct>=90?"#c62828":fin.pct>=70?"#f57f17":"#2e7d32"}}/>
                </div>
              </div>
              <span style={{fontSize:14,color:"#ccc"}}>›</span>
            </div>;
          })}
        </div>
      </div>;
    })}
    {allContracts.length===0&&<div className="empty"><div className="empty-ico">📋</div><div className="empty-txt">No contracts yet. Add contracts from the Subcontractors tab.</div></div>}
  </div>;
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
        <div style={{flex:1,minWidth:120}}><label>Date</label><input type="date" value={form.date} onChange={function(e){fset("date",e.target.value);}}/></div>
      </div>
      <div className="fg" style={{marginBottom:8}}><label>Subject *</label><input type="text" value={form.subject} onChange={function(e){fset("subject",e.target.value);}} placeholder="AWN subject..."/></div>
      <div className="fg" style={{marginBottom:8}}><label>Description</label><textarea value={form.description} onChange={function(e){fset("description",e.target.value);}} style={{minHeight:50}}/></div>
      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontSize:12,fontWeight:500,marginBottom:8}}>
        <input type="checkbox" checked={form.replied} onChange={function(e){fset("replied",e.target.checked);}} style={{width:15,height:15}}/>
        Response received
      </label>
      {form.replied&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <div style={{flex:1}}><label>Response #</label><input type="text" value={form.replyNumber} onChange={function(e){fset("replyNumber",e.target.value);}}/></div>
        <div style={{flex:1}}><label>Response date</label><input type="date" value={form.replyDate} onChange={function(e){fset("replyDate",e.target.value);}}/></div>
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

function GlobalView({tasks,trackers,tenders,contractors,people,packages,tags,saveTasks,saveTrackers,tagrules,pkgrules,jumpOwner,clearJump,onNavTender}){
  const [fStatus,setFStatus]=useState("all");
  const [fAddedBy,setFAddedBy]=useState("all");
  const [preset,setPreset]=useState("");
  const [fOwners,setFOwners]=useState([]);
  useEffect(function(){if(jumpOwner){setFOwners([jumpOwner]);if(clearJump)clearJump();}else{setFOwners([]);}},[ jumpOwner]);
  const [fTags,setFTags]=useState([]);
  const [fPkg,setFPkg]=useState("all");
  const [fTender,setFTender]=useState("all");
  const [fContractor,setFContractor]=useState("all");
  const [fCC,setFCC]=useState("all");
  const [fScore,setFScore]=useState("all");
  const [showInfo,setShowInfo]=useState(false);
  const [sortBy,setSortBy]=useState("none");
  const [sortDir,setSortDir]=useState("asc");
  const [q,setQ]=useState("");
  const [editId,setEditId]=useState(null);
  const [showEmail,setShowEmail]=useState(false);

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

  function buildEmail(){
    var today=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
    var subject="Global Action View — "+today;
    if(fOwners.length===1)subject="Actions @"+fOwners[0].split(",")[0]+" — "+today;
    else if(fOwners.length>1)subject="Actions ("+fOwners.length+" owners) — "+today;
    else if(fCC!=="all")subject="CC "+fCC.split(",")[0]+" Actions — "+today;
    var NL=String.fromCharCode(10);
    var lines=["Hello,","","Please find below the action summary as of "+today+".","","─".repeat(60),""];
    var bySource={};
    filtered.filter(function(a){return !a.isInfo;}).forEach(function(a){
      var key=a._source==="task"?"📋 Tasks":"📊 "+a._sourceTitle;
      if(!bySource[key])bySource[key]=[];
      bySource[key].push(a);
    });
    Object.entries(bySource).forEach(function(e){
      lines.push(e[0]);
      lines.push("─".repeat(e[0].length));
      e[1].forEach(function(a){
        var st={"pending":"⏳","in progress":"🔄","done":"✅","blocked":"🚫"}[a.status]||"•";
        var due=a.due?" → "+fmtDate(a.due):"";
        var sc=calcScore(a.importance||1,a.urgence||1);
        var scoreStr=sc>=9?" [🔴 Score: "+sc+"]":sc>=6?" [🟠 Score: "+sc+"]":sc>1?" [Score: "+sc+"]":"";
        var ccs=getAllCCs(a.tags||[],a.package||"",a.owner||"",tagrules||{},pkgrules||{});
        var ccStr=ccs.length>0?" "+ccs.map(function(p){return "@"+p.split(",")[0];}).join(" "):"";
        var tr=a.tenderRef?(tenders||[]).find(function(t){return t.id===a.tenderRef;}):null;
        var trStr=tr?" [📑 "+tr.title+"]":"";
        lines.push("  "+st+" "+a.text+(a.owner?" @"+a.owner.split(",")[0]:"")+due+scoreStr+ccStr+trStr);
      });
      lines.push("");
    });
    lines.push("─".repeat(60));
    lines.push("Total: "+filtered.length+" action"+(filtered.length!==1?"s":""));
    var body=lines.join(NL);
    return{subject,body};
  }

  var pending=filtered.filter(function(a){return a.status==="pending";}).length;
  var inprog=filtered.filter(function(a){return a.status==="in progress";}).length;
  var done=filtered.filter(function(a){return a.status==="done";}).length;

  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">Actions</div>
        <div className="page-sub">{filtered.length} actions · {pending} pending · {inprog} in progress · {done} done</div>
      </div>
      {filtered.length>0&&<button className="btn btn-gold" onClick={function(){setShowEmail(true);}}>📧 Email</button>}
    </div>

    {showEmail&&<EmailModal em={buildEmail()} onClose={function(){setShowEmail(false);}}/>}

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

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">🔍</div><div className="empty-txt">No actions match the filters.</div></div>
      :<div style={{overflowX:"auto"}}>
        <table className="tbl">
          <thead><tr>
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
            return <tr key={a.id||idx} style={{background:isEdit?"#f8f9ff":"transparent",verticalAlign:"top"}}>
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
                  ?<select value={a.package||""} onChange={function(e){updateField(a,"package",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd",fontFamily:"inherit"}}>
                    <option value="">—</option>{(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
                  </select>
                  :<span>{a.package&&<span className="badge" style={{background:"#f0ede6",color:"#555",fontSize:10}}>{a.package}</span>}</span>}
              </td>
              <td style={{whiteSpace:"nowrap"}}>
                {isEdit
                  ?<input type="date" value={a.due||""} onChange={function(e){updateField(a,"due",e.target.value);}} style={{fontSize:11,padding:"3px 6px",borderRadius:5,border:"1px solid #ddd"}}/>
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
  var monStr=monday.toISOString().slice(0,10);
  var satStr=saturday.toISOString().slice(0,10);
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
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,fontWeight:700,color:"#f97316",letterSpacing:"1px"}}>📋 My Week</div>
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
      <div style={{color:"#f97316",fontSize:20,fontWeight:900,letterSpacing:"2px",fontFamily:"'DM Serif Display',serif",marginBottom:2}}>RIVIERA TOWER TRACKER</div>
      <div style={{color:"#f97316",fontSize:13,fontWeight:700,letterSpacing:"1.5px",fontFamily:"'DM Serif Display',serif"}}>MAGIC TEAM</div>
    </div>
    <div style={{background:"#fff",borderRadius:16,padding:"28px 32px",width:340,boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
      {step==="pick"&&<div>
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,fontWeight:700,marginBottom:4}}>Who are you?</div>
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
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,fontWeight:700,marginBottom:2}}>Hello, {selName.split(",")[0]}</div>
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
        <div style={{fontFamily:"'DM Serif Display',serif",fontSize:18,fontWeight:700,marginBottom:2}}>Hi, {selName.split(",")[0]}!</div>
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

function PackagesView({tasks,tenders,contractors,packages,people,pkgOwners,saveTasks,tags,onNavTender}){
  const [openPkg,setOpenPkg]=useState(null);
  const [fOnlyIssues,setFOnlyIssues]=useState(false);
  var todayStr=today();

  // Build per-package aggregation
  var rows=(packages||[]).map(function(pkg){
    var pkgTenders=(tenders||[]).filter(function(t){return t.package===pkg;});
    var owner=(pkgOwners||{})[pkg]||"";

    // Tender steps progress (across all tenders of the pkg — worst case shown)
    function stepAgg(key){
      var vals=pkgTenders.map(function(t){return(t.steps||{})[key]||"";}).filter(Boolean);
      if(vals.length===0)return{state:"none",label:"—"};
      var allApproved=vals.every(function(v){var lv=v.toLowerCase();return lv==="approved a"||lv==="approved b"||lv==="approved"||lv==="signed"||lv==="n/a";});
      var anyRejected=vals.some(function(v){var lv=v.toLowerCase();return lv.includes("reject")||lv==="not approved";});
      if(anyRejected)return{state:"bad",label:vals.length+""};
      if(allApproved)return{state:"ok",label:vals.length+""};
      return{state:"progress",label:vals.length+""};
    }
    var steps=["bidders","pkg","acc","itp","wms"].map(function(k){return{key:k,agg:stepAgg(k)};});

    // Contract stage (most advanced per tender, summarized)
    var contractStages=pkgTenders.map(function(t){
      var ct=(t.stepDates||{}).contract||{};
      if(ct.signedDone||ct.signedAllDone)return 4;
      if(ct.circulateDone)return 3;
      if(ct.requestDone)return 2;
      var acc=((t.stepDates||{}).acc||{}).approval;
      if(acc)return 1;
      return 0;
    });
    var CONTRACT_LABELS=["—","To request","To circulate","To sign","✅ Signed"];
    var minStage=contractStages.length?Math.min.apply(null,contractStages):0;
    var maxStage=contractStages.length?Math.max.apply(null,contractStages):0;

    // MSS/MAR/SD counts
    var counts={approved:0,pending:0,prep:0,overdue:0,rejected:0};
    pkgTenders.forEach(function(t){
      (t.materials||[]).forEach(function(mat){
        ["mss","mar"].forEach(function(k){
          var app=mat[k+"ApprovalStatus"]||"";
          var sub=mat[k+"Status"]||"";
          var st=app==="approved"?"approved":(app?"pending approval":sub);
          if(!st)return;
          if(st==="approved")counts.approved++;
          else if(st==="rejected")counts.rejected++;
          else if(st==="under preparation")counts.prep++;
          else{counts.pending++;
            var done=mat[k+"Done"]||"";
            if(done){var d=new Date(done);d.setDate(d.getDate()+14);if(d.toISOString().slice(0,10)<todayStr)counts.overdue++;}
          }
        });
      });
      if(t.hasSD){
        var app=t.sdApprovalStatus||"";var sub=t.sdStatus||"";
        var st=app==="approved"?"approved":(app?"pending approval":sub);
        if(st==="approved")counts.approved++;
        else if(st==="rejected")counts.rejected++;
        else if(st==="under preparation")counts.prep++;
        else if(st){counts.pending++;
          if(t.sdDone){var d2=new Date(t.sdDone);d2.setDate(d2.getDate()+14);if(d2.toISOString().slice(0,10)<todayStr)counts.overdue++;}
        }
      }
    });

    // Open actions for this package
    var pkgActions=(tasks||[]).filter(function(t){return t.package===pkg&&t.status!=="done"&&!t.isInfo;});
    var overdueActions=pkgActions.filter(function(t){return t.due&&t.due<todayStr;}).length;
    var blockingActions=pkgActions.filter(function(t){return(t.tags||[]).includes("Blocking Point");}).length;

    var nextSteps=pkgTenders.map(function(t){return t.nextStep;}).filter(Boolean);

    var hasIssues=overdueActions>0||blockingActions>0||counts.overdue>0||counts.rejected>0;

    return{pkg:pkg,owner:owner,tenders:pkgTenders,steps:steps,minStage:minStage,maxStage:maxStage,CONTRACT_LABELS:CONTRACT_LABELS,counts:counts,actions:pkgActions,overdueActions:overdueActions,blockingActions:blockingActions,nextSteps:nextSteps,hasIssues:hasIssues};
  }).filter(function(r){return r.tenders.length>0||r.actions.length>0;});

  var shown=fOnlyIssues?rows.filter(function(r){return r.hasIssues;}):rows;

  function stepDot(agg){
    var c=agg.state==="ok"?"#2e7d32":agg.state==="bad"?"#c62828":agg.state==="progress"?"#f57f17":"#ddd";
    return c;
  }

  function updateAction(id,updates){
    saveTasks((tasks||[]).map(function(t){return t.id===id?stampModified(Object.assign({},t,updates)):t;}));
  }

  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">📦 Packages</div>
        <div className="page-sub">{shown.length} packages · live status from tenders, contracts, quality docs & actions</div>
      </div>
      <button className={"fchip"+(fOnlyIssues?" on":"")} onClick={function(){setFOnlyIssues(!fOnlyIssues);}}>⚠️ Issues only</button>
    </div>

    {shown.length===0&&<div className="empty"><div className="empty-ico">📦</div><div className="empty-txt">No packages with activity.</div></div>}

    {shown.map(function(r){
      var isOpen=openPkg===r.pkg;
      return <div key={r.pkg} className="card" style={{marginBottom:8,padding:0,overflow:"hidden",borderColor:r.blockingActions>0?"#f48fb1":r.hasIssues?"#ffe082":"#e8e6df"}}>

        <div onClick={function(){setOpenPkg(isOpen?null:r.pkg);}} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",flexWrap:"wrap",background:isOpen?"#fafaf8":"#fff"}}>
          <span style={{fontSize:12,color:"#aaa"}}>{isOpen?"▾":"▸"}</span>

          <div style={{minWidth:140,flex:"0 0 auto"}}>
            <div style={{fontWeight:700,fontSize:14}}>{r.pkg}</div>
            <div style={{fontSize:10,color:"#888"}}>{r.owner?r.owner.split(",")[0]:"No owner"} · {r.tenders.length} tender{r.tenders.length!==1?"s":""}</div>
          </div>

          <div style={{display:"flex",gap:4,alignItems:"center",flex:"0 0 auto"}}>
            {r.steps.map(function(s){
              return <div key={s.key} title={s.key.toUpperCase()+": "+s.agg.label} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:stepDot(s.agg)}}></div>
                <span style={{fontSize:7,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>{s.key}</span>
              </div>;
            })}
          </div>

          <div style={{flex:"0 0 auto",minWidth:100}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>Contract</div>
            <div style={{fontSize:11,fontWeight:700,color:r.maxStage===4?"#2e7d32":r.maxStage>0?"#f57f17":"#bbb"}}>
              {r.tenders.length===0?"—":r.minStage===r.maxStage?r.CONTRACT_LABELS[r.maxStage]:r.CONTRACT_LABELS[r.minStage]+" → "+r.CONTRACT_LABELS[r.maxStage]}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",gap:5,alignItems:"center"}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase",marginRight:2}}>Quality</div>
            {r.counts.approved>0&&<span className="badge" style={{background:"#e8f5e9",color:"#2e7d32"}}>✓{r.counts.approved}</span>}
            {r.counts.pending>0&&<span className="badge" style={{background:"#fff8e1",color:"#f57f17"}}>⏳{r.counts.pending}</span>}
            {r.counts.prep>0&&<span className="badge" style={{background:"#e3f2fd",color:"#1565c0"}}>🛠{r.counts.prep}</span>}
            {r.counts.rejected>0&&<span className="badge" style={{background:"#fce4ec",color:"#c62828"}}>✗{r.counts.rejected}</span>}
            {r.counts.overdue>0&&<span className="badge" style={{background:"#c62828",color:"#fff"}}>⚠{r.counts.overdue}</span>}
            {r.counts.approved+r.counts.pending+r.counts.prep+r.counts.rejected===0&&<span style={{fontSize:11,color:"#ccc"}}>—</span>}
          </div>

          <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flex:"0 0 auto"}}>
            {r.blockingActions>0&&<span className="badge" style={{background:"#c62828",color:"#fff",fontSize:11}}>🔴 {r.blockingActions} blocking</span>}
            {r.overdueActions>0&&<span className="badge" style={{background:"#fff3e0",color:"#e65100",fontSize:11}}>⚠️ {r.overdueActions} late</span>}
            <span className="badge" style={{background:r.actions.length>0?"#1c1c1e":"#f5f4f0",color:r.actions.length>0?"#fff":"#aaa",fontSize:11}}>{r.actions.length} open action{r.actions.length!==1?"s":""}</span>
          </div>
        </div>

        {isOpen&&<div style={{borderTop:"1.5px solid #f0ede6",padding:"12px 16px",background:"#fafaf8"}}>

          {r.nextSteps.length>0&&<div style={{marginBottom:10,padding:"8px 12px",background:"#f3e5f5",borderRadius:7,border:"1px solid #ce93d8"}}>
            <div style={{fontSize:10,fontWeight:800,color:"#7b1fa2",marginBottom:3,textTransform:"uppercase"}}>🎯 Next steps</div>
            {r.nextSteps.map(function(ns,i){return <div key={i} style={{fontSize:12,color:"#4a148c"}}>{ns}</div>;})}
          </div>}

          {r.tenders.length>0&&<div style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:4}}>Tenders</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {r.tenders.map(function(t){
                return <button key={t.id} className="btn btn-sm" onClick={function(){if(onNavTender)onNavTender(t.id,"packages");}} style={{fontSize:11}}>📑 {t.title}</button>;
              })}
            </div>
          </div>}

          <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:4}}>Open actions ({r.actions.length})</div>
          {r.actions.length===0&&<div style={{fontSize:12,color:"#bbb"}}>No open actions for this package. 🎉</div>}
          {r.actions.slice().sort(function(a,b){
            var ab=(a.tags||[]).includes("Blocking Point")?0:1;
            var bb=(b.tags||[]).includes("Blocking Point")?0:1;
            if(ab!==bb)return ab-bb;
            return(a.due||"9999")<(b.due||"9999")?-1:1;
          }).map(function(a){
            var isLate=a.due&&a.due<todayStr;
            var isBlocking=(a.tags||[]).includes("Blocking Point");
            return <div key={a.id} className="ac-item" style={{borderColor:isBlocking?"#f48fb1":isLate?"#ffe082":"#e8e6df",background:isBlocking?"#fff5f7":"#fff"}}>
              <div className={"ac-check"+(a.status==="done"?" done":"")} onClick={function(){updateAction(a.id,{status:a.status==="done"?"pending":"done",completedAt:a.status==="done"?"":todayStr});}}>{a.status==="done"?"✓":""}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="ac-text">{a.text}</div>
                <div className="ac-meta">
                  {a.owner&&<OwnerChip owner={a.owner}/>}
                  {a.due&&<span style={{fontSize:10,fontWeight:700,color:isLate?"#c62828":"#888"}}>{isLate?"⚠️ ":""}📅 {fmtDate(a.due)}</span>}
                  {(a.tags||[]).map(function(tg){return <TagChip key={tg} tag={tg}/>;})}
                  {a.addedBy&&<span style={{fontSize:9,color:"#bbb"}}>by {a.addedBy==="System"?"🤖 System":a.addedBy.split(",")[0]}</span>}
                </div>
              </div>
              <select value={a.status||"pending"} onChange={function(e){updateAction(a.id,{status:e.target.value,completedAt:e.target.value==="done"?todayStr:""});}} style={{fontSize:10,padding:"2px 4px",width:100,flexShrink:0}}>
                {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
              </select>
            </div>;
          })}
        </div>}
      </div>;
    })}
  </div>;
}

function DashboardView({tasks,trackers,people,tenders,contractors,packages,tags,tagrules,pkgrules,onJumpOwner,onNavTender}){
  const [dashTab,setDashTab]=useState("overview");
  var allActions=[];
  (tasks||[]).forEach(function(t){if(!t.isInfo)allActions.push(Object.assign({},t,{_src:"task"}));});
  (trackers||[]).forEach(function(tr){(tr.actions||[]).forEach(function(a){if(!a.isInfo)allActions.push(Object.assign({},a,{_src:"tracker",_trId:tr.id}));});});

  var active=allActions.filter(function(a){return a.status!=="done"&&a.status!=="blocked";});
  var overdue=active.filter(function(a){return a.due&&a.due<today();});
  var done=allActions.filter(function(a){return a.status==="done";});

  var personList=(people||[]).filter(function(p){return active.some(function(a){return a.owner===p;});});

  var high=active.filter(function(a){return calcScore(a.importance||1,a.urgence||1)>=7;}).length;
  var mid=active.filter(function(a){var s=calcScore(a.importance||1,a.urgence||1);return s>=4&&s<7;}).length;
  var low=active.filter(function(a){return calcScore(a.importance||1,a.urgence||1)<4;}).length;

  function PieChart({data,size}){
    var sz=size||120;var total=data.reduce(function(s,d){return s+d.value;},0);
    if(total===0)return <div style={{width:sz,height:sz,borderRadius:"50%",background:"#e8e6df",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#aaa"}}>No data</div>;
    var paths=[];var angle=-Math.PI/2;
    data.forEach(function(d,i){
      if(d.value===0)return;
      var slice=(d.value/total)*Math.PI*2;
      var x1=Math.cos(angle)*sz/2;var y1=Math.sin(angle)*sz/2;
      angle+=slice;
      var x2=Math.cos(angle)*sz/2;var y2=Math.sin(angle)*sz/2;
      var large=slice>Math.PI?1:0;
      var cx=sz/2;var cy=sz/2;var r=sz/2-2;
      var path="M "+cx+" "+cy+" L "+(cx+x1*r/(sz/2))+" "+(cy+y1*r/(sz/2))+" A "+r+" "+r+" 0 "+large+" 1 "+(cx+x2*r/(sz/2))+" "+(cy+y2*r/(sz/2))+" Z";
      paths.push(<path key={i} d={path} fill={d.color} stroke="#fff" strokeWidth={1}/>);
    });
    return <svg width={sz} height={sz} viewBox={"0 0 "+sz+" "+sz}>{paths}</svg>;
  }

  function PersonCard({name}){
    var myTasks=active.filter(function(a){return a.owner===name;}).sort(function(a,b){return calcScore(b.importance||1,b.urgence||1)-calcScore(a.importance||1,a.urgence||1);});
    var myOverdue=myTasks.filter(function(a){return a.due&&a.due<today();});
    var myHigh=myTasks.filter(function(a){return calcScore(a.importance||1,a.urgence||1)>=7;}).length;
    var myMid=myTasks.filter(function(a){var s=calcScore(a.importance||1,a.urgence||1);return s>=4&&s<7;}).length;
    var myLow=myTasks.length-myHigh-myMid;
    var shortName=name.split(",")[0];
    return <div className="card" style={{marginBottom:12}}>
      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
        <div style={{textAlign:"center",flexShrink:0}}>
          <div style={{width:36,height:36,borderRadius:"50%",background:"#f0ede6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,margin:"0 auto 4px"}}>{shortName[0]}</div>
          <div onClick={function(){if(onJumpOwner)onJumpOwner(name);}} style={{fontSize:11,fontWeight:700,color:onJumpOwner?"#3949ab":"#1a1a1a",whiteSpace:"nowrap",cursor:onJumpOwner?"pointer":"default",textDecoration:onJumpOwner?"underline":"none"}}>{shortName}</div>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <span style={{fontSize:12,fontWeight:700}}>{myTasks.length} actions</span>
            {myOverdue.length>0&&<span style={{fontSize:11,padding:"1px 7px",borderRadius:8,background:"#fce4ec",color:"#c62828",fontWeight:700}}>⚠️ {myOverdue.length} overdue</span>}
            {myHigh>0&&<span style={{fontSize:11,padding:"1px 7px",borderRadius:8,background:"#ffebee",color:"#c62828"}}>🔴 {myHigh}</span>}
            {myMid>0&&<span style={{fontSize:11,padding:"1px 7px",borderRadius:8,background:"#fff8e1",color:"#f57f17"}}>🟠 {myMid}</span>}
            {myLow>0&&<span style={{fontSize:11,padding:"1px 7px",borderRadius:8,background:"#f5f5f5",color:"#888"}}>⚪ {myLow}</span>}
          </div>
          {myOverdue.length>0&&<div style={{marginBottom:6}}>
            <div style={{fontSize:10,fontWeight:800,color:"#c62828",marginBottom:3}}>OVERDUE</div>
            {myOverdue.slice(0,3).map(function(a){return <div key={a.id} style={{fontSize:11,color:"#c62828",padding:"2px 0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>• {a.text}</div>;})}
            {myOverdue.length>3&&<div style={{fontSize:10,color:"#c62828"}}>+{myOverdue.length-3} more</div>}
          </div>}
          {myTasks.filter(function(a){return !a.due||a.due>=today();}).slice(0,3).map(function(a){var sc=calcScore(a.importance||1,a.urgence||1);var ss=scoreStyle(sc);return <div key={a.id} style={{fontSize:11,color:"#555",padding:"2px 0",display:"flex",gap:4,alignItems:"center"}}>
            {sc>1&&<span style={{width:16,height:16,borderRadius:3,background:ss.bg,color:ss.color,fontSize:9,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{sc}</span>}
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.text}</span>
          </div>;})}
        </div>
        <PieChart size={70} data={[{value:myHigh,color:"#c62828"},{value:myMid,color:"#f57f17"},{value:myLow,color:"#bbb"}]}/>
      </div>
    </div>;
  }

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr" style={{marginBottom:12}}>
      <div><div className="page-title">Dashboard</div><div className="page-sub">Team overview · {active.length} active · {overdue.length} overdue</div></div>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:16}}>
      <button className={"fchip"+(dashTab==="overview"?" on":"")} onClick={function(){setDashTab("overview");}}>📊 Overview</button>
      <button className={"fchip"+(dashTab==="weekly"?" on":"")} onClick={function(){setDashTab("weekly");}}>📋 My Week</button>
    </div>
    {dashTab==="weekly"&&<WeeklyView tasks={tasks} trackers={trackers} people={people} tags={tags||[]} tagrules={tagrules||{}} pkgrules={pkgrules||{}} packages={packages} tenders={tenders} contractors={contractors}/>}
    {dashTab!=="weekly"&&<div>

    <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
      {[
        {label:"Total active",val:active.length,color:"#1a1a1a"},
        {label:"Overdue",val:overdue.length,color:"#c62828"},
        {label:"High priority",val:high,color:"#c62828"},
        {label:"Medium",val:mid,color:"#f57f17"},
        {label:"Standard",val:low,color:"#888"},
        {label:"Done",val:done.length,color:"#2e7d32"}
      ].map(function(k){return <div key={k.label} className="card" style={{flex:1,minWidth:100,marginBottom:0,padding:"10px 14px",textAlign:"center"}}>
        <div style={{fontSize:24,fontWeight:900,color:k.color}}>{k.val}</div>
        <div style={{fontSize:10,color:"#aaa",marginTop:2}}>{k.label}</div>
      </div>;})}
    </div>

    <div style={{display:"flex",gap:14,marginBottom:20,flexWrap:"wrap"}}>
      <div className="card" style={{flex:1,minWidth:200}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Priority Distribution</div>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          <PieChart size={100} data={[{value:high,color:"#c62828"},{value:mid,color:"#f57f17"},{value:low,color:"#bbb"}]}/>
          <div>
            {[{label:"High (7-9)",val:high,color:"#c62828"},{label:"Medium (4-6)",val:mid,color:"#f57f17"},{label:"Standard (1-3)",val:low,color:"#bbb"}].map(function(d){return <div key={d.label} style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
              <div style={{width:10,height:10,borderRadius:2,background:d.color,flexShrink:0}}/>
              <span style={{fontSize:11,color:"#555"}}>{d.label}</span>
              <span style={{fontSize:11,fontWeight:700,marginLeft:"auto"}}>{d.val}</span>
            </div>;})}
          </div>
        </div>
      </div>
      <div className="card" style={{flex:1,minWidth:200}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:"#c62828"}}>⚠️ Overdue Actions ({overdue.length})</div>
        {overdue.length===0?<div style={{color:"#bbb",fontSize:12}}>No overdue actions 🎉</div>
        :overdue.slice(0,6).sort(function(a,b){return calcScore(b.importance||1,b.urgence||1)-calcScore(a.importance||1,a.urgence||1);}).map(function(a){var sc=calcScore(a.importance||1,a.urgence||1);var ss=scoreStyle(sc);return <div key={a.id} style={{display:"flex",gap:6,alignItems:"center",padding:"4px 0",borderBottom:"1px solid #f5f5f5"}}>
          <span style={{fontSize:10,fontWeight:700,padding:"1px 5px",borderRadius:5,background:ss.bg,color:ss.color,flexShrink:0}}>{sc}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.text}</div>
            <div style={{fontSize:10,color:"#c62828"}}>{a.due?fmtDate(a.due):""} {a.owner&&"· "+a.owner.split(",")[0]}</div>
          </div>
        </div>;})}
      </div>
    </div>

    <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>By Team Member</div>

    <div className="card" style={{marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>📊 Tenders Submission Overview</div>
      {(function(){
        var now=new Date();
        var months=[];
        for(var m=-3;m<=6;m++){var d=new Date(now.getFullYear(),now.getMonth()+m,1);months.push({key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),label:d.toLocaleString("default",{month:"short",year:"2-digit"})});}
        var submitted=[];var remaining=[];
        months.forEach(function(mo){
          var sub=(tenders||[]).filter(function(t){
            var acc=((t.stepDates||{}).acc||{});
            var doneDate=(acc.done||"").slice(0,7);
            return doneDate===mo.key;
          }).length;
          var rem=(tenders||[]).filter(function(t){
            var acc=((t.stepDates||{}).acc||{});
            var targetDate=(acc.target||"").slice(0,7);
            return !acc.done&&targetDate===mo.key;
          }).length;
          submitted.push(sub);
          remaining.push(rem);
        });
        var maxVal=Math.max(1,...submitted,...remaining);
        var barH=120;
        return <div style={{overflowX:"auto"}}>
          <div style={{display:"flex",gap:4,alignItems:"flex-end",minWidth:months.length*52}}>
            {months.map(function(mo,idx){return <div key={mo.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div style={{display:"flex",gap:2,alignItems:"flex-end",height:barH}}>
                <div title={"Submitted: "+submitted[idx]} style={{width:18,height:Math.max(2,submitted[idx]/maxVal*barH),background:"#2e7d32",borderRadius:"3px 3px 0 0",cursor:"default"}}/>
                <div title={"Remaining: "+remaining[idx]} style={{width:18,height:Math.max(remaining[idx]>0?2:0,remaining[idx]/maxVal*barH),background:"#f57c00",borderRadius:"3px 3px 0 0",cursor:"default"}}/>
              </div>
              <div style={{fontSize:9,color:"#aaa",textAlign:"center",whiteSpace:"nowrap"}}>{mo.label}</div>
            </div>;})}
          </div>
          <div style={{display:"flex",gap:12,marginTop:8,justifyContent:"center"}}>
            <span style={{fontSize:10,display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,background:"#2e7d32",borderRadius:2,display:"inline-block"}}/>Submitted</span>
            <span style={{fontSize:10,display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,background:"#f57c00",borderRadius:2,display:"inline-block"}}/>To submit</span>
          </div>
        </div>;
      })()}
    </div>
    {personList.length===0?<div className="empty"><div className="empty-ico">👥</div><div className="empty-txt">No actions assigned to team members yet.</div></div>
    :personList.map(function(name){return <PersonCard key={name} name={name}/>;} )}
  </div>}
  </div>;
}

function DocumentsView({tasks,tenders,contractors,packages,people,saveTasks,onNavTender}){
  const [fTender,setFTender]=useState("all");
  const [fPkg,setFPkg]=useState("all");
  const [fOwner,setFOwner]=useState("all");
  const [fStage,setFStage]=useState("all");
  const [fStatus,setFStatus]=useState("overdue");

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

  var docs=[];
  var todayStr=today();

  (tasks||[]).forEach(function(t){
    var isRfi=(t.tags||[]).includes("RFI");
    var isFcr=(t.tags||[]).includes("FCR");
    if(!isRfi&&!isFcr)return;
    var stageKey=isFcr?"fcr":"rfi";
    var stageLbl=isFcr?"FCR":"RFI";
    var tdr=(tenders||[]).find(function(x){return x.id===t.tenderRef;})||null;
    var ctr=(contractors||[]).find(function(x){return x.id===t.contractorRef;})||null;
    var submitted=t.rfiSubmission||"";
    var due=t.rfiDue||(submitted?(function(){var d=new Date(submitted);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"");
    var overdue=due&&due<todayStr&&t.status!=="done";
    docs.push({
      id:t.id,stage:stageKey,stageLabel:stageLbl,
      text:t.text,owner:t.owner||"",
      package:t.package||"",
      tenderRef:t.tenderRef||"",tenderTitle:tdr?tdr.title:"",
      submissionDate:submitted,dueDate:due,
      status:t.status,overdue:overdue,
      daysOverdue:due?workingDaysDiff(due,todayStr):0,
      _taskId:t.id,_type:"task"
    });
  });

  (contractors||[]).forEach(function(ctr){
    (ctr.contracts||[]).forEach(function(ct){
      [{key:"contract_acc",label:"Contract ACC",dk:"acc"},{key:"contract_aconex",label:"Contract ACONEX",dk:"aconex"}].forEach(function(docType){
        var status=ct[docType.dk+"Status"]||"";
        var subDate=ct[docType.dk+"Date"]||"";
        if(!subDate&&!status)return;
        var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
        var overdue=status!=="approved"&&!!due14&&due14<todayStr;
        var daysOverdue=overdue?workingDaysDiff(due14,todayStr):0;
        docs.push({
          id:ct.id+"_"+docType.dk,stage:docType.key,stageLabel:docType.label,
          text:ctr.name+(ct.number?" — "+ct.number:"")+" ("+docType.label+")",
          owner:ct.owner||ctr.owner||"",package:ct.package||ctr.package||"",
          tenderRef:ct.tenderRef||"",tenderTitle:"",submissionDate:subDate,
          dueDate:due14,targetDate:subDate,overdue:overdue,daysOverdue:daysOverdue,
          stepStatus:status,_type:"contract"
        });
      });
      (ct.addendums||[]).forEach(function(ad){
        [{key:"contract_acc",label:"Add. ACC",dk:"acc"},{key:"contract_aconex",label:"Add. ACONEX",dk:"aconex"}].forEach(function(docType){
          var status=ad[docType.dk+"Status"]||"";
          var subDate=ad[docType.dk+"Date"]||"";
          if(!subDate&&!status)return;
          var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
          var overdue=status!=="approved"&&!!due14&&due14<todayStr;
          docs.push({
            id:ct.id+"_add_"+ad.id+"_"+docType.dk,stage:docType.key,stageLabel:"Addum. "+docType.label.split(" ")[1],
            text:ctr.name+(ct.number?" C"+ct.number:"")+(ad.number?" Add."+ad.number:"")+" ("+docType.label.split(" ")[1]+")",
            owner:ct.owner||ctr.owner||"",package:ct.package||ctr.package||"",
            tenderRef:ct.tenderRef||"",tenderTitle:"",submissionDate:subDate,
            dueDate:due14,targetDate:subDate,overdue:overdue,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
            stepStatus:status,_type:"contract"
          });
        });
      });
    });
  });

  (tenders||[]).forEach(function(td){
    if(!td.hasSD)return;
    var subDone=td.sdDone||"";
    var appDone=td.sdApprovalDone||"";
    var appStatus=td.sdApprovalStatus||"";
    if(!subDone)return;
    var due14=(function(){var d=new Date(subDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}());
    var overdue=appStatus!=="approved"&&!appDone&&due14<todayStr;
    var daysOverdue=overdue?workingDaysDiff(due14,todayStr):0;
    docs.push({
      id:td.id+"_sd",stage:"sd_approval",stageLabel:"SD Approval",
      text:td.title+" — SD Approval",
      owner:td.ownerTender||"",package:td.package||"",
      tenderRef:td.id,tenderTitle:td.title,
      submissionDate:subDone,dueDate:due14,targetDate:subDone,
      overdue:overdue,daysOverdue:daysOverdue,
      stepStatus:appStatus||"pending approval",_type:"tender"
    });
  });

  var TENDER_DOC_STEPS=["acc","mar","itp","wms"];
  var STEP_LABELS={acc:"ACC/ACONEX",mar:"MAR",itp:"ITP",wms:"WMS"};
  (tenders||[]).forEach(function(td){
    TENDER_DOC_STEPS.forEach(function(step){
      var stepStatus=(td.steps||{})[step]||"";
      var targetDate=((td.stepDates||{})[step]||{}).target||"";
      var doneDate=((td.stepDates||{})[step]||{}).done||"";
      var approvalDate=((td.stepDates||{})[step]||{}).approval||"";

      var isApproved=stepStatus.toLowerCase().includes("approved");
      var isDone=!!doneDate||isApproved;
      var isApprovalDone=!!approvalDate||isApproved;

      var dueDateFromDone=doneDate?(function(){var d=new Date(doneDate);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";

      var dueDateFromTarget=targetDate?(function(){var d=new Date(targetDate);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";

      var effectiveDue=doneDate?dueDateFromDone:dueDateFromTarget;
      var effectiveSubmission=doneDate||"";
      if(!effectiveDue)return;
      var overdue=(doneDate?!isApprovalDone:!isDone)&&effectiveDue<todayStr;
      var daysOverdue=overdue?workingDaysDiff(effectiveDue,todayStr):0;
      docs.push({
        id:td.id+"_"+step,stage:step,stageLabel:STEP_LABELS[step],
        text:td.title+" — "+STEP_LABELS[step],
        owner:td.ownerTender||"",
        package:td.package||"",
        tenderRef:td.id,tenderTitle:td.title,
        submissionDate:effectiveSubmission||doneDate||"",dueDate:effectiveDue,targetDate:targetDate,
        status:isDone?"done":"pending",overdue:overdue,
        daysOverdue:daysOverdue,
        stepStatus:stepStatus,
        _tenderId:td.id,_step:step,_type:"tender"
      });
    });
  });

  // MSS and MAR submitted items — overdue after 14 calendar days without approval
  (tenders||[]).forEach(function(td){
    (td.materials||[]).forEach(function(mat){
      [{type:"mss",label:"MSS"},{type:"mar",label:"MAR"}].forEach(function(m){
        var status=mat[m.type+"Status"]||"";
        var approvalStatus=mat[m.type+"ApprovalStatus"]||"";
        var done=mat[m.type+"Done"]||"";
        var target=mat[m.type+"Target"]||"";
        var isSubmittedPhase=(status==="submitted"||status==="pending approval"||approvalStatus==="pending approval");
        if(!isSubmittedPhase||!done)return;
        var due14=(function(){var d=new Date(done);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}());
        var overdue=approvalStatus!=="approved"&&due14<todayStr;
        docs.push({
          id:td.id+"_"+mat.id+"_"+m.type,
          stage:m.type,stageLabel:m.label+" Approval",
          text:td.title+" — "+m.label+": "+(mat.name||"—"),
          owner:td.ownerTender||"",package:td.package||"",
          tenderRef:td.id,tenderTitle:td.title,
          submissionDate:done,dueDate:due14,targetDate:target,
          overdue:overdue,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
          stepStatus:approvalStatus||"Pending approval",_type:"material"
        });
      });
    });
  });

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

function NewTasksPopup({tasks,tenders,contractors,onClose}){
  return <div className="overlay" style={{zIndex:800}} onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"#fff",borderRadius:16,width:480,maxWidth:"92vw",maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:"0 16px 48px rgba(0,0,0,.25)"}}>
      <div style={{background:"#3949ab",borderRadius:"16px 16px 0 0",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,fontWeight:700,color:"#fff",letterSpacing:".5px"}}>🔔 New tasks assigned to you</div>
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

  const saveT=d=>{setTasks(d);mergeSync(KEYS.tasks,d,"id");};
  const saveX=d=>{setTrackers(d);mergeSync(KEYS.trackers,d,"id");};
  const saveTenders=d=>{setTenders(d);sync(KEYS.tenders,d);};
  const saveContractors=d=>{setContractors(d);mergeSync(KEYS.contractors,d,"id");};
  const savePeople=d=>{setPeople(d);sync(KEYS.people,d);};
  const savePackages=d=>{setPackages(d);sync(KEYS.packages,d);};
  const saveTags=d=>{setTags(d);sync(KEYS.tags,d);};
  const saveTagrules=d=>{setTagrules(d);sync(KEYS.tagrules,d);};
  const savePkgrules=d=>{setPkgrules(d);sync(KEYS.pkgrules,d);};

  useEffect(()=>{
    const load=async()=>{
      try{
        const [t,x,td,ct,p,pk,g,tr,pr,imp,corr,awn,pko,prefs]=await Promise.all([
          cloudStore.get(KEYS.tasks),cloudStore.get(KEYS.trackers),cloudStore.get(KEYS.tenders),
          cloudStore.get(KEYS.contractors),cloudStore.get(KEYS.people),cloudStore.get(KEYS.packages),
          cloudStore.get(KEYS.tags),cloudStore.get(KEYS.tagrules),cloudStore.get(KEYS.pkgrules),cloudStore.get(KEYS_IMP),cloudStore.get(KEYS_CORR),cloudStore.get(KEYS_AWN),cloudStore.get(KEYS.pkgowners),cloudStore.get(KEYS_PREFS)
        ]);
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
        if(g){setTags(g);}
        else{
          const og=await cloudStore.get("tags");
          const finalG=og&&og.length?og:SEED_TAGS;
          setTags(finalG);sync(KEYS.tags,finalG);
        }
        if(imp)setImprovements(imp);
        if(corr)setCorrespondences(corr);
        if(awn)setAwns(awn);
        if(pko)setPkgOwners(pko);
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
      setLoaded(true);

      if(window._dbListen){
        window._dbListen(KEYS.tasks,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTasks(v);});
        window._dbListen(KEYS.trackers,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTrackers(v);});
        window._dbListen(KEYS.tenders,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setTenders(v);});
        window._dbListen(KEYS.contractors,function(val){var v=_parseFirebaseVal(val);if(Array.isArray(v))setContractors(v);});
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
  const NAV=[
    {id:"packages",icon:"📦",label:"Packages"},
    {id:"tenders",icon:"📑",label:"Tenders"},
    {id:"global",icon:"🌐",label:"Actions"},
    {id:"documents",icon:"⚠️",label:"Overdue"},
    {id:"trackers",icon:"📊",label:"Trackers"},
    {id:"contractors",icon:"🤝",label:"Subcontr."},
    {id:"contracts",icon:"📋",label:"Contracts"},
    {id:"awn",icon:"✉️",label:"Letter"},
    {id:"dashboard",icon:"📈",label:"Dashboard"},
    {id:"settings",icon:"⚙️",label:"Settings"},
  ];

  const syncDot=<div className={"sync-dot sync-"+syncStatus} title={syncStatus==="ok"?"Synced":syncStatus==="syncing"?"Syncing…":"Sync error"}/>;

  if(!currentUser)return <UserLogin people={people} onLogin={function(name){setCurrentUser(name);window._currentUser={name:name};}}/>;  return <div className="layout">

    <nav className="leftnav">
      <div className="logo" style={{fontSize:11,lineHeight:1.2,textAlign:"center",letterSpacing:".5px"}}>Project<br/>Tracker</div>
      {currentUser&&<div style={{marginTop:4,padding:"4px 2px",textAlign:"center"}}>
        <div style={{fontSize:9,color:"#c9a84c",fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:52}}>{currentUser}</div>
        <button onClick={function(){try{localStorage.removeItem("pp_current_user");}catch(e){}setCurrentUser(null);}} title="Change user" style={{background:"none",border:"1px solid #444",borderRadius:4,color:"#888",cursor:"pointer",fontSize:8,padding:"1px 3px",fontFamily:"inherit",marginTop:2}}>change</button>
      </div>}

      <div style={{marginBottom:4,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>{syncDot}<span style={{fontSize:7,color:"#888",textAlign:"center"}}>{syncStatus==="syncing"?"saving...":syncStatus==="ok"?"saved":"err"}</span></div>
      {NAV.map(n=><button key={n.id} className={"navbtn"+(view===n.id?" on":"")} onClick={()=>setView(n.id)} title={n.label}>
        <span style={{fontSize:20}}>{n.icon}</span>
        <span className="lbl">{n.label}</span>
      </button>)}
      <div className="nav-sep"/>
    </nav>

    <div className="main-area">
      <div className="content">
        {view==="actions"&&<ActionsView tasks={tasks} setTasks={setTasks} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors} trackers={trackers} saveT={saveT} tagrules={tagrules} pkgrules={pkgrules}/>}
        {view==="trackers"&&<TrackersView trackers={trackers} setTrackers={setTrackers} saveX={saveX} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors} tagrules={tagrules} pkgrules={pkgrules}/>}
        {view==="tenders"&&<TendersView tenders={tenders} saveTenders={saveTenders} packages={packages} people={people} tasks={tasks} saveTasks={saveT} contractors={contractors} pkgOwners={pkgOwners} jumpTender={jumpTender} clearJumpTender={function(){setJumpTender(null);}} jumpFrom={jumpFrom} clearJumpFrom={function(){setJumpFrom(null);}} onBack={jumpFrom?function(){setView(jumpFrom);setJumpTender(null);setJumpFrom(null);}:null}/>}
        {view==="contractors"&&<ContractorsView contractors={contractors} saveContractors={saveContractors} packages={packages} people={people} tasks={tasks} tenders={tenders} apiKey={apiKey} correspondences={correspondences} saveCorrespondences={saveCorrespondences} saveT={saveT} onNavTender={navToTender}/>}
        {view==="contracts"&&<ContractsView contractors={contractors} saveContractors={saveContractors} tenders={tenders} packages={packages} tasks={tasks} saveTasks={saveT}/>}
        {view==="awn"&&<AwnView awns={awns} saveAwns={saveAwns} people={people}/>}
        {view==="packages"&&<PackagesView tasks={tasks} tenders={tenders} contractors={contractors} packages={packages} people={people} pkgOwners={pkgOwners} saveTasks={saveT} tags={tags} onNavTender={navToTender}/>}
        {view==="weekly"&&<WeeklyView tasks={tasks} trackers={trackers} people={people} tags={tags} tagrules={tagrules} pkgrules={pkgrules} packages={packages} tenders={tenders} contractors={contractors}/>}
        {view==="documents"&&<DocumentsView tasks={tasks} tenders={tenders} contractors={contractors} packages={packages} people={people} saveTasks={saveT}/> }
    {view==="dashboard"&&<DashboardView tasks={tasks} trackers={trackers} people={people} tenders={tenders} contractors={contractors} packages={packages} tags={tags} tagrules={tagrules} pkgrules={pkgrules} onJumpOwner={function(name){setJumpOwner(name);setView("global");}} onNavTender={navToTender}/>}
    {view==="global"&&<GlobalView tasks={tasks} trackers={trackers} tenders={tenders} contractors={contractors} people={people} packages={packages} tags={tags} saveTasks={saveT} saveTrackers={saveX} tagrules={tagrules} pkgrules={pkgrules} jumpOwner={jumpOwner} clearJump={function(){setJumpOwner(null);}} onNavTender={navToTender}/>}
        {view==="settings"&&<SettingsView tags={tags} saveTags={saveTags} people={people} savePeople={savePeople} packages={packages} savePackages={savePackages} tagrules={tagrules} saveTagrules={saveTagrules} pkgrules={pkgrules} savePkgrules={savePkgrules} apiKey={apiKey} saveApiKey={saveApiKey} improvements={improvements} saveImprovements={saveImprovements} pkgOwners={pkgOwners} savePkgOwners={savePkgOwners} userPrefs={userPrefs} saveUserPrefs={saveUserPrefs} allData={{tasks,trackers,tenders,contractors,people,packages,tags,tagrules,pkgrules,improvements,correspondences,awns,pkgOwners}} onImport={function(d){if(d.tasks)saveT(d.tasks);if(d.trackers)saveX(d.trackers);if(d.tenders)saveTenders(d.tenders);if(d.contractors)saveContractors(d.contractors);if(d.people)savePeople(d.people);if(d.packages)savePackages(d.packages);if(d.tags)saveTags(d.tags);}}/>}
      </div>

      <aside className={"rsidebar "+(sidebarOpen?"open":"closed")}>
        <div style={{display:"flex",alignItems:"center",justifyContent:sidebarOpen?"flex-end":"center",padding:"8px 8px 0",flexShrink:0}}>
          <button onClick={function(){setSidebarOpen(!sidebarOpen);}} title={sidebarOpen?"Collapse sidebar":"Expand sidebar"}
            style={{background:"none",border:"1px solid #e8e6df",borderRadius:6,cursor:"pointer",padding:"3px 6px",fontSize:12,color:"#888",lineHeight:1}}>
            {sidebarOpen?"›":"‹"}
          </button>
        </div>
        {sidebarOpen&&<QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} trackers={trackers} tags={tags} onAdd={addTask} improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/>}
      </aside>
    <ImprovementBox improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/>
    <div style={{position:"fixed",bottom:16,right:360,zIndex:490}}>
      <button onClick={function(){setShowWeeklyPopup(true);}} title="Weekly Actions" style={{width:36,height:36,borderRadius:"50%",background:"#3949ab",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>📋</button>
    </div>
    {newTasksPopup&&<NewTasksPopup tasks={newTasksPopup} tenders={tenders} contractors={contractors} onClose={function(){setNewTasksPopup(null);}}/> }
    {showWeeklyPopup&&<WeeklyPopup tasks={tasks} trackers={trackers} people={people} tags={tags} tagrules={tagrules} pkgrules={pkgrules} tenders={tenders} contractors={contractors} saveT={saveT} saveX={saveX} onClose={function(){setShowWeeklyPopup(false);}}/>}
    <div className="mobile-qa-btn" onClick={function(){setMobileQAOpen(true);}} title="Quick Add Task" style={{display:"none",position:"fixed",bottom:62,right:16,zIndex:490,width:44,height:44,borderRadius:"50%",background:"#c9a84c",boxShadow:"0 2px 8px rgba(0,0,0,.2)",alignItems:"center",justifyContent:"center",fontSize:22,cursor:"pointer",color:"#1c1c1e"}}>＋</div>
    {mobileQAOpen&&<div className="overlay" style={{zIndex:600}} onClick={function(e){if(e.target===e.currentTarget)setMobileQAOpen(false);}}><div style={{background:"#fff",borderRadius:"16px 16px 0 0",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",position:"absolute",bottom:0}}><QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} trackers={trackers} tags={tags} onAdd={function(t){addTask(t);setMobileQAOpen(false);}} improvements={improvements} saveImprovements={saveImprovements} currentPage={view}/></div></div>}
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

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
