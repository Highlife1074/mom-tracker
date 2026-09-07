// ===========================================================================
// app-zone.js — Zone workspace: actions, rooms, KPIs.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

function newRoom(overrides){return Object.assign({id:uuid(),name:"",zone:""},overrides||{});}
function kpiWeeks(kpi){
  if(!kpi.startDate||!kpi.endDate)return[];
  var start=new Date(kpi.startDate);
  var sdow=start.getDay();
  var monday0=new Date(start);monday0.setDate(start.getDate()-(sdow===0?6:sdow-1));
  var end=new Date(kpi.endDate);
  var weeks=[];
  var cur=new Date(monday0);
  while(cur<=end){
    var monday=new Date(cur);
    var sunday=new Date(cur);sunday.setDate(sunday.getDate()+6);
    weeks.push({monday:toISO(monday),sunday:toISO(sunday)});
    cur.setDate(cur.getDate()+7);
  }
  var totalWeeks=weeks.length||1;
  var target=Number(kpi.totalTarget)||0;
  var cumActual=0;
  var todayStr=today();
  return weeks.map(function(w,i){
    var plannedCum=Math.round(target*(i+1)/totalWeeks);
    var actualThis=Number((kpi.weeklyActuals||{})[w.monday])||0;
    cumActual+=actualThis;
    return{monday:w.monday,sunday:w.sunday,weekIndex:i,plannedCum:plannedCum,actualThis:actualThis,actualCum:cumActual,isPast:w.sunday<todayStr,isCurrent:w.monday<=todayStr&&todayStr<=w.sunday};
  });
}

