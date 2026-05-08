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
  const prefs=window._ppUserPrefs||{};
  return[...new Set(all)].filter(function(p){
    if(p===owner)return false;
    var pref=(prefs[p]||{});
    if(pref.noPkgCC)return false;
    return true;
  });
}

const TENDER_STEPS=[
  {key:"bidders",label:"Bidders List",opts:["—","N/A","N/A","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","N/A","N/A","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"acc",label:"ACC/Aconex",opts:["—","N/A","N/A","Internal review ongoing","Pending client approval","Approved A","Approved B","Approved C"]},
  {key:"contract",label:"Contract",opts:["—","N/A","N/A","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","N/A","N/A","Not done","Pending Approval","Approved A","Approved B","Approved C"]},
  {key:"wms",label:"WMS",opts:["—","N/A","N/A","Not done","Pending Approval","Approved A","Approved B","Approved C"]}
];

function tenderStepClass(step,val){
  if(!val||val==="—")return"s-default";
  if(val==="N/A")return"s-na";
  var v=val.toLowerCase();
  if(v.includes("approved")||v==="signed")return"s-approved-a";
  if(v.includes("reject")||v.includes("not approved")||v.includes("not done"))return"s-notdone";
  if(v.includes("pending")||v.includes("ongoing")||v.includes("circulation")||v.includes("sent")||v.includes("preparation")||v.includes("submitted")||v.includes("request")||v.includes("bids"))return"s-pending";
  return"s-default";
}

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
    if(!matched){setError("No contract matched this SAP number.");return;}
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
    <div className="modal-hdr"><div className="modal-title">📄 Add Certification</div><button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      {error&&<div style={{padding:"8px 12px",background:"#fce4ec",borderRadius:8,color:"#c62828",fontSize:12,marginBottom:12}}>{error}</div>}
      <div className="fg">
        <label>SAP Contract #</label>
        <input type="text" value={cert.sap} onChange={function(e){set("sap",e.target.value);}} placeholder="e.g. 9001032541" autoFocus/>
        {matched&&<div style={{marginTop:5,padding:"5px 8px",background:"#e8f5e9",borderRadius:6,fontSize:11,color:"#2e7d32",fontWeight:600}}>✅ {matched.ctr.name} · {matched.ct.number||""}</div>}
      </div>
      <div style={{display:"flex",gap:10}}><div className="fg" style={{flex:1}}><label>Valuation #</label><input type="text" value={cert.number} onChange={function(e){set("number",e.target.value);}}/></div><div className="fg" style={{flex:1}}><label>Period</label><input type="month" value={cert.date||""} onChange={function(e){set("date",e.target.value);}}/></div></div>
      <div className="fg"><label>Amount incl. tax</label><input type="number" value={cert.amount} onChange={function(e){set("amount",e.target.value);}}/></div>
    </div>
    <div className="modal-footer"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-pri" disabled={!matched||!cert.amount} onClick={confirm}>✓ Add Certification</button></div>
  </div></div>;
}

function ImprovementBox({improvements,saveImprovements,currentPage}){
  const [open,setOpen]=useState(false);const [text,setText]=useState("");const ref=useRef();
  function submit(){if(!text.trim())return;var entry={id:uuid(),text:text.trim(),page:currentPage,date:today(),ts:Date.now()};saveImprovements([entry,...improvements]);setText("");setOpen(false);}
  return <div className="imp-btn-wrap" style={{position:"fixed",bottom:16,right:276,zIndex:500}}>
    {open&&<div style={{position:"absolute",bottom:44,right:0,width:280,background:"#fff",borderRadius:12,boxShadow:"0 8px 30px rgba(0,0,0,.18)",border:"1.5px solid #e8e6df",padding:14}}><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>💡 Improvement idea</div><textarea ref={ref} autoFocus value={text} onChange={function(e){setText(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}} placeholder="Describe..." style={{width:"100%",minHeight:80,padding:"6px 8px",fontSize:12,border:"1.5px solid #e8e6df",borderRadius:7,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/><div style={{display:"flex",gap:6,marginTop:8}}><button className="btn" style={{flex:1}} onClick={function(){setOpen(false);setText("");}}>Cancel</button><button className="btn btn-gold" style={{flex:1}} onClick={submit}>✓ Add</button></div></div>}
    <button onClick={function(){setOpen(!open);}} title="Suggest an improvement" style={{width:36,height:36,borderRadius:"50%",background:"#c9a84c",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",color:"#1c1c1e",transition:"all .15s"}}>💡</button>
  </div>;
}

function QuickAdd({people,packages,tenders,contractors,trackers,tags,onAdd,improvements,saveImprovements,currentPage}){
  const [text,setText]=useState("");const [due,setDue]=useState(today());const [owner,setOwner]=useState("");const [pkg,setPkg]=useState("");const [tenderRef,setTenderRef]=useState("");const [contractorRef,setContractorRef]=useState("");const [importance,setImportance]=useState(1);const [urgence,setUrgence]=useState(1);const [selTags,setSelTags]=useState([]);const [isInfo,setIsInfo]=useState(false);const [rfiSub,setRfiSub]=useState("");const [rfiDue,setRfiDue]=useState("");const inputRef=useRef();
  function submit(){if(!text.trim())return;var td={text:text.trim(),owner,package:pkg,due,tenderRef,contractorRef,importance,urgence,tags:selTags};if(isInfo)td.isInfo=true;if(selTags.includes("RFI")){td.rfiSubmission=rfiSub;td.rfiDue=rfiDue;}onAdd(newTask(td));setText("");setDue(today());setOwner("");setPkg("");setTenderRef("");setContractorRef("");setImportance(1);setUrgence(1);setSelTags([]);setIsInfo(false);}
  var sc=calcScore(importance,urgence);var ss=scoreStyle(sc);
  var filteredTenders=(tenders||[]).filter(function(t){return !pkg||t.package===pkg;}).sort(function(a,b){return (a.title||"").localeCompare(b.title||"");});
  var filteredContractors=(contractors||[]).filter(function(ctr){return !pkg||ctr.package===pkg||(ctr.contracts||[]).some(function(ct){return ct.package===pkg;});}).sort(function(a,b){return (a.name||"").localeCompare(b.name||"");});
  return <div style={{display:"flex",flexDirection:"column",height:"100%"}}><div style={{padding:"14px 14px 10px",borderBottom:"1.5px solid #e8e6df"}}><div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,marginBottom:2}}>Quick Add</div></div><div style={{flex:1,overflowY:"auto",padding:12}} className="sform"><div className="fg"><label>Date</label><input type="date" value={due} onChange={function(e){setDue(e.target.value);}}/></div><div className="fg"><label>Action *</label><textarea ref={inputRef} value={text} onChange={function(e){setText(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}} placeholder="What needs to be done?" style={{minHeight:60}}/></div><label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,fontWeight:600,marginBottom:8,color:isInfo?"#1565c0":"#888",background:isInfo?"#e3f2fd":"transparent",padding:"3px 8px",borderRadius:8,border:"1.5px solid "+(isInfo?"#1565c0":"#ddd"),alignSelf:"flex-start"}}><input type="checkbox" checked={isInfo} onChange={function(e){setIsInfo(e.target.checked);setImportance(1);setUrgence(1);}} style={{width:13,height:13}}/>ℹ️ Info only</label><div className="fg"><label>Owner</label><select value={owner} onChange={function(e){setOwner(e.target.value);}} style={{fontFamily:"inherit"}}><option value="">— none —</option>{(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}</select></div><div className="fg"><label>Tender</label><select value={tenderRef} onChange={function(e){setTenderRef(e.target.value);}} style={{fontFamily:"inherit"}}><option value="">— none —</option>{filteredTenders.map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}</select></div><div className="fg"><label>Package</label><select value={pkg} onChange={function(e){setPkg(e.target.value);}} style={{fontFamily:"inherit"}}><option value="">— none —</option>{(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}</select></div>{!isInfo&&<div className="fg"><label>Score I×U {sc>1&&<span style={{padding:"1px 7px",borderRadius:10,background:ss.bg,color:ss.color,fontWeight:700,fontSize:10}}>{ss.label}</span>}</label><div style={{display:"flex",gap:12,alignItems:"center",marginTop:2}}><div><div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:3}}>IMPACT</div><div style={{display:"flex",gap:3}}>{[1,2,3].map(function(v){return <button key={v} onClick={function(){setImportance(v);}} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(importance===v?"#1c1c1e":"#ddd"),background:importance===v?"#1c1c1e":"#fff",color:importance===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}</div></div><span style={{color:"#ccc",fontSize:16}}>×</span><div><div style={{fontSize:9,fontWeight:800,color:"#aaa",marginBottom:3}}>URGENCY</div><div style={{display:"flex",gap:3}}>{[1,2,3].map(function(v){return <button key={v} onClick={function(){setUrgence(v);}} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(urgence===v?"#1c1c1e":"#ddd"),background:urgence===v?"#1c1c1e":"#fff",color:urgence===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>;})}</div></div></div></div>}<div style={{display:"flex",gap:6,marginTop:4}}><button className="btn" onClick={function(){setText("");}}>✕ Cancel</button><button className="btn btn-gold" style={{flex:1,justifyContent:"center"}} onClick={submit}>＋ Add Task</button></div></div></div>;
}

function ActionItem({task,onStatusChange,onUpdate,onDelete,people,packages,tags,tenders,contractors}){
  const [editMode,setEditMode]=useState(false);const sc=calcScore(task.importance||1,task.urgence||1);const ss=scoreStyle(sc);
  function upd(field,val){if(onUpdate)onUpdate(field,val,true);}
  return <div className="ac-item" style={{background:editMode?"#f8f9ff":task.status==="done"?"#fafaf8":"#fff",borderColor:editMode?"#3949ab":"#e8e6df",flexDirection:"column",gap:0}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:8,width:"100%"}}><div className={"ac-check"+(task.status==="done"?" done":"")} style={{flexShrink:0,marginTop:3,cursor:"pointer"}} onClick={function(){if(onStatusChange)onStatusChange(task.status==="done"?"pending":"done");}}>{task.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}</div>
      <div style={{flex:1,minWidth:0}}>{editMode ? <div style={{display:"flex",flexDirection:"column",gap:6}}><textarea value={task.text||""} autoFocus onChange={function(e){upd("text",e.target.value);}} style={{width:"100%",padding:"5px 8px",border:"1.5px solid #3949ab",borderRadius:6,fontFamily:"inherit",fontSize:13,resize:"vertical",outline:"none",minHeight:44,boxSizing:"border-box"}}/><button className="btn btn-sm btn-pri" onClick={function(){setEditMode(false);}} style={{alignSelf:"flex-start"}}>✓ Done</button></div>
          : <div><div className={"ac-text"+(task.status==="done"?" done":"")} style={{fontWeight:500}}>{task.isInfo&&<span style={{display:"inline-flex",alignItems:"center",gap:2,padding:"1px 6px",borderRadius:8,background:"#e3f2fd",color:"#1565c0",fontSize:10,fontWeight:700,marginRight:5}}>ℹ️ INFO</span>}{task.text}</div><div className="ac-meta" style={{marginTop:4,display:"flex",flexWrap:"wrap",alignItems:"center",gap:4}}>{task.due&&<span style={{fontSize:11,color:task.due<today()&&task.status!=="done"?"#c62828":"#bbb"}}>📅 {fmtDate(task.due)}</span>}{task.owner&&<OwnerChip owner={task.owner}/>}{task.package&&<span className="badge" style={{background:"#f0ede6",color:"#555"}}>{task.package}</span>}{!task.isInfo&&sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10}}>{ss.label}</span>}</div></div>
        }</div>{!editMode&&<div style={{display:"flex",gap:4,flexShrink:0}}><button className="btn btn-sm" onClick={function(){setEditMode(true);}}>✏️</button>{onDelete&&<button className="btn btn-sm btn-danger" onClick={onDelete}>🗑</button></div>}</div></div>;
}

function StatusChip({status}){const cls={"pending":"s-default","in progress":"s-pending","done":"s-approved-a","blocked":"s-notdone"}[status]||"s-default";return <span className={"chip "+cls}>{STATUS_ICONS[status]} {status}</span>;}
function OwnerChip({owner}){if(!owner)return null;const c=ownerColor(owner);return <span className="pill" style={{background:c.bg,color:c.accent,fontSize:11,fontWeight:700}}>{owner.split(",")[0]}</span>;}
function TagChip({tag}){const c=tagColor(tag);return <span className="tag" style={{background:c.bg,color:c.color}}>{tag}</span>;}

function ActionsView({tasks,setTasks,people,packages,tags,tenders,contractors,trackers,saveT}){
  const [q,setQ]=useState("");const filtered=tasks.filter(function(t){return !q||(t.text||"").toLowerCase().includes(q.toLowerCase());});
  return <div style={{height:"100%",overflowY:"auto",padding:24}}><div className="page-hdr"><div className="page-title">Actions</div></div><div className="filter-bar"><input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search…" style={{width:180,padding:"5px 10px",fontSize:12}}/></div>{filtered.map(function(t){return <ActionItem key={t.id} task={t} onStatusChange={function(val){saveT(tasks.map(function(x){return x.id===t.id?Object.assign({},x,{status:val}):x;}));}} onUpdate={function(f,v){saveT(tasks.map(function(x){return x.id===t.id?Object.assign({},x,{[f]:v}):x;}));}} onDelete={function(){saveT(tasks.filter(function(x){return x.id!==t.id;}));}} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors}/>;})}</div>;
}

function TrackersView({trackers,setTrackers,saveX,people,packages,tags,tenders,contractors}){
  const [view,setView]=useState("list");const [sel,setSel]=useState(null);
  if(view==="detail"&&sel){return <div style={{padding:24}}><button className="btn btn-sm" onClick={function(){setView("list");}}>← Back</button><div className="page-title">{sel.title}</div>{sel.actions.map(function(ac){return <div key={ac.id} className="ac-item">{ac.text}</div>;})}</div>;}
  return <div style={{height:"100%",overflowY:"auto",display:"flex",flexDirection:"column"}}><div className="page-hdr"><div className="page-title">Trackers</div><button className="btn btn-gold" onClick={function(){saveX([newTracker({title:"New Tracker"}),...trackers]);}}>＋ New Tracker</button></div>{trackers.map(function(tr){return <div key={tr.id} className="ctr-card" onClick={function(){setSel(tr);setView("detail");}}><strong>{tr.title}</strong><div style={{fontSize:11,color:"#888"}}>{tr.actions.length} actions</div></div>;})}</div>;
}
function MaterialsPanel({td,updTd,saveT,tasks}){
  const [open,setOpen]=useState(true);var mats=td.materials||[];
  function updMat(mi,field,val){var ms=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,{[field]:val});});updTd("materials",ms);}
  return <div className="card" style={{marginBottom:10}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setOpen(!open);}}><div style={{fontWeight:700,fontSize:13}}>🏗️ Materials ({mats.length})</div><button className="btn btn-sm" onClick={function(e){e.stopPropagation();updTd("materials",[...mats,{id:uuid(),name:""}]);}}>＋ Add</button></div>{open&&<div style={{marginTop:10}}>{mats.map(function(m,i){return <div key={m.id} style={{marginBottom:5}}><input type="text" value={m.name} onChange={function(e){updMat(i,"name",e.target.value);}} placeholder="Material name" style={{fontSize:12}}/></div>;})}</div>}</div>;
}

