const {useState,useEffect,useRef,useCallback}=React;

class ErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={err:null,info:null};}
  static getDerivedStateFromError(err){return{err,info:null};}
  componentCatch(err,info){this.setState({err,info});}
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
  {key:"bidders",label:"Bidders List",opts:["—","N/A","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","N/A","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"acc",label:"ACC/Aconex",opts:["—","N/A","Internal review ongoing","Pending client approval","Approved A","Approved B","Approved C"]},
  {key:"contract",label:"Contract",opts:["—","N/A","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Approved C"]},
  {key:"wms",label:"WMS",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Approved C"]}
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
      <div style={{display:"flex",gap:10}}>
        <div className="fg" style={{flex:1}}><label>Valuation #</label><input type="text" value={cert.number} onChange={function(e){set("number",e.target.value);}}/></div>
        <div className="fg" style={{flex:1}}><label>Period</label><input type="month" value={cert.date||""} onChange={function(e){set("date",e.target.value);}}/></div>
      </div>
      <div className="fg"><label>Amount incl. tax</label><input type="number" value={cert.amount} onChange={function(e){set("amount",e.target.value);}}/></div>
    </div>
    <div className="modal-footer"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-pri" disabled={!matched||!cert.amount} onClick={confirm}>✓ Add</button></div>
  </div></div>;
}

function ImprovementBox({improvements,saveImprovements,currentPage}){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState("");
  function submit(){
    if(!text.trim())return;
    var entry={id:uuid(),text:text.trim(),page:currentPage,date:today(),ts:Date.now()};
    saveImprovements([entry,...improvements]);
    setText("");setOpen(false);
  }
  return <div className="imp-btn-wrap" style={{position:"fixed",bottom:16,right:276,zIndex:500}}>
    {open&&<div style={{position:"absolute",bottom:44,right:0,width:280,background:"#fff",borderRadius:12,boxShadow:"0 8px 30px rgba(0,0,0,.18)",padding:14,border:"1.5px solid #e8e6df"}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>💡 Improvement idea</div>
      <textarea autoFocus value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",minHeight:80,padding:"6px 8px",fontSize:12,border:"1px solid #ddd",borderRadius:7,outline:"none"}}/>
      <div style={{display:"flex",gap:6,marginTop:8}}><button className="btn" style={{flex:1}} onClick={function(){setOpen(false);}}>Cancel</button><button className="btn btn-gold" style={{flex:1}} onClick={submit}>✓ Add</button></div>
    </div>}
    <button onClick={function(){setOpen(!open);}} style={{width:36,height:36,borderRadius:"50%",background:"#c9a84c",border:"none",cursor:"pointer",boxShadow:"0 2px 8px rgba(0,0,0,.2)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",color:"#1c1c1e"}}>💡</button>
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
  }
  
  var sc=calcScore(importance,urgence);
  var ss=scoreStyle(sc);
  var filteredTenders=(tenders||[]).filter(t=>!pkg||t.package===pkg).sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  var filteredContractors=(contractors||[]).filter(c=>!pkg||c.package===pkg||(c.contracts||[]).some(ct=>ct.package===pkg)).sort((a,b)=>(a.name||"").localeCompare(b.name||""));

  return <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
    <div style={{padding:14,borderBottom:"1.5px solid #e8e6df"}}><div style={{fontFamily:"'DM Serif Display',serif",fontSize:15}}>Quick Add</div></div>
    <div style={{flex:1,overflowY:"auto",padding:12}} className="sform">
      <div className="fg"><label>Date</label><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></div>
      <div className="fg"><label>Action *</label><textarea ref={inputRef} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}}} style={{minHeight:60}}/></div>
      <div className="fg"><label>Owner</label><select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">— none —</option>{people.map(p=><option key={p} value={p}>{p.split(",")[0]}</option>)}</select></div>
      <div className="fg"><label>Tender</label><select value={tenderRef} onChange={e=>setTenderRef(e.target.value)}><option value="">— none —</option>{filteredTenders.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
      <div className="fg"><label>Package</label><select value={pkg} onChange={e=>setPkg(e.target.value)}><option value="">— none —</option>{packages.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
      <div className="fg"><label>Score I×U {sc>1&&<span style={{padding:"1px 7px",borderRadius:10,background:ss.bg,color:ss.color,fontWeight:700,fontSize:10}}>{ss.label}</span>}</label>
        <div style={{display:"flex",gap:12}}>
          <div><div style={{fontSize:9,color:"#aaa"}}>IMPACT</div><div style={{display:"flex",gap:3}}>{[1,2,3].map(v=><button key={v} onClick={()=>setImportance(v)} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(importance===v?"#1c1c1e":"#ddd"),background:importance===v?"#1c1c1e":"#fff",color:importance===v?"#fff":"#aaa",fontSize:11,fontWeight:800}}>{v}</button>)}</div></div>
          <div><div style={{fontSize:9,color:"#aaa"}}>URGENCY</div><div style={{display:"flex",gap:3}}>{[1,2,3].map(v=><button key={v} onClick={()=>setUrgence(v)} style={{width:26,height:26,borderRadius:5,border:"1.5px solid "+(urgence===v?"#1c1c1e":"#ddd"),background:urgence===v?"#1c1c1e":"#fff",color:urgence===v?"#fff":"#aaa",fontSize:11,fontWeight:800}}>{v}</button>)}</div></div>
        </div>
      </div>
      <button className="btn btn-gold" style={{width:"100%",marginTop:10}} onClick={submit}>＋ Add Task</button>
    </div>
  </div>;
}