function ZoneActionRow({task,rooms,onUpdate,onDelete,onOpenRoomModal,people,tags,tenders,onAdopt}){
  const [editMode,setEditMode]=useState(false);
  var isBlocking=(task.tags||[]).includes("Blocking Point");
  var blockedCount=task.blockedRooms==="all"?"ALL":(task.blockedRooms||[]).length;

  return <div className="ac-item" style={{background:editMode?"#f8f9ff":task.status==="done"?"#fafaf8":"#fff",borderColor:isBlocking?"#f48fb1":editMode?"#3949ab":"#e8e6df"}}>
    <div className={"ac-check"+(task.status==="done"?" done":"")} onClick={function(){onUpdate({status:task.status==="done"?"pending":"done",completedAt:task.status==="done"?"":today()});}}>
      {task.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}
    </div>
    <div style={{flex:1,minWidth:0}}>
      {editMode
        ?<div style={{display:"flex",flexDirection:"column",gap:6}}>
          <textarea value={task.text||""} autoFocus onChange={function(e){onUpdate({text:e.target.value});}} style={{width:"100%",padding:"5px 8px",border:"1.5px solid #3949ab",borderRadius:6,fontFamily:"inherit",fontSize:13,resize:"vertical",minHeight:44,boxSizing:"border-box"}}/>
          <div style={{display:"flex",gap:6}}>
            <select value={task.status||"pending"} onChange={function(e){onUpdate({status:e.target.value,completedAt:e.target.value==="done"?today():""});}} style={{flex:1,padding:"4px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5,border:"1px solid #ddd"}}>
              {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
            </select>
            <input type="date" min="1990-01-01" max="2200-12-31" value={task.due||""} onChange={function(e){onUpdate({due:e.target.value});}} style={{flex:1,padding:"4px 6px",fontSize:11,borderRadius:5,border:"1px solid #ddd"}}/>
          </div>
          <select value={task.owner||""} onChange={function(e){onUpdate({owner:e.target.value});}} style={{padding:"4px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5,border:"1px solid #ddd"}}>
            <option value="">No owner</option>
            {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
          </select>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {(tags||[]).map(function(tg){var on=(task.tags||[]).includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){var cur=task.tags||[];var nt=on?cur.filter(function(x){return x!==tg;}):[...cur,tg];onUpdate({tags:nt});if(tg==="Blocking Point"&&!on)onOpenRoomModal();}} style={{padding:"5px 9px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
          </div>
          {isBlocking&&<button className="btn btn-sm" onClick={onOpenRoomModal} style={{alignSelf:"flex-start",background:"#fce4ec",color:"#c62828",border:"1px solid #f48fb1"}}>🚧 Blocked rooms: {blockedCount}</button>}
          <div>
            <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",display:"block",marginBottom:2}}>🔗 Linked tender</label>
            <select value={task.tenderRef||""} onChange={function(e){onUpdate({tenderRef:e.target.value});}}
              title="Attach this action to a tender — it will then also show in that tender's Linked Actions"
              style={{padding:"4px 6px",fontSize:11,fontFamily:"inherit",borderRadius:5,border:"1px solid "+(task.tenderRef?"#1a73e8":"#ddd"),color:task.tenderRef?"#1a73e8":"#888",width:"100%"}}>
              <option value="">— no tender —</option>
              {(tenders||[]).slice().sort(function(a,b){return (a.title||"").localeCompare(b.title||"");}).map(function(td){
                return <option key={td.id} value={td.id}>{td.title}{td.package?" ("+td.package+")":""}</option>;
              })}
            </select>
          </div>
          <button className="btn btn-sm btn-pri" onClick={function(){setEditMode(false);}} style={{alignSelf:"flex-start"}}>✓ Done editing</button>
        </div>
        :<div onClick={function(){setEditMode(true);}} style={{cursor:"pointer"}}>
          <div className={"ac-text"+(task.status==="done"?" done":"")} style={{fontWeight:500}}>{task.text||<span style={{color:"#ccc",fontStyle:"italic"}}>No text</span>}</div>
          <div className="ac-meta">
            {task.due
              ?(function(){
                var isLate=task.due<today()&&task.status!=="done";
                var isSoon=!isLate&&task.status!=="done"&&(function(){var d=new Date();d.setDate(d.getDate()+7);return task.due<=toISO(d);})();
                return <span style={{fontSize:11,fontWeight:700,padding:"5px 8px",borderRadius:10,background:isLate?"#fce4ec":isSoon?"#fff8e1":"#f0ede6",color:isLate?"#c62828":isSoon?"#f57f17":"#666"}}>
                  📅 {fmtDate(task.due)}{isLate?" · "+workingDaysDiff(task.due,today())+"d late":""}
                </span>;
              })()
              :<span style={{fontSize:11,padding:"5px 8px",borderRadius:10,background:"#f5f4f0",color:"#bbb",fontStyle:"italic"}}>no target date</span>}
            {task.owner&&<OwnerChip owner={task.owner}/>}
            {(task.tags||[]).map(function(tg){return <TagChip key={tg} tag={tg}/>;})}
            {isBlocking&&<span style={{fontSize:10,fontWeight:700,color:"#c62828"}}>🚧 {blockedCount} room{blockedCount!==1?"s":""}</span>}
            {(task.tags||[]).includes("Prerequisite")&&(function(){
              var ok=task.status==="done"||!!task.dateConfirmed;
              return <button onClick={function(){onUpdate({dateConfirmed:!ok});}}
                title={ok?"Date confirmed — click to put it back to TBC":"Date still to be confirmed"}
                style={{fontSize:11,fontWeight:800,padding:"5px 8px",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                  border:"1px solid "+(ok?"#c8e6c9":"#ffe082"),background:ok?"#e8f5e9":"#fff8e1",color:ok?"#2e7d32":"#f57f17"}}>
                {ok?"✓ date OK":"date TBC"}</button>;
            })()}
            {task.tenderRef&&(function(){
              var td=(tenders||[]).find(function(x){return x.id===task.tenderRef;});
              return td?<span style={{fontSize:10,fontWeight:700,color:"#1a73e8",background:"#e8f0fe",padding:"5px 7px",borderRadius:10}}>🔗 {td.title}</span>:null;
            })()}
          </div>
        </div>}
    </div>
    {!editMode&&<div style={{display:"flex",gap:4,flexShrink:0,alignItems:"flex-start"}}>
      {onAdopt&&<button className="btn btn-sm" onClick={onAdopt} title="Take this procurement action into the zone: it will then count in the zone reports and KPIs" style={{padding:"5px 7px",background:"#fff8e1",color:"#f57f17",border:"1px solid #ffe082",fontWeight:700}}>⬇ Adopt</button>}
      <select className="btn btn-sm" value={task.status||"pending"} onChange={function(e){onUpdate({status:e.target.value,completedAt:e.target.value==="done"?today():""});}} style={{width:"auto",padding:"5px 6px",fontSize:10,border:"1px solid #ddd"}}>
        {STATUS_OPTS.map(function(s){return <option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>;})}
      </select>
      <button className="btn btn-sm btn-danger" onClick={onDelete} style={{padding:"5px 7px"}}>🗑</button>
    </div>}
  </div>;
}

function ZoneView({tasks,saveTasks,rooms,saveRooms,zones,people,tags,memory,setMemory,peopleEmails,defaultCC,kpis,saveKpis,meetings,saveMeetings,zoneOwners,schedules,saveSchedules,tenders,saveTenders,pkgOwners,onNavTender}){
  var mem=memory||{};
  // A "jump here" request left by the tender view takes priority over the remembered state.
  var jumpZone="",jumpTab="";
  try{
    jumpZone=localStorage.getItem("pp_zone_cur")||"";
    jumpTab=localStorage.getItem("pp_zone_subtab")||"";
    if(jumpZone||jumpTab){localStorage.removeItem("pp_zone_cur");localStorage.removeItem("pp_zone_subtab");}
  }catch(e){}
  const [curZone,setCurZone]=useState((jumpZone&&(zones||[]).indexOf(jumpZone)>=0?jumpZone:"")||mem.curZone||(zones||[])[0]||"");
  const [subTab,setSubTab]=useState(jumpTab||mem.subTab||"actions");
  const [hideDone,setHideDone]=useState(true);   // done actions are history, not a to-do list
  const [qAct,setQAct]=useState("");
  const [incomingOpen,setIncomingOpen]=useState(true);
  const [collapsedActCats,setCollapsedActCats]=useState({});
  function toggleActCat(c){setCollapsedActCats(function(p){var o=Object.assign({},p);if(o[c])delete o[c];else o[c]=true;return o;});}
  const [fTags,setFTags]=useState(mem.fTags||[]);
  const [newRoomName,setNewRoomName]=useState("");
  const [roomModalTask,setRoomModalTask]=useState(null);
  const [qText,setQText]=useState("");
  const [qDue,setQDue]=useState("");
  const [qOwner,setQOwner]=useState("");
  const [qTags,setQTags]=useState([]);
  const [showEmail,setShowEmail]=useState(false);
  const [expandedWeek,setExpandedWeek]=useState(null);
  const [showKpiForm,setShowKpiForm]=useState(false);
  const [kpiName,setKpiName]=useState("");
  const [kpiUnit,setKpiUnit]=useState("");
  const [kpiTarget,setKpiTarget]=useState("");
  const [kpiStart,setKpiStart]=useState("");
  const [kpiEnd,setKpiEnd]=useState("");
  const [expandedKpi,setExpandedKpi]=useState(null);
  const [showMeetingHistory,setShowMeetingHistory]=useState(false);
  const [showAttendance,setShowAttendance]=useState(false);
  useEffect(function(){if(setMemory)setMemory({curZone:curZone,subTab:subTab,fTags:fTags});},[curZone,subTab,fTags]);

  var zoneTasks=(tasks||[]).filter(function(t){return t.zone===curZone;});
  var zonePossibleDupes=qText.trim().length>6?zoneTasks.filter(function(t){return t.status!=="done"&&!t.isInfo;}).map(function(t){return{t:t,sim:textSimilarity(qText,t.text)};}).filter(function(x){return x.sim>=0.45;}).sort(function(a,b){return b.sim-a.sim;}).slice(0,3):[];

  // Meetings: history kept, most recent first. The latest one for this zone is the "current" session.
  var zoneMeetings=(meetings||[]).filter(function(m){return m.zone===curZone;}).sort(function(a,b){return(b.date||"").localeCompare(a.date||"");});
  var currentMeeting=zoneMeetings.length?zoneMeetings[0]:null;
  function startNewMeeting(){
    if(!saveMeetings)return;
    saveMeetings([newMeeting({zone:curZone}),...(meetings||[])]);
  }
  function setAttendance(personName,state){
    if(!currentMeeting||!saveMeetings)return;
    saveMeetings((meetings||[]).map(function(m){
      if(m.id!==currentMeeting.id)return m;
      var att=Object.assign({},m.attendance||{});
      if(att[personName]===state)delete att[personName];else att[personName]=state;
      return Object.assign({},m,{attendance:att});
    }));
  }
  function setMeetingDate(d){
    if(!currentMeeting||!saveMeetings)return;
    saveMeetings((meetings||[]).map(function(m){return m.id!==currentMeeting.id?m:Object.assign({},m,{date:d});}));
  }
  function delMeeting(id){
    if(!saveMeetings)return;
    if(safeConfirm("Delete this meeting record? Attendance history for this session will be lost."))saveMeetings((meetings||[]).filter(function(m){return m.id!==id;}));
  }
  function attendanceLists(m){
    var att=(m&&m.attendance)||{};
    return{
      present:Object.keys(att).filter(function(p){return att[p]==="present";}).sort(),
      excused:Object.keys(att).filter(function(p){return att[p]==="excused";}).sort(),
      absent:Object.keys(att).filter(function(p){return att[p]==="absent";}).sort()
    };
  }
  var zoneRooms=(rooms||[]).filter(function(r){return r.zone===curZone;});

  // Weekly PPI (Percentage of Promises kept): for each week, promises = tasks due that week; kept = completed on or before their due date
  function computeWeeklyPPI(){
    var withDue=zoneTasks.filter(function(t){return t.due&&!t.isInfo;});
    var todayStr=today();
    var weeks={};
    withDue.forEach(function(t){
      var d=new Date(t.due);
      var dow=d.getDay();
      var monday=new Date(d);monday.setDate(d.getDate()-(dow===0?6:dow-1));
      var mondayStr=toISO(monday);
      if(!weeks[mondayStr])weeks[mondayStr]={monday:mondayStr,tasks:[]};
      weeks[mondayStr].tasks.push(t);
    });
    return Object.keys(weeks).map(function(k){
      var w=weeks[k];
      var sunday=new Date(w.monday);sunday.setDate(sunday.getDate()+6);
      var sundayStr=toISO(sunday);
      var isPast=sundayStr<todayStr;
      var isCurrent=w.monday<=todayStr&&todayStr<=sundayStr;
      var promised=w.tasks.length;
      var kept=w.tasks.filter(function(t){return t.status==="done"&&t.completedAt&&t.completedAt<=t.due;}).length;
      var doneLate=w.tasks.filter(function(t){return t.status==="done"&&(!t.completedAt||t.completedAt>t.due);}).length;
      var notDone=promised-kept-doneLate;
      var ppi=promised>0?Math.round(kept/promised*100):null;
      return{monday:w.monday,sunday:sundayStr,promised:promised,kept:kept,doneLate:doneLate,notDone:notDone,ppi:ppi,isPast:isPast,isCurrent:isCurrent,tasks:w.tasks};
    }).sort(function(a,b){return b.monday.localeCompare(a.monday);});
  }
  var weeklyPPI=computeWeeklyPPI();
  var pastWeeks=weeklyPPI.filter(function(w){return w.isPast&&w.promised>0;});
  var avgPPI=pastWeeks.length>0?Math.round(pastWeeks.reduce(function(s,w){return s+w.ppi;},0)/pastWeeks.length):null;
  function ppiColor(v){if(v===null)return"#bbb";if(v>=80)return"#2e7d32";if(v>=60)return"#f57f17";return"#c62828";}

  var zoneKpis=(kpis||[]).filter(function(k){return k.zone===curZone;});
  function addKpi(){
    if(!kpiName.trim()||!kpiTarget||!kpiStart||!kpiEnd)return;
    saveKpis([...(kpis||[]),newKPI({zone:curZone,name:kpiName.trim(),unit:kpiUnit.trim(),totalTarget:Number(kpiTarget),startDate:kpiStart,endDate:kpiEnd})]);
    setKpiName("");setKpiUnit("");setKpiTarget("");setKpiStart("");setKpiEnd("");setShowKpiForm(false);
  }
  function delKpi(id){if(safeConfirm("Delete this KPI? All recorded weekly progress will be lost."))saveKpis((kpis||[]).filter(function(k){return k.id!==id;}));}
  function updateKpi(id,field,val){
    saveKpis((kpis||[]).map(function(k){return k.id!==id?k:Object.assign({},k,{[field]:val});}));
  }
  function setKpiWeekActual(kpiId,monday,val){
    saveKpis((kpis||[]).map(function(k){
      if(k.id!==kpiId)return k;
      var wa=Object.assign({},k.weeklyActuals||{});
      if(val===""||val===null)delete wa[monday];else wa[monday]=Number(val);
      return Object.assign({},k,{weeklyActuals:wa});
    }));
  }

  function addTask(){
    if(!qText.trim())return;
    var td={text:qText.trim(),due:qDue,owner:qOwner||(zoneLeadersOf(zoneOwners,curZone)[0]||""),tags:qTags,zone:curZone,importance:1,urgence:1};
    saveTasks([newTask(td),...(tasks||[])]);
    setQText("");setQDue("");setQOwner("");setQTags([]);
  }
  function toggleQTag(tg){setQTags(function(prev){return prev.includes(tg)?prev.filter(function(x){return x!==tg;}):[...prev,tg];});}

  function updateTask(id,updates){
    saveTasks((tasks||[]).map(function(t){return t.id!==id?t:stampModified(Object.assign({},t,updates));}));
  }
  function deleteTask(id){if(safeConfirm("Delete this action?"))saveTasks((tasks||[]).filter(function(t){return t.id!==id;}));}

  // Rooms and schedule categories are kept 1:1 — creating one creates the other.
  function zoneSchedule(){
    var list=(schedules||[]).filter(function(s){return s.zone===curZone;});
    return list.length?list[0]:null;
  }
  function addRoom(){
    if(!newRoomName.trim())return;
    var nm=newRoomName.trim();
    var rm=newRoom({name:nm,zone:curZone});
    saveRooms([...(rooms||[]),rm]);
    // mirror it as a category in the zone's schedule (create the schedule if there is none yet)
    if(saveSchedules){
      var sch=zoneSchedule();
      var catRow=newScheduleRow("category",nm);
      catRow.roomId=rm.id;
      if(sch){
        saveSchedules((schedules||[]).map(function(s){return s.id!==sch.id?s:Object.assign({},s,{rows:[...(s.rows||[]),catRow],updatedAt:today()});}));
      }else{
        saveSchedules([...(schedules||[]),newSchedule({zone:curZone,title:curZone+" schedule",rows:[catRow]})]);
      }
    }
    setNewRoomName("");
  }
  // Manual repair: create a room for every category of this zone that has no valid linked room
  function syncRoomsFromCategories(){
    var zoneScheds=(schedules||[]).filter(function(s){return s.zone===curZone;});
    if(zoneScheds.length===0){safeAlert("No schedule found for "+curZone+".");return;}
    var allRooms=(rooms||[]).slice();
    var created=0;
    var updatedScheds=(schedules||[]).map(function(s){
      if(s.zone!==curZone)return s;
      var changed=false;
      var rows=(s.rows||[]).map(function(r){
        if(r.kind!=="category")return r;
        var linked=r.roomId&&allRooms.some(function(x){return x.id===r.roomId;});
        if(linked)return r;
        var match=allRooms.find(function(x){return x.zone===curZone&&(x.name||"").trim().toLowerCase()===(r.label||"").trim().toLowerCase();});
        if(!match){
          match=newRoom({name:r.label||"Room",zone:curZone});
          allRooms.push(match);
          created++;
        }
        changed=true;
        return Object.assign({},r,{roomId:match.id});
      });
      return changed?Object.assign({},s,{rows:rows}):s;
    });
    // The schedule is the reference: a linked room takes the category's name, and the rooms
    // of this zone are reordered to follow the schedule. Rooms with no category go last.
    var order={};var seq=0;var renamed=0;
    updatedScheds.filter(function(x){return x.zone===curZone;}).forEach(function(x){
      (x.rows||[]).forEach(function(r){
        if(r.kind!=="category"||!r.roomId||order[r.roomId]!==undefined)return;
        order[r.roomId]=seq++;
      });
    });
    allRooms=allRooms.map(function(rm){
      if(rm.zone!==curZone||order[rm.id]===undefined)return rm;
      var cat=null;
      updatedScheds.forEach(function(x){
        if(x.zone!==curZone)return;
        (x.rows||[]).forEach(function(r){if(r.kind==="category"&&r.roomId===rm.id&&!cat)cat=r;});
      });
      if(cat&&(cat.label||"").trim()&&(cat.label||"").trim()!==(rm.name||"").trim()){renamed++;return Object.assign({},rm,{name:cat.label.trim()});}
      return rm;
    });
    var inSched=allRooms.filter(function(rm){return rm.zone===curZone&&order[rm.id]!==undefined;}).sort(function(a,b){return order[a.id]-order[b.id];});
    var orphans=allRooms.filter(function(rm){return rm.zone===curZone&&order[rm.id]===undefined;});
    var others=allRooms.filter(function(rm){return rm.zone!==curZone;});
    saveRooms(others.concat(inSched,orphans));
    saveSchedules(updatedScheds);
    var msg=[];
    if(created>0)msg.push(created+" room"+(created!==1?"s":"")+" created");
    if(renamed>0)msg.push(renamed+" renamed to match the schedule");
    msg.push(inSched.length+" room"+(inSched.length!==1?"s":"")+" reordered to follow the schedule");
    if(orphans.length>0)msg.push(orphans.length+" room"+(orphans.length!==1?"s":"")+" with no category left at the end");
    safeAlert(msg.join("\n"));
  }
  function renameRoom(id,name){
    saveRooms((rooms||[]).map(function(r){return r.id!==id?r:Object.assign({},r,{name:name});}));
    if(saveSchedules){
      saveSchedules((schedules||[]).map(function(s){
        if(s.zone!==curZone)return s;
        return Object.assign({},s,{rows:(s.rows||[]).map(function(r){return(r.kind==="category"&&r.roomId===id)?Object.assign({},r,{label:name}):r;})});
      }));
    }
  }
  function delRoom(id){
    if(!safeConfirm("Remove this room? Its schedule category and the tasks under it will also be removed."))return;
    saveRooms((rooms||[]).filter(function(r){return r.id!==id;}));
    if(saveSchedules){
      saveSchedules((schedules||[]).map(function(s){
        if(s.zone!==curZone)return s;
        var rows=(s.rows||[]).slice();
        var start=rows.findIndex(function(r){return r.kind==="category"&&r.roomId===id;});
        if(start<0)return s;
        var end=start+1;
        while(end<rows.length&&rows[end].kind!=="category")end++;
        rows.splice(start,end-start);
        return Object.assign({},s,{rows:rows,updatedAt:today()});
      }));
    }
  }

  // Room blocking status: a room is blocked if any non-done Blocking Point task in this zone targets it (or "all")
  // Progress of a room = share of its linked schedule rows that are fully done (actual >= planned)
  function roomProgress(roomId){
    var rows=[];
    (schedules||[]).filter(function(s){return s.zone===curZone;}).forEach(function(s){
      (s.rows||[]).forEach(function(r){if(r.roomId===roomId&&r.kind!=="category")rows.push(r);});
    });
    if(rows.length===0)return null;
    var done=0,pctSum=0;
    rows.forEach(function(r){
      var manual=(r.progress!==undefined&&r.progress!==null&&r.progress!=="");
      var pct;
      if(manual){
        pct=Math.max(0,Math.min(100,Number(r.progress)));
      }else{
        var cells=r.cells||{};var plan=0,act=0;
        Object.keys(cells).forEach(function(w){
          var v=cells[w];
          if(v==="plan"||v==="both")plan++;
          if(v==="actual"||v==="both")act++;
        });
        pct=plan===0?(act>0?100:0):Math.min(100,Math.round(act/plan*100));
      }
      pctSum+=pct;
      if(pct>=100)done++;
    });
    return{pct:Math.round(pctSum/rows.length),doneRows:done,totalRows:rows.length};
  }
  function printSection(which){
    document.body.classList.add("printing-schedule");
    setTimeout(function(){window.print();setTimeout(function(){document.body.classList.remove("printing-schedule");},500);},100);
  }
  function roomBlockers(roomId){
    return zoneTasks.filter(function(t){
      if(t.status==="done")return false;
      if(!(t.tags||[]).includes("Blocking Point"))return false;
      if(t.blockedRooms==="all")return true;
      return Array.isArray(t.blockedRooms)&&t.blockedRooms.includes(roomId);
    });
  }

  var doneCount=zoneTasks.filter(function(t){return t.status==="done";}).length;
  var filteredActions=zoneTasks.filter(function(t){
    if(hideDone&&t.status==="done")return false;
    if(fTags.length>0&&!(t.tags||[]).some(function(tg){return fTags.includes(tg);}))return false;
    if(qAct.trim()){
      var hay=[t.text,t.owner,t.status,t.note,(t.tags||[]).join(" "),t.package].join(" ").toLowerCase();
      if(!qAct.trim().toLowerCase().split(/\s+/).every(function(w){return hay.indexOf(w)>=0;}))return false;
    }
    return true;
  });

  // ---- Incoming from procurement ---------------------------------------
  // An action created in a procurement meeting carries a tenderRef but no zone. It surfaces
  // here when it is a blocking point OR due within 3 weeks, and when its tender's package is
  // actually worked in this zone. It stays out of every count until the zone adopts it.
  var zonePackages=(function(){
    var set={};
    zoneTasks.forEach(function(t){if(t.package)set[t.package]=1;});
    (schedules||[]).filter(function(sc){return sc.zone===curZone;}).forEach(function(sc){
      (sc.rows||[]).forEach(function(r){
        if(!r.tenderRef)return;
        var td=(tenders||[]).find(function(x){return x.id===r.tenderRef;});
        if(td&&td.package)set[td.package]=1;
      });
    });
    return set;
  })();
  var horizon3w=(function(){var d=new Date();d.setDate(d.getDate()+21);return toISO(d);})();
  var incomingActions=(tasks||[]).filter(function(t){
    if(t.zone)return false;                       // already owned by a zone
    if(t.status==="done"||t.isInfo)return false;
    if(!t.tenderRef)return false;
    var td=(tenders||[]).find(function(x){return x.id===t.tenderRef;});
    if(!td||!td.package||!zonePackages[td.package])return false;
    var isBlk=(t.tags||[]).includes("Blocking Point");
    var soon=t.due&&t.due<=horizon3w;
    return isBlk||soon;
  }).sort(function(a,b){return (a.due||"9999-12-31").localeCompare(b.due||"9999-12-31");});
  function adoptIncoming(taskId){
    updateTask(taskId,{zone:curZone});
  }

  // Group by first tag for CR-style sections
  var CATEGORY_ORDER=["Blocking Point","Prerequisite","Top Management",...( tags||[]).filter(function(t){return t!=="Blocking Point"&&t!=="Prerequisite"&&t!=="Top Management";})];
  // One action, one section. Prerequisites keep their own; everything else carrying
  // "Blocking Point" — including the procurement ones raised automatically — is filed with
  // the blocking points rather than under whatever tag happened to come first.
  function sectionOf(t){
    var tg=t.tags||[];
    if(tg.indexOf("Prerequisite")>=0)return "Prerequisite";
    if(tg.indexOf("Blocking Point")>=0)return "Blocking Point";
    return CATEGORY_ORDER.find(function(c){return tg.indexOf(c)>=0;})||"General";
  }
  var groups={};
  filteredActions.forEach(function(t){
    var cat=sectionOf(t);
    if(!groups[cat])groups[cat]=[];
    groups[cat].push(t);
  });
  // Within each category: overdue first, then by target date (no date last), done at the bottom
  Object.keys(groups).forEach(function(cat){
    groups[cat].sort(function(a,b){
      if((a.status==="done")!==(b.status==="done"))return a.status==="done"?1:-1;
      return (a.due||"9999-12-31").localeCompare(b.due||"9999-12-31");
    });
  });
  var orderedCats=[...CATEGORY_ORDER.filter(function(c){return groups[c];}),...(groups["General"]?["General"]:[])];

  function buildZoneReport(){
    var NL=String.fromCharCode(10);
    var now=new Date();
    var dateStr=now.toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
    var subject=curZone+" — 3 Weeks Lookahead Report — "+dateStr;
    var lines=[];

    lines.push(curZone.toUpperCase()+" — 3 WEEKS LOOKAHEAD REPORT");
    lines.push(now.toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}));
    lines.push("");

    // Attendance block (from the latest recorded meeting for this zone)
    if(currentMeeting){
      var att=attendanceLists(currentMeeting);
      var recorded=att.present.length+att.excused.length+att.absent.length;
      if(recorded>0){
        lines.push("ATTENDANCE — "+att.present.length+" of "+recorded+" (meeting "+fmtDate(currentMeeting.date)+")");
        lines.push("-".repeat(40));
        if(att.present.length>0)lines.push("Present: "+att.present.map(function(p){return p.split(",")[0];}).join(", "));
        if(att.excused.length>0)lines.push("Excused: "+att.excused.map(function(p){return p.split(",")[0];}).join(", "));
        if(att.absent.length>0)lines.push("Absent: "+att.absent.map(function(p){return p.split(",")[0];}).join(", "));
        lines.push("");
      }
    }

    // Lookahead window: today (including overdue) through the next 21 days. Actions with no due date and Blocking Points are always included regardless of date.
    var lookaheadEnd=(function(){var d=new Date();d.setDate(d.getDate()+21);return toISO(d);})();
    var lookaheadActions=filteredActions.filter(function(t){
      if((t.tags||[]).includes("Blocking Point"))return true;
      if(!t.due)return true;
      return t.due<=lookaheadEnd;
    });

    var pending=lookaheadActions.filter(function(t){return t.status!=="done";}).length;
    var done=lookaheadActions.filter(function(t){return t.status==="done";}).length;
    var lastWeek=pastWeeks.length>0?pastWeeks[0]:null;
    var relStr="";
    if(lastWeek){
      var rangeStr=fmtDate(lastWeek.monday).slice(0,5)+"-"+fmtDate(lastWeek.sunday);
      relStr=" - Last week's reliability: "+lastWeek.ppi+"% ("+rangeStr+")";
    }
    lines.push(lookaheadActions.length+" action"+(lookaheadActions.length!==1?"s":"")+" due within 3 weeks - "+done+" done - "+pending+" pending"+relStr);
    lines.push("");

    var lookaheadGroups={};
    lookaheadActions.forEach(function(t){
      var cat=CATEGORY_ORDER.find(function(c){return(t.tags||[]).includes(c);})||"General";
      if(!lookaheadGroups[cat])lookaheadGroups[cat]=[];
      lookaheadGroups[cat].push(t);
    });
    var lookaheadCats=[...CATEGORY_ORDER.filter(function(c){return lookaheadGroups[c];}),...(lookaheadGroups["General"]?["General"]:[])];

    lookaheadCats.forEach(function(cat){
      var items=lookaheadGroups[cat];
      lines.push(cat.toUpperCase()+" — "+items.length+" item"+(items.length!==1?"s":""));
      lines.push("-".repeat(40));
      items.forEach(function(t){
        var isBlocking=(t.tags||[]).includes("Blocking Point");
        var mark=isBlocking?"[BLOCKING] ":"    ["+(t.status||"pending").toUpperCase()+"] ";
        var owner=t.owner?" — "+t.owner.split(",")[0]:"";
        var due="";
        if(t.due){
          var isLate=t.due<today()&&t.status!=="done";
          due=" — due "+fmtDate(t.due)+(isLate?" (late "+workingDaysDiff(t.due,today())+"d)":"");
        }
        var rooms="";
        if(isBlocking){
          if(t.blockedRooms==="all")rooms=" — ALL rooms";
          else if(Array.isArray(t.blockedRooms)&&t.blockedRooms.length>0)rooms=" — "+t.blockedRooms.length+" room"+(t.blockedRooms.length!==1?"s":"");
        }
        lines.push(mark+t.text+owner+due+rooms);
      });
      lines.push("");
    });

    if(zoneRooms.length>0){
      var blockedRoomsList=zoneRooms.filter(function(r){return roomBlockers(r.id).length>0;});
      lines.push("ROOM STATUS — "+blockedRoomsList.length+" of "+zoneRooms.length+" rooms blocked");
      lines.push("-".repeat(40));
      if(blockedRoomsList.length===0){
        lines.push("    No blocked rooms");
      }else{
        blockedRoomsList.forEach(function(r){
          var blockers=roomBlockers(r.id);
          lines.push("[BLOCKED] "+r.name+" — blocked by: "+blockers.map(function(b){return b.text;}).join("; "));
        });
      }
      lines.push("");
    }

    lines.push("Generated automatically — Riviera Tower Project Pilot");
    var body=lines.join(NL);

    // Resolve recipients: action owners + everyone recorded at the meeting (present, excused AND absent — they all need the MoM), plus defaultCC
    var ownerNames=[...new Set(filteredActions.map(function(t){return t.owner;}).filter(Boolean))];
    var attendeeNames=currentMeeting?Object.keys(currentMeeting.attendance||{}):[];
    var zoneResp=zoneLeadersOf(zoneOwners,curZone);
    var toNames=[...new Set([...ownerNames,...attendeeNames,...zoneResp])];
    var missing=[];
    var to=toNames.map(function(n){var em2=(peopleEmails||{})[n];if(!em2)missing.push(n);return em2;}).filter(Boolean);
    var cc=(defaultCC||[]).map(function(n){var em2=(peopleEmails||{})[n];if(!em2)missing.push(n);return em2;}).filter(Boolean);
    return{subject:subject,body:body,to:to,cc:cc,missing:missing};
  }

  return <div style={{padding:"16px 20px",overflowY:"auto",flex:1}}>
    {/* Same title block as the tender sheet: the zone reads as a document too. */}
    <div className="titleblock" style={{display:"flex",alignItems:"stretch",overflow:"hidden",
      border:"1.5px solid var(--ink,#16181d)",borderRadius:8,background:"#fff",marginBottom:16}}>
      <div className="tb-main" style={{flex:1,minWidth:0,padding:"12px 16px"}}>
        <div className="tb-eyebrow" style={{fontSize:11,fontWeight:600,letterSpacing:".09em",
          textTransform:"uppercase",color:"var(--ink-3,#6f6b62)",marginBottom:3}}>Zone workspace</div>
        <h2 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-page,24px)",
          lineHeight:1.08,letterSpacing:"-.01em"}}>{curZone||"—"}</h2>
        <div className="tb-sub" style={{fontSize:12,color:"var(--ink-3,#6f6b62)",marginTop:3}}>
          {zoneLeadersOf(zoneOwners,curZone).length>0
            ?"Led by "+zoneLeadersOf(zoneOwners,curZone).map(function(p){return p.split(",")[0];}).join(", ")
            :"No zone leader set"}</div>
      </div>
      <div className="tb-cells" style={{display:"flex",borderLeft:"1.5px solid var(--ink,#16181d)",flexShrink:0}}>
        {(function(){
          var open=zoneTasks.filter(function(a){return a.status!=="done";});
          var cells=[
            {k:"Open",v:String(open.length),c:"#16181d"},
            {k:"Blocking",v:String(open.filter(function(a){return (a.tags||[]).indexOf("Blocking Point")>=0;}).length),c:"var(--red,#b3302a)"},
            {k:"Overdue",v:String(open.filter(function(a){return a.due&&a.due<today();}).length),c:"var(--amber,#b35c00)"},
            {k:"Rooms",v:String(zoneRooms.length),c:"#16181d"}
          ];
          return cells.map(function(c){
            return <div className="tb-cell" key={c.k} style={{padding:"10px 15px",borderRight:"1px solid var(--rule,#ddd9cf)",minWidth:82}}>
              <span className="k" style={{display:"block",fontSize:9.5,fontWeight:600,letterSpacing:".09em",
                textTransform:"uppercase",color:"var(--ink-3,#6f6b62)",marginBottom:2}}>{c.k}</span>
              <span className="v" style={{display:"block",fontSize:17,fontWeight:700,color:c.c,lineHeight:1.1}}>{c.v}</span>
            </div>;
          });
        })()}
      </div>
    </div>
    <div className="page-hdr" style={{marginBottom:12,justifyContent:"flex-end"}}>
      {subTab==="actions"&&filteredActions.length>0&&<button className="btn btn-gold" onClick={function(){setShowEmail(true);}}>📧 Report</button>}
      <button className="btn btn-pri" title="Friday pack: programme progress, room by room, procurement delays, the readiness questionnaire for the next 3 weeks and the actions"
        onClick={function(){openReport("Weekly Zone Report — "+curZone,buildZoneWeeklyReport(curZone,schedules,rooms,tasks,tenders));}}>🗓 Weekly pack</button>
    </div>

    {showEmail&&<EmailModal em={buildZoneReport()} onClose={function(){setShowEmail(false);}}/>}

    {(zones||[]).length>1&&<div style={{display:"flex",gap:6,marginBottom:14}}>
      {(zones||[]).map(function(z){return <button key={z} className={"fchip"+(curZone===z?" on gold":"")} onClick={function(){setCurZone(z);}} style={curZone===z?{background:"#c9a84c",borderColor:"#c9a84c",color:"#1c1c1e"}:{}}>{z}</button>;})}
    </div>}

    <div style={{display:"flex",gap:6,marginBottom:16}}>
      <button className={"fchip"+(subTab==="actions"?" on":"")} onClick={function(){setSubTab("actions");}}>📋 Actions</button>
      <button className={"fchip"+(subTab==="rooms"?" on":"")} onClick={function(){setSubTab("rooms");}}>🚪 Rooms {zoneRooms.filter(function(r){return roomBlockers(r.id).length>0;}).length>0&&<span style={{marginLeft:4,color:"#c62828",fontWeight:700}}>({zoneRooms.filter(function(r){return roomBlockers(r.id).length>0;}).length} blocked)</span>}</button>
      <button className={"fchip"+(subTab==="ppi"?" on":"")} onClick={function(){setSubTab("ppi");}}>📈 PPI Tracker {avgPPI!==null&&<span style={{marginLeft:4,fontWeight:800,color:ppiColor(avgPPI)}}>{avgPPI}%</span>}</button>
      <button className={"fchip"+(subTab==="kpi"?" on":"")} onClick={function(){setSubTab("kpi");}}>📊 KPI Tracker</button>
      <button className={"fchip"+(subTab==="schedule"?" on":"")} onClick={function(){setSubTab("schedule");}}>📅 Schedule</button>
    </div>

    {subTab==="actions"&&<div>
      <div className="card" style={{marginBottom:14}}>
        <div onClick={function(){if(currentMeeting)setShowAttendance(!showAttendance);}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:(currentMeeting&&showAttendance)?10:0,flexWrap:"wrap",gap:8,cursor:currentMeeting?"pointer":"default"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {currentMeeting&&<span style={{fontSize:11,color:"#aaa"}}>{showAttendance?"▾":"▸"}</span>}
            <div style={{fontWeight:700,fontSize:13}}>👥 Meeting attendance</div>
            {currentMeeting&&(function(){
              var l=attendanceLists(currentMeeting);
              var total=l.present.length+l.excused.length+l.absent.length;
              return <span style={{fontSize:11,color:"#888"}}>
                {fmtDate(currentMeeting.date)} · <strong style={{color:"#2e7d32"}}>{l.present.length} present</strong>
                {l.excused.length>0&&<span style={{color:"#f57f17"}}> · {l.excused.length} excused</span>}
                {l.absent.length>0&&<span style={{color:"#c62828"}}> · {l.absent.length} absent</span>}
                {total===0&&<span style={{color:"#bbb"}}> · nothing recorded yet</span>}
              </span>;
            })()}
          </div>
          <div style={{display:"flex",gap:6}} onClick={function(e){e.stopPropagation();}}>
            {zoneMeetings.length>1&&<button className="btn btn-sm" onClick={function(){setShowMeetingHistory(!showMeetingHistory);}}>{showMeetingHistory?"✕ Hide history":"🕘 History ("+zoneMeetings.length+")"}</button>}
            <button className="btn btn-sm btn-gold" onClick={startNewMeeting}>＋ New meeting</button>
          </div>
        </div>

        {!currentMeeting&&<div style={{fontSize:12,color:"#bbb"}}>No meeting started for {curZone}. Click "＋ New meeting" to record attendance — it will appear at the top of the 3 Weeks Lookahead Report.</div>}

        {currentMeeting&&showAttendance&&<div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Meeting date</span>
            <input type="date" min="1990-01-01" max="2200-12-31" value={currentMeeting.date||""} onChange={function(e){setMeetingDate(e.target.value);}} style={{padding:"5px 7px",fontSize:11,border:"1px solid #e8e6df",borderRadius:5}}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:4}}>
            {(people||[]).map(function(p){
              var st=(currentMeeting.attendance||{})[p]||"";
              var c=ownerColor(p);
              return <div key={p} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 6px",borderRadius:6,background:st?"#fafaf8":"transparent"}}>
                <span style={{flex:1,fontSize:11,fontWeight:st?600:400,color:st?c.accent:"#bbb",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.split(",")[0]}</span>
                {[{k:"present",label:"P",col:"#2e7d32",bg:"#e8f5e9"},{k:"excused",label:"E",col:"#f57f17",bg:"#fff8e1"},{k:"absent",label:"A",col:"#c62828",bg:"#fce4ec"}].map(function(opt){
                  var on=st===opt.k;
                  return <button key={opt.k} onClick={function(){setAttendance(p,opt.k);}} title={opt.k} style={{width:22,height:20,borderRadius:5,border:"1.5px solid "+(on?opt.col:"#ddd"),background:on?opt.bg:"#fff",color:on?opt.col:"#ccc",fontFamily:"inherit",fontSize:10,fontWeight:800,cursor:"pointer",flexShrink:0,padding:0}}>{opt.label}</button>;
                })}
              </div>;
            })}
          </div>
        </div>}

        {showMeetingHistory&&zoneMeetings.length>1&&<div style={{marginTop:12,paddingTop:10,borderTop:"1.5px solid #f0ede6"}}>
          <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6}}>Past meetings</div>
          {zoneMeetings.slice(1).map(function(m){
            var l=attendanceLists(m);
            return <div key={m.id} style={{padding:"6px 10px",borderRadius:7,background:"#fafaf8",marginBottom:4,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:700,minWidth:80}}>{fmtDate(m.date)}</span>
              <span style={{fontSize:10,color:"#2e7d32"}}>{l.present.length} present</span>
              {l.excused.length>0&&<span style={{fontSize:10,color:"#f57f17"}}>{l.excused.length} excused</span>}
              {l.absent.length>0&&<span style={{fontSize:10,color:"#c62828"}}>{l.absent.length} absent</span>}
              <span style={{flex:1,fontSize:10,color:"#aaa",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.present.map(function(p){return p.split(",")[0];}).join(", ")}</span>
              <button onClick={function(){delMeeting(m.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:12}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
            </div>;
          })}
        </div>}
      </div>

      <div className="card" style={{marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>＋ Add action to {curZone}</div>
        <textarea value={qText} onChange={function(e){setQText(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addTask();}}} placeholder="What needs to be done in this zone?" style={{width:"100%",minHeight:44,padding:"6px 8px",fontSize:12,border:"1.5px solid #e8e6df",borderRadius:6,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",marginBottom:8}}/>
        {zonePossibleDupes.length>0&&<div style={{marginBottom:8,padding:"8px 10px",background:"#fff8e1",border:"1.5px solid #ffe082",borderRadius:8}}>
          <div style={{fontSize:11,fontWeight:700,color:"#b45309",marginBottom:4}}>⚠️ Similar action{zonePossibleDupes.length!==1?"s":""} already open in {curZone} — check before adding a duplicate:</div>
          {zonePossibleDupes.map(function(x){return <div key={x.t.id} style={{fontSize:11,color:"#555",padding:"3px 0",borderTop:"1px solid #fed7aa"}}>
            <strong>{x.t.text}</strong>{x.t.owner&&" — "+x.t.owner.split(",")[0]}
          </div>;})}
        </div>}
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
          <input type="date" min="1990-01-01" max="2200-12-31" value={qDue} onChange={function(e){setQDue(e.target.value);}} style={{padding:"4px 7px",fontSize:11,border:"1px solid #ddd",borderRadius:5}}/>
          <select value={qOwner} onChange={function(e){setQOwner(e.target.value);}} style={{padding:"4px 7px",fontSize:11,border:"1px solid #ddd",borderRadius:5,fontFamily:"inherit"}}>
            <option value="">No owner</option>
            {(people||[]).map(function(p){return <option key={p} value={p}>{p.split(",")[0]}</option>;})}
          </select>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
          {(tags||[]).map(function(tg){var on=qTags.includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){toggleQTag(tg);}} style={{padding:"5px 9px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
        </div>
        <button className="btn btn-gold" onClick={addTask} disabled={!qText.trim()}>＋ Add — auto-tagged {curZone}</button>
      </div>

      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16,alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Filter:</span>
        {(tags||[]).map(function(tg){var on=fTags.includes(tg);var tc=tagColor(tg);return <button key={tg} onClick={function(){setFTags(function(prev){return prev.includes(tg)?prev.filter(function(x){return x!==tg;}):[...prev,tg];});}} style={{padding:"5px 9px",borderRadius:20,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
        {fTags.length>0&&<button className="btn btn-sm" onClick={function(){setFTags([]);}}>✕ Reset</button>}
        <input type="text" value={qAct} onChange={function(e){setQAct(e.target.value);}}
          placeholder="🔎 Search…" style={{width:180,padding:"5px 9px",fontSize:11,marginLeft:6}}/>
        <label style={{display:"flex",alignItems:"center",gap:4,fontSize:10,textTransform:"none",letterSpacing:"normal",cursor:"pointer",color:"#888",margin:0}}>
          <input type="checkbox" checked={hideDone} onChange={function(e){setHideDone(e.target.checked);}} style={{width:12,height:12}}/>
          Hide done{doneCount>0?" ("+doneCount+")":""}
        </label>
      </div>

      {incomingActions.length>0&&<div style={{marginBottom:18,border:"1.5px solid #ffe082",borderRadius:10,background:"#fffdf5",padding:"10px 12px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <span style={{padding:"5px 12px",borderRadius:20,background:"#fff8e1",color:"#f57f17",fontWeight:800,fontSize:12}}>⬇ FROM PROCUREMENT</span>
          <span style={{fontSize:11,color:"#aaa"}}>{incomingActions.length} item{incomingActions.length!==1?"s":""}</span>
          <button className="btn btn-sm" style={{marginLeft:"auto",padding:"3px 10px",fontSize:11}}
            onClick={function(){setIncomingOpen(!incomingOpen);}}>{incomingOpen?"▾ Hide":"▸ Show"}</button>
          <span style={{fontSize:10,color:"#bbb",fontStyle:"italic"}}>blocking points or due within 3 weeks, on a package worked in {curZone} — not counted until adopted</span>
        </div>
        {incomingOpen&&incomingActions.map(function(t){
          return <ZoneActionRow key={t.id} task={t} rooms={zoneRooms} tenders={tenders}
            onUpdate={function(u){updateTask(t.id,u);}}
            onDelete={function(){deleteTask(t.id);}}
            onOpenRoomModal={function(){setRoomModalTask(t);}}
            onAdopt={function(){adoptIncoming(t.id);}}
            people={people} tags={tags}/>;
        })}
      </div>}

      {filteredActions.length===0&&<div className="empty"><div className="empty-ico">📋</div><div className="empty-txt">No actions for {curZone} yet.</div></div>}

      {orderedCats.map(function(cat){
        var items=groups[cat];
        var tc=cat==="General"?{bg:"#f5f4f0",color:"#888"}:tagColor(cat);
        return <div key={cat} style={{marginBottom:18}}>
          <div onClick={function(){toggleActCat(cat);}} title="Click to collapse or expand this section"
            style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,paddingBottom:6,borderBottom:"2px solid "+tc.color,cursor:"pointer",userSelect:"none"}}>
            <span style={{fontSize:11,color:tc.color,width:10}}>{collapsedActCats[cat]?"▸":"▾"}</span>
            <span style={{padding:"5px 12px",borderRadius:20,background:tc.bg,color:tc.color,fontWeight:800,fontSize:12,letterSpacing:".3px"}}>{cat==="Blocking Point"?"🚧 ":cat==="Prerequisite"?"🔒 ":cat==="Warning"?"🟠 ":""}{cat.toUpperCase()}</span>
            <span style={{fontSize:11,color:"#aaa"}}>{items.length} item{items.length!==1?"s":""}</span>
            {(function(){var late=items.filter(function(t){return t.due&&t.due<today()&&t.status!=="done";}).length;return late>0?<span style={{fontSize:11,fontWeight:700,color:"#c62828"}}>· {late} overdue</span>:null;})()}
          </div>
          {!collapsedActCats[cat]&&items.map(function(t){
            return <ZoneActionRow key={t.id} task={t} rooms={zoneRooms} tenders={tenders}
              onUpdate={function(u){updateTask(t.id,u);}}
              onDelete={function(){deleteTask(t.id);}}
              onOpenRoomModal={function(){setRoomModalTask(t);}}
              people={people} tags={tags}/>;
          })}
        </div>;
      })}
    </div>}

    {subTab==="rooms"&&<div>
      <div className="card sched-noprint" style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontWeight:700,fontSize:13}}>＋ Add room to {curZone}</div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn btn-sm" onClick={syncRoomsFromCategories} title="The schedule is the reference: creates missing rooms, renames them to match their category, and reorders the list to follow the schedule">🔄 Sync from schedule</button>
            <button className="btn btn-sm" onClick={function(){printSection("rooms");}}>🖨 Print / PDF</button>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <input type="text" value={newRoomName} onChange={function(e){setNewRoomName(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addRoom();}} placeholder="Room name / number…" style={{flex:1,padding:"6px 10px",fontSize:12}}/>
          <button className="btn btn-gold" onClick={addRoom} disabled={!newRoomName.trim()}>＋ Add</button>
        </div>
      </div>

      <div className="sched-print-only">
        <div style={{fontSize:16,fontWeight:800}}>{curZone} — Room status</div>
        <div style={{fontSize:11,color:"#555"}}>Printed {fmtDate(today())}</div>
      </div>

      {zoneRooms.length===0
        ?<div className="empty"><div className="empty-ico">🚪</div><div className="empty-txt">No rooms defined for {curZone} yet.</div></div>
        :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:10}}>
          {zoneRooms.map(function(r){
            var blockers=roomBlockers(r.id);
            var isBlocked=blockers.length>0;
            var prog=roomProgress(r.id);
            return <div key={r.id} className="card" style={{marginBottom:0,padding:"12px 14px",borderColor:isBlocked?"#f48fb1":"#e8e6df",background:isBlocked?"#fff5f7":"#fff"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{width:12,height:12,borderRadius:"50%",background:isBlocked?"#c62828":"#4caf50",flexShrink:0,boxShadow:isBlocked?"0 0 0 3px #fce4ec":"0 0 0 3px #e8f5e9"}}/>
                <input type="text" value={r.name||""} onChange={function(e){renameRoom(r.id,e.target.value);}} style={{flex:1,fontWeight:700,fontSize:13,border:"none",background:"transparent",outline:"none",fontFamily:"inherit",padding:0,minWidth:0}}/>
                <button className="sched-noprint" onClick={function(){delRoom(r.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:12}} onMouseEnter={function(e){e.currentTarget.style.color="#c62828";}} onMouseLeave={function(e){e.currentTarget.style.color="#ddd";}}>🗑</button>
              </div>

              {prog!==null&&<div style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#888",marginBottom:2}}>
                  <span>Schedule progress</span>
                  <span style={{fontWeight:800,color:prog.pct>=100?"#2e7d32":prog.pct>0?"#1565c0":"#bbb"}}>{prog.pct}%</span>
                </div>
                <div className="pbar"><div className="pfill" style={{width:prog.pct+"%",background:prog.pct>=100?"#2e7d32":"#1a73e8"}}/></div>
                <div style={{fontSize:11,color:"#aaa",marginTop:2}}>{prog.doneRows}/{prog.totalRows} task{prog.totalRows!==1?"s":""} complete</div>
              </div>}
              {prog===null&&<div style={{fontSize:10,color:"#ccc",marginBottom:8,fontStyle:"italic"}}>No schedule rows linked to this room</div>}

              {isBlocked&&<div style={{display:"flex",flexDirection:"column",gap:3}}>
                {blockers.map(function(b){return <div key={b.id} style={{fontSize:11,color:"#c62828",background:"#fce4ec",padding:"5px 8px",borderRadius:5,fontWeight:600}}>🚧 {b.text}</div>;})}
              </div>}
              {!isBlocked&&<div style={{fontSize:11,color:"#2e7d32",fontWeight:600}}>✅ No blocking points</div>}
            </div>;
          })}
        </div>}
    </div>}

    {subTab==="ppi"&&<div>
      <div className="card" style={{marginBottom:14,padding:"16px 18px"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",letterSpacing:".4px"}}>Average PPI</div>
            <div style={{fontSize:32,fontWeight:900,color:ppiColor(avgPPI)}}>{avgPPI!==null?avgPPI+"%":"—"}</div>
            <div style={{fontSize:10,color:"#888"}}>{pastWeeks.length} week{pastWeeks.length!==1?"s":""} with completed history</div>
          </div>
          <div style={{flex:1,minWidth:200,fontSize:12,color:"#888",lineHeight:1.5}}>
            <strong>PPI (Percentage of Promises kept)</strong> — for each past week, the share of actions due that week that were actually completed on or before their due date. This is the classic Last Planner reliability metric: 🟢 ≥80% reliable · 🟠 60-79% variable · 🔴 &lt;60% at risk.
          </div>
        </div>
      </div>

      {weeklyPPI.length===0
        ?<div className="empty"><div className="empty-ico">📈</div><div className="empty-txt">No actions with due dates in {curZone} yet. PPI needs due dates to track promises.</div></div>
        :<div>
          <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,marginBottom:16}}>
            {weeklyPPI.slice(0,12).map(function(w){
              var isOpen=expandedWeek===w.monday;
              return <div key={w.monday} onClick={function(){setExpandedWeek(isOpen?null:w.monday);}} style={{flex:"0 0 100px",cursor:"pointer",padding:"10px 8px",borderRadius:10,border:"1.5px solid "+(isOpen?ppiColor(w.ppi):"#e8e6df"),background:w.isCurrent?"#fff8e1":isOpen?"#fafaf8":"#fff",textAlign:"center"}}>
                <div style={{fontSize:11,color:"#aaa",fontWeight:700}}>{fmtDate(w.monday)}</div>
                <div style={{fontSize:20,fontWeight:900,color:w.isCurrent?"#f57f17":ppiColor(w.ppi),marginTop:4}}>{w.ppi!==null?w.ppi+"%":"—"}</div>
                <div style={{fontSize:11,color:"#888",marginTop:2}}>{w.kept}/{w.promised}</div>
                {w.isCurrent&&<div style={{fontSize:11,fontWeight:800,color:"#f57f17",marginTop:2}}>IN PROGRESS</div>}
              </div>;
            })}
          </div>

          {expandedWeek&&(function(){
            var w=weeklyPPI.find(function(x){return x.monday===expandedWeek;});
            if(!w)return null;
            return <div className="card">
              <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Week of {fmtDate(w.monday)} — {fmtDate(w.sunday)} {w.isCurrent&&<span style={{color:"#f57f17"}}>(in progress)</span>}</div>
              <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
                <div style={{fontSize:12}}><span style={{color:"#2e7d32",fontWeight:700}}>✓ {w.kept}</span> kept on time</div>
                <div style={{fontSize:12}}><span style={{color:"#f57f17",fontWeight:700}}>⏰ {w.doneLate}</span> done late</div>
                <div style={{fontSize:12}}><span style={{color:"#c62828",fontWeight:700}}>✗ {w.notDone}</span> not done</div>
              </div>
              {w.tasks.slice().sort(function(a,b){
                function rank(t){if(t.status==="done"&&t.completedAt&&t.completedAt<=t.due)return 0;if(t.status==="done")return 1;return 2;}
                return rank(a)-rank(b);
              }).map(function(t){
                var onTime=t.status==="done"&&t.completedAt&&t.completedAt<=t.due;
                var late=t.status==="done"&&!onTime;
                return <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,background:onTime?"#f0fff4":late?"#fff8e1":"#fff5f7",marginBottom:4}}>
                  <span style={{fontSize:14}}>{onTime?"✅":late?"⏰":"❌"}</span>
                  <div style={{flex:1,fontSize:12}}>{t.text}</div>
                  {t.owner&&<OwnerChip owner={t.owner}/>}
                  <span style={{fontSize:10,color:"#888"}}>due {fmtDate(t.due)}</span>
                  {t.completedAt&&<span style={{fontSize:10,color:onTime?"#2e7d32":"#f57f17"}}>done {fmtDate(t.completedAt)}</span>}
                </div>;
              })}
            </div>;
          })()}
        </div>}
    </div>}

        {subTab==="kpi"&&<div>
      <div className="sched-print-only">
        <div style={{fontSize:16,fontWeight:800}}>{curZone} — KPI progress</div>
        <div style={{fontSize:11,color:"#555"}}>Printed {fmtDate(today())}</div>
      </div>
      <div className="card sched-noprint" style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showKpiForm?10:0}}>
          <div style={{fontWeight:700,fontSize:13}}>📊 KPI Tracker — {curZone}</div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn btn-sm" onClick={function(){printSection("kpi");}}>🖨 Print / PDF</button>
            <button className="btn btn-sm btn-gold" onClick={function(){setShowKpiForm(!showKpiForm);}}>{showKpiForm?"✕ Cancel":"＋ Add KPI"}</button>
          </div>
        </div>
        {showKpiForm&&<div style={{marginTop:10}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <div style={{flex:2,minWidth:160}}>
              <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>KPI name</label>
              <input type="text" value={kpiName} onChange={function(e){setKpiName(e.target.value);}} placeholder="e.g. Concrete, Trench, Plasterboard Storage…" style={{padding:"5px 8px",fontSize:12}}/>
            </div>
            <div style={{flex:1,minWidth:90}}>
              <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Unit</label>
              <input type="text" value={kpiUnit} onChange={function(e){setKpiUnit(e.target.value);}} placeholder="m3, ml…" style={{padding:"5px 8px",fontSize:12}}/>
            </div>
            <div style={{flex:1,minWidth:100}}>
              <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Total target</label>
              <input type="number" value={kpiTarget} onChange={function(e){setKpiTarget(e.target.value);}} placeholder="0" style={{padding:"5px 8px",fontSize:12}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
            <div style={{flex:1,minWidth:130}}>
              <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Start date</label>
              <input type="date" min="1990-01-01" max="2200-12-31" value={kpiStart} onChange={function(e){setKpiStart(e.target.value);}} style={{padding:"5px 8px",fontSize:12}}/>
            </div>
            <div style={{flex:1,minWidth:130}}>
              <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>End date</label>
              <input type="date" min="1990-01-01" max="2200-12-31" value={kpiEnd} onChange={function(e){setKpiEnd(e.target.value);}} style={{padding:"5px 8px",fontSize:12}}/>
            </div>
          </div>
          <button className="btn btn-pri" onClick={addKpi} disabled={!kpiName.trim()||!kpiTarget||!kpiStart||!kpiEnd}>＋ Create KPI</button>
        </div>}
      </div>

      {zoneKpis.length===0
        ?<div className="empty"><div className="empty-ico">📊</div><div className="empty-txt">No KPIs tracked for {curZone} yet.</div></div>
        :zoneKpis.map(function(kpi){
          var weeks=kpiWeeks(kpi);
          var lastWeek=weeks.length?weeks[weeks.length-1]:null;
          var curWeek=weeks.find(function(w){return w.isCurrent;});
          var latestDone=weeks.slice().reverse().find(function(w){return w.isPast||w.isCurrent;});
          var pctDone=kpi.totalTarget>0&&latestDone?Math.min(100,Math.round(latestDone.actualCum/kpi.totalTarget*100)):0;
          var isOpen=expandedKpi===kpi.id;
          var behindSchedule=latestDone&&latestDone.actualCum<latestDone.plannedCum;
          return <div key={kpi.id} className="card" style={{marginBottom:10,padding:0,overflow:"hidden"}}>
            <div onClick={function(){setExpandedKpi(isOpen?null:kpi.id);}} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",background:isOpen?"#fafaf8":"#fff",flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:"#aaa"}}>{isOpen?"▾":"▸"}</span>
              <div style={{flex:1,minWidth:150}}>
                <div style={{fontWeight:700,fontSize:13}}>{kpi.name}</div>
                <div style={{fontSize:10,color:"#888"}}>{fmtDate(kpi.startDate)} → {fmtDate(kpi.endDate)} · target {Number(kpi.totalTarget).toLocaleString()} {kpi.unit}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:16,fontWeight:900,color:pctDone>=100?"#2e7d32":behindSchedule?"#c62828":"#1a73e8"}}>{pctDone}%</div>
                <div style={{fontSize:11,color:behindSchedule?"#c62828":"#888",fontWeight:behindSchedule?700:400}}>{behindSchedule?"behind schedule":"on/ahead of schedule"}</div>
              </div>
            </div>

            {isOpen&&<div style={{padding:"14px 16px",borderTop:"1.5px solid #f0ede6"}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12,padding:"10px 12px",background:"#fafaf8",borderRadius:8,border:"1px solid #e8e6df"}}>
                <div style={{flex:2,minWidth:150}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>KPI name</label>
                  <input type="text" value={kpi.name||""} onChange={function(e){updateKpi(kpi.id,"name",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
                </div>
                <div style={{flex:1,minWidth:70}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Unit</label>
                  <input type="text" value={kpi.unit||""} onChange={function(e){updateKpi(kpi.id,"unit",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
                </div>
                <div style={{flex:1,minWidth:90}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Total target</label>
                  <input type="number" value={kpi.totalTarget||""} onChange={function(e){updateKpi(kpi.id,"totalTarget",Number(e.target.value));}} style={{padding:"4px 8px",fontSize:12}}/>
                </div>
                <div style={{flex:1,minWidth:120}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Start</label>
                  <input type="date" min="1990-01-01" max="2200-12-31" value={kpi.startDate||""} onChange={function(e){updateKpi(kpi.id,"startDate",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
                </div>
                <div style={{flex:1,minWidth:120}}>
                  <label style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>End</label>
                  <input type="date" min="1990-01-01" max="2200-12-31" value={kpi.endDate||""} onChange={function(e){updateKpi(kpi.id,"endDate",e.target.value);}} style={{padding:"4px 8px",fontSize:12}}/>
                </div>
                <button className="btn btn-sm btn-danger" onClick={function(){delKpi(kpi.id);}}>🗑 Delete</button>
              </div>
              <KPICurveChart kpi={kpi} weeks={weeks}/>

              {(function(){
                if(!latestDone)return null;
                var elapsedWeeks=latestDone.weekIndex+1;
                var remaining=Math.max(0,Number(kpi.totalTarget)-latestDone.actualCum);
                var weeksLeftInPlan=weeks.length-elapsedWeeks;
                var neededRate=weeksLeftInPlan>0?remaining/weeksLeftInPlan:(remaining>0?null:0);
                var avgRate=elapsedWeeks>0?latestDone.actualCum/elapsedWeeks:0;
                var projFinishLabel="—";
                if(remaining<=0){projFinishLabel="Target already reached";}
                else if(avgRate>0){
                  var weeksToFinish=remaining/avgRate;
                  var projDate=new Date(latestDone.monday);projDate.setDate(projDate.getDate()+Math.ceil(weeksToFinish)*7);
                  projFinishLabel=fmtDate(toISO(projDate));
                }else{
                  projFinishLabel="No progress yet";
                }
                var isLateVsPlan=avgRate>0&&(function(){var d=new Date(latestDone.monday);d.setDate(d.getDate()+Math.ceil(remaining/avgRate)*7);return toISO(d)>kpi.endDate;})();
                return <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                  <div className="card" style={{flex:1,minWidth:150,marginBottom:0,padding:"8px 12px",background:"#f8f7f4"}}>
                    <div style={{fontSize:11,color:"#888",textTransform:"uppercase",fontWeight:700}}>Current avg. pace</div>
                    <div style={{fontSize:14,fontWeight:800}}>{avgRate.toLocaleString(undefined,{maximumFractionDigits:1})} {kpi.unit}/week</div>
                  </div>
                  <div className="card" style={{flex:1,minWidth:170,marginBottom:0,padding:"8px 12px",background:weeksLeftInPlan<=0&&remaining>0?"#fce4ec":"#e3f2fd"}}>
                    <div style={{fontSize:11,color:"#1565c0",textTransform:"uppercase",fontWeight:700}}>Rate needed to finish on time</div>
                    <div style={{fontSize:14,fontWeight:800,color:weeksLeftInPlan<=0&&remaining>0?"#c62828":"#1565c0"}}>{neededRate===null?"Plan end passed":remaining<=0?"Done":neededRate.toLocaleString(undefined,{maximumFractionDigits:1})+" "+kpi.unit+"/week"}</div>
                  </div>
                  <div className="card" style={{flex:1,minWidth:170,marginBottom:0,padding:"8px 12px",background:isLateVsPlan?"#fce4ec":"#f0fff4"}}>
                    <div style={{fontSize:11,color:isLateVsPlan?"#c62828":"#2e7d32",textTransform:"uppercase",fontWeight:700}}>Projected finish (current pace)</div>
                    <div style={{fontSize:14,fontWeight:800,color:isLateVsPlan?"#c62828":"#2e7d32"}}>{projFinishLabel}{isLateVsPlan?" ⚠️":""}</div>
                  </div>
                </div>;
              })()}

              <div style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase",marginBottom:6}}>Weekly actuals</div>
              <div style={{maxHeight:260,overflowY:"auto",border:"1px solid #e8e6df",borderRadius:8}}>
                <table className="tbl" style={{fontSize:11}}>
                  <thead><tr><th>Week</th><th style={{textAlign:"right"}}>Planned cum.</th><th style={{textAlign:"right"}}>Actual this week</th><th style={{textAlign:"right"}}>Actual cum.</th><th style={{textAlign:"right"}}>Gap</th></tr></thead>
                  <tbody>
                    {weeks.map(function(w){
                      var hasData=w.isPast||w.isCurrent||(kpi.weeklyActuals||{})[w.monday]!==undefined;
                      var gap=w.actualCum-w.plannedCum;
                      return <tr key={w.monday} style={{background:w.isCurrent?"#fff8e1":"#fff"}}>
                        <td style={{whiteSpace:"nowrap"}}>{fmtDate(w.monday)}{w.isCurrent?" (current)":""}</td>
                        <td style={{textAlign:"right",color:"#888"}}>{w.plannedCum.toLocaleString()}</td>
                        <td style={{textAlign:"right"}}>
                          <input type="number" value={(kpi.weeklyActuals||{})[w.monday]||""} onChange={function(e){setKpiWeekActual(kpi.id,w.monday,e.target.value);}} placeholder="0" style={{width:80,padding:"5px 5px",fontSize:11,textAlign:"right"}}/>
                        </td>
                        <td style={{textAlign:"right",fontWeight:700,color:w.actualCum>=w.plannedCum?"#2e7d32":"#c62828"}}>{w.actualCum.toLocaleString()}</td>
                        <td style={{textAlign:"right",fontWeight:700,color:!hasData?"#ccc":gap>=0?"#2e7d32":"#c62828"}}>{!hasData?"—":(gap>0?"+":"")+gap.toLocaleString()}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>}
          </div>;
        })}
    </div>}

{subTab==="schedule"&&<ScheduleView curZone={curZone} schedules={schedules} saveSchedules={saveSchedules} tasks={tasks} saveTasks={saveTasks} people={people} tags={tags} zones={zones} rooms={rooms} saveRooms={saveRooms} canEdit={canEditZoneSchedule(zoneOwners,curZone,window._currentUser?window._currentUser.name:"")} roomBlockersOf={roomBlockers} tenders={tenders} saveTenders={saveTenders} pkgOwners={pkgOwners} onNavTender={onNavTender}/>}

    {roomModalTask&&<BlockedRoomsModal zone={curZone} rooms={rooms} selected={roomModalTask.blockedRooms||[]}
      onSave={function(sel){updateTask(roomModalTask.id,{blockedRooms:sel});}}
      onClose={function(){setRoomModalTask(null);}}/>}
  </div>;
}