function SubmissionSteps({td,TENDER_STEPS,updateStep}){
  return <div className="card"><div style={{fontWeight:700,fontSize:14,marginBottom:10}}>Submission Steps</div><table className="tbl" style={{fontSize:12}}><tbody>{TENDER_STEPS.map(function(s){return <tr key={s.key}><td style={{fontWeight:700}}>{s.label}</td><td><select value={(td.steps||{})[s.key]||"—"} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}}>{s.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}</select></td></tr>;})}</tbody></table></div>;
}

function TendersView({tenders,saveTenders,packages,people,tasks,saveTasks,contractors}){
  const [searchQ,setSearchQ]=useState("");const [selTender,setSelTender]=useState(null);
  function updateStep(tdId,step,field,val){var d=tenders.map(function(t){if(t.id!==tdId)return t;var steps=Object.assign({},t.steps||{});steps[step]=val;return Object.assign({},t,{steps:steps});});saveTenders(d);if(selTender&&selTender.id===tdId)setSelTender(d.find(function(x){return x.id===tdId;}));}
  if(selTender){
    var td=selTender;
    return <div style={{padding:24,overflowY:"auto",height:"100%"}}><button className="btn btn-sm" onClick={function(){setSelTender(null);}} style={{marginBottom:15}}>← Back</button><div className="page-title" style={{marginBottom:15}}>{td.title}</div><MaterialsPanel td={td} updTd={function(f,v){saveTenders(tenders.map(function(x){return x.id===td.id?Object.assign({},x,{[f]:v}):x;}));}} tasks={tasks} saveT={saveTasks}/><SubmissionSteps td={td} TENDER_STEPS={TENDER_STEPS} updateStep={updateStep}/></div>;
  }
  var filtered=(tenders||[]).filter(function(t){return !searchQ||(t.title||"").toLowerCase().includes(searchQ.toLowerCase());});
  return <div style={{height:"100%",overflowY:"auto",display:"flex",flexDirection:"column"}}>
    <div className="page-hdr" style={{padding:24}}><div><div className="page-title">Tenders</div></div><button className="btn btn-gold" onClick={function(){saveTenders([newTender({title:"New Tender"}),...tenders]);}}>＋ New Tender</button></div>
    <div style={{padding:"0 24px 12px"}}><input type="text" value={searchQ} onChange={function(e){setSearchQ(e.target.value);}} placeholder="🔍 Search…" style={{width:240}}/></div>
    <div style={{flex:1,overflowX:"auto",padding:"0 24px"}}><table className="tbl"><thead><tr><th>Tender</th><th>Package</th><th>ACC Status</th></tr></thead><tbody>{filtered.map(function(td){return <tr key={td.id} onClick={function(){setSelTender(td);}} style={{cursor:"pointer"}}><td><strong>{td.title}</strong></td><td><span className="badge">{td.package}</span></td><td><span className="chip">{(td.steps||{}).acc||"—"}</span></td></tr>;})}</tbody>
      <tfoot><tr style={{background:"#fafaf8",borderTop:"2px solid #e8e6df"}}><td colSpan={3} style={{padding:"8px 12px"}}>
        {(function(){
          var totBudget=filtered.reduce(function(s,t){return s+Number(t.budget||0);},0);
          var totAcc=filtered.reduce(function(s,t){return s+Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0);},0);
          var variance=totBudget-totAcc;
          return <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase"}}>TOTALS</span><div style={{padding:"3px 10px",borderRadius:7,background:"#f0ede6",fontSize:11}}>Budget: <strong>{totBudget.toLocaleString()}</strong></div><div style={{padding:"3px 10px",borderRadius:7,background:variance<0?"#fce4ec":"#e8f5e9",fontSize:11}}>Variance: <strong style={{color:variance<0?"#c62828":"#2e7d32"}}>{variance.toLocaleString()}</strong></div></div>;
        })()}
      </td></tr></tfoot></table></div></div>;
}
function LetterRow({letter,tc,correspondences,saveCorrespondences,delLetter}){
  return <div style={{padding:"8px 10px",borderRadius:7,border:"1px solid #f0ede6",marginBottom:5,background:"#fafaf8"}}><div style={{display:"flex",alignItems:"flex-start",gap:8}}><span style={{padding:"2px 8px",borderRadius:12,background:tc.bg,color:tc.color,fontSize:10,fontWeight:700}}>{tc.label}</span><div style={{flex:1}}><div style={{fontWeight:700,fontSize:12}}>#{letter.number} <span style={{color:"#888",fontWeight:400}}>· {fmtDate(letter.date)}</span></div>{letter.description&&<div style={{fontSize:11,color:"#555",marginTop:1}}>{letter.description}</div>}</div><button onClick={function(){delLetter(letter.id);}} className="btn btn-sm">🗑</button></div></div>;
}