function ActionItem({task,onStatusChange,onUpdate,onDelete,people,packages,tags,tenders,contractors,showCreated,onNavTender}){
  const [editMode,setEditMode]=useState(false);
  const sc=calcScore(task.importance||1,task.urgence||1);
  const ss=scoreStyle(sc);
  function upd(field,val){if(onUpdate)onUpdate(field,val,true);}

  return <div className="ac-item" style={{background:editMode?"#f8f9ff":task.status==="done"?"#fafaf8":"#fff",flexDirection:"column",gap:0}}>
    <div style={{display:"flex",alignItems:"flex-start",gap:8,width:"100%"}}>
      <div className={"ac-check"+(task.status==="done"?" done":"")} style={{flexShrink:0,marginTop:3,cursor:"pointer"}} onClick={()=>onStatusChange(task.status==="done"?"pending":"done")}>{task.status==="done"&&<span style={{fontSize:11,color:"#fff"}}>✓</span>}</div>
      <div style={{flex:1}}>
        {editMode ? (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <textarea value={task.text||""} onChange={e=>upd("text",e.target.value)} style={{width:"100%",minHeight:44}}/>
            <button className="btn btn-sm btn-pri" onClick={()=>setEditMode(false)}>Done</button>
          </div>
        ) : (
          <div>
            <div style={{fontWeight:500}}>{task.text}</div>
            <div className="ac-meta">
              {task.due&&<span style={{fontSize:11}}>📅 {fmtDate(task.due)}</span>}
              {task.owner&&<OwnerChip owner={task.owner}/>}
              {task.package&&<span className="badge">{task.package}</span>}
            </div>
          </div>
        )}
      </div>
      {!editMode&&<button className="btn btn-sm" onClick={()=>setEditMode(true)}>✏️</button>}
    </div>
  </div>;
}

function StatusChip({status}){
  const cls={"pending":"s-default","in progress":"s-pending","done":"s-approved-a","blocked":"s-notdone"}[status]||"s-default";
  return <span className={"chip "+cls}>{STATUS_ICONS[status]} {status}</span>;
}
function OwnerChip({owner}){if(!owner)return null;const c=ownerColor(owner);return <span className="pill" style={{background:c.bg,color:c.accent,fontSize:11,fontWeight:700}}>{owner.split(",")[0]}</span>;}
function TagChip({tag}){const c=tagColor(tag);return <span className="tag" style={{background:c.bg,color:c.color}}>{tag}</span>;}

