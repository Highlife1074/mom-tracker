
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
  {key:"bidders",label:"Bidders List",opts:["—","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"process",label:"Tender Process",opts:[],special:"process"},
  {key:"acc",label:"ACC/Aconex",opts:["—","Internal review ongoing","Pending client approval","Approved A","Approved B","Approved C"]},
  {key:"contract",label:"Contract",opts:["—","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","Not done","Pending Approval","Approved A","Approved B","Approved C"]},
  {key:"wms",label:"WMS",opts:["—","Not done","Pending Approval","Approved A","Approved B","Approved C"]}
];
function tenderStepClass(step,val){
  if(!val||val==="—")return"s-default";
  var v=val.toLowerCase();

  if(v.includes("approved")||v==="signed")return"s-approved-a";

  if(v.includes("reject")||v.includes("not approved")||v.includes("not done"))return"s-notdone";

  if(v.includes("pending")||v.includes("ongoing")||v.includes("circulation")||v.includes("sent")||v.includes("preparation")||v.includes("submitted")||v.includes("request")||v.includes("bids"))return"s-pending";
  return"s-default";
}

// Defaults
const SEED_PEOPLE=["BALLAS, Antonios","CHATZIROUMPIS, Vasilis","FYTOPOULOU, Katerina","KLEFTOSPYROU, Georgia","KOUTOULAKI, Anna","MAKROVASILI, Anastasia","NASIS, Athanasios","PLOUMISTOS, Georgios","ROSIOS, Irodion","ROUSSIN, Yanis","TSIAMPAOS, Konstantinos","VRETTOU, Eirini"];
const SEED_TAGS=["Contract","Design","HR","Procurement","Production","RFI","Top Management"];
const SEED_PACKAGES=["Facade","Structure","MEP","Civil","Podium","External Works"];

const STATUS_OPTS=["pending","in progress","done","blocked"];
const STATUS_ICONS={pending:"⏳","in progress":"🔄",done:"✅",blocked:"🚫"};

function stampModified(task){var u=Object.assign({},task);u.lastModifiedBy=window._currentUser?window._currentUser.name:"";u.lastModifiedAt=today();return u;}
function newTask(overrides){var base={id:uuid(),text:"",owner:"",package:"",status:"pending",importance:1,urgence:1,due:"",note:"",tags:[],tenderRef:"",contractorRef:"",trackerRef:"",createdAt:today(),rfiSubmission:"",rfiDue:"",rfiOverdue:false,addedBy:window._currentUser?window._currentUser.name:"",lastModifiedBy:"",lastModifiedAt:"",links:[]};return Object.assign(base,overrides||{});}
function newTracker(overrides){return Object.assign({id:uuid(),title:"",description:"",createdAt:today(),actions:[]},overrides||{});}
function newTrackerAction(){return{id:uuid(),text:"",owner:"",package:"",status:"pending",importance:1,urgence:1,due:"",tags:[],tenderRef:"",contractorRef:"",details:"",createdAt:today()};}
function newTender(overrides){return Object.assign({id:uuid(),title:"",package:"",ownerPackage:"",ownerTender:"",createdAt:today(),targetDate:"",steps:{bidders:"",pkg:"",process:"",acc:"",contract:"",mar:"",itp:"",wms:""},stepDates:{bidders:{target:"",done:""},pkg:{target:"",done:""},process:{target:"",done:""},acc:{target:"",done:"",approval:""},contract:{target:"",done:""},mar:{target:"",done:"",approval:""},itp:{target:"",done:"",approval:""},wms:{target:"",done:"",approval:""}},stepComments:{bidders:"",pkg:"",process:"",acc:"",contract:"",mar:"",itp:"",wms:""},stepLinks:{bidders:[],pkg:[],process:[],acc:[],contract:[],mar:[],itp:[],wms:[]},description:"",budget:"",instructionAmount:"",currency:"EUR"},overrides||{});}
function newContractor(overrides){return Object.assign({id:uuid(),name:"",package:"",owner:"",tenderRefs:[],contracts:[],createdAt:today()},overrides||{});}
function newContract(){return{id:uuid(),number:"",sapNumber:"",instructionNumber:"",instructionAmount:0,startDate:"",endDate:"",amount:0,currency:"EUR",package:"",tenderRef:"",owner:"",closed:false,cacSigned:false,addendums:[],certifications:[],description:"",accSigned:false,accDate:"",accStatus:"",aconexSigned:false,aconexDate:"",aconexStatus:"",wbs:""};}
function newAddendum(){return{id:uuid(),number:"",instructionNumber:"",instructionAmount:0,date:"",amount:0,description:"",comment:"",accSigned:false,accDate:"",accStatus:"",aconexSigned:false,aconexDate:"",aconexStatus:""};}
function newCertification(){return{id:uuid(),number:"",date:"",amount:0,description:"",comment:""};}

const cloudStore={
  get:async(key)=>{if(!window._db)return null;return await window._db.get(key);},
  set:async(key,val)=>{if(!window._db)return;await window._db.set(key,val);}
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
    if(selTags.includes("RFI")){td.rfiSubmission=rfiSub;td.rfiDue=rfiDue;}
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
      {selTags.includes("RFI")&&<div className="fg">
        <label style={{color:"#b45309"}}>📋 RFI Dates</label>
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

function ActionItem({task,onStatusChange,onUpdate,onDelete,people,packages,tags,tenders,contractors,showCreated}){
  const [editMode,setEditMode]=useState(false);
  const [localTags,setLocalTags]=useState(task.tags||[]);
  const [localRfiSub,setLocalRfiSub]=useState(task.rfiSubmission||"");
  const [localRfiDue,setLocalRfiDue]=useState(task.rfiDue||"");
  const sc=calcScore(task.importance||1,task.urgence||1);

  useEffect(function(){setLocalTags(task.tags||[]);},[task.tags]);
  useEffect(function(){setLocalRfiSub(task.rfiSubmission||"");setLocalRfiDue(task.rfiDue||"");},[task.rfiSubmission,task.rfiDue]);
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
              <button className="btn btn-sm" onClick={function(){upd("links",[...(task.links||[]),{label:"",url:""}]);}} style={{fontSize:10,padding:"2px 8px"}}>＋ Add link</button>
            </div>
            {localTags.includes("RFI")&&<div style={{display:"flex",gap:8,padding:"8px",background:"#fff8f0",borderRadius:7,border:"1px solid #fed7aa"}}>
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
            {(task.tags||[]).includes("RFI")&&<div style={{fontSize:10,color:"#b45309",marginTop:3,background:"#fff8f0",padding:"3px 8px",borderRadius:5,display:"inline-block"}}>
              📋 RFI {task.rfiSubmission?"submitted: "+fmtDate(task.rfiSubmission):"⚠️ No submission date"} {task.rfiDue&&"· due: "+fmtDate(task.rfiDue)}
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
    {selTags.includes("RFI")&&<div style={{display:"flex",gap:8,padding:"8px 10px",background:"#fff8f0",borderRadius:8,border:"1px solid #fed7aa",marginTop:8}}>
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

  return <div>
    <div className="page-hdr">
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
function MaterialsPanel({td,updTd,saveT,tasks,tenders,saveTenders,setSelTender}){
  const [open,setOpen]=useState(true);
  var mats=td.materials||[];

  function autoTask(mat,kind,targetDate){
    if(!saveT||!tasks)return;

    var taskText="["+kind+"] "+mat.name+" — "+td.title;
    var exists=(tasks||[]).some(function(t){
      return t.tenderRef===td.id&&t.text===taskText&&!t.isInfo;
    });
    if(exists)return;
    var task=newTask({
      text:taskText,
      owner:td.ownerTender||"",
      due:targetDate||"",
      tenderRef:td.id,
      package:td.package||"",
      importance:1,urgence:1,
      tags:[kind],
      note:"Auto-created from material tracking ("+kind+")",
      addedBy:"System"
    });
    saveT([...(tasks||[]),task]);
  }

  function updMat(mi,field,val){
    var ms=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,{[field]:val});});
    updTd("materials",ms);
  }

  return <div className="card" style={{marginBottom:10}}>

    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",marginBottom:open&&mats.length>0?10:0}} onClick={function(){setOpen(!open);}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:13,color:"#aaa"}}>{open?"▾":"▸"}</span>
        <div style={{fontWeight:700,fontSize:13}}>🏗️ Materials {mats.length>0&&<span style={{fontWeight:400,color:"#aaa",fontSize:12}}>({mats.length})</span>}</div>
      </div>
      <button className="btn btn-sm" onClick={function(e){e.stopPropagation();
        var ms=[...mats,{id:uuid(),name:"",specified:"",proposed:"",leadTime:"",
          mssOpen:false,mssStatus:"",mssTarget:"",mssDone:"",mssApprovalStatus:"",mssApprovalTarget:"",mssApprovalDone:"",mssReview:"",mssLink:"",mssLinkLabel:"",mssNumber:"",
          marOpen:false,marStatus:"",marTarget:"",marDone:"",marApprovalStatus:"",marApprovalTarget:"",marApprovalDone:"",marReview:"",marLink:"",marLinkLabel:"",marNumber:"",
          hasPO:false,poNumber:"",poStatus:"",poAccOpen:false,poAccStatus:"",poAccTarget:"",poAccDone:"",poAccApprovalStatus:"",poAccApprovalTarget:"",poAccApprovalDone:"",poAccReview:""}];
        updTd("materials",ms);setOpen(true);
      }}>＋ Material</button>
    </div>

    {open&&<div>
      {mats.length===0&&<div style={{color:"#bbb",fontSize:12,padding:"4px 0"}}>No materials. Click "＋ Material" to add one.</div>}
      {mats.map(function(mat,mi){
        var mssDue=mat.mssDone?(function(){var d=new Date(mat.mssDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
        var mssOv=mat.mssApprovalStatus!=="approved"&&mat.mssApprovalTarget&&mat.mssApprovalTarget<today();
        var marDue=mat.marDone?(function(){var d=new Date(mat.marDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";
        var marOv=mat.marApprovalStatus!=="approved"&&mat.marApprovalTarget&&mat.marApprovalTarget<today();
        var mssOpen=mat.mssOpen||false;
        var marOpen=mat.marOpen||false;

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

          {mat.hasPO&&<div style={{marginBottom:6}}>
            <div onClick={function(){updMat(mi,"poAccOpen",!(mat.poAccOpen));}} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 6px",background:(mat.poAccOpen)?"#fff8f033":"transparent",borderRadius:5,marginBottom:(mat.poAccOpen)?4:0}}>
              <span style={{fontSize:10,color:"#b45309"}}>{mat.poAccOpen?"▾":"▸"}</span>
              <span style={{fontSize:11,fontWeight:700,color:"#b45309"}}>PO ACC/ACONEX</span>
              {!(mat.poAccOpen)&&(mat.poAccStatus||mat.poAccApprovalStatus)&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#fff8f0",color:"#b45309",marginLeft:2}}>{mat.poAccApprovalStatus||mat.poAccStatus}</span>}
              {!(mat.poAccOpen)&&mat.poAccApprovalStatus!=="approved"&&mat.poAccApprovalTarget&&mat.poAccApprovalTarget<today()&&<span style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️</span>}
            </div>
            {mat.poAccOpen&&<div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",padding:"6px 8px",background:"#fff8f022",borderRadius:"6px 6px 0 0",border:"1px solid #fdd9b5",borderBottom:"none"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#b45309",minWidth:90}}>ACC Submission</span>
                <select value={mat.poAccStatus||""} onChange={function(e){updMat(mi,"poAccStatus",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4,fontFamily:"inherit"}}>
                  <option value="">— Status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Target date</span><input type="date" value={mat.poAccTarget||""} onChange={function(e){updMat(mi,"poAccTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Date done</span><input type="date" value={mat.poAccDone||""} onChange={function(e){
                  var dv=e.target.value;updMat(mi,"poAccDone",dv);
                  if(dv&&mat.poAccStatus==="submitted"&&!mat.poAccApprovalTarget){var d=new Date(dv);d.setDate(d.getDate()+14);updMat(mi,"poAccApprovalTarget",d.toISOString().slice(0,10));}
                }} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4}}/></div>
                {(function(){var due=mat.poAccDone?(function(){var d=new Date(mat.poAccDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";var ov=mat.poAccStatus!=="approved"&&due&&due<today();return ov?<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(due,today())}d</span>:null;})()}
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",padding:"6px 8px",background:"#fff8f011",borderRadius:"0 0 6px 6px",border:"1px solid #fdd9b5"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#e65100",minWidth:90}}>ACC Approval</span>
                <select value={mat.poAccApprovalStatus||""} onChange={function(e){updMat(mi,"poAccApprovalStatus",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4,fontFamily:"inherit"}}>
                  <option value="">— Status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Target date</span><input type="date" value={mat.poAccApprovalTarget||""} onChange={function(e){updMat(mi,"poAccApprovalTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Date done</span><input type="date" value={mat.poAccApprovalDone||""} onChange={function(e){updMat(mi,"poAccApprovalDone",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#555",fontWeight:600}}>Review</span>
                  <select value={mat.poAccReview||""} onChange={function(e){updMat(mi,"poAccReview",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #fdd9b5",borderRadius:4,fontFamily:"inherit",fontWeight:mat.poAccReview?"700":"400",color:mat.poAccReview==="A"?"#2e7d32":mat.poAccReview==="Rejected"?"#c62828":"#b45309"}}>
                    <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="Rejected">Rejected</option>
                  </select>
                </div>
                {mat.poAccApprovalStatus!=="approved"&&mat.poAccApprovalTarget&&mat.poAccApprovalTarget<today()&&<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(mat.poAccApprovalTarget,today())}d</span>}
              </div>
            </div>}
          </div>}

          <div style={{marginBottom:4}}>
            <div onClick={function(){updMat(mi,"mssOpen",!mssOpen);}} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 6px",background:mssOpen?"#e8f0fe33":"transparent",borderRadius:5,marginBottom:mssOpen?4:0}}>
              <span style={{fontSize:10,color:"#1a73e8"}}>{mssOpen?"▾":"▸"}</span>
              <span style={{fontSize:11,fontWeight:700,color:"#1a73e8"}}>MSS</span>
              {!mssOpen&&mat.mssNumber&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#e8f0fe",color:"#1a73e8",fontFamily:"monospace",marginLeft:2}}>{mat.mssNumber}</span>}
              {!mssOpen&&(mat.mssStatus||mat.mssApprovalStatus)&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#e8f0fe",color:"#1a73e8",marginLeft:2}}>{mat.mssApprovalStatus||mat.mssStatus}</span>}
              {!mssOpen&&mssOv&&<span style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️</span>}
            </div>
            {mssOpen&&<div>

              <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px 0 8px"}}>
                <span style={{fontSize:9,fontWeight:700,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>MSS N°</span>
                <input type="text" value={mat.mssNumber||""} onChange={function(e){updMat(mi,"mssNumber",e.target.value);}} placeholder="MSS reference number" style={{flex:1,padding:"3px 7px",fontSize:10,border:"1px solid #bbdefb",borderRadius:5}}/>
              </div>

              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",padding:"6px 8px",background:"#e8f0fe22",borderRadius:"6px 6px 0 0",border:"1px solid #e8e6df",borderBottom:"none",marginTop:4}}>
                <span style={{fontSize:10,fontWeight:700,color:"#1a73e8",minWidth:90}}>MSS Submission</span>
                <select value={mat.mssStatus||""} onChange={function(e){
                  var newStatus=e.target.value;
                  updMat(mi,"mssStatus",newStatus);
                  if(newStatus==="under preparation")autoTask(mat,"MSS",mat.mssTarget||"");
                }} style={{fontSize:10,padding:"2px 5px",border:"1px solid #bbdefb",borderRadius:4,fontFamily:"inherit"}}>
                  <option value="">— Status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Target date</span><input type="date" value={mat.mssTarget||""} onChange={function(e){updMat(mi,"mssTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #bbdefb",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Date done</span><input type="date" value={mat.mssDone||""} onChange={function(e){
                  var dv=e.target.value;updMat(mi,"mssDone",dv);
                  if(dv){var d=new Date(dv);d.setDate(d.getDate()+14);var tgt=d.toISOString().slice(0,10);updMat(mi,"mssApprovalTarget",tgt);}
                }} style={{fontSize:10,padding:"2px 5px",border:"1px solid #bbdefb",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:2,alignItems:"center"}}>
                  <input type="text" value={mat.mssLinkLabel||""} onChange={function(e){updMat(mi,"mssLinkLabel",e.target.value);}} placeholder="Link label" style={{width:65,padding:"2px 4px",fontSize:9,border:"1px solid #bbdefb",borderRadius:4}}/>
                  <input type="url" value={mat.mssLink||""} onChange={function(e){updMat(mi,"mssLink",e.target.value);}} placeholder="https://..." style={{width:100,padding:"2px 4px",fontSize:9,border:"1px solid #bbdefb",borderRadius:4}}/>
                  {mat.mssLink&&<a href={mat.mssLink} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{fontSize:9,color:"#3949ab",padding:"1px 4px",borderRadius:4,background:"#f0f0ff",textDecoration:"none"}}>🔗</a>}
                </div>
                {(function(){var due=mat.mssDone?(function(){var d=new Date(mat.mssDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";var ov=mat.mssStatus!=="approved"&&due&&due<today();return ov?<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(due,today())}d</span>:null;})()}
              </div>

              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",padding:"6px 8px",background:"#f0fff422",borderRadius:"0 0 6px 6px",border:"1px solid #e8e6df"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#2e7d32",minWidth:90}}>MSS Approval</span>
                <select value={mat.mssApprovalStatus||""} onChange={function(e){updMat(mi,"mssApprovalStatus",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #c8e6c9",borderRadius:4,fontFamily:"inherit"}}>
                  <option value="">— Status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Target date</span><input type="date" value={mat.mssApprovalTarget||""} onChange={function(e){updMat(mi,"mssApprovalTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #c8e6c9",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Date done</span><input type="date" value={mat.mssApprovalDone||""} onChange={function(e){updMat(mi,"mssApprovalDone",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #c8e6c9",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#555",fontWeight:600}}>Review</span>
                  <select value={mat.mssReview||""} onChange={function(e){updMat(mi,"mssReview",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #c8e6c9",borderRadius:4,fontFamily:"inherit",fontWeight:mat.mssReview?"700":"400",color:mat.mssReview==="A"?"#2e7d32":mat.mssReview==="Rejected"?"#c62828":"#555"}}>
                    <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="Rejected">Rejected</option>
                  </select>
                </div>
                {mssOv&&<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(mat.mssApprovalTarget,today())}d</span>}
              </div>
            </div>}
          </div>

          <div>
            <div onClick={function(){updMat(mi,"marOpen",!marOpen);}} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 6px",background:marOpen?"#f3e5f533":"transparent",borderRadius:5,marginBottom:marOpen?4:0}}>
              <span style={{fontSize:10,color:"#7b1fa2"}}>{marOpen?"▾":"▸"}</span>
              <span style={{fontSize:11,fontWeight:700,color:"#7b1fa2"}}>MAR</span>
              {!marOpen&&mat.marNumber&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#f3e5f5",color:"#7b1fa2",fontFamily:"monospace",marginLeft:2}}>{mat.marNumber}</span>}
              {!marOpen&&(mat.marStatus||mat.marApprovalStatus)&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#f3e5f5",color:"#7b1fa2",marginLeft:2}}>{mat.marApprovalStatus||mat.marStatus}</span>}
              {!marOpen&&marOv&&<span style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️</span>}
            </div>
            {marOpen&&<div>

              <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px 0 8px"}}>
                <span style={{fontSize:9,fontWeight:700,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>MAR N°</span>
                <input type="text" value={mat.marNumber||""} onChange={function(e){updMat(mi,"marNumber",e.target.value);}} placeholder="MAR reference number" style={{flex:1,padding:"3px 7px",fontSize:10,border:"1px solid #ce93d8",borderRadius:5}}/>
              </div>

              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",padding:"6px 8px",background:"#f3e5f522",borderRadius:"6px 6px 0 0",border:"1px solid #ce93d8",borderBottom:"none",marginTop:4}}>
                <span style={{fontSize:10,fontWeight:700,color:"#7b1fa2",minWidth:90}}>MAR Submission</span>
                <select value={mat.marStatus||""} onChange={function(e){
                  var newStatus=e.target.value;
                  updMat(mi,"marStatus",newStatus);
                  if(newStatus==="under preparation")autoTask(mat,"MAR",mat.marTarget||"");
                }} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4,fontFamily:"inherit"}}>
                  <option value="">— Status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Target date</span><input type="date" value={mat.marTarget||""} onChange={function(e){updMat(mi,"marTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Date done</span><input type="date" value={mat.marDone||""} onChange={function(e){
                  var dv=e.target.value;updMat(mi,"marDone",dv);
                  if(dv){var d=new Date(dv);d.setDate(d.getDate()+14);var tgt=d.toISOString().slice(0,10);updMat(mi,"marApprovalTarget",tgt);}
                }} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:2,alignItems:"center"}}>
                  <input type="text" value={mat.marLinkLabel||""} onChange={function(e){updMat(mi,"marLinkLabel",e.target.value);}} placeholder="Link label" style={{width:65,padding:"2px 4px",fontSize:9,border:"1px solid #ce93d8",borderRadius:4}}/>
                  <input type="url" value={mat.marLink||""} onChange={function(e){updMat(mi,"marLink",e.target.value);}} placeholder="https://..." style={{width:100,padding:"2px 4px",fontSize:9,border:"1px solid #ce93d8",borderRadius:4}}/>
                  {mat.marLink&&<a href={mat.marLink} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{fontSize:9,color:"#7b1fa2",padding:"1px 4px",borderRadius:4,background:"#f3e5f5",textDecoration:"none"}}>🔗</a>}
                </div>
                {(function(){var due=mat.marDone?(function(){var d=new Date(mat.marDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";var ov=mat.marStatus!=="approved"&&due&&due<today();return ov?<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(due,today())}d</span>:null;})()}
              </div>

              <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",padding:"6px 8px",background:"#f3e5f511",borderRadius:"0 0 6px 6px",border:"1px solid #ce93d8"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#6a1b9a",minWidth:90}}>MAR Approval</span>
                <select value={mat.marApprovalStatus||""} onChange={function(e){updMat(mi,"marApprovalStatus",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4,fontFamily:"inherit"}}>
                  <option value="">— Status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Target date</span><input type="date" value={mat.marApprovalTarget||""} onChange={function(e){updMat(mi,"marApprovalTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontSize:9,color:"#555",fontWeight:600}}>Date done</span><input type="date" value={mat.marApprovalDone||""} onChange={function(e){updMat(mi,"marApprovalDone",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4}}/></div>
                <div style={{display:"flex",gap:3,alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#555",fontWeight:600}}>Review</span>
                  <select value={mat.marReview||""} onChange={function(e){updMat(mi,"marReview",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #ce93d8",borderRadius:4,fontFamily:"inherit",fontWeight:mat.marReview?"700":"400",color:mat.marReview==="A"?"#2e7d32":mat.marReview==="Rejected"?"#c62828":"#6a1b9a"}}>
                    <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="Rejected">Rejected</option>
                  </select>
                </div>
                {marOv&&<span style={{fontSize:9,color:"#c62828",fontWeight:700,flexShrink:0}}>⚠️+{workingDaysDiff(mat.marApprovalTarget,today())}d</span>}
              </div>
            </div>}
          </div>
        </div>;
      })}
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
  function delTender(id){if(safeConfirm("Delete tender?"))saveTenders((tenders||[]).filter(function(t){return t.id!==id;}));setSelTender(null);}

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
    saveTenders(d);if(selTender&&selTender.id===tdId)setSelTender(d.find(function(t){return t.id===tdId;}));
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
    var proposed=accTotal;
    var instructed=Number(td.instructionAmount)||0;
    var isReleased=td.released||false;
    var effectiveCost=treated>0?treated:proposed;
    var variance=budget>0&&effectiveCost>0?budget-effectiveCost:0;
    var varianceLabel=treated>0?"Budget − Treated":"Budget − Proposed";
    var linkedContracts=(contractors||[]).flatMap(function(ctr){return (ctr.contracts||[]).filter(function(ct){return ct.tenderRef===td.id;}).map(function(ct){return{ct,ctr};});});
    var contractTotal=linkedContracts.reduce(function(s,x){return s+Number(x.ct.amount||0);},0);
    var addendumTotal=linkedContracts.reduce(function(s,x){return s+(x.ct.addendums||[]).reduce(function(s2,ad){return s2+Number(ad.amount||0);},0);},0);
    var contractGrand=contractTotal+addendumTotal;

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

        <MaterialsPanel td={td} updTd={updTd} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} saveT={saveTasks} tasks={tasks}/>

        {(function(){
          var hasSd=td.hasSD||false;
          return <div className="card" style={{marginBottom:10}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:600,fontSize:13,marginBottom:hasSd?10:0}}>
              <input type="checkbox" checked={hasSd} onChange={function(e){updTd("hasSD",e.target.checked);}} style={{width:14,height:14}}/>
              📐 Shop Drawing (SD)
            </label>
            {hasSd&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
              <div style={{flex:1,minWidth:220,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",padding:"7px 10px",background:"#f8f7f4",borderRadius:7,border:"1px solid #e8e6df"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#555",minWidth:80}}>Submission</span>
                <select value={td.sdStatus||""} onChange={function(e){updTd("sdStatus",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5,fontFamily:"inherit"}}>
                  <option value="">— status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888"}}>Target</span><input type="date" value={td.sdTarget||""} onChange={function(e){updTd("sdTarget",e.target.value);}}/></div>
                <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888"}}>Done</span><input type="date" value={td.sdDone||""} onChange={function(e){var dv=e.target.value;updTd("sdDone",dv);if(dv&&td.sdStatus==="submitted"&&!td.sdApprovalTarget){var d=new Date(dv);d.setDate(d.getDate()+14);updTd("sdApprovalTarget",d.toISOString().slice(0,10));}}}/></div>
                {(function(){var due14=td.sdDone?(function(){var d=new Date(td.sdDone);d.setDate(d.getDate()+14);return d.toISOString().slice(0,10);}()):"";var ov=td.sdStatus!=="approved"&&due14&&due14<today();return ov?<span style={{fontSize:10,color:"#c62828",fontWeight:700}}>⚠️+{workingDaysDiff(due14,today())}d</span>:null;})()}
              </div>
              <div style={{flex:1,minWidth:220,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",padding:"7px 10px",background:"#f0fff4",borderRadius:7,border:"1px solid #c8e6c9"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#2e7d32",minWidth:80}}>Approval</span>
                <select value={td.sdApprovalStatus||""} onChange={function(e){updTd("sdApprovalStatus",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #c8e6c9",borderRadius:5,fontFamily:"inherit"}}>
                  <option value="">— status —</option>
                  <option value="under preparation">Under preparation</option>
                  <option value="submitted">Submitted</option>
                  <option value="pending approval">Pending approval</option>
                  <option value="approved">✅ Approved</option>
                </select>
                <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888"}}>Target</span><input type="date" value={td.sdApprovalTarget||""} onChange={function(e){updTd("sdApprovalTarget",e.target.value);}}/></div>
                <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888"}}>Done</span><input type="date" value={td.sdApprovalDone||""} onChange={function(e){updTd("sdApprovalDone",e.target.value);}}/></div>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  <span style={{fontSize:10,color:"#888"}}>Review</span>
                  <select value={td.sdReview||""} onChange={function(e){updTd("sdReview",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid #c8e6c9",borderRadius:5,fontFamily:"inherit",fontWeight:td.sdReview?"700":"400",color:td.sdReview==="A"?"#2e7d32":td.sdReview==="Rejected"?"#c62828":"#555"}}>
                    <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="Rejected">Rejected</option>
                  </select>
                </div>
                {(function(){var due=td.sdApprovalTarget||"";var ov=td.sdApprovalStatus!=="approved"&&due&&due<today();return ov?<span style={{fontSize:10,color:"#c62828",fontWeight:700}}>⚠️+{workingDaysDiff(due,today())}d</span>:null;})()}
              </div>
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
                  <td style={{padding:"6px 8px",textAlign:"center",color:isOverdue?"#c62828":"#555",fontWeight:isOverdue?700:400}}>{s.date?fmtDate(s.date):"—"}</td>
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

        {(function(){
          var [stepsOpen,setStepsOpen]=useState(true);
          return <div>
            <div onClick={function(){setStepsOpen(!stepsOpen);}} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:stepsOpen?12:0}}>
              <span style={{fontSize:13,color:"#aaa"}}>{stepsOpen?"▾":"▸"}</span>
              <div style={{fontWeight:700,fontSize:14}}>Submission Steps</div>
            </div>
            {stepsOpen&&<table className="tbl" style={{fontSize:12}}>
          <thead><tr>
            <th>Step</th>
            <th>Status</th>
            <th style={{textAlign:"center",minWidth:110}}>Target date</th>
            <th style={{textAlign:"center",minWidth:110}}>Date done</th>
            <th style={{textAlign:"center",minWidth:110}}>Date of approval</th>
            <th style={{minWidth:180}}>Comments</th>
          </tr></thead>
          <tbody>{TENDER_STEPS.map(function(s){
            var val=(td.steps||{})[s.key]||"";
            var dates=(td.stepDates||{})[s.key]||{};
            var comment=(td.stepComments||{})[s.key]||"";
            var cls=tenderStepClass(s.key,val);
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
                  :s.special==="process"
                  ?<div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}} style={{border:"none",background:"transparent",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer",outline:"none"}}>
                      {s.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                    </select>
                    {(td.stepDates||{}).process&&((td.stepDates||{}).process).bids!==undefined&&<span style={{fontSize:11,color:"#888"}}>{((td.stepDates||{}).process).bids} bids</span>}
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

              <td style={{textAlign:"center"}}>
                {["acc","mar","itp","wms"].indexOf(s.key)>=0
                  ?<input type="date" value={dates.approval||""} onChange={function(e){updateStep(td.id,s.key,"approval",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
                  :<span style={{color:"#e0ddd8"}}>—</span>}
              </td>

              <td style={{minWidth:200}}>
                <textarea value={comment} onChange={function(e){updateStep(td.id,s.key,"comment",e.target.value);}} placeholder="Add comment..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:28,overflowY:"auto",boxSizing:"border-box"}}/>
                <div style={{marginTop:3}}>
                  {((td.stepLinks||{})[s.key]||[]).map(function(lk,li){return <div key={li} style={{display:"flex",gap:3,marginBottom:2,alignItems:"center"}}>
                    <input type="text" value={lk.label||""} onChange={function(e){var ls=((td.stepLinks||{})[s.key]||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{label:e.target.value});});updateStep(td.id,s.key,"links",ls);}} placeholder="Label" style={{width:70,padding:"2px 4px",fontSize:9,border:"1px solid #e0ddd8",borderRadius:4}}/>
                    <input type="url" value={lk.url||""} onChange={function(e){var ls=((td.stepLinks||{})[s.key]||[]).map(function(x,j){return j!==li?x:Object.assign({},x,{url:e.target.value});});updateStep(td.id,s.key,"links",ls);}} placeholder="https://..." style={{flex:1,padding:"2px 4px",fontSize:9,border:"1px solid #e0ddd8",borderRadius:4}}/>
                    <button onClick={function(){var ls=((td.stepLinks||{})[s.key]||[]).filter(function(_,j){return j!==li;});updateStep(td.id,s.key,"links",ls);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:10,flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ccc";}}>✕</button>
                  </div>;})}
                  <button onClick={function(){var ls=[...((td.stepLinks||{})[s.key]||[]),{label:"",url:""}];updateStep(td.id,s.key,"links",ls);}} style={{fontSize:9,padding:"1px 5px",border:"1px solid #e0ddd8",borderRadius:4,background:"#fafaf8",fontFamily:"inherit",cursor:"pointer",color:"#888"}}>＋ link</button>
                  {((td.stepLinks||{})[s.key]||[]).filter(function(lk){return lk.url;}).map(function(lk,li){return <a key={li} href={lk.url} target="_blank" rel="noopener noreferrer" onClick={function(e){e.stopPropagation();}} style={{display:"inline-flex",alignItems:"center",gap:2,fontSize:9,color:"#3949ab",textDecoration:"none",padding:"1px 5px",borderRadius:4,background:"#f0f0ff",border:"1px solid #d0d0f0",marginLeft:3}}>🔗 {lk.label||"link"}</a>;})}
                </div>
              </td>
            </tr>;
          })}</tbody>
        </table>}
          </div>;
        })()}

      <div className="card" style={{marginTop:10}}>
        <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Linked Actions ({linkedTasks.length})</div>
        {linkedTasks.length===0
          ?<div style={{color:"#bbb",fontSize:13}}>No actions linked to this tender yet.</div>
          :linkedTasks.map(function(t){
            return <ActionItem key={t.id} task={t}
              onStatusChange={function(val){saveTasks(tasks.map(function(x){return x.id!==t.id?x:Object.assign({},x,{status:val});}));}}
              onUpdate={function(field,val){saveTasks(tasks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));u[field]=val;return u;}));}}
              onDelete={function(){saveTasks((tasks||[]).filter(function(x){return x.id!==t.id;}));}}
              people={people} packages={packages} tags={window._ppTags||[]} tenders={tenders} contractors={contractors}/>;
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
      if(!totBudget&&!totAcc&&!totInstructed&&releasedTenders.length===0)return null;
      return <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
        {totBudget>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:"#888",marginBottom:2}}>Total Budget (released)</div>
          <div style={{fontSize:18,fontWeight:800}}>{totBudget.toLocaleString()}</div>
          <div style={{fontSize:10,color:"#aaa"}}>{releasedTenders.length}/{filtered.length} released</div>
        </div>}
        {totAcc>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f0f8ff"}}>
          <div style={{fontSize:10,color:"#1a73e8",marginBottom:2}}>Total Proposed (released)</div>
          <div style={{fontSize:18,fontWeight:800,color:"#1a73e8"}}>{totAcc.toLocaleString()}</div>
          <div style={{fontSize:10,color:"#aaa"}}>ACC/ACONEX</div>
        </div>}
        {totInstructed>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f0fff4"}}>
          <div style={{fontSize:10,color:"#2e7d32",marginBottom:2}}>Total Instructed (released)</div>
          <div style={{fontSize:18,fontWeight:800,color:"#2e7d32"}}>{totInstructed.toLocaleString()}</div>
        </div>}
        {totBudget>0&&totAcc>0&&<div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:totVariance<0?"#fff0f0":"#f0fff4"}}>
          <div style={{fontSize:10,color:totVariance<0?"#c62828":"#2e7d32",marginBottom:2}}>Variance Budget − Cost</div>
          <div style={{fontSize:18,fontWeight:800,color:totVariance<0?"#c62828":"#2e7d32"}}>{totVariance>0?"+":""}{totVariance.toLocaleString()}</div>
          <div style={{fontSize:10,color:"#aaa"}}>{totVariance<0?"⚠️ Over budget":"✅ Under budget"}</div>
        </div>}
      </div>;
    })()}
    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">📑</div><div className="empty-txt">No tenders found.</div></div>
      :<table className="tbl">
        <thead><tr>
          <th className="sortable" onClick={function(){toggleSort("title");}}>Tender{sortIcon("title")}</th>
          <th className="sortable" onClick={function(){toggleSort("package");}}>Package{sortIcon("package")}</th>
          <th className="sortable" onClick={function(){toggleSort("owner");}}>Owner{sortIcon("owner")}</th>
          <th style={{textAlign:"right"}}>Budget</th>
          <th style={{textAlign:"right"}}>Proposed</th>
          <th style={{textAlign:"right"}}>Instructed</th>
          <th style={{textAlign:"right",color:"#888"}}>Variance</th>
          <th style={{textAlign:"center",color:"#555",minWidth:90}}>Target start</th>
          <th style={{textAlign:"center",color:"#1a73e8",minWidth:90}}>Proc. delivery</th>
          <th style={{textAlign:"center",color:"#888",minWidth:60}}>Margin</th>
          {TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).map(function(s){
            var sortable=s.key==="acc"||s.key==="contract";
            return sortable
              ?<th key={s.key} className="sortable" onClick={function(){toggleSort(s.key);}}>{s.label}{sortIcon(s.key)}</th>
              :<th key={s.key}>{s.label}</th>;
          })}
        </tr></thead>
        <tbody>{filtered.map(function(td){
          var steps=td.steps||{};
          return <tr key={td.id} style={{cursor:"pointer"}} onClick={function(){setSelTender(td);}}>
            <td style={{fontWeight:600}}>{td.title}</td>
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
              var isOverdue=target&&target<today()&&!done&&v!=="Approved"&&!v.toLowerCase().includes("approved");
              return <td key={s.key} style={{verticalAlign:"top",minWidth:90}}>
                {v&&v!=="—"?<span className={"chip "+cls} style={{fontSize:10,whiteSpace:"nowrap"}}>{v}</span>:<span style={{color:"#ddd"}}>—</span>}
                {!done&&target&&<div style={{fontSize:9,marginTop:2,color:isOverdue?"#c62828":"#888",fontWeight:isOverdue?700:400}}>
                  {isOverdue?"⚠️ ":""}{fmtDate(target)}
                </div>}
                {done&&<div style={{fontSize:9,marginTop:1,color:"#2e7d32",fontWeight:600}}>✓ {fmtDate(done)}</div>}
              </td>;
            })}
          </tr>;
        })}</tbody>
        <tfoot>
          <tr style={{background:"#fafaf8",borderTop:"2px solid #e8e6df"}}>
            <td colSpan={3+TENDER_STEPS.filter(function(s){return s.key!=="process"&&s.key!=="bidders";}).length+3} style={{padding:"8px 12px"}}>
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