function CorrespondenceLog({ctrId,ctrName,correspondences,saveCorrespondences,saveT,tasks}){
  const [showAdd,setShowAdd]=useState(false);var ctrCorr=(correspondences||[]).filter(function(l){return l.ctrId===ctrId;}).sort(function(a,b){return b.date.localeCompare(a.date);});
  return <div className="card" style={{marginTop:15}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><strong>Correspondence</strong><button className="btn btn-sm btn-gold" onClick={function(){setShowAdd(!showAdd);}}>＋ Add Letter</button></div>{ctrCorr.map(function(l){return <LetterRow key={l.id} letter={l} tc={{bg:"#eee",color:"#333",label:l.type}} delLetter={function(id){saveCorrespondences(correspondences.filter(function(x){return x.id!==id;}));}}/>;})}</div>;
}

function CollapsibleContract({ct,fin,children}){
  const [open,setOpen]=useState(false);return <div style={{border:"1.5px solid #e8e6df",borderRadius:10,marginBottom:8,overflow:"hidden"}}><div onClick={function(){setOpen(!open);}} style={{padding:"10px 14px",cursor:"pointer",background:open?"#f8f7f4":"#fff",display:"flex",justifyContent:"space-between"}}><strong>{ct.number||"Contract"}</strong><span>{fin.total.toLocaleString()} EUR</span></div>{open&&<div style={{padding:14,borderTop:"1.5px solid #e8e6df"}}>{children}</div>}</div>;
}

function CollapseContractDetail({ctr,ct,fin,updateCtField}){return <div className="sform"><div className="fg"><label>Contract #</label><input type="text" value={ct.number||""} onChange={function(e){updateCtField(ctr.id,ct.id,"number",e.target.value);}}/></div><div className="fg"><label>Amount excl. tax</label><input type="number" value={ct.amount||""} onChange={function(e){updateCtField(ctr.id,ct.id,"amount",e.target.value);}}/></div></div>;}

function ContractorsView({contractors,saveContractors,people,tasks,tenders,correspondences,saveCorrespondences,saveT}){
  const [selCtr,setSelCtr]=useState(null);
  if(selCtr){var ctr=selCtr;return <div style={{padding:24,overflowY:"auto",height:"100%"}}><button className="btn btn-sm" onClick={function(){setSelCtr(null);}}>← Back</button><div className="page-hdr"><div className="page-title">{ctr.name}</div></div>{(ctr.contracts||[]).map(function(ct){return <CollapsibleContract key={ct.id} ct={ct} fin={contractFinancials(ct)}><CollapseContractDetail ctr={ctr} ct={ct} updateCtField={function(crid,ctid,f,v){saveContractors(contractors.map(function(c){return c.id===crid?Object.assign({},c,{contracts:c.contracts.map(function(x){return x.id===ctid?Object.assign({},x,{[f]:v}):x;})}):c;}));}} fin={contractFinancials(ct)}/></CollapsibleContract>;})}<CorrespondenceLog ctrId={ctr.id} ctrName={ctr.name} correspondences={correspondences} saveCorrespondences={saveCorrespondences} saveT={saveT} tasks={tasks}/></div>;}
  return <div style={{padding:24,overflowY:"auto",height:"100%"}}><div className="page-hdr"><div className="page-title">Subcontractors</div><button className="btn btn-gold" onClick={function(){saveContractors([newContractor({name:"New Subcontractor"}),...contractors]);}}>＋ New Subcontractor</button></div><table className="tbl"><tbody>{contractors.map(function(c){return <tr key={c.id} onClick={function(){setSelCtr(c);}} style={{cursor:"pointer"}}><td><strong>{c.name}</strong></td><td>{c.package}</td></tr>;})}</tbody></table></div>;
}

function ContractsView(){return <div style={{padding:24}}><div className="page-title">Contracts List</div><div className="empty">Select a subcontractor to manage contracts.</div></div>;}
function AwnView(){return <div style={{padding:24}}><div className="page-title">AWN</div></div>;}
function WeeklyView({tasks}){return <div style={{padding:24}}><div className="page-title">Weekly Report</div><div className="card"><pre style={{fontSize:11}}>{JSON.stringify(tasks.slice(0,3),null,2)}</pre></div></div>;}
function GlobalView(){return <div style={{padding:24}}><div className="page-title">Global Actions</div></div>;}
function DashboardView({tasks}){return <div style={{padding:24}}><div className="page-title">Dashboard</div><div style={{fontSize:24,fontWeight:900,marginTop:20}}>{tasks.length} Active Tasks</div></div>;}
function DocumentsView(){return <div style={{padding:24}}><div className="page-title">Overdue Docs</div></div>;}
function SettingsView({allData}){return <div style={{padding:24}}><div className="page-title">Settings</div><button className="btn btn-gold" onClick={function(){console.log(allData);alert("Exported to console");}}>Export Data</button></div>;}

function safeConfirm(msg){try{return window.confirm(msg);}catch(e){return true;}}
function workingDaysDiff(d1,d2){var s=new Date(d1),e=new Date(d2);return Math.round((e-s)/(1000*3600*24));}
function calcProcurement(td){return {steps:[], deliveryDate:today(), procStart:today(), margin:0, totalDays:30, LEAD:30};}
function contractFinancials(ct){var base=Number(ct.amount||0);var cert=(ct.certifications||[]).reduce(function(s,f){return s+Number(f.amount||0);},0);return {total:base, certified:cert, remaining:base-cert, pct:base>0?Math.round(cert/base*100):0, totalInstructed:base};}

function UserLogin({people,onLogin}){
  return <div className="overlay" style={{background:"#1c1c1e",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#fff",padding:40,borderRadius:16,width:320,textAlign:"center"}}><h2 style={{fontFamily:"'DM Serif Display'",marginBottom:20,color:"#c9a84c"}}>Project Tracker</h2><select onChange={function(e){if(e.target.value)onLogin(e.target.value);}} style={{padding:10}}><option value="">Who are you?</option>{people.map(function(p){return <option key={p} value={p}>{p}</option>;})}</select></div></div>;
}

function App(){
  const [currentUser,setCurrentUser]=useState(function(){return localStorage.getItem("pp_current_user");});
  const [view,setViewState]=useState(function(){return localStorage.getItem("pp_view")||"dashboard";});
  function setView(v){setViewState(v);localStorage.setItem("pp_view",v);}
  const [tasks,setTasks]=useState([]);const [trackers,setTrackers]=useState([]);const [tenders,setTenders]=useState([]);const [contractors,setContractors]=useState([]);const [people,setPeople]=useState(SEED_PEOPLE);const [packages,setPackages]=useState(SEED_PACKAGES);const [tags,setTags]=useState(SEED_TAGS);const [correspondences,setCorrespondences]=useState([]);const [improvements,setImprovements]=useState([]);
  const saveT=function(d){setTasks(d);cloudStore.set(KEYS.tasks,d);};const saveTenders=function(d){setTenders(d);cloudStore.set(KEYS.tenders,d);};const saveContractors=function(d){setContractors(d);cloudStore.set(KEYS.contractors,d);};
  useEffect(function(){
    const load=async function(){
      const [t,x,td,ct,corr,imp]=await Promise.all([cloudStore.get(KEYS.tasks),cloudStore.get(KEYS.trackers),cloudStore.get(KEYS.tenders),cloudStore.get(KEYS.contractors),cloudStore.get(KEYS_CORR),cloudStore.get(KEYS_IMP)]);
      if(t)setTasks(t);if(x)setTrackers(x);if(td)setTenders(td);if(ct)setContractors(ct);if(corr)setCorrespondences(corr);if(imp)setImprovements(imp);
    };
    if(window._dbReady)load();else window.addEventListener("db-ready",load,{once:true});
  },[]);
  if(!currentUser)return <UserLogin people={people} onLogin={function(u){setCurrentUser(u);localStorage.setItem("pp_current_user",u);}}/>;
  return <div className="layout">
    <nav className="leftnav"><div className="logo">PRJ</div>
      <button className={"navbtn "+(view==="trackers"?"on":"")} onClick={function(){setView("trackers");}}>📊<span className="lbl">Trackers</span></button>
      <button className={"navbtn "+(view==="tenders"?"on":"")} onClick={function(){setView("tenders");}}>📑<span className="lbl">Tenders</span></button>
      <button className={"navbtn "+(view==="contractors"?"on":"")} onClick={function(){setView("contractors");}}>🤝<span className="lbl">Subs</span></button>
      <button className={"navbtn "+(view==="contracts"?"on":"")} onClick={function(){setView("contracts");}}>📋<span className="lbl">Contracts</span></button>
      <button className={"navbtn "+(view==="awn"?"on":"")} onClick={function(){setView("awn");}}>⚠️<span className="lbl">AWN</span></button>
      <button className={"navbtn "+(view==="weekly"?"on":"")} onClick={function(){setView("weekly");}}>📊<span className="lbl">Weekly</span></button>
      <button className={"navbtn "+(view==="dashboard"?"on":"")} onClick={function(){setView("dashboard");}}>📈<span className="lbl">Dash</span></button>
      <button className={"navbtn "+(view==="documents"?"on":"")} onClick={function(){setView("documents");}}>⚠️<span className="lbl">Overdue</span></button>
      <button className={"navbtn "+(view==="global"?"on":"")} onClick={function(){setView("global");}}>🌐<span className="lbl">Actions</span></button>
      <button className={"navbtn "+(view==="settings"?"on":"")} onClick={function(){setView("settings");}}>⚙️<span className="lbl">Settings</span></button>
    </nav>
    <div className="main-area"><div className="content">
      {view==="dashboard"&&<DashboardView tasks={tasks}/>}
      {view==="global"&&<GlobalView tasks={tasks}/>}
      {view==="trackers"&&<TrackersView trackers={trackers} setTrackers={setTrackers} saveX={function(d){setTrackers(d);cloudStore.set(KEYS.trackers,d);}} people={people} packages={packages} tags={tags} tenders={tenders} contractors={contractors}/>}
      {view==="tenders"&&<TendersView tenders={tenders} saveTenders={saveTenders} people={people} packages={packages} tasks={tasks} saveTasks={saveT}/>}
      {view==="contractors"&&<ContractorsView contractors={contractors} saveContractors={saveContractors} people={people} packages={packages} tenders={tenders} correspondences={correspondences} saveCorrespondences={function(d){setCorrespondences(d);cloudStore.set(KEYS_CORR,d);}} saveT={saveT} tasks={tasks}/>}
      {view==="contracts"&&<ContractsView contractors={contractors}/>}
      {view==="awn"&&<AwnView awns={[]}/>}
      {view==="weekly"&&<WeeklyView tasks={tasks}/>}
      {view==="documents"&&<DocumentsView/>}
      {view==="settings"&&<SettingsView allData={{tasks,trackers,tenders,contractors,people}}/>}
    </div><aside className="rsidebar open"><QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} onAdd={function(t){saveT([t,...tasks]);}} improvements={improvements} saveImprovements={function(d){setImprovements(d);cloudStore.set(KEYS_IMP,d);}} currentPage={view}/></aside></div>
    <div className="no-print"><ImprovementBox improvements={improvements} saveImprovements={function(d){setImprovements(d);cloudStore.set(KEYS_IMP,d);}} currentPage={view}/></div>
  </div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