function QuickAddTask({prefill,onAdd,people,tags,label}){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState("");
  function submit(){if(!text.trim())return;onAdd(newTask(Object.assign({},prefill,{text:text.trim()})));setText("");setOpen(false);}
  if(!open)return <button className="btn btn-sm" onClick={()=>setOpen(true)} style={{marginTop:8}}>＋ {label||"Add Task"}</button>;
  return <div style={{marginTop:8,padding:12,background:"#f8f9ff",borderRadius:10,border:"1.5px solid #3949ab"}}>
    <textarea value={text} onChange={e=>setText(e.target.value)} style={{width:"100%",minHeight:44}} placeholder="What needs to be done?"/>
    <div style={{display:"flex",gap:6,marginTop:8}}><button className="btn btn-sm" onClick={()=>setOpen(false)}>Cancel</button><button className="btn btn-sm btn-pri" onClick={submit}>Add</button></div>
  </div>;
}

function ActionsView({tasks,setTasks,people,packages,tags,tenders,contractors,trackers,saveT,tagrules,pkgrules}){
  const [q,setQ]=useState("");
  const filtered=tasks.filter(t=>!q||(t.text||"").toLowerCase().includes(q.toLowerCase()));
  return <div style={{padding:20}}>
    <div className="page-hdr"><div className="page-title">Actions</div></div>
    <input type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search..." style={{marginBottom:15}}/>
    {filtered.map(t=><ActionItem key={t.id} task={t} onStatusChange={val=>saveT(tasks.map(x=>x.id===t.id?Object.assign({},x,{status:val}):x))} people={people} packages={packages}/>)}
  </div>;
}

function TrackersView({trackers,setTrackers,saveX,people,packages,tags,tenders,contractors}){
  const [sel,setSel]=useState(null);
  return <div style={{padding:20}}>
    <div className="page-hdr"><div className="page-title">Trackers</div></div>
    {trackers.map(tr=><div key={tr.id} className="ctr-card" onClick={()=>setSel(tr)}>{tr.title}</div>)}
  </div>;
}

function TrackerFormModal({data,onChange,onSave,onClose}){
  return <div className="overlay"><div className="modal"><div className="modal-hdr"><div className="modal-title">Edit Tracker</div></div><div className="modal-footer"><button onClick={onClose}>Close</button></div></div></div>;
}

function MaterialsPanel({td,updTd,saveT,tasks}){
  const [open,setOpen]=useState(true);
  var mats=td.materials||[];
  function updMat(mi,field,val){var ms=mats.map((m,j)=>j!==mi?m:Object.assign({},m,{[field]:val}));updTd("materials",ms);}
  return <div className="card" style={{marginBottom:10}}>
    <div onClick={()=>setOpen(!open)} style={{cursor:"pointer",fontWeight:700}}>🏗️ Materials ({mats.length})</div>
    {open&&<div style={{marginTop:10}}>
      <button className="btn btn-sm" onClick={()=>updTd("materials",[...mats,{id:uuid(),name:""}])}>＋ Material</button>
      {mats.map((m,i)=><div key={m.id} style={{marginTop:5}}><input value={m.name} onChange={e=>updMat(i,"name",e.target.value)} placeholder="Material name"/></div>)}
    </div>}
  </div>;
}

function SubmissionSteps({td,TENDER_STEPS,updateStep}){
  return <div className="card"><div style={{fontWeight:700,marginBottom:10}}>Submission Steps</div>
    <table className="tbl"><tbody>{TENDER_STEPS.map(s=><tr key={s.key}><td>{s.label}</td><td><select value={(td.steps||{})[s.key]||"—"} onChange={e=>updateStep(td.id,s.key,"status",e.target.value)}>{s.opts.map(o=><option key={o} value={o}>{o}</option>)}</select></td></tr>)}</tbody></table>
  </div>;
}

