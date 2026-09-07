// ===========================================================================
// app-schedule.js — The zone planning grid: rows, critical path, documents, printing, mobile view.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

function newScheduleDoc(overrides){
  return Object.assign({
    id:uuid(),title:"",url:"",kind:"Setting-out plan",roomId:"",
    updatedAt:today(),addedBy:window._currentUser?window._currentUser.name:""
  },overrides||{});
}
const DOC_KINDS=["Setting-out plan","Section / elevation","Detail","Method statement","Survey","Other"];
function isSafeDocUrl(u){
  var v=String(u||"").trim();
  return /^https?:\/\//i.test(v);            // never open javascript: or data: from a shared field
}
function openDoc(url){
  if(!isSafeDocUrl(url)){safeAlert("This link is not a valid web address.\n\nIt must start with http:// or https:// — copy it from the address bar of the document in SharePoint.");return;}
  window.open(url,"_blank","noopener,noreferrer");
}
function newScheduleRow(kind,label){return{id:uuid(),kind:kind||"task",label:label||"",cells:{},afterId:"",lagWeeks:0,roomId:"",progress:"",weekProgress:{},group:"",startWeek:"",endWeek:"",qty:"",unit:"",tenderRef:""};}
function scheduleWeeks(sc){
  if(!sc.startDate)return[];
  var start=new Date(sc.startDate);
  var dow=start.getDay();
  var monday=new Date(start);monday.setDate(start.getDate()-(dow===0?6:dow-1));
  var out=[];
  var n=Math.max(1,Math.min(52,Number(sc.weeks)||12));
  for(var i=0;i<n;i++){
    var m=new Date(monday);m.setDate(monday.getDate()+i*7);
    out.push(toISO(m));
  }
  return out;
}
// A meeting records attendance for one lookahead session in one zone.
// attendance = {"LASTNAME, First":"present"|"absent"|"excused"}
const SCHED_PALETTE=[
  {hex:"#c9a84c",name:"Gold"},      {hex:"#2e7d32",name:"Green"},
  {hex:"#7b1fa2",name:"Purple"},    {hex:"#00838f",name:"Teal"},
  {hex:"#e65100",name:"Orange"},    {hex:"#5d4037",name:"Brown"},
  {hex:"#c2185b",name:"Pink"},      {hex:"#455a64",name:"Slate"},
  {hex:"#f9a825",name:"Amber"},     {hex:"#6d4c41",name:"Cocoa"},
  {hex:"#827717",name:"Olive"},     {hex:"#4527a0",name:"Indigo"},
  {hex:"#ad1457",name:"Magenta"},   {hex:"#00695c",name:"Emerald"},
  {hex:"#bf360c",name:"Rust"},      {hex:"#37474f",name:"Graphite"}
];
function paletteName(hex){var f=SCHED_PALETTE.find(function(c){return c.hex===hex;});return f?f.name:hex;}

// Which tender a schedule row should belong to, given the rules.
// A rule scoped to one zone beats an "all zones" rule, so a general default can be set
// once and overridden where a zone works differently.
function BlockedRoomsModal({zone,rooms,selected,onSave,onClose}){
  var zoneRooms=(rooms||[]).filter(function(r){return r.zone===zone;});
  var isAll=selected==="all";
  var selArr=Array.isArray(selected)?selected:[];
  const [sel,setSel]=useState(isAll?"all":selArr);

  function toggleAll(){setSel(sel==="all"?[]:"all");}
  function toggleRoom(rid){
    if(sel==="all")return;
    setSel(function(prev){return prev.includes(rid)?prev.filter(function(x){return x!==rid;}):[...prev,rid];});
  }

  return <div className="overlay" onClick={function(e){if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxWidth:420}}>
      <div className="modal-hdr">
        <div className="modal-title">🚧 Blocked rooms — {zone}</div>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button>
      </div>
      <div className="modal-body">
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:700,fontSize:13,padding:"8px 10px",background:sel==="all"?"#fce4ec":"#fafaf8",borderRadius:8,border:"1.5px solid "+(sel==="all"?"#c62828":"#e8e6df"),marginBottom:10}}>
          <input type="checkbox" checked={sel==="all"} onChange={toggleAll} style={{width:15,height:15}}/>
          <span style={{color:sel==="all"?"#c62828":"#333"}}>☑ All rooms in {zone}</span>
        </label>
        {zoneRooms.length===0&&<div style={{color:"#bbb",fontSize:12}}>No rooms defined for this zone yet. Add rooms from the Rooms tab first.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:280,overflowY:"auto",opacity:sel==="all"?0.4:1,pointerEvents:sel==="all"?"none":"auto"}}>
          {zoneRooms.map(function(r){
            var checked=Array.isArray(sel)&&sel.includes(r.id);
            return <label key={r.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",textTransform:"none",letterSpacing:"normal",fontWeight:500,fontSize:12,padding:"6px 10px",background:checked?"#fce4ec":"#fafaf8",borderRadius:6}}>
              <input type="checkbox" checked={checked} onChange={function(){toggleRoom(r.id);}} style={{width:14,height:14}}/>
              {r.name}
            </label>;
          })}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-pri" onClick={function(){onSave(sel);onClose();}}>✓ Save</button>
      </div>
    </div>
  </div>;
}

