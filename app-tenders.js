// ===========================================================================
// app-tenders.js — Tender sheet, submission chain, materials, shop drawings, contracts, packages.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

const TENDER_STEPS=[
  {key:"bidders",label:"Bidders list submission",opts:["—","N/A","Not Submitted","Submitted","Comments received","No comments received"],special:"bidders"},
  {key:"pkg",label:"Tender Package",opts:["—","N/A","Not needed","Not started","In preparation","Submitted","Approved"]},
  {key:"acc",label:"ACC/Aconex",opts:["—","N/A","Under preparation","Internal review ongoing","Pending client approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"contract",label:"Contract",opts:["—","N/A","Request sent","In circulation","Signed"]},
  {key:"itp",label:"ITP",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"]},
  {key:"wms",label:"WMS",opts:["—","N/A","Not done","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"]}
];
// ---------------------------------------------------------------------------
// Theoretical dates.
//
// Each step carries two dates the user can see:
//   THEORETICAL - computed, an estimate of when the step will realistically happen
//   TARGET      - typed in a meeting; the commitment, and it may be EARLIER than the
//                 theoretical when the team can move faster
//
// The theoretical of a step is derived from the most reliable thing known about the
// step before it: its "done" date first, then its typed target, then its own
// theoretical. When the previous step is done, the estimate is no longer an estimate,
// so theoretical and target become the same date.
// ---------------------------------------------------------------------------
const THEORETICAL_CHAIN=[
  {key:"bidders", from:null,      days:0},
  {key:"pkg",     from:"bidders", days:7},
  {key:"acc",     from:"pkg",     days:7},
  {key:"contract",from:"acc",     days:28,useApproval:true},
  {key:"wms",     from:"contract",days:0, anchor:"startMinus"},
  {key:"itp",     from:"contract",days:0, anchor:"startMinus"},
  {key:"mar",     from:"contract",days:14}
];
function addCalDays(dateStr,days){
  if(!isValidDate(dateStr))return "";
  var d=new Date(dateStr);
  d.setDate(d.getDate()+Number(days||0));
  return toISO(d);
}
function theoreticalDates(td){
  var sd=(td&&td.stepDates)||{};
  var out={};
  function stepDate(k,f){return ((sd[k]||{})[f])||"";}
  THEORETICAL_CHAIN.forEach(function(st){
    var target=stepDate(st.key,"target");
    var theo="";
    var locked=false;                       // previous step is done -> no longer an estimate

    if(st.anchor==="startMinus"){
      // WMS / ITP hang off the start on site, not off the previous step
      var lead=st.key==="wms"?getDur("wmsBeforeStart"):getDur("itpBeforeStart");
      if(isValidDate(td.startOnSite))theo=addCalDays(td.startOnSite,-lead);
    }else if(!st.from){
      theo=target||"";
    }else{
      var prevDone=stepDate(st.from,"done");
      var prevApproval=stepDate(st.from,"approval");
      var base="";
      if(st.useApproval&&isValidDate(prevApproval)){base=prevApproval;locked=true;}
      else if(isValidDate(prevDone)){base=prevDone;locked=true;}
      else if(isValidDate(stepDate(st.from,"target")))base=stepDate(st.from,"target");
      else base=out[st.from]?out[st.from].theoretical:"";
      if(isValidDate(base))theo=addCalDays(base,st.days);
    }

    // A target typed on this step restarts the cascade from that date
    if(isValidDate(target))theo=locked?target:theo;
    out[st.key]={
      theoretical:theo,
      target:target,
      locked:locked,
      // what the rest of the app should use: the commitment if there is one
      effective:isValidDate(target)?target:theo
    };
  });
  return out;
}
const APPROVAL_OPTS=["—","N/A","Pending Approval","Approved A","Approved B","Not Approved C","Rejected D"];
// A step is approved as soon as the client returned an A or a B.
function isApprovedStatus(v){
  var t=String(v||"").toLowerCase();
  return t.indexOf("approved a")>=0||t.indexOf("approved b")>=0;
}
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
function parseLeadDays(str){
  if(!str)return 0;
  var s=String(str).toLowerCase().trim();
  var n=parseFloat(s)||0;
  if(!n)return 0;
  if(s.includes("week")||s.includes("sem")||s.includes("wk")||s.includes("sem"))return Math.round(n*6);
  if(s.includes("month")||s.includes("mois"))return Math.round(n*26);
  return Math.round(n);
}
// A shop-drawing transmission: one submission to the client, carrying one or more drawing
// numbers. Both shapes the site actually uses are covered — several drawings sent together
// as one transmission (sub-lines), and several transmissions over time (one line each).
function newSDTransmission(o){
  return Object.assign({id:uuid(),ref:"",description:"",target:"",done:"",approvalDone:"",
    status:"",numbers:[]},o||{});
}
function SDPanel({td,updTd,tenders,saveTenders,setSelTender,people}){
  var list=td.sdTransmissions||[];
  const [openIds,setOpenIds]=useState({});
  const SD_OPTS=["","under preparation","submitted","pending approval","approved","rejected"];
  const SD_LABELS={"":"— status —","under preparation":"Under preparation","submitted":"Submitted",
    "pending approval":"Pending approval","approved":"✅ Approved","rejected":"❌ Rejected"};
  function col(st){
    return st==="approved"?"var(--green,#1e6b3a)":st==="rejected"?"var(--red,#b3302a)"
      :(st==="submitted"||st==="pending approval")?"var(--amber,#b35c00)"
      :st==="under preparation"?"var(--blue,#0f5299)":"var(--ink-3,#6f6b62)";
  }
  function save(next){updTd("sdTransmissions",next);}
  function updT(i,patch){save(list.map(function(x,j){return j!==i?x:Object.assign({},x,patch);}));}
  function delT(i){
    var t=list[i];
    if(!safeConfirm("Delete transmission "+((t&&t.ref)||"#"+(i+1))+" and its "+((t&&t.numbers)||[]).length+" drawing number(s)?"))return;
    save(list.filter(function(_,j){return j!==i;}));
  }
  function addNum(i){
    var t=list[i];
    updT(i,{numbers:[...(t.numbers||[]),{id:uuid(),number:"",description:""}]});
    setOpenIds(Object.assign({},openIds,{[t.id]:true}));
  }

  return <div style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)",flexWrap:"wrap"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Shop drawings</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        one line per transmission · several drawing numbers inside each{list.length>0?" · "+list.length+" transmission"+(list.length!==1?"s":""):""}</span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}}
        onClick={function(){save([...(list),newSDTransmission()]);}}>＋ Transmission</button>
    </div>

    {list.length===0&&<div style={{fontSize:12,color:"var(--ink-4,#9b968b)",padding:"4px 2px"}}>
      No transmission yet. Add one when a set of drawings goes to the client.</div>}

    {list.length>0&&<table className="tbl" style={{fontSize:12}}>
      <thead><tr>
        <th style={{width:34}}></th>
        <th style={{minWidth:120}}>Transmission ref</th>
        <th style={{minWidth:180}}>Description</th>
        <th style={{textAlign:"center",minWidth:112}}>Target</th>
        <th style={{textAlign:"center",minWidth:112}}>Submitted</th>
        <th style={{textAlign:"center",minWidth:112}}>Answered</th>
        <th style={{minWidth:150}}>Status</th>
        <th style={{width:34}}></th>
      </tr></thead>
      <tbody>{list.map(function(t,i){
        var nums=t.numbers||[];
        var open=!!openIds[t.id];
        var answered=t.status==="approved"||t.status==="rejected"||!!t.approvalDone;
        var due=t.done?addCalDays(t.done,getDur("clientResponse")):"";
        var overdue=!answered&&due&&due<today();
        return <React.Fragment key={t.id}>
          <tr style={{background:overdue?"var(--red-soft,#fbe6e8)":"#fff"}}>
            <td style={{textAlign:"center"}}>
              <button onClick={function(){setOpenIds(Object.assign({},openIds,{[t.id]:!open}));}}
                title={nums.length+" drawing number(s)"}
                style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--ink-3,#6f6b62)",fontFamily:"var(--font-mono)"}}>
                {open?"▾":"▸"}{nums.length||""}</button>
            </td>
            <td><input type="text" value={t.ref||""} onChange={function(e){updT(i,{ref:e.target.value});}}
              placeholder="TR-001" style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/></td>
            <td><input type="text" value={t.description||""} onChange={function(e){updT(i,{description:e.target.value});}}
              placeholder="e.g. Level 3 ceiling layouts" style={{fontSize:11,padding:"4px 6px"}}/></td>
            <td style={{textAlign:"center"}}><input type="date" min="1990-01-01" max="2200-12-31" value={t.target||""}
              onChange={function(e){updT(i,{target:e.target.value});}} style={{fontSize:11,padding:"3px 5px"}}/></td>
            <td style={{textAlign:"center"}}><input type="date" min="1990-01-01" max="2200-12-31" value={t.done||""}
              onChange={function(e){updT(i,{done:e.target.value});}} style={{fontSize:11,padding:"3px 5px"}}/></td>
            <td style={{textAlign:"center"}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={t.approvalDone||""}
                onChange={function(e){updT(i,{approvalDone:e.target.value});}} style={{fontSize:11,padding:"3px 5px"}}/>
              {overdue&&<div style={{fontSize:10,color:"var(--red,#b3302a)",fontWeight:700,marginTop:2}}
                title={"Client response was due "+fmtDate(due)}>⚠️ +{workingDaysDiff(due,today())}d</div>}
            </td>
            <td>
              <select value={t.status||""} onChange={function(e){
                  var v=e.target.value;
                  var patch={status:v};
                  // a verdict is a response: stamp the day so the overdue counter stops
                  if((v==="approved"||v==="rejected")&&!t.approvalDone)patch.approvalDone=today();
                  updT(i,patch);
                }}
                style={{width:"100%",fontSize:11,padding:"3px 5px",fontWeight:700,color:col(t.status)}}>
                {SD_OPTS.map(function(o){return <option key={o} value={o}>{SD_LABELS[o]}</option>;})}
              </select>
            </td>
            <td style={{textAlign:"center"}}>
              <button onClick={function(){delT(i);}} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13}}>🗑</button>
            </td>
          </tr>

          {open&&<tr><td></td><td colSpan={7} style={{background:"#faf9f7",padding:"8px 10px"}}>
            <div style={{fontSize:10,fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
              Drawings in this transmission</div>
            {nums.length===0&&<div style={{fontSize:11,color:"var(--ink-4,#9b968b)",marginBottom:6}}>No drawing number yet.</div>}
            {nums.map(function(n,k){
              return <div key={n.id||k} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
                <input type="text" value={n.number||""} placeholder="SD number"
                  onChange={function(e){updT(i,{numbers:nums.map(function(x,z){return z!==k?x:Object.assign({},x,{number:e.target.value});})});}}
                  style={{width:150,fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
                <input type="text" value={n.description||""} placeholder="what this drawing shows"
                  onChange={function(e){updT(i,{numbers:nums.map(function(x,z){return z!==k?x:Object.assign({},x,{description:e.target.value});})});}}
                  style={{flex:1,minWidth:120,fontSize:11,padding:"4px 6px"}}/>
                <button onClick={function(){updT(i,{numbers:nums.filter(function(_,z){return z!==k;})});}}
                  style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:12}}>×</button>
              </div>;
            })}
            <button className="btn btn-sm" onClick={function(){addNum(i);}} style={{padding:"3px 9px",fontSize:11}}>＋ Drawing number</button>
          </td></tr>}
        </React.Fragment>;
      })}</tbody>
    </table>}
  </div>;
}

function MaterialsPanel({td,updTd,saveT,tasks,tenders,saveTenders,setSelTender,pkgOwners}){
  const [open,setOpen]=useState(false);
  const [sectOpen,setSectOpen]=useState({});
  const [docDraft,setDocDraft]=useState({});
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
  // Actions attached to one specific MSS/MAR document of one material
  function docRef(mat,kind){return td.id+"::"+mat.id+"::"+kind.toLowerCase();}
  function docActions(mat,kind){
    var ref=docRef(mat,kind);
    return (tasks||[]).filter(function(t){return t.materialDocRef===ref&&t.status!=="done";});
  }
  function addDocAction(mat,kind,text){
    if(!saveT||!text.trim())return;
    saveT([newTask({
      text:text.trim(),
      owner:pkgOwner(),
      tenderRef:td.id,
      package:td.package||"",
      materialDocRef:docRef(mat,kind),
      tags:[qualityTag(td.package||"")],
      importance:2,urgence:2,
      due:mat[kind.toLowerCase()+"Target"]||"",
      note:kind+" — "+(mat.name||"material")
    }),...(tasks||[])]);
  }
  function setDocActionStatus(taskId,status){
    if(!saveT)return;
    saveT((tasks||[]).map(function(t){return t.id!==taskId?t:stampModified(Object.assign({},t,{status:status,completedAt:status==="done"?today():""}));}));
  }
  function delDocAction(taskId){
    if(!saveT)return;
    saveT((tasks||[]).filter(function(t){return t.id!==taskId;}));
  }

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
  // Several fields at once — one write, so nothing is lost to a stale snapshot.
  function updMatMany(mi,patch){
    var ms=mats.map(function(m,j){return j!==mi?m:Object.assign({},m,patch);});
    updTd("materials",ms);
  }
  // MAR is due a fixed number of days after the contract is signed. While the contract is
  // still unsigned we fall back to the theoretical signing date, so a date shows from the
  // moment the ACC step is filled in instead of staying blank until signature.
  var matTheo=(function(){
    var ct=(td.stepDates||{}).contract||{};
    var signed=ct.signedAllDone||ct.signedDone||ct.done||"";
    if(isValidDate(signed))return{date:addCalDays(signed,getDur("marAfterContract")),base:signed,firm:true};
    var chain=theoreticalDates(td);
    var est=(chain.contract||{}).effective||(chain.contract||{}).theoretical||"";
    if(isValidDate(est))return{date:addCalDays(est,getDur("marAfterContract")),base:est,firm:false};
    return{date:"",base:"",firm:false};
  })();
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
    var due14=subDone?(function(){var d=new Date(subDone);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
    var overdue=st!=="approved"&&due14&&due14<today();
    var docActs=docActions(mat,kind);
    var docLate=docActs.filter(function(t){return t.due&&t.due<today();}).length;
    return <div style={{marginBottom:4}}>
      <div onClick={function(){toggleSect(mi,k);}} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"4px 6px",background:isOpen?bg+"33":"transparent",borderRadius:5,marginBottom:isOpen?4:0}}>
        <span style={{fontSize:10,color:color}}>{isOpen?"▾":"▸"}</span>
        <span style={{fontSize:11,fontWeight:700,color:color}}>{kind}</span>
        {!isOpen&&mat[k+"Number"]&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:bg,color:color,fontFamily:"monospace",marginLeft:2}}>{mat[k+"Number"]}</span>}
        {!isOpen&&st&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:bg,color:statusColor(st),marginLeft:2,fontWeight:700}}>{CYCLE_LABELS[st]||st}</span>}
        {!isOpen&&overdue&&<span style={{fontSize:9,color:"#c62828",fontWeight:700}}>⚠️+{workingDaysDiff(due14,today())}d</span>}
        {docActs.length>0&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:8,background:docLate>0?"#fce4ec":"#f0ede6",color:docLate>0?"#c62828":"#666",fontWeight:700,marginLeft:2}}>⚑ {docActs.length}{docLate>0?" ("+docLate+" late)":""}</span>}
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
            <input type="date" min="1990-01-01" max="2200-12-31" value={mat[k+"Target"]||""} onChange={function(e){
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
            <input type="date" min="1990-01-01" max="2200-12-31" value={subDone} onChange={function(e){updMat(mi,k+"Done",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid "+color+"44",borderRadius:4}}/>
          </div>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            <span style={{fontSize:9,color:"#555",fontWeight:600}}>Approved</span>
            <input type="date" min="1990-01-01" max="2200-12-31" value={mat[k+"ApprovalDone"]||""} onChange={function(e){updMat(mi,k+"ApprovalDone",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid "+color+"44",borderRadius:4}}/>
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

        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid "+color+"22"}}>
          <div style={{fontSize:9,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:4}}>Actions ({docActs.length})</div>
          {docActs.map(function(t){
            var isL=t.due&&t.due<today();
            return <div key={t.id} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderRadius:5,background:"#fff",border:"1px solid #e8e6df",marginBottom:3}}>
              <span style={{flex:1,fontSize:10}}>{t.text}</span>
              {t.owner&&<span style={{fontSize:9,color:"#888"}}>{t.owner.split(",")[0]}</span>}
              {t.due&&<span style={{fontSize:9,color:isL?"#c62828":"#888",fontWeight:isL?700:400}}>{fmtDate(t.due)}</span>}
              <select value={t.status||"pending"} onChange={function(e){setDocActionStatus(t.id,e.target.value);}} style={{width:"auto",padding:"1px 3px",fontSize:9}}>
                {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
              </select>
              <button onClick={function(){delDocAction(t.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:10}}>🗑</button>
            </div>;
          })}
          <div style={{display:"flex",gap:4}}>
            <input type="text" value={(docDraft[docRef(mat,kind)]||"")} onChange={function(e){setDocDraft(Object.assign({},docDraft,{[docRef(mat,kind)]:e.target.value}));}}
              onKeyDown={function(e){if(e.key==="Enter"){addDocAction(mat,kind,e.target.value);setDocDraft(Object.assign({},docDraft,{[docRef(mat,kind)]:""}));}}}
              placeholder={"Add action for this "+kind+"…"} style={{flex:1,padding:"3px 7px",fontSize:10,border:"1px solid "+color+"44",borderRadius:4}}/>
            <button className="btn btn-sm" onClick={function(){var v=docDraft[docRef(mat,kind)]||"";addDocAction(mat,kind,v);setDocDraft(Object.assign({},docDraft,{[docRef(mat,kind)]:""}));}} disabled={!(docDraft[docRef(mat,kind)]||"").trim()} style={{padding:"2px 8px",fontSize:10}}>＋</button>
          </div>
        </div>
      </div>}
    </div>;
  }

  return <div style={{marginBottom:10}}>
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Materials</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
        MAR is due after the contract is signed{mats.length>0?" · "+mats.length+" material"+(mats.length!==1?"s":""):""}</span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(e){e.stopPropagation();
        var ms=[...mats,{id:uuid(),name:"",specified:"",proposed:"",leadTime:"",
          mssStatus:"",mssTarget:"",mssDone:"",mssApprovalStatus:"",mssApprovalTarget:"",mssApprovalDone:"",mssReview:"",mssLink:"",mssLinkLabel:"",mssNumber:"",
          marStatus:"",marTarget:"",marDone:"",marApprovalStatus:"",marApprovalTarget:"",marApprovalDone:"",marReview:"",marLink:"",marLinkLabel:"",marNumber:"",
          hasPO:false,poNumber:"",poStatus:""}];
        updTd("materials",ms);setOpen(true);
      }}>＋ Material</button>
    </div>

    <div>
      {mats.length===0&&<div style={{color:"var(--ink-4,#9b968b)",fontSize:12,padding:"6px 0"}}>No material yet. Use ＋ Material to add one.</div>}
      {mats.length>0&&<table className="tbl" style={{fontSize:12}}>
        <thead><tr>
          <th style={{minWidth:190}}>Material</th>
          <th style={{width:50,textAlign:"center"}} title="Tick when this material needs a Material Submission Sheet. Most do not.">MSS</th>
          <th style={{width:62}}>Doc</th>
          <th style={{textAlign:"center",minWidth:96}} title="Contract signed + the MAR lead time set in Settings › Durations. Falls back to the theoretical signing date while the contract is unsigned.">Theoretical</th>
          <th style={{textAlign:"center",minWidth:112}}>Target</th>
          <th style={{textAlign:"center",minWidth:112}}>Done</th>
          <th style={{minWidth:104}}>Reference</th>
          <th style={{minWidth:150}}>Approval status</th>
          <th style={{width:88}}>Lead time</th>
          <th style={{width:34}}></th>
        </tr></thead>
        <tbody>{mats.map(function(mat,mi){
          var docs=mat.hasMSS?["MSS","MAR"]:["MAR"];
          return <React.Fragment key={mat.id||mi}>
            {docs.map(function(kind,di){
              var p=kind.toLowerCase();
              var st=mat[p+"ApprovalStatus"]||mat[p+"Status"]||"";
              var due=mat[p+"Target"]||"";
              var late=due&&due<today()&&!mat[p+"Done"];
              return <tr key={kind} style={{background:di>0?"#fafaf8":"#fff"}}>
                {di===0&&<td rowSpan={docs.length} style={{verticalAlign:"top"}}>
                  <input type="text" value={mat.name||""} onChange={function(e){updMat(mi,"name",e.target.value);}}
                    placeholder="Material name…" style={{fontSize:12,fontWeight:600,border:"none",background:"transparent",padding:"2px 0",width:"100%"}}/>
                  <div style={{display:"flex",gap:4,marginTop:3}}>
                    <input type="text" value={mat.specified||""} onChange={function(e){updMat(mi,"specified",e.target.value);}}
                      placeholder="specified" style={{fontSize:10,padding:"2px 5px"}}/>
                    <input type="text" value={mat.proposed||""} onChange={function(e){updMat(mi,"proposed",e.target.value);}}
                      placeholder="proposed" style={{fontSize:10,padding:"2px 5px"}}/>
                  </div>
                </td>}
                {di===0&&<td rowSpan={docs.length} style={{textAlign:"center",verticalAlign:"top"}}>
                  <input type="checkbox" checked={!!mat.hasMSS} onChange={function(e){updMat(mi,"hasMSS",e.target.checked);}}
                    title="This material requires an MSS" style={{width:14,height:14,cursor:"pointer"}}/>
                </td>}
                <td>
                  <span className="badge" style={{background:kind==="MSS"?"var(--blue-soft,#e8f0fe)":"var(--gold-soft,#faf3e0)",
                    color:kind==="MSS"?"var(--blue,#0f5299)":"var(--gold-ink,#8a6a1e)"}}>{kind}</span>
                </td>
                <td style={{textAlign:"center"}}>
                  {matTheo.date
                    ?<span title={matTheo.firm?"Contract signed "+fmtDate(matTheo.base)+" + "+getDur("marAfterContract")+" days"
                                             :"Contract not signed yet — computed from the theoretical signing date "+fmtDate(matTheo.base)}
                      style={{fontSize:11,fontWeight:matTheo.firm?700:600,padding:"2px 7px",borderRadius:5,cursor:"help",
                        color:matTheo.firm?"var(--green,#1e6b3a)":"var(--ink-3,#6f6b62)",
                        background:matTheo.firm?"var(--green-soft,#e6f2e9)":"#f2f0eb",
                        border:"1px solid "+(matTheo.firm?"#c8e6c9":"var(--rule,#ddd9cf)")}}>{fmtDate(matTheo.date)}</span>
                    :<span style={{color:"#ddd",fontSize:11}} title="No contract date at all yet — fill the ACC step so the chain can compute one">—</span>}
                </td>
                <td style={{textAlign:"center"}}>
                  <input type="date" min="1990-01-01" max="2200-12-31" value={due} onChange={function(e){updMat(mi,p+"Target",e.target.value);}}
                    style={{fontSize:11,padding:"3px 5px",border:"1.5px solid "+(late?"#f0cdc9":"var(--rule,#ddd9cf)"),borderRadius:5,background:late?"#fbe6e8":"#fff"}}/>
                </td>
                <td style={{textAlign:"center"}}>
                  <input type="date" min="1990-01-01" max="2200-12-31" value={mat[p+"Done"]||""} onChange={function(e){updMat(mi,p+"Done",e.target.value);}}
                    style={{fontSize:11,padding:"3px 5px",border:"1.5px solid var(--rule,#ddd9cf)",borderRadius:5}}/>
                </td>
                <td>
                  <input type="text" value={mat[p+"Ref"]||""} onChange={function(e){updMat(mi,p+"Ref",e.target.value);}}
                    placeholder="Ref…" title="Transmittal or document number"
                    style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
                </td>
                <td>
                  <select value={mat[p+"ApprovalStatus"]||""} onChange={function(e){
                      var v=e.target.value;
                      var patch={};patch[p+"ApprovalStatus"]=v;
                      if(isApprovedStatus(v))patch[p+"Status"]=v;      // A or B approves the document
                      updMatMany(mi,patch);
                    }}
                    style={{width:"100%",fontSize:10,padding:"3px 5px",fontWeight:700,
                      color:isApprovedStatus(st)?"var(--green,#1e6b3a)":/reject|not approved/i.test(st)?"var(--red,#b3302a)":"var(--ink-3,#6f6b62)"}}>
                    {APPROVAL_OPTS.map(function(o){return <option key={o} value={o}>{o}</option>;})}
                  </select>
                </td>
                {di===0&&<td rowSpan={docs.length} style={{verticalAlign:"top"}}>
                  <input type="text" value={mat.leadTime||""} onChange={function(e){updMat(mi,"leadTime",e.target.value);}}
                    placeholder="e.g. 12 wks" style={{fontSize:11,padding:"3px 5px"}}/>
                </td>}
                {di===0&&<td rowSpan={docs.length} style={{textAlign:"center",verticalAlign:"top"}}>
                  <button onClick={function(){
                      if(!safeConfirm("Remove \""+(mat.name||"this material")+"\"?"))return;
                      updTd("materials",mats.filter(function(_,j){return j!==mi;}));
                    }} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13}}>🗑</button>
                </td>}
              </tr>;
            })}
          </React.Fragment>;
        })}</tbody>
      </table>}
    </div>
  </div>;
}


function SubmissionSteps({td,TENDER_STEPS,updateStep,tenders,saveTenders,setSelTender,tasks,saveTasks,pkgOwners}){

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
  function closeAction(text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status!=="done";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===td.id&&t.text===text&&t.status!=="done")?Object.assign({},t,{status:"done",completedAt:today()}):t;}));
  }
  function removeAction(text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status!=="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).filter(function(t){return!(t.tenderRef===td.id&&t.text===text&&t.status!=="done"&&t.addedBy==="System");}));
  }
  function reopenAction(text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td.id&&t.text===text&&t.status==="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===td.id&&t.text===text&&t.status==="done"&&t.addedBy==="System")?Object.assign({},t,{status:"pending",completedAt:""}):t;}));
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
  var theoMap=theoreticalDates(td);
  // WMS and ITP are quality documents driven by the start on site, not by the tender
  // submission chain — they get their own panel.
  var QA_KEYS=["wms","itp"];
  var mainSteps=TENDER_STEPS.filter(function(s){return s.key!=="contract"&&QA_KEYS.indexOf(s.key)<0;});
  var qaSteps=TENDER_STEPS.filter(function(s){return QA_KEYS.indexOf(s.key)>=0;});
  var contractStep=TENDER_STEPS.find(function(s){return s.key==="contract";});

  return <div>
    {/* Three sibling sections — Submission steps, WMS & ITP, Materials — all built the
        same way: a flat heading with a rule, then the table. None of them wraps another. */}
    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Submission steps</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>bidders → tender package → ACC/Aconex</span>
    </div>
    <div>
    <table className="tbl" style={{fontSize:12,marginBottom:16}}>
      <thead style={{position:"sticky",top:0,zIndex:10,background:"#f5f4f0"}}><tr>
        <th>Step</th>
        <th>Status</th>
        <th style={{textAlign:"center",minWidth:96}} title="Computed from the previous step. Turns solid once that step is done — it is no longer an estimate.">Theoretical</th>
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
        var theo=(theoMap[s.key]||{});
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
            {theo.theoretical
              ?<span title={theo.locked
                  ?"The previous step is done, so this is a firm date, not an estimate."
                  :"Estimated from the previous step. It will move if the dates before it move."}
                style={{fontSize:11,fontWeight:theo.locked?800:600,cursor:"help",padding:"2px 7px",borderRadius:5,
                  color:theo.locked?"#00695c":"#8b8578",
                  background:theo.locked?"#e8f5e9":"#f2f0eb",
                  border:"1px solid "+(theo.locked?"#c8e6c9":"#e0ddd6")}}>{fmtDate(theo.theoretical)}</span>
              :<span style={{color:"#ddd",fontSize:11}}>—</span>}
            {theo.theoretical&&theo.target&&theo.target<theo.theoretical&&
              <div style={{fontSize:8,color:"#2e7d32",fontWeight:700,marginTop:1}}>target is earlier ✓</div>}
            {theo.theoretical&&theo.target&&theo.target>theo.theoretical&&
              <div style={{fontSize:8,color:"#c62828",fontWeight:700,marginTop:1}}>target is later</div>}
          </td>
          <td style={{textAlign:"center"}}>
            <input type="date" min="1990-01-01" max="2200-12-31" value={dates.target||""} onChange={function(e){updateStep(td.id,s.key,"target",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
            {!dates.target&&theo.theoretical&&<div><button onClick={function(){updateStep(td.id,s.key,"target",theo.theoretical);}}
              title="Adopt the theoretical date as the target" style={{fontSize:8,padding:"0 5px",marginTop:2,border:"1px solid #e8e6df",borderRadius:4,background:"#fff",cursor:"pointer",fontFamily:"inherit",color:"#888"}}>use theoretical</button></div>}
          </td>

          <td style={{textAlign:"center"}}>
            <input type="date" min="1990-01-01" max="2200-12-31" value={dates.done||""} onChange={function(e){updateStep(td.id,s.key,"done",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
          </td>

          <td style={{minWidth:200}}>
            {showApproval
              ?<div style={{display:"flex",flexDirection:"column",gap:4}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={dates.approval||""} onChange={function(e){updateStep(td.id,s.key,"approval",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%"}}/>
                <select value={getApprovalStatus(s.key)} onChange={function(e){var cur=Object.assign({},(td.stepDates||{})[s.key]||{});cur.approvalStatus=e.target.value;updateStep(td.id,s.key,"approvalDateObj",cur);var d=(tenders||[]).map(function(t){if(t.id!==td.id)return t;var sd=Object.assign({},t.stepDates||{});sd[s.key]=Object.assign({},sd[s.key]||{},{approvalStatus:e.target.value});var st=Object.assign({},t.steps||{});
                  // An A or a B IS the approval — nobody should have to set the Status column too.
                  if(isApprovedStatus(e.target.value))st[s.key]=e.target.value;
                  return Object.assign({},t,{stepDates:sd,steps:st});});saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 5px",fontSize:10,fontFamily:"inherit",fontWeight:700,color:getApprovalStatus(s.key).includes("Approved")?"#2e7d32":getApprovalStatus(s.key).includes("Rejected")||getApprovalStatus(s.key).includes("Not Approved")?"#c62828":"#888"}}>
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

    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>WMS &amp; ITP</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>driven by the start on site, not by the submission chain</span>
    </div>
    <table className="tbl" style={{fontSize:12,marginBottom:16}}>
      <thead><tr>
        <th>Document</th><th>Status</th>
        <th style={{textAlign:"center",minWidth:96}} title="Start on site minus the lead time set in Settings › Durations">Theoretical</th>
        <th style={{textAlign:"center",minWidth:120}}>Submission target</th>
        <th style={{textAlign:"center",minWidth:110}}>Date done</th>
        <th style={{minWidth:110}}>Reference</th>
        <th style={{minWidth:190}}>Approval / Status</th>
      </tr></thead>
      <tbody>{qaSteps.map(function(s){
        var val=(td.steps||{})[s.key]||"";
        var dates=(td.stepDates||{})[s.key]||{};
        var th=(theoMap[s.key]||{});
        var lead=s.key==="wms"?getDur("wmsBeforeStart"):getDur("itpBeforeStart");
        return <tr key={s.key}>
          <td style={{fontWeight:700,color:"#555",whiteSpace:"nowrap"}}>{s.label}
            <div style={{fontSize:9,color:"#bbb",fontWeight:400}}>start − {lead} days</div></td>
          <td>
            <select value={val} onChange={function(e){updateStep(td.id,s.key,"status",e.target.value);}}
              className={"chip "+tenderStepClass(s.key,val)} style={{padding:"3px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5}}>
              {s.opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}
            </select>
          </td>
          <td style={{textAlign:"center"}}>
            {th.theoretical
              ?<span title={"Start on site "+fmtDate(td.startOnSite)+" minus "+lead+" days"}
                style={{fontSize:11,fontWeight:600,cursor:"help",padding:"2px 7px",borderRadius:5,color:"#8b8578",background:"#f2f0eb",border:"1px solid #e0ddd6"}}>{fmtDate(th.theoretical)}</span>
              :<span style={{color:"#ddd",fontSize:11}} title="No start on site yet — link a schedule task to this tender">—</span>}
          </td>
          <td style={{textAlign:"center"}}>
            <input type="date" min="1990-01-01" max="2200-12-31" value={dates.target||""} onChange={function(e){updateStep(td.id,s.key,"target",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
            {!dates.target&&th.theoretical&&<div><button onClick={function(){updateStep(td.id,s.key,"target",th.theoretical);}}
              style={{fontSize:8,padding:"0 5px",marginTop:2,border:"1px solid #e8e6df",borderRadius:4,background:"#fff",cursor:"pointer",fontFamily:"inherit",color:"#888"}}>use theoretical</button></div>}
          </td>
          <td style={{textAlign:"center"}}>
            <input type="date" min="1990-01-01" max="2200-12-31" value={dates.done||""} onChange={function(e){updateStep(td.id,s.key,"done",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
          </td>
          <td>
            <input type="text" value={dates.reference||""} onChange={function(e){updateStep(td.id,s.key,"reference",e.target.value);}}
              placeholder="Ref…" title="Transmittal or document number"
              style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
          </td>
          <td>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={dates.approval||""} onChange={function(e){updateStep(td.id,s.key,"approval",e.target.value);}} style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11,width:"100%"}}/>
              <select value={getApprovalStatus(s.key)} onChange={function(e){
                  var v=e.target.value;
                  var d=(tenders||[]).map(function(t){
                    if(t.id!==td.id)return t;
                    var sd=Object.assign({},t.stepDates||{});
                    sd[s.key]=Object.assign({},sd[s.key]||{},{approvalStatus:v});
                    var st=Object.assign({},t.steps||{});
                    if(isApprovedStatus(v))st[s.key]=v;      // A or B approves the document
                    return Object.assign({},t,{stepDates:sd,steps:st});
                  });
                  saveTenders(d);setSelTender(d.find(function(t){return t.id===td.id;}));
                }}
                style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 5px",fontSize:10,fontFamily:"inherit",fontWeight:700,
                  color:isApprovedStatus(getApprovalStatus(s.key))?"#2e7d32":/reject|not approved/i.test(getApprovalStatus(s.key))?"#c62828":"#888"}}>
                {APPROVAL_OPTS.map(function(o){return <option key={o} value={o}>{o}</option>;})}
              </select>
            </div>
          </td>
        </tr>;
      })}</tbody>
    </table>

    {contractStep&&(function(){
      var ct=(td.stepDates||{}).contract||{};
      var accApproval=((td.stepDates||{}).acc||{}).approval||"";

      // Auto target dates (never overwrite existing manual values)
      var autoRequestTarget=accApproval?addWorkingDays(accApproval,getDur("accToRequest")):"";
      var autoCirculateTarget=ct.requestDone?addWorkingDays(ct.requestDone,getDur("requestToCirculate")):"";
      var autoSignedAllTarget=ct.circulateDone?addWorkingDays(ct.circulateDone,getDur("circulateToSign")):"";
      var autoSignedTarget=accApproval?addWorkingDays(accApproval,getDur("accToSigned")):"";

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

      return <div>
        <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)",flexWrap:"wrap"}}>
          <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)",letterSpacing:"-.005em"}}>Contract</h3>
          {accApproval&&<span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>
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
                <input type="date" min="1990-01-01" max="2200-12-31" value={requestTarget}
                  onChange={function(e){setCtField("requestTarget",e.target.value);}}
                  style={targetStyle(autoRequestTarget,ct.requestTarget)}/>
                {targetHint(autoRequestTarget,ct.requestTarget,"Auto: ACC+3d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={ct.requestDone||""}
                  onChange={function(e){
                    setCtField("requestDone",e.target.value);
                    if(e.target.value){
                      closeAction("Contract Request to be sent — "+td.title);
                      autoAction("Contract to circulate — "+td.title);
                    }else{
                      removeAction("Contract to circulate — "+td.title);
                      reopenAction("Contract Request to be sent — "+td.title);
                    }
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
                <input type="date" min="1990-01-01" max="2200-12-31" value={circulateTarget}
                  onChange={function(e){setCtField("circulateTarget",e.target.value);}}
                  style={targetStyle(autoCirculateTarget,ct.circulateTarget)}/>
                {targetHint(autoCirculateTarget,ct.circulateTarget,"Auto: request done+7d")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={ct.circulateDone||""}
                  onChange={function(e){
                    setCtField("circulateDone",e.target.value);
                    if(e.target.value){
                      closeAction("Contract to circulate — "+td.title);
                      autoAction("Contract to be signed internally and by the sub — "+td.title);
                    }else{
                      removeAction("Contract to be signed internally and by the sub — "+td.title);
                      reopenAction("Contract to circulate — "+td.title);
                    }
                  }}
                  style={ct.circulateDone?doneStyle:dateStyle}/>
              </td>
            </tr>
            {/* "Contract to be signed by all" and "Signed contract" were the same event
                recorded twice: the first row copied its date into the second. One row now. */}
            <tr style={{background:"#fffdf0"}}>
              <td style={Object.assign({},labelStyle,{color:"#b45309"})}>
                🏁 Signed contract
                <div style={{fontSize:9,color:"#c9a84c",fontWeight:400}}>ACC/Aconex approval +28 working days</div>
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={signedTarget}
                  onChange={function(e){setCtField("signedTarget",e.target.value);}}
                  style={targetStyle(autoSignedTarget,ct.signedTarget)}
                  title={autoSignedTarget?"Auto: ACC approval + 28 working days":"Enter ACC approval date to auto-calculate"}/>
                {targetHint(autoSignedTarget,ct.signedTarget,"Auto: ACC+28wd")}
              </td>
              <td style={{textAlign:"center"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={signedDone}
                  onChange={function(e){
                    setCtField("signedDone",e.target.value);
                    setCtField("signedAllDone",e.target.value);      // kept in step for older records
                    if(e.target.value){closeAction("Contract to be signed internally and by the sub — "+td.title);}
                    else{reopenAction("Contract to be signed internally and by the sub — "+td.title);}
                    if(e.target.value&&td.hasSD){
                      // Only create the SD task if the SD status cycle hasn't already opened one for this tender
                      var sdCycleTexts=["Prepare the SD — "+td.title,"Get approval for SD — "+td.title,"Resubmit SD — "+td.title];
                      var sdAlreadyTracked=(tasks||[]).some(function(t){
                        return t.tenderRef===td.id&&t.status!=="done"&&(sdCycleTexts.indexOf(t.text)>=0||(t.text||"").indexOf("SD to be submitted: "+td.title)===0);
                      });
                      if(!sdAlreadyTracked){
                        var qtag=qualityTag(td.package||"");
                        autoAction("SD to be submitted: "+td.title,qtag,td.sdTarget||"");
                      }
                    }else if(!e.target.value&&td.hasSD){
                      removeAction("SD to be submitted: "+td.title);
                    }
                  }}
                  style={signedDone?doneStyle:dateStyle}/>
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{padding:"8px 12px",borderTop:"1px solid #f0ede6"}}>
          <textarea value={(td.stepComments||{}).contract||""} onChange={function(e){updateStep(td.id,"contract","comment",e.target.value);}} placeholder="Contract comments..." style={{border:"1px solid #e8e6df",borderRadius:5,padding:"5px 8px",fontSize:11,width:"100%",fontFamily:"inherit",resize:"vertical",minHeight:36,boxSizing:"border-box"}}/>
        </div>
      </div>;
    })()}
    </div>
  </div>;
}


function TendersView({tenders,saveTenders,packages,people,tasks,saveTasks,contractors,pkgOwners,jumpTender,clearJumpTender,jumpFrom,onBack,onNavZone}){

  function lsGet(key,fallback){try{var v=localStorage.getItem(key);return v!==null?v:fallback;}catch(e){return fallback;}}
  function lsSet(key,val){try{localStorage.setItem(key,val);}catch(e){}}

  const [pkgFilter,setPkgFilter]=useState(function(){return lsGet("pp_tv_pkgFilter","all");});
  const [searchQ,setSearchQ]=useState(function(){return lsGet("pp_tv_searchQ","");});
  const [sortCol,setSortCol]=useState(function(){return lsGet("pp_tv_sortCol","title");});
  const [sortDir,setSortDir]=useState(function(){return lsGet("pp_tv_sortDir","asc");});
  const [selTender,setSelTenderRaw]=useState(function(){
    var savedId=lsGet("pp_tv_selTenderId","");
    if(savedId){var found=(tenders||[]).find(function(t){return t.id===savedId;});if(found)return found;}
    return null;
  });
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [processPct,setProcessPct]=useState({});
  const [processBids,setProcessBids]=useState({});
  const [procOpen,setProcOpen]=useState(false);
  const [roomPickTask,setRoomPickTask]=useState(null);

  // setSelTender wrapper: pushes a browser history entry ONLY when actually navigating to a different tender
  // (not on every field edit refresh, which also calls setSelTender with the same tender's updated data)
  const [qLinked,setQLinked]=useState("");
  const [hideDoneLinked,setHideDoneLinked]=useState(false);
  var selTenderIdRef=useRef(selTender?selTender.id:"");
  function setSelTender(t){
    var newId=t?t.id:"";
    if(newId!==selTenderIdRef.current){
      selTenderIdRef.current=newId;
      try{history.pushState({pp_tendersNav:true,selTenderId:newId},"",location.href);}catch(e){}
    }
    setSelTenderRaw(t);
  }

  useEffect(function(){lsSet("pp_tv_pkgFilter",pkgFilter);},[pkgFilter]);
  useEffect(function(){lsSet("pp_tv_searchQ",searchQ);},[searchQ]);
  useEffect(function(){lsSet("pp_tv_sortCol",sortCol);},[sortCol]);
  useEffect(function(){lsSet("pp_tv_sortDir",sortDir);},[sortDir]);
  useEffect(function(){lsSet("pp_tv_selTenderId",selTender?selTender.id:"");},[selTender]);

  useEffect(function(){
    function onPop(e){
      if(e.state&&e.state.pp_tendersNav!==undefined){
        var id=e.state.selTenderId;
        selTenderIdRef.current=id||"";
        if(id){var found=(tenders||[]).find(function(t){return t.id===id;});setSelTenderRaw(found||null);}
        else{setSelTenderRaw(null);}
      }
    }
    window.addEventListener("popstate",onPop);
    return function(){window.removeEventListener("popstate",onPop);};
  },[tenders]);

  useEffect(function(){
    if(jumpTender){
      var t=(tenders||[]).find(function(x){return x.id===jumpTender;});
      if(t){setSelTender(t);}
      if(clearJumpTender)clearJumpTender();
    }
  },[jumpTender]);

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
      else if(sortCol==="contract"){
        function ctStage(t){var c=(t.stepDates||{}).contract||{};if(c.signedDone||c.signedAllDone)return 4;if(c.circulateDone)return 3;if(c.requestDone)return 2;if(((t.stepDates||{}).acc||{}).approval)return 1;return 0;}
        r=ctStage(a)-ctStage(b);
      }
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

  function autoActionForTender(td2,text,tag,overrides){
    if(!saveTasks||!tasks)return;
    var exists=(tasks||[]).some(function(t){return t.tenderRef===td2.id&&t.text===text&&t.status!=="done";});
    if(exists)return;
    var owner=(pkgOwners||{})[td2.package||""]||td2.ownerTender||"";
    var base={text:text,owner:owner,tenderRef:td2.id,package:td2.package||"",tags:[tag||"Contract"],status:"pending",note:"Auto-created from contract/ACC status",addedBy:"System"};
    saveTasks([newTask(Object.assign(base,overrides||{})),...(tasks||[])]);
  }
  function closeActionForTender(td2,text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===td2.id&&t.text===text&&t.status!=="done";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===td2.id&&t.text===text&&t.status!=="done")?Object.assign({},t,{status:"done",completedAt:today()}):t;}));
  }
  // Removes a still-pending auto-created action (used when a date that justified it gets cleared)
  function removeSystemAction(tid,text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===tid&&t.text===text&&t.status!=="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).filter(function(t){return!(t.tenderRef===tid&&t.text===text&&t.status!=="done"&&t.addedBy==="System");}));
  }
  // Reopens an auto-closed action (used when a done-date that closed it gets cleared)
  function reopenSystemAction(tid,text){
    if(!saveTasks||!tasks)return;
    var found=(tasks||[]).some(function(t){return t.tenderRef===tid&&t.text===text&&t.status==="done"&&t.addedBy==="System";});
    if(!found)return;
    saveTasks((tasks||[]).map(function(t){return(t.tenderRef===tid&&t.text===text&&t.status==="done"&&t.addedBy==="System")?Object.assign({},t,{status:"pending",completedAt:""}):t;}));
  }
  var SUBMIT_RESULT_STEPS={
    acc:{text:function(t){return"Submit the Tender Result — "+t.title;},tag:function(){return"Procurement";}},
    itp:{text:function(t){return"Submit the ITP — "+t.title;},tag:function(t){return qualityTag(t.package||"");}},
    wms:{text:function(t){return"Submit the WMS — "+t.title;},tag:function(){return null;}}
  };
  function syncSubmitResultAction(updatedTd,step,targetVal,doneNow){
    var cfg=SUBMIT_RESULT_STEPS[step];
    if(!cfg||!targetVal||doneNow)return;
    var text=cfg.text(updatedTd);
    var tag=cfg.tag(updatedTd);
    var overrides={due:targetVal,importance:3,urgence:calcProcurementUrgence(targetVal)};
    if(tag)overrides.tags=[tag];else overrides.tags=[];
    var exists=(tasks||[]).some(function(t){return t.tenderRef===updatedTd.id&&t.text===text&&t.status!=="done";});
    if(exists){
      saveTasks((tasks||[]).map(function(t){return(t.tenderRef===updatedTd.id&&t.text===text&&t.status!=="done")?Object.assign({},t,overrides):t;}));
    }else{
      autoActionForTender(updatedTd,text,tag||"Contract",overrides);
    }
  }
  function updateStep(tdId,step,field,val){
    var prevTd=(tenders||[]).find(function(t){return t.id===tdId;});
    var prevAccDone=prevTd?(((prevTd.stepDates||{}).acc||{}).done||""):"";
    var prevStepDone=prevTd?(((prevTd.stepDates||{})[step]||{}).done||""):"";
    var prevStepTarget=prevTd?(((prevTd.stepDates||{})[step]||{}).target||""):"";
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
    var apprText="Get the approval of the Tender result from the client — "+updatedTd.title;

    // Trigger "Contract Request to be sent" ONLY when ACC/Aconex gets a Date done (not on target/status changes)
    if(updatedTd&&step==="acc"&&field==="done"&&val&&!prevAccDone){
      var reqDone=((updatedTd.stepDates||{}).contract||{}).requestDone||"";
      if(!reqDone)autoActionForTender(updatedTd,"Contract Request to be sent — "+updatedTd.title);
    }
    // Trigger "Get the approval of the Tender result from the client" once ACC/Aconex is submitted (Date done filled)
    if(updatedTd&&step==="acc"&&field==="done"&&val&&!prevAccDone){
      var apprDueVal=addWorkingDays(val,getDur("accApproval"));
      autoActionForTender(updatedTd,apprText,"Procurement",{due:apprDueVal,importance:3,urgence:calcProcurementUrgence(apprDueVal)});
    }
    // ACC Date done CLEARED (was filled, now empty): undo — remove the two tasks it created, reopen "Submit the Tender Result" if target still set
    if(updatedTd&&step==="acc"&&field==="done"&&!val&&prevAccDone){
      removeSystemAction(updatedTd.id,"Contract Request to be sent — "+updatedTd.title);
      removeSystemAction(updatedTd.id,apprText);
      var accTargetStill=((updatedTd.stepDates||{}).acc||{}).target||"";
      if(accTargetStill)reopenSystemAction(updatedTd.id,SUBMIT_RESULT_STEPS.acc.text(updatedTd));
    }
    // Close "Get the approval..." once ACC/Aconex Date of approval OR approval status is filled (client responded)
    if(updatedTd&&step==="acc"&&field==="approval"&&val){
      closeActionForTender(updatedTd,apprText);
    }
    if(updatedTd&&step==="acc"&&field==="approval"&&!val){
      reopenSystemAction(updatedTd.id,apprText);
    }
    if(updatedTd&&step==="acc"&&field==="approvalDateObj"&&val&&val.approvalStatus&&val.approvalStatus!=="—"){
      closeActionForTender(updatedTd,apprText);
    }
    // Trigger "Submit the [Tender/ITP/WMS] Result" when the step gets a Target date but no Date done yet (ACC, ITP, WMS)
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&field==="target"&&val){
      var stepDoneNow=((updatedTd.stepDates||{})[step]||{}).done||"";
      syncSubmitResultAction(updatedTd,step,val,stepDoneNow);
    }
    // Target date CLEARED (was set, now empty): remove "Submit the ... Result" if still pending
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&field==="target"&&!val&&prevStepTarget){
      removeSystemAction(updatedTd.id,SUBMIT_RESULT_STEPS[step].text(updatedTd));
    }
    // Close "Submit the [Tender/ITP/WMS] Result" once the step's Date done is filled
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&field==="done"&&val&&!prevStepDone){
      closeActionForTender(updatedTd,SUBMIT_RESULT_STEPS[step].text(updatedTd));
    }
    // Date done CLEARED (was filled, now empty): reopen "Submit the ... Result" if target still set (ITP/WMS; ACC handled above with its own extra tasks)
    if(updatedTd&&SUBMIT_RESULT_STEPS[step]&&step!=="acc"&&field==="done"&&!val&&prevStepDone){
      var stillTarget=((updatedTd.stepDates||{})[step]||{}).target||"";
      if(stillTarget)reopenSystemAction(updatedTd.id,SUBMIT_RESULT_STEPS[step].text(updatedTd));
    }
  }

  var linkedTasks=selTender?(tasks||[]).filter(function(t){return t.tenderRef===selTender.id;}):[];

  if(selTender){
    var td=selTender;
    var linkedTasks=(tasks||[]).filter(function(t){return t.tenderRef===td.id;});
    var qL=qLinked.trim().toLowerCase();
    var shownLinked=linkedTasks.filter(function(t){
      if(hideDoneLinked&&t.status==="done")return false;
      if(!qL)return true;
      var hay=[t.text,t.owner,t.status,t.note,(t.tags||[]).join(" "),t.package,t.zone].join(" ").toLowerCase();
      return qL.split(/\s+/).every(function(w){return hay.indexOf(w)>=0;});
    });
    // Accepts a field name or a whole object. Three sequential single-field calls each
    // rebuilt from the same stale `tenders`, so only the last one survived — which is why
    // picking an SD status appeared to do nothing.
    function updTd(field,val){
      var patch=(field&&typeof field==="object")?field:{[field]:val};
      var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,patch);});
      saveTenders(d);
      setSelTender(d.find(function(t){return t.id===td.id;}));
    }
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

        <div style={{position:"sticky",top:0,zIndex:30,background:"#f4f3f0",display:"flex",gap:6,paddingBottom:6,paddingTop:2,marginBottom:6}}>
          {onBack&&<button className="btn btn-sm" onClick={onBack} style={{flexShrink:0,color:"var(--blue)",borderColor:"var(--blue)"}}>← Back to {jumpFrom}</button>}
          <button className="btn btn-sm" onClick={function(){setSelTender(null);onBack?null:null;}} style={{flexShrink:0}}>← All tenders</button>
        </div>
        <div className="page-hdr" style={{marginBottom:12}}>
          <div style={{flex:1}}>
            {/* Title block: the tender sheet reads like a drawing sheet, and the same
                strip heads the printed reports. */}
            {(function(){
              var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
              if(!proc.deliveryDate)return null;
              var src=proc.leadSource;
              return <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8,
                padding:"7px 11px",borderRadius:8,background:"#faf9f7",border:"1.5px solid var(--rule,#ddd9cf)",fontSize:11}}>
                <span style={{fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em",fontSize:10}}>Delivery</span>
                {(function(){
                  // Name the milestone the chain actually started from, so the date can be argued with.
                  var sd=td.stepDates||{};
                  var acc=sd.acc||{}, ct=sd.contract||{};
                  var origin;
                  if(ct.signedAllDone||ct.signedDone)origin={l:"contract signed",d:ct.signedAllDone||ct.signedDone,firm:true};
                  else if(acc.approval)origin={l:"ACC approved",d:acc.approval,firm:true};
                  else if(acc.done)origin={l:"ACC submitted",d:acc.done,firm:true};
                  else if(acc.target)origin={l:"ACC target",d:acc.target,firm:false};
                  else origin=null;
                  if(!origin)return null;
                  return <span style={{display:"flex",gap:5,alignItems:"center"}}
                    title={origin.firm?"This is a real recorded date, so everything after it is firm."
                      :"No actual date yet — the chain starts from the ACC target, so the delivery is provisional."}>
                    <span style={{fontFamily:"var(--font-mono)",fontWeight:700,
                      color:origin.firm?"var(--green,#1e6b3a)":"var(--amber,#b35c00)"}}>{fmtDate(origin.d)}</span>
                    <span className="badge" style={{
                      background:origin.firm?"var(--green-soft,#e6f2e9)":"var(--amber-soft,#fdf1e0)",
                      color:origin.firm?"var(--green,#1e6b3a)":"var(--amber,#b35c00)"}}>{origin.l}</span>
                  </span>;
                })()}
                <span style={{color:"var(--ink-4,#9b968b)"}}>→</span>
                <span style={{fontFamily:"var(--font-mono)"}}>{fmtDate(proc.fabStart||"")}</span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>fabrication</span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>＋</span>
                <span style={{display:"flex",gap:4,alignItems:"center"}}>
                  <input type="number" min="0" value={td.leadTimeDays||""}
                    onChange={function(e){updTd("leadTimeDays",e.target.value);}}
                    placeholder={String(proc.LEAD)}
                    title="Lead time in days. Leave empty to use the longest material lead time; type a value to override it."
                    style={{width:64,fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 6px",textAlign:"right",
                      borderColor:src==="manual"?"var(--blue,#0f5299)":"var(--rule,#ddd9cf)"}}/>
                  <span style={{color:"var(--ink-4,#9b968b)"}}>days</span>
                </span>
                <span className="badge" style={{
                  background:src==="manual"?"var(--blue-soft,#e8f0fe)":src==="material"?"var(--gold-soft,#faf3e0)":"#eee",
                  color:src==="manual"?"var(--blue,#0f5299)":src==="material"?"var(--gold-ink,#8a6a1e)":"var(--ink-3,#6f6b62)"}}
                  title={src==="manual"?"You typed this lead time; it overrides the materials."
                    :src==="material"?"Longest lead time among this tender's materials"
                    :"No lead time set anywhere — 30 days assumed"}>
                  {src==="manual"?"manual":src==="material"?"from "+(proc.leadMaterial||"material"):"default 30d"}</span>
                <span style={{display:"flex",gap:3,alignItems:"center"}}>
                  <button className={"btn btn-sm"+(src!=="manual"?" btn-pri":"")} style={{padding:"2px 9px",fontSize:10}}
                    title="Use the longest material lead time"
                    onClick={function(){updTd("leadTimeDays","");}}>auto</button>
                  <button className={"btn btn-sm"+(src==="manual"?" btn-pri":"")} style={{padding:"2px 9px",fontSize:10}}
                    title="Type your own lead time, overriding the materials"
                    onClick={function(){if(src!=="manual")updTd("leadTimeDays",String(proc.LEAD||30));}}>manual</button>
                </span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>＝</span>
                <span style={{fontFamily:"var(--font-mono)",fontWeight:700}}>{fmtDate(proc.deliveryDate)}</span>
              </div>;
            })()}
            {/* Inline fallbacks mirror the .titleblock rules: if index.html has not been
                deployed yet the block still reads as a block, not as stacked plain text. */}
            <div className="titleblock accent" style={{display:"flex",alignItems:"stretch",overflow:"hidden",
              border:"1.5px solid "+(td.cancelled?"var(--amber,#b35c00)":"var(--gold,#c9a84c)"),borderLeftWidth:5,borderRadius:8,
              background:td.cancelled?"#fdf9f2":"#fff",marginBottom:16}}>
              <div className="tb-main" style={{flex:1,minWidth:0,padding:"12px 16px"}}>
                <div className="tb-eyebrow" style={{fontSize:11,fontWeight:600,letterSpacing:".09em",
                  textTransform:"uppercase",color:"#6f6b62",marginBottom:3}}>Tender · {td.package||"no package"}</div>
                <input type="text" value={td.title||""} onChange={function(e){updTd("title",e.target.value);}}
                  placeholder="Tender title"
                  style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-page)",letterSpacing:"-.01em",
                    border:"none",background:"transparent",outline:"none",width:"100%",padding:0,color:"var(--ink)",lineHeight:1.08}}/>
                <div className="tb-sub" style={{fontSize:12,color:"#6f6b62",marginTop:3,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span>{td.ownerTender||"no owner"}{td.contractor?" · "+td.contractor:""}</span>
                  {td.cancelled&&<span className="badge" style={{background:"var(--amber-soft,#fdf1e0)",color:"var(--amber,#b35c00)",fontWeight:700}}>
                    ⊘ CANCELLED{td.cancelledAt?" · "+fmtDate(td.cancelledAt):""}</span>}
                  <button className="btn btn-sm" style={{padding:"2px 9px",fontSize:10}}
                    title={td.cancelled
                      ?"Bring this tender back into the totals"
                      :"Keep the tender and its history, but drop it from every budget total. Nothing is deleted."}
                    onClick={function(){
                      if(td.cancelled){
                        if(!safeConfirm("Reinstate “"+(td.title||"this tender")+"”?\n\nIts amounts go back into the package totals."))return;
                        updTd("cancelled",false);
                      }else{
                        if(!safeConfirm("Cancel “"+(td.title||"this tender")+"”?\n\nNothing is deleted: the tender, its steps and its documents stay. It simply stops counting in the budget, proposed, instructed and variance totals, and its row turns orange."))return;
                        updTd("cancelledAt",today());
                        updTd("cancelled",true);
                      }
                    }}>{td.cancelled?"↺ Reinstate":"⊘ Cancel tender"}</button>
                </div>
              </div>
              <div className="tb-cells" style={{display:"flex",borderLeft:"1.5px solid var(--gold,#c9a84c)",flexShrink:0}}>
                {(function(){
                  var acc=(td.stepDates||{}).acc||{};
                  var ct=(td.stepDates||{}).contract||{};
                  var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
                  // The ACC verdict can be recorded in either place: the Status column of
                  // the submission table, or the Approval dropdown. Read both.
                  var accSt=acc.approvalStatus||((td.steps||{}).acc)||"";
                  var signed=ct.signedAllDone||ct.signedDone||ct.done||"";
                  var ctState=((td.steps||{}).contract)||"";
                  var cells=[
                    {k:"ACC",
                      v:accSt&&accSt!=="—"?accSt:"pending",
                      cls:isApprovedStatus(accSt)?"green":/reject|not approved/i.test(accSt)?"red":""},
                    {k:"Contract",
                      v:signed?fmtDate(signed):(ctState&&ctState!=="—"&&ctState!=="N/A"?ctState:"unsigned"),
                      cls:signed||/signed/i.test(ctState)?"green":""},
                    {k:"Delivery",
                      v:proc.deliveryDate?fmtDate(proc.deliveryDate):"needs ACC date",
                      cls:proc.deliveryDate?"":"muted",
                      tip:proc.deliveryDate
                        ?("Fabrication launch "+fmtDate(proc.fabStart||"")+"\n+ "+proc.LEAD+" days lead time"+
                          (proc.leadSource==="manual"?" (typed by hand)":proc.leadSource==="material"?" (longest material: "+(proc.leadMaterial||"—")+")":" (default, no lead time anywhere)")+
                          "\n= delivery "+fmtDate(proc.deliveryDate))
                        :"The whole chain is computed from the ACC submittal date. Fill in the ACC/Aconex target (or its date done) in Submission steps, and this fills itself."},
                    {k:"Start",v:td.startOnSite?fmtDate(td.startOnSite):"no linked task",
                      cls:td.startOnSite?"gold":"muted",
                      tip:td.startOnSite
                        ?"Earliest start week among the schedule tasks linked to this tender."
                        :"Link a schedule task to this tender (📐 panel in a zone schedule) and its start week lands here."},
                    {k:"Margin",
                      v:(proc.margin===undefined||proc.margin===null||proc.margin==="")?"needs both dates":proc.margin+"d",
                      cls:(proc.margin===undefined||proc.margin===null||proc.margin==="")?"muted":Number(proc.margin)<0?"red":"green",
                      tip:"Days between the forecast delivery and the start on site. It needs both a delivery date and a linked schedule task."}
                  ];
                  return cells.map(function(c){
                    var vc=c.cls==="red"?"#b3302a":c.cls==="green"?"#1e6b3a":c.cls==="gold"?"#8a6a1e":c.cls==="muted"?"#9b968b":"#16181d";
                    return <div className="tb-cell" key={c.k} title={c.tip||""} style={{padding:"10px 15px",borderRight:"1px solid #ddd9cf",minWidth:96,cursor:c.tip?"help":"default"}}>
                      <span className="k" style={{display:"block",fontSize:9.5,fontWeight:600,letterSpacing:".09em",
                        textTransform:"uppercase",color:"#6f6b62",marginBottom:2}}>{c.k}</span>
                      <span className={"v "+(c.cls||"")} style={{display:"block",fontSize:c.cls==="muted"?11:13,
                        fontWeight:c.cls==="muted"?500:600,fontStyle:c.cls==="muted"?"italic":"normal",
                        color:vc,whiteSpace:"nowrap"}}>{c.v}</span>
                    </div>;
                  });
                })()}
              </div>
            </div>
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
                {(function(){
                  // Driven by the schedules: earliest start week among the tasks linked to this tender.
                  var linked=[];
                  (window._ppSchedules||[]).forEach(function(sc){
                    (sc.rows||[]).forEach(function(r){if(r.tenderRef===td.id&&r.startWeek)linked.push({sc:sc,r:r});});
                  });
                  if(linked.length>0){
                    linked.sort(function(a,b){return a.r.startWeek.localeCompare(b.r.startWeek);});
                    var f=linked[0];
                    return <span onClick={function(){
                        try{
                          lsSet("pp_zone_cur",f.sc.zone||"");lsSet("pp_zone_subtab","schedule");
                          lsSet("pp_sched_selId",f.sc.id);lsSet("pp_sched_focusRow",f.r.id);
                          // breadcrumb so the schedule can send us straight back here
                          lsSet("pp_back_tender",td.id);lsSet("pp_back_label",td.title||"the tender");
                        }catch(e){}
                        if(onNavZone)onNavZone();
                      }}
                      title={"Driven by \""+(f.r.label||"task")+"\" in "+(f.sc.zone||"?")+" ("+f.sc.title+")\nClick to open that task in the schedule."}
                      style={{fontSize:11,fontWeight:800,color:"#00695c",background:"#e8f5e9",border:"1px solid #c8e6c9",borderRadius:5,padding:"2px 8px",cursor:"pointer"}}>
                      🗓 {fmtDate(td.startOnSite||f.r.startWeek)} <span style={{fontSize:9,fontWeight:600,color:"#4caf50"}}>· {f.r.label||"task"} ↗</span>
                    </span>;
                  }
                  return <input type="date" min="1990-01-01" max="2200-12-31" value={td.startOnSite||""} onChange={function(e){updTd("startOnSite",e.target.value);}}
                    title="No schedule task is linked to this tender yet — you can set the date by hand. As soon as a task is linked, the schedule takes over."
                    style={{fontSize:11,border:"1px solid #e8e6df",borderRadius:5,padding:"2px 6px"}}/>;
                })()}
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
          <div className="card" style={{flex:1,minWidth:120,marginBottom:0,padding:"10px 14px",background:"#f3e5f5"}}>
            <div style={{fontSize:10,color:"#7b1fa2",marginBottom:2}}>Budget treated</div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="number" value={td.accAmountTreated||""} onChange={function(e){updTd("accAmountTreated",e.target.value);}} placeholder="0" style={{fontSize:16,fontWeight:800,border:"1px solid #ce93d8",borderRadius:5,background:"#fff",width:"100%",padding:"2px 6px",outline:"none",fontFamily:"inherit",color:"#7b1fa2"}}/>
              <span style={{fontSize:10,color:"#aaa"}}>{cur}</span>
            </div>
            <div style={{fontSize:10,color:"#aaa"}}>Used for the Packages recap (Budget/Cost/Variance treated)</div>
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

        <div className="card" style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <div style={{fontWeight:700,fontSize:14}}>Linked Actions ({shownLinked.length}{shownLinked.length!==linkedTasks.length?" / "+linkedTasks.length:""})</div>
            <input type="text" value={qLinked} onChange={function(e){setQLinked(e.target.value);}}
              placeholder="🔎 Search text, owner, tag, status…" style={{flex:1,minWidth:180,maxWidth:340,padding:"4px 9px",fontSize:11}}/>
            {qLinked&&<button className="btn btn-sm" onClick={function(){setQLinked("");}}>✕</button>}
            <label style={{display:"flex",alignItems:"center",gap:4,fontSize:10,textTransform:"none",letterSpacing:"normal",cursor:"pointer",color:"#888",margin:0}}>
              <input type="checkbox" checked={hideDoneLinked} onChange={function(e){setHideDoneLinked(e.target.checked);}} style={{width:12,height:12}}/>
              Hide done
            </label>
          </div>
          {shownLinked.length===0
            ?<div style={{color:"#bbb",fontSize:13}}>No actions linked to this tender yet.</div>
            :shownLinked.map(function(t){
              return <ActionItem key={t.id} task={t}
                onStatusChange={function(val){saveTasks(tasks.map(function(x){return x.id!==t.id?x:Object.assign({},x,{status:val});}));}}
                onUpdate={function(field,val){saveTasks(tasks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));if(field&&typeof field==="object"){Object.assign(u,field);}else{u[field]=val;}return u;}));}}
                onDelete={function(){saveTasks((tasks||[]).filter(function(x){return x.id!==t.id;}));}}
                people={people} packages={packages} tags={window._ppTags||[]} tenders={tenders} contractors={contractors} onNavTender={null}
                zones={window._ppZones||[]} onOpenRooms={function(tk){setRoomPickTask(tk);}}/>;
            })}
          <QuickAddTask
            prefill={{tenderRef:td.id, package:td.package||"", owner:td.ownerTender||""}}
            onAdd={function(t){saveTasks([t,...(tasks||[])]);}} people={people}
            tags={window._ppTags||[]} label="Add Task to this tender"
          />
        </div>


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
            var allTexts=["Prepare the "+base,"Get approval for "+base,"Resubmit "+base];
            var legacyPrefix="SD to be submitted: "+td.title;
            var owner=(pkgOwners||{})[td.package||""]||td.ownerTender||"";
            var updated=(tasks||[]).map(function(t){
              if(t.tenderRef!==td.id)return t;
              // Match cycle tasks exactly, and the contract-created one by prefix (its text may carry a target date suffix)
              var isCycleTask=allTexts.indexOf(t.text)>=0;
              var isLegacySD=(t.text||"").indexOf(legacyPrefix)===0;
              if((isCycleTask||isLegacySD)&&t.status!=="done"){
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
            var patch={sdStatus:val};
            patch.sdApprovalStatus=(val==="approved"||val==="pending approval")?val:"";
            // A verdict from the client is a response: record the day it landed so the
            // overdue counter stops.
            if((val==="approved"||val==="rejected")&&!td.sdApprovalDone)patch.sdApprovalDone=today();
            if(val!=="approved"&&val!=="rejected")patch.sdApprovalDone="";
            updTd(patch);
            sdStepAction(val);
          }
          var sdDue14=td.sdDone?(function(){var d=new Date(td.sdDone);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
          // Overdue = we are still waiting. Once the client answers — approved, rejected,
          // or an approval date recorded — the clock stops.
          var sdAnswered=sdEff==="approved"||sdEff==="rejected"||!!td.sdApprovalDone;
          var sdOverdue=!sdAnswered&&sdDue14&&sdDue14<today();
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
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Target</span><input type="date" min="1990-01-01" max="2200-12-31" value={td.sdTarget||""} onChange={function(e){
                updTd("sdTarget",e.target.value);
                if(e.target.value&&sdEff==="under preparation"&&saveTasks&&tasks){
                  var prepText="Prepare the SD — "+td.title;
                  saveTasks((tasks||[]).map(function(t){return t.tenderRef===td.id&&t.text===prepText&&t.status!=="done"?Object.assign({},t,{due:e.target.value}):t;}));
                }
              }} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Submitted</span><input type="date" min="1990-01-01" max="2200-12-31" value={td.sdDone||""} onChange={function(e){updTd("sdDone",e.target.value);}} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}><span style={{fontSize:10,color:"#888",fontWeight:600}}>Approved</span><input type="date" min="1990-01-01" max="2200-12-31" value={td.sdApprovalDone||""} onChange={function(e){updTd("sdApprovalDone",e.target.value);}} style={{fontSize:11,padding:"3px 6px",border:"1px solid #00695c44",borderRadius:4}}/></div>
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

        {/* The Procurement Timeline used to live here. Its cascade is now the "Theoretical"
            column inside Submission Steps — one table instead of two saying the same thing. */}
        <SubmissionSteps td={td} TENDER_STEPS={TENDER_STEPS} updateStep={updateStep} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} tasks={tasks} saveTasks={saveTasks} pkgOwners={pkgOwners}/>

        {td.hasSD&&<SDPanel td={td} updTd={updTd} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} people={people}/>}

        {/* Materials sit under the submission chain: their MAR date is derived from the
            contract, which is itself the end of that chain. */}
        <MaterialsPanel td={td} updTd={updTd} tenders={tenders} saveTenders={saveTenders} setSelTender={setSelTender} saveT={saveTasks} tasks={tasks} pkgOwners={pkgOwners}/>

      
      </div>
      </div>

      {roomPickTask&&<BlockedRoomsModal
        zone={roomPickTask.zone}
        rooms={window._ppRooms||[]}
        selected={roomPickTask.blockedRooms||[]}
        onSave={function(sel){
          saveTasks((tasks||[]).map(function(x){return x.id!==roomPickTask.id?x:stampModified(Object.assign({},x,{blockedRooms:sel}));}));
        }}
        onClose={function(){setRoomPickTask(null);}}/>}
    </div>;
  }

  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Tenders</div><div className="page-sub">Track submission steps by package</div></div>
      <button className="btn btn-gold" title="One printable PDF: per package, the procurement status, the open actions, the MAR list and the WMS/ITP list"
        onClick={function(){openReport("Procurement Report",buildProcurementReport(tenders,tasks,packages));}}>📑 Procurement report</button>
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
      // A cancelled tender is kept for the record but counts nowhere.
      var releasedTenders=filtered.filter(function(t){return t.released&&!t.cancelled;});
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
      var totAllBudget=filtered.filter(function(t){return !t.cancelled;}).reduce(function(s,t){return s+Number(t.budget||0);},0);
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
          <th style={{textAlign:"center",minWidth:104}} title="Instruction number. Filled in = the instruction has been received.">Instruction</th>
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
          // Row colour tells the commercial state at a glance:
          // orange = cancelled, green = contract signed AND instruction received.
          var _ct=(td.stepDates||{}).contract||{};
          var _signed=!!(_ct.signedAllDone||_ct.signedDone||/signed/i.test((td.steps||{}).contract||""));
          var _instr=String(td.instructionNumber||"").trim();
          var rowBg=td.cancelled?"#fdf1e0":(_signed&&_instr)?"#e6f2e9":"";
          return <tr key={td.id} style={{cursor:"pointer",background:rowBg,opacity:td.cancelled?.7:1}} onClick={function(){setSelTender(td);}}>
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
            <td style={{textAlign:"center",whiteSpace:"nowrap"}} onClick={function(e){e.stopPropagation();}}>
              <input type="text" value={td.instructionNumber||""}
                onChange={function(e){
                  var v=e.target.value;
                  var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{instructionNumber:v});});
                  saveTenders(d);
                }}
                placeholder="—" title="Instruction number. As soon as it is filled in the package counts as instructed."
                style={{width:88,fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 5px",textAlign:"center",
                  border:"1.5px solid "+(_instr?"#c8e6c9":"var(--rule,#ddd9cf)"),background:_instr?"#f2f9f3":"#fff"}}/>
              <div style={{fontSize:10,fontWeight:700,marginTop:2,color:_instr?"var(--green,#1e6b3a)":"var(--ink-4,#9b968b)"}}>
                {_instr?"✓ instructed":"not instructed"}</div>
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
              if(s.key==="contract"){
                var ctc=(td.stepDates||{}).contract||{};
                var CONTRACT_LABELS_LIST=["—","To request","To circulate","To sign","✅ Signed"];
                var CONTRACT_COLORS=["s-default","s-pending","s-pending","s-pending","s-approved-a"];
                var ctAccApproval=((td.stepDates||{}).acc||{}).approval||"";
                var autoReqTarget=ctAccApproval?addWorkingDays(ctAccApproval,getDur("accToRequest")):"";
                var autoCircTarget=ctc.requestDone?addWorkingDays(ctc.requestDone,getDur("requestToCirculate")):"";
                var autoSignAllTarget=ctc.circulateDone?addWorkingDays(ctc.circulateDone,getDur("circulateToSign")):"";
                var stage=0;
                var nextTarget="";
                if(ctc.signedDone||ctc.signedAllDone){stage=4;}
                else if(ctc.circulateDone){stage=3;nextTarget=ctc.signedAllTarget||autoSignAllTarget;}
                else if(ctc.requestDone){stage=2;nextTarget=ctc.circulateTarget||autoCircTarget;}
                else if(ctAccApproval){stage=1;nextTarget=ctc.requestTarget||autoReqTarget;}
                var ctOverdue=stage<4&&nextTarget&&nextTarget<today();
                return <td key="contract" style={{verticalAlign:"top",minWidth:90}}>
                  <span className={"chip "+CONTRACT_COLORS[stage]} style={{fontSize:10,whiteSpace:"nowrap"}}>{CONTRACT_LABELS_LIST[stage]}</span>
                  {stage<4&&nextTarget&&<div style={{fontSize:9,marginTop:2,color:ctOverdue?"#c62828":"#bbb",fontWeight:ctOverdue?700:400}}>
                    {ctOverdue?"⚠️ ":""}{fmtDate(nextTarget)}
                  </div>}
                </td>;
              }
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
                var totBudget=filtered.filter(function(t){return !t.cancelled;}).reduce(function(s,t){return s+Number(t.budget||0);},0);
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

function ContractorsView({contractors,saveContractors,packages,people,tasks,tenders,apiKey,correspondences,saveCorrespondences,saveT,onNavTender,memory,setMemory}){
  const [roomPickTask,setRoomPickTask]=useState(null);
  var ctrs=contractors||[];
  var tnds=tenders||[];
  var pkgs=packages||[];
  var ppl=people||[];
  var tsks=tasks||[];
  var mem=memory||{};
  const [pkgFilter,setPkgFilter]=useState(mem.pkgFilter||"all");
  const [searchQ,setSearchQ]=useState(mem.searchQ||"");
  const [sortCol,setSortCol]=useState(mem.sortCol||"name");
  const [sortDir,setSortDir]=useState(mem.sortDir||"asc");
  const [selCtr,setSelCtr]=useState(mem.selCtrId?(ctrs.find(function(c){return c.id===mem.selCtrId;})||null):null);
  useEffect(function(){if(setMemory)setMemory({pkgFilter:pkgFilter,searchQ:searchQ,sortCol:sortCol,sortDir:sortDir,selCtrId:selCtr?selCtr.id:null});},[pkgFilter,searchQ,sortCol,sortDir,selCtr]);
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
            onUpdate={function(field,val){saveT(tsks.map(function(x){if(x.id!==t.id)return x;var u=stampModified(Object.assign({},x));if(field&&typeof field==="object"){Object.assign(u,field);}else{u[field]=val;}return u;}));}}
            onDelete={function(){saveT((tsks||[]).filter(function(x){return x.id!==t.id;}));}}
            people={ppl} packages={pkgs} tags={window._ppTags||[]} tenders={tnds} contractors={ctrs}
            zones={window._ppZones||[]} onOpenRooms={function(tk){setRoomPickTask(tk);}}/>;} )}
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
    {roomPickTask&&<BlockedRoomsModal
      zone={roomPickTask.zone}
      rooms={window._ppRooms||[]}
      selected={roomPickTask.blockedRooms||[]}
      onSave={function(sel){saveT((tsks||[]).map(function(x){return x.id!==roomPickTask.id?x:stampModified(Object.assign({},x,{blockedRooms:sel}));}));}}
      onClose={function(){setRoomPickTask(null);}}/>}
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

function calcProcurement(td){

  var matMaxLead = (td.materials||[]).reduce(function(max,mat){
    var d=parseLeadDays(mat.leadTime||"");return d>max?d:max;
  },0);

  var manualLead = Number(td.leadTimeDays||0);
  var LEAD = manualLead>0 ? manualLead : (matMaxLead>0 ? matMaxLead : 30);
  // Where the lead time came from, so the tender sheet can explain the delivery date
  // instead of showing a number nobody can trace.
  var leadSource = manualLead>0 ? "manual" : (matMaxLead>0 ? "material" : "default");
  var leadMaterial = null;
  (td.materials||[]).forEach(function(mat){
    if(!leadMaterial&&parseLeadDays(mat.leadTime||"")===matMaxLead&&matMaxLead>0)leadMaterial=mat;
  });
  var hasSd = td.hasSD||false;
  var sdResubCount = Number(td.sdResubCount||0);

  var accDoneActual = ((td.stepDates||{}).acc||{}).done || "";
  var accSubmittal = accDoneActual || ((td.stepDates||{}).acc||{}).target || "";
  var accApproval = ((td.stepDates||{}).acc||{}).approval||"";
  // contractDone from "Signed contract → Date done" row in the contract section
  var _ct=(td.stepDates||{}).contract||{};
  var contractDone = _ct.signedDone||_ct.signedAllDone||"";

  function addWorkDays(dateStr, days){
    if(!isValidDate(dateStr)) return "";
    var n=Number(days);
    if(!isFinite(n)) return "";
    var d = new Date(dateStr);
    d.setDate(d.getDate()+n);
    return toISO(d);
  }

  // Resolves one gating step to a date: done > future theoretical target > today+7 (grace)
  // when the theoretical target has already passed and nothing is done yet.
  // Used for contract signing, SD approval, and the lead-driving MAR — so the delivery
  // date keeps drifting forward day by day instead of freezing on a missed target.
  function dateOrGrace(done, target){
    if(done) return done;
    var t0 = today();
    if(target && target>=t0) return target;
    return addWorkDays(t0, 7);
  }

  var steps = [];
  var ov=td.procOverrides||{};

  steps.push({key:"accSub", label:"ACC Submittal", date:accSubmittal, done:accDoneActual, duration:null, manual:true, note:accDoneActual?"From 'Date done' of ACC step":"Provisional — from ACC target date (not yet submitted)"});

  var accApprTargetAuto = addWorkDays(accSubmittal, getDur("accApproval"));
  var accApprTarget = ov.accApp||accApprTargetAuto;
  steps.push({key:"accApp", label:"ACC Approval", date:accApprTarget, done:accApproval, duration:14, manual:false, autoDate:accApprTargetAuto, overridden:!!(ov.accApp&&ov.accApp!==accApprTargetAuto)});

  var contractTargetAuto = addWorkDays(accApproval||accApprTarget, getDur("contractSigning"));
  var contractTarget = ov.contract||contractTargetAuto;
  steps.push({key:"contract", label:"Contract Signing", date:contractTarget, done:contractDone, duration:28, manual:false, autoDate:contractTargetAuto, overridden:!!(ov.contract&&ov.contract!==contractTargetAuto)});

  // --- fabStart now driven by max(contract, SD approval, lead MAR) instead of contract alone ---
  var contractBase = dateOrGrace(contractDone, contractTarget);
  var fabStart = contractBase;
  var fabStartSource = "contract";

  var sdBase = "";

  if(hasSd){

    var sdSubDate = td.sdDone||(addWorkDays(contractDone||contractTarget, 14));
    var sdSubTargetAuto = addWorkDays(contractDone||contractTarget, getDur("sdAfterContract"));
    // The SD panel's own Target date takes priority over the computed one — a manual entry there
    // is a commitment, so the whole timeline downstream is rebuilt from it.
    var sdSubTarget = ov.sdSub||td.sdTarget||sdSubTargetAuto;
    steps.push({key:"sdSub", label:"SD Submission", date:sdSubTarget, done:td.sdDone||"", duration:14, manual:false, sd:true, autoDate:sdSubTargetAuto,
      overridden:!!(ov.sdSub&&ov.sdSub!==sdSubTargetAuto),
      fromSdPanel:!ov.sdSub&&!!td.sdTarget});

    var sdAppTargetAuto = addWorkDays(td.sdDone||sdSubTarget, getDur("sdApproval"));
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

    // Grace applies to the normal SD approval step; an open resubmission cascade already
    // pushes lastSdDate forward on its own and is not re-graced here.
    sdBase = dateOrGrace(td.sdApprovalDone, sdAppTarget);
    if(lastSdDate>sdBase) sdBase=lastSdDate;
  }

  var marBase = "";
  if(leadMaterial){
    marBase = dateOrGrace(leadMaterial.marApprovalDone||"", leadMaterial.marTarget||"");
  }

  if(contractBase && contractBase>fabStart){ fabStart=contractBase; fabStartSource="contract"; }
  if(hasSd && sdBase && sdBase>fabStart){ fabStart=sdBase; fabStartSource="sd"; }
  if(marBase && marBase>fabStart){ fabStart=marBase; fabStartSource="material"; }
  // --- end fabStart change ---

  steps.push({key:"fab", label:"Fabrication Launch", date:fabStart, done:"", duration:null, manual:false,
    note:"Lead: "+LEAD+"d — driven by "+fabStartSource});

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
    procStart = toISO(ps);
  }

  return {steps:steps, deliveryDate:deliveryDate, procStart:procStart, margin:margin, totalDays:totalDays, LEAD:LEAD,
    leadSource:leadSource, leadMaterial:leadMaterial?(leadMaterial.name||""):"", fabStart:fabStart, fabStartSource:fabStartSource};
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
          <input type="date" min="1990-01-01" max="2200-12-31" value={ct.startDate||""} onChange={function(e){updateCtField(ctr.id,ct.id,"startDate",e.target.value);}} style={{padding:"4px 8px",fontSize:11}}/>
        </div>
        <div style={{flex:"0 0 140px"}}>
          <label>End date</label>
          <input type="date" min="1990-01-01" max="2200-12-31" value={ct.endDate||""} onChange={function(e){updateCtField(ctr.id,ct.id,"endDate",e.target.value);}} style={{padding:"4px 8px",fontSize:11}}/>
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
        var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
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
                <input type="date" min="1990-01-01" max="2200-12-31" value={subDate} onChange={function(e){updateCtField(ctr.id,ct.id,doc.key+"Date",e.target.value);}} style={{padding:"3px 7px",fontSize:11,border:"1px solid "+doc.color+"55",borderRadius:5}}/>
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
              <input type="date" min="1990-01-01" max="2200-12-31" value={ad.date||""} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,"date",e.target.value);}} style={{width:130,padding:"3px 6px",fontSize:11}}/>
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
                var due14=adDate?(function(){var d=new Date(adDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
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
                  <input type="date" min="1990-01-01" max="2200-12-31" value={adDate} onChange={function(e){updateAdItem(ctr.id,ct.id,"addendums",i,dk+"Date",e.target.value);}} style={{fontSize:10,padding:"2px 4px",border:"1px solid "+dColor+"44",borderRadius:4,width:105}}/>
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
        // if the selected subcontractor has no contract in the new package, clear it
        if(fCtr!=="all"&&newPkg!=="all"){var ctr=(contractors||[]).find(function(c){return c.name===fCtr;});if(ctr&&!(ctr.contracts||[]).some(function(ct){return ct.package===newPkg;}))setFCtr("all");}
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
function PackagesView({tasks,tenders,contractors,packages,people,pkgOwners,pkgSubcontractors,saveTasks,tags,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [openPkg,setOpenPkg]=useState(mem.openPkg!==undefined?mem.openPkg:null);
  const [fOnlyIssues,setFOnlyIssues]=useState(mem.fOnlyIssues||false);
  useEffect(function(){if(setMemory)setMemory({openPkg:openPkg,fOnlyIssues:fOnlyIssues});},[openPkg,fOnlyIssues]);
  var todayStr=today();

  // Build per-package aggregation
  var rows=(packages||[]).map(function(pkg){
    var pkgTenders=(tenders||[]).filter(function(t){return t.package===pkg;});
    var owner=(pkgOwners||{})[pkg]||"";
    var subcontractor=(pkgSubcontractors||{})[pkg]||"";

    // MAR-only stats: validated / total (total = all materials in package's tenders)
    var marTotal=0,marApproved=0;
    pkgTenders.forEach(function(t){
      (t.materials||[]).forEach(function(mat){
        marTotal++;
        var app=mat.marApprovalStatus||"";
        var sub=mat.marStatus||"";
        var st=app==="approved"?"approved":(app?"pending approval":sub);
        if(st==="approved")marApproved++;
      });
    });

    // ITP / WMS submitted vs total tenders in package
    var itpTotal=pkgTenders.length;
    var itpSubmitted=pkgTenders.filter(function(t){return!!((t.stepDates||{}).itp||{}).done;}).length;
    var wmsTotal=pkgTenders.length;
    var wmsSubmitted=pkgTenders.filter(function(t){return!!((t.stepDates||{}).wms||{}).done;}).length;

    // Financials aggregated across the package's tenders
    var budgetTotal=pkgTenders.reduce(function(s,t){return s+(Number(t.budget)||0);},0);
    var budgetTreated=pkgTenders.reduce(function(s,t){return s+(Number(t.accAmountTreated)||0);},0);
    var costTreated=0;
    pkgTenders.forEach(function(t){
      (contractors||[]).forEach(function(ctr){
        (ctr.contracts||[]).forEach(function(ct){
          if(ct.tenderRef===t.id)costTreated+=contractFinancials(ct).certified;
        });
      });
    });
    var varianceTreated=budgetTreated-costTreated;

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
            if(done){var d=new Date(done);d.setDate(d.getDate()+getDur("clientResponse"));if(toISO(d)<todayStr)counts.overdue++;}
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
          if(t.sdDone){var d2=new Date(t.sdDone);d2.setDate(d2.getDate()+getDur("clientResponse"));if(toISO(d2)<todayStr)counts.overdue++;}
        }
      }
    });

    // Open actions for this package
    var pkgActions=(tasks||[]).filter(function(t){return t.package===pkg&&t.status!=="done"&&!t.isInfo;});
    var overdueActions=pkgActions.filter(function(t){return t.due&&t.due<todayStr;}).length;
    var blockingActions=pkgActions.filter(function(t){return(t.tags||[]).includes("Blocking Point");}).length;

    var nextSteps=pkgTenders.map(function(t){return t.nextStep;}).filter(Boolean);

    var hasIssues=overdueActions>0||blockingActions>0||counts.overdue>0||counts.rejected>0;

    return{pkg:pkg,owner:owner,subcontractor:subcontractor,tenders:pkgTenders,steps:steps,minStage:minStage,maxStage:maxStage,CONTRACT_LABELS:CONTRACT_LABELS,counts:counts,marTotal:marTotal,marApproved:marApproved,itpTotal:itpTotal,itpSubmitted:itpSubmitted,wmsTotal:wmsTotal,wmsSubmitted:wmsSubmitted,budgetTotal:budgetTotal,budgetTreated:budgetTreated,costTreated:costTreated,varianceTreated:varianceTreated,actions:pkgActions,overdueActions:overdueActions,blockingActions:blockingActions,nextSteps:nextSteps,hasIssues:hasIssues};
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
            {r.subcontractor&&<div style={{fontSize:10,color:"#1a73e8",fontWeight:600}}>🤝 {r.subcontractor}</div>}
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>MAR</div>
            <div style={{fontSize:12,fontWeight:700,color:r.marTotal===0?"#ccc":r.marApproved===r.marTotal?"#2e7d32":"#f57f17"}}>
              {r.marTotal===0?"—":r.marApproved+"/"+r.marTotal}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>ITP</div>
            <div style={{fontSize:12,fontWeight:700,color:r.itpTotal===0?"#ccc":r.itpSubmitted===r.itpTotal?"#2e7d32":"#f57f17"}}>
              {r.itpTotal===0?"—":r.itpSubmitted+"/"+r.itpTotal}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>WMS</div>
            <div style={{fontSize:12,fontWeight:700,color:r.wmsTotal===0?"#ccc":r.wmsSubmitted===r.wmsTotal?"#2e7d32":"#f57f17"}}>
              {r.wmsTotal===0?"—":r.wmsSubmitted+"/"+r.wmsTotal}
            </div>
          </div>

          <div style={{flex:"0 0 auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:0,minWidth:110}}>
            <div style={{fontSize:9,color:"#aaa",fontWeight:700,textTransform:"uppercase"}}>Budget / Treated</div>
            <div style={{fontSize:11,fontWeight:700}}>{r.budgetTotal>0?r.budgetTotal.toLocaleString():"—"} <span style={{color:"#888",fontWeight:400}}>tot.</span></div>
            <div style={{fontSize:10,color:"#1a73e8"}}>{r.budgetTreated>0?r.budgetTreated.toLocaleString():"—"} bud. tr.</div>
            <div style={{fontSize:10,color:"#2e7d32"}}>{r.costTreated>0?r.costTreated.toLocaleString():"—"} cost tr.</div>
            {r.budgetTreated>0&&<div style={{fontSize:10,fontWeight:700,color:r.varianceTreated<0?"#c62828":"#2e7d32"}}>{r.varianceTreated>0?"+":""}{r.varianceTreated.toLocaleString()} var.</div>}
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

          {r.tenders.length>0&&<div style={{marginTop:12}}>
            <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:4}}>Tenders</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {r.tenders.map(function(t){
                return <button key={t.id} className="btn btn-sm" onClick={function(){if(onNavTender)onNavTender(t.id,"packages");}} style={{fontSize:11}}>📑 {t.title}</button>;
              })}
            </div>
          </div>}
        </div>}
      </div>;
    })}
  </div>;
}