function TendersView({tenders,saveTenders,packages,people,tasks,saveTasks,contractors,onBack}){
  const [selTender,setSelTender]=useState(null);
  const [searchQ,setSearchQ]=useState("");
  const filtered=(tenders||[]).filter(t=>(t.title||"").toLowerCase().includes(searchQ.toLowerCase()));

  function updateStep(tdId,step,field,val){
    var d=tenders.map(t=>{
      if(t.id!==tdId)return t;
      var steps=Object.assign({},t.steps||{});
      if(field==="status")steps[step]=val;
      return Object.assign({},t,{steps});
    });
    saveTenders(d);
    if(selTender&&selTender.id===tdId)setSelTender(d.find(x=>x.id===tdId));
  }

  if(selTender){
    const td=selTender;
    return <div style={{padding:20}}>
      <button className="btn btn-sm" onClick={()=>setSelTender(null)}>← Back</button>
      <div className="page-title">{td.title}</div>
      <MaterialsPanel td={td} updTd={(f,v)=>saveTenders(tenders.map(x=>x.id===td.id?Object.assign({},x,{[f]:v}):x))} tasks={tasks} saveT={saveTasks}/>
      <SubmissionSteps td={td} TENDER_STEPS={TENDER_STEPS} updateStep={updateStep}/>
    </div>;
  }

  return <div style={{padding:20}}>
    <div className="page-hdr"><div className="page-title">Tenders</div><button className="btn btn-gold" onClick={()=>saveTenders([newTender(),...tenders])}>＋ New</button></div>
    <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search..."/>
    <table className="tbl">
      <thead><tr><th>Title</th><th>Package</th><th>ACC</th></tr></thead>
      <tbody>{filtered.map(t=><tr key={t.id} onClick={()=>setSelTender(t)}><td>{t.title}</td><td>{t.package}</td><td>{(t.steps||{}).acc}</td></tr>)}</tbody>
      <tfoot>
        <tr style={{background:"#fafaf8",borderTop:"2px solid #e8e6df"}}>
          <td colSpan={3} style={{padding:"8px 12px"}}>
            {(function(){
              var totBudget=filtered.reduce(function(s,t){return s+Number(t.budget||0);},0);
              var totAcc=filtered.reduce(function(s,t){return s+Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0);},0);
              var variance=totBudget-totAcc;
              return <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase"}}>TOTALS</span>
                {totBudget>0&&<div style={{padding:"3px 10px",borderRadius:7,background:"#f0ede6",fontSize:11}}>Budget: <strong>{totBudget.toLocaleString()}</strong></div>}
                {totAcc>0&&<div style={{padding:"3px 10px",borderRadius:7,background:variance<0?"#fce4ec":"#e8f5e9",fontSize:11}}>Variance (B-C): <strong style={{color:variance<0?"#c62828":"#2e7d32"}}>{variance>0?"+":""}{variance.toLocaleString()}</strong></div>}
              </div>;
            })()}
          </td>
        </tr>
      </tfoot>
    </table>
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
      </div>
      <button onClick={()=>delLetter(letter.id)} className="btn btn-sm">🗑</button>
    </div>
  </div>;
}

function CorrespondenceLog({ctrId,ctrName,correspondences,saveCorrespondences,saveT,tasks}){
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({number:"",type:"received",date:today()});
  var ctrCorr=(correspondences||[]).filter(l=>l.ctrId===ctrId);
  return <div className="card">
    <div style={{display:"flex",justifyContent:"space-between"}}><strong>Correspondence</strong><button onClick={()=>setShowAdd(!showAdd)}>＋ Add</button></div>
    {ctrCorr.map(l=><LetterRow key={l.id} letter={l} tc={{bg:"#eee",color:"#333",label:l.type}} delLetter={id=>saveCorrespondences(correspondences.filter(x=>x.id!==id))}/>)}
  </div>;
}

function CollapsibleContract({ct,fin,children}){
  const [open,setOpen]=useState(false);
  return <div style={{border:"1px solid #ddd",marginBottom:10}}><div onClick={()=>setOpen(!open)} style={{padding:10,cursor:"pointer",background:"#f9f9f9"}}><strong>{ct.number||"Contract"}</strong> - {fin.total} EUR</div>{open&&<div style={{padding:10}}>{children}</div>}</div>;
}

