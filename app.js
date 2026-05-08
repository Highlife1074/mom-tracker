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
  return[...new Set(all)].filter(p => p !== owner && !(prefs[p]||{}).noPkgCC);
}

const TENDER_STEPS=[
  {key:"bidders",label:"Bidders List",opts:["—","N/A","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","N/A","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"acc",label:"ACC/Aconex",opts:["—","N/A","Internal review ongoing","Pending client approval","Approved A","Approved B","Approved C"]},
  {key:"contract",label:"Contract",opts:["—","N/A","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Approved C"]},
  {key:"wms",label:"WMS",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Approved C"]}
];

function ActionItem({task,onStatusChange,onUpdate,onDelete,people,packages,tags,tenders,contractors,showCreated,onNavTender}){
  const [editMode,setEditMode]=useState(false);
  const sc=calcScore(task.importance||1,task.urgence||1);
  const ss=scoreStyle(sc);
  function upd(field,val){if(onUpdate)onUpdate(field,val,true);}
  return (
    <div className="ac-item" style={{background:editMode?"#f8f9ff":task.status==="done"?"#fafaf8":"#fff",borderColor:editMode?"#3949ab":"#e8e6df",flexDirection:"column",gap:0}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8,width:"100%"}}>
        <div className={"ac-check"+(task.status==="done"?" done":"")} style={{flexShrink:0,marginTop:3,cursor:"pointer"}} onClick={()=>onStatusChange(task.status==="done"?"pending":"done")}>{task.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}</div>
        <div style={{flex:1,minWidth:0}}>
          {editMode ? (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <textarea value={task.text||""} autoFocus onChange={e=>upd("text",e.target.value)} style={{width:"100%",padding:"5px 8px",border:"1.5px solid #3949ab",borderRadius:6,fontSize:13,minHeight:44}}/>
              <button className="btn btn-sm btn-pri" onClick={()=>setEditMode(false)} style={{alignSelf:"flex-start"}}>✓ Done</button>
            </div>
          ) : (
            <div>
              <div className={"ac-text"+(task.status==="done"?" done":"")} style={{fontWeight:500}}>{task.isInfo&&<span className="badge-info">ℹ️ INFO</span>}{task.text}</div>
              <div className="ac-meta" style={{marginTop:4,display:"flex",flexWrap:"wrap",gap:4}}>
                {task.due&&<span style={{fontSize:11,color:task.due<today()?"#c62828":"#bbb"}}>📅 {fmtDate(task.due)}</span>}
                {task.owner&&<OwnerChip owner={task.owner}/>}
                {task.package&&<span className="badge" style={{background:"#f0ede6"}}>{task.package}</span>}
              </div>
            </div>
          )}
        </div>
        {!editMode&&<div style={{display:"flex",gap:4,flexShrink:0}}><button className="btn btn-sm" onClick={()=>setEditMode(true)}>✏️</button>{onDelete&&<button className="btn btn-sm btn-danger" onClick={onDelete}>🗑</button></div>}
      </div>
    </div>
  );
}
function TrackersView({trackers,saveX,people,packages}){
  const [view,setView]=useState("list");
  const [sel,setSel]=useState(null);
  if(view==="detail"&&sel){
    const done=sel.actions.filter(a=>a.status==="done").length;
    return <div style={{padding:24}}><button className="btn btn-sm" onClick={()=>setView("list")}>← Back</button><div className="page-title">{sel.title}</div>{sel.actions.map(ac=><div key={ac.id} className="ac-item">{ac.text}</div>)}</div>;
  }
  return <div style={{height:"100%",overflowY:"auto",padding:24}}><div className="page-hdr"><div className="page-title">Trackers</div><button className="btn btn-gold" onClick={()=>saveX([newTracker({title:"New Tracker"}),...trackers])}>＋ New Tracker</button></div>{trackers.map(tr=><div key={tr.id} className="ctr-card" onClick={()=>{setSel(tr);setView("detail");}}><strong>{tr.title}</strong></div>)}</div>;
}

function TendersView({tenders,saveTenders,packages,people,tasks,saveTasks}){
  const [searchQ,setSearchQ]=useState("");
  const [selTender,setSelTender]=useState(null);
  if(selTender){
    const td=selTender;
    return <div style={{padding:24,overflowY:"auto",height:"100%"}}><button className="btn btn-sm" onClick={()=>setSelTender(null)} style={{marginBottom:15}}>← Back</button><div className="page-title">{td.title}</div><div className="card">Suivi du Tender...</div></div>;
  }
  var filtered=(tenders||[]).filter(t=>(t.title||"").toLowerCase().includes(searchQ.toLowerCase()));
  return (
    <div style={{height:"100%",overflowY:"auto",display:"flex",flexDirection:"column"}}>
      <div className="page-hdr" style={{padding:24}}><div><div className="page-title">Tenders</div></div><button className="btn btn-gold" onClick={()=>saveTenders([newTender(),...tenders])}>＋ New Tender</button></div>
      <div style={{padding:"0 24px 12px"}}><input type="text" value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="🔍 Search…" style={{width:240}}/></div>
      <div style={{flex:1,overflowX:"auto",padding:"0 24px"}}><table className="tbl"><thead><tr><th>Tender</th><th>Package</th><th>ACC Status</th></tr></thead><tbody>{filtered.map(td=><tr key={td.id} onClick={()=>setSelTender(td)} style={{cursor:"pointer"}}><td><strong>{td.title}</strong></td><td><span className="badge">{td.package}</span></td><td><span className="chip">{(td.steps||{}).acc}</span></td></tr>)}</tbody>
        <tfoot><tr style={{background:"#fafaf8",borderTop:"2px solid #e8e6df"}}><td colSpan={3} style={{padding:"8px 12px"}}>
          {(function(){
            var totBudget=filtered.reduce((s,t)=>s+Number(t.budget||0),0);
            var totAcc=filtered.reduce((s,t)=>s+Number(t.accAmountSubcontract||0)+Number(t.accAmountOther||0),0);
            var variance=totBudget-totAcc;
            return <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:10,fontWeight:700,color:"#aaa",textTransform:"uppercase"}}>TOTALS ({filtered.length})</span><div style={{padding:"3px 10px",borderRadius:7,background:"#f0ede6",fontSize:11}}>Budget: <strong>{totBudget.toLocaleString()}</strong></div><div style={{padding:"3px 10px",borderRadius:7,background:variance<0?"#fce4ec":"#e8f5e9",fontSize:11}}>Variance: <strong style={{color:variance<0?"#c62828":"#2e7d32"}}>{variance.toLocaleString()}</strong></div></div>;
          })()}
        </td></tr></tfoot></table></div>
    </div>
  );
}
function ContractorsView({contractors,saveContractors,people,tasks,tenders,correspondences,saveCorrespondences,saveT}){
  const [selCtr,setSelCtr]=useState(null);
  if(selCtr){
    var ctr=selCtr;
    return <div style={{padding:24,overflowY:"auto",height:"100%"}}><button className="btn btn-sm" onClick={()=>setSelCtr(null)}>← Back</button><div className="page-hdr"><div className="page-title">{ctr.name}</div></div><div className="card">Suivi des contrats et correspondances...</div></div>;
  }
  return <div style={{padding:24,overflowY:"auto",height:"100%"}}><div className="page-hdr"><div className="page-title">Subcontractors</div><button className="btn btn-gold" onClick={()=>saveContractors([newContractor({name:"New Sub"}),...contractors])}>＋ New</button></div><table className="tbl"><tbody>{contractors.map(c=><tr key={c.id} onClick={()=>setSelCtr(c)} style={{cursor:"pointer"}}><td><strong>{c.name}</strong></td><td>{c.package}</td></tr>)}</tbody></table></div>;
}

function App(){
  const [currentUser,setCurrentUser]=useState(()=>localStorage.getItem("pp_current_user"));
  const [view,setViewState]=useState(()=>localStorage.getItem("pp_view")||"dashboard");
  function setView(v){setViewState(v);localStorage.setItem("pp_view",v);}
  const [tasks,setTasks]=useState([]);const [trackers,setTrackers]=useState([]);const [tenders,setTenders]=useState([]);const [contractors,setContractors]=useState([]);const [people,setPeople]=useState(SEED_PEOPLE);const [packages,setPackages]=useState(SEED_PACKAGES);const [tags,setTags]=useState(SEED_TAGS);const [correspondences,setCorrespondences]=useState([]);
  const saveT=d=>{setTasks(d);cloudStore.set(KEYS.tasks,d);};const saveTenders=d=>{setTenders(d);cloudStore.set(KEYS.tenders,d);};const saveContractors=d=>{setContractors(d);cloudStore.set(KEYS.contractors,d);};
  useEffect(()=>{
    const load=async()=>{
      const [t,x,td,ct,corr]=await Promise.all([cloudStore.get(KEYS.tasks),cloudStore.get(KEYS.trackers),cloudStore.get(KEYS.tenders),cloudStore.get(KEYS.contractors),cloudStore.get(KEYS_CORR)]);
      if(t)setTasks(t);if(x)setTrackers(x);if(td)setTenders(td);if(ct)setContractors(ct);if(corr)setCorrespondences(corr);
    };
    if(window._dbReady)load();else window.addEventListener("db-ready",load,{once:true});
  },[]);
  if(!currentUser)return <UserLogin people={people} onLogin={u=>{setCurrentUser(u);localStorage.setItem("pp_current_user",u);}}/>;
  return <div className="layout">
    <nav className="leftnav"><div className="logo">MAGIC TEAM</div>
      <button className={"navbtn "+(view==="trackers"?"on":"")} onClick={()=>setView("trackers")}>📊<span className="lbl">Trackers</span></button>
      <button className={"navbtn "+(view==="tenders"?"on":"")} onClick={()=>setView("tenders")}>📑<span className="lbl">Tenders</span></button>
      <button className={"navbtn "+(view==="contractors"?"on":"")} onClick={()=>setView("contractors")}>🤝<span className="lbl">Subs</span></button>
      <button className={"navbtn "+(view==="dashboard"?"on":"")} onClick={()=>setView("dashboard")}>📈<span className="lbl">Dash</span></button>
    </nav>
    <div className="main-area">
      <div className="content">
        {view==="dashboard"&&<div style={{padding:24}}><div className="page-title">Dashboard</div><div style={{fontSize:24,fontWeight:900,marginTop:20}}>{tasks.length} Active Tasks</div></div>}
        {view==="trackers"&&<TrackersView trackers={trackers} saveX={saveX} people={people} packages={packages}/>}
        {view==="tenders"&&<TendersView tenders={tenders} saveTenders={saveTenders} people={people} packages={packages} tasks={tasks} saveTasks={saveT}/>}
        {view==="contractors"&&<ContractorsView contractors={contractors} saveContractors={saveContractors} people={people} packages={packages} tenders={tenders} correspondences={correspondences} saveCorrespondences={d=>{setCorrespondences(d);cloudStore.set(KEYS_CORR,d);}} saveT={saveT} tasks={tasks}/>}
      </div>
      <aside className="rsidebar open"><QuickAdd people={people} packages={packages} tenders={tenders} contractors={contractors} onAdd={t=>saveT([t,...tasks])} improvements={[]} saveImprovements={()=>{}} currentPage={view}/></aside>
    </div>
  </div>;
}

function UserLogin({people,onLogin}){
  return <div className="overlay" style={{background:"#1c1c1e",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#fff",padding:40,borderRadius:16,width:320,textAlign:"center"}}><h2 style={{fontFamily:"'DM Serif Display'",marginBottom:20,color:"#c9a84c"}}>Project Tracker</h2><select onChange={e=>e.target.value&&onLogin(e.target.value)} style={{padding:10,width:"100%"}}><option value="">Who are you?</option>{people.map(p=><option key={p} value={p}>{p}</option>)}</select></div></div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