function buildTrackedDocs(tasks,tenders,contractors){
  var docs=[];
  var todayStr=today();

  (tasks||[]).forEach(function(t){
    var isRfi=(t.tags||[]).includes("RFI");
    var isFcr=(t.tags||[]).includes("FCR");
    if(!isRfi&&!isFcr)return;
    var stageKey=isFcr?"fcr":"rfi";
    var stageLbl=isFcr?"FCR":"RFI";
    var tdr=(tenders||[]).find(function(x){return x.id===t.tenderRef;})||null;
    var submitted=t.rfiSubmission||"";
    var due=t.rfiDue||(submitted?(function(){var d=new Date(submitted);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"");
    var overdue=due&&due<todayStr&&t.status!=="done";
    var withClient=!!submitted&&t.status!=="done";
    docs.push({
      id:t.id,stage:stageKey,stageLabel:stageLbl,
      text:t.text,owner:t.owner||"",
      package:t.package||"",
      tenderRef:t.tenderRef||"",tenderTitle:tdr?tdr.title:"",
      submissionDate:submitted,dueDate:due,
      status:t.status,overdue:overdue,withClient:withClient,
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
        var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
        var overdue=status!=="approved"&&!!due14&&due14<todayStr;
        var withClient=!!subDate&&status!=="approved";
        docs.push({
          id:ct.id+"_"+docType.dk,stage:docType.key,stageLabel:docType.label,
          text:ctr.name+(ct.number?" — "+ct.number:"")+" ("+docType.label+")",
          owner:ct.owner||ctr.owner||"",package:ct.package||ctr.package||"",
          tenderRef:ct.tenderRef||"",tenderTitle:"",submissionDate:subDate,
          dueDate:due14,targetDate:subDate,overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
          stepStatus:status,_type:"contract"
        });
      });
      (ct.addendums||[]).forEach(function(ad){
        [{key:"contract_acc",label:"Add. ACC",dk:"acc"},{key:"contract_aconex",label:"Add. ACONEX",dk:"aconex"}].forEach(function(docType){
          var status=ad[docType.dk+"Status"]||"";
          var subDate=ad[docType.dk+"Date"]||"";
          if(!subDate&&!status)return;
          var due14=subDate?(function(){var d=new Date(subDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
          var overdue=status!=="approved"&&!!due14&&due14<todayStr;
          var withClient=!!subDate&&status!=="approved";
          docs.push({
            id:ct.id+"_add_"+ad.id+"_"+docType.dk,stage:docType.key,stageLabel:"Addum. "+docType.label.split(" ")[1],
            text:ctr.name+(ct.number?" C"+ct.number:"")+(ad.number?" Add."+ad.number:"")+" ("+docType.label.split(" ")[1]+")",
            owner:ct.owner||ctr.owner||"",package:ct.package||ctr.package||"",
            tenderRef:ct.tenderRef||"",tenderTitle:"",submissionDate:subDate,
            dueDate:due14,targetDate:subDate,overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
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
    var due14=(function(){var d=new Date(subDone);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}());
    var overdue=appStatus!=="approved"&&!appDone&&due14<todayStr;
    var withClient=appStatus!=="approved"&&!appDone;
    docs.push({
      id:td.id+"_sd",stage:"sd_approval",stageLabel:"SD Approval",
      text:td.title+" — SD Approval",
      owner:td.ownerTender||"",package:td.package||"",
      tenderRef:td.id,tenderTitle:td.title,
      submissionDate:subDone,dueDate:due14,targetDate:subDone,
      overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
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

      var dueDateFromDone=doneDate?(function(){var d=new Date(doneDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";
      var dueDateFromTarget=targetDate?(function(){var d=new Date(targetDate);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}()):"";

      var effectiveDue=doneDate?dueDateFromDone:dueDateFromTarget;
      var effectiveSubmission=doneDate||"";
      if(!effectiveDue)return;
      var overdue=(doneDate?!isApprovalDone:!isDone)&&effectiveDue<todayStr;
      var withClient=!!doneDate&&!isApprovalDone&&!isApproved;
      var daysOverdue=overdue?workingDaysDiff(effectiveDue,todayStr):0;
      docs.push({
        id:td.id+"_"+step,stage:step,stageLabel:STEP_LABELS[step],
        text:td.title+" — "+STEP_LABELS[step],
        owner:td.ownerTender||"",
        package:td.package||"",
        tenderRef:td.id,tenderTitle:td.title,
        submissionDate:effectiveSubmission||doneDate||"",dueDate:effectiveDue,targetDate:targetDate,
        status:isDone?"done":"pending",overdue:overdue,withClient:withClient,
        daysOverdue:daysOverdue,
        stepStatus:stepStatus,
        _tenderId:td.id,_step:step,_type:"tender"
      });
    });
  });

  (tenders||[]).forEach(function(td){
    (td.materials||[]).forEach(function(mat){
      [{type:"mss",label:"MSS"},{type:"mar",label:"MAR"}].forEach(function(m){
        var status=mat[m.type+"Status"]||"";
        var approvalStatus=mat[m.type+"ApprovalStatus"]||"";
        var done=mat[m.type+"Done"]||"";
        var target=mat[m.type+"Target"]||"";
        var isSubmittedPhase=(status==="submitted"||status==="pending approval"||approvalStatus==="pending approval");
        if(!isSubmittedPhase||!done)return;
        var due14=(function(){var d=new Date(done);d.setDate(d.getDate()+getDur("clientResponse"));return toISO(d);}());
        var overdue=approvalStatus!=="approved"&&due14<todayStr;
        var withClient=approvalStatus!=="approved";
        docs.push({
          id:td.id+"_"+mat.id+"_"+m.type,
          stage:m.type,stageLabel:m.label+" Approval",
          text:td.title+" — "+m.label+": "+(mat.name||"—"),
          owner:td.ownerTender||"",package:td.package||"",
          tenderRef:td.id,tenderTitle:td.title,
          submissionDate:done,dueDate:due14,targetDate:target,
          overdue:overdue,withClient:withClient,daysOverdue:overdue?workingDaysDiff(due14,todayStr):0,
          stepStatus:approvalStatus||"Pending approval",_type:"material"
        });
      });
    });
  });

  return docs;
}

function ClientSubmissionsView({tasks,tenders,contractors,packages,people,saveTasks,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [fTender,setFTender]=useState(mem.fTender||"all");
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fOwner,setFOwner]=useState(mem.fOwner||"all");
  const [fStage,setFStage]=useState(mem.fStage||"all");
  const [fScope,setFScope]=useState(mem.fScope||"overdue");
  useEffect(function(){if(setMemory)setMemory({fTender:fTender,fPkg:fPkg,fOwner:fOwner,fStage:fStage,fScope:fScope});},[fTender,fPkg,fOwner,fStage,fScope]);

  var STAGES=[
    {key:"acc",label:"Tender",color:"#1a73e8",bg:"#dce8ff"},
    {key:"mar",label:"MAR",color:"#6a1b9a",bg:"#f3e5f5"},
    {key:"mss",label:"MSS",color:"#1565c0",bg:"#e3f2fd"},
    {key:"wms",label:"WMS",color:"#00838f",bg:"#e0f7fa"},
    {key:"itp",label:"ITP",color:"#2e7d32",bg:"#e8f5e9"}
  ];

  // This view answers one question: what is sitting on the client's desk right now.
  // Only the five document types that go for approval, and only while they are submitted
  // and still unanswered.
  var PENDING_STAGES=["mar","mss","wms","itp","acc"];
  var allDocs=buildTrackedDocs(tasks,tenders,contractors).filter(function(d){
    return PENDING_STAGES.indexOf(d.stage)>=0&&d.withClient;
  });
  var withClient=allDocs;

  var filtered=allDocs.filter(function(d){
    if(fScope==="overdue"&&!d.overdue)return false;
    if(fScope==="withclient"&&!d.withClient)return false;
    if(fTender!=="all"&&d.tenderRef!==fTender)return false;
    if(fPkg!=="all"&&d.package!==fPkg)return false;
    if(fOwner!=="all"&&d.owner!==fOwner)return false;
    if(fStage!=="all"&&d.stage!==fStage)return false;
    return true;
  }).sort(function(a,b){
    if(a.overdue&&!b.overdue)return -1;
    if(!a.overdue&&b.overdue)return 1;
    return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
  });

  var overdueCount=allDocs.filter(function(d){return d.overdue;}).length;
  var allOwners=[...new Set(allDocs.map(function(d){return d.owner;}).filter(Boolean))].sort();
  var allTenders=[...new Set(allDocs.map(function(d){return d.tenderRef;}).filter(Boolean))].map(function(id){return(tenders||[]).find(function(t){return t.id===id;});}).filter(Boolean);

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">📬 Client Follow-up</div>
        <div className="page-sub">Everything currently with the client — RFI, FCR, ACC/ACONEX, MAR, MSS, ITP, WMS, SD, Contract docs</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {overdueCount>0&&<div style={{padding:"8px 16px",background:"#fce4ec",border:"1.5px solid #f5c6cb",borderRadius:10,color:"#c62828",fontWeight:700,fontSize:13}}>⚠️ {overdueCount} overdue</div>}
        <div style={{padding:"8px 16px",background:"#e3f2fd",border:"1.5px solid #90caf9",borderRadius:10,color:"#1565c0",fontWeight:700,fontSize:13}}>📬 {withClient.length} with client</div>
      </div>
    </div>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <button className={"fchip"+(fScope==="overdue"?" on":"")} onClick={function(){setFScope("overdue");}} style={fScope==="overdue"?{borderColor:"#c62828",background:"#c62828",color:"#fff"}:{}}>⚠️ Overdue</button>
      <button className={"fchip"+(fScope==="withclient"?" on":"")} onClick={function(){setFScope("withclient");}} style={fScope==="withclient"?{borderColor:"#1565c0",background:"#1565c0",color:"#fff"}:{}}>📬 With client</button>
      <button className={"fchip"+(fScope==="all"?" on":"")} onClick={function(){setFScope("all");}}>All</button>
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
        {allTenders.sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
      </select>
      <select value={fOwner} onChange={function(e){setFOwner(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All owners</option>
        {allOwners.map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
      </select>
      {(fTender!=="all"||fPkg!=="all"||fOwner!=="all"||fStage!=="all"||fScope!=="overdue")&&
        <button className="btn btn-sm" onClick={function(){setFTender("all");setFPkg("all");setFOwner("all");setFStage("all");setFScope("overdue");}}>✕ Reset</button>}
    </div>

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">✅</div><div className="empty-txt">Nothing currently pending with the client.</div></div>
      :<div>
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {STAGES.map(function(s){
            var cnt=withClient.filter(function(d){return d.stage===s.key;}).length;
            if(cnt===0)return null;
            return <div key={s.key} onClick={function(){setFStage(s.key);}} style={{padding:"6px 12px",borderRadius:8,background:s.bg,border:"1.5px solid "+s.color,cursor:"pointer",display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:13,color:s.color}}>{cnt}</span>
              <span style={{fontSize:11,color:s.color}}>{s.label}</span>
            </div>;
          })}
        </div>
        <div style={{background:"#fff",borderRadius:12,border:"1px solid #ede9e3",overflow:"hidden"}}>
          <table className="tbl" style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>
                <th>Stage</th><th>Item</th><th>Tender</th><th>Package</th><th>Owner</th>
                <th>Submitted</th><th>Response due (+14d)</th><th>Days pending</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(d){
                var stage=STAGES.find(function(s){return s.key===d.stage;})||{color:"#888",bg:"#f5f5f5",label:d.stage};
                var daysPending=d.submissionDate?workingDaysDiff(d.submissionDate,today()):0;
                return <tr key={d.id} style={{background:d.overdue?"#fffaf9":"#fff"}}>
                  <td><span style={{padding:"2px 8px",borderRadius:8,background:stage.bg,color:stage.color,fontWeight:700,fontSize:11}}>{stage.label}</span></td>
                  <td style={{maxWidth:280}}>
                    <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:d.tenderRef?"pointer":"default",color:d.tenderRef?"#1a1a1a":"#555"}} onClick={function(){if(d.tenderRef&&onNavTender)onNavTender(d.tenderRef,"submissions");}}>{d.text}</div>
                  </td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.tenderTitle&&d.tenderRef?<button onClick={function(){if(onNavTender)onNavTender(d.tenderRef,"submissions");}} style={{background:"none",border:"none",cursor:"pointer",color:"#3949ab",fontSize:11,fontWeight:500,textDecoration:"underline",padding:0,fontFamily:"inherit"}}>{d.tenderTitle}</button>:<span style={{color:"#888"}}>{d.tenderTitle||"—"}</span>}</td>
                  <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{d.package||"—"}</td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.owner?(d.owner.split(",")[0]):"—"}</td>
                  <td style={{fontSize:11,whiteSpace:"nowrap"}}>{d.submissionDate?fmtDate(d.submissionDate):"—"}</td>
                  <td style={{fontSize:11,fontWeight:d.overdue?700:400,color:d.overdue?"#c62828":"#555",whiteSpace:"nowrap"}}>{d.dueDate?fmtDate(d.dueDate):"—"}</td>
                  <td style={{textAlign:"center"}}>{d.overdue?<span style={{fontWeight:700,color:"#c62828",fontSize:12}}>⚠️ +{d.daysOverdue}d</span>:<span style={{fontSize:11,color:"#888"}}>{daysPending}d</span>}</td>
                  <td><span style={{fontSize:11,padding:"2px 7px",borderRadius:8,background:"#fff8e1",color:"#f57f17",fontWeight:600}}>{d.stepStatus||d.status||"Pending"}</span></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>}
  </div>;
}

// Cross-tender view of the two quality documents. Same shape as Materials: one row per
// document per tender, so the whole project can be swept in one screen.
// ---------------------------------------------------------------------------
// Action timeline — a horizontal frieze.
// Weeks run left to right; each lane is an owner, a tender or a zone. An action sits on
// its due date. The point is to see collisions: three blocking points landing on the same
// person in the same week is invisible in a list and obvious here.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Minutes of meeting.
// Mirrors the Word template: a header block, a participants table, then numbered
// sections each holding items with an action owner, a due date and a status.
// An item can be pushed into the app's action list, and stays linked to the MoM.
// ---------------------------------------------------------------------------
function QualityDocsView({tenders,packages,saveTenders,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fKind,setFKind]=useState(mem.fKind||"all");
  const [fStatus,setFStatus]=useState(mem.fStatus||"all");
  const [q,setQ]=useState(mem.q||"");
  useEffect(function(){if(setMemory)setMemory({fPkg:fPkg,fKind:fKind,fStatus:fStatus,q:q});},[fPkg,fKind,fStatus,q]);

  var rows=[];
  (tenders||[]).forEach(function(td){
    var theo=theoreticalDates(td);
    ["wms","itp"].forEach(function(k){
      var d=(td.stepDates||{})[k]||{};
      var st=(td.steps||{})[k]||"";
      var approvalStatus=d.approvalStatus||"";
      var eff=isApprovedStatus(approvalStatus)?"approved"
             :/reject|not approved/i.test(approvalStatus)?"rejected"
             :d.done?"submitted"
             :(d.target||theo[k].theoretical)?"planned":"none";
      rows.push({td:td,kind:k.toUpperCase(),key:k,dates:d,status:st,
        approvalStatus:approvalStatus,theoretical:theo[k].theoretical,eff:eff});
    });
  });

  var todayS=today();
  var shown=rows.filter(function(r){
    if(fPkg!=="all"&&(r.td.package||"")!==fPkg)return false;
    if(fKind!=="all"&&r.kind!==fKind)return false;
    if(fStatus==="overdue"){
      var due=r.dates.target||r.theoretical;
      if(!(due&&due<todayS&&!r.dates.done))return false;
    }else if(fStatus!=="all"&&r.eff!==fStatus)return false;
    if(q.trim()){
      var hay=((r.td.title||"")+" "+(r.td.package||"")+" "+r.kind).toLowerCase();
      if(hay.indexOf(q.trim().toLowerCase())<0)return false;
    }
    return true;
  }).sort(function(a,b){
    var da=a.dates.target||a.theoretical||"9999";
    var db=b.dates.target||b.theoretical||"9999";
    return da.localeCompare(db);
  });

  var overdue=rows.filter(function(r){var due=r.dates.target||r.theoretical;return due&&due<todayS&&!r.dates.done;}).length;
  var missing=rows.filter(function(r){return r.eff==="none";}).length;

  function upd(tdId,key,field,val){
    var d=(tenders||[]).map(function(t){
      if(t.id!==tdId)return t;
      var sd=Object.assign({},t.stepDates||{});
      sd[key]=Object.assign({},sd[key]||{},{[field]:val});
      var steps=Object.assign({},t.steps||{});
      if(field==="approvalStatus"&&isApprovedStatus(val))steps[key]=val;
      return Object.assign({},t,{stepDates:sd,steps:steps});
    });
    saveTenders(d);
  }

  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">🛡️ WMS &amp; ITP</div>
        <div className="page-sub">Method statements and inspection plans across every tender · {rows.length} documents</div>
      </div>
    </div>

    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      {[{n:overdue,l:"overdue",c:"#c62828",bg:"#fce4ec"},
        {n:missing,l:"no date at all",c:"#f57f17",bg:"#fff8e1"},
        {n:rows.filter(function(r){return r.eff==="approved";}).length,l:"approved",c:"#2e7d32",bg:"#e8f5e9"}].map(function(k){
        return <div key={k.l} style={{padding:"8px 14px",borderRadius:10,background:k.bg,border:"1.5px solid "+k.c+"33"}}>
          <div style={{fontSize:19,fontWeight:800,color:k.c,lineHeight:1}}>{k.n}</div>
          <div style={{fontSize:10,color:k.c,fontWeight:600}}>{k.l}</div>
        </div>;
      })}
    </div>

    <div className="filter-bar">
      <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{width:"auto",fontSize:11,padding:"4px 8px"}}>
        <option value="all">All packages</option>
        {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      {["all","WMS","ITP"].map(function(k){
        return <button key={k} className={"fchip"+(fKind===k?" on":"")} onClick={function(){setFKind(k);}}>{k==="all"?"Both":k}</button>;
      })}
      {[["all","All"],["overdue","⚠️ Overdue"],["none","No date"],["planned","Planned"],["submitted","Submitted"],["approved","Approved"],["rejected","Rejected"]].map(function(o){
        return <button key={o[0]} className={"fchip"+(fStatus===o[0]?" on gold":"")} onClick={function(){setFStatus(o[0]);}}>{o[1]}</button>;
      })}
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔎 Search tender…" style={{width:190,padding:"4px 9px",fontSize:11}}/>
    </div>

    {shown.length===0
      ?<div className="empty"><div className="empty-ico">🛡️</div><div className="empty-txt">Nothing matches these filters.</div></div>
      :<table className="tbl">
        <thead><tr>
          <th>Tender</th><th>Package</th><th style={{width:64}}>Doc</th>
          <th style={{textAlign:"center"}}>Theoretical</th>
          <th style={{textAlign:"center"}}>Target</th>
          <th style={{textAlign:"center"}}>Done</th>
          <th style={{minWidth:100}}>Reference</th>
          <th style={{minWidth:150}}>Approval status</th>
        </tr></thead>
        <tbody>{shown.map(function(r){
          var due=r.dates.target||r.theoretical;
          var late=due&&due<todayS&&!r.dates.done;
          return <tr key={r.td.id+r.key}>
            <td><span onClick={function(){if(onNavTender)onNavTender(r.td.id);}} style={{color:"#1a73e8",cursor:"pointer",fontWeight:600,fontSize:12}}>{r.td.title}</span></td>
            <td style={{fontSize:11,color:"#888"}}>{r.td.package||"—"}</td>
            <td><span className="badge" style={{background:r.kind==="WMS"?"#e8f0fe":"#f3e5f5",color:r.kind==="WMS"?"#1a73e8":"#7b1fa2"}}>{r.kind}</span></td>
            <td style={{textAlign:"center",fontSize:11,color:"#8b8578"}}>{r.theoretical?fmtDate(r.theoretical):<span style={{color:"#ddd"}} title="No start on site — link a schedule task to this tender">—</span>}</td>
            <td style={{textAlign:"center"}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={r.dates.target||""} onChange={function(e){upd(r.td.id,r.key,"target",e.target.value);}}
                style={{border:"1px solid "+(late?"#f48fb1":"#e8e6df"),borderRadius:5,padding:"3px 6px",fontSize:11,background:late?"#fff5f7":"#fff"}}/>
            </td>
            <td style={{textAlign:"center"}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={r.dates.done||""} onChange={function(e){upd(r.td.id,r.key,"done",e.target.value);}}
                style={{border:"1px solid #e8e6df",borderRadius:5,padding:"3px 6px",fontSize:11}}/>
            </td>
            <td>
              <input type="text" value={r.dates.reference||""} onChange={function(e){upd(r.td.id,r.key,"reference",e.target.value);}}
                placeholder="Ref…" style={{fontFamily:"var(--font-mono)",fontSize:11,padding:"4px 6px"}}/>
            </td>
            <td>
              <select value={r.approvalStatus||""} onChange={function(e){upd(r.td.id,r.key,"approvalStatus",e.target.value);}}
                style={{width:"100%",border:"1px solid #e8e6df",borderRadius:5,padding:"3px 5px",fontSize:10,fontFamily:"inherit",fontWeight:700,
                  color:isApprovedStatus(r.approvalStatus)?"#2e7d32":/reject|not approved/i.test(r.approvalStatus)?"#c62828":"#888"}}>
                {APPROVAL_OPTS.map(function(o){return <option key={o} value={o}>{o}</option>;})}
              </select>
            </td>
          </tr>;
        })}</tbody>
      </table>}
  </div>;
}

function MaterialsView({tenders,packages,people,saveTenders,onNavTender,memory,setMemory,tasks}){
  function docActionStats(tdId,matId,kind){
    var ref=tdId+"::"+matId+"::"+kind.toLowerCase();
    var acts=(tasks||[]).filter(function(t){return t.materialDocRef===ref&&t.status!=="done";});
    var late=acts.filter(function(t){return t.due&&t.due<today();}).length;
    return{n:acts.length,late:late};
  }
  var mem=memory||{};
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fTender,setFTender]=useState(mem.fTender||"all");
  const [fStatus,setFStatus]=useState(mem.fStatus||"all");
  const [q,setQ]=useState(mem.q||"");
  useEffect(function(){if(setMemory)setMemory({fPkg:fPkg,fTender:fTender,fStatus:fStatus,q:q});},[fPkg,fTender,fStatus,q]);

  var CYCLE_LABELS={"":"—","under preparation":"Under prep.","submitted":"Submitted","pending approval":"Pending appr.","approved":"✅ Approved","rejected":"❌ Rejected"};
  function effStatus(mat,kind){
    var k=kind.toLowerCase();
    var app=mat[k+"ApprovalStatus"]||"";
    var sub=mat[k+"Status"]||"";
    if(app==="approved")return"approved";
    if(app&&app!=="")return"pending approval";
    return sub;
  }
  function statusColor(st){
    if(st==="approved")return"#2e7d32";
    if(st==="rejected")return"#c62828";
    if(st==="pending approval"||st==="submitted")return"#f57f17";
    if(st==="under preparation")return"#1a73e8";
    return"#bbb";
  }

  var rows=[];
  (tenders||[]).forEach(function(td){
    if(fPkg!=="all"&&td.package!==fPkg)return;
    if(fTender!=="all"&&td.id!==fTender)return;
    (td.materials||[]).forEach(function(mat,mi){
      rows.push({td:td,mat:mat,mi:mi});
    });
  });

  var filtered=rows.filter(function(r){
    if(q){var lq=q.toLowerCase();if(!(r.mat.name||"").toLowerCase().includes(lq)&&!(r.td.title||"").toLowerCase().includes(lq))return false;}
    if(fStatus!=="all"){
      var mssSt=effStatus(r.mat,"MSS");var marSt=effStatus(r.mat,"MAR");
      if(fStatus!==mssSt&&fStatus!==marSt)return false;
    }
    return true;
  });

  function updMat(td,mi,field,val){
    var ms=(td.materials||[]).map(function(m,j){return j!==mi?m:Object.assign({},m,{[field]:val});});
    var d=(tenders||[]).map(function(t){return t.id!==td.id?t:Object.assign({},t,{materials:ms});});
    saveTenders(d);
  }

  var allPkgTenders=(tenders||[]).filter(function(t){return fPkg==="all"||t.package===fPkg;});

  const [showAddModal,setShowAddModal]=useState(false);
  const [addTenderId,setAddTenderId]=useState("");

  function addMaterial(tenderId){
    var t=(tenders||[]).find(function(x){return x.id===tenderId;});
    if(!t)return;
    var newMat={id:uuid(),name:"",specified:"",proposed:"",leadTime:"",
      mssStatus:"",mssTarget:"",mssDone:"",mssApprovalStatus:"",mssApprovalTarget:"",mssApprovalDone:"",mssReview:"",mssLink:"",mssLinkLabel:"",mssNumber:"",
      marStatus:"",marTarget:"",marDone:"",marApprovalStatus:"",marApprovalTarget:"",marApprovalDone:"",marReview:"",marLink:"",marLinkLabel:"",marNumber:"",
      hasPO:false,poNumber:"",poStatus:""};
    var ms=[...(t.materials||[]),newMat];
    var d=(tenders||[]).map(function(x){return x.id!==tenderId?x:Object.assign({},x,{materials:ms});});
    saveTenders(d);
    setShowAddModal(false);
    setAddTenderId("");
  }

  function handleAddClick(){
    if(fTender!=="all"){addMaterial(fTender);}
    else{setShowAddModal(true);}
  }

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    <div className="page-hdr">
      <div>
        <div className="page-title">🏗️ Materials</div>
        <div className="page-sub">{filtered.length} materials across {new Set(filtered.map(function(r){return r.td.id;})).size} tenders — MSS/MAR status at a glance</div>
      </div>
      <button className="btn btn-gold" onClick={handleAddClick}>＋ Add Material</button>
    </div>

    {showAddModal&&<div className="overlay" onClick={function(e){if(e.target===e.currentTarget){setShowAddModal(false);setAddTenderId("");}}}>
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-hdr">
          <div className="modal-title">＋ Add Material</div>
          <button onClick={function(){setShowAddModal(false);setAddTenderId("");}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
        </div>
        <div className="modal-body">
          <div className="fg">
            <label>Tender</label>
            <select value={addTenderId} onChange={function(e){setAddTenderId(e.target.value);}} autoFocus>
              <option value="">— select a tender —</option>
              {allPkgTenders.slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}{t.package?" ("+t.package+")":""}</option>;})}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={function(){setShowAddModal(false);setAddTenderId("");}}>Cancel</button>
          <button className="btn btn-pri" disabled={!addTenderId} onClick={function(){addMaterial(addTenderId);}}>＋ Add Material</button>
        </div>
      </div>
    </div>}

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 Search material, tender…" style={{width:200,padding:"5px 10px",fontSize:12}}/>
      <select value={fPkg} onChange={function(e){setFPkg(e.target.value);if(fTender!=="all"){var t=(tenders||[]).find(function(x){return x.id===fTender;});if(t&&t.package!==e.target.value)setFTender("all");}}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All packages</option>
        {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
      </select>
      <select value={fTender} onChange={function(e){setFTender(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All tenders</option>
        {allPkgTenders.slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
      </select>
      <select value={fStatus} onChange={function(e){setFStatus(e.target.value);}} style={{padding:"5px 10px",fontSize:12,border:"1px solid #e8e6df",borderRadius:8,fontFamily:"inherit"}}>
        <option value="all">All statuses</option>
        {Object.keys(CYCLE_LABELS).filter(Boolean).map(function(k){return <option key={k} value={k}>{CYCLE_LABELS[k]}</option>;})}
      </select>
      {(fPkg!=="all"||fTender!=="all"||fStatus!=="all"||q)&&
        <button className="btn btn-sm" onClick={function(){setFPkg("all");setFTender("all");setFStatus("all");setQ("");}}>✕ Reset</button>}
    </div>

    {filtered.length===0
      ?<div className="empty"><div className="empty-ico">🏗️</div><div className="empty-txt">No materials found.</div></div>
      :<div style={{background:"#fff",borderRadius:12,border:"1px solid #ede9e3",overflow:"hidden"}}>
        <table className="tbl" style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <th>Tender</th><th>Package</th><th>Material</th><th>Lead time</th>
              <th>MSS Status</th><th>MSS Target</th><th style={{textAlign:"center"}}>MSS Act.</th>
              <th>MAR Status</th><th>MAR Target</th><th style={{textAlign:"center"}}>MAR Act.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(function(r,idx){
              var mssSt=effStatus(r.mat,"MSS");
              var marSt=effStatus(r.mat,"MAR");
              return <tr key={r.td.id+"_"+r.mi}>
                <td style={{fontSize:11,whiteSpace:"nowrap"}}>
                  <button onClick={function(){if(onNavTender)onNavTender(r.td.id,"materials");}} style={{background:"none",border:"none",cursor:"pointer",color:"#3949ab",fontSize:11,fontWeight:500,textDecoration:"underline",padding:0,fontFamily:"inherit"}}>{r.td.title}</button>
                </td>
                <td style={{fontSize:11,color:"#888"}}>{r.td.package||"—"}</td>
                <td style={{minWidth:140}}>
                  <input type="text" value={r.mat.name||""} onChange={function(e){updMat(r.td,r.mi,"name",e.target.value);}} placeholder="Material name" style={{width:"100%",padding:"3px 6px",fontSize:11,border:"1px solid #e8e6df",borderRadius:4,fontWeight:600,boxSizing:"border-box"}}/>
                </td>
                <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{r.mat.leadTime||"—"}</td>
                <td>
                  <select value={mssSt} onChange={function(e){
                    var val=e.target.value;
                    var updates={mssStatus:val};
                    if(val==="approved")updates.mssApprovalStatus="approved";
                    else if(val==="pending approval")updates.mssApprovalStatus="pending approval";
                    else updates.mssApprovalStatus="";
                    var ms=(r.td.materials||[]).map(function(m,j){return j!==r.mi?m:Object.assign({},m,updates);});
                    var d=(tenders||[]).map(function(t){return t.id!==r.td.id?t:Object.assign({},t,{materials:ms});});
                    saveTenders(d);
                  }} style={{fontSize:10,padding:"3px 5px",border:"1.5px solid "+statusColor(mssSt)+"66",borderRadius:5,fontFamily:"inherit",fontWeight:700,color:statusColor(mssSt)}}>
                    {Object.keys(CYCLE_LABELS).map(function(k){return <option key={k} value={k}>{CYCLE_LABELS[k]}</option>;})}
                  </select>
                </td>
                <td><input type="date" min="1990-01-01" max="2200-12-31" value={r.mat.mssTarget||""} onChange={function(e){updMat(r.td,r.mi,"mssTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #e8e6df",borderRadius:4}}/></td>
                <td style={{textAlign:"center"}}>{(function(){var s=docActionStats(r.td.id,r.mat.id,"MSS");return s.n===0?<span style={{color:"#ddd",fontSize:10}}>—</span>:<span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:8,background:s.late>0?"#fce4ec":"#f0ede6",color:s.late>0?"#c62828":"#666"}}>⚑ {s.n}{s.late>0?" ⚠":""}</span>;})()}</td>
                <td>
                  <select value={marSt} onChange={function(e){
                    var val=e.target.value;
                    var updates={marStatus:val};
                    if(val==="approved")updates.marApprovalStatus="approved";
                    else if(val==="pending approval")updates.marApprovalStatus="pending approval";
                    else updates.marApprovalStatus="";
                    var ms=(r.td.materials||[]).map(function(m,j){return j!==r.mi?m:Object.assign({},m,updates);});
                    var d=(tenders||[]).map(function(t){return t.id!==r.td.id?t:Object.assign({},t,{materials:ms});});
                    saveTenders(d);
                  }} style={{fontSize:10,padding:"3px 5px",border:"1.5px solid "+statusColor(marSt)+"66",borderRadius:5,fontFamily:"inherit",fontWeight:700,color:statusColor(marSt)}}>
                    {Object.keys(CYCLE_LABELS).map(function(k){return <option key={k} value={k}>{CYCLE_LABELS[k]}</option>;})}
                  </select>
                </td>
                <td><input type="date" min="1990-01-01" max="2200-12-31" value={r.mat.marTarget||""} onChange={function(e){updMat(r.td,r.mi,"marTarget",e.target.value);}} style={{fontSize:10,padding:"2px 5px",border:"1px solid #e8e6df",borderRadius:4}}/></td>
                <td style={{textAlign:"center"}}>{(function(){var s=docActionStats(r.td.id,r.mat.id,"MAR");return s.n===0?<span style={{color:"#ddd",fontSize:10}}>—</span>:<span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:8,background:s.late>0?"#fce4ec":"#f0ede6",color:s.late>0?"#c62828":"#666"}}>⚑ {s.n}{s.late>0?" ⚠":""}</span>;})()}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
  </div>;
}