function CollapseContractDetail({ctr,ct,fin,updateCtField,tenders,saveT,tasks}){
  return <div><label>Contract #</label><input value={ct.number} onChange={e=>updateCtField(ctr.id,ct.id,"number",e.target.value)}/></div>;
}

function ContractorsView({contractors,saveContractors,packages,people,tasks,tenders,correspondences,saveCorrespondences,saveT}){
  const [selCtr,setSelCtr]=useState(null);
  if(selCtr){
    var ctr=selCtr;
    return <div style={{padding:20}}><button onClick={()=>setSelCtr(null)}>← Back</button><div className="page-title">{ctr.name}</div>
      {(ctr.contracts||[]).map(ct=><CollapsibleContract key={ct.id} ct={ct} fin={contractFinancials(ct)}><CollapseContractDetail ctr={ctr} ct={ct} fin={contractFinancials(ct)} updateCtField={(ctrId,ctId,f,v)=>saveContractors(contractors.map(c=>c.id===ctrId?Object.assign({},c,{contracts:c.contracts.map(x=>x.id===ctId?Object.assign({},x,{[f]:v}):x)}):c))} tenders={tenders}/></CollapsibleContract>)}
      <CorrespondenceLog ctrId={ctr.id} ctrName={ctr.name} correspondences={correspondences} saveCorrespondences={saveCorrespondences} saveT={saveT} tasks={tasks}/>
    </div>;
  }
  return <div style={{padding:20}}><div className="page-hdr"><div className="page-title">Subcontractors</div><button className="btn btn-gold" onClick={()=>saveContractors([newContractor(),...contractors])}>＋ New</button></div>
    <table className="tbl"><tbody>{contractors.map(c=><tr key={c.id} onClick={()=>setSelCtr(c)}><td>{c.name}</td><td>{c.package}</td></tr>)}</tbody></table>
  </div>;
}

function ContractsView({contractors,saveContractors,tenders,packages,saveTasks,tasks}){
  return <div style={{padding:20}}><div className="page-title">Contracts List</div><div className="empty">Select a subcontractor to view their contracts.</div></div>;
}

function AwnView({awns,saveAwns,people}){
  return <div style={{padding:20}}><div className="page-title">AWN</div></div>;
}

function WeeklyView({tasks}){
  return <div style={{padding:20}}><div className="page-title">Weekly Report</div><pre>{JSON.stringify(tasks.slice(0,5),null,2)}</pre></div>;
}

function GlobalView({tasks,trackers,tenders,contractors,saveTasks,saveTrackers}){
  return <div style={{padding:20}}><div className="page-title">Global Actions</div></div>;
}

function SettingsView({tags,saveTags,people,savePeople,packages,savePackages,allData,onImport}){
  return <div style={{padding:20}}><div className="page-hdr"><div className="page-title">Settings</div></div>
    <button className="btn btn-gold" onClick={()=>console.log(allData)}>Export to Console</button>
  </div>;
}

function safeConfirm(msg){return window.confirm(msg);}
function workingDaysDiff(d1,d2){var s=new Date(d1),e=new Date(d2);return Math.round((e-s)/(1000*3600*24));}

function calcProcurement(td){
  var LEAD = Number(td.leadTimeDays)||30;
  var deliveryDate = today();
  return {steps:[], deliveryDate, procStart:today(), margin:0, totalDays:30, LEAD};
}

function contractFinancials(ct){
  var base=Number(ct.amount||0);
  var total=base;
  var certified=(ct.certifications||[]).reduce((s,f)=>s+Number(f.amount||0),0);
  return {total, certified, remaining:total-certified, pct:total>0?Math.round(certified/total*100):0, totalInstructed:total};
}

function DashboardView({tasks}){
  return <div style={{padding:20}}><div className="page-title">Dashboard</div><div>Total tasks: {tasks.length}</div></div>;
}