function ScheduleView({curZone,schedules,saveSchedules,tasks,saveTasks,people,tags,zones,rooms,saveRooms,canEdit,roomBlockersOf,tenders,saveTenders,pkgOwners,onNavTender}){
  // Destructive or wide-reaching operations (deleting a schedule, editing tasks by batch)
  // are reserved for the app admin, whatever the zone rights are.
  var isAdmin=isAppAdmin(window._currentUser?window._currentUser.name:"");
  const [linkRowId,setLinkRowId]=useState(null);
  const [linkPos,setLinkPos]=useState({x:0,y:0});
  const [collapsedCats,setCollapsedCats]=useState({});
  const [fGroup,setFGroup]=useState("");
  const wrapRef=useRef(null);
  const mirrorRef=useRef(null);
  const syncingRef=useRef(false);
  const [schedScrollW,setSchedScrollW]=useState(0);
  const [mirrorBox,setMirrorBox]=useState({show:false,left:0,width:0});
  const [colorRowId,setColorRowId]=useState(null);
  const [editRowId,setEditRowId]=useState(null);
  const [critPath,setCritPath]=useState(null);   // null = off; computed on demand only
  const [showFloat,setShowFloat]=useState(false);  // float is opt-in: one number per row is a lot of ink
  // A 40-column grid cannot be squeezed into 380px. On a phone the schedule becomes what it
  // is actually used for there: what happens in the next four weeks, week by week.
  const [monthView,setMonthView]=useState(function(){
    try{return window.innerWidth<=768;}catch(e){return false;}
  });
  const [qTender,setQTender]=useState("");
  const [printPlan,setPrintPlan]=useState(null);
  const [fullScreen,setFullScreen]=useState(false);
  // Esc leaves full screen — a fixed overlay with no way out is a trap.
  useEffect(function(){
    if(!fullScreen)return;
    function onKey(e){if(e.key==="Escape")setFullScreen(false);}
    window.addEventListener("keydown",onKey);
    return function(){window.removeEventListener("keydown",onKey);};
  },[fullScreen]);
  const [showDocs,setShowDocs]=useState(false);
  const [newDoc,setNewDoc]=useState({title:"",url:"",kind:"Setting-out plan",roomId:""});
  // Keep the pinned scrollbar and the real one in step, without bouncing between the two.
  function syncScroll(from){
    var w=wrapRef.current,m=mirrorRef.current;
    if(!w||!m||syncingRef.current)return;
    syncingRef.current=true;
    if(from==="wrap")m.scrollLeft=w.scrollLeft;else w.scrollLeft=m.scrollLeft;
    window.requestAnimationFrame(function(){syncingRef.current=false;});
  }
  const [selRows,setSelRows]=useState([]);          // multi-selection for bulk editing
  const [bulkTender,setBulkTender]=useState("");
  const [bulkGroup,setBulkGroup]=useState("");
  const [bulkRoom,setBulkRoom]=useState("");
  const [spanRowId,setSpanRowId]=useState(null);
  const [spanPos,setSpanPos]=useState({x:0,y:0});
  const [newGroup,setNewGroup]=useState("");
  const [hoverInfo,setHoverInfo]=useState(null);
  const [newActionText,setNewActionText]=useState("");
  const [newActionSeverity,setNewActionSeverity]=useState("info");   // blocking | warning | prereq | info
  const [newActionOwner,setNewActionOwner]=useState("");
  const [newActionDue,setNewActionDue]=useState("");
  const [selId,setSelId]=useState(function(){
    try{var j=localStorage.getItem("pp_sched_selId");if(j){localStorage.removeItem("pp_sched_selId");return j;}}catch(e){}
    return null;
  });
  // Row the tender view asked us to highlight, cleared after a few seconds.
  const [focusRow,setFocusRow]=useState(function(){
    try{var f=localStorage.getItem("pp_sched_focusRow");if(f){localStorage.removeItem("pp_sched_focusRow");return f;}}catch(e){}
    return "";
  });
  // Where we came from, if the tender sheet sent us here. Kept until the user goes back or
  // leaves the schedule, so the trail never dead-ends.
  const [backTo,setBackTo]=useState(function(){
    try{
      var id=localStorage.getItem("pp_back_tender");
      if(!id)return null;
      var lbl=localStorage.getItem("pp_back_label")||"the tender";
      localStorage.removeItem("pp_back_tender");localStorage.removeItem("pp_back_label");
      return{id:id,label:lbl};
    }catch(e){return null;}
  });
  useEffect(function(){
    if(!focusRow)return;
    var t=setTimeout(function(){setFocusRow("");},6000);
    return function(){clearTimeout(t);};
  },[focusRow]);
  const [newRowLabel,setNewRowLabel]=useState("");
  const [newRowKind,setNewRowKind]=useState("task");
  const [newRowAfter,setNewRowAfter]=useState("");
  const [paintMode,setPaintMode]=useState("plan");

  var zoneScheds=(schedules||[]).filter(function(s){return s.zone===curZone;});
  var sc=selId?zoneScheds.find(function(s){return s.id===selId;}):(zoneScheds.length?zoneScheds[0]:null);

  function upd(id,fields){
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    saveSchedules((schedules||[]).map(function(s){return s.id!==id?s:Object.assign({},s,fields,{updatedAt:today(),updatedBy:window._currentUser?window._currentUser.name:""});}));
  }
  function addSchedule(){
    var ns=newSchedule({zone:curZone,title:curZone+" schedule"});
    saveSchedules([...(schedules||[]),ns]);
    setSelId(ns.id);
  }
  function delSchedule(id){
    if(!isAdmin){safeAlert("Deleting a schedule is reserved for "+APP_ADMIN+".\n\nIf a schedule must go, ask the admin. You can still delete individual rows.");return;}
    var target=(schedules||[]).find(function(s){return s.id===id;});
    if(!target)return;
    var nRows=(target.rows||[]).length;
    var nLinked=(tasks||[]).filter(function(t){
      return (target.rows||[]).some(function(r){return r.id===t.scheduleRowRef;});
    }).length;
    // Typed confirmation: a schedule is weeks of planning, an accidental click must not destroy it.
    var typed=window.prompt(
      "DELETE the schedule \""+(target.title||"untitled")+"\"\n\n"+
      nRows+" row(s) and "+nLinked+" linked action(s) will lose their planning.\n"+
      "This cannot be undone.\n\nType DELETE to confirm:","");
    if(typed===null)return;
    if(String(typed).trim().toUpperCase()!=="DELETE"){safeAlert("Cancelled — nothing was deleted.");return;}
    saveSchedules((schedules||[]).filter(function(s){return s.id!==id;}));
    setSelId(null);
  }
  // Insert a task immediately under a given row. Faster than the "add at the end +
  // pick an anchor in a dropdown" flow when you are already looking at the right line.
  function insertTaskAfter(rowId){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var rows=(sc.rows||[]).slice();
    var i=rows.findIndex(function(r){return r.id===rowId;});
    if(i<0)return;
    var nr=newScheduleRow("task","");
    if(rows[i].kind==="category"){
      // under a category header, the new task goes first in that block
      rows.splice(i+1,0,nr);
    }else{
      rows.splice(i+1,0,nr);
    }
    upd(sc.id,{rows:rows});
    setEditRowId(nr.id);            // straight into the label field
  }
  function addRow(){
    if(!sc||!newRowLabel.trim())return;
    var rows=(sc.rows||[]).slice();
    var nr=newScheduleRow(newRowKind,newRowLabel.trim());
    if(!newRowAfter){
      rows.push(nr);   // end of schedule
    }else{
      var anchor=rows.findIndex(function(r){return r.id===newRowAfter;});
      if(anchor<0){rows.push(nr);}
      else if(newRowKind==="section"){
        // a section opens a new block: drop it after everything the anchor owns
        var e2=anchor+1;
        while(e2<rows.length&&rows[e2].kind!=="section")e2++;
        rows.splice(e2,0,nr);
      }
      else if(rows[anchor].kind==="category"&&newRowKind==="task"){
        // Adding a task under a category: place it at the end of that category's block
        var end=anchor+1;
        while(end<rows.length&&rows[end].kind!=="category")end++;
        rows.splice(end,0,nr);
      }else{
        rows.splice(anchor+1,0,nr);   // right after the chosen row
      }
    }
    // A new category mirrors into a Room (rooms and categories are kept 1:1)
    if(newRowKind==="category"&&saveRooms){
      var rm=newRoom({name:newRowLabel.trim(),zone:curZone});
      nr.roomId=rm.id;
      saveRooms([...(rooms||[]),rm]);
    }
    upd(sc.id,{rows:rows});
    setNewRowLabel("");
  }
  function updRow(rowId,fields){
    if(!sc)return;
    var row=(sc.rows||[]).find(function(r){return r.id===rowId;});
    upd(sc.id,{rows:(sc.rows||[]).map(function(r){return r.id!==rowId?r:Object.assign({},r,fields);})});
    // Renaming a category renames its Room too
    if(row&&row.kind==="category"&&row.roomId&&fields.label!==undefined&&saveRooms){
      saveRooms((rooms||[]).map(function(rm){return rm.id!==row.roomId?rm:Object.assign({},rm,{name:fields.label});}));
    }
  }
  // Deleting a header takes everything under it. Leaving the tasks behind used to silently
  // re-parent them to the category above, which is worse than losing them: the plan looked
  // fine and the work had moved room.
  function delRow(rowId){
    if(!sc)return;
    var rows=(sc.rows||[]);
    var i=rows.findIndex(function(r){return r.id===rowId;});
    if(i<0)return;
    var row=rows[i];
    var isSection=row.kind==="section";
    var isCat=row.kind==="category";

    // everything the header owns, in document order
    var doomed=[row];
    if(isSection||isCat){
      for(var k=i+1;k<rows.length;k++){
        if(rows[k].kind==="section")break;
        if(isCat&&rows[k].kind==="category")break;
        doomed.push(rows[k]);
      }
    }
    var ids={};doomed.forEach(function(r){ids[r.id]=1;});
    var tasksIn=doomed.filter(function(r){return r.kind!=="category"&&r.kind!=="section";});
    var catsIn=doomed.filter(function(r){return r.kind==="category";});
    var roomIds=catsIn.map(function(r){return r.roomId;}).filter(Boolean);
    if(isCat&&row.roomId)roomIds.push(row.roomId);
    var roomNames=[...new Set(roomIds)].map(function(id){
      var rm=(rooms||[]).find(function(x){return x.id===id;});
      return rm?rm.name:null;
    }).filter(Boolean);
    // actions attached to any of the rows about to disappear
    var linked=(tasks||[]).filter(function(t){return t.scheduleRowRef&&ids[t.scheduleRowRef]&&t.status!=="done";});

    if(!isSection&&!isCat){
      if(!safeConfirm("Delete the task “"+(row.label||"untitled")+"”?"))return;
    }else{
      var what=isSection?"section":"room / category";
      var lines=[];
      lines.push("Delete the "+what+" “"+(row.label||"untitled")+"”?");
      lines.push("");
      if(catsIn.length>0)lines.push("· "+catsIn.length+" room"+(catsIn.length!==1?"s":"")+" inside it");
      lines.push("· "+tasksIn.length+" task"+(tasksIn.length!==1?"s":"")+" will be deleted with it"+
        (tasksIn.length>0?": "+tasksIn.slice(0,5).map(function(r){return r.label||"untitled";}).join(", ")+(tasksIn.length>5?", …":""):""));
      if(roomNames.length>0)lines.push("· the linked room"+(roomNames.length!==1?"s":"")+" will be removed from the Rooms tab: "+roomNames.join(", "));
      if(linked.length>0)lines.push("· "+linked.length+" open action"+(linked.length!==1?"s":"")+" will lose their link to the schedule (the actions themselves are kept)");
      lines.push("");
      lines.push("This cannot be undone.");
      if(!safeConfirm(lines.join("\n")))return;
    }

    if(roomIds.length>0&&saveRooms)saveRooms((rooms||[]).filter(function(rm){return roomIds.indexOf(rm.id)<0;}));
    if(linked.length>0&&saveTasks){
      // keep the actions, drop the dangling reference
      saveTasks((tasks||[]).map(function(t){
        return (t.scheduleRowRef&&ids[t.scheduleRowRef])?Object.assign({},t,{scheduleRowRef:""}):t;
      }));
    }
    upd(sc.id,{rows:rows.filter(function(r){return !ids[r.id];})});
    setSelRows(function(prev){return prev.filter(function(id){return !ids[id];});});
  }
  // Duplicate a single row right below itself, keeping its bars and dependency
  // Progress = actual cells / planned cells for a row (rows with no plan fall back to actual count)
  // Manual progress wins when set; otherwise it is derived from actual vs planned cells
  function latestWeekProgress(row){
    var wp=row.weekProgress||{};
    var keys=Object.keys(wp).filter(function(k){return wp[k]!==""&&wp[k]!==null&&wp[k]!==undefined;}).sort();
    if(keys.length===0)return null;
    return{week:keys[keys.length-1],pct:Math.max(0,Math.min(100,Number(wp[keys[keys.length-1]])))};
  }
  function rowProgress(row){
    var lw=latestWeekProgress(row);
    if(lw)return lw.pct;                                  // per-week entries win: they say WHEN the progress was reached
    if(row.progress!==undefined&&row.progress!==null&&row.progress!=="")return Math.max(0,Math.min(100,Number(row.progress)));
    var cells=row.cells||{};
    var plan=0,act=0;
    Object.keys(cells).forEach(function(w){
      var v=cells[w];
      if(v==="plan"||v==="both")plan++;
      if(v==="actual"||v==="both")act++;
    });
    if(plan===0&&act===0)return null;
    if(plan===0)return 100;
    return Math.min(100,Math.round(act/plan*100));
  }
  function isManualProgress(row){return row.progress!==undefined&&row.progress!==null&&row.progress!=="";}
  // Copy a category block onto another room: structure + links kept, bars (durations) cleared
  function copySequenceToRoom(catRowId,targetRoomId){
    if(!sc||!targetRoomId)return;
    var rows=(sc.rows||[]).slice();
    var start=rows.findIndex(function(r){return r.id===catRowId;});
    if(start<0)return;
    var end=start+1;
    while(end<rows.length&&rows[end].kind!=="category")end++;
    var block=rows.slice(start,end);
    var idMap={};
    block.forEach(function(r){idMap[r.id]=uuid();});
    var roomName=((rooms||[]).find(function(rm){return rm.id===targetRoomId;})||{}).name||"room";
    var copies=block.map(function(r,bi){
      return Object.assign({},r,{
        id:idMap[r.id],
        label:bi===0?(r.label||"")+" — "+roomName:r.label,
        cells:{},                                   // durations intentionally dropped
        weekProgress:{},
        progress:"",
        afterId:idMap[r.afterId]||"",               // links remapped inside the copied block
        roomId:targetRoomId
      });
    });
    rows.splice(end,0,...copies);
    upd(sc.id,{rows:rows});
  }
  // ---- Procurement link -----------------------------------------------
  // A row can declare which tender supplies it. We then compare the tender's expected
  // delivery date with the row's planned start week and flag the gap.
  function procRisk(row){
    if(!row.tenderRef)return null;
    if(!row.startWeek)return null;
    var td=(tenders||[]).find(function(t){return t.id===row.tenderRef;});
    if(!td)return null;
    var proc=null;
    try{proc=calcProcurement(td);}catch(e){return null;}
    if(!proc||!proc.deliveryDate)return null;
    // start week = Monday; the task can start any day that week, so compare against the Sunday
    var wkEnd=(function(){var d=new Date(row.startWeek);d.setDate(d.getDate()+6);return toISO(d);})();
    // RULE (single source of truth for the two markers):
    //   RED    delivery lands AFTER the task's start week ends  -> the task cannot start
    //   ORANGE delivery lands within the 21 days BEFORE that     -> it starts, but with no float
    //   nothing at all if the material arrives more than 3 weeks early.
    var DAY=1000*60*60*24;
    var gapDays=Math.round((new Date(wkEnd)-new Date(proc.deliveryDate))/DAY); // >0 = delivered early
    var late=gapDays<0;
    var tight=!late&&gapDays<21;
    var weeksLate=late?Math.ceil(-gapDays/7):0;
    // First Monday of the schedule on or after the delivery date — the week the task
    // could realistically start if the tender keeps its current forecast.
    var feasible="";
    var wl=scheduleWeeks(sc);
    for(var fi=0;fi<wl.length;fi++){
      var we=(function(w){var d=new Date(w);d.setDate(d.getDate()+6);return toISO(d);})(wl[fi]);
      if(we>=proc.deliveryDate&&(sc.holidayWeeks||[]).indexOf(wl[fi])===-1){feasible=wl[fi];break;}
    }
    return{tender:td,delivery:proc.deliveryDate,startWeek:row.startWeek,late:late,tight:tight,weeksLate:weeksLate,feasible:feasible,gapDays:gapDays};
  }
  var procRisks=sc?(sc.rows||[]).map(function(r){var pr=procRisk(r);return pr?{row:r,risk:pr}:null;}).filter(Boolean).filter(function(x){return x.risk.late||x.risk.tight;}):[];

  // Push the tender's "start on site" back to the planned start week of its earliest linked task
  function pushStartOnSiteFromSchedule(tenderRef){
    if(!tenderRef||!saveTenders)return;
    var linked=(sc.rows||[]).filter(function(r){return r.tenderRef===tenderRef&&r.startWeek;});
    if(linked.length===0)return;
    var earliest=linked.map(function(r){return r.startWeek;}).sort()[0];
    var td=(tenders||[]).find(function(t){return t.id===tenderRef;});
    if(!td||td.startOnSite===earliest)return;
    saveTenders((tenders||[]).map(function(t){return t.id!==tenderRef?t:Object.assign({},t,{startOnSite:earliest});}));
  }

  // Auto-action when procurement is late for a planned task. Same shared task object as everywhere else,
  // so it also shows up in Actions, in the package, in the zone report and in the Rooms view.
  function procRiskText(row,td){return "Procurement late for: "+(row.label||"task")+" — "+td.title;}
  // Stable identity for the auto-action. Matching on the text used to fail as soon as a row
  // was renamed or a tender re-titled, and the effect then created a second copy — over and
  // over. The key never changes, so one row + one tender can only ever own one action.
  function procRiskKey(rowId,tenderId){return "proclate:"+rowId+":"+tenderId;}
  var autoBusyRef=useRef(false);
  useEffect(function(){
    if(!sc||!saveTasks||!tasks)return;
    if(autoBusyRef.current)return;                 // a write is already in flight
    var changed=false;
    var next=(tasks||[]).slice();

    // 1. de-duplicate whatever previous versions left behind: keep the oldest open one per key
    var seen={};
    var dropped=0;
    next=next.filter(function(t){
      if(t.addedBy!=="System")return true;
      if((t.text||"").indexOf("Procurement late for: ")!==0&&!t.autoKey)return true;
      var k=t.autoKey||procRiskKey(t.scheduleRowRef,t.tenderRef);
      if(t.status==="done")return true;            // history is kept
      if(seen[k]){dropped++;return false;}
      seen[k]=1;
      return true;
    });
    if(dropped>0)changed=true;

    // 2. open one action per late row, if none exists yet
    var created=0;
    (sc.rows||[]).forEach(function(r){
      var pr=procRisk(r);
      if(!pr||!pr.late)return;
      var key=procRiskKey(r.id,pr.tender.id);
      if(seen[key])return;
      if(created>=20)return;                       // hard stop: never flood the list
      seen[key]=1;
      next=[newTask({
        text:procRiskText(r,pr.tender),
        autoKey:key,
        owner:(pkgOwners||{})[pr.tender.package||""]||pr.tender.ownerTender||"",
        zone:curZone,package:pr.tender.package||"",tenderRef:pr.tender.id,scheduleRowRef:r.id,
        tags:["Blocking Point"],importance:3,urgence:3,due:r.startWeek,
        note:"Delivery expected "+fmtDate(pr.delivery)+" but the task starts week of "+fmtDate(r.startWeek)+" ("+pr.weeksLate+" week"+(pr.weeksLate!==1?"s":"")+" late)",
        addedBy:"System"
      }),...next];
      created++;
      changed=true;
    });

    // 3. close the ones whose conflict is gone
    next=next.map(function(t){
      if(t.addedBy!=="System"||t.status==="done"||!t.scheduleRowRef)return t;
      if((t.text||"").indexOf("Procurement late for: ")!==0&&!t.autoKey)return t;
      var r=(sc.rows||[]).find(function(x){return x.id===t.scheduleRowRef;});
      var pr=r?procRisk(r):null;
      if(pr&&pr.late)return t;
      changed=true;
      return Object.assign({},t,{status:"done",completedAt:today()});
    });

    if(changed){
      autoBusyRef.current=true;
      saveTasks(next);
      setTimeout(function(){autoBusyRef.current=false;},400);
    }
  },[schedules,tenders,tasks]);

  // Start/end week + quantity -> working weeks, weekly rate, and the planned bars are drawn automatically
  function rowSpan(row){
    if(!sc)return null;
    var wl=scheduleWeeks(sc);
    var hol=sc.holidayWeeks||[];
    var i1=wl.indexOf(row.startWeek),i2=wl.indexOf(row.endWeek);
    var derived=false;
    // No explicit start/end week: fall back to the painted planned bars, so a row drawn
    // by clicking cells still gets a weekly rate as soon as a quantity is entered.
    if(i1<0||i2<0){
      var painted=[];
      var cells=row.cells||{};
      wl.forEach(function(w,idx){var v=cells[w];if(v==="plan"||v==="both")painted.push(idx);});
      if(painted.length===0)return null;
      i1=painted[0];i2=painted[painted.length-1];
      derived=true;
    }
    if(i2<i1){var tmp=i1;i1=i2;i2=tmp;}
    var span=wl.slice(i1,i2+1);
    var working=span.filter(function(w){return hol.indexOf(w)===-1;});
    var q=Number(row.qty);
    var rate=(working.length>0&&row.qty!==""&&!isNaN(q))?q/working.length:null;
    return{weeks:span,working:working,totalWeeks:span.length,workingWeeks:working.length,rate:rate,derived:derived,startWeek:wl[i1],endWeek:wl[i2]};
  }
  // ---- Four-week view (phone) -------------------------------------------
  function monthWindows(){
    if(!sc)return [];
    var wl=scheduleWeeks(sc);
    if(wl.length===0)return [];
    var t=today();
    // the week containing today, or the first week of the schedule if it has not started
    var idx=wl.findIndex(function(w){return w<=t&&t<=addCalDays(w,6);});
    if(idx<0)idx=wl.findIndex(function(w){return w>t;});
    if(idx<0)idx=Math.max(0,wl.length-1);
    var out=[];
    for(var k=0;k<4&&idx+k<wl.length;k++){
      var w=wl[idx+k];
      out.push({week:w,end:addCalDays(w,6),offset:k,holiday:(sc.holidayWeeks||[]).indexOf(w)>=0});
    }
    return out;
  }
  // Tasks active in a given week, carrying the room they belong to.
  function tasksInWeek(week){
    if(!sc)return [];
    var out=[],room="",section="";
    (groupRows||[]).forEach(function(r){
      if(r.kind==="section"){section=r.label||"";room="";return;}
      if(r.kind==="category"){room=r.label||"";return;}
      var v=(r.cells||{})[week];
      var inSpan=false;
      if(v==="plan"||v==="actual"||v==="both")inSpan=true;
      else if(r.startWeek&&r.endWeek&&r.startWeek<=week&&week<=r.endWeek)inSpan=true;
      if(inSpan)out.push({row:r,room:room,section:section,cell:v||""});
    });
    return out;
  }

  // ---- Critical path ----------------------------------------------------
  // Each task has at most one predecessor (afterId), so the dependency graph is a forest
  // and the longest chain is a single memoised walk: O(number of rows), no matrix, no
  // library. Computed only when the user asks for it, never during a normal render.
  function computeCriticalPath(){
    if(!sc)return null;
    var rows=(sc.rows||[]).filter(function(r){return r.kind!=="category"&&r.kind!=="section";});
    if(rows.length===0)return null;
    var byId={};rows.forEach(function(r){byId[r.id]=r;});
    var wl=scheduleWeeks(sc);
    var hol=sc.holidayWeeks||[];

    // Duration in working weeks, from the explicit span or from the painted bars.
    function dur(r){
      var i1=wl.indexOf(r.startWeek),i2=wl.indexOf(r.endWeek);
      if(i1<0||i2<0){
        var painted=wl.filter(function(w){var v=(r.cells||{})[w];return v==="plan"||v==="both";});
        if(painted.length===0)return 0;
        i1=wl.indexOf(painted[0]);i2=wl.indexOf(painted[painted.length-1]);
      }
      if(i1<0||i2<0)return 0;
      if(i2<i1){var t=i1;i1=i2;i2=t;}
      var n=0;
      for(var k=i1;k<=i2;k++)if(hol.indexOf(wl[k])<0)n++;
      return n;
    }

    var memo={},state={};                 // state: 1 = being visited, 2 = done
    function chain(id){
      if(memo[id])return memo[id];
      if(state[id]===1){memo[id]={len:0,path:[]};return memo[id];}   // cycle guard
      var r=byId[id];
      if(!r){return{len:0,path:[]};}
      state[id]=1;
      var lag=Number(r.lagWeeks)||0;
      var prev=(r.afterId&&byId[r.afterId])?chain(r.afterId):{len:0,path:[]};
      var res={len:prev.len+lag+dur(r),path:prev.path.concat([r.id])};
      state[id]=2;memo[id]=res;
      return res;
    }

    var best={len:0,path:[]};
    rows.forEach(function(r){
      var c=chain(r.id);
      if(c.len>best.len)best=c;
    });
    if(best.path.length===0)return null;

    var ids={};best.path.forEach(function(id){ids[id]=1;});
    var head=byId[best.path[0]],tail=byId[best.path[best.path.length-1]];

    // ---- Float per task --------------------------------------------------
    // Early finish = the chain length ending at this task (already memoised above).
    // Late finish  = the earliest constraint imposed by whoever depends on it; a task with
    // no successor is bounded by the end of the schedule. Float = late − early, in working
    // weeks. Zero float means the task IS critical, even outside the single longest chain.
    var successors={};
    rows.forEach(function(r){
      if(r.afterId&&byId[r.afterId])(successors[r.afterId]=successors[r.afterId]||[]).push(r);
    });
    var lateMemo={},lateState={};
    function lateFinish(id){
      if(lateMemo[id]!==undefined)return lateMemo[id];
      if(lateState[id]===1)return best.len;                 // cycle guard
      lateState[id]=1;
      var succ=successors[id]||[];
      var v;
      if(succ.length===0)v=best.len;                        // nothing waits: the horizon
      else{
        v=Infinity;
        succ.forEach(function(sr){
          var lagS=Number(sr.lagWeeks)||0;
          var lf=lateFinish(sr.id);
          var start=lf-dur(sr)-lagS;                        // latest this one may finish
          if(start<v)v=start;
        });
      }
      lateState[id]=2;lateMemo[id]=v;
      return v;
    }
    var float={};
    rows.forEach(function(r){
      var early=chain(r.id).len;
      var f=lateFinish(r.id)-early;
      float[r.id]=(isFinite(f)?Math.round(f):0);
    });
    // Anything at zero float is critical, not just the single longest chain.
    var zeroFloat={};
    rows.forEach(function(r){if(float[r.id]<=0&&dur(r)>0)zeroFloat[r.id]=1;});

    return{
      ids:ids,order:best.path,weeks:best.len,
      float:float,zeroFloat:zeroFloat,
      startWeek:head?head.startWeek:"",endWeek:tail?tail.endWeek:"",
      labels:best.path.map(function(id){return (byId[id]||{}).label||"untitled";})
    };
  }

  // New start week for a row, keeping the same number of calendar weeks between
  // start and end. Used by the "earliest feasible start" badge.
  function shiftedSpan(row,newStart){
    var wl=scheduleWeeks(sc);
    var i1=wl.indexOf(row.startWeek),i2=wl.indexOf(row.endWeek),iN=wl.indexOf(newStart);
    if(iN<0)return{};
    if(i1<0||i2<0)return{startWeek:newStart,endWeek:row.endWeek||newStart};
    var len=Math.abs(i2-i1);
    var end=wl[Math.min(iN+len,wl.length-1)];
    return{startWeek:newStart,endWeek:end};
  }
  // Repaint the planned bars of a row from its start/end week, leaving actual bars untouched
  function applySpan(row,patch){
    var merged=Object.assign({},row,patch);
    var sp=(function(){
      if(!merged.startWeek||!merged.endWeek||!sc)return null;
      var wl=scheduleWeeks(sc);var hol=sc.holidayWeeks||[];
      var i1=wl.indexOf(merged.startWeek),i2=wl.indexOf(merged.endWeek);
      if(i1<0||i2<0)return null;
      if(i2<i1){var t=i1;i1=i2;i2=t;}
      return wl.slice(i1,i2+1).filter(function(w){return hol.indexOf(w)===-1;});
    })();
    // Only one of the two weeks is known yet: just store it. Wiping the manually painted
    // bars here would lose them for good if the user never picks the second week.
    if(!sp){updRow(row.id,patch);return;}
    var cells={};
    Object.keys(row.cells||{}).forEach(function(w){
      var v=row.cells[w];
      if(v==="actual"||v==="both")cells[w]="actual";      // keep what was really done
    });
    sp.forEach(function(w){cells[w]=cells[w]==="actual"?"both":"plan";});
    updRow(row.id,Object.assign({},patch,{cells:cells}));
  }
  function duplicateRow(rowId){
    if(!sc)return;
    var rows=(sc.rows||[]).slice();
    var i=rows.findIndex(function(r){return r.id===rowId;});
    if(i<0)return;
    var src=rows[i];
    var copy=Object.assign({},src,{id:uuid(),label:(src.label||"")+" (copy)",cells:Object.assign({},src.cells||{})});
    rows.splice(i+1,0,copy);
    upd(sc.id,{rows:rows});
  }
  // Duplicate a category together with every task under it (until the next category)
  function duplicateCategoryBlock(catRowId){
    if(!sc)return;
    var rows=(sc.rows||[]).slice();
    var start=rows.findIndex(function(r){return r.id===catRowId;});
    if(start<0||rows[start].kind!=="category")return;
    var end=start+1;
    while(end<rows.length&&rows[end].kind!=="category")end++;
    var block=rows.slice(start,end);
    // Remap ids so internal "starts after" links point to the copies, not the originals
    var idMap={};
    block.forEach(function(r){idMap[r.id]=uuid();});
    var copies=block.map(function(r,bi){
      return Object.assign({},r,{
        id:idMap[r.id],
        label:bi===0?(r.label||"")+" (copy)":r.label,
        cells:{},                                   // durations are not copied — the new room is planned from scratch
        weekProgress:{},
        progress:"",
        afterId:idMap[r.afterId]||r.afterId||""     // links between the copied tasks are kept
      });
    });
    rows.splice(end,0,...copies);
    upd(sc.id,{rows:rows});
  }
  // Copy this whole schedule into another zone (fresh ids, links preserved)
  function duplicateToZone(targetZone){
    if(!sc||!targetZone)return;
    var idMap={};
    (sc.rows||[]).forEach(function(r){idMap[r.id]=uuid();});
    var rows=(sc.rows||[]).map(function(r){
      return Object.assign({},r,{id:idMap[r.id],cells:Object.assign({},r.cells||{}),afterId:idMap[r.afterId]||""});
    });
    var ns=newSchedule({zone:targetZone,title:sc.title+" (from "+curZone+")",startDate:sc.startDate,weeks:sc.weeks,rows:rows,holidayWeeks:(sc.holidayWeeks||[]).slice()});
    saveSchedules([...(schedules||[]),ns]);
    safeAlert("Schedule copied to "+targetZone+".");
  }
  // Rows are a flat list where a category owns every row until the next category.
  // Split it into blocks so a category can be moved or sorted with its tasks.
  // A "section" row groups several rooms — External works > Fence, Paving, Kerbs.
  // Blocks are still flat here: a section simply owns the categories that follow it.
  function rowBlocks(rows){
    var blocks=[];var loose=[];
    (rows||[]).forEach(function(r){
      if(r.kind==="category")blocks.push({head:r,items:[]});
      else if(r.kind==="section"){blocks.push({head:r,items:[],section:true});}
      else if(blocks.length===0)loose.push(r);
      else blocks[blocks.length-1].items.push(r);
    });
    return{loose:loose,blocks:blocks};
  }
  // The section a row belongs to, or "" when it sits above the first section.
  function sectionOfRow(rows,rowId){
    var cur="";
    for(var i=0;i<(rows||[]).length;i++){
      if(rows[i].kind==="section")cur=rows[i].id;
      if(rows[i].id===rowId)return cur;
    }
    return "";
  }
  function flattenBlocks(bs){
    var out=bs.loose.slice();
    bs.blocks.forEach(function(b){out.push(b.head);b.items.forEach(function(x){out.push(x);});});
    return out;
  }
  function moveRow(rowId,dir){
    if(!sc)return;
    var rows=(sc.rows||[]).slice();
    var i=rows.findIndex(function(r){return r.id===rowId;});
    if(i<0)return;
    // A section moves with everything it owns, swapping with the neighbouring section.
    if(rows[i].kind==="section"){
      var bs2=rowBlocks(rows);
      var secIdx=[];
      bs2.blocks.forEach(function(b,k){if(b.section)secIdx.push(k);});
      var here=bs2.blocks.findIndex(function(b){return b.head.id===rowId;});
      var pos=secIdx.indexOf(here);
      var target=pos+dir;
      if(pos<0||target<0||target>=secIdx.length)return;
      function sliceOf(k){
        var endK=k+1;
        while(endK<bs2.blocks.length&&!bs2.blocks[endK].section)endK++;
        return{from:k,to:endK};
      }
      var A=sliceOf(secIdx[pos]),B=sliceOf(secIdx[target]);
      var first=dir>0?A:B, second=dir>0?B:A;
      var head=bs2.blocks.slice(0,first.from);
      var one=bs2.blocks.slice(first.from,first.to);
      var two=bs2.blocks.slice(second.from,second.to);
      var tail=bs2.blocks.slice(second.to);
      bs2.blocks=head.concat(two,one,tail);
      upd(sc.id,{rows:flattenBlocks(bs2)});
      return;
    }
    // A category moves as a whole block, swapping with the neighbouring category.
    if(rows[i].kind==="category"){
      var bs=rowBlocks(rows);
      var bi=bs.blocks.findIndex(function(b){return b.head.id===rowId;});
      var bj=bi+dir;
      if(bi<0||bj<0||bj>=bs.blocks.length)return;
      if(bs.blocks[bj].section)return;   // stay inside your own section
      var t=bs.blocks[bi];bs.blocks[bi]=bs.blocks[bj];bs.blocks[bj]=t;
      upd(sc.id,{rows:flattenBlocks(bs)});
      return;
    }
    // A task moves inside its own category only, never across a header.
    var j=i+dir;
    if(j<0||j>=rows.length)return;
    if(rows[j].kind==="category")return;
    var tmp=rows[i];rows[i]=rows[j];rows[j]=tmp;
    upd(sc.id,{rows:rows});
  }
  // ---- Prerequisites ----------------------------------------------------
  // Things that must happen before a task can start (a permit, a client approval, a
  // delivery). Each carries an expected date that is "TBC" until somebody confirms it.
  // A prerequisite is a real action tagged "Prerequisite": it has an owner, a due date and
  // shows in the zone action list. "Confirmed" = the action is done, or its date was ticked.
  function prereqsOf(rowId){
    return (tasks||[]).filter(function(t){
      return t.scheduleRowRef===rowId&&(t.tags||[]).includes("Prerequisite");
    });
  }
  function prereqState(row){
    if(!row)return null;
    var ps=prereqsOf(row.id).map(function(t){
      return{id:t.id,label:t.text,date:t.due,confirmed:t.status==="done"||!!t.dateConfirmed,owner:t.owner};
    });
    // legacy rows may still carry inline prerequisites
    (row.prereqs||[]).forEach(function(p){ps.push({legacy:true,label:p.label,date:p.date,confirmed:!!p.confirmed});});
    if(ps.length===0)return null;
    var tbc=ps.filter(function(p){return !p.confirmed;});
    var latest="";
    ps.forEach(function(p){if(p.date&&p.date>latest)latest=p.date;});
    var gateWeek="";
    if(latest&&sc){
      var wl=scheduleWeeks(sc);
      for(var i=0;i<wl.length;i++){
        var e=new Date(wl[i]);e.setDate(e.getDate()+6);
        if(toISO(e)>=latest&&(sc.holidayWeeks||[]).indexOf(wl[i])===-1){gateWeek=wl[i];break;}
      }
    }
    return{all:ps,tbc:tbc.length,confirmed:ps.length-tbc.length,latest:latest,gateWeek:gateWeek,
      ready:tbc.length===0&&!!latest,
      tooEarly:!!(gateWeek&&row.startWeek&&row.startWeek<gateWeek)};
  }
  function updPrereqs(rowId,list){updRow(rowId,{prereqs:list});}

  // ---- Reference documents ----------------------------------------------
  var scDocs=(sc&&sc.docs)||[];
  function docsForRoom(roomId){return scDocs.filter(function(d){return d.roomId&&d.roomId===roomId;});}
  var generalDocs=scDocs.filter(function(d){return !d.roomId;});
  function saveDocs(list){if(sc)upd(sc.id,{docs:list});}
  function addDoc(d){saveDocs([...(scDocs),newScheduleDoc(d)]);}
  function updDoc(id,patch){saveDocs(scDocs.map(function(d){return d.id!==id?d:Object.assign({},d,patch,{updatedAt:today()});}));}
  function delDoc(id){
    var d=scDocs.find(function(x){return x.id===id;});
    if(!safeConfirm("Remove the link to \""+((d&&d.title)||"this document")+"\"?\n\nThe file itself stays on SharePoint — only the link is removed."))return;
    saveDocs(scDocs.filter(function(x){return x.id!==id;}));
  }

  function addGroupNow(){
    var v=(newGroup||"").trim();
    if(!v||!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var existing=allGroups.find(function(g){return g.toLowerCase()===v.toLowerCase();});
    if(existing){
      safeAlert("“"+existing+"” is already available in the Subcont. column of every task.");
      setNewGroup("");return;
    }
    upd(sc.id,{groups:[...new Set([...(sc.groups||[]),v])]});
    setNewGroup("");
  }
  function sortCategories(){
    if(!sc)return;
    var bs=rowBlocks(sc.rows||[]);
    if(bs.blocks.length<2){safeAlert("Nothing to sort — this schedule has fewer than two categories.");return;}
    if(!safeConfirm("Sort the "+bs.blocks.length+" categories alphabetically?\n\nEach category keeps its own tasks, in their current order."))return;
    // Sort categories A→Z, but never move one out of its section.
    var out=[],run=[];
    function flushRun(){
      run.sort(function(a,b){return (a.head.label||"").localeCompare(b.head.label||"",undefined,{numeric:true,sensitivity:"base"});});
      out=out.concat(run);run=[];
    }
    bs.blocks.forEach(function(b){
      if(b.section){flushRun();out.push(b);}
      else run.push(b);
    });
    flushRun();
    bs.blocks=out;
    upd(sc.id,{rows:flattenBlocks(bs)});
  }
  // Cell cycle: empty -> current paint mode -> both (if other already there) -> empty
  // ---- Dependency-aware shifting -------------------------------------
  // Shifts a row's PLANNED cells by n weeks, then cascades to every row that declared "after: this row".
  // Actual cells are never moved — they record what really happened.
  function shiftRowCascade(rows,rowId,deltaWeeks,wksList,visited,holidays){
    visited=visited||{};
    if(visited[rowId])return rows;   // guards against circular links
    visited[rowId]=true;
    holidays=holidays||[];
    // Shifting happens in WORKING weeks: neutralised (holiday) weeks are skipped over,
    // so a bar never lands on a shutdown period and the plan simply jumps past it.
    var working=wksList.filter(function(w){return holidays.indexOf(w)===-1;});
    var wIdxOf={};working.forEach(function(w,i){wIdxOf[w]=i;});
    var out=rows.map(function(r){
      if(r.id!==rowId)return r;
      var cells=Object.assign({},r.cells||{});
      var moved={};
      Object.keys(cells).forEach(function(wk){
        var v=cells[wk];
        var hasPlan=(v==="plan"||v==="both");
        var hasActual=(v==="actual"||v==="both");
        if(hasActual)moved[wk]=moved[wk]==="plan"?"both":(moved[wk]||"actual");
        if(hasPlan){
          var i=wIdxOf[wk];
          if(i===undefined)return;     // planned cell sitting on a holiday week: leave it alone
          var tgt=working[i+deltaWeeks];
          if(tgt===undefined)return;   // pushed outside the working window: dropped
          moved[tgt]=moved[tgt]==="actual"?"both":(moved[tgt]==="both"?"both":"plan");
        }
      });
      return Object.assign({},r,{cells:moved});
    });
    // cascade to dependents
    var deps=out.filter(function(r){return r.afterId===rowId;});
    deps.forEach(function(d){out=shiftRowCascade(out,d.id,deltaWeeks,wksList,visited,holidays);});
    return out;
  }
  // ---- Actions linked to schedule rows -------------------------------
  // The link lives on the task (scheduleRowRef), so it stays the same single action
  // that also shows up in the Zone action list, Packages, Global view, etc.
  function rowActions(rowId){
    var row=(sc&&(sc.rows||[]).find(function(r){return r.id===rowId;}))||null;
    var roomId=row?row.roomId:"";
    return (tasks||[]).filter(function(t){
      if(t.status==="done")return false;
      if(t.scheduleRowRef===rowId)return true;                       // linked directly to this row
      // Blocking points raised on the row's room (set from the Rooms tab) also show here
      if(roomId&&(t.tags||[]).includes("Blocking Point")&&t.zone===curZone){
        if(t.blockedRooms==="all")return true;
        if(Array.isArray(t.blockedRooms)&&t.blockedRooms.indexOf(roomId)>=0)return true;
      }
      return false;
    });
  }
  function rowWarning(rowId){
    var acts=rowActions(rowId);
    if(acts.length===0)return null;
    var blocking=acts.filter(function(t){return(t.tags||[]).includes("Blocking Point")&&t.status!=="done";});
    var warning=acts.filter(function(t){return(t.tags||[]).includes("Warning")&&t.status!=="done";});
    var late=acts.filter(function(t){return t.due&&t.due<today()&&t.status!=="done";});
    return{acts:acts,blocking:blocking.length,warning:warning.length,late:late.length,
      severity:blocking.length>0?"blocking":warning.length>0?"warning":late.length>0?"late":"info"};
  }
  function linkTaskToRow(taskId,rowId){
    if(!saveTasks)return;
    saveTasks((tasks||[]).map(function(t){return t.id!==taskId?t:stampModified(Object.assign({},t,{scheduleRowRef:rowId}));}));
  }
  function unlinkTask(taskId){
    if(!saveTasks)return;
    saveTasks((tasks||[]).map(function(t){return t.id!==taskId?t:stampModified(Object.assign({},t,{scheduleRowRef:""}));}));
  }
  // severity: "blocking" (red, stops the task), "warning" (orange, needs attention), "info"
  function createLinkedAction(rowId,rowLabel,text,severity,owner,due){
    if(!saveTasks||!text.trim())return;
    var tg=severity==="blocking"?["Blocking Point"]
          :severity==="warning"?["Warning"]
          :severity==="prereq"?["Prerequisite"]:[];
    var sev=severity==="blocking"?3:severity==="warning"?2:severity==="prereq"?3:1;
    saveTasks([newTask({text:text.trim(),zone:curZone,scheduleRowRef:rowId,tags:tg,
      importance:sev,urgence:sev,owner:owner||"",due:due||"",dateConfirmed:false,
      note:(severity==="prereq"?"Prerequisite for schedule row: ":"Linked to schedule row: ")+rowLabel}),...(tasks||[])]);
  }

  function shiftRow(rowId,delta){
    if(!sc)return;
    var wksList=scheduleWeeks(sc);
    upd(sc.id,{rows:shiftRowCascade((sc.rows||[]).slice(),rowId,delta,wksList,{},sc.holidayWeeks||[])});
  }
  // Neutralising a week pushes every planned bar from that week onwards one week later
  // (and re-activating pulls them back), so the plan reflows around a shutdown automatically.
  function reflowForHoliday(rows,wksList,fromWk,direction,holidaysAfter){
    var idxOf={};wksList.forEach(function(w,i){idxOf[w]=i;});
    var fromIdx=idxOf[fromWk];
    if(fromIdx===undefined)return rows;
    return rows.map(function(r){
      var cells=r.cells||{};
      var moved={};
      Object.keys(cells).forEach(function(w){
        var v=cells[w];
        var hasPlan=(v==="plan"||v==="both");
        var hasActual=(v==="actual"||v==="both");
        if(hasActual)moved[w]=moved[w]==="plan"?"both":(moved[w]||"actual");
        if(!hasPlan)return;
        var i=idxOf[w];
        if(i===undefined||i<fromIdx){   // before the shutdown: untouched
          moved[w]=moved[w]==="actual"?"both":(moved[w]==="both"?"both":"plan");
          return;
        }
        // walk one step in the requested direction, landing on the next working week
        var j=i+direction;
        while(j>=0&&j<wksList.length&&holidaysAfter.indexOf(wksList[j])>=0)j+=direction;
        var tgt=wksList[j];
        if(tgt===undefined)return;      // pushed off the board
        moved[tgt]=moved[tgt]==="actual"?"both":(moved[tgt]==="both"?"both":"plan");
      });
      return Object.assign({},r,{cells:moved});
    });
  }
  function toggleHolidayWeek(wk){
    if(!sc)return;
    var hw=(sc.holidayWeeks||[]).slice();
    var i=hw.indexOf(wk);
    var turningOn=i<0;
    if(turningOn)hw.push(wk);else hw.splice(i,1);
    var wksList=scheduleWeeks(sc);
    var rows=reflowForHoliday((sc.rows||[]).slice(),wksList,wk,turningOn?1:-1,hw);
    upd(sc.id,{holidayWeeks:hw,rows:rows});
  }
  function isHoliday(wk){return(sc&&(sc.holidayWeeks||[]).indexOf(wk)>=0);}

  function setWeekProgress(row,wk,val){
    var wp=Object.assign({},row.weekProgress||{});
    if(val===""||val===null)delete wp[wk];else wp[wk]=Math.max(0,Math.min(100,Number(val)));
    // entering a progress value also marks the week as actual work
    var cells=Object.assign({},row.cells||{});
    if(val!==""&&val!==null){
      var cur=cells[wk]||"";
      cells[wk]=(cur==="plan"||cur==="both")?"both":"actual";
    }
    updRow(row.id,{weekProgress:wp,cells:cells});
  }
  function toggleCell(row,wk){
    var cur=(row.cells||{})[wk]||"";
    var next;
    if(!cur)next=paintMode;
    else if(cur===paintMode)next="";
    else next="both";
    if(cur==="both")next=paintMode==="plan"?"actual":"plan";
    var cells=Object.assign({},row.cells||{});
    if(next)cells[wk]=next;else delete cells[wk];
    // Painting IS the input: the start/end weeks in the 📐 panel are derived from the bars,
    // so the tender's target start updates without anyone typing a date.
    var patch={cells:cells};
    var wl=scheduleWeeks(sc);
    var painted=wl.filter(function(w){var v=cells[w];return v==="plan"||v==="both";});
    if(painted.length>0){
      patch.startWeek=painted[0];
      patch.endWeek=painted[painted.length-1];
    }else{
      patch.startWeek="";
      patch.endWeek="";
    }
    updRow(row.id,patch);
  }
  // Planned-bar colour: the row's own colour wins, then the subcontractor's colour,
  // then the default gold. Actual bars stay blue everywhere so "done" is always readable.
  function planColor(row){
    if(!row)return "#c9a84c";
    if(row.color)return row.color;
    var gc=(sc&&sc.groupColors)||{};
    if(row.group&&gc[row.group])return gc[row.group];            // set from this schedule
    var glob=window._ppSubColors||{};
    if(row.group&&glob[row.group])return glob[row.group];        // set in Settings
    return "#c9a84c";
  }
  function cellStyle(v,row){
    var pc=planColor(row);
    if(v==="plan")return{background:pc};
    if(v==="actual")return{background:"#1a73e8"};
    if(v==="both")return{background:"linear-gradient(180deg,"+pc+" 50%,#1a73e8 50%)"};
    return{};
  }

  // The schedule is far wider than a sheet of paper. Before printing we measure the real
  // table and scale it down so every week of the project fits across the page; without
  // this, the browser simply crops whatever did not fit.
  // Printing is a dialog, not a single button: a 40-week schedule on one A4 is unreadable,
  // so the user chooses how many sheets to spread the weeks over. Every sheet repeats the
  // Task and Subcont. columns, otherwise the later pages are meaningless.
  const [printOpts,setPrintOpts]=useState(null);
  function openPrint(){
    var n=wks.length;
    setPrintOpts({pages:n<=16?1:n<=32?2:3,risks:true,progress:false});
  }
  function runPrint(opts){
    setPrintOpts(null);
    setPrintPlan(opts);
    setTimeout(function(){
      document.body.classList.add("printing-schedule");
      if(!opts.risks)document.body.classList.add("print-norisks");
      setTimeout(function(){
        window.print();
        setTimeout(function(){
          document.body.classList.remove("printing-schedule");
          document.body.classList.remove("print-norisks");
          setPrintPlan(null);
        },600);
      },260);
    },60);
  }


  var wks=sc?scheduleWeeks(sc):[];
  var todayStr=today();
  // All groups (trades) currently used across the schedule, plus any declared on the schedule itself
  // Subcontractors offered on each row: the project list (Settings > Subcontractors, itself
  // merged with the Subcontractors tab) plus anything already used on this schedule.
  var allGroups=sc?[...new Set([...(window._ppSubList||[]),...(sc.groups||[]),...(sc.rows||[]).map(function(r){return r.group;}).filter(Boolean)])].sort(function(a,b){return a.localeCompare(b);}):[];

  // Group filter: keeps the room/category headers and only the tasks of the selected trade.
  // Rooms with no matching task are dropped entirely so the export stays clean.
  var groupRows=[];
  if(sc){
    if(!fGroup){
      groupRows=(sc.rows||[]).slice();
    }else{
      // Hide only the tasks belonging to another subcontractor. Room/category headers are
      // always kept so the schedule structure stays readable.
      groupRows=(sc.rows||[]).filter(function(r){return r.kind==="category"||r.group===fGroup;});
    }
  }

  // Hide the tasks of any collapsed room/category so long schedules stay readable
  var visibleRows=[];
  if(sc){
    var hiding=false;        // inside a collapsed room
    var hidingSection=false; // inside a collapsed section: hides its rooms too
    groupRows.forEach(function(r){
      if(r.kind==="section"){
        hidingSection=!!collapsedCats[r.id];
        hiding=false;
        visibleRows.push(r);
        return;
      }
      if(r.kind==="category"){
        hiding=!!collapsedCats[r.id];
        if(!hidingSection)visibleRows.push(r);
        return;
      }
      if(!hiding&&!hidingSection)visibleRows.push(r);
    });
  }
  // ---- Multi-selection --------------------------------------------------
  // Only real tasks can be selected (never room/category headers), and only among the
  // rows currently visible, so a bulk edit can never touch something off-screen.
  var selectableIds=visibleRows.filter(function(r){return r.kind!=="category";}).map(function(r){return r.id;});
  function toggleSelRow(id){
    setSelRows(function(prev){
      return prev.indexOf(id)>=0?prev.filter(function(x){return x!==id;}):prev.concat([id]);
    });
  }
  function bulkPatch(patch){
    if(!isAdmin){safeAlert("Batch editing is reserved for "+APP_ADMIN+".");return;}
    if(!sc||selRows.length===0)return;
    var ids={};selRows.forEach(function(id){ids[id]=1;});
    upd(sc.id,{rows:(sc.rows||[]).map(function(r){return ids[r.id]?Object.assign({},r,patch):r;})});
  }
  function bulkShift(delta){
    if(!isAdmin){safeAlert("Batch editing is reserved for "+APP_ADMIN+".");return;}
    if(!sc||selRows.length===0)return;
    selRows.forEach(function(id){shiftRow(id,delta);});
  }
  // drop from the selection anything that no longer exists or is no longer visible
  useEffect(function(){
    setSelRows(function(prev){
      var ok={};selectableIds.forEach(function(id){ok[id]=1;});
      var next=prev.filter(function(id){return ok[id];});
      return next.length===prev.length?prev:next;
    });
  },[selId,fGroup,sc?(sc.rows||[]).length:0]);

  // The pinned scrollbar is positioned in viewport coordinates so it is reachable from the
  // very top of the page, and it hides itself when the schedule scrolls out of sight.
  useEffect(function(){
    function measure(){
      var w=wrapRef.current;
      if(!w){setMirrorBox(function(p){return p.show?{show:false,left:0,width:0}:p;});return;}
      var need=w.scrollWidth>w.clientWidth+1?w.scrollWidth:0;
      setSchedScrollW(function(prev){return prev===need?prev:need;});
      var r=w.getBoundingClientRect();
      var visible=need>0&&r.bottom>60&&r.top<window.innerHeight-40;
      var next={show:visible,left:Math.round(r.left),width:Math.round(r.width)};
      setMirrorBox(function(p){
        return (p.show===next.show&&p.left===next.left&&p.width===next.width)?p:next;
      });
    }
    measure();
    var t=setTimeout(measure,120);                             // after fonts/layout settle
    var sc2=document.querySelector(".content");
    window.addEventListener("resize",measure);
    window.addEventListener("scroll",measure,true);
    if(sc2)sc2.addEventListener("scroll",measure);
    return function(){
      clearTimeout(t);
      window.removeEventListener("resize",measure);
      window.removeEventListener("scroll",measure,true);
      if(sc2)sc2.removeEventListener("scroll",measure);
    };
  });

  function toggleCat(id){setCollapsedCats(function(prev){var o=Object.assign({},prev);if(o[id])delete o[id];else o[id]=true;return o;});}
  function setAllCats(collapse){
    if(!sc)return;
    var o={};
    if(collapse)(sc.rows||[]).forEach(function(r){if(r.kind==="category")o[r.id]=true;});
    setCollapsedCats(o);
  }

  return <div className={fullScreen?"sched-fs":""} style={fullScreen?{position:"fixed",inset:0,zIndex:1200,background:"#f4f3f0",padding:"10px 14px",overflowY:"auto"}:null}>
    {fullScreen&&<div className="sched-noprint" style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
      <button className="btn btn-pri" onClick={function(){setFullScreen(false);}} title="Back to the zone (Esc)"
        style={{fontSize:13,padding:"7px 16px"}}>← Back</button>
      <span style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:17}}>{curZone} — {sc?sc.title:""}</span>
      <span style={{fontSize:11,color:"#aaa"}}>press Esc to leave full screen</span>
    </div>}
    {backTo&&<div className="sched-noprint" style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,
      padding:"8px 12px",borderRadius:8,background:"var(--blue-soft,#e8f0fe)",border:"1.5px solid #c6d9f5"}}>
      <span style={{fontSize:12,color:"var(--blue,#0f5299)"}}>You came here from <b>{backTo.label}</b></span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}}
        onClick={function(){var id=backTo.id;setBackTo(null);if(onNavTender)onNavTender(id);}}>↩ Back to the tender</button>
      <button className="btn btn-sm" onClick={function(){setBackTo(null);}} title="Stay in the schedule">✕</button>
    </div>}
    <div className={"sched-noprint"+(fullScreen?" sched-fs-hide":"")} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
      {zoneScheds.map(function(s){
        return <button key={s.id} className={"fchip"+(sc&&sc.id===s.id?" on":"")} onClick={function(){setSelId(s.id);}}>{s.title}</button>;
      })}
      <button className="btn btn-sm btn-gold" onClick={addSchedule}>＋ New schedule</button>
    </div>

    {!sc
      ?<div className="empty"><div className="empty-ico">📅</div><div className="empty-txt">No schedule for {curZone} yet. Create one to plan work week by week.</div></div>
      :<div>
        <div className={"sched-noprint"+(fullScreen?" sched-fs-hide":"")} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10,padding:"10px 12px",background:"#fafaf8",borderRadius:8,border:"1px solid #e8e6df"}}>
          <div style={{flex:2,minWidth:170}}>
            <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Title</label>
            <input type="text" value={sc.title||""} onChange={function(e){upd(sc.id,{title:e.target.value});}} style={{padding:"4px 8px",fontSize:12,fontWeight:600}}/>
          </div>
          <div style={{flex:1,minWidth:130}}>
            <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Start week</label>
            <input type="date" min="1990-01-01" max="2200-12-31" value={sc.startDate||""} onChange={function(e){upd(sc.id,{startDate:e.target.value});}} style={{padding:"4px 8px",fontSize:12}}/>
          </div>
          <div style={{flex:1,minWidth:90}}>
            <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Nb weeks</label>
            <input type="number" min="1" max="52" value={sc.weeks||12} onChange={function(e){upd(sc.id,{weeks:Number(e.target.value)});}} style={{padding:"4px 8px",fontSize:12}}/>
          </div>
          <select value="" onChange={function(e){if(e.target.value){duplicateToZone(e.target.value);e.target.value="";}}} style={{width:"auto",padding:"5px 8px",fontSize:11}} title="Copy this whole schedule into another zone">
            <option value="">⧉ Copy to zone…</option>
            {(zones||[]).filter(function(z){return z!==curZone;}).map(function(z){return <option key={z} value={z}>{z}</option>;})}
          </select>
          <div style={{display:"flex",alignItems:"center",gap:4,paddingLeft:8,borderLeft:"1px solid #e0ddd6"}}>
            <span style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase"}}>Subcont.</span>
            <select value={fGroup} onChange={function(e){setFGroup(e.target.value);}} title="Show only the tasks of one subcontractor — room headers stay visible"
              style={{width:"auto",padding:"4px 8px",fontSize:11,fontWeight:fGroup?700:400,color:fGroup?"#00695c":"inherit",border:"1px solid "+(fGroup?"#00695c":"#e8e6df"),borderRadius:6}}>
              <option value="">All subcontractors</option>
              {allGroups.map(function(g){return <option key={g} value={g}>{g}</option>;})}
            </select>
            {fGroup&&<span style={{fontSize:10,color:"#00695c",fontWeight:700}}>{groupRows.filter(function(r){return r.kind!=="category";}).length} task(s)</span>}
            {/* Adding a subcontractor used to be an 80px box that only reacted to Enter, with
                no button and no feedback — people could not find it. */}
            {canEdit&&<span style={{display:"flex",gap:4,alignItems:"center"}}>
              <input type="text" value={newGroup} onChange={function(e){setNewGroup(e.target.value);}}
                onKeyDown={function(e){if(e.key==="Enter")addGroupNow();}}
                title="Adds the company to this schedule. For a name you will reuse in other zones, add it in Settings › 👷 Subcontractors instead."
                placeholder="+ add subcontractor…" style={{width:170,padding:"5px 8px",fontSize:11}}/>
              <button className="btn btn-sm" disabled={!newGroup.trim()} onClick={addGroupNow}
                style={{padding:"3px 10px",fontSize:11}}>＋ Add</button>
            </span>}
          </div>
          <button className="btn btn-sm" onClick={openPrint}>🖨 Print / PDF</button>
          {isAdmin&&<button className="btn btn-sm btn-danger" onClick={function(){delSchedule(sc.id);}} title="Delete this schedule (admin only)">🗑</button>}
        </div>

        {canEdit&&isAdmin&&selRows.length>0&&<div className="sched-noprint" style={{padding:"8px 12px",background:"#e8f0fe",border:"1.5px solid #1a73e8",borderRadius:8,marginBottom:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:800,color:"#1a73e8"}}>{selRows.length} task{selRows.length!==1?"s":""} selected</span>

          <select value={bulkTender} onChange={function(e){
            var v=e.target.value;setBulkTender("");
            if(!v)return;
            bulkPatch({tenderRef:v});
            setTimeout(function(){pushStartOnSiteFromSchedule(v);},0);
          }} title="Link every selected task to one tender" style={{width:"auto",padding:"4px 8px",fontSize:11}}>
            <option value="">🔗 Link to tender…</option>
            {(tenders||[]).slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}{t.package?" ("+t.package+")":""}</option>;})}
          </select>

          <select value={bulkGroup} onChange={function(e){var v=e.target.value;setBulkGroup("");if(v)bulkPatch({group:v==="__none__"?"":v});}}
            title="Assign a subcontractor to every selected task" style={{width:"auto",padding:"4px 8px",fontSize:11}}>
            <option value="">👷 Set subcontractor…</option>
            <option value="__none__">— clear —</option>
            {allGroups.map(function(g){return <option key={g} value={g}>{g}</option>;})}
          </select>

          <select value={bulkRoom} onChange={function(e){var v=e.target.value;setBulkRoom("");if(v)bulkPatch({roomId:v==="__none__"?"":v});}}
            title="Move every selected task to one room" style={{width:"auto",padding:"4px 8px",fontSize:11}}>
            <option value="">🚪 Set room…</option>
            <option value="__none__">— clear —</option>
            {(rooms||[]).filter(function(rm){return rm.zone===curZone;}).map(function(rm){return <option key={rm.id} value={rm.id}>{rm.name}</option>;})}
          </select>

          <span style={{display:"flex",gap:3,alignItems:"center"}}>
            <button className="btn btn-sm" onClick={function(){bulkShift(-1);}} title="Shift every selected task 1 week earlier">◀ 1wk</button>
            <button className="btn btn-sm" onClick={function(){bulkShift(1);}} title="Shift every selected task 1 week later">1wk ▶</button>
          </span>

          <button className="btn btn-sm" onClick={function(){setSelRows([]);}} style={{marginLeft:"auto"}}>✕ Clear selection</button>
        </div>}

        {critPath&&<div className="sched-noprint" style={{padding:"9px 12px",background:"#fdf1e0",border:"1.5px solid #e6c48c",borderRadius:8,marginBottom:10,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontWeight:800,fontSize:12,color:"var(--amber,#b35c00)"}}>🎯 CRITICAL PATH</span>
          <span style={{fontFamily:"var(--font-mono)",fontSize:12,fontWeight:700}}>{critPath.weeks} working week{critPath.weeks!==1?"s":""}</span>
          <span style={{fontSize:11,color:"var(--ink-3,#6f6b62)"}}>{critPath.order.length} linked task{critPath.order.length!==1?"s":""}
            {critPath.startWeek?" · "+fmtDate(critPath.startWeek):""}{critPath.endWeek?" → "+fmtDate(critPath.endWeek):""}</span>
          <span style={{fontSize:11,color:"var(--ink-3,#6f6b62)",flex:1,minWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
            title={critPath.labels.join("  →  ")}>{critPath.labels.join(" → ")}</span>
          <button className={"btn btn-sm"+(showFloat?" btn-pri":"")} onClick={function(){setShowFloat(!showFloat);}}
            title="Float = how many working weeks a task can slip before it delays the end of the schedule. Zero means it is critical.">
            {showFloat?"◧ Hide float":"◫ Show float"}</button>
          <button className="btn btn-sm" onClick={function(){setCritPath(null);setShowFloat(false);}}>✕ Hide</button>
        </div>}
        {procRisks.length>0&&<div style={{padding:"8px 12px",background:"#fff5f7",border:"1.5px solid #f48fb1",borderRadius:8,marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:700,color:"#c62828",marginBottom:4}}>🚚 {procRisks.length} task{procRisks.length!==1?"s":""} at risk from procurement</div>
          {procRisks.slice(0,5).map(function(x){
            return <div key={x.row.id} style={{fontSize:11,color:"#555"}}>
              <strong>{x.row.label}</strong> — {x.risk.tender.title} delivers {fmtDate(x.risk.delivery)}, starts week of {fmtDate(x.risk.startWeek)}
              {x.risk.late&&<span style={{color:"#c62828",fontWeight:700}}> ({x.risk.weeksLate}w late)</span>}
              {x.risk.tight&&<span style={{color:"#b45309"}}> (no margin)</span>}
            </div>;
          })}
          {procRisks.length>5&&<div style={{fontSize:10,color:"#888",marginTop:3}}>+{procRisks.length-5} more…</div>}
        </div>}

        {canEdit===false&&<div className="sched-noprint" style={{padding:"8px 12px",background:"#f0f8ff",border:"1px solid #bbdefb",borderRadius:8,marginBottom:10,fontSize:12,color:"#1565c0"}}>
          👁 Read-only — only the leaders of {curZone} can modify this schedule.
        </div>}

        <div className="sched-print-only">
          <div style={{fontSize:16,fontWeight:800}}>{sc.title}{fGroup?" — "+fGroup:""}</div>
          <div style={{fontSize:11,color:"#555"}}>{curZone} · {fmtDate(wks[0]||sc.startDate)} → {fmtDate(wks[wks.length-1]||sc.startDate)} · printed {fmtDate(todayStr)}{fGroup?" · subcontractor: "+fGroup:""}</div>
        </div>

        <div className="sched-noprint" style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center",padding:"8px 10px",background:"#fffdf0",border:"1px solid #f0e2b8",borderRadius:8}}>
          <select value={newRowKind} onChange={function(e){setNewRowKind(e.target.value);}} style={{width:"auto",padding:"5px 8px",fontSize:12}}>
            <option value="task">Task</option>
            <option value="category">Category / Room</option>
            <option value="section">Section (groups rooms)</option>
          </select>
          <input type="text" value={newRowLabel} onChange={function(e){setNewRowLabel(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addRow();}} placeholder={newRowKind==="section"?"Section name, e.g. EXTERNAL WORKS":newRowKind==="category"?"Room name, e.g. POOL":"Task name, e.g. Slab"} style={{flex:1,minWidth:180,padding:"5px 10px",fontSize:12}}/>
          <select value={newRowAfter} onChange={function(e){setNewRowAfter(e.target.value);}} style={{width:"auto",maxWidth:200,padding:"5px 8px",fontSize:12}} title="Where to insert the new row">
            <option value="">At the end</option>
            {(sc.rows||[]).map(function(o){
              return <option key={o.id} value={o.id}>{o.kind==="category"?"In ▸ "+(o.label||"(untitled)"):"After: "+(o.label||"(untitled)")}</option>;
            })}
          </select>
          <button className="btn btn-sm btn-gold" onClick={addRow} disabled={!newRowLabel.trim()}>＋ Add row</button>
        </div>

        <div className="sched-noprint" style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
          <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase"}}>Click cells to fill as:</span>
          <button onClick={function(){setPaintMode("plan");}} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(paintMode==="plan"?"#c9a84c":"#ddd"),background:paintMode==="plan"?"#fffdf0":"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",color:paintMode==="plan"?"#b45309":"#aaa"}}>
            <span style={{width:14,height:10,background:"#c9a84c",borderRadius:2}}></span> Planned
          </button>
          <button onClick={function(){setPaintMode("actual");}} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(paintMode==="actual"?"#1a73e8":"#ddd"),background:paintMode==="actual"?"#f0f8ff":"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",color:paintMode==="actual"?"#1a73e8":"#aaa"}}>
            <span style={{width:14,height:10,background:"#1a73e8",borderRadius:2}}></span> Actual
          </button>
          <button onClick={function(){setPaintMode("progress");}} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(paintMode==="progress"?"#7b1fa2":"#ddd"),background:paintMode==="progress"?"#f3e5f5":"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",color:paintMode==="progress"?"#7b1fa2":"#aaa"}}>
            % Progress
          </button>
          <span style={{display:"flex",gap:3,alignItems:"center",paddingRight:6,borderRight:"1px solid #e0ddd6"}}>
            <button className="btn btn-sm" onClick={function(){var el=document.querySelector(".sched-wrap");if(el)el.scrollLeft-=400;}} title="Scroll back in time" style={{padding:"2px 8px",fontSize:11}}>◀◀</button>
            <button className="btn btn-sm" onClick={function(){
              var el=document.querySelector(".sched-wrap");if(!el)return;
              var idx=wks.findIndex(function(w){var e=new Date(w);e.setDate(e.getDate()+6);return w<=todayStr&&todayStr<=toISO(e);});
              if(idx>=0)el.scrollLeft=Math.max(0,250+320+idx*40-el.clientWidth/2);
            }} title="Jump to the current week" style={{padding:"2px 8px",fontSize:11}}>Today</button>
            <button className="btn btn-sm" onClick={function(){var el=document.querySelector(".sched-wrap");if(el)el.scrollLeft+=400;}} title="Scroll forward in time" style={{padding:"2px 8px",fontSize:11}}>▶▶</button>
          </span>
          <span style={{display:"flex",gap:4,alignItems:"center",paddingRight:8,borderRight:"1px solid var(--rule,#ddd9cf)"}}>
          <button className={"btn btn-sm"+(monthView?" btn-pri":"")} onClick={function(){setMonthView(!monthView);}}
            title={monthView?"Back to the full week grid":"Phone view: the next four weeks, task by task, grouped by room"}
            style={{padding:"2px 8px",fontSize:10}}>{monthView?"▦ Grid":"📱 Next 4 weeks"}</button>
          <button className="btn btn-sm btn-pri" onClick={function(){setFullScreen(!fullScreen);}}
            title={fullScreen?"Back to the zone view (Esc)":"Show the schedule full screen"}
            style={{padding:"2px 10px",fontSize:10}}>{fullScreen?"⤡ Exit":"⤢ Expand"}</button>
          <button className="btn btn-sm" onClick={function(){setAllCats(true);}} style={{padding:"2px 8px",fontSize:10}}>▸ Collapse all</button>
          <button className="btn btn-sm" onClick={function(){setAllCats(false);}} style={{padding:"2px 8px",fontSize:10}}>▾ Expand all</button>
          </span>
          <span style={{display:"flex",gap:4,alignItems:"center",paddingRight:8,borderRight:"1px solid var(--rule,#ddd9cf)"}}>
          <span style={{fontSize:9,fontWeight:700,color:"var(--ink-4,#9b968b)",textTransform:"uppercase",letterSpacing:".06em",marginRight:2}}>Analyse</span>
          <button className={"btn btn-sm"+(critPath?" btn-pri":"")}
            title="Longest chain of dependent tasks — the sequence that sets the end date of this schedule"
            onClick={function(){
              if(critPath){setCritPath(null);return;}
              var cp=computeCriticalPath();
              if(!cp){safeAlert("No critical path to show.\n\nTasks need a duration (painted bars or a start/end week) and at least one “starts after” link.");return;}
              setCritPath(cp);
            }} style={{padding:"2px 8px",fontSize:10,borderColor:critPath?"":"var(--amber,#b35c00)",color:critPath?"":"var(--amber,#b35c00)",fontWeight:700}}>🎯 Critical path</button>
          {canEdit&&<button className="btn btn-sm" title="Apply the subcontractor → tender rules (Settings › Tender rules) to every task of this schedule"
            onClick={function(){
              var rules=window._ppTenderRules||[];
              if(rules.length===0){safeAlert("No rule yet.\n\nCreate them in Settings › 🔗 Tender rules: “every task of <subcontractor> in <zone> belongs to <tender>”.");return;}
              var hits=[],conflicts=0;
              (sc.rows||[]).forEach(function(r){
                if(r.kind!=="task"&&r.kind!==undefined)return;
                if(!r.group)return;
                var rule=tenderRuleFor(rules,r.group,curZone);
                if(!rule)return;
                if(r.tenderRef===rule.tenderId)return;
                if(r.tenderRef){conflicts++;return;}     // never overwrite a manual link
                hits.push({row:r,tenderId:rule.tenderId});
              });
              if(hits.length===0){
                safeAlert(conflicts>0
                  ?"Nothing to do: "+conflicts+" task(s) already point at a different tender and are left untouched."
                  :"Nothing to do: every task with a subcontractor already matches its rule.");
                return;
              }
              var names=hits.slice(0,6).map(function(h){return "· "+(h.row.label||"(untitled)");}).join("\n");
              if(!safeConfirm("Link "+hits.length+" task(s) to their tender?\n\n"+names+(hits.length>6?"\n… and "+(hits.length-6)+" more":"")+
                (conflicts>0?"\n\n"+conflicts+" task(s) already have a different tender and will NOT be touched.":"")))return;
              var map={};hits.forEach(function(h){map[h.row.id]=h.tenderId;});
              upd(sc.id,{rows:(sc.rows||[]).map(function(r){return map[r.id]?Object.assign({},r,{tenderRef:map[r.id]}):r;})});
              [...new Set(hits.map(function(h){return h.tenderId;}))].forEach(function(id){
                setTimeout(function(){pushStartOnSiteFromSchedule(id);},0);
              });
            }} style={{padding:"2px 8px",fontSize:10}}>🔗 Apply rules</button>}
          </span>
          <span style={{display:"flex",gap:4,alignItems:"center"}}>
          <button className="btn btn-sm" onClick={function(){setShowDocs(true);}}
            title="Reference documents: setting-out plans, sections, details. Attach one to a room and its name becomes clickable in the schedule."
            style={{padding:"2px 8px",fontSize:10}}>📄 Documents{scDocs.length>0?" ("+scDocs.length+")":""}</button>
          {isAdmin&&<button className="btn btn-sm btn-danger" title="Remove the duplicate 'Procurement late for…' actions created by the old auto-rule, keeping one per task"
            onClick={function(){
              var seen={},dropped=0;
              var kept=(tasks||[]).filter(function(t){
                if(t.addedBy!=="System")return true;
                if((t.text||"").indexOf("Procurement late for: ")!==0)return true;
                if(t.status==="done"){dropped++;return false;}
                var k=t.autoKey||("proclate:"+t.scheduleRowRef+":"+t.tenderRef);
                if(seen[k]){dropped++;return false;}
                seen[k]=1;return true;
              });
              if(dropped===0){safeAlert("Nothing to clean — no duplicate auto-action found.");return;}
              if(!safeConfirm("Delete "+dropped+" duplicate or closed auto-action(s)?\n\nOne open action per task is kept. Actions you wrote yourself are never touched."))return;
              saveTasks(kept);
            }} style={{padding:"2px 8px",fontSize:10}}>🧹 Clean auto-actions</button>}
          {canEdit&&<button className="btn btn-sm" onClick={sortCategories} title="Sort categories A→Z. Each one keeps its own tasks." style={{padding:"2px 8px",fontSize:10}}>🔤 Sort A→Z</button>}

          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#888",paddingLeft:6,borderLeft:"1px solid #e0ddd6"}}>
            <span style={{width:14,height:10,borderRadius:2,background:"repeating-linear-gradient(45deg,#e8e4da,#e8e4da 3px,#dcd8ce 3px,#dcd8ce 6px)"}}></span>
            Click a week header to neutralise it (holiday) — shifts skip over it
          </span>
          </span>
          <span style={{fontSize:10,color:"#888",paddingLeft:6,borderLeft:"1px solid #e0ddd6"}}>◀ ▶ shifts a row, linked rows follow</span>
          {sc.updatedAt&&<span style={{fontSize:10,color:"#aaa",marginLeft:"auto"}}>Last update {fmtDate(sc.updatedAt)}{sc.updatedBy?" by "+sc.updatedBy.split(",")[0]:""}</span>}
        </div>

        {monthView&&<div className="sched-noprint">
          {monthWindows().length===0&&<div className="empty"><div className="empty-ico">📅</div>
            <div className="empty-txt">This schedule has no week covering today.</div></div>}
          {monthWindows().map(function(win){
            var items=tasksInWeek(win.week);
            var label=win.offset===0?"This week":win.offset===1?"Next week":"In "+win.offset+" weeks";
            return <div key={win.week} style={{marginBottom:16}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8,padding:"7px 10px",borderRadius:8,
                background:win.offset===0?"var(--ink,#16181d)":"#f0ede6",color:win.offset===0?"#fff":"var(--ink,#16181d)",marginBottom:8}}>
                <span style={{fontWeight:700,fontSize:13}}>{label}</span>
                <span style={{fontFamily:"var(--font-mono)",fontSize:11,opacity:.75}}>{fmtDate(win.week)} → {fmtDate(win.end)}</span>
                <span style={{marginLeft:"auto",fontSize:11,opacity:.75}}>{win.holiday?"shutdown":items.length+" task"+(items.length!==1?"s":"")}</span>
              </div>

              {items.length===0&&<div style={{fontSize:12,color:"var(--ink-4,#9b968b)",padding:"2px 4px 8px"}}>Nothing planned.</div>}

              {(function(){
                // group the week's tasks by room so a phone reader knows where to go
                var byRoom={},order=[];
                items.forEach(function(it){
                  var k=it.room||"—";
                  if(!byRoom[k]){byRoom[k]=[];order.push(k);}
                  byRoom[k].push(it);
                });
                return order.map(function(rk){
                  return <div key={rk} style={{marginBottom:9}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",
                      color:"var(--ink-3,#6f6b62)",padding:"0 2px 4px"}}>{rk}</div>
                    {byRoom[rk].map(function(it){
                      var r=it.row;
                      var pr=procRisk(r), pq=prereqState(r);
                      var done=it.cell==="actual"||it.cell==="both";
                      return <div key={r.id} style={{display:"flex",gap:10,alignItems:"flex-start",background:"#fff",
                        border:"1.5px solid "+(done?"#c8e6c9":"var(--rule,#ddd9cf)"),borderLeft:"4px solid "+planColor(r),
                        borderRadius:9,padding:"9px 11px",marginBottom:6}}>
                        <div onClick={canEdit?function(){
                            var cells=Object.assign({},r.cells||{});
                            var cur=cells[win.week]||"";
                            cells[win.week]=(cur==="actual"||cur==="both")?(cur==="both"?"plan":""):(cur==="plan"?"both":"actual");
                            if(!cells[win.week])delete cells[win.week];
                            updRow(r.id,{cells:cells});
                          }:null}
                          title={canEdit?"Mark this week as done on site":"Read only"}
                          style={{width:24,height:24,borderRadius:7,flexShrink:0,cursor:canEdit?"pointer":"default",
                            display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,
                            border:"2px solid "+(done?"var(--green,#1e6b3a)":"#ddd"),
                            background:done?"var(--green,#1e6b3a)":"#fff",color:"#fff"}}>{done?"✓":""}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:600,lineHeight:1.35}}>{r.label||"(untitled)"}</div>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:5}}>
                            {r.group&&<span className="badge" style={{background:planColor(r),color:"#fff"}}>{r.group}</span>}
                            {r.qty&&<span style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--ink-3,#6f6b62)"}}>{r.qty} {r.unit||""}</span>}
                            {pr&&pr.late&&<span className="badge" style={{background:"var(--red-soft,#fbe6e8)",color:"var(--red,#b3302a)"}}
                              title={"Delivery "+fmtDate(pr.delivery)}>🔴 material late</span>}
                            {pr&&!pr.late&&pr.tight&&<span className="badge" style={{background:"var(--amber-soft,#fdf1e0)",color:"var(--amber,#b35c00)"}}>🟠 tight</span>}
                            {pq&&pq.tbc>0&&<span className="badge" style={{background:"var(--gold-soft,#faf3e0)",color:"var(--gold-ink,#8a6a1e)"}}>🔒 {pq.tbc} TBC</span>}
                            {critPath&&critPath.ids[r.id]&&<span className="badge" style={{background:"var(--amber-soft,#fdf1e0)",color:"var(--amber,#b35c00)"}}>🎯 critical</span>}
                          </div>
                        </div>
                      </div>;
                    })}
                  </div>;
                });
              })()}
            </div>;
          })}
        </div>}

        {!monthView&&<div className="sched-wrap" ref={wrapRef} onScroll={function(){syncScroll("wrap");}} style={{overflowX:"auto",overflowY:"auto",maxHeight:fullScreen?"calc(100vh - 175px)":"62vh",border:"1px solid #e8e6df",borderRadius:"8px 8px 0 0",background:"#fff"}}>
          <table style={{borderCollapse:"collapse",width:"max-content",minWidth:"100%",fontSize:11}}>
            <thead>
              <tr>
                <th style={{position:"sticky",left:0,top:0,background:"#f5f4f0",zIndex:4,width:380,minWidth:380,maxWidth:380,textAlign:"left",padding:"6px 10px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>
                  {canEdit&&isAdmin&&<input type="checkbox" className="sched-noprint" checked={selRows.length>0&&selRows.length===selectableIds.length}
                    onChange={function(e){setSelRows(e.target.checked?selectableIds.slice():[]);}}
                    title="Select every task" style={{width:12,height:12,marginRight:6,verticalAlign:"middle",cursor:"pointer"}}/>}
                  Task</th>
                <th style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:120,minWidth:120,maxWidth:120,textAlign:"left",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>Subcont.</th>
                <th style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:86,minWidth:86,maxWidth:86,textAlign:"right",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>Rate</th>
                <th className="sched-noprint" style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:320,minWidth:320,maxWidth:320,textAlign:"left",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>Room / starts after</th>
                {wks.map(function(wk){
                  var isCur=(function(){var d=new Date(wk);var e=new Date(wk);e.setDate(e.getDate()+6);return wk<=todayStr&&todayStr<=toISO(e);})();
                  var hol=isHoliday(wk);
                  return <th key={wk} onClick={function(){toggleHolidayWeek(wk);}}
                    title={hol?"Neutralised week (holiday/shutdown) — click to re-activate":"Click to neutralise this week (holiday/shutdown)"}
                    style={{position:"sticky",top:0,zIndex:3,width:40,minWidth:40,maxWidth:40,padding:"4px 2px",borderBottom:"1.5px solid #e8e6df",borderLeft:"1px solid #f0ede6",cursor:"pointer",
                      background:hol?"#d5d1c8":isCur?"#fff8e1":"#f5f4f0",
                      fontSize:8,color:hol?"#fff":isCur?"#f57f17":"#888",fontWeight:(isCur||hol)?800:600}}>
                    {hol?"⊘":fmtDate(wk).slice(0,5)}
                  </th>;
                })}
                              </tr>
            </thead>
            <tbody>
              {(sc.rows||[]).length===0&&<tr><td colSpan={wks.length+4} style={{padding:"14px",textAlign:"center",color:"#bbb",fontSize:12}}>No rows yet. Add a category or a task below.</td></tr>}
              {visibleRows.map(function(row){
                var pqRows=(row.kind==="category")?[]:prereqsOf(row.id);
                var isSection=row.kind==="section";
                var isCat=row.kind==="category"||isSection;   // both are headers, not tasks
                var isSel=selRows.indexOf(row.id)>=0;
                var rowRisk=isCat?null:procRisk(row);
                var onCrit=!!(critPath&&critPath.ids[row.id]);
                // A category shows the documents of its room; a task inherits the ones of the
                // category it sits under, so a drawing is reachable from every line it covers.
                var rowDocs=(function(){
                  if(isCat)return row.roomId?docsForRoom(row.roomId):[];
                  var all=(sc.rows||[]);
                  var idx=all.findIndex(function(x){return x.id===row.id;});
                  for(var k=idx;k>=0;k--){if(all[k].kind==="category")return all[k].roomId?docsForRoom(all[k].roomId):[];}
                  return [];
                })();
                var rowPq=isCat?null:prereqState(row);
                var collapsed=isCat&&collapsedCats[row.id];
                var warn=rowWarning(row.id);
                var warnColor=warn?(warn.severity==="blocking"?"#c62828":warn.severity==="warning"?"#ef6c00":warn.severity==="late"?"#e65100":"#f57f17"):"";
                return <React.Fragment key={row.id}>
                {pqRows.map(function(pq){
                  var ok=pq.status==="done"||!!pq.dateConfirmed;
                  return <tr key={"pq"+pq.id} className="sched-noprint">
                    <td style={{position:"sticky",left:0,zIndex:1,background:ok?"#f3f8f3":"#fffdf3",padding:"1px 10px 1px 26px",borderBottom:"1px dashed #e8e6df",borderRight:"1.5px solid #e8e6df"}}>
                      <span style={{fontSize:9,fontWeight:800,color:ok?"#2e7d32":"#f57f17",marginRight:5}}>🔒</span>
                      <span style={{fontSize:10,color:ok?"#7a8a7a":"#8a7550",textDecoration:ok?"line-through":"none"}}>{pq.text}</span>
                      {pq.owner&&<span style={{fontSize:9,color:"#aaa",marginLeft:6}}>· {pq.owner}</span>}
                      <span onClick={function(){if(!canEdit)return;saveTasks((tasks||[]).map(function(x){return x.id!==pq.id?x:stampModified(Object.assign({},x,{dateConfirmed:!ok}));}));}}
                        title={ok?"Date confirmed — click for TBC":"Date to be confirmed — click to confirm"}
                        style={{fontSize:8,fontWeight:800,marginLeft:6,padding:"0 5px",borderRadius:8,cursor:canEdit?"pointer":"default",
                          background:ok?"#e8f5e9":"#fff8e1",color:ok?"#2e7d32":"#f57f17",border:"1px solid "+(ok?"#c8e6c9":"#ffe082")}}>
                        {ok?"✓":"TBC"}</span>
                    </td>
                    <td style={{padding:"1px 6px",borderBottom:"1px dashed #e8e6df",background:ok?"#f3f8f3":"#fffdf3",fontSize:9,color:"#aaa"}}>prerequisite</td>
                    <td style={{padding:"1px 8px",borderBottom:"1px dashed #e8e6df",background:ok?"#f3f8f3":"#fffdf3",fontSize:9,textAlign:"right",color:"#888",whiteSpace:"nowrap"}}>{pq.due?fmtDate(pq.due):"—"}</td>
                    <td className="sched-noprint" style={{borderBottom:"1px dashed #e8e6df",background:ok?"#f3f8f3":"#fffdf3"}}></td>
                    {wks.map(function(w){
                      var hit=pq.due&&w<=pq.due&&pq.due<=(function(){var d=new Date(w);d.setDate(d.getDate()+6);return toISO(d);})();
                      return <td key={w} style={{borderBottom:"1px dashed #e8e6df",borderLeft:"1px solid #f5f4f0",height:14,textAlign:"center",fontSize:8,
                        background:ok?"#f3f8f3":"#fffdf3",color:ok?"#2e7d32":"#f57f17"}}>{hit?"◆":""}</td>;
                    })}
                  </tr>;
                })}
                <tr style={{background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff"}}>
                  <td style={{position:"sticky",left:0,zIndex:1,background:focusRow===row.id?"#fff8e1":isSel?"#e8f0fe":isSection?"var(--ink,#16181d)":isCat?"#f0ede6":"#fff",padding:isSection?"5px 10px":"3px 10px",borderBottom:isSection?"1.5px solid var(--ink,#16181d)":"1px solid #f5f4f0",borderRight:"1.5px solid #e8e6df",boxShadow:focusRow===row.id?"inset 3px 0 0 #f57f17":onCrit?"inset 3px 0 0 var(--amber,#b35c00)":(critPath&&critPath.zeroFloat[row.id])?"inset 3px 0 0 #e6c48c":"none"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3}}>
                      {canEdit&&isAdmin&&!isCat&&<input type="checkbox" className="sched-noprint" checked={isSel}
                        onChange={function(){toggleSelRow(row.id);}}
                        title="Select this task for bulk editing" style={{width:12,height:12,flexShrink:0,cursor:"pointer",marginRight:2}}/>}
                      {isCat&&<button className="sched-noprint" onClick={function(){toggleCat(row.id);}}
                        title={collapsed?"Expand this room":"Collapse this room"}
                        style={{background:"none",border:"none",cursor:"pointer",color:"#888",fontSize:10,padding:"0 2px",flexShrink:0,fontWeight:800}}>{collapsed?"▸":"▾"}</button>}
                      <span className="sched-noprint" style={{display:"flex",flexDirection:"column",flexShrink:0,lineHeight:0.8}}>
                        <button onClick={function(){moveRow(row.id,-1);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:8,padding:0}} title="Move up">▲</button>
                        <button onClick={function(){moveRow(row.id,1);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:8,padding:0}} title="Move down">▼</button>
                      </span>
                      {canEdit&&<button className="sched-noprint" onClick={function(){insertTaskAfter(row.id);}}
                        style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:12,fontWeight:700,padding:"0 1px",flexShrink:0,lineHeight:1}}
                        onMouseEnter={function(e){e.currentTarget.style.color="#1e6b3a";}}
                        onMouseLeave={function(e){e.currentTarget.style.color="#ccc";}}
                        title={isCat?"Add a task at the top of this category":"Insert a task just below this one"}>＋</button>}
                      <button className="sched-noprint" onClick={function(){isCat?duplicateCategoryBlock(row.id):duplicateRow(row.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:10,padding:"0 1px",flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#1a73e8";}} onMouseLeave={function(e){e.currentTarget.style.color="#ccc";}} title={isCat?"Duplicate this category with all its tasks":"Duplicate this row"}>⧉</button>
                      <button className="sched-noprint" onClick={function(){delRow(row.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:10,padding:"0 1px",flexShrink:0}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}} title="Delete row">🗑</button>
                      <input type="text" value={row.label||""} onChange={function(e){updRow(row.id,{label:e.target.value});}}
                        ref={function(el){if(el&&editRowId===row.id){el.focus();setEditRowId(null);}}}
                        placeholder={isCat?"Category name…":"Task name…"}
                        style={{flex:1,minWidth:0,border:"none",background:"transparent",
                          fontSize:isSection?12.5:isCat?12:11,fontWeight:isSection?800:isCat?700:500,
                          letterSpacing:isSection?".08em":"normal",textTransform:isCat?"uppercase":"none",
                          color:isSection?"#fff":rowDocs.length>0?"#1a73e8":isCat?"#555":"#333",
                          textDecoration:rowDocs.length>0&&!isSection?"underline":"none",
                          padding:"2px 0",paddingLeft:isCat?0:12,outline:"none",fontFamily:"inherit",
                          cursor:rowDocs.length>0?"pointer":"text"}}/>
                      {rowDocs.length>0&&<span className="sched-noprint"
                        onClick={function(){
                          if(rowDocs.length===1){openDoc(rowDocs[0].url);return;}
                          setShowDocs(true);
                        }}
                        title={rowDocs.length===1
                          ?"Open \""+(rowDocs[0].title||"document")+"\" in a new tab"
                          :rowDocs.length+" documents attached — open the list"}
                        style={{cursor:"pointer",fontSize:11,flexShrink:0,color:"#1a73e8"}}>
                        📐{rowDocs.length>1?rowDocs.length:""}</span>}
                      {warn&&<span
                        onMouseEnter={function(e){var r2=e.currentTarget.getBoundingClientRect();setHoverInfo({rowId:row.id,x:r2.left,y:r2.bottom+6});}}
                        onMouseLeave={function(){setHoverInfo(null);}}
                        style={{cursor:"help",fontSize:13,lineHeight:1,color:warnColor,flexShrink:0}}>
                        {warn.severity==="blocking"?"🔴":warn.severity==="warning"?"🟠":"⚠️"}
                      </span>}
                      {!isCat&&(function(){
                        var pg=rowProgress(row);
                        var lw=latestWeekProgress(row);
                        if(pg===null)return null;
                        return <span title={lw?"Latest entry: "+lw.pct+"% at week of "+fmtDate(lw.week):"Derived from actual vs planned bars"}
                          style={{fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:8,flexShrink:0,cursor:"help",
                            background:pg>=100?"#e8f5e9":pg>0?"#e3f2fd":"#f5f4f0",
                            color:pg>=100?"#2e7d32":pg>0?"#1565c0":"#bbb",
                            border:lw?"1px solid #ce93d8":"1px solid transparent"}}>{pg}%</span>;
                      })()}
                      {isCat&&collapsed&&(function(){
                        var all=(sc.rows||[]);var i=all.findIndex(function(r){return r.id===row.id;});
                        var n=0;for(var j=i+1;j<all.length&&all[j].kind!=="category";j++)n++;
                        return n>0?<span style={{fontSize:9,color:"#888",fontStyle:"italic",flexShrink:0}}>({n} task{n!==1?"s":""})</span>:null;
                      })()}
                      {isCat&&(function(){var pg=rowProgress(row);return pg===null?null:<span style={{fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:8,flexShrink:0,background:pg>=100?"#e8f5e9":"#f5f4f0",color:pg>=100?"#2e7d32":"#888"}}>{pg}%</span>;})()}
                      {!isCat&&<button className="sched-noprint" onClick={function(){shiftRow(row.id,-1);}} title="Shift 1 week earlier (linked rows follow)"
                        style={{background:"none",border:"1px solid #e8e6df",borderRadius:4,cursor:"pointer",color:"#888",fontSize:10,padding:"1px 5px",flexShrink:0}}>◀</button>}
                      {!isCat&&<button className="sched-noprint" onClick={function(){shiftRow(row.id,1);}} title="Shift 1 week later (linked rows follow)"
                        style={{background:"none",border:"1px solid #e8e6df",borderRadius:4,cursor:"pointer",color:"#888",fontSize:10,padding:"1px 5px",flexShrink:0}}>▶</button>}
                      {showFloat&&critPath&&!isCat&&critPath.float[row.id]!==undefined&&(function(){
                        var f=critPath.float[row.id];
                        var crit=f<=0;
                        return <span title={crit
                            ?"No float: any delay on this task pushes the end of the schedule."
                            :f+" working week"+(f!==1?"s":"")+" of float — it can slip that much before the end date moves."}
                          style={{fontFamily:"var(--font-mono)",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,flexShrink:0,cursor:"help",
                            background:crit?"var(--red-soft,#fbe6e8)":f<=2?"var(--amber-soft,#fdf1e0)":"var(--green-soft,#e6f2e9)",
                            color:crit?"var(--red,#b3302a)":f<=2?"var(--amber,#b35c00)":"var(--green,#1e6b3a)",
                            border:"1px solid "+(crit?"#f0cdc9":f<=2?"#e6c48c":"#c8e6c9")}}>
                          {crit?"0f":f+"f"}</span>;
                      })()}
                      {onCrit&&<span title={"Critical path, step "+(critPath.order.indexOf(row.id)+1)+" of "+critPath.order.length+" — any delay here pushes the end of the schedule"}
                        style={{fontFamily:"var(--font-mono)",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,flexShrink:0,cursor:"help",
                          background:"var(--amber-soft,#fdf1e0)",color:"var(--amber,#b35c00)",border:"1px solid #e6c48c"}}>
                        🎯{critPath.order.indexOf(row.id)+1}</span>}
                      {rowPq&&<span className="sched-noprint"
                        onClick={canEdit?function(){setSpanRowId(row.id);}:null}
                        title={rowPq.tbc>0
                          ?rowPq.tbc+" prerequisite date(s) still TBC: "+rowPq.all.filter(function(p){return !p.confirmed;}).map(function(p){return p.label||"(unnamed)";}).join(", ")
                          :"All "+rowPq.all.length+" prerequisite(s) confirmed — earliest start "+fmtDate(rowPq.gateWeek)}
                        style={{fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:8,flexShrink:0,cursor:canEdit?"pointer":"help",whiteSpace:"nowrap",
                          background:rowPq.tbc>0?"#fff8e1":rowPq.tooEarly?"#fce4ec":"#e8f5e9",
                          color:rowPq.tbc>0?"#f57f17":rowPq.tooEarly?"#c62828":"#2e7d32",
                          border:"1px solid "+(rowPq.tbc>0?"#ffe082":rowPq.tooEarly?"#f48fb1":"#c8e6c9")}}>
                        {rowPq.tbc>0?"🔒 "+rowPq.tbc+" TBC":rowPq.tooEarly?"🔒 "+fmtDate(rowPq.gateWeek).slice(0,5):"🔓"}
                      </span>}
                      {(function(){
                        var pr=rowRisk;
                        if(!pr)return null;
                        return <span style={{display:"inline-flex",alignItems:"center",gap:2,flexShrink:0}}>
                          <span title={pr.tender.title+"\nDelivery forecast: "+fmtDate(pr.delivery)+"\nTask start week: "+fmtDate(pr.startWeek)+"\n"+
                            (pr.late?"→ LATE by "+(-pr.gapDays)+" day(s): the material arrives after the task should have started."
                             :pr.tight?"→ TIGHT: only "+pr.gapDays+" day(s) of float before the task starts."
                             :"→ OK: "+pr.gapDays+" day(s) of float.")}
                            style={{fontSize:11,cursor:"help",opacity:(pr.late||pr.tight)?1:.55}}>{pr.late?"🔴":pr.tight?"🟠":"🚚"}</span>
                          {pr.feasible&&<span
                            onClick={canEdit?function(){applySpan(row,shiftedSpan(row,pr.feasible));}:null}
                            title={"Delivery is forecast "+fmtDate(pr.delivery)+". Earliest week this task can start: "+fmtDate(pr.feasible)+(canEdit?" — click to move the task there (duration kept)":"")}
                            style={{fontSize:9,fontWeight:800,padding:"1px 4px",borderRadius:8,whiteSpace:"nowrap",cursor:canEdit?"pointer":"help",
                              background:pr.late?"#fff3e0":pr.tight?"#fffde7":"#f1f8e9",
                              color:pr.late?"#e65100":pr.tight?"#f57f17":"#558b2f",
                              border:"1px solid "+(pr.late?"#ffcc80":pr.tight?"#fff59d":"#c5e1a5")}}>
                            ⇢ {fmtDate(pr.feasible).slice(0,5)}
                          </span>}
                        </span>;
                      })()}
                      {!isCat&&<button className="sched-noprint" onClick={function(e){
                        if(spanRowId===row.id){setSpanRowId(null);return;}
                        var b=e.currentTarget.getBoundingClientRect();
                        setSpanPos({x:b.right+8,y:b.top});
                        setSpanRowId(row.id);
                      }} title="Set start/end week and quantity"
                        style={{background:spanRowId===row.id?"#fff8e1":"none",border:"1px solid "+(spanRowId===row.id?"#c9a84c":"#e8e6df"),borderRadius:4,cursor:"pointer",color:spanRowId===row.id?"#b45309":"#888",fontSize:10,padding:"1px 5px",flexShrink:0,fontWeight:700}}>📐</button>}
                      <button className="sched-noprint" onClick={function(e){
                        if(linkRowId===row.id){setLinkRowId(null);return;}
                        var b=e.currentTarget.getBoundingClientRect();
                        setLinkPos({x:b.right+8,y:b.top});
                        setLinkRowId(row.id);
                      }}
                        title="Add or link actions to this row"
                        style={{background:linkRowId===row.id?"#e8f0fe":"none",border:"1px solid "+(linkRowId===row.id?"#1a73e8":"#e8e6df"),borderRadius:4,cursor:"pointer",color:linkRowId===row.id?"#1a73e8":"#888",fontSize:10,padding:"1px 5px",flexShrink:0,fontWeight:700}}>⚑</button>
                    </div>
                  </td>
                  <td style={{padding:"3px 6px",borderBottom:"1px solid #f5f4f0",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap"}}>
                    {isCat
                      ?<span style={{color:"#ddd",fontSize:10}}>—</span>
                      :canEdit
                        ?<div style={{display:"flex",alignItems:"center",gap:3}}>
                        <span className="sched-noprint" title="Choose a colour for this task or for the whole subcontractor"
                          onClick={function(){setColorRowId(colorRowId===row.id?null:row.id);}}
                          style={{width:11,height:11,borderRadius:3,flexShrink:0,cursor:"pointer",background:planColor(row),border:"1px solid rgba(0,0,0,.15)",boxShadow:row.color?"0 0 0 1.5px #1a73e8":"none"}}></span>
                        <select value={row.group||""} onChange={function(e){
                            var g=e.target.value;
                            var patch={group:g};
                            // A rule fills the tender in the same write, unless one is already set.
                            if(g&&!row.tenderRef){
                              var rule=tenderRuleFor(window._ppTenderRules,g,curZone);
                              if(rule)patch.tenderRef=rule.tenderId;
                            }
                            updRow(row.id,patch);
                            if(patch.tenderRef)setTimeout(function(){pushStartOnSiteFromSchedule(patch.tenderRef);},0);
                          }}
                          title="Subcontractor / company doing this task — drives the filter and the printed schedule"
                          style={{width:"100%",padding:"2px 4px",fontSize:10,border:"1px solid "+(row.group?"#00695c":"#e8e6df"),borderRadius:4,fontFamily:"inherit",color:row.group?"#00695c":"#bbb",fontWeight:row.group?700:400,background:row.group?"#e8f5e9":"#fff"}}>
                          <option value="">👷 —</option>
                          {allGroups.map(function(g){return <option key={g} value={g}>{g}</option>;})}
                        </select>
                        </div>
                        :<span style={{fontSize:10,fontWeight:row.group?700:400,color:row.group?"#00695c":"#ddd"}}>
                          <span style={{display:"inline-block",width:9,height:9,borderRadius:2,background:planColor(row),marginRight:4,border:"1px solid rgba(0,0,0,.15)"}}></span>
                          {row.group||"—"}</span>}
                  </td>
                  <td style={{padding:"3px 8px",borderBottom:"1px solid #f5f4f0",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap",textAlign:"right"}}>
                    {(function(){
                      var sp=rowSpan(row);
                      if(isCat||!sp||sp.rate===null)return <span style={{color:"#ddd",fontSize:10}}>—</span>;
                      return <span title={"Quantity "+row.qty+" "+(row.unit||"")+" over "+sp.workingWeeks+" working week"+(sp.workingWeeks!==1?"s":"")+(sp.derived?" — span read from the planned bars ("+fmtDate(sp.startWeek)+" → "+fmtDate(sp.endWeek)+")":"")}
                        style={{fontSize:10,fontWeight:800,color:sp.derived?"#8d6e63":"#b45309",cursor:"help",borderBottom:sp.derived?"1px dotted #bcaaa4":"none"}}>
                        {sp.rate.toLocaleString(undefined,{maximumFractionDigits:1})}<span style={{fontSize:8,color:"#aaa",fontWeight:600}}>{row.unit?" "+row.unit:""}/wk</span>
                      </span>;
                    })()}
                  </td>
                  <td className="sched-noprint" style={{padding:"3px 8px",borderBottom:"1px solid #f5f4f0",borderRight:"1.5px solid #e8e6df",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap"}}>
                    <select value={row.roomId||""} onChange={function(e){updRow(row.id,{roomId:e.target.value});}}
                      title="Room this row belongs to"
                      style={{width:95,padding:"2px 4px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4,fontFamily:"inherit",color:row.roomId?"#7b1fa2":"#bbb",marginRight:3}}>
                      <option value="">🚪 —</option>
                      {(rooms||[]).filter(function(rm){return rm.zone===curZone;}).map(function(rm){return <option key={rm.id} value={rm.id}>{rm.name}</option>;})}
                    </select>
                    {isCat&&<select value="" onChange={function(e){if(e.target.value){copySequenceToRoom(row.id,e.target.value);e.target.value="";}}}
                      title="Copy this whole sequence onto another room (keeps links, clears durations)"
                      style={{width:95,padding:"2px 4px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4,fontFamily:"inherit",color:"#1a73e8",marginRight:3}}>
                      <option value="">⧉ To room…</option>
                      {(rooms||[]).filter(function(rm){return rm.zone===curZone&&rm.id!==row.roomId;}).map(function(rm){return <option key={rm.id} value={rm.id}>{rm.name}</option>;})}
                    </select>}
                    <select value={row.afterId||""} onChange={function(e){updRow(row.id,{afterId:e.target.value});}}
                      style={{width:110,padding:"2px 4px",fontSize:10,border:"1px solid #e8e6df",borderRadius:4,fontFamily:"inherit",color:row.afterId?"#1a73e8":"#bbb"}}>
                      <option value="">— none —</option>
                      {(sc.rows||[]).filter(function(o){return o.id!==row.id;}).map(function(o){
                        return <option key={o.id} value={o.id}>{o.kind==="category"?"▸ ":""}{o.label||"(untitled)"}</option>;
                      })}
                    </select>
                  </td>
                  {wks.map(function(wk){
                    var v=(row.cells||{})[wk]||"";
                    // A collapsed room shows a rolled-up bar of everything hidden underneath it
                    if(isCat&&collapsed){
                      var all=(sc.rows||[]);var i0=all.findIndex(function(r){return r.id===row.id;});
                      var hasP=false,hasA=false;
                      for(var j0=i0+1;j0<all.length&&all[j0].kind!=="category";j0++){
                        var cv=(all[j0].cells||{})[wk]||"";
                        if(cv==="plan"||cv==="both")hasP=true;
                        if(cv==="actual"||cv==="both")hasA=true;
                      }
                      v=hasP&&hasA?"both":hasP?"plan":hasA?"actual":v;
                    }
                    var hol=isHoliday(wk);
                    var wpVal=(row.weekProgress||{})[wk];
                    var hasWp=wpVal!==undefined&&wpVal!==null&&wpVal!=="";
                    // Procurement is late: mark the first week the task could actually start,
                    // and hatch every planned week sitting before the delivery date.
                    var isFeasible=rowRisk&&rowRisk.feasible===wk;
                    var featCol=rowRisk?(rowRisk.late?"#e65100":rowRisk.tight?"#f9a825":"#7cb342"):"#e65100";
                    var beforeDelivery=rowRisk&&rowRisk.late&&rowRisk.feasible&&wk<rowRisk.feasible&&(v==="plan"||v==="both");
                    return <td key={wk}
                      onClick={function(){
                        if(isCat||hol)return;
                        if(paintMode==="progress"){
                          var cur=hasWp?String(wpVal):"";
                          var input=window.prompt("Progress reached at week of "+fmtDate(wk)+" (%)\nLeave empty to clear:",cur);
                          if(input===null)return;
                          setWeekProgress(row,wk,input.trim());
                        }else{
                          toggleCell(row,wk);
                        }
                      }}
                      title={hol?"Neutralised week":hasWp?"Progress at this week: "+wpVal+"%":(paintMode==="progress"?"Click to record progress % for this week":"")}
                      style={Object.assign({borderBottom:"1px solid #f5f4f0",borderLeft:"1px solid #f0ede6",cursor:(isCat||hol)?"default":"pointer",height:22,padding:0,textAlign:"center",fontSize:8,fontWeight:800,color:"#fff",textShadow:"0 0 2px rgba(0,0,0,.5)"},
                        hol?{background:"repeating-linear-gradient(45deg,#e8e4da,#e8e4da 3px,#dcd8ce 3px,#dcd8ce 6px)"}:cellStyle(v,row),
                        beforeDelivery?{background:"repeating-linear-gradient(45deg,#ef9a9a,#ef9a9a 3px,#e57373 3px,#e57373 6px)"}:null,
                        isFeasible?{boxShadow:"inset 0 0 0 2px "+featCol}:null)}>
                      {hasWp?wpVal:isFeasible?<span title={"🚚 Delivery "+fmtDate(rowRisk.delivery)+" — earliest possible start"} style={{color:v?"#fff":featCol,fontSize:10,fontWeight:900,textShadow:v?"0 0 3px rgba(0,0,0,.7)":"none"}}>▶</span>:""}
                    </td>;
                  })}
                </tr></React.Fragment>;
              })}
            </tbody>
          </table>
        </div>}
        {/* The schedule scrollbar sits at the bottom of a 62vh box, so it was only reachable
            after scrolling the page. This mirror stays pinned to the bottom of the viewport
            and drives the real one, both ways. */}
        {!monthView&&<div className="sched-noprint sched-mirror" ref={mirrorRef} onScroll={function(){syncScroll("mirror");}}
          style={{display:mirrorBox.show?"block":"none",position:"fixed",left:mirrorBox.left,width:mirrorBox.width,
            bottom:12,zIndex:1250,overflowX:"auto",overflowY:"hidden",height:18,
            background:"#faf9f6",border:"1px solid #e8e6df",borderRadius:9,
            boxShadow:"0 2px 10px rgba(0,0,0,.12)"}}>
          <div style={{width:schedScrollW,height:1}}></div>
        </div>}

        {printPlan&&(function(){
          var per=Math.ceil(wks.length/printPlan.pages);
          var chunks=[];
          for(var i=0;i<wks.length;i+=per)chunks.push(wks.slice(i,i+per));
          return <div className="sched-print-only">
            {chunks.map(function(ck,ci){
              return <div key={ci} style={{pageBreakAfter:ci<chunks.length-1?"always":"auto",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:800,marginBottom:4}}>
                  {sc.title} · {curZone}{fGroup?" · "+fGroup:""} — sheet {ci+1}/{chunks.length} · {fmtDate(ck[0])} → {fmtDate(ck[ck.length-1])}
                </div>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:7}}>
                  <thead><tr>
                    <th style={{border:"1px solid #999",padding:"2px 3px",textAlign:"left",width:170}}>Task</th>
                    <th style={{border:"1px solid #999",padding:"2px 3px",textAlign:"left",width:70}}>Subcont.</th>
                    {ck.map(function(w){return <th key={w} style={{border:"1px solid #999",padding:"2px 1px",width:16}}>{fmtDate(w).slice(0,5)}</th>;})}
                  </tr></thead>
                  <tbody>
                    {visibleRows.map(function(r){
                      var cat=r.kind==="category";
                      var risk=(!cat&&printPlan.risks)?procRisk(r):null;
                      return <tr key={r.id}>
                        <td style={{border:"1px solid #999",padding:"2px 3px",fontWeight:cat?800:400,background:cat?"#eee":"#fff"}}>
                          {cat?"":"   "}{r.label}
                          {risk&&risk.late?" 🔴":risk&&risk.tight?" 🟠":""}
                        </td>
                        <td style={{border:"1px solid #999",padding:"2px 3px",background:cat?"#eee":"#fff"}}>{cat?"":(r.group||"")}</td>
                        {ck.map(function(w){
                          var v=(r.cells||{})[w];
                          var hol=(sc.holidayWeeks||[]).indexOf(w)>=0;
                          var before=risk&&risk.late&&risk.feasible&&w<risk.feasible&&(v==="plan"||v==="both");
                          var feas=risk&&risk.feasible===w;
                          var bg=hol?"#e8e4da":before?"repeating-linear-gradient(45deg,#ef9a9a,#ef9a9a 2px,#e57373 2px,#e57373 4px)"
                                 :v==="plan"?planColor(r):v==="actual"?"#1a73e8":v==="both"?"linear-gradient(180deg,"+planColor(r)+" 50%,#1a73e8 50%)":"#fff";
                          var wp=printPlan.progress?((r.weekProgress||{})[w]):"";
                          return <td key={w} style={{border:"1px solid #ccc",padding:0,height:11,background:bg,textAlign:"center",fontSize:6,color:"#fff",
                            boxShadow:feas?"inset 0 0 0 1.5px #e65100":"none"}}>{wp!==undefined&&wp!==null&&wp!==""?wp:(feas&&!v?"▶":"")}</td>;
                        })}
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>;
            })}
            {scDocs.length>0&&<div style={{marginTop:10,fontSize:7}}>
              <div style={{fontWeight:800,marginBottom:2}}>Reference documents</div>
              {scDocs.map(function(d){
                var rm=(rooms||[]).find(function(r){return r.id===d.roomId;});
                return <div key={d.id}>· {d.title} — {d.kind}{rm?" — "+rm.name:""} — {d.url}</div>;
              })}
            </div>}
          </div>;
        })()}
        {showDocs&&<div className="sched-noprint" style={{position:"fixed",inset:0,zIndex:960,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={function(){setShowDocs(false);}}>
          <div onClick={function(e){e.stopPropagation();}} style={{background:"#fff",borderRadius:14,padding:"20px 22px",width:640,maxWidth:"100%",maxHeight:"88vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:18}}>📄 Reference documents</div>
            <div style={{fontSize:11,color:"#aaa",marginBottom:16}}>Put the PDF on SharePoint, then paste its link here. Attach it to a room and that room's name becomes clickable in the schedule.</div>

            {scDocs.length===0&&<div style={{fontSize:12,color:"#bbb",padding:"14px 0"}}>No document linked to this schedule yet.</div>}
            {scDocs.map(function(d){
              var rm=(rooms||[]).find(function(r){return r.id===d.roomId;});
              return <div key={d.id} style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",border:"1.5px solid #e8e6df",borderRadius:8,marginBottom:6,background:"#fafaf8"}}>
                <span style={{fontSize:15}}>📄</span>
                <div style={{flex:1,minWidth:0}}>
                  <div onClick={function(){openDoc(d.url);}} style={{fontSize:12.5,fontWeight:700,color:"#1a73e8",cursor:"pointer",textDecoration:"underline",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.title||"(untitled)"} ↗</div>
                  <div style={{fontSize:10,color:"#aaa"}}>{d.kind}{rm?" · 🚪 "+rm.name:" · whole schedule"}{d.addedBy?" · "+d.addedBy:""} · {fmtDate(d.updatedAt)}</div>
                </div>
                {canEdit&&<select value={d.roomId||""} onChange={function(e){updDoc(d.id,{roomId:e.target.value});}} style={{width:150,padding:"3px 5px",fontSize:10}}>
                  <option value="">Whole schedule</option>
                  {(rooms||[]).filter(function(r){return r.zone===curZone;}).map(function(r){return <option key={r.id} value={r.id}>{r.name}</option>;})}
                </select>}
                {canEdit&&<button className="btn btn-sm btn-danger" onClick={function(){delDoc(d.id);}} style={{padding:"2px 7px"}}>🗑</button>}
              </div>;
            })}

            {!canEdit&&<div style={{marginTop:14,padding:"10px 12px",borderRadius:8,background:"#fff8e1",border:"1.5px solid #ffe082",fontSize:11,color:"#8a6d1f"}}>
              You can read the documents but not add one: adding requires being a <b>zone leader</b> for {curZone} (Settings › Zones › zone owners), or the app admin.
              {window._currentUser&&window._currentUser.name?<div style={{marginTop:4,fontSize:10,color:"#b0a070"}}>Signed in as “{window._currentUser.name}”.</div>:null}
            </div>}
            <div style={{marginTop:16,paddingTop:14,borderTop:"1.5px solid #e8e6df",opacity:canEdit?1:.5,pointerEvents:canEdit?"auto":"none"}}>
              <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:8}}>Add a document</div>
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <input type="text" value={newDoc.title} onChange={function(e){setNewDoc(Object.assign({},newDoc,{title:e.target.value}));}}
                  placeholder="Title, e.g. Fence — section layout" style={{flex:1,padding:"5px 9px",fontSize:12}}/>
                <select value={newDoc.kind} onChange={function(e){setNewDoc(Object.assign({},newDoc,{kind:e.target.value}));}} style={{width:150,padding:"5px 6px",fontSize:11}}>
                  {DOC_KINDS.map(function(k){return <option key={k} value={k}>{k}</option>;})}
                </select>
              </div>
              <input type="text" value={newDoc.url} onChange={function(e){setNewDoc(Object.assign({},newDoc,{url:e.target.value}));}}
                placeholder="https://…  (paste the SharePoint link)" style={{width:"100%",padding:"5px 9px",fontSize:12,marginBottom:6}}/>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <select value={newDoc.roomId} onChange={function(e){setNewDoc(Object.assign({},newDoc,{roomId:e.target.value}));}} style={{flex:1,padding:"5px 6px",fontSize:11}}>
                  <option value="">Attach to: whole schedule</option>
                  {(rooms||[]).filter(function(r){return r.zone===curZone;}).map(function(r){return <option key={r.id} value={r.id}>Attach to room: {r.name}</option>;})}
                </select>
                <button className="btn btn-sm btn-gold" disabled={!newDoc.title.trim()||!isSafeDocUrl(newDoc.url)}
                  onClick={function(){addDoc(newDoc);setNewDoc({title:"",url:"",kind:"Setting-out plan",roomId:""});}}>＋ Add</button>
              </div>
              {newDoc.url.trim()&&!isSafeDocUrl(newDoc.url)&&<div style={{fontSize:10,color:"#c62828",marginTop:5}}>The link must start with http:// or https://</div>}
            </div>

            <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
              <button className="btn btn-sm" onClick={function(){setShowDocs(false);}}>Close</button>
            </div>
          </div>
        </div>}
        {printOpts&&<div className="sched-noprint" style={{position:"fixed",inset:0,zIndex:960,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={function(){setPrintOpts(null);}}>
          <div onClick={function(e){e.stopPropagation();}} style={{background:"#fff",borderRadius:14,padding:"20px 22px",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:18,marginBottom:3}}>Print the schedule</div>
            <div style={{fontSize:11,color:"#aaa",marginBottom:14}}>{wks.length} weeks · {visibleRows.filter(function(r){return r.kind!=="category";}).length} tasks{fGroup?" · filtered on "+fGroup:""}</div>

            <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:6}}>Spread the weeks over</div>
            <div style={{display:"flex",gap:6,marginBottom:16}}>
              {[1,2,3].map(function(n){
                var per=Math.ceil(wks.length/n);
                var on=printOpts.pages===n;
                return <button key={n} onClick={function(){setPrintOpts(Object.assign({},printOpts,{pages:n}));}}
                  style={{flex:1,padding:"9px 6px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",textAlign:"center",
                    border:"1.5px solid "+(on?"#1c1c1e":"#e8e6df"),background:on?"#1c1c1e":"#fff",color:on?"#fff":"#888"}}>
                  <div style={{fontSize:15,fontWeight:800}}>{n}</div>
                  <div style={{fontSize:9}}>{n===1?"one sheet":per+" wks / sheet"}</div>
                </button>;
              })}
            </div>

            <label style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",textTransform:"none",letterSpacing:"normal",marginBottom:10,color:"#333"}}>
              <input type="checkbox" checked={printOpts.risks} onChange={function(e){setPrintOpts(Object.assign({},printOpts,{risks:e.target.checked}));}} style={{width:14,height:14,marginTop:2}}/>
              <span style={{fontSize:12,fontWeight:600}}>Procurement impact<br/><span style={{fontSize:10,fontWeight:400,color:"#aaa"}}>delivery arrows, red hatching and the ⇢ week</span></span>
            </label>
            <label style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",textTransform:"none",letterSpacing:"normal",marginBottom:16,color:"#333"}}>
              <input type="checkbox" checked={printOpts.progress} onChange={function(e){setPrintOpts(Object.assign({},printOpts,{progress:e.target.checked}));}} style={{width:14,height:14,marginTop:2}}/>
              <span style={{fontSize:12,fontWeight:600}}>Weekly progress figures<br/><span style={{fontSize:10,fontWeight:400,color:"#aaa"}}>the numbers written inside the bars</span></span>
            </label>

            <div style={{fontSize:10,color:"#aaa",marginBottom:14}}>Task and Subcont. columns are repeated on every sheet. Choose <b>landscape</b> and tick <b>Background graphics</b> in the print dialog.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-sm" onClick={function(){setPrintOpts(null);}}>Cancel</button>
              <button className="btn btn-sm btn-pri" onClick={function(){runPrint(printOpts);}}>🖨 Print</button>
            </div>
          </div>
        </div>}
        {colorRowId&&<div className="sched-noprint" onClick={function(){setColorRowId(null);}} style={{position:"fixed",inset:0,zIndex:940}}></div>}
        {colorRowId&&(function(){
          var row=(sc.rows||[]).find(function(r){return r.id===colorRowId;});
          if(!row)return null;
          function setTask(hex){updRow(row.id,{color:hex});}
          function setGroup(hex){
            var gc=Object.assign({},(sc.groupColors)||{});
            if(hex)gc[row.group]=hex;else delete gc[row.group];
            upd(sc.id,{groupColors:gc});
          }
          return <div className="sched-noprint" style={{position:"fixed",zIndex:950,left:"50%",top:"50%",transform:"translate(-50%,-50%)",
            background:"#fff",border:"1.5px solid #e8e6df",borderRadius:12,boxShadow:"0 16px 50px rgba(0,0,0,.25)",padding:"16px 18px",width:330}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>Colour — {row.label||"task"}</div>
            <div style={{fontSize:10,color:"#aaa",marginBottom:12}}>Planned bars only. Actual bars stay blue everywhere.</div>

            {row.group&&<div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:6}}>All tasks of {row.group} — this schedule</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {SCHED_PALETTE.map(function(c){
                  var on=((sc.groupColors)||{})[row.group]===c.hex;
                  return <button key={c.hex} title={c.name} onClick={function(){setGroup(c.hex);}}
                    style={{width:26,height:26,borderRadius:6,cursor:"pointer",background:c.hex,border:on?"3px solid #1c1c1e":"1px solid rgba(0,0,0,.15)"}}></button>;
                })}
                <button onClick={function(){setGroup("");}} title="Back to the colour set in Settings, or gold"
                  style={{width:26,height:26,borderRadius:6,cursor:"pointer",fontSize:13,color:"#aaa",background:"#fff",border:"1px dashed #ccc"}}>×</button>
              </div>
            </div>}

            <div>
              <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:6}}>This task only</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {SCHED_PALETTE.map(function(c){
                  var on=row.color===c.hex;
                  return <button key={c.hex} title={c.name} onClick={function(){setTask(c.hex);}}
                    style={{width:26,height:26,borderRadius:6,cursor:"pointer",background:c.hex,border:on?"3px solid #1a73e8":"1px solid rgba(0,0,0,.15)"}}></button>;
                })}
                <button onClick={function(){setTask("");}} title="Follow the subcontractor colour again"
                  style={{width:26,height:26,borderRadius:6,cursor:"pointer",fontSize:13,color:"#aaa",background:"#fff",border:"1px dashed #ccc"}}>×</button>
              </div>
            </div>

            {!row.group&&<div style={{fontSize:10,color:"#bbb",marginTop:10}}>Assign a subcontractor to colour all of its tasks at once.</div>}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
              <button className="btn btn-sm" onClick={function(){setColorRowId(null);}}>Done</button>
            </div>
          </div>;
        })()}
        {spanRowId&&<div className="sched-noprint" onClick={function(){setSpanRowId(null);}} style={{position:"fixed",inset:0,zIndex:790}}></div>}
        {spanRowId&&(function(){
          var row=(sc.rows||[]).find(function(r){return r.id===spanRowId;});
          if(!row)return null;
          var sp=rowSpan(row);
          return <div className="sched-noprint" onClick={function(e){e.stopPropagation();}}
            style={(function(){
              // The panel grew (prerequisites, tender, quantities) and a fixed 300px clamp
              // pushed its lower half under the fold for rows near the bottom of the screen.
              // Clamp against the real height and let it scroll if it still does not fit.
              var W=310,M=12;
              var maxH=window.innerHeight-2*M;
              var estH=Math.min(560,maxH);
              return{position:"fixed",zIndex:800,
                left:Math.max(M,Math.min(spanPos.x,window.innerWidth-W-M)),
                top:Math.max(M,Math.min(spanPos.y,window.innerHeight-estH-M)),
                width:W,maxHeight:maxH,overflowY:"auto",overscrollBehavior:"contain",
                padding:"12px 14px",background:"#fffdf0",border:"1.5px solid var(--gold,#c9a84c)",borderRadius:10,
                boxShadow:"0 12px 40px rgba(0,0,0,.28)"};
            })()}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,color:"#b45309"}}>📐 {row.label||"(untitled)"}</div>
              <button className="btn btn-sm" onClick={function(){setSpanRowId(null);}}>✕</button>
            </div>

            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <div style={{flex:1}}>
                <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Start week</label>
                <select value={row.startWeek||""} onChange={function(e){applySpan(row,{startWeek:e.target.value});}} style={{padding:"4px 6px",fontSize:11}}>
                  <option value="">—</option>
                  {wks.map(function(w){return <option key={w} value={w}>{fmtDate(w)}</option>;})}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>End week</label>
                <select value={row.endWeek||""} onChange={function(e){applySpan(row,{endWeek:e.target.value});}} style={{padding:"4px 6px",fontSize:11}}>
                  <option value="">—</option>
                  {wks.map(function(w){return <option key={w} value={w}>{fmtDate(w)}</option>;})}
                </select>
              </div>
            </div>

            <div style={{marginBottom:10,padding:"8px 9px",border:"1.5px solid #e0ddd6",borderRadius:7,background:"#fafaf8"}}>
              <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase",marginBottom:5}}>🔒 Prerequisites — what must happen first</label>
              {prereqsOf(row.id).map(function(t){
                var ok=t.status==="done"||!!t.dateConfirmed;
                return <div key={t.id} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
                  <span style={{flex:1,minWidth:0,fontSize:10,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.text}>{t.text}</span>
                  <span style={{fontSize:9,color:"#888",flexShrink:0}}>{t.owner||"—"}</span>
                  <input type="date" min="1990-01-01" max="2200-12-31" value={t.due||""}
                    onChange={function(e){saveTasks((tasks||[]).map(function(x){return x.id!==t.id?x:stampModified(Object.assign({},x,{due:e.target.value}));}));}}
                    style={{width:112,padding:"3px 4px",fontSize:10}}/>
                  <button onClick={function(){saveTasks((tasks||[]).map(function(x){return x.id!==t.id?x:stampModified(Object.assign({},x,{dateConfirmed:!ok,status:ok?"pending":x.status}));}));}}
                    title={ok?"Date confirmed — click to put it back to TBC":"Date still to be confirmed — click to confirm it"}
                    style={{fontSize:9,fontWeight:800,padding:"3px 6px",borderRadius:10,cursor:"pointer",fontFamily:"inherit",flexShrink:0,
                      border:"1px solid "+(ok?"#c8e6c9":"#ffe082"),background:ok?"#e8f5e9":"#fff8e1",color:ok?"#2e7d32":"#f57f17"}}>
                    {ok?"✓ OK":"TBC"}</button>
                </div>;
              })}
              {(row.prereqs||[]).map(function(p,pi){
                return <div key={"lg"+pi} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4,opacity:.75}}>
                  <span style={{flex:1,minWidth:0,fontSize:10}}>{p.label||"(unnamed)"} <span style={{fontSize:8,color:"#f57f17",fontWeight:700}}>OLD</span></span>
                  <span style={{fontSize:9,color:"#888"}}>{p.date?fmtDate(p.date):"—"}</span>
                  <button className="btn btn-sm" style={{padding:"1px 6px",fontSize:9}}
                    title="Turn this into a real action, so it can be assigned and tracked in the zone"
                    onClick={function(){
                      createLinkedAction(row.id,row.label,p.label||"Prerequisite","prereq","",p.date||"");
                      updPrereqs(row.id,(row.prereqs||[]).filter(function(_,k){return k!==pi;}));
                    }}>⇪ convert</button>
                  <button onClick={function(){updPrereqs(row.id,(row.prereqs||[]).filter(function(_,k){return k!==pi;}));}}
                    style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:12}}>×</button>
                </div>;
              })}
              <div style={{fontSize:9,color:"#aaa",marginBottom:5}}>Add one with the ⚑ button on the row, choosing <b>🔒 Prerequisite</b>.</div>
              {(function(){
                var pq=prereqState(row);
                if(!pq)return null;
                return <div style={{marginTop:6,padding:"6px 8px",borderRadius:6,fontSize:10,
                  background:pq.tbc>0?"#fff8e1":pq.tooEarly?"#fce4ec":"#e8f5e9",
                  color:pq.tbc>0?"#b45309":pq.tooEarly?"#c62828":"#2e7d32"}}>
                  {pq.tbc>0
                    ?"⏳ "+pq.tbc+" date"+(pq.tbc!==1?"s":"")+" still TBC — the start week cannot be trusted yet"
                    :pq.tooEarly
                      ?"🔴 All confirmed, but the last one lands "+fmtDate(pq.latest)+" — this task cannot start before "+fmtDate(pq.gateWeek)
                      :"✅ All prerequisites confirmed — task can start from "+fmtDate(pq.gateWeek)}
                  {pq.gateWeek&&pq.tbc===0&&pq.tooEarly&&<button className="btn btn-sm" style={{marginLeft:6,padding:"1px 7px",fontSize:9}}
                    onClick={function(){applySpan(row,shiftedSpan(row,pq.gateWeek));}}>⇢ Move to {fmtDate(pq.gateWeek)}</button>}
                </div>;
              })()}
            </div>

            <div style={{marginBottom:8}}>
              <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Supplied by tender</label>
              <input type="text" value={qTender} onChange={function(e){setQTender(e.target.value);}}
                placeholder="🔎 filter tenders…" style={{padding:"3px 7px",fontSize:10,marginBottom:3}}/>
              <select value={row.tenderRef||""} onChange={function(e){updRow(row.id,{tenderRef:e.target.value});if(e.target.value)pushStartOnSiteFromSchedule(e.target.value);}}
                size={qTender.trim()?8:1} style={{padding:"4px 6px",fontSize:11}}>
                <option value="">— none —</option>
                {(function(){
                  var q=qTender.trim().toLowerCase();
                  var list=(tenders||[]).filter(function(t){
                    if(!q)return true;
                    return ((t.title||"")+" "+(t.package||"")).toLowerCase().indexOf(q)>=0;
                  });
                  var byPkg={};
                  list.forEach(function(t){var p=t.package||"— no package —";(byPkg[p]=byPkg[p]||[]).push(t);});
                  return Object.keys(byPkg).sort().map(function(p){
                    return <optgroup key={p} label={p+" ("+byPkg[p].length+")"}>
                      {byPkg[p].slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");})
                        .map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
                    </optgroup>;
                  });
                })()}
              </select>
              {(function(){
                var pr=procRisk(row);
                if(!pr)return null;
                return <div style={{marginTop:6,padding:"6px 8px",borderRadius:6,fontSize:10,
                  background:pr.late?"#fce4ec":pr.tight?"#fff8e1":"#e8f5e9",
                  color:pr.late?"#c62828":pr.tight?"#b45309":"#2e7d32"}}>
                  {pr.late?"🔴 Delivery "+fmtDate(pr.delivery)+" — "+pr.weeksLate+" week"+(pr.weeksLate!==1?"s":"")+" after the planned start"
                    :pr.tight?"🟡 Delivery "+fmtDate(pr.delivery)+" — same week as the start, no margin"
                    :"🟢 Delivery "+fmtDate(pr.delivery)+" — ahead of the planned start"}
                </div>;
              })()}
            </div>

            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <div style={{flex:2}}>
                <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Quantity</label>
                <input type="number" value={row.qty||""} onChange={function(e){updRow(row.id,{qty:e.target.value});}} placeholder="0" style={{padding:"4px 6px",fontSize:11}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Unit</label>
                <input type="text" value={row.unit||""} onChange={function(e){updRow(row.id,{unit:e.target.value});}} placeholder="m3" style={{padding:"4px 6px",fontSize:11}}/>
              </div>
            </div>

            {sp
              ?<div style={{padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #f0e2b8"}}>
                <div style={{fontSize:11,color:"#888",marginBottom:3}}>{sp.workingWeeks} working week{sp.workingWeeks!==1?"s":""}{sp.totalWeeks!==sp.workingWeeks?" ("+(sp.totalWeeks-sp.workingWeeks)+" neutralised skipped)":""}</div>
                {sp.rate!==null
                  ?<div style={{fontSize:18,fontWeight:900,color:"#b45309"}}>{sp.rate.toLocaleString(undefined,{maximumFractionDigits:2})} <span style={{fontSize:11,fontWeight:600,color:"#888"}}>{row.unit||"units"} / week</span></div>
                  :<div style={{fontSize:11,color:"#bbb"}}>Enter a quantity to get the weekly rate</div>}
              </div>
              :<div style={{fontSize:11,color:"#bbb"}}>Pick a start and end week to compute the rate — the planned bars are drawn automatically.</div>}
          </div>;
        })()}

        {linkRowId&&<div className="sched-noprint" onClick={function(){setLinkRowId(null);}} style={{position:"fixed",inset:0,zIndex:790}}></div>}

        {linkRowId&&(function(){
          var row=(sc.rows||[]).find(function(r){return r.id===linkRowId;});
          if(!row)return null;
          var linked=(tasks||[]).filter(function(t){return t.scheduleRowRef===row.id;});
          var candidates=(tasks||[]).filter(function(t){return t.zone===curZone&&!t.scheduleRowRef&&t.status!=="done";});
          return <div className="sched-noprint" onClick={function(e){e.stopPropagation();}}
            style={{position:"fixed",zIndex:800,
              left:Math.min(linkPos.x,window.innerWidth-430),
              top:Math.min(linkPos.y,window.innerHeight-360),
              width:410,maxHeight:340,overflowY:"auto",
              padding:"12px 14px",background:"#f0f8ff",border:"1.5px solid #64b5f6",borderRadius:10,
              boxShadow:"0 8px 28px rgba(0,0,0,.25)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,color:"#1565c0"}}>⚑ Actions for: {row.label||"(untitled)"}</div>
              <button className="btn btn-sm" onClick={function(){setLinkRowId(null);}}>✕ Close</button>
            </div>

            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
              <input type="text" value={newActionText} onChange={function(e){setNewActionText(e.target.value);}}
                onKeyDown={function(e){if(e.key==="Enter"){createLinkedAction(row.id,row.label,newActionText,newActionSeverity,newActionOwner,newActionDue);setNewActionText("");setNewActionDue("");}}}
                placeholder="New action for this task…" style={{flex:1,minWidth:200,padding:"5px 10px",fontSize:12}}/>
              {[{k:"blocking",lbl:"🔴 Blocking",c:"#c62828",bg:"#fce4ec"},{k:"warning",lbl:"🟠 Warning",c:"#ef6c00",bg:"#fff3e0"},{k:"prereq",lbl:"🔒 Prerequisite",c:"#f57f17",bg:"#fff8e1"},{k:"info",lbl:"ℹ️ Info",c:"#1565c0",bg:"#e8f0fe"}].map(function(o){
                var on=newActionSeverity===o.k;
                return <button key={o.k} onClick={function(){setNewActionSeverity(o.k);}}
                  title={o.k==="blocking"?"Stops the task — turns the row red":o.k==="warning"?"Needs attention but does not stop the work — turns the row orange":o.k==="prereq"?"Must happen before the task can start — gets its own section in the zone actions":"Information only — no marker on the row"}
                  style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:16,cursor:"pointer",fontFamily:"inherit",
                    border:"1.5px solid "+(on?o.c:"#ddd"),background:on?o.bg:"#fff",color:on?o.c:"#aaa"}}>{o.lbl}</button>;
              })}
              <button className="btn btn-sm btn-gold" disabled={!newActionText.trim()}
                onClick={function(){createLinkedAction(row.id,row.label,newActionText,newActionSeverity,newActionOwner,newActionDue);setNewActionText("");setNewActionDue("");}}>＋ Create</button>
              <select value={newActionOwner} onChange={function(e){setNewActionOwner(e.target.value);}} title="Who owns it" style={{width:"auto",padding:"4px 7px",fontSize:11}}>
                <option value="">👤 owner…</option>
                {(people||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
              </select>
              <input type="date" min="1990-01-01" max="2200-12-31" value={newActionDue} onChange={function(e){setNewActionDue(e.target.value);}}
                title={newActionSeverity==="prereq"?"Expected date — leave it and tick TBC later if unknown":"Due date"} style={{width:130,padding:"4px 6px",fontSize:11}}/>
            </div>

            {candidates.length>0&&<div style={{marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:4}}>Or link an existing {curZone} action</div>
              <select value="" onChange={function(e){if(e.target.value)linkTaskToRow(e.target.value,row.id);}} style={{width:"100%",padding:"5px 8px",fontSize:12}}>
                <option value="">— pick an action to link —</option>
                {candidates.map(function(t){return <option key={t.id} value={t.id}>{t.text}{t.owner?" ("+t.owner.split(",")[0]+")":""}</option>;})}
              </select>
            </div>}

            <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:4}}>Linked actions ({linked.length})</div>
            {linked.length===0&&<div style={{fontSize:12,color:"#bbb"}}>No action linked to this row yet.</div>}
            {linked.map(function(t){
              var isB=(t.tags||[]).includes("Blocking Point");
              var isL=t.due&&t.due<today()&&t.status!=="done";
              return <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,background:t.status==="done"?"#f5f4f0":isB?"#fff5f7":"#fff",marginBottom:4,border:"1px solid "+(isB?"#f48fb1":"#e8e6df")}}>
                <span style={{flex:1,fontSize:12,textDecoration:t.status==="done"?"line-through":"none",color:t.status==="done"?"#aaa":"#333"}}>
                  {isB&&"🔴 "}{t.text}
                </span>
                {t.owner&&<span style={{fontSize:10,color:"#888"}}>{t.owner.split(",")[0]}</span>}
                {t.due&&<span style={{fontSize:10,color:isL?"#c62828":"#888",fontWeight:isL?700:400}}>{fmtDate(t.due)}</span>}
                <select value={t.status||"pending"} onChange={function(e){saveTasks((tasks||[]).map(function(x){return x.id!==t.id?x:stampModified(Object.assign({},x,{status:e.target.value,completedAt:e.target.value==="done"?today():""}));}));}} style={{width:"auto",padding:"2px 5px",fontSize:10}}>
                  {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
                </select>
                <button onClick={function(){unlinkTask(t.id);}} title="Unlink (keeps the action)" style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:12}}>⛌</button>
              </div>;
            })}
          </div>;
        })()}

      </div>}

    {hoverInfo&&(function(){
      var row=(sc&&(sc.rows||[]).find(function(r){return r.id===hoverInfo.rowId;}));
      if(!row)return null;
      var w=rowWarning(row.id);
      if(!w)return null;
      var col=w.severity==="blocking"?"#ff8a80":w.severity==="late"?"#ffcc80":"#ffe082";
      return <div style={{position:"fixed",left:Math.min(hoverInfo.x,window.innerWidth-360),top:hoverInfo.y,zIndex:9999,width:330,background:"#1c1c1e",color:"#fff",padding:"10px 12px",borderRadius:8,boxShadow:"0 6px 24px rgba(0,0,0,.35)",fontSize:11,pointerEvents:"none"}}>
        <div style={{fontWeight:700,marginBottom:6,color:col}}>{row.label||"(untitled)"} — {w.acts.length} open action{w.acts.length!==1?"s":""}{w.blocking>0?" · "+w.blocking+" blocking":""}{w.late>0?" · "+w.late+" late":""}</div>
        {w.acts.slice(0,6).map(function(a){
          var isB=(a.tags||[]).includes("Blocking Point");
          var isL=a.due&&a.due<today();
          return <div key={a.id} style={{padding:"4px 0",borderTop:"1px solid #444"}}>
            <div style={{color:isB?"#ff8a80":isL?"#ffcc80":"#fff"}}>{isB?"🔴 ":""}{a.text}</div>
            <div style={{color:"#aaa",fontSize:10}}>{a.owner?a.owner.split(",")[0]:"no owner"}{a.due?" · due "+fmtDate(a.due)+(isL?" (late)":""):""}</div>
          </div>;
        })}
        {w.acts.length>6&&<div style={{color:"#aaa",fontSize:10,paddingTop:4}}>+{w.acts.length-6} more…</div>}
      </div>;
    })()}
  </div>;
}