function DocumentsView(){
  return <div style={{padding:20}}><div className="page-title">Overdue Docs</div></div>;
}

function UserLogin({people,onLogin}){
  return <div className="overlay" style={{background:"#1c1c1e",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{background:"#fff",padding:40,borderRadius:12}}>
      <h2 style={{fontFamily:"'DM Serif Display'"}}>Project Tracker</h2>
      <select onChange={e=>onLogin(e.target.value)}><option value="">Who are you?</option>{people.map(p=><option key={p} value={p}>{p}</option>)}</select>
    </div>
  </div>;
}

function App(){
  const [currentUser,setCurrentUser]=useState(()=>localStorage.getItem("pp_current_user"));
  const [view,setViewState]=useState(()=>localStorage.getItem("pp_view")||"global");
  function setView(v){setViewState(v);localStorage.setItem("pp_view",v);}
  
  const [tasks,setTasks]=useState([]);
  const [trackers,setTrackers]=useState([]);
  const [tenders,setTenders]=useState([]);
  const [contractors,setContractors]=useState([]);
  const [people,setPeople]=useState(SEED_PEOPLE);
  const [packages,setPackages]=useState(SEED_PACKAGES);
  const [tags,setTags]=useState(SEED_TAGS);
  const [correspondences,setCorrespondences]=useState([]);
  const [improvements,setImprovements]=useState([]);
  const [syncStatus,setSyncStatus]=useState("ok");

  const saveT=d=>{setTasks(d);cloudStore.set(KEYS.tasks,d);};
  const saveX=d=>{setTrackers(d);cloudStore.set(KEYS.trackers,d);};
  const saveTenders=d=>{setTenders(d);cloudStore.set(KEYS.tenders,d);};
  const saveContractors=d=>{setContractors(d);cloudStore.set(KEYS.contractors,d);};

  useEffect(()=>{
    const load=async()=>{
      const [t,x,td,ct,corr]=await Promise.all([
        cloudStore.get(KEYS.tasks),cloudStore.get(KEYS.trackers),
        cloudStore.get(KEYS.tenders),cloudStore.get(KEYS.contractors),
        cloudStore.get(KEYS_CORR)
      ]);
      if(t)setTasks(t);if(x)setTrackers(x);if(td)setTenders(td);if(ct)setContractors(ct);if(corr)setCorrespondences(corr);
    };
    if(window._dbReady)load();
    else window.addEventListener("db-ready",load,{once:true});
  },[]);

  if(!currentUser)return <UserLogin people={people} onLogin={u=>{setCurrentUser(u);localStorage.setItem("pp_current_user",u);}}/>;

  return <div className="layout">
    <nav className="leftnav">
      <div className="logo">PROJECT</div>
      <button className={view==="global"?"on":""} onClick={()=>setView("global")}>🌐 Actions</button>
      <button className={view==="tenders"?"on":""} onClick={()=>setView("tenders")}>📑 Tenders</button>
      <button className={view==="contractors"?"on":""} onClick={()=>setView("contractors")}>🤝 Subcontr.</button>
      <button className={view==="dashboard"?"on":""} onClick={()=>setView("dashboard")}>📈 Dash</button>
    </nav>
    <div className="main-area">
      <div className="content">
        {view==="global"&&<GlobalView tasks={tasks} saveTasks={saveT}/>}
        {view==="tenders"&&<TendersView tenders={tenders} saveTenders={saveTenders} people={people} packages={packages} tasks={tasks} saveTasks={saveT}/>}
        {view==="contractors"&&<ContractorsView contractors={contractors} saveContractors={saveContractors} people={people} packages={packages} tenders={tenders} correspondences={correspondences} saveCorrespondences={d=>{setCorrespondences(d);cloudStore.set(KEYS_CORR,d);}} saveT={saveT}/>}
        {view==="dashboard"&&<DashboardView tasks={tasks}/>}
      </div>
      <aside className="rsidebar">
        <QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} onAdd={t=>saveT([t,...tasks])}/>
      </aside>
    </div>
  </div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
