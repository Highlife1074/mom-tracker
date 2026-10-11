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
// Working days in a week on this site. Drives the /day figure in the Rate column.
var WORK_DAYS_PER_WEEK=6;
function newScheduleRow(kind,label){return{id:uuid(),kind:kind||"task",label:label||"",cells:{},afterId:"",lagWeeks:0,roomId:"",progress:"",weekProgress:{},group:"",startWeek:"",endWeek:"",qty:"",unit:"",tenderRef:""};}
// Companies named in a tender's Awarded section. Awarded or signed ones win over mere
// proposals; with none of those yet, the proposed ones are used.
function tenderAwardees(td){
  if(!td)return [];
  var l=(td.awards||[]).filter(function(a){return String(a.subcontractor||"").trim();});
  var firm=l.filter(function(a){return a.status==="awarded"||a.status==="signed";});
  var out=[];
  (firm.length?firm:l).forEach(function(a){var n=String(a.subcontractor).trim();if(out.indexOf(n)<0)out.push(n);});
  return out;
}
// Start/end weeks read from the planned bars. A row with no planned bar keeps what it had.
function spanFromCells(cells,wl,row){
  var p=(wl||[]).filter(function(w){var v=(cells||{})[w];return v==="plan"||v==="both";});
  if(p.length===0)return row?{startWeek:row.startWeek||"",endWeek:row.endWeek||""}:{};
  return {startWeek:p[0],endWeek:p[p.length-1]};
}
// A tender set on a header row (a section, or a room/category) applies to the tasks under it
// that have no tender of their own; a room's tender wins over its section's. It is written on
// each task (tenderRef), flagged tenderFromHeader, so the tender sheet, the zone pack and the
// reports keep reading row.tenderRef as before. Applied on every save of the rows (upd), so
// moving, adding or deleting rows can never leave a task out of step with its header.
//   tenderFromHeader ""     the task's own tender (or none, with no header tender above)
//                    "<id>" inherited from that header
//                    "-"    explicitly no tender, even under a header that has one
function applyHeaderTenders(rows){
  var secId="",secT="",catId="",catT="",changed=false;
  var out=(rows||[]).map(function(r){
    if(r.kind==="section"){secId=r.id;secT=r.tenderRef||"";catId="";catT="";return r;}
    if(r.kind==="category"){catId=r.id;catT=r.tenderRef||"";return r;}
    if(r.tenderFromHeader==="-")return r;
    if(r.tenderRef&&!r.tenderFromHeader)return r;
    var t=catT||secT||"";
    var hid=catT?catId:secT?secId:"";
    if((r.tenderRef||"")===t&&(r.tenderFromHeader||"")===hid)return r;
    changed=true;
    return Object.assign({},r,{tenderRef:t,tenderFromHeader:hid});
  });
  return changed?out:rows;
}
// The company doing a schedule task, as the grid shows it: the one typed on the task wins,
// otherwise the tender's Awarded section names it (only when it names exactly one).
// Used by the zone readiness view and the weekly pack, so all three always agree.
function schedRowCompany(row,tenders){
  if(!row)return "";
  if(row.group)return row.group;
  if(!row.tenderRef)return "";
  var td=(tenders||[]).find(function(t){return t.id===row.tenderRef;});
  var aw=tenderAwardees(td);
  return aw.length===1?aw[0]:"";
}
// Would "succ starts after pred" close a loop (pred already follows succ, directly or not)?
function linkMakesLoop(rows,predId,succId){
  var byId={};(rows||[]).forEach(function(r){byId[r.id]=r;});
  var cur=predId,guard=0;
  while(cur&&guard++<5000){
    if(cur===succId)return true;
    cur=byId[cur]?byId[cur].afterId:"";
  }
  return false;
}
// Number of planned week-cells across rows. A move that lowers it pushed bars off the board.
function plannedCellCount(rows){
  var n=0;
  (rows||[]).forEach(function(r){var c=r.cells||{};Object.keys(c).forEach(function(w){if(c[w]==="plan"||c[w]==="both")n++;});});
  return n;
}
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
// A text or number box that saves when you leave it (Tab, click elsewhere, Enter), not at
// every key: each keystroke used to rewrite every schedule in Firebase and redraw the grid.
// Esc puts the saved value back. Shows the latest saved value whenever it is not being edited.
//   onCommit(v)  called once, with the new value, when it changed
//   onEnter(v)   optional: return true to take over Enter (the value is then NOT committed)
//   onDone(v)    optional: called when editing ends, whatever happened, with the final text
//   elRef(el)    optional ref callback
function SchedBufInput(props){
  var value=props.value==null?"":String(props.value);
  const [draft,setDraft]=useState(value);
  const [editing,setEditing]=useState(false);
  const draftRef=useRef(value);
  const skipRef=useRef(false);
  useEffect(function(){if(!editing){setDraft(value);draftRef.current=value;}},[value,editing]);
  var rest=Object.assign({},props);
  ["value","onCommit","onEnter","onDone","elRef"].forEach(function(k){delete rest[k];});
  function commit(){
    setEditing(false);
    if(skipRef.current)skipRef.current=false;
    else if(draftRef.current!==value&&props.onCommit)props.onCommit(draftRef.current);
    if(props.onDone)props.onDone(draftRef.current);
  }
  return <input {...rest} ref={props.elRef} value={editing?draft:value}
    onFocus={function(e){draftRef.current=value;setDraft(value);setEditing(true);if(props.onFocus)props.onFocus(e);}}
    onChange={function(e){draftRef.current=e.target.value;setDraft(e.target.value);}}
    onBlur={commit}
    onKeyDown={function(e){
      if(e.key==="Enter"){
        if(props.onEnter&&props.onEnter(draftRef.current))skipRef.current=true;
        e.currentTarget.blur();
      }else if(e.key==="Escape"){
        e.stopPropagation();
        skipRef.current=true;draftRef.current=value;setDraft(value);
        e.currentTarget.blur();
      }
      if(props.onKeyDown)props.onKeyDown(e);
    }}/>;
}

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

// ---- Print period helpers (pure functions, no state) ----
// The grid is weekly: any date snaps back to the Monday of its week.
function printMonday(iso){
  var d=new Date(iso+"T00:00:00");if(isNaN(d.getTime()))return"";
  var dow=d.getDay();d.setDate(d.getDate()-(dow===0?6:dow-1));return toISO(d);
}
function printAddDays(iso,n){
  var d=new Date(iso+"T00:00:00");if(isNaN(d.getTime()))return"";
  d.setDate(d.getDate()+n);return toISO(d);
}
// Weeks to print: the whole schedule, or those between From (snapped to Monday) and To.
function printWeeksOf(all,o){
  if(!o||o.range!=="custom")return all;
  var f=printMonday(o.from);
  if(!f||!o.to)return[];
  return all.filter(function(w){return w>=f&&w<=o.to;});
}

// ---- Baselines ---------------------------------------------------------------
// A baseline is a frozen copy of the PLANNED weeks of every task, kept in the schedule
// (sc.baselines), compact: {rowId: [[firstMonday, nbWeeks], …]} — one pair per painted stretch.
function baselineSnapshot(sc){
  var wl=scheduleWeeks(sc),rows={},n=0;
  (sc.rows||[]).forEach(function(r){
    if(r.kind==="category"||r.kind==="section")return;
    var segs=[],prev="";
    wl.forEach(function(w){
      var v=(r.cells||{})[w];
      if(v!=="plan"&&v!=="both")return;
      if(segs.length&&prev&&xerAddDays(prev,7)===w)segs[segs.length-1][1]++;
      else segs.push([w,1]);
      prev=w;
    });
    if(segs.length){rows[r.id]=segs;n++;}
  });
  return{rows:rows,count:n};
}
function baselineWeeks(segs){
  var out=[];
  (segs||[]).forEach(function(sg){for(var i=0;i<sg[1];i++)out.push(xerAddDays(sg[0],7*i));});
  return out;
}
function weeksBetween(a,b){return Math.round((xerDayMs(b)-xerDayMs(a))/(7*86400000));}
// How a task compares with the baseline: start and finish shift in calendar weeks (+ = later).
//   null: no baseline · {isNew}: not in the baseline · {noPlan}: no planned week any more
function baselineVariance(bl,row,wl){
  if(!bl||!row||row.kind==="category"||row.kind==="section")return null;
  var segs=(bl.rows||{})[row.id];
  if(!segs||!segs.length)return{isNew:true};
  var wks=baselineWeeks(segs);
  var cur=spanFromCells(row.cells,wl,null);
  var bStart=wks[0],bEnd=wks[wks.length-1];
  if(!cur.startWeek)return{noPlan:true,bStart:bStart,bEnd:bEnd};
  return{bStart:bStart,bEnd:bEnd,start:weeksBetween(bStart,cur.startWeek),finish:weeksBetween(bEnd,cur.endWeek),cStart:cur.startWeek,cEnd:cur.endWeek};
}

// ---- Primavera P6 export (.xer) ----------------------------------------------
// One schedule becomes one P6 project:
//   WBS        project › section › room (category)
//   activities one per task — a task with gaps becomes one activity per painted stretch,
//              "Painting (1/2)", "Painting (2/2)", chained FS with the gap as lag
//   links      "starts after" → FS, its gap (weeks) → lag in hours
//   calendar   5 d × 8 h, the neutralised weeks as non-work exceptions
//   codes      Subcontractor and Tender activity codes, to filter and group in P6
//   progress   actual (blue) weeks → actual start / finish and physical % complete,
//              data date = Monday of the current week
// The file is written in Windows-1252, as P6 exports it.
function xerDayMs(iso){var p=String(iso).split("-");return Date.UTC(+p[0],+p[1]-1,+p[2]);}
function xerAddDays(iso,n){var d=new Date(xerDayMs(iso)+n*86400000);return d.toISOString().slice(0,10);}
function xerSerial(iso){return Math.round((xerDayMs(iso)-Date.UTC(1899,11,30))/86400000);}   // P6 calendar day number
function xerClean(s,max){
  var t=String(s==null?"":s).replace(/[\t\r\n]+/g," ").replace(/\s+/g," ").trim();
  return max&&t.length>max?t.slice(0,max):t;
}
// One line, as P6 writes it: the XER format has one record per line.
function xerCalendarData(holidayIsoDays){
  var NL=" ";
  var shift="(0||0(s|08:00|f|12:00)())"+NL+"(0||1(s|13:00|f|17:00)())";
  var days="";
  for(var d=1;d<=7;d++){
    var work=d>=2&&d<=6;                      // 1 = Sunday … 7 = Saturday
    days+="(0||"+d+"()("+(work?NL+shift+")":")")+")"+NL;
  }
  var exc=(holidayIsoDays||[]).map(function(iso,i){return "(0||"+i+"(d|"+xerSerial(iso)+")())";}).join(NL);
  return "(0||CalendarData()("+NL+"(0||DaysOfWeek()("+NL+days+"))"+NL+
    "(0||VIEW(ShowTotal|Y)())"+NL+
    "(0||Exceptions()("+(exc?NL+exc:"")+"))))";
}
// Text → Windows-1252 bytes. Accents outside the code page are dropped, Greek is
// transliterated, anything else becomes "?".
var XER_CP1252={0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,
  0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,
  0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
var XER_GREEK={α:"a",β:"v",γ:"g",δ:"d",ε:"e",ζ:"z",η:"i",θ:"th",ι:"i",κ:"k",λ:"l",μ:"m",ν:"n",ξ:"x",ο:"o",π:"p",ρ:"r",σ:"s",ς:"s",τ:"t",υ:"y",φ:"f",χ:"ch",ψ:"ps",ω:"o"};
function xerToCp1252(text){
  var out=[];
  for(var i=0;i<text.length;i++){
    var ch=text[i],c=text.charCodeAt(i);
    if(c<0x80||(c>=0xA0&&c<=0xFF)){out.push(c);continue;}
    if(XER_CP1252[c]){out.push(XER_CP1252[c]);continue;}
    var base=ch.normalize("NFD").replace(/[̀-ͯ]/g,"");
    var lower=base.toLowerCase();
    if(XER_GREEK[lower]){
      var t=XER_GREEK[lower];if(base!==lower)t=t.charAt(0).toUpperCase()+t.slice(1);
      for(var k=0;k<t.length;k++)out.push(t.charCodeAt(k));continue;
    }
    var b=base.charCodeAt(0);
    out.push(base.length===1&&(b<0x80||(b>=0xA0&&b<=0xFF))?b:0x3F);
  }
  return new Uint8Array(out);
}
function buildScheduleXer(sc,opts){
  opts=opts||{};
  var NL="\r\n";
  var warnings=[];
  var wl=scheduleWeeks(sc);
  var hol=sc.holidayWeeks||[];
  var working=wl.filter(function(w){return hol.indexOf(w)<0;});
  var wIdx={};working.forEach(function(w,i){wIdx[w]=i;});
  var todayIso=opts.today||new Date().toISOString().slice(0,10);
  var dataWeek=printMonday(todayIso);                       // Monday of the current week
  var projCode=xerClean(opts.projCode||"PROJECT",20)||"PROJECT";
  var stamp=todayIso+" 00:00";
  var user=xerClean(opts.user||"",32);
  function startOf(wk){return wk+" 08:00";}
  function endOf(wk){return xerAddDays(wk,4)+" 17:00";}
  var HPW=40;                                                // working hours a week

  // ---- WBS
  var wbs=[],wbsSeq=0;
  var root={wbs_id:1000,parent:"",code:projCode,name:xerClean(opts.projName||sc.title||projCode,100),root:true};
  wbs.push(root);
  var nextWbs=1001,secN=0,roomN={};
  var curSec=null,curRoom=null;
  // ---- activities
  var acts=[],preds=[],segsOf={};
  var nextTask=5000,code=1000;
  var skipped=[];
  var subs={},tnds={};
  (sc.rows||[]).forEach(function(r){
    if(r.kind==="section"){
      secN++;curRoom=null;
      curSec={wbs_id:nextWbs++,parent:root.wbs_id,code:"S"+String(secN).padStart(2,"0"),name:xerClean(r.label||"Section",100)};
      wbs.push(curSec);return;
    }
    if(r.kind==="category"){
      var par=curSec||root;
      roomN[par.wbs_id]=(roomN[par.wbs_id]||0)+1;
      curRoom={wbs_id:nextWbs++,parent:par.wbs_id,code:"R"+String(roomN[par.wbs_id]).padStart(2,"0"),name:xerClean(r.label||"Room",100)};
      wbs.push(curRoom);return;
    }
    var cells=r.cells||{};
    var planned=working.filter(function(w){var v=cells[w];return v==="plan"||v==="both";});
    if(planned.length===0){skipped.push(r.label||"(untitled)");return;}
    // stretches of consecutive working weeks
    var segs=[],cur=null;
    planned.forEach(function(w){
      if(cur&&wIdx[w]===wIdx[cur[cur.length-1]]+1)cur.push(w);
      else{cur=[w];segs.push(cur);}
    });
    var actual=wl.filter(function(w){var v=cells[w];return v==="actual"||v==="both";});
    var wbsNode=curRoom||curSec||root;
    var company=opts.companyOf?opts.companyOf(r):(r.group||"");
    var td=r.tenderRef&&opts.tenders?(opts.tenders.find(function(t){return t.id===r.tenderRef;})||null):null;
    var ids=[];
    segs.forEach(function(seg,si){
      var first=seg[0],last=seg[seg.length-1];
      var upto=si<segs.length-1?segs[si+1][0]:"9999-12-31";
      var from=si===0?"0000-01-01":first;
      var act=actual.filter(function(w){return w>=from&&w<upto;});
      var done=seg.filter(function(w){var v=cells[w];return v==="actual"||v==="both";}).length;
      var lastTask=si===segs.length-1;
      var pct100=lastTask&&opts.progressOf&&opts.progressOf(r)>=100;
      var status=act.length===0?"TK_NotStart":(done>=seg.length||pct100)?"TK_Complete":"TK_Active";
      var target=seg.length*HPW;
      var remaining=status==="TK_Complete"?0:status==="TK_NotStart"?target:
        Math.max(HPW,seg.filter(function(w){return w>=dataWeek;}).length*HPW);
      var pct=status==="TK_Complete"?100:status==="TK_NotStart"?0:Math.min(99,Math.round(done/seg.length*100));
      var a={task_id:nextTask++,wbs_id:wbsNode.wbs_id,code:"A"+code,
        name:xerClean((r.label||"(untitled)")+(segs.length>1?" ("+(si+1)+"/"+segs.length+")":""),120),
        status:status,pct:pct,target:target,remaining:remaining,
        start:startOf(first),end:endOf(last),
        actStart:act.length?startOf(act[0]):"",actEnd:status==="TK_Complete"?endOf(act[act.length-1]):"",
        company:company,tender:td};
      code+=10;
      acts.push(a);ids.push(a);
      if(si>0){
        var gap=wIdx[first]-wIdx[segs[si-1][segs[si-1].length-1]]-1;
        preds.push({pred:ids[si-1].task_id,succ:a.task_id,lag:gap*HPW});
      }
    });
    if(company)subs[company]=1;
    if(td)tnds[td.id]=td;
    segsOf[r.id]=ids;
  });
  (sc.rows||[]).forEach(function(r){
    if(!r.afterId||!segsOf[r.id]||!segsOf[r.afterId])return;
    var p=segsOf[r.afterId],s=segsOf[r.id];
    preds.push({pred:p[p.length-1].task_id,succ:s[0].task_id,lag:(Number(r.lagWeeks)||0)*HPW});
  });
  if(skipped.length)warnings.push(skipped.length+" task"+(skipped.length!==1?"s":"")+" without planned weeks not exported: "+skipped.slice(0,6).join(", ")+(skipped.length>6?"…":""));
  if(acts.length===0)return{text:"",warnings:warnings.concat(["Nothing to export: no task has planned weeks."]),stats:{}};

  // ---- tables
  var lines=[];
  function table(name,fields,rows){
    lines.push("%T\t"+name);
    lines.push("%F\t"+fields.join("\t"));
    rows.forEach(function(o){lines.push("%R\t"+fields.map(function(f){var v=o[f];return v==null?"":String(v).replace(/\t/g," ");}).join("\t"));});
  }
  var projStart=acts.map(function(a){return a.start;}).sort()[0];
  var projEnd=acts.map(function(a){return a.end;}).sort().slice(-1)[0];
  var dataDate=startOf(dataWeek)<projStart?projStart:startOf(dataWeek);
  var holDays=[];hol.forEach(function(w){for(var d=0;d<5;d++)holDays.push(xerAddDays(w,d));});

  table("CURRTYPE",["curr_id","decimal_digit_cnt","curr_symbol","decimal_symbol","digit_group_symbol","pos_curr_fmt_type","neg_curr_fmt_type","curr_type","curr_short_name","group_digit_cnt","base_exch_rate"],
    [{curr_id:1,decimal_digit_cnt:2,curr_symbol:"€",decimal_symbol:".",digit_group_symbol:",",pos_curr_fmt_type:"#1.1",neg_curr_fmt_type:"(#1.1)",curr_type:"Euro",curr_short_name:"EUR",group_digit_cnt:3,base_exch_rate:1}]);
  table("OBS",["obs_id","parent_obs_id","guid","seq_num","obs_name","obs_descr"],[{obs_id:1,parent_obs_id:"",seq_num:0,obs_name:"Enterprise",obs_descr:""}]);
  table("PROJECT",["proj_id","fy_start_month_num","rsrc_self_add_flag","allow_complete_flag","rsrc_multi_assign_flag","checkout_flag","project_flag","step_complete_flag","cost_qty_recalc_flag","batch_sum_flag","name_sep_char","def_complete_pct_type","proj_short_name","acct_id","orig_proj_id","source_proj_id","base_type_id","clndr_id","sum_base_proj_id","task_code_base","task_code_step","priority_num","wbs_max_sum_level","strgy_priority_num","last_checksum","critical_drtn_hr_cnt","def_cost_per_qty","last_recalc_date","plan_start_date","plan_end_date","scd_end_date","add_date","last_tasksum_date","fcst_start_date","def_duration_type","task_code_prefix","guid","def_qty_type","add_by_name","web_local_root_path","proj_url","def_rate_type","add_act_remain_flag","act_this_per_link_flag","def_task_type","act_pct_link_flag","critical_path_type","task_code_prefix_flag","def_rollup_dates_flag","use_project_baseline_flag","rem_target_link_flag","reset_planned_flag","allow_neg_act_flag","sum_assign_level","last_fin_dates_id","fintmpl_id","last_baseline_update_date","cr_external_key","apply_actuals_date","location_id","loaded_scope_level","export_flag","new_fin_dates_id","baselines_to_export","baseline_names_to_export","next_data_date","close_period_flag","sum_refresh_date","trsrcsum_loaded","sumtask_loaded"],
    [{proj_id:1,fy_start_month_num:1,rsrc_self_add_flag:"Y",allow_complete_flag:"Y",rsrc_multi_assign_flag:"Y",checkout_flag:"N",project_flag:"Y",step_complete_flag:"N",cost_qty_recalc_flag:"Y",batch_sum_flag:"Y",name_sep_char:".",
      def_complete_pct_type:"CP_Phys",proj_short_name:projCode,clndr_id:1,task_code_base:1000,task_code_step:10,priority_num:10,wbs_max_sum_level:0,strgy_priority_num:100,critical_drtn_hr_cnt:0,def_cost_per_qty:0,
      last_recalc_date:dataDate,plan_start_date:projStart,plan_end_date:"",scd_end_date:projEnd,add_date:stamp,def_duration_type:"DT_FixedDUR2",task_code_prefix:"A",def_qty_type:"QT_Hour",add_by_name:user,
      def_rate_type:"COST_PER_QTY",add_act_remain_flag:"N",act_this_per_link_flag:"Y",def_task_type:"TT_Task",act_pct_link_flag:"N",critical_path_type:"CT_TotFloat",task_code_prefix_flag:"Y",def_rollup_dates_flag:"Y",
      use_project_baseline_flag:"Y",rem_target_link_flag:"Y",reset_planned_flag:"N",allow_neg_act_flag:"N",sum_assign_level:"SL_Taskrsrc",loaded_scope_level:7,export_flag:"Y",close_period_flag:"N",trsrcsum_loaded:"N",sumtask_loaded:"N"}]);
  table("CALENDAR",["clndr_id","default_flag","clndr_name","proj_id","base_clndr_id","last_chng_date","clndr_type","day_hr_cnt","week_hr_cnt","month_hr_cnt","year_hr_cnt","rsrc_private","clndr_data"],
    [{clndr_id:1,default_flag:"N",clndr_name:xerClean(projCode+" 5d x 8h",60),proj_id:1,base_clndr_id:"",last_chng_date:stamp,clndr_type:"CA_Project",day_hr_cnt:8,week_hr_cnt:40,month_hr_cnt:172,year_hr_cnt:2000,rsrc_private:"N",clndr_data:xerCalendarData(holDays)}]);
  table("PROJWBS",["wbs_id","proj_id","obs_id","seq_num","est_wt","proj_node_flag","sum_data_flag","status_code","wbs_short_name","wbs_name","phase_id","parent_wbs_id","ev_user_pct","ev_etc_user_value","orig_cost","indep_remain_total_cost","ann_dscnt_rate_pct","dscnt_period_type","indep_remain_work_qty","anticip_start_date","anticip_end_date","ev_compute_type","ev_etc_compute_type","guid","tmpl_guid","plan_open_state"],
    wbs.map(function(n,i){return{wbs_id:n.wbs_id,proj_id:1,obs_id:1,seq_num:i*10,est_wt:1,proj_node_flag:n.root?"Y":"N",sum_data_flag:"N",status_code:"WS_Open",
      wbs_short_name:n.code,wbs_name:n.name,parent_wbs_id:n.parent,ev_user_pct:6,ev_etc_user_value:0.88,orig_cost:0,indep_remain_total_cost:0,ann_dscnt_rate_pct:"",dscnt_period_type:"",indep_remain_work_qty:0,
      ev_compute_type:"EC_Cmp_pct",ev_etc_compute_type:"EE_Rem_hr"};}));
  // activity codes
  var types=[],codes=[],links=[];
  var nextCode=1;
  function codeType(id,name,valuesObj,labelOf){
    var keys=Object.keys(valuesObj).sort();
    if(!keys.length)return {};
    types.push({actv_code_type_id:id,actv_short_len:20,seq_num:id*10,actv_code_type:name,proj_id:1,wbs_id:"",actv_code_type_scope:"AS_Project"});
    var map={},used={};
    keys.forEach(function(k,i){
      var full=labelOf(k);
      var sn=xerClean(full,20).toUpperCase()||("C"+i);
      var base=sn,n=2;
      while(used[sn]){var suf="-"+n++;sn=base.slice(0,20-suf.length)+suf;}
      used[sn]=1;
      var row={actv_code_id:nextCode++,parent_actv_code_id:"",actv_code_type_id:id,actv_code_name:xerClean(full,100),short_name:sn,seq_num:(i+1)*10,color:"",total_assignments:0};
      codes.push(row);map[k]=row.actv_code_id;
    });
    return map;
  }
  var subMap=codeType(1,"Subcontractor",subs,function(k){return k;});
  var tndMap=codeType(2,"Tender",tnds,function(k){var t=tnds[k];return (t.title||"Tender")+(t.package?" ("+t.package+")":"");});
  acts.forEach(function(a){
    if(a.company&&subMap[a.company]){links.push({task_id:a.task_id,actv_code_type_id:1,actv_code_id:subMap[a.company],proj_id:1});}
    if(a.tender&&tndMap[a.tender.id]){links.push({task_id:a.task_id,actv_code_type_id:2,actv_code_id:tndMap[a.tender.id],proj_id:1});}
  });
  codes.forEach(function(c){c.total_assignments=links.filter(function(l){return l.actv_code_id===c.actv_code_id;}).length;});
  if(types.length){
    table("ACTVTYPE",["actv_code_type_id","actv_short_len","seq_num","actv_code_type","proj_id","wbs_id","actv_code_type_scope"],types);
    table("ACTVCODE",["actv_code_id","parent_actv_code_id","actv_code_type_id","actv_code_name","short_name","seq_num","color","total_assignments"],codes);
  }
  table("TASK",["task_id","proj_id","wbs_id","clndr_id","phys_complete_pct","rev_fdbk_flag","est_wt","lock_plan_flag","auto_compute_act_flag","complete_pct_type","task_type","duration_type","status_code","task_code","task_name","rsrc_id","total_float_hr_cnt","free_float_hr_cnt","remain_drtn_hr_cnt","act_work_qty","remain_work_qty","target_work_qty","target_drtn_hr_cnt","target_equip_qty","act_equip_qty","remain_equip_qty","cstr_date","act_start_date","act_end_date","late_start_date","late_end_date","expect_end_date","early_start_date","early_end_date","restart_date","reend_date","target_start_date","target_end_date","rem_late_start_date","rem_late_end_date","cstr_type","priority_type","suspend_date","resume_date","float_path","float_path_order","guid","tmpl_guid","cstr_date2","cstr_type2","driving_path_flag","act_this_per_work_qty","act_this_per_equip_qty","external_early_start_date","external_late_end_date","create_date","update_date","create_user","update_user","location_id"],
    acts.map(function(a){
      var es=a.status==="TK_NotStart"?a.start:a.status==="TK_Active"?dataDate:a.actStart;
      return{task_id:a.task_id,proj_id:1,wbs_id:a.wbs_id,clndr_id:1,phys_complete_pct:a.pct,rev_fdbk_flag:"N",est_wt:1,lock_plan_flag:"N",auto_compute_act_flag:"N",
        complete_pct_type:"CP_Phys",task_type:"TT_Task",duration_type:"DT_FixedDUR2",status_code:a.status,task_code:a.code,task_name:a.name,rsrc_id:"",
        total_float_hr_cnt:"",free_float_hr_cnt:"",remain_drtn_hr_cnt:a.remaining,act_work_qty:0,remain_work_qty:0,target_work_qty:0,target_drtn_hr_cnt:a.target,target_equip_qty:0,act_equip_qty:0,remain_equip_qty:0,
        cstr_date:"",act_start_date:a.actStart,act_end_date:a.actEnd,late_start_date:"",late_end_date:"",expect_end_date:"",
        early_start_date:a.status==="TK_Complete"?"":es,early_end_date:a.status==="TK_Complete"?"":a.end,
        restart_date:a.status==="TK_Complete"?"":es,reend_date:a.status==="TK_Complete"?"":a.end,
        target_start_date:a.start,target_end_date:a.end,rem_late_start_date:"",rem_late_end_date:"",cstr_type:"",priority_type:"PT_Normal",suspend_date:"",resume_date:"",
        float_path:"",float_path_order:"",cstr_date2:"",cstr_type2:"",driving_path_flag:"N",act_this_per_work_qty:0,act_this_per_equip_qty:0,
        create_date:stamp,update_date:stamp,create_user:user,update_user:user};
    }));
  if(links.length)table("TASKACTV",["task_id","actv_code_type_id","actv_code_id","proj_id"],links);
  table("TASKPRED",["task_pred_id","task_id","pred_task_id","proj_id","pred_proj_id","pred_type","lag_hr_cnt","comments","float_path","aref","arls"],
    preds.map(function(p,i){return{task_pred_id:9000+i,task_id:p.succ,pred_task_id:p.pred,proj_id:1,pred_proj_id:1,pred_type:"PR_FS",lag_hr_cnt:p.lag,comments:"",float_path:"",aref:"",arls:""};}));
  var header=["ERMHDR","19.12",todayIso,"Project",user||"admin",user||"admin","dbxDatabaseNoName","Project Management","EUR"].join("\t");
  var text=header+NL+lines.join(NL)+NL+"%E"+NL;
  var split=Object.keys(segsOf).filter(function(k){return segsOf[k].length>1;}).length;
  if(split)warnings.push(split+" task"+(split!==1?"s":"")+" with gaps exported as several activities (one per stretch, linked).");
  return{text:text,warnings:warnings,stats:{activities:acts.length,links:preds.length,wbs:wbs.length,holidays:holDays.length,dataDate:dataDate}};
}

function ScheduleView({curZone,schedules,saveSchedules,tasks,saveTasks,people,tags,zones,rooms,saveRooms,canEdit,roomBlockersOf,tenders,saveTenders,pkgOwners,onNavTender}){
  // Destructive or wide-reaching operations (deleting a schedule, editing tasks by batch)
  // are reserved for the app admin, whatever the zone rights are.
  var isAdmin=isAppAdmin(window._currentUser?window._currentUser.name:"");
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
  // Painting by dragging: press on a week, slide along the row, release. Nothing is saved
  // until the release, and then in one write. The stroke is previewed meanwhile.
  // ---- Mouse / finger gestures on the grid ----------------------------------
  // One gesture at a time, saved only when it ends, in ONE write:
  //   paint  press on a week and slide along the row (finger: hold 0.3 s first)
  //   move   Shift + press on a bar and slide: the whole task moves, the tasks after it follow
  //   link   press on the ● at the end of a bar and drop it on another task: "starts after"
  const [drag,setDrag]=useState(null);      // {type, rowId, from, to, erase, x0, y0, x, y, target}
  const dragRef=useRef(null);
  function setDragBoth(v){dragRef.current=v;setDrag(v);}
  var stroke=drag&&drag.type==="paint"?drag:null;
  const dragEndRef=useRef(null);            // refreshed every render: always sees the latest schedule
  const longPressRef=useRef(null);
  function clearLongPress(){if(longPressRef.current){clearTimeout(longPressRef.current.timer);longPressRef.current=null;}}
  // The window listeners are attached right in the pointer-down handler (not in an effect),
  // so even a very quick click is never missed, and removed as soon as the gesture ends.
  const dragOffRef=useRef(null);
  function startDrag(d){
    if(dragOffRef.current)dragOffRef.current();
    setDragBoth(d);
    function track(x,y){
      var cur=dragRef.current;if(!cur)return;
      var el=document.elementFromPoint(x,y);
      var td=el&&el.closest?el.closest("td[data-wk]"):null;
      var tr=el&&el.closest?el.closest("tr[data-rowid]"):null;
      var rid=tr?tr.getAttribute("data-rowid"):"";
      if(cur.type==="link"||cur.type==="relink"){
        var tgt=rid&&rid!==cur.rowId&&rid!==cur.predId?rid:"";
        if(cur.x!==x||cur.y!==y||cur.target!==tgt)setDragBoth(Object.assign({},cur,{x:x,y:y,target:tgt}));
        return;
      }
      var wk=td?td.getAttribute("data-wk"):"";
      if(rid!==cur.rowId||!wk||wk===cur.to||isHoliday(wk))return;
      setDragBoth(Object.assign({},cur,{to:wk}));
    }
    function onMove(e){track(e.clientX,e.clientY);}
    function onTouchMove(e){
      var t=e.touches&&e.touches[0];if(!t)return;
      if(e.cancelable)e.preventDefault();      // the finger paints or links instead of scrolling
      track(t.clientX,t.clientY);
    }
    function off(){
      window.removeEventListener("pointermove",onMove);
      window.removeEventListener("pointerup",finish);
      window.removeEventListener("pointercancel",cancel);
      window.removeEventListener("touchmove",onTouchMove,{passive:false});
      window.removeEventListener("keydown",onKey);
      dragOffRef.current=null;
    }
    function finish(){
      var cur=dragRef.current;
      off();setDragBoth(null);
      if(cur&&dragEndRef.current)dragEndRef.current(cur);
    }
    function cancel(){off();setDragBoth(null);}
    function onKey(e){if(e.key==="Escape")cancel();}
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",finish);
    window.addEventListener("pointercancel",cancel);
    window.addEventListener("touchmove",onTouchMove,{passive:false});
    window.addEventListener("keydown",onKey);
    dragOffRef.current=off;
  }
  useEffect(function(){return function(){if(dragOffRef.current)dragOffRef.current();clearLongPress();};},[]);

  // ---- Side panel, menus, view options -------------------------------------
  const [panelRowId,setPanelRowId]=useState(null);   // the task/header shown in the side panel
  const [ctxMenu,setCtxMenu]=useState(null);         // {rowId, x, y}
  const [qAfter,setQAfter]=useState("");
  const [blMenu,setBlMenu]=useState(false);
  const [linkMenu,setLinkMenu]=useState(null);
  const [procOpen,setProcOpenRaw]=useState(function(){try{return localStorage.getItem("pp_sched_procOpen")==="1";}catch(e){return false;}});
  function setProcOpen(v){setProcOpenRaw(v);try{localStorage.setItem("pp_sched_procOpen",v?"1":"0");}catch(e){}}        // {succId, x, y}: the menu of one arrow          // baseline panel open
  const [blName,setBlName]=useState("");
  const [blDelId,setBlDelId]=useState("");           // baseline waiting for a 2nd click to be deleted
  const justInsertedRef=useRef("");                  // Enter on a new task's name adds the next one
  const lastSelRef=useRef("");
  // Simple / advanced view: a per-person choice, remembered in this browser, never in Firebase.
  const [advanced,setAdvancedRaw]=useState(function(){try{return localStorage.getItem("pp_sched_advanced")==="1";}catch(e){return false;}});
  function setAdvanced(v){setAdvancedRaw(v);try{localStorage.setItem("pp_sched_advanced",v?"1":"0");}catch(e){}}
  const [showLinks,setShowLinksRaw]=useState(function(){try{return localStorage.getItem("pp_sched_links")!=="0";}catch(e){return true;}});
  function setShowLinks(v){setShowLinksRaw(v);try{localStorage.setItem("pp_sched_links",v?"1":"0");}catch(e){}}
  // Simplified toolbar: the rarely used controls sit behind ⚙ Settings, ⋯ More and 🔍 Analyse & view.
  const [showSettings,setShowSettings]=useState(false);
  const [moreMenu,setMoreMenu]=useState(false);
  const [showTools,setShowToolsRaw]=useState(function(){try{return localStorage.getItem("pp_sched_tools")==="1";}catch(e){return false;}});
  function setShowTools(v){setShowToolsRaw(v);try{localStorage.setItem("pp_sched_tools",v?"1":"0");}catch(e){}}
  const tableBoxRef=useRef(null);
  const [arrowGeo,setArrowGeo]=useState([]);
  const arrowKeyRef=useRef("[]");

  var zoneScheds=(schedules||[]).filter(function(s){return s.zone===curZone;});
  var sc=selId?zoneScheds.find(function(s){return s.id===selId;}):(zoneScheds.length?zoneScheds[0]:null);

  // ---- Undo / redo -------------------------------------------------------
  // Every change of the schedule goes through upd(), which keeps the state before it. Ctrl+Z
  // puts the whole schedule back as it was, Ctrl+Y (or Ctrl+Shift+Z) replays it. History is
  // kept for this browser tab and this schedule only; actions, rooms and tenders are not part
  // of it, which is why deleting a room clears it (see delRow).
  const undoRef=useRef({past:[],future:[]});
  const [undoTick,setUndoTick]=useState(0);
  var UNDO_MAX=30;
  function clearUndo(){undoRef.current={past:[],future:[]};setUndoTick(function(n){return n+1;});}
  function undoRedo(dir){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var st=undoRef.current;
    var from=dir<0?st.past:st.future,to=dir<0?st.future:st.past;
    var snap=from.pop();
    if(!snap||snap.id!==sc.id){setUndoTick(function(n){return n+1;});return;}
    var cur=(schedules||[]).find(function(s){return s.id===snap.id;});
    if(!cur){clearUndo();return;}
    to.push(cur);
    var restored=Object.assign({},snap,{updatedAt:today(),updatedBy:window._currentUser?window._currentUser.name:""});
    saveSchedules((schedules||[]).map(function(s){return s.id!==snap.id?s:restored;}));
    pushStartOnSiteFromSchedule(tenderRefsOf(cur.rows,snap.rows),snap.rows||[],snap.id);
    setUndoTick(function(n){return n+1;});
  }
  const undoFnRef=useRef(null);
  undoFnRef.current=undoRedo;
  useEffect(function(){
    function onKey(e){
      if(!(e.ctrlKey||e.metaKey))return;
      var t=e.target||{};var tag=(t.tagName||"").toLowerCase();
      if(tag==="input"||tag==="textarea"||tag==="select"||t.isContentEditable)return;   // the field's own undo
      var k=(e.key||"").toLowerCase();
      if(k==="z"&&!e.shiftKey){e.preventDefault();undoFnRef.current(-1);}
      else if(k==="y"||(k==="z"&&e.shiftKey)){e.preventDefault();undoFnRef.current(1);}
    }
    window.addEventListener("keydown",onKey);
    return function(){window.removeEventListener("keydown",onKey);};
  },[]);
  useEffect(function(){clearUndo();},[sc?sc.id:""]);

  function upd(id,fields){
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    if(fields&&fields.rows)fields=Object.assign({},fields,{rows:applyHeaderTenders(fields.rows)});
    var prevSched=(schedules||[]).find(function(s){return s.id===id;});
    if(prevSched){
      var ur=undoRef.current;
      ur.past.push(prevSched);
      if(ur.past.length>UNDO_MAX)ur.past.shift();
      ur.future=[];
      setUndoTick(function(n){return n+1;});
    }
    saveSchedules((schedules||[]).map(function(s){return s.id!==id?s:Object.assign({},s,fields,{updatedAt:today(),updatedBy:window._currentUser?window._currentUser.name:""});}));
    // Any change of rows (painting, shifting, linking, a shutdown week…) can move the start
    // of a tender. Recomputed here, from the rows being saved, so no call site can forget it.
    if(fields&&fields.rows){
      var before=((schedules||[]).find(function(s){return s.id===id;})||{}).rows||[];
      pushStartOnSiteFromSchedule(tenderRefsOf(before,fields.rows),fields.rows,id);
    }
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
  // Nearest task strictly before index `idx` in the same category/section block.
  // Returns "" as soon as it hits a category or section header first — that
  // means there is no earlier task in this block to chain from.
  function taskBeforeIndex(rows,idx){
    for(var k=idx-1;k>=0;k--){
      var r=rows[k];
      if(r.kind==="category"||r.kind==="section")return "";
      if(r.kind==="task")return r.id;
    }
    return "";
  }
  // Insert a task immediately under a given row. Faster than the "add at the end +
  // pick an anchor in a dropdown" flow when you are already looking at the right line.
  // `patch`, when given, is applied to the row rowId in the SAME write — used when Enter on a
  // task name both saves the name and opens the next line (two writes would lose the name).
  function insertTaskAfter(rowId,patch){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var rows=(sc.rows||[]).map(function(r){return patch&&r.id===rowId?Object.assign({},r,patch):r;});
    var i=rows.findIndex(function(r){return r.id===rowId;});
    if(i<0)return;
    var nr=newScheduleRow("task","");
    var insertAt=i+1;
    // Auto FIN→DÉBUT with whatever task immediately precedes the insertion point.
    nr.afterId=taskBeforeIndex(rows,insertAt);
    rows.splice(insertAt,0,nr);
    upd(sc.id,{rows:rows});
    justInsertedRef.current=nr.id;
    setEditRowId(nr.id);            // straight into the label field
  }
  function addRow(){
    if(!sc||!newRowLabel.trim())return;
    var rows=(sc.rows||[]).slice();
    var nr=newScheduleRow(newRowKind,newRowLabel.trim());
    if(!newRowAfter){
      if(newRowKind==="task")nr.afterId=taskBeforeIndex(rows,rows.length);
      rows.push(nr);   // end of schedule
    }else{
      var anchor=rows.findIndex(function(r){return r.id===newRowAfter;});
      if(anchor<0){
        if(newRowKind==="task")nr.afterId=taskBeforeIndex(rows,rows.length);
        rows.push(nr);
      }
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
        nr.afterId=taskBeforeIndex(rows,end);
        rows.splice(end,0,nr);
      }else{
        if(newRowKind==="task")nr.afterId=taskBeforeIndex(rows,anchor+1);
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
    // A deleted room or category also removed its Room and unlinked actions: undoing only the
    // rows would leave them out of step, so the history stops here.
    if(isSection||isCat||linked.length>0)clearUndo();
    setSelRows(function(prev){return prev.filter(function(id){return !ids[id];});});
    if(ids[panelRowId])setPanelRowId(null);
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
    if(!row||row.kind==="category"||row.kind==="section")return null;
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
  // Accepts one tender id or a list, and the rows of this schedule as they are ABOUT to be
  // saved: reading sc.rows here used to miss the change being made (the task just linked,
  // the week just shifted). Every zone counts, as on the tender sheet. ONE tenders write.
  function pushStartOnSiteFromSchedule(tenderRefs,newRows,schedId){
    if(!saveTenders)return;
    schedId=schedId||(sc?sc.id:"");
    var ids=(Array.isArray(tenderRefs)?tenderRefs:[tenderRefs]).filter(Boolean);
    if(ids.length===0)return;
    var allRows=[];
    (schedules||[]).forEach(function(s){
      var rs=s.id===schedId&&newRows?newRows:(s.rows||[]);
      rs.forEach(function(r){allRows.push(r);});
    });
    var patch={};
    ids.forEach(function(id){
      var starts=allRows.filter(function(r){return r.tenderRef===id&&r.startWeek;}).map(function(r){return r.startWeek;}).sort();
      if(starts.length===0)return;
      var td=(tenders||[]).find(function(t){return t.id===id;});
      if(td&&td.startOnSite!==starts[0])patch[id]=starts[0];
    });
    if(Object.keys(patch).length===0)return;
    saveTenders((tenders||[]).map(function(t){return patch[t.id]?Object.assign({},t,{startOnSite:patch[t.id]}):t;}));
  }
  // Tenders touched by a change of rows: linked before or after it.
  function tenderRefsOf(rowsA,rowsB){
    var s={};
    (rowsA||[]).concat(rowsB||[]).forEach(function(r){if(r&&r.tenderRef)s[r.tenderRef]=1;});
    return Object.keys(s);
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

    // 3. close the ones whose conflict is gone.
    // Only actions of THIS schedule are judged here: an action whose row lives in another
    // zone's schedule used to look "row not found" and was closed, then recreated when that
    // zone was opened — in a loop. A row that exists in no schedule at all is gone: close.
    var ownRows={};(sc.rows||[]).forEach(function(x){ownRows[x.id]=1;});
    var otherRows={};
    (schedules||[]).forEach(function(s){if(s.id!==sc.id)(s.rows||[]).forEach(function(x){otherRows[x.id]=1;});});
    next=next.map(function(t){
      if(t.addedBy!=="System"||t.status==="done"||!t.scheduleRowRef)return t;
      if((t.text||"").indexOf("Procurement late for: ")!==0&&!t.autoKey)return t;
      if(!ownRows[t.scheduleRowRef]&&otherRows[t.scheduleRowRef])return t;
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
  // Quantity roll-up on a category/section line: only meaningful when every task below
  // shares the same unit, otherwise adding metres to units would be nonsense.
  function catQty(row){
    if(!sc)return null;
    var all=(sc.rows||[]);
    var i=all.findIndex(function(r){return r.id===row.id;});
    if(i<0)return null;
    var tot=0,unit=null,found=false;
    for(var j=i+1;j<all.length&&all[j].kind!=="category"&&all[j].kind!=="section";j++){
      var r=all[j];
      var q=Number(r.qty);
      if(r.qty===""||r.qty===undefined||isNaN(q))continue;
      var u=(r.unit||"").trim();
      if(unit===null)unit=u; else if(unit!==u)return null;   // mixed units: no total
      tot+=q;found=true;
    }
    return found?{qty:tot,unit:unit||""}:null;
  }
  function fmtQty(n){return n.toLocaleString(undefined,{maximumFractionDigits:Math.abs(n)<10?1:0});}
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
    return{weeks:span,working:working,totalWeeks:span.length,workingWeeks:working.length,rate:rate,
      ratePerDay:rate===null?null:rate/WORK_DAYS_PER_WEEK,derived:derived,startWeek:wl[i1],endWeek:wl[i2]};
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
      // start/end fallback only for a row with no bar at all: on a painted row it showed
      // the task as active during its gaps
      else if(plannedCellCount([r])===0&&r.startWeek&&r.endWeek&&r.startWeek<=week&&week<=r.endWeek)inSpan=true;
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
    var merged=Object.assign({},row,sc?spanFromCells(row.cells,scheduleWeeks(sc),row):{},patch);
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
          // planned cell sitting on a holiday week: leave it where it is (it used to be deleted)
          if(i===undefined){moved[wk]=moved[wk]==="actual"?"both":"plan";return;}
          var tgt=working[i+deltaWeeks];
          if(tgt===undefined)return;   // pushed off the board: shiftRows() refuses the move first
          moved[tgt]=moved[tgt]==="actual"?"both":(moved[tgt]==="both"?"both":"plan");
        }
      });
      // start/end weeks follow the bars, so the procurement checks see the new dates
      return Object.assign({},r,{cells:moved},spanFromCells(moved,wksList,r));
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

  // Shifts one or several rows (and whatever follows them) in ONE save. The bulk shift
  // used to call shiftRow once per task, each rebuilding from the same state: only the last
  // task actually moved. A shift that would push bars past the last week is refused
  // instead of silently deleting them.
  function shiftRows(rowIds,delta){
    if(!sc||!rowIds.length)return;
    var wksList=scheduleWeeks(sc);
    var hol=sc.holidayWeeks||[];
    var before=(sc.rows||[]);
    var rows=before.slice();
    var visited={};
    rowIds.forEach(function(id){if(!visited[id])rows=shiftRowCascade(rows,id,delta,wksList,visited,hol);});
    var lost=plannedCellCount(before)-plannedCellCount(rows);
    if(lost>0){
      safeAlert("Not moved: "+lost+" planned week"+(lost!==1?"s":"")+" would fall "+(delta>0?"after the last":"before the first")+" week of the schedule"+
        " (this task or the tasks linked after it).\n\nIncrease \"Nb weeks\" or the start week of the schedule first.");
      return;
    }
    upd(sc.id,{rows:rows});
  }
  function shiftRow(rowId,delta){shiftRows([rowId],delta);}
  // Distance between two weeks counted in WORKING weeks (neutralised weeks skipped).
  function workingDelta(fromWk,toWk){
    var hol=(sc&&sc.holidayWeeks)||[];
    var working=scheduleWeeks(sc).filter(function(w){return hol.indexOf(w)<0;});
    var a=working.indexOf(fromWk),b=working.indexOf(toWk);
    return(a<0||b<0)?0:b-a;
  }
  function rowById(id){return (sc&&(sc.rows||[]).find(function(r){return r.id===id;}))||null;}
  // Where a linked task stands against its predecessor: its first planned week compared with
  // the first week it may start (end of the predecessor + 1 + gap), in working weeks.
  //   null when either has no planned bar; .weeks < 0 means it starts too early.
  function linkState(row){
    if(!sc||!row||!row.afterId)return null;
    var pred=rowById(row.afterId);
    if(!pred)return null;
    var wl=scheduleWeeks(sc);
    var ps=spanFromCells(pred.cells,wl,null),ss=spanFromCells(row.cells,wl,null);
    if(!ps.endWeek||!ss.startWeek)return null;
    var hol=sc.holidayWeeks||[];
    var working=wl.filter(function(w){return hol.indexOf(w)<0;});
    var lag=Number(row.lagWeeks)||0;
    var ie=working.indexOf(ps.endWeek),is=working.indexOf(ss.startWeek);
    if(ie<0||is<0)return null;
    var earliest=ie+1+lag;
    return{pred:pred,earliestIdx:earliest,earliestWeek:working[earliest]||"",weeks:is-earliest,overlap:ss.startWeek<=ps.endWeek};
  }
  // Moves the task (and whatever follows it) so it starts right when its predecessor allows.
  function moveAfterPredecessor(row){
    var ls=linkState(row);
    if(!ls)return;
    if(ls.weeks===0)return;
    shiftRows([row.id],-ls.weeks);
  }
  // "succ starts after pred" — created by dropping the ● of pred on succ, or from the panel.
  function linkRows(predId,succId){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var pred=rowById(predId),succ=rowById(succId);
    if(!pred||!succ||predId===succId)return;
    var hdr=function(r){return r.kind==="category"||r.kind==="section";};
    if(hdr(pred)||hdr(succ)){safeAlert("A link joins two tasks — not a room or section header.");return;}
    if(succ.afterId===predId)return;
    if(linkMakesLoop(sc.rows||[],predId,succId)){
      safeAlert("Not linked: “"+(succ.label||"untitled")+"” already comes before “"+(pred.label||"untitled")+"” in the chain.\n\nThis link would make a loop.");
      return;
    }
    // a task has one predecessor: the new link replaces the old one (Ctrl+Z to undo)
    updRow(succId,{afterId:predId});
  }
  // No browser dialogs: Chrome can block them silently. Ctrl+Z undoes any of these.
  function removeLink(succId){
    var succ=rowById(succId);
    if(!succ||!succ.afterId)return;
    updRow(succId,{afterId:""});
  }
  // Moves the END of an arrow: "succ starts after pred" becomes "target starts after pred".
  // ONE write for both rows.
  function relinkTo(succId,targetId){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var succ=rowById(succId),tgt=rowById(targetId);
    if(!succ||!tgt||!succ.afterId)return;
    var predId=succ.afterId;
    if(tgt.kind==="category"||tgt.kind==="section"){safeAlert("A link joins two tasks — not a room or section header.");return;}
    if(targetId===predId)return;
    var rows=(sc.rows||[]).map(function(r){return r.id===succId?Object.assign({},r,{afterId:""}):r;});
    if(linkMakesLoop(rows,predId,targetId)){safeAlert("Not moved: this link would make a loop.");return;}
    upd(sc.id,{rows:rows.map(function(r){return r.id===targetId?Object.assign({},r,{afterId:predId}):r;})});
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
        if(tgt===undefined)return;      // pushed off the board: toggleHolidayWeek refuses it first
        moved[tgt]=moved[tgt]==="actual"?"both":(moved[tgt]==="both"?"both":"plan");
      });
      return Object.assign({},r,{cells:moved},spanFromCells(moved,wksList,r));
    });
  }
  // A click on a week header used to neutralise the week and reflow the whole plan at once,
  // with no question asked: one stray click moved every bar. It now asks first.
  function toggleHolidayWeek(wk){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var hw=(sc.holidayWeeks||[]).slice();
    var i=hw.indexOf(wk);
    var turningOn=i<0;
    var wksList=scheduleWeeks(sc);
    var later=(sc.rows||[]).filter(function(r){
      return Object.keys(r.cells||{}).some(function(w){var v=r.cells[w];return w>=wk&&(v==="plan"||v==="both");});
    }).length;
    if(!safeConfirm((turningOn
        ?"Neutralise the week of "+fmtDate(wk)+" (holiday / shutdown)?\n\n"+later+" task"+(later!==1?"s have":" has")+" planned bars from this week on: they all move one week later."
        :"Re-activate the week of "+fmtDate(wk)+"?\n\n"+later+" task"+(later!==1?"s":"")+" with planned bars after it move one week earlier.")+
      "\nActual (blue) bars never move."))return;
    if(turningOn)hw.push(wk);else hw.splice(i,1);
    var rows=reflowForHoliday((sc.rows||[]).slice(),wksList,wk,turningOn?1:-1,hw);
    var lost=plannedCellCount(sc.rows||[])-plannedCellCount(rows);
    if(lost>0){
      safeAlert("Not changed: "+lost+" planned week"+(lost!==1?"s":"")+" would be pushed past the last week of the schedule.\n\nIncrease \"Nb weeks\" first.");
      return;
    }
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
  // One painted cell, as the old click cycle did: the first cell of a stroke decides whether
  // the stroke adds the current mode or erases it, so a single click still toggles.
  function paintedValue(cur,erase){
    if(erase){
      if(cur===paintMode)return "";
      if(cur==="both")return paintMode==="plan"?"actual":"plan";
      return cur;
    }
    if(!cur)return paintMode;
    if(cur===paintMode||cur==="both")return cur;
    return "both";
  }
  function strokeErases(row,wk){
    var cur=(row.cells||{})[wk]||"";
    return cur===paintMode||cur==="both";
  }
  // Paints every working week between two weeks of one row, in ONE save. A click is a
  // stroke of one cell. Neutralised weeks are skipped.
  function paintRange(row,fromWk,toWk,erase){
    var wl=scheduleWeeks(sc);
    var a=wl.indexOf(fromWk),b=wl.indexOf(toWk);
    if(a<0||b<0)return;
    if(b<a){var t=a;a=b;b=t;}
    var hol=sc.holidayWeeks||[];
    var cells=Object.assign({},row.cells||{});
    for(var k=a;k<=b;k++){
      var w=wl[k];
      if(hol.indexOf(w)>=0)continue;
      var nv=paintedValue(cells[w]||"",erase);
      if(nv)cells[w]=nv;else delete cells[w];
    }
    // Painting IS the input: the start/end weeks in the 📐 panel are derived from the bars,
    // so the tender's target start updates without anyone typing a date.
    var sp=spanFromCells(cells,wl,null);
    updRow(row.id,{cells:cells,startWeek:sp.startWeek||"",endWeek:sp.endWeek||""});
  }
  function toggleCell(row,wk){paintRange(row,wk,wk,strokeErases(row,wk));}
  // ---- Who does the task ----------------------------------------------------
  // The tender comes first: once its Awarded section names a company, every task linked to
  // it shows that company and takes its colour, in every zone. A company typed on the task
  // itself still wins (a sub-subcontractor, say) and is flagged when it differs.
  //   source: row (set on the task) | tender (read from Awarded) | choose (several
  //   awardees, pick one) | pending (tender not awarded yet) | "" (no tender, nothing set)
  var tenderById={};(tenders||[]).forEach(function(t){tenderById[t.id]=t;});
  function rowSub(row){
    if(!row||row.kind==="category"||row.kind==="section")return{name:"",source:"",options:[]};
    var td=row.tenderRef?tenderById[row.tenderRef]:null;
    var aw=tenderAwardees(td);
    if(row.group)return{name:row.group,source:"row",forced:aw.length>0&&aw.indexOf(row.group)<0,options:aw};
    if(td){
      if(aw.length===1)return{name:aw[0],source:"tender",options:aw};
      if(aw.length>1)return{name:"",source:"choose",options:aw};
      return{name:"",source:"pending",options:[]};
    }
    return{name:"",source:"",options:[]};
  }
  function rowGroup(row){return rowSub(row).name;}
  // Planned-bar colour: the row's own colour wins, then the subcontractor's colour,
  // then the default gold. Actual bars stay blue everywhere so "done" is always readable.
  function planColor(row){
    if(!row)return "#c9a84c";
    if(row.color)return row.color;
    var gc=(sc&&sc.groupColors)||{};
    var g=rowGroup(row);
    if(g&&gc[g])return gc[g];                                    // set from this schedule
    var glob=window._ppSubColors||{};
    if(g&&glob[g])return glob[g];                                // set in Settings
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
    var all=sc?scheduleWeeks(sc):[];
    // sheets:0 = automatic (one sheet up to 26 weeks, then as many as needed)
    setPrintOpts({risks:true,progress:false,range:"all",from:all[0]||"",to:all.length?printAddDays(all[all.length-1],6):"",size:"A4",sheets:0});
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
  var allGroups=sc?[...new Set([...(window._ppSubList||[]),...(sc.groups||[]),...(sc.rows||[]).map(function(r){return rowGroup(r);}).filter(Boolean)])].sort(function(a,b){return a.localeCompare(b);}):[];

  // Group filter: keeps the room/category headers and only the tasks of the selected trade.
  // Rooms with no matching task are dropped entirely so the export stays clean.
  var groupRows=[];
  if(sc){
    if(!fGroup){
      groupRows=(sc.rows||[]).slice();
    }else{
      // Hide only the tasks belonging to another subcontractor. Room/category headers are
      // always kept so the schedule structure stays readable.
      groupRows=(sc.rows||[]).filter(function(r){return r.kind==="category"||r.kind==="section"||rowGroup(r)===fGroup;});
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
  var selectableIds=visibleRows.filter(function(r){return r.kind!=="category"&&r.kind!=="section";}).map(function(r){return r.id;});
  function toggleSelRow(id){
    setSelRows(function(prev){
      return prev.indexOf(id)>=0?prev.filter(function(x){return x!==id;}):prev.concat([id]);
    });
  }
  // Shift+click selects every task between the last one clicked and this one.
  function clickSelRow(id,e){
    var last=lastSelRef.current;
    if(e&&e.shiftKey&&last&&last!==id){
      var a=selectableIds.indexOf(last),b=selectableIds.indexOf(id);
      if(a>=0&&b>=0){
        var range=selectableIds.slice(Math.min(a,b),Math.max(a,b)+1);
        setSelRows(function(prev){
          var on={};prev.concat(range).forEach(function(x){on[x]=1;});
          return selectableIds.filter(function(x){return on[x];});
        });
        lastSelRef.current=id;
        return;
      }
    }
    lastSelRef.current=id;
    toggleSelRow(id);
  }
  function bulkDelete(){
    if(!sc||selRows.length===0)return;
    var ids={};selRows.forEach(function(id){ids[id]=1;});
    var doomed=(sc.rows||[]).filter(function(r){return ids[r.id];});
    var linked=(tasks||[]).filter(function(t){return t.scheduleRowRef&&ids[t.scheduleRowRef]&&t.status!=="done";});
    if(!safeConfirm("Delete "+doomed.length+" task"+(doomed.length!==1?"s":"")+"?\n\n"+
      doomed.slice(0,8).map(function(r){return "· "+(r.label||"untitled");}).join("\n")+(doomed.length>8?"\n… and "+(doomed.length-8)+" more":"")+
      (linked.length>0?"\n\n"+linked.length+" open action"+(linked.length!==1?"s":"")+" will lose their link to the schedule (the actions are kept).":"")))return;
    if(linked.length>0&&saveTasks){
      saveTasks((tasks||[]).map(function(t){return (t.scheduleRowRef&&ids[t.scheduleRowRef])?Object.assign({},t,{scheduleRowRef:""}):t;}));
    }
    // a task that started after a deleted one now has no predecessor
    upd(sc.id,{rows:(sc.rows||[]).filter(function(r){return !ids[r.id];}).map(function(r){return ids[r.afterId]?Object.assign({},r,{afterId:""}):r;})});
    if(linked.length>0)clearUndo();
    if(ids[panelRowId])setPanelRowId(null);
    setSelRows([]);
  }
  function bulkPatch(patch){
    if(!sc||selRows.length===0)return;
    var ids={};selRows.forEach(function(id){ids[id]=1;});
    upd(sc.id,{rows:(sc.rows||[]).map(function(r){return ids[r.id]?Object.assign({},r,patch):r;})});
  }
  function bulkShift(delta){
    if(!sc||selRows.length===0)return;
    shiftRows(selRows,delta);
  }
  // drop from the selection anything that no longer exists or is no longer visible
  useEffect(function(){
    setSelRows(function(prev){
      var ok={};selectableIds.forEach(function(id){ok[id]=1;});
      var next=prev.filter(function(id){return ok[id];});
      return next.length===prev.length?prev:next;
    });
  },[selId,fGroup,sc?(sc.rows||[]).length:0]);

  // What a gesture does once released — refreshed at every render, so it never works on an
  // outdated copy of the schedule.
  dragEndRef.current=function(d){
    var row=rowById(d.rowId);
    if(!row)return;
    if(d.type==="paint")paintRange(row,d.from,d.to,d.erase);
    else if(d.type==="move"){var dl=workingDelta(d.from,d.to);if(dl)shiftRows([row.id],dl);}
    else if(d.type==="link"&&d.target)linkRows(row.id,d.target);
    else if(d.type==="relink"){
      var moved=Math.abs((d.x||0)-(d.x0||0))+Math.abs((d.y||0)-(d.y0||0));
      if(moved<6||!d.target){if(moved<6)setLinkMenu({succId:row.id,x:d.x0,y:d.y0});return;}
      relinkTo(row.id,d.target);
    }
  };
  // Esc closes the side panel and the menu (inside a text box, Esc only undoes the typing).
  useEffect(function(){
    function onKey(e){
      if(e.key!=="Escape")return;
      var t=e.target||{};var tag=(t.tagName||"").toLowerCase();
      if(tag==="input"||tag==="textarea")return;
      setCtxMenu(null);setPanelRowId(null);setBlMenu(false);setLinkMenu(null);
    }
    window.addEventListener("keydown",onKey);
    return function(){window.removeEventListener("keydown",onKey);};
  },[]);
  // Link arrows: measured on the real table after each render (rows have different heights),
  // and stored only when something actually moved.
  useEffect(function(){
    var box=tableBoxRef.current;
    var out=[];
    if(box&&showLinks&&!monthView&&sc){
      var b=box.getBoundingClientRect();
      var wl=wks;
      var byId={};(sc.rows||[]).forEach(function(r){byId[r.id]=r;});
      (sc.rows||[]).forEach(function(r){
        if(!r.afterId||!byId[r.afterId])return;
        var p=byId[r.afterId];
        var ps=spanFromCells(p.cells,wl,null),ss=spanFromCells(r.cells,wl,null);
        if(!ps.endWeek||!ss.startWeek)return;
        var pc=box.querySelector('tr[data-rowid="'+p.id+'"] td[data-wk="'+ps.endWeek+'"]');
        var scl=box.querySelector('tr[data-rowid="'+r.id+'"] td[data-wk="'+ss.startWeek+'"]');
        if(!pc||!scl)return;
        var a=pc.getBoundingClientRect(),c=scl.getBoundingClientRect();
        out.push({id:r.id,x1:Math.round(a.right-b.left),y1:Math.round(a.top+a.height/2-b.top),
          x2:Math.round(c.left-b.left),y2:Math.round(c.top+c.height/2-b.top),bad:ss.startWeek<=ps.endWeek,
          label:(p.label||"untitled")+" → "+(r.label||"untitled")});
      });
    }
    var key=JSON.stringify(out);
    if(key!==arrowKeyRef.current){arrowKeyRef.current=key;setArrowGeo(out);}
  });
  // Who does the task: the select used in the grid and in the side panel.
  function subSelect(row,big){
                          var rs=rowSub(row);
                          var look={
                            row:{c:rs.forced?"#b35c00":"#00695c",bg:rs.forced?"#fdf1e0":"#e8f5e9",b:rs.forced?"#e6c48c":"#00695c",w:700},
                            tender:{c:"#00695c",bg:"#f2f9f3",b:"#a5d6a7",w:700},
                            choose:{c:"#b35c00",bg:"#fdf1e0",b:"#e6c48c",w:700},
                            pending:{c:"#9b968b",bg:"#fff",b:"#e8e6df",w:400},
                            "":{c:"#bbb",bg:"#fff",b:"#e8e6df",w:400}}[rs.source];
                          var emptyLabel=rs.source==="tender"?"🔗 "+rs.name
                            :rs.source==="choose"?"⚠ Choose: "+rs.options.join(" / ")
                            :rs.source==="pending"?"⏳ Tender pending"
                            :rs.source==="row"&&rs.options.length?"↺ Follow the tender ("+rs.options.join(" / ")+")"
                            :"👷 —";
                          var tip=rs.source==="tender"?"From the Awarded section of the tender. Pick another company only if this task is done by someone else."
                            :rs.source==="choose"?"The tender is awarded to several companies: pick the one doing this task."
                            :rs.source==="pending"?"Linked to a tender that has no subcontractor in its Awarded section yet. It fills itself as soon as one is entered there."
                            :rs.forced?"Set on this task by hand — the tender is awarded to "+rs.options.join(" / ")+". Pick “Follow the tender” to use it."
                            :"Subcontractor / company doing this task — drives the colour, the filter and the printed schedule";
                          var others=allGroups.filter(function(g){return rs.options.indexOf(g)<0;});
                          return <select value={row.group||""} onChange={function(e){
                              var g=e.target.value;
                              var patch={group:g};
                              // A rule fills the tender in the same write, unless one is already set.
                              if(g&&!row.tenderRef){
                                var rule=tenderRuleFor(window._ppTenderRules,g,curZone);
                                if(rule){patch.tenderRef=rule.tenderId;patch.tenderFromHeader="";}
                              }
                              updRow(row.id,patch);
                              // The row you just reassigned would otherwise vanish the instant it no
                              // longer matches the active Subcont. filter — looking exactly like the
                              // change was refused. Drop back to "All subcontractors" so it stays visible.
                              var eff=g||(rs.options.length===1?rs.options[0]:"");
                              if(fGroup&&eff!==fGroup)setFGroup("");
                            }}
                            title={tip}
                            style={{width:"100%",padding:big?"5px 7px":"2px 4px",fontSize:big?12:10,border:"1px solid "+look.b,borderRadius:4,fontFamily:"inherit",
                              color:look.c,fontWeight:look.w,background:look.bg,fontStyle:rs.source==="pending"?"italic":"normal"}}>
                            <option value="">{emptyLabel}</option>
                            {rs.options.length>0&&<optgroup label="Awarded on the tender">
                              {rs.options.map(function(g){return <option key={"aw"+g} value={g}>{g}</option>;})}
                            </optgroup>}
                            <optgroup label={rs.options.length?"Other companies":"Companies"}>
                              {others.map(function(g){return <option key={g} value={g}>{g}</option>;})}
                            </optgroup>
                          </select>;
  }
  // ---- Baseline in use: weeks per task, variances, roll-up per room/section ----
  var baselines=(sc&&sc.baselines)||[];
  var activeBl=sc?baselines.find(function(b){return b.id===sc.activeBaselineId;})||null:null;
  var blWeekSet={},blVar={},blRoll={},blStats=null;
  if(activeBl){
    blStats={late:0,early:0,isNew:0,maxLate:0,removed:0,curEnd:"",blEnd:""};
    var secId="",catId="";
    (sc.rows||[]).forEach(function(r){
      if(r.kind==="section"){secId=r.id;catId="";return;}
      if(r.kind==="category"){catId=r.id;return;}
      var segs=(activeBl.rows||{})[r.id];
      if(segs){var set={};baselineWeeks(segs).forEach(function(w){set[w]=1;});blWeekSet[r.id]=set;}
      var v=baselineVariance(activeBl,r,wks);
      blVar[r.id]=v;
      if(!v)return;
      if(v.isNew){blStats.isNew++;}
      else if(v.noPlan){blStats.removed++;}
      else{
        if(v.finish>0){blStats.late++;blStats.maxLate=Math.max(blStats.maxLate,v.finish);}
        if(v.finish<0)blStats.early++;
        [catId,secId].forEach(function(h){if(h&&(blRoll[h]===undefined||v.finish>blRoll[h]))blRoll[h]=v.finish;});
      }
      var ce=spanFromCells(r.cells,wks,null).endWeek;
      if(ce&&ce>blStats.curEnd)blStats.curEnd=ce;
      if(segs){var be=baselineWeeks(segs).slice(-1)[0];if(be>blStats.blEnd)blStats.blEnd=be;}
    });
    // tasks deleted since the baseline still count for its end date
    Object.keys(activeBl.rows||{}).forEach(function(id){
      var be=baselineWeeks(activeBl.rows[id]).slice(-1)[0];if(be>blStats.blEnd)blStats.blEnd=be;
    });
  }
  // No browser dialog here: Chrome silently blocks prompt()/confirm() once a page has shown
  // many of them, and the menu then seemed to do nothing. Everything happens in the panel.
  function setBaseline(name){
    if(!sc)return;
    if(canEdit===false){safeAlert("Only the zone leaders can modify this schedule.");return;}
    var snap=baselineSnapshot(sc);
    if(snap.count===0){safeAlert("Nothing to freeze: no task has planned weeks yet.");return;}
    name=String(name||"").trim()||("Baseline "+fmtDate(todayStr));
    var list=baselines.slice();
    while(list.length>=6)list.shift();               // a schedule keeps the 6 most recent
    var bl={id:uuid(),name:name,date:todayStr,by:window._currentUser?window._currentUser.name:"",rows:snap.rows};
    upd(sc.id,{baselines:list.concat([bl]),activeBaselineId:bl.id});
    setBlName("");setBlMenu(false);
  }
  function deleteBaseline(id){
    if(!sc)return;
    upd(sc.id,{baselines:baselines.filter(function(x){return x.id!==id;}),activeBaselineId:sc.activeBaselineId===id?"":sc.activeBaselineId});
    setBlDelId("");
  }
  function blBadge(v){
    if(!v)return null;
    if(v.isNew)return{t:"new",c:"#6f6b62",bg:"#f0ede6",tip:"Not in the baseline “"+activeBl.name+"” — added since"};
    if(v.noPlan)return{t:"no plan",c:"#6f6b62",bg:"#f0ede6",tip:"In the baseline ("+fmtDate(v.bStart)+" → "+fmtDate(v.bEnd)+"), no planned week now"};
    if(v.finish===0&&v.start===0)return null;
    var late=v.finish>0;
    return{t:(v.finish>0?"+":v.finish<0?"−":"±")+Math.abs(v.finish)+"w",c:late?"#c62828":v.finish<0?"#2e7d32":"#6f6b62",bg:late?"#fce4ec":v.finish<0?"#e8f5e9":"#f5f4f0",
      tip:"Against “"+activeBl.name+"” ("+fmtDate(activeBl.date)+"):\nstart "+fmtDate(v.bStart)+" → "+fmtDate(v.cStart)+" ("+(v.start>0?"+":"")+v.start+" wk)\nfinish "+fmtDate(v.bEnd)+" → "+fmtDate(v.cEnd)+" ("+(v.finish>0?"+":"")+v.finish+" wk)"};
  }

  // Primavera P6 export of the schedule on screen (all rows, whatever the filters).
  function exportXer(){
    if(!sc)return;
    var def=("RT-"+curZone+"-"+(sc.title||"")).replace(/[^A-Za-z0-9\-_. ]+/g,"").replace(/\s+/g,"-").slice(0,20);
    // No prompt(): Chrome may block it silently. The ID can be changed in P6 after import.
    var code=def||"RT-SCHEDULE";
    var res=buildScheduleXer(sc,{projCode:code,projName:curZone+" — "+(sc.title||"schedule"),tenders:tenders||[],
      companyOf:function(r){return rowGroup(r);},progressOf:function(r){return rowProgress(r);},
      today:todayStr,user:window._currentUser?window._currentUser.name:""});
    if(!res.text){safeAlert(res.warnings.join("\n"));return;}
    var blob=new Blob([xerToCp1252(res.text)],{type:"application/octet-stream"});
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=code+".xer";
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
    safeAlert("P6 file ready: "+code+".xer\n\n"+res.stats.activities+" activities · "+res.stats.links+" links · "+res.stats.wbs+" WBS nodes"+
      "\nData date: "+fmtDate(res.stats.dataDate.slice(0,10))+
      (res.warnings.length?"\n\n"+res.warnings.map(function(w){return "· "+w;}).join("\n"):"")+
      "\n\nIn P6: File › Import › Primavera PM (XER) › Create new project. The project ID ("+code+") can be renamed in P6.");
  }
  function arrowPath(g){
    if(g.x2>=g.x1+10){
      var xm=g.x1+6;
      return "M"+g.x1+","+g.y1+" H"+xm+" V"+g.y2+" H"+(g.x2-2);
    }
    // the next task starts before this one ends: go round, just above/below its row
    var yMid=g.y2>g.y1?g.y2-11:g.y2+11;
    return "M"+g.x1+","+g.y1+" h6 V"+yMid+" H"+(g.x2-9)+" V"+g.y2+" H"+(g.x2-2);
  }

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

  // The two actions of the toolbar with the most code, kept out of the JSX.
  function applyTenderRules(){
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
  }
  function cleanAutoActions(){
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
  }

  return <div className={fullScreen?"sched-fs":""} style={fullScreen?{position:"fixed",inset:0,zIndex:1200,background:"#f4f3f0",padding:"10px 14px",overflowY:"auto"}:null}>
    {fullScreen&&<div className="sched-noprint" style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
      <button className="btn btn-pri" onClick={function(){setFullScreen(false);}} title="Back to the zone (Esc)"
        style={{fontSize:13,padding:"7px 16px"}}>← Back</button>
      <span style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:17}}>{curZone} — {sc?sc.title:""}</span>
      <span style={{fontSize:11,color:"#aaa"}}>press Esc to leave full screen</span>
      {sc&&<button className="btn btn-pri" onClick={openPrint} style={{marginLeft:"auto"}}
        title="Print the schedule or save it as a PDF: choose the weeks, the paper size and the number of sheets">🖨 Print / PDF</button>}
    </div>}
    {backTo&&<div className="sched-noprint" style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,
      padding:"8px 12px",borderRadius:8,background:"var(--blue-soft,#e8f0fe)",border:"1.5px solid #c6d9f5"}}>
      <span style={{fontSize:12,color:"var(--blue,#0f5299)"}}>You came here from <b>{backTo.label}</b></span>
      <button className="btn btn-sm" style={{marginLeft:"auto"}}
        onClick={function(){var id=backTo.id;setBackTo(null);if(onNavTender)onNavTender(id);}}>↩ Back to the tender</button>
      <button className="btn btn-sm" onClick={function(){setBackTo(null);}} title="Stay in the schedule">✕</button>
    </div>}
    {/* Header: which schedule, and the actions on the whole schedule. Print is the main one,
        styled like the zone's Weekly pack; the rarely used ones sit in Settings and More. */}
    <div className={"sched-noprint"+(fullScreen?" sched-fs-hide":"")} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
      {zoneScheds.map(function(s){
        return <button key={s.id} className={"fchip"+(sc&&sc.id===s.id?" on":"")} onClick={function(){setSelId(s.id);}}>{s.title}</button>;
      })}
      <button className="btn btn-sm btn-gold" onClick={addSchedule}>＋ New schedule</button>
      {sc&&<span style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        {sc.updatedAt&&<span style={{fontSize:10,color:"#aaa"}}>Last update {fmtDate(sc.updatedAt)}{sc.updatedBy?" by "+sc.updatedBy.split(",")[0]:""}</span>}
        <button className={"btn btn-sm"+(showSettings?" btn-pri":"")} onClick={function(){setShowSettings(!showSettings);}}
          title="Title, start week, number of weeks, subcontractors, copy to another zone">⚙ Settings</button>
        <span style={{position:"relative",display:"inline-block"}}>
          <button className={"btn btn-sm"+(moreMenu?" btn-pri":"")} onClick={function(){setMoreMenu(!moreMenu);}}
            title="Documents, Primavera export and the other actions on this schedule">⋯ More ▾</button>
          {moreMenu&&<React.Fragment>
            <div onClick={function(){setMoreMenu(false);}} style={{position:"fixed",inset:0,zIndex:1290}}></div>
            <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:1300,minWidth:250,background:"#fff",border:"1px solid var(--rule,#ddd9cf)",borderRadius:9,
              boxShadow:"0 10px 32px rgba(0,0,0,.2)",padding:6}}>
              {[
                {k:"docs",label:"📄 Documents"+(scDocs.length>0?" ("+scDocs.length+")":""),title:"Reference documents: setting-out plans, sections, details. Attach one to a room and its name becomes clickable in the schedule.",run:function(){setShowDocs(true);}},
                {k:"xer",label:"⬇ Export to Primavera P6 (.xer)",title:"WBS section › room, activities, links, calendar with neutralised weeks, subcontractor and tender codes, progress",run:exportXer},
                canEdit&&{k:"sort",label:"🔤 Sort rooms A→Z",title:"Sort categories A→Z. Each one keeps its own tasks.",run:sortCategories},
                canEdit&&{k:"rules",label:"🔗 Apply tender rules",title:"Apply the subcontractor → tender rules (Settings › Tender rules) to every task of this schedule",run:applyTenderRules},
                isAdmin&&{k:"clean",label:"🧹 Clean auto-actions",title:"Remove the duplicate 'Procurement late for…' actions created by the old auto-rule, keeping one per task",run:cleanAutoActions,danger:true},
                isAdmin&&{k:"del",label:"🗑 Delete this schedule",title:"Delete this schedule (admin only)",run:function(){delSchedule(sc.id);},danger:true}
              ].filter(Boolean).map(function(it){
                return <button key={it.k} title={it.title} onClick={function(){setMoreMenu(false);it.run();}}
                  onMouseEnter={function(e){e.currentTarget.style.background="var(--rule-2,#efece5)";}} onMouseLeave={function(e){e.currentTarget.style.background="none";}}
                  style={{display:"block",width:"100%",textAlign:"left",padding:"7px 10px",border:"none",background:"none",borderRadius:6,cursor:"pointer",
                    fontFamily:"inherit",fontSize:12,color:it.danger?"var(--red,#b3302a)":"var(--ink,#16181d)"}}>{it.label}</button>;
              })}
            </div>
          </React.Fragment>}
        </span>
        <button className="btn btn-pri" onClick={openPrint}
          title="Print the schedule or save it as a PDF: choose the weeks, the paper size and the number of sheets">🖨 Print / PDF</button>
      </span>}
    </div>

    {!sc
      ?<div className="empty"><div className="empty-ico">📅</div><div className="empty-txt">No schedule for {curZone} yet. Create one to plan work week by week.</div></div>
      :<div>
        {showSettings&&<div className={"sched-noprint"+(fullScreen?" sched-fs-hide":"")} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10,padding:"10px 12px",background:"#fafaf8",borderRadius:8,border:"1px solid #e8e6df"}}>
          <div style={{flex:2,minWidth:170}}>
            <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Title</label>
            <SchedBufInput type="text" value={sc.title||""} onCommit={function(v){upd(sc.id,{title:v});}} style={{padding:"4px 8px",fontSize:12,fontWeight:600}}/>
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
          {/* Adding a subcontractor used to be an 80px box that only reacted to Enter, with
              no button and no feedback — people could not find it. */}
        {canEdit&&<span style={{display:"flex",gap:4,alignItems:"center"}}>
          <input type="text" value={newGroup} onChange={function(e){setNewGroup(e.target.value);}}
            onKeyDown={function(e){if(e.key==="Enter")addGroupNow();}}
            title="Adds the company to this schedule. For a name you will reuse in other zones, add it in Settings › 👷 Subcontractors instead."
            placeholder="+ add subcontractor…" style={{width:150,padding:"3px 6px",fontSize:10}}/>
          <button className="btn btn-sm" disabled={!newGroup.trim()} onClick={addGroupNow}
            style={{padding:"2px 8px",fontSize:10}}>＋ Add</button>
        </span>}
        </div>}

        {canEdit&&selRows.length>0&&<div className="sched-noprint" style={{padding:"8px 12px",background:"#e8f0fe",border:"1.5px solid #1a73e8",borderRadius:8,marginBottom:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:800,color:"#1a73e8"}}>{selRows.length} task{selRows.length!==1?"s":""} selected</span>

          <select value={bulkTender} onChange={function(e){
            var v=e.target.value;setBulkTender("");
            if(!v)return;
            if(v==="__inherit__")bulkPatch({tenderRef:"",tenderFromHeader:""});
            else if(v==="__none__")bulkPatch({tenderRef:"",tenderFromHeader:"-"});
            else bulkPatch({tenderRef:v,tenderFromHeader:""});
          }} title="Link every selected task to one tender" style={{width:"auto",padding:"4px 8px",fontSize:11}}>
            <option value="">🔗 Link to tender…</option>
            <option value="__inherit__">↳ Follow the room / section tender</option>
            <option value="__none__">— no tender —</option>
            {(tenders||[]).slice().sort(function(a,b){return(a.title||"").localeCompare(b.title||"");}).map(function(t){return <option key={t.id} value={t.id}>{t.title}{t.package?" ("+t.package+")":""}</option>;})}
          </select>

          <select value={bulkGroup} onChange={function(e){var v=e.target.value;setBulkGroup("");if(v){bulkPatch({group:v==="__none__"?"":v});if(fGroup&&v!==fGroup)setFGroup("");}}}
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

          <button className="btn btn-sm btn-danger" onClick={bulkDelete} title="Delete every selected task">🗑 Delete</button>
          <span style={{fontSize:10,color:"#5f7fae"}}>Shift+click a box to select a range</span>
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
        {activeBl&&blStats&&<div className="sched-noprint" style={{padding:"8px 12px",background:"#eceff1",border:"1.5px solid #b0bec5",borderRadius:8,marginBottom:10,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",fontSize:12}}>
          <span style={{fontWeight:800,color:"#37474f"}}>📌 {activeBl.name}</span>
          <span style={{fontSize:11,color:"#607d8b"}}>frozen {fmtDate(activeBl.date)}{activeBl.by?" by "+activeBl.by.split(",")[0]:""}</span>
          {(function(){
            if(!blStats.curEnd||!blStats.blEnd)return null;
            var d=weeksBetween(blStats.blEnd,blStats.curEnd);
            return <span style={{fontWeight:700,color:d>0?"#c62828":d<0?"#2e7d32":"#37474f"}}>
              Finish {fmtDate(xerAddDays(blStats.curEnd,4))} — {d===0?"on baseline":(d>0?"+":"−")+Math.abs(d)+" week"+(Math.abs(d)!==1?"s":"")+(d>0?" late":" early")}</span>;
          })()}
          <span style={{color:blStats.late?"#c62828":"#607d8b"}}>{blStats.late} task{blStats.late!==1?"s":""} finishing later{blStats.late?" (worst +"+blStats.maxLate+" wk)":""}</span>
          {blStats.early>0&&<span style={{color:"#2e7d32"}}>{blStats.early} earlier</span>}
          {blStats.isNew>0&&<span style={{color:"#607d8b"}}>{blStats.isNew} new since</span>}
          {blStats.removed>0&&<span style={{color:"#607d8b"}}>{blStats.removed} no longer planned</span>}
          <span style={{fontSize:10,color:"#90a4ae",marginLeft:"auto"}}>grey line under the bars = baseline</span>
        </div>}
        {procRisks.length>0&&(function(){
          // Folded to one line by default (it pushed the grid down); the choice is remembered in
          // this browser. Worst first. A click on a task opens it. Printing shows the full list.
          var list=procRisks.slice().sort(function(a,b){
            if(a.risk.late!==b.risk.late)return a.risk.late?-1:1;
            return (b.risk.weeksLate||0)-(a.risk.weeksLate||0);
          });
          var nLate=list.filter(function(x){return x.risk.late;}).length;
          var nTight=list.length-nLate;
          function item(x){
            return <div key={x.row.id} onClick={function(){setPanelRowId(x.row.id);}} title="Open this task"
              style={{fontSize:11,color:"#555",padding:"2px 4px",borderRadius:4,cursor:"pointer"}}
              onMouseEnter={function(e){e.currentTarget.style.background="#fde4ec";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}>
              <strong>{x.row.label}</strong> — {x.risk.tender.title} delivers {fmtDate(x.risk.delivery)}, starts week of {fmtDate(x.risk.startWeek)}
              {x.risk.late&&<span style={{color:"#c62828",fontWeight:700}}> ({x.risk.weeksLate}w late)</span>}
              {x.risk.tight&&<span style={{color:"#b45309"}}> (no margin)</span>}
            </div>;
          }
          return <div className={printPlan&&!printPlan.risks?"sched-noprint":""} style={{padding:procOpen?"8px 12px":"5px 12px",background:"#fff5f7",border:"1.5px solid #f48fb1",borderRadius:8,marginBottom:10}}>
            <div onClick={function(){setProcOpen(!procOpen);}} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none"}}
              title={procOpen?"Fold the list":"Show the list"}>
              <span style={{fontSize:12,fontWeight:700,color:"#c62828"}}>🚚 {list.length} task{list.length!==1?"s":""} at risk from procurement</span>
              <span style={{fontSize:11,color:"#888"}}>{nLate>0?nLate+" late":""}{nLate>0&&nTight>0?" · ":""}{nTight>0?nTight+" no margin":""}</span>
              <span className="sched-noprint" style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:"#c62828"}}>{procOpen?"▴ Hide":"▾ Show"}</span>
            </div>
            {procOpen&&<div className="sched-noprint" style={{marginTop:5,maxHeight:220,overflowY:"auto",overscrollBehavior:"contain"}}>{list.map(item)}</div>}
            <div className="sched-print-only">{list.map(item)}</div>
          </div>;
        })()}

        {canEdit===false&&<div className="sched-noprint" style={{padding:"8px 12px",background:"#f0f8ff",border:"1px solid #bbdefb",borderRadius:8,marginBottom:10,fontSize:12,color:"#1565c0"}}>
          👁 Read-only — only the leaders of {curZone} can modify this schedule.
        </div>}

        <div className="sched-print-only">
          <div style={{fontSize:16,fontWeight:800}}>{sc.title}{fGroup?" — "+fGroup:""}</div>
          <div style={{fontSize:11,color:"#555"}}>{curZone} · {fmtDate(wks[0]||sc.startDate)} → {fmtDate(wks[wks.length-1]||sc.startDate)} · printed {fmtDate(todayStr)}{fGroup?" · subcontractor: "+fGroup:""}</div>
        </div>

        {canEdit!==false&&<div className="sched-noprint" style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center",padding:"8px 10px",background:"#fffdf0",border:"1px solid #f0e2b8",borderRadius:8}}>
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
        </div>}

        {/* Everyday tools on one line; the analysis and display options fold away. */}
        <div className="sched-noprint" style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
          {canEdit!==false&&<span style={{display:"flex",gap:3,alignItems:"center",paddingRight:6,borderRight:"1px solid #e0ddd6"}}>
            <button className="btn btn-sm" disabled={undoRef.current.past.length===0} onClick={function(){undoRedo(-1);}}
              title={"Undo the last change to this schedule (Ctrl+Z)"+(undoRef.current.past.length?" — "+undoRef.current.past.length+" step"+(undoRef.current.past.length!==1?"s":"")+" available":"")}
              style={{padding:"2px 8px",fontSize:12}}>↶</button>
            <button className="btn btn-sm" disabled={undoRef.current.future.length===0} onClick={function(){undoRedo(1);}}
              title="Redo (Ctrl+Y)" style={{padding:"2px 8px",fontSize:12}}>↷</button>
          </span>}
          {canEdit!==false&&<React.Fragment>
            <span style={{fontSize:10,fontWeight:800,color:"#aaa",textTransform:"uppercase"}} title="Click or drag along a row to fill the weeks as">Fill:</span>
            <button onClick={function(){setPaintMode("plan");}} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(paintMode==="plan"?"#c9a84c":"#ddd"),background:paintMode==="plan"?"#fffdf0":"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",color:paintMode==="plan"?"#b45309":"#aaa"}}>
              <span style={{width:14,height:10,background:"#c9a84c",borderRadius:2}}></span> Planned
            </button>
            <button onClick={function(){setPaintMode("actual");}} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(paintMode==="actual"?"#1a73e8":"#ddd"),background:paintMode==="actual"?"#f0f8ff":"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",color:paintMode==="actual"?"#1a73e8":"#aaa"}}>
              <span style={{width:14,height:10,background:"#1a73e8",borderRadius:2}}></span> Actual
            </button>
            <button onClick={function(){setPaintMode("progress");}} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:16,border:"1.5px solid "+(paintMode==="progress"?"#7b1fa2":"#ddd"),background:paintMode==="progress"?"#f3e5f5":"#fff",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer",color:paintMode==="progress"?"#7b1fa2":"#aaa"}}>
              % Progress
            </button>
          </React.Fragment>}
          <span style={{display:"flex",gap:3,alignItems:"center",paddingRight:6,borderRight:"1px solid #e0ddd6"}}>
            <button className="btn btn-sm" onClick={function(){var el=document.querySelector(".sched-wrap");if(el)el.scrollLeft-=400;}} title="Scroll back in time" style={{padding:"2px 8px",fontSize:11}}>◀◀</button>
            <button className="btn btn-sm" onClick={function(){
              var el=document.querySelector(".sched-wrap");if(!el)return;
              var idx=wks.findIndex(function(w){var e=new Date(w);e.setDate(e.getDate()+6);return w<=todayStr&&todayStr<=toISO(e);});
              var th=idx>=0?el.querySelector('th[data-wk="'+wks[idx]+'"]'):null;
              if(th)el.scrollLeft=Math.max(0,th.offsetLeft-el.clientWidth/2);
            }} title="Jump to the current week" style={{padding:"2px 8px",fontSize:11}}>Today</button>
            <button className="btn btn-sm" onClick={function(){var el=document.querySelector(".sched-wrap");if(el)el.scrollLeft+=400;}} title="Scroll forward in time" style={{padding:"2px 8px",fontSize:11}}>▶▶</button>
          </span>
          <span style={{display:"flex",alignItems:"center",gap:4,paddingRight:8,borderRight:"1px solid var(--rule,#ddd9cf)"}}>
            <span style={{fontSize:9,fontWeight:800,color:"#aaa",textTransform:"uppercase"}}>Subcont.</span>
            <select value={fGroup} onChange={function(e){setFGroup(e.target.value);}} title="Show only the tasks of one subcontractor — room headers stay visible"
              style={{width:"auto",padding:"2px 6px",fontSize:10,fontWeight:fGroup?700:400,color:fGroup?"#00695c":"inherit",border:"1px solid "+(fGroup?"#00695c":"#e8e6df"),borderRadius:6}}>
              <option value="">All subcontractors</option>
              {allGroups.map(function(g){return <option key={g} value={g}>{g}</option>;})}
            </select>
            {fGroup&&<span style={{fontSize:10,color:"#00695c",fontWeight:700}}>{groupRows.filter(function(r){return r.kind!=="category";}).length} task(s)</span>}
          </span>
          <button className={"btn btn-sm"+(monthView?" btn-pri":"")} onClick={function(){setMonthView(!monthView);}}
            title={monthView?"Back to the full week grid":"Phone view: the next four weeks, task by task, grouped by room"}
            style={{padding:"2px 8px",fontSize:10}}>{monthView?"▦ Grid":"📱 Next 4 weeks"}</button>
          <button className="btn btn-sm btn-pri" onClick={function(){setFullScreen(!fullScreen);}}
            title={fullScreen?"Back to the zone view (Esc)":"Show the schedule full screen"}
            style={{padding:"2px 10px",fontSize:10}}>{fullScreen?"⤡ Exit":"⤢ Expand"}</button>
          <span style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
            <span style={{fontSize:10,color:"#888",cursor:"help"}}
              title={"Click a task name: details panel · Double-click: rename · Right-click: quick menu\nDrag along a row: paint · Shift+drag a bar: move it (linked tasks follow)\nDrag the ● at the end of a bar onto another task: link · Click an arrow: remove the link\nClick a week header to neutralise it (holiday)\nCtrl+Z / Ctrl+Y: undo / redo"}>
              ⓘ Tips</span>
            <button className={"btn btn-sm"+(showTools?" btn-pri":"")} onClick={function(){setShowTools(!showTools);}}
              title="Baseline, critical path, link arrows, advanced columns, collapse / expand the rooms"
              style={{padding:"2px 10px",fontSize:10}}>🔍 Analyse & view {showTools?"▴":"▾"}{!showTools&&(activeBl||critPath)?" ●":""}</button>
          </span>
        </div>

        {showTools&&<div className="sched-noprint" style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,flexWrap:"wrap",padding:"6px 10px",background:"#fafaf8",borderRadius:8,border:"1px solid #e8e6df"}}>
          <span style={{display:"flex",gap:4,alignItems:"center",paddingRight:8,borderRight:"1px solid var(--rule,#ddd9cf)"}}>
          <span style={{fontSize:9,fontWeight:700,color:"var(--ink-4,#9b968b)",textTransform:"uppercase",letterSpacing:".06em",marginRight:2}}>Analyse</span>
          <span style={{position:"relative",display:"inline-block"}}>
            <button className="btn btn-sm" onClick={function(){setBlMenu(!blMenu);setBlDelId("");}}
              title="Baseline: a frozen copy of the planned weeks. The grid then shows it as a grey line under each task, and how many weeks every finish has moved."
              style={{padding:"2px 8px",fontSize:10,fontWeight:activeBl?700:400,color:activeBl?"#37474f":"inherit",border:"1px solid "+(activeBl?"#78909c":"#e8e6df"),
                background:blMenu?"#eceff1":"#fff",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              📌 {activeBl?activeBl.name:"Baseline"} ▾</button>
            {blMenu&&<React.Fragment>
              <div onClick={function(){setBlMenu(false);setBlDelId("");}} style={{position:"fixed",inset:0,zIndex:1290}}></div>
              <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:1300,width:310,background:"#fff",border:"1px solid #cfd8dc",borderRadius:9,
                boxShadow:"0 10px 32px rgba(0,0,0,.2)",padding:"10px 12px",fontSize:12}}>
                <div style={{fontSize:10,fontWeight:800,color:"#607d8b",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Compare with</div>
                {[{id:"",name:"No baseline",date:""}].concat(baselines).map(function(b){
                  var on=(activeBl?activeBl.id:"")===b.id;
                  return <div key={b.id||"none"} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",borderRadius:6,background:on?"#eceff1":"transparent"}}>
                    <span onClick={function(){
                        if(on){setBlMenu(false);return;}
                        if(canEdit===false){safeAlert("Only the zone leaders can change the baseline in use.");return;}
                        upd(sc.id,{activeBaselineId:b.id});setBlMenu(false);
                      }}
                      style={{flex:1,minWidth:0,cursor:"pointer",fontWeight:on?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {on?"● ":"○ "}{b.name}{b.date?<span style={{color:"#90a4ae",fontWeight:400}}> · {fmtDate(b.date)}</span>:null}</span>
                    {b.id&&canEdit!==false&&(blDelId===b.id
                      ?<button className="btn btn-sm btn-danger" style={{padding:"0 6px",fontSize:10}} onClick={function(){deleteBaseline(b.id);}}>Delete?</button>
                      :<button onClick={function(){setBlDelId(b.id);}} title="Delete this baseline (click twice)"
                        style={{background:"none",border:"none",color:"#b0bec5",cursor:"pointer",fontSize:13,padding:"0 2px"}}>×</button>)}
                  </div>;
                })}
                {canEdit!==false&&<div style={{borderTop:"1px solid #eceff1",marginTop:8,paddingTop:8}}>
                  <div style={{fontSize:10,fontWeight:800,color:"#607d8b",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Freeze the plan as it is now</div>
                  <div style={{display:"flex",gap:6}}>
                    <input type="text" value={blName} onChange={function(e){setBlName(e.target.value);}}
                      onKeyDown={function(e){if(e.key==="Enter")setBaseline(blName);}}
                      placeholder={"Baseline "+fmtDate(todayStr)} style={{flex:1,minWidth:0,padding:"4px 7px",fontSize:12}}/>
                    <button className="btn btn-sm btn-pri" onClick={function(){setBaseline(blName);}}>📌 Freeze</button>
                  </div>
                  <div style={{fontSize:10,color:"#90a4ae",marginTop:5,lineHeight:1.4}}>
                    {baselineSnapshot(sc).count} task{baselineSnapshot(sc).count!==1?"s":""} with planned weeks will be frozen. Nothing in the schedule changes.
                    {baselines.length>=6?" A schedule keeps 6 baselines: the oldest (“"+baselines[0].name+"”) will be replaced.":""}
                  </div>
                </div>}
              </div>
            </React.Fragment>}
          </span>
          <button className={"btn btn-sm"+(critPath?" btn-pri":"")}
            title="Longest chain of dependent tasks — the sequence that sets the end date of this schedule"
            onClick={function(){
              if(critPath){setCritPath(null);return;}
              var cp=computeCriticalPath();
              if(!cp){safeAlert("No critical path to show.\n\nTasks need a duration (painted bars or a start/end week) and at least one “starts after” link.");return;}
              setCritPath(cp);
            }} style={{padding:"2px 8px",fontSize:10,borderColor:critPath?"":"var(--amber,#b35c00)",color:critPath?"":"var(--amber,#b35c00)",fontWeight:700}}>🎯 Critical path</button>
          </span>
          <span style={{display:"flex",gap:6,alignItems:"center",paddingRight:8,borderRight:"1px solid var(--rule,#ddd9cf)"}}>
            <span style={{fontSize:9,fontWeight:700,color:"var(--ink-4,#9b968b)",textTransform:"uppercase",letterSpacing:".06em",marginRight:2}}>View</span>
            <label title="Advanced view: adds the Quantity and Rate columns. Your choice only — each person picks their own view."
              style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:advanced?"#b45309":"#888",cursor:"pointer",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={advanced} onChange={function(e){setAdvanced(e.target.checked);}} style={{width:12,height:12,margin:0}}/>
              Advanced</label>
            <button className={"btn btn-sm"+(showLinks?" btn-pri":"")} onClick={function(){setShowLinks(!showLinks);}}
              title={showLinks?"Hide the link arrows":"Show the “starts after” links as arrows. Drag the ● at the end of a bar onto another task to link them."}
              style={{padding:"2px 8px",fontSize:10}}>↗ Links</button>
            <button className="btn btn-sm" onClick={function(){setAllCats(true);}} style={{padding:"2px 8px",fontSize:10}}>▸ Collapse all</button>
            <button className="btn btn-sm" onClick={function(){setAllCats(false);}} style={{padding:"2px 8px",fontSize:10}}>▾ Expand all</button>
          </span>
          <span style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#888"}}>
            <span style={{width:14,height:10,borderRadius:2,background:"repeating-linear-gradient(45deg,#e8e4da,#e8e4da 3px,#dcd8ce 3px,#dcd8ce 6px)"}}></span>
            Click a week header to neutralise it (holiday)
          </span>
        </div>}

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
                            {rowGroup(r)&&<span className="badge" style={{background:planColor(r),color:"#fff"}}>{rowGroup(r)}</span>}
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
          <style>{".sched-row .sched-link-handle{opacity:0;transition:opacity .12s}.sched-row:hover .sched-link-handle,.sched-row.sched-row-on .sched-link-handle{opacity:1}.sched-link-hit{cursor:pointer}.sched-link-hit:hover+.sched-link-line{stroke-width:2.6}"}</style>
          <div ref={tableBoxRef} style={{position:"relative",width:"max-content",minWidth:"100%"}}>
          <table style={{borderCollapse:"collapse",width:"max-content",minWidth:"100%",fontSize:11}}>
            <thead>
              <tr>
                <th style={{position:"sticky",left:0,top:0,background:"#f5f4f0",zIndex:4,width:320,minWidth:320,maxWidth:320,textAlign:"left",padding:"6px 10px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>
                  {canEdit&&<input type="checkbox" className="sched-noprint" checked={selRows.length>0&&selRows.length===selectableIds.length}
                    onChange={function(e){setSelRows(e.target.checked?selectableIds.slice():[]);}}
                    title="Select every task" style={{width:12,height:12,marginRight:6,verticalAlign:"middle",cursor:"pointer"}}/>}
                  Task</th>
                <th className="sched-noprint" title="Alert, progress, float, prerequisites and procurement delivery for the row" style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:190,minWidth:190,maxWidth:190,textAlign:"left",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>Status</th>
                <th style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:120,minWidth:120,maxWidth:120,textAlign:"left",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>Subcont.</th>
                {advanced&&<th title="Quantity of work on the row — typed here or in the side panel" style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:96,minWidth:96,maxWidth:96,textAlign:"right",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888"}}>Qty</th>}
                {advanced&&<th title={"Quantity divided by the working weeks of the row, and by "+WORK_DAYS_PER_WEEK+" working days a week"} style={{position:"sticky",top:0,background:"#f5f4f0",zIndex:3,width:96,minWidth:96,maxWidth:96,textAlign:"right",padding:"6px 8px",borderBottom:"1.5px solid #e8e6df",fontSize:10,textTransform:"uppercase",color:"#888",borderRight:"1.5px solid #e8e6df"}}>Rate</th>}
                {wks.map(function(wk){
                  var isCur=(function(){var d=new Date(wk);var e=new Date(wk);e.setDate(e.getDate()+6);return wk<=todayStr&&todayStr<=toISO(e);})();
                  var hol=isHoliday(wk);
                  return <th key={wk} data-wk={wk} onClick={function(){toggleHolidayWeek(wk);}}
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
              {(sc.rows||[]).length===0&&<tr><td colSpan={wks.length+(advanced?5:3)} style={{padding:"14px",textAlign:"center",color:"#bbb",fontSize:12}}>No rows yet. Add a category or a task below.</td></tr>}
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
                // While a task is being moved (Shift+drag) its bars are drawn where they will land.
                var shownCells=row.cells||{};
                if(drag&&drag.type==="move"&&drag.rowId===row.id){
                  var mdl=workingDelta(drag.from,drag.to);
                  if(mdl)shownCells=(shiftRowCascade([row],row.id,mdl,wks,{},sc.holidayWeeks||[])[0]||{}).cells||{};
                }
                var lastPlanWk=isCat?"":(spanFromCells(shownCells,wks,null).endWeek||"");
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
                    <td className="sched-noprint" style={{borderBottom:"1px dashed #e8e6df",borderRight:"1.5px solid #e8e6df",background:ok?"#f3f8f3":"#fffdf3"}}></td>
                    <td style={{padding:"1px 6px",borderBottom:"1px dashed #e8e6df",background:ok?"#f3f8f3":"#fffdf3",fontSize:9,color:"#aaa",whiteSpace:"nowrap"}}>prerequisite{pq.due?" · "+fmtDate(pq.due):""}</td>
                    {advanced&&<td style={{borderBottom:"1px dashed #e8e6df",background:ok?"#f3f8f3":"#fffdf3"}}></td>}
                    {advanced&&<td style={{borderBottom:"1px dashed #e8e6df",borderRight:"1.5px solid #e8e6df",background:ok?"#f3f8f3":"#fffdf3"}}></td>}
                    {wks.map(function(w){
                      var hit=pq.due&&w<=pq.due&&pq.due<=(function(){var d=new Date(w);d.setDate(d.getDate()+6);return toISO(d);})();
                      return <td key={w} style={{borderBottom:"1px dashed #e8e6df",borderLeft:"1px solid #f5f4f0",height:14,textAlign:"center",fontSize:8,
                        background:ok?"#f3f8f3":"#fffdf3",color:ok?"#2e7d32":"#f57f17"}}>{hit?"◆":""}</td>;
                    })}
                  </tr>;
                })}
                <tr data-rowid={row.id} className={"sched-row"+(panelRowId===row.id?" sched-row-on":"")}
                  onContextMenu={function(e){
                    if(dragRef.current||longPressRef.current){e.preventDefault();return;}
                    if(canEdit===false)return;
                    e.preventDefault();
                    setCtxMenu({rowId:row.id,x:e.clientX,y:e.clientY});
                  }}
                  style={{background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff"}}>
                  <td style={{position:"sticky",left:0,zIndex:1,background:(drag&&drag.type==="link"&&drag.target===row.id)?"#d6e6fb":panelRowId===row.id?(isSection?"#3a3f4b":"#fff3cd"):focusRow===row.id?"#fff8e1":isSel?"#e8f0fe":isSection?"var(--ink,#16181d)":isCat?"#f0ede6":"#fff",padding:isSection?"5px 10px":"3px 10px",borderBottom:isSection?"1.5px solid var(--ink,#16181d)":"1px solid #f5f4f0",borderRight:"1.5px solid #e8e6df",boxShadow:focusRow===row.id?"inset 3px 0 0 #f57f17":onCrit?"inset 3px 0 0 var(--amber,#b35c00)":(critPath&&critPath.zeroFloat[row.id])?"inset 3px 0 0 #e6c48c":"none"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3}}>
                      {canEdit&&!isCat&&<input type="checkbox" className="sched-noprint" checked={isSel}
                        onChange={function(){}} onClick={function(e){clickSelRow(row.id,e);}}
                        title="Select this task for bulk editing — Shift+click selects a range" style={{width:12,height:12,flexShrink:0,cursor:"pointer",marginRight:2}}/>}
                      {isCat&&<button className="sched-noprint" onClick={function(){toggleCat(row.id);}}
                        title={collapsed?"Expand this room":"Collapse this room"}
                        style={{background:"none",border:"none",cursor:"pointer",color:"#888",fontSize:10,padding:"0 2px",flexShrink:0,fontWeight:800}}>{collapsed?"▸":"▾"}</button>}
                      {canEdit&&<span className="sched-noprint" style={{display:"flex",flexDirection:"column",flexShrink:0,lineHeight:0.8}}>
                        <button onClick={function(){moveRow(row.id,-1);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:8,padding:0}} title="Move up">▲</button>
                        <button onClick={function(){moveRow(row.id,1);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc",fontSize:8,padding:0}} title="Move down">▼</button>
                      </span>}
                      {(function(){
                        var nameStyle={flex:1,minWidth:120,fontSize:isSection?12.5:isCat?12:11,fontWeight:isSection?800:isCat?700:500,
                          letterSpacing:isSection?".08em":"normal",textTransform:isCat?"uppercase":"none",
                          color:isSection?"#fff":rowDocs.length>0?"#1a73e8":isCat?"#555":"#333",
                          padding:"2px 0",paddingLeft:isCat?0:12,fontFamily:"inherit"};
                        if(canEdit&&editRowId===row.id){
                          return <SchedBufInput type="text" value={row.label||""}
                            onCommit={function(v){updRow(row.id,{label:v});}}
                            onEnter={function(v){
                              // Enter on a task just created: keep its name AND open the next line, in one write
                              if(isCat||justInsertedRef.current!==row.id||!String(v).trim())return false;
                              insertTaskAfter(row.id,{label:v});
                              return true;
                            }}
                            onDone={function(v){
                              setEditRowId(function(cur){return cur===row.id?null:cur;});
                              // a line just opened and left empty (Esc, click away) is not kept
                              if(justInsertedRef.current===row.id&&!String(v||"").trim()&&!row.label){
                                justInsertedRef.current="";
                                upd(sc.id,{rows:(sc.rows||[]).filter(function(r){return r.id!==row.id;})});
                              }
                            }}
                            elRef={function(el){if(el&&document.activeElement!==el){el.focus();if(el.select)el.select();}}}
                            placeholder={isCat?"Category name…":"Task name… (Enter: next task)"}
                            style={Object.assign({},nameStyle,{border:"1px solid #c9a84c",borderRadius:4,background:"#fff",color:"#333",outline:"none",padding:"1px 4px"})}/>;
                        }
                        return <span
                          onClick={function(e){
                            if((e.shiftKey||e.ctrlKey||e.metaKey)&&!isCat&&canEdit){clickSelRow(row.id,e);return;}
                            setCtxMenu(null);
                            setPanelRowId(row.id);
                          }}
                          onDoubleClick={function(){if(canEdit){justInsertedRef.current="";setEditRowId(row.id);}}}
                          title={(row.label||"(untitled)")+"\nClick: details · Double-click: rename · Right-click: menu"}
                          style={Object.assign({},nameStyle,{cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                            textDecoration:rowDocs.length>0&&!isSection?"underline":"none",userSelect:"none"})}>
                          {row.label||<i style={{fontWeight:400,color:isSection?"#aaa":"#bbb"}}>{isCat?"(unnamed room)":"(unnamed task)"}</i>}
                        </span>;
                      })()}
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
                      {isCat&&collapsed&&(function(){
                        var all=(sc.rows||[]);var i=all.findIndex(function(r){return r.id===row.id;});
                        var n=0;for(var j=i+1;j<all.length&&all[j].kind!=="category";j++)n++;
                        return n>0?<span style={{fontSize:9,color:"#888",fontStyle:"italic",flexShrink:0}}>({n} task{n!==1?"s":""})</span>:null;
                      })()}
                      {(function(){
                        var n=(tasks||[]).filter(function(t){return t.scheduleRowRef===row.id&&t.status!=="done";}).length;
                        return n>0?<span className="sched-noprint" onClick={function(){setPanelRowId(row.id);}} title={n+" open action"+(n!==1?"s":"")+" linked — open the details"}
                          style={{fontSize:9,fontWeight:800,color:"#1a73e8",background:"#e8f0fe",borderRadius:8,padding:"0 5px",flexShrink:0,cursor:"pointer"}}>⚑{n}</span>:null;
                      })()}
                    </div>
                  </td>
                  <td className="sched-noprint" style={{padding:"3px 6px",borderBottom:"1px solid #f5f4f0",borderRight:"1.5px solid #e8e6df",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3,flexWrap:"nowrap"}}>
                      {activeBl&&(function(){
                        if(isCat){
                          var rv=blRoll[row.id];
                          if(rv===undefined||rv<=0)return null;
                          return <span title={"Latest finish in this "+(isSection?"section":"room")+" is "+rv+" week"+(rv!==1?"s":"")+" behind the baseline"}
                            style={{fontFamily:"var(--font-mono)",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:8,flexShrink:0,cursor:"help",background:"#fce4ec",color:"#c62828"}}>+{rv}w</span>;
                        }
                        var bb=blBadge(blVar[row.id]);
                        if(!bb)return null;
                        return <span title={bb.tip} style={{fontFamily:"var(--font-mono)",fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:8,flexShrink:0,cursor:"help",background:bb.bg,color:bb.c}}>{bb.t}</span>;
                      })()}
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
                      {isCat&&(function(){var pg=rowProgress(row);return pg===null?null:<span style={{fontSize:9,fontWeight:800,padding:"1px 5px",borderRadius:8,flexShrink:0,background:pg>=100?"#e8f5e9":"#f5f4f0",color:pg>=100?"#2e7d32":"#888"}}>{pg}%</span>;})()}
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
                        onClick={function(){setPanelRowId(row.id);}}
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
                    </div>
                  </td>
                  <td style={{padding:"3px 6px",borderBottom:"1px solid #f5f4f0",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap"}}>
                    {isCat
                      ?(function(){
                        var td0=row.tenderRef?tenderById[row.tenderRef]:null;
                        if(!td0)return <span style={{color:isSection?"#555":"#ddd",fontSize:10}}>—</span>;
                        var aw0=tenderAwardees(td0);
                        return <span onClick={function(){setPanelRowId(row.id);}}
                          title={"Tender of this "+(isSection?"section":"room")+": "+td0.title+"\nUsed by every task below that has no tender of its own"+(aw0.length?"\nAwarded to "+aw0.join(", "):"\nNot awarded yet")}
                          style={{display:"inline-block",maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",verticalAlign:"middle",
                            fontSize:9.5,fontWeight:700,cursor:"pointer",color:isSection?"#cfcac0":"#00695c"}}>📑 {aw0.length?aw0.join(" / "):td0.title}</span>;
                      })()
                      :canEdit
                        ?<div style={{display:"flex",alignItems:"center",gap:3}}>
                        <span className="sched-noprint" title="Choose a colour for this task or for the whole subcontractor"
                          onClick={function(){setColorRowId(colorRowId===row.id?null:row.id);}}
                          style={{width:11,height:11,borderRadius:3,flexShrink:0,cursor:"pointer",background:planColor(row),border:"1px solid rgba(0,0,0,.15)",boxShadow:row.color?"0 0 0 1.5px #1a73e8":"none"}}></span>
                        {subSelect(row)}
                        </div>
                        :<span style={{fontSize:10,fontWeight:rowGroup(row)?700:400,color:rowGroup(row)?"#00695c":"#ddd",fontStyle:rowSub(row).source==="pending"?"italic":"normal"}}>
                          <span style={{display:"inline-block",width:9,height:9,borderRadius:2,background:planColor(row),marginRight:4,border:"1px solid rgba(0,0,0,.15)"}}></span>
                          {rowGroup(row)||(rowSub(row).source==="pending"?"Tender pending":"—")}</span>}
                  </td>
                  {advanced&&<td style={{padding:"3px 6px",borderBottom:"1px solid #f5f4f0",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap",textAlign:"right"}}>
                    {isCat
                      ?(function(){
                        var t=catQty(row);
                        if(!t)return <span style={{color:isSection?"#555":"#ddd",fontSize:10}}>—</span>;
                        return <span title="Total of the tasks under this room — shown only when they all share the same unit"
                          style={{fontSize:10,fontWeight:800,cursor:"help",color:isSection?"#cfcac0":"#8d6e63"}}>
                          {fmtQty(t.qty)}<span style={{fontSize:8,fontWeight:600,color:isSection?"#8a867e":"#aaa"}}>{t.unit?" "+t.unit:""}</span>
                        </span>;
                      })()
                      :canEdit
                        ?<div className="sched-noprint" style={{display:"flex",alignItems:"center",gap:2,justifyContent:"flex-end"}}>
                          <SchedBufInput type="number" value={row.qty||""} onCommit={function(v){updRow(row.id,{qty:v});}} placeholder="—"
                            title="Quantity of work on this task — feeds the Rate column"
                            style={{width:46,padding:"2px 3px",fontSize:10,textAlign:"right",border:"1px solid "+(row.qty?"#e6c48c":"#e8e6df"),borderRadius:4,fontFamily:"inherit",fontWeight:row.qty?700:400,color:row.qty?"#b45309":"#bbb",background:"#fff"}}/>
                          <SchedBufInput type="text" value={row.unit||""} onCommit={function(v){updRow(row.id,{unit:v});}} placeholder="unit"
                            title="Unit — lm, m2, nr, t…"
                            style={{width:34,padding:"2px 3px",fontSize:9,border:"1px solid #e8e6df",borderRadius:4,fontFamily:"inherit",color:row.unit?"#888":"#ccc"}}/>
                        </div>
                        :<span style={{fontSize:10,fontWeight:700,color:row.qty?"#b45309":"#ddd"}}>{row.qty?fmtQty(Number(row.qty))+(row.unit?" "+row.unit:""):"—"}</span>}
                    {!isCat&&canEdit&&<span className="sched-printcell" style={{fontSize:10,fontWeight:700,color:"#b45309"}}>
                      {row.qty?fmtQty(Number(row.qty))+(row.unit?" "+row.unit:""):"—"}</span>}
                  </td>}
                  {advanced&&<td style={{padding:"3px 8px",borderBottom:"1px solid #f5f4f0",borderRight:"1.5px solid #e8e6df",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fff",whiteSpace:"nowrap",textAlign:"right"}}>
                    {(function(){
                      var sp=rowSpan(row);
                      if(isCat||!sp||sp.rate===null)return <span style={{color:isSection?"#555":"#ddd",fontSize:10}}>—</span>;
                      return <span title={"Quantity "+row.qty+" "+(row.unit||"")+" over "+sp.workingWeeks+" working week"+(sp.workingWeeks!==1?"s":"")+" ("+WORK_DAYS_PER_WEEK+" working days a week)"+(sp.derived?" — span read from the planned bars ("+fmtDate(sp.startWeek)+" → "+fmtDate(sp.endWeek)+")":"")}
                        style={{display:"inline-block",lineHeight:1.2,cursor:"help",color:sp.derived?"#8d6e63":"#b45309",borderBottom:sp.derived?"1px dotted #bcaaa4":"none"}}>
                        <span style={{display:"block",fontSize:10,fontWeight:800}}>
                          {fmtQty(sp.rate)}<span style={{fontSize:8,color:"#aaa",fontWeight:600}}>{row.unit?" "+row.unit:""}/wk</span>
                        </span>
                        <span style={{display:"block",fontSize:9,fontWeight:700,opacity:.75}}>
                          {fmtQty(sp.ratePerDay)}<span style={{fontSize:8,color:"#aaa",fontWeight:600}}>{row.unit?" "+row.unit:""}/day</span>
                        </span>
                      </span>;
                    })()}
                  </td>}
                  {wks.map(function(wk){
                    var v=shownCells[wk]||"";
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
                    if(stroke&&stroke.rowId===row.id&&!hol){
                      var sA=stroke.from<stroke.to?stroke.from:stroke.to,sB=stroke.from<stroke.to?stroke.to:stroke.from;
                      if(wk>=sA&&wk<=sB)v=paintedValue(v,stroke.erase);
                    }
                    var wpVal=(row.weekProgress||{})[wk];
                    var hasWp=wpVal!==undefined&&wpVal!==null&&wpVal!=="";
                    // Procurement is late: mark the first week the task could actually start,
                    // and hatch every planned week sitting before the delivery date.
                    var isFeasible=rowRisk&&rowRisk.feasible===wk;
                    var featCol=rowRisk?(rowRisk.late?"#e65100":rowRisk.tight?"#f9a825":"#7cb342"):"#e65100";
                    var beforeDelivery=rowRisk&&rowRisk.late&&rowRisk.feasible&&wk<rowRisk.feasible&&(v==="plan"||v==="both");
                    return <td key={wk}
                      onClick={function(){
                        if(isCat||hol||paintMode!=="progress")return;
                        var cur=hasWp?String(wpVal):"";
                        var input=window.prompt("Progress reached at week of "+fmtDate(wk)+" (%)\nLeave empty to clear:",cur);
                        if(input===null)return;
                        setWeekProgress(row,wk,input.trim());
                      }}
                      onPointerDown={function(e){
                        if(isCat||hol||paintMode==="progress")return;
                        if(e.button!==undefined&&e.button!==0)return;
                        if(canEdit===false){if(e.pointerType==="mouse")safeAlert("Only the zone leaders can modify this schedule.");return;}
                        if(e.pointerType==="touch"){
                          // a finger scrolls the grid; holding it still 0.3 s starts painting instead
                          clearLongPress();
                          var erase=strokeErases(row,wk);
                          longPressRef.current={x0:e.clientX,y0:e.clientY,timer:setTimeout(function(){
                            longPressRef.current=null;
                            try{if(navigator.vibrate)navigator.vibrate(12);}catch(err){}
                            startDrag({type:"paint",rowId:row.id,from:wk,to:wk,erase:erase});
                          },300)};
                          return;
                        }
                        e.preventDefault();     // no text selection while dragging
                        var real=(row.cells||{})[wk];
                        if(e.shiftKey&&(real==="plan"||real==="both")){startDrag({type:"move",rowId:row.id,from:wk,to:wk});return;}
                        startDrag({type:"paint",rowId:row.id,from:wk,to:wk,erase:strokeErases(row,wk)});
                      }}
                      onPointerMove={function(e){
                        var lp=longPressRef.current;
                        if(lp&&(Math.abs(e.clientX-lp.x0)>8||Math.abs(e.clientY-lp.y0)>8))clearLongPress();
                      }}
                      onPointerUp={function(){
                        // a quick tap with a finger paints one week, like a click
                        if(!longPressRef.current)return;
                        clearLongPress();
                        if(!isCat&&!hol&&paintMode!=="progress"&&canEdit!==false)toggleCell(row,wk);
                      }}
                      onPointerCancel={clearLongPress}
                      data-wk={wk}
                      title={hol?"Neutralised week":hasWp?"Progress at this week: "+wpVal+"%":(paintMode==="progress"?"Click to record progress % for this week":(v==="plan"||v==="both")?"Drag along the row to paint or erase · Shift+drag to move the whole task":"Click, or drag along the row to paint several weeks")}
                      style={Object.assign({position:"relative",borderBottom:"1px solid #f5f4f0",borderLeft:"1px solid #f0ede6",cursor:(isCat||hol)?"default":"pointer",height:22,padding:0,textAlign:"center",fontSize:8,fontWeight:800,color:"#fff",textShadow:"0 0 2px rgba(0,0,0,.5)",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none"},
                        hol?{background:"repeating-linear-gradient(45deg,#e8e4da,#e8e4da 3px,#dcd8ce 3px,#dcd8ce 6px)"}:cellStyle(v,row),
                        beforeDelivery?{background:"repeating-linear-gradient(45deg,#ef9a9a,#ef9a9a 3px,#e57373 3px,#e57373 6px)"}:null,
                        isFeasible?{boxShadow:"inset 0 0 0 2px "+featCol}:null)}>
                      {hasWp?wpVal:isFeasible?<span title={"🚚 Delivery "+fmtDate(rowRisk.delivery)+" — earliest possible start"} style={{color:v?"#fff":featCol,fontSize:10,fontWeight:900,textShadow:v?"0 0 3px rgba(0,0,0,.7)":"none"}}>▶</span>:""}
                      {activeBl&&!isCat&&blWeekSet[row.id]&&blWeekSet[row.id][wk]&&<span className="sched-noprint" title={"Baseline “"+activeBl.name+"”"}
                        style={{position:"absolute",left:0,right:0,bottom:1,height:4,background:"#546e7a",opacity:.75,pointerEvents:"none"}}></span>}
                      {canEdit&&!drag&&wk===lastPlanWk&&<span className="sched-noprint sched-link-handle"
                        onPointerDown={function(e){
                          e.stopPropagation();e.preventDefault();clearLongPress();
                          var r0=e.currentTarget.getBoundingClientRect();
                          var cx=r0.left+r0.width/2,cy=r0.top+r0.height/2;
                          startDrag({type:"link",rowId:row.id,x0:cx,y0:cy,x:cx,y:cy,target:""});
                        }}
                        title="Drag onto another task: that task will start after this one"
                        style={{position:"absolute",right:-6,top:"50%",transform:"translateY(-50%)",width:12,height:12,borderRadius:"50%",
                          background:"#fff",border:"2.5px solid #1a73e8",cursor:"crosshair",zIndex:1,boxSizing:"border-box",touchAction:"none"}}></span>}
                    </td>;
                  })}
                </tr></React.Fragment>;
              })}
            </tbody>
          </table>
          {showLinks&&arrowGeo.length>0&&<svg className="sched-noprint" style={{position:"absolute",left:0,top:0,width:"100%",height:"100%",overflow:"visible",pointerEvents:"none",zIndex:0}}>
            <defs>
              <marker id="sched-arr-ok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8f8a7e"/></marker>
              <marker id="sched-arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#c62828"/></marker>
            </defs>
            {arrowGeo.map(function(g){
              var d=arrowPath(g);
              return <g key={g.id}>
                <path className="sched-link-hit" d={d} fill="none" stroke="transparent" strokeWidth={14}
                  style={{pointerEvents:canEdit?"stroke":"none",cursor:"grab",touchAction:"none"}}
                  onPointerDown={function(e){
                    if(e.button!==undefined&&e.button!==0)return;
                    e.stopPropagation();e.preventDefault();
                    setLinkMenu(null);
                    var succ=rowById(g.id);
                    startDrag({type:"relink",rowId:g.id,predId:succ?succ.afterId:"",x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,target:""});
                  }}>
                  <title>{g.label+(g.bad?"\n⚠ starts before the previous task ends":"")+(canEdit?"\nClick: options · Drag onto another task: move the link to it":"")}</title>
                </path>
                <path className="sched-link-line" d={d} fill="none" stroke={g.bad?"#c62828":"#8f8a7e"} strokeWidth={g.bad?1.8:1.2}
                  strokeDasharray={g.bad?"4 3":"none"} markerEnd={"url(#"+(g.bad?"sched-arr-bad":"sched-arr-ok")+")"} style={{pointerEvents:"none"}}/>
              </g>;
            })}
          </svg>}
          </div>
        </div>}
        {/* The schedule scrollbar sits at the bottom of a 62vh box, so it was only reachable
            after scrolling the page. This mirror stays pinned to the bottom of the viewport
            and drives the real one, both ways. */}
        {!monthView&&<div className="sched-noprint sched-mirror" ref={mirrorRef} onScroll={function(){syncScroll("mirror");}}
          style={{display:mirrorBox.show&&!panelRowId?"block":"none",position:"fixed",left:mirrorBox.left,width:mirrorBox.width,
            bottom:12,zIndex:1250,overflowX:"auto",overflowY:"hidden",height:18,
            background:"#faf9f6",border:"1px solid #e8e6df",borderRadius:9,
            boxShadow:"0 2px 10px rgba(0,0,0,.12)"}}>
          <div style={{width:schedScrollW,height:1}}></div>
        </div>}

        {printPlan&&(function(){
          var pw=printWeeksOf(wks,printPlan);
          var nSheets=printPlan.sheets>0?printPlan.sheets:Math.max(1,Math.ceil(pw.length/26));
          var per=Math.max(1,Math.ceil(pw.length/nSheets));
          var chunks=[];
          for(var i=0;i<pw.length;i+=per)chunks.push(pw.slice(i,i+per));
          var pfs=per>30?6:7;
          return <div className="sched-print-only">
            <style>{"@media print{@page{size:"+(printPlan.size==="A3"?"A3":"A4")+" landscape;margin:8mm}.sched-print-only *{-webkit-print-color-adjust:exact;print-color-adjust:exact}}"}</style>
            {chunks.map(function(ck,ci){
              return <div key={ci} style={{pageBreakAfter:ci<chunks.length-1?"always":"auto",marginBottom:12}}>
                <table style={{borderCollapse:"collapse",width:"100%",tableLayout:"fixed",fontSize:pfs}}>
                  <colgroup><col style={{width:150}}/><col style={{width:60}}/><col style={{width:40}}/><col style={{width:48}}/>{ck.map(function(w){return <col key={w}/>;})}</colgroup>
                  <thead style={{display:"table-header-group"}}>
                    <tr>
                      <th colSpan={4} style={{border:"1px solid #999",padding:"2px 3px",textAlign:"left",fontSize:7,background:"#f0ede6"}}>
                        {sc.title} · {curZone}{fGroup?" · "+fGroup:""} — sheet {ci+1}/{chunks.length}
                      </th>
                      <th colSpan={ck.length} style={{border:"1px solid #999",padding:"2px 3px",textAlign:"left",fontSize:7,background:"#f0ede6"}}>
                        {fmtDate(ck[0])} → {fmtDate(ck[ck.length-1])}
                      </th>
                    </tr>
                    <tr>
                      <th style={{border:"1px solid #999",padding:"2px 3px",textAlign:"left",width:150}}>Task</th>
                      <th style={{border:"1px solid #999",padding:"2px 3px",textAlign:"left",width:60}}>Subcont.</th>
                      <th style={{border:"1px solid #999",padding:"2px 3px",textAlign:"right",width:40}}>Qty</th>
                      <th style={{border:"1px solid #999",padding:"2px 3px",textAlign:"right",width:48}}>Rate</th>
                      {ck.map(function(w){return <th key={w} style={{border:"1px solid #999",padding:"2px 1px",width:16}}>{fmtDate(w).slice(0,5)}</th>;})}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(function(r){
                      var cat=r.kind==="category";
                      var risk=(!cat&&printPlan.risks)?procRisk(r):null;
                      return <tr key={r.id} style={{pageBreakInside:"avoid"}}>
                        <td style={{border:"1px solid #999",padding:"2px 3px",fontWeight:cat?800:400,background:cat?"#eee":"#fff",wordBreak:"break-word"}}>
                          {cat?"":"   "}{r.label}
                          {risk&&risk.late?" 🔴":risk&&risk.tight?" 🟠":""}
                        </td>
                        <td style={{border:"1px solid #999",padding:"2px 3px",background:cat?"#eee":"#fff"}}>{cat?"":(rowGroup(r)||"")}</td>
                        <td style={{border:"1px solid #999",padding:"2px 3px",textAlign:"right",background:cat?"#eee":"#fff"}}>
                          {(function(){
                            if(cat){var t=catQty(r);return t?fmtQty(t.qty)+(t.unit?" "+t.unit:""):"";}
                            var q=Number(r.qty);
                            return (r.qty===""||r.qty===undefined||isNaN(q))?"":fmtQty(q)+(r.unit?" "+r.unit:"");
                          })()}
                        </td>
                        <td style={{border:"1px solid #999",padding:"2px 3px",textAlign:"right",background:cat?"#eee":"#fff"}}>
                          {(function(){
                            if(cat)return "";
                            var sp=rowSpan(r);
                            if(!sp||sp.rate===null)return "";
                            return fmtQty(sp.rate)+"/wk · "+fmtQty(sp.ratePerDay)+"/d";
                          })()}
                        </td>
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
          <div onClick={function(e){e.stopPropagation();}} style={{background:"#fff",borderRadius:14,padding:"20px 22px",width:430,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:18,marginBottom:3}}>Print the schedule</div>
            <div style={{fontSize:11,color:"#aaa",marginBottom:14}}>{wks.length} weeks · {visibleRows.filter(function(r){return r.kind!=="category";}).length} tasks{fGroup?" · filtered on "+fGroup:""}</div>

            {(function(){
              var pw=printWeeksOf(wks,printOpts);
              var nS=printOpts.sheets>0?printOpts.sheets:Math.max(1,Math.ceil(pw.length/26));
              var per=Math.max(1,Math.ceil(pw.length/nS));
              var sel={fontSize:12,padding:"5px 8px",border:"1.5px solid #e0ddd4",borderRadius:7,fontFamily:"inherit",background:"#fff"};
              var lbl={fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:6};
              function up(p){setPrintOpts(Object.assign({},printOpts,p));}
              return <div>
                <div style={lbl}>Period</div>
                <select value={printOpts.range} onChange={function(e){up({range:e.target.value});}} style={Object.assign({},sel,{width:"100%",marginBottom:8})}>
                  <option value="all">Whole schedule</option>
                  <option value="custom">Custom period</option>
                </select>
                {printOpts.range==="custom"&&<div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:11,color:"#888"}}>From</span>
                  <input type="date" value={printOpts.from} onChange={function(e){up({from:e.target.value});}} style={Object.assign({},sel,{flex:1})}/>
                  <span style={{fontSize:11,color:"#888"}}>To</span>
                  <input type="date" value={printOpts.to} onChange={function(e){up({to:e.target.value});}} style={Object.assign({},sel,{flex:1})}/>
                </div>}
                <div style={{display:"flex",gap:10,marginBottom:10}}>
                  <div style={{flex:1}}>
                    <div style={lbl}>Paper (landscape)</div>
                    <select value={printOpts.size} onChange={function(e){up({size:e.target.value});}} style={Object.assign({},sel,{width:"100%"})}>
                      <option value="A4">A4</option><option value="A3">A3</option>
                    </select>
                  </div>
                  <div style={{flex:1}}>
                    <div style={lbl}>Sheets</div>
                    <select value={printOpts.sheets} onChange={function(e){up({sheets:Number(e.target.value)});}} style={Object.assign({},sel,{width:"100%"})}>
                      <option value={0}>Automatic</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                    </select>
                  </div>
                </div>
                <div style={{fontSize:12,color:pw.length?"#555":"#c62828",marginBottom:16,padding:"8px 10px",background:pw.length?"#f8f7f4":"#fdecea",borderRadius:8}}>
                  {pw.length?pw.length+" week"+(pw.length!==1?"s":"")+" · "+nS+" sheet"+(nS!==1?"s":"")+" · "+per+" weeks across · "+printOpts.size+" landscape"+(pw.length?" · "+fmtDate(pw[0])+" → "+fmtDate(pw[pw.length-1]):""):"No week in this period — check From and To."}
                </div>
              </div>;
            })()}

            <label style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",textTransform:"none",letterSpacing:"normal",marginBottom:10,color:"#333"}}>
              <input type="checkbox" checked={printOpts.risks} onChange={function(e){setPrintOpts(Object.assign({},printOpts,{risks:e.target.checked}));}} style={{width:14,height:14,marginTop:2}}/>
              <span style={{fontSize:12,fontWeight:600}}>Procurement impact<br/><span style={{fontSize:10,fontWeight:400,color:"#aaa"}}>delivery arrows, red hatching and the ⇢ week</span></span>
            </label>
            <label style={{display:"flex",gap:8,alignItems:"flex-start",cursor:"pointer",textTransform:"none",letterSpacing:"normal",marginBottom:16,color:"#333"}}>
              <input type="checkbox" checked={printOpts.progress} onChange={function(e){setPrintOpts(Object.assign({},printOpts,{progress:e.target.checked}));}} style={{width:14,height:14,marginTop:2}}/>
              <span style={{fontSize:12,fontWeight:600}}>Weekly progress figures<br/><span style={{fontSize:10,fontWeight:400,color:"#aaa"}}>the numbers written inside the bars</span></span>
            </label>

            <div style={{fontSize:10,color:"#aaa",marginBottom:14}}>Landscape is set automatically; each sheet fits the page width. Task and Subcont. columns are repeated on every sheet. Tick <b>Background graphics</b> if the bars come out white.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn btn-sm" onClick={function(){setPrintOpts(null);}}>Cancel</button>
              <button className="btn btn-sm btn-pri" disabled={printWeeksOf(wks,printOpts).length===0} onClick={function(){runPrint(printOpts);}}>🖨 Print</button>
            </div>
          </div>
        </div>}
        {colorRowId&&<div className="sched-noprint" onClick={function(){setColorRowId(null);}} style={{position:"fixed",inset:0,zIndex:940}}></div>}
        {colorRowId&&(function(){
          var row=(sc.rows||[]).find(function(r){return r.id===colorRowId;});
          if(!row)return null;
          var grp=rowGroup(row);
          function setTask(hex){updRow(row.id,{color:hex});}
          function setGroup(hex){
            var gc=Object.assign({},(sc.groupColors)||{});
            if(hex)gc[grp]=hex;else delete gc[grp];
            upd(sc.id,{groupColors:gc});
          }
          return <div className="sched-noprint" style={{position:"fixed",zIndex:950,left:"50%",top:"50%",transform:"translate(-50%,-50%)",
            background:"#fff",border:"1.5px solid #e8e6df",borderRadius:12,boxShadow:"0 16px 50px rgba(0,0,0,.25)",padding:"16px 18px",width:330}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>Colour — {row.label||"task"}</div>
            <div style={{fontSize:10,color:"#aaa",marginBottom:12}}>Planned bars only. Actual bars stay blue everywhere.</div>

            {grp&&<div style={{marginBottom:14}}>
              <div style={{fontSize:10,fontWeight:800,color:"#888",textTransform:"uppercase",marginBottom:6}}>All tasks of {grp} — this schedule</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {SCHED_PALETTE.map(function(c){
                  var on=((sc.groupColors)||{})[grp]===c.hex;
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

            {!grp&&<div style={{fontSize:10,color:"#bbb",marginTop:10}}>Assign a subcontractor to colour all of its tasks at once.</div>}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
              <button className="btn btn-sm" onClick={function(){setColorRowId(null);}}>Done</button>
            </div>
          </div>;
        })()}
        {panelRowId&&(function(){
          var row=rowById(panelRowId);
          if(!row)return null;
          var isSection=row.kind==="section",isCat=row.kind==="category"||isSection;
          var sp=isCat?null:rowSpan(row);
          var linked=(tasks||[]).filter(function(t){return t.scheduleRowRef===row.id;});
          var candidates=(tasks||[]).filter(function(t){return t.zone===curZone&&!t.scheduleRowRef&&t.status!=="done";});
          var allRows=sc.rows||[];
          var rIdx=allRows.findIndex(function(r){return r.id===row.id;});
          // the room (category) and section the row sits in
          var myCat=null,mySec=null;
          for(var k=rIdx-(isCat?1:0);k>=0;k--){
            var rk=allRows[k];
            if(k===rIdx)continue;
            if(rk.kind==="category"&&!myCat&&!isCat)myCat=rk;
            if(rk.kind==="section"){mySec=rk;break;}
          }
          if(row.kind==="category")myCat=null;
          var inh=isCat?(row.kind==="category"&&mySec&&mySec.tenderRef?{header:mySec,tenderId:mySec.tenderRef}:null)
            :(myCat&&myCat.tenderRef?{header:myCat,tenderId:myCat.tenderRef}:mySec&&mySec.tenderRef?{header:mySec,tenderId:mySec.tenderRef}:null);
          var inherits=!isCat&&row.tenderFromHeader&&row.tenderFromHeader!=="-";
          var tenderVal=isCat?(row.tenderRef||""):inherits&&inh?"__inherit__":row.tenderFromHeader==="-"?"__none__":(row.tenderRef||"");
          var tdCur=row.tenderRef?tenderById[row.tenderRef]:null;
          var ls=isCat?null:linkState(row);
          var followers=isCat?[]:allRows.filter(function(r){return r.afterId===row.id;});
          // tasks under a header, for its summary line
          var below=[];
          if(isCat){
            for(var b=rIdx+1;b<allRows.length;b++){
              var rb=allRows[b];
              if(rb.kind==="section")break;
              if(row.kind==="category"&&rb.kind==="category")break;
              if(rb.kind!=="category")below.push(rb);
            }
          }
          var lbl={fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase",display:"block",marginBottom:3};
          var sec={padding:"11px 14px",borderBottom:"1px solid #eee9dd"};
          var secH={fontSize:10,fontWeight:800,color:"#6f6b62",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8};
          var roomsOfZone=(rooms||[]).filter(function(rm){return rm.zone===curZone;});
          function tenderOptions(){
            var q=qTender.trim().toLowerCase();
            var list=(tenders||[]).filter(function(t){
              if(!q)return true;
              var aw=tenderAwardees(t).join(" ");
              return ((t.title||"")+" "+(t.package||"")+" "+aw).toLowerCase().indexOf(q)>=0;
            });
            var byPkg={};
            list.forEach(function(t){var p=t.package||"— no package —";(byPkg[p]=byPkg[p]||[]).push(t);});
            return Object.keys(byPkg).sort().map(function(p){
              return <optgroup key={p} label={p+" ("+byPkg[p].length+")"}>
                {byPkg[p].slice().sort(function(a,b2){return(a.title||"").localeCompare(b2.title||"");})
                  .map(function(t){var aw=tenderAwardees(t);return <option key={t.id} value={t.id}>{t.title}{aw.length?" — "+aw.join(" / "):""}</option>;})}
              </optgroup>;
            });
          }
          function setTender(v){
            if(isCat){updRow(row.id,{tenderRef:v==="__none__"?"":v});return;}
            if(v==="__inherit__"||v==="")updRow(row.id,{tenderRef:"",tenderFromHeader:""});
            else if(v==="__none__")updRow(row.id,{tenderRef:"",tenderFromHeader:"-"});
            else updRow(row.id,{tenderRef:v,tenderFromHeader:""});
          }
          // "Starts after" candidates: tasks only, never one that would close a loop
          var afterOpts=(function(){
            var q=qAfter.trim().toLowerCase();
            var groups=[],cur=null,room="";
            allRows.forEach(function(r){
              if(r.kind==="section"){room="";cur=null;return;}
              if(r.kind==="category"){room=r.label||"(room)";cur=null;return;}
              if(r.id===row.id)return;
              if(r.id!==row.afterId&&linkMakesLoop(allRows,r.id,row.id))return;
              if(q&&((r.label||"")+" "+room).toLowerCase().indexOf(q)<0&&r.id!==row.afterId)return;
              if(!cur||cur.room!==room){cur={room:room,items:[]};groups.push(cur);}
              cur.items.push(r);
            });
            return groups;
          })();
          return <div className="sched-noprint" onClick={function(e){e.stopPropagation();}}
            style={{position:"fixed",top:0,right:0,bottom:0,width:400,maxWidth:"100vw",zIndex:800,background:"#fff",
              borderLeft:"1.5px solid #e0ddd6",boxShadow:"-10px 0 36px rgba(0,0,0,.18)",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"12px 14px",borderBottom:"1.5px solid #e8e6df",background:isSection?"#2b2e36":isCat?"#f0ede6":"#fffdf0",display:"flex",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:isSection?"#cfcac0":"#9b968b",marginBottom:3}}>
                  {isSection?"Section":isCat?"Room / category":"Task"}{!isCat&&myCat?" · "+(myCat.label||"room"):""}{mySec&&!isSection?" · "+(mySec.label||"section"):""}
                </div>
                {canEdit
                  ?<SchedBufInput type="text" value={row.label||""} onCommit={function(v){updRow(row.id,{label:v});}}
                    placeholder={isCat?"Room name…":"Task name…"}
                    style={{width:"100%",fontSize:15,fontWeight:700,padding:"3px 6px",border:"1px solid #e0ddd6",borderRadius:5,
                      background:isSection?"#3a3f4b":"#fff",color:isSection?"#fff":"#16181d",fontFamily:"inherit"}}/>
                  :<div style={{fontSize:15,fontWeight:700,color:isSection?"#fff":"#16181d"}}>{row.label||"(untitled)"}</div>}
              </div>
              <button className="btn btn-sm" onClick={function(){setPanelRowId(null);}} title="Close (Esc)">✕</button>
            </div>

            <div style={{flex:1,overflowY:"auto",overscrollBehavior:"contain"}}>
              {/* ---- Tender & company ---- */}
              <div style={sec}>
                <div style={secH}>{isCat?"Tender for the tasks below":"Tender & subcontractor"}</div>
                <input type="text" value={qTender} onChange={function(e){setQTender(e.target.value);}}
                  placeholder="🔎 search tender, package or company…" style={{padding:"4px 8px",fontSize:11,marginBottom:4,width:"100%"}}/>
                <select value={tenderVal} disabled={!canEdit} onChange={function(e){setTender(e.target.value);}}
                  size={qTender.trim()?8:1} style={{padding:"5px 7px",fontSize:12,width:"100%"}}>
                  {!isCat&&inh&&<option value="__inherit__">↳ From {inh.header.label||"header"}: {(tenderById[inh.tenderId]||{}).title||"tender"}</option>}
                  <option value={!isCat&&inh?"__none__":""}>— no tender —</option>
                  {tenderOptions()}
                </select>
                {isCat&&<div style={{fontSize:10,color:"#888",marginTop:5,lineHeight:1.45}}>
                  {row.tenderRef
                    ?"Used by every task below that has no tender of its own"+(below.length?" — "+below.filter(function(r){return r.tenderFromHeader===row.id;}).length+" of "+below.length+" task"+(below.length!==1?"s":"")+" follow it.":".")
                    :"Set a tender here and the "+below.length+" task"+(below.length!==1?"s":"")+" below without one will all point at it."}
                  {row.kind==="category"&&inh&&!row.tenderRef?" Otherwise they follow the section: "+((tenderById[inh.tenderId]||{}).title||"")+".":""}
                </div>}
                {!isCat&&inherits&&inh&&<div style={{fontSize:10,color:"#888",marginTop:5}}>Follows <b>{inh.header.label||"the header"}</b> — change it there to change every task of it at once.</div>}
                {tdCur&&<div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                  <span style={{fontSize:10,color:"#6f6b62",flex:1,minWidth:0}}>
                    {tenderAwardees(tdCur).length?<span>Awarded to <b>{tenderAwardees(tdCur).join(", ")}</b></span>:<i>Not awarded yet — the company fills itself in once the tender’s Awarded section names it.</i>}
                  </span>
                  {onNavTender&&<button className="btn btn-sm" style={{padding:"1px 7px",fontSize:10}} onClick={function(){onNavTender(tdCur.id);}} title="Open the tender sheet">📑 Open</button>}
                </div>}

                {!isCat&&<div style={{marginTop:10}}>
                  <label style={lbl}>Subcontractor</label>
                  {canEdit?subSelect(row,true):<div style={{fontSize:12}}>{rowGroup(row)||"—"}</div>}
                </div>}
                {!isCat&&canEdit&&<button className="btn btn-sm" style={{marginTop:8,padding:"2px 9px",fontSize:10,display:"flex",alignItems:"center",gap:6}}
                  onClick={function(){setColorRowId(row.id);}}>
                  <span style={{width:12,height:12,borderRadius:3,background:planColor(row),border:"1px solid rgba(0,0,0,.15)"}}></span>Colour…</button>}
              </div>

              {/* ---- Where ---- */}
              {(row.kind!=="section")&&<div style={sec}>
                <div style={secH}>Room</div>
                <select value={row.roomId||""} disabled={!canEdit} onChange={function(e){updRow(row.id,{roomId:e.target.value});}}
                  style={{padding:"5px 7px",fontSize:12,width:"100%",color:row.roomId?"#7b1fa2":"#888"}}>
                  <option value="">🚪 — no room —</option>
                  {roomsOfZone.map(function(rm){return <option key={rm.id} value={rm.id}>{rm.name}</option>;})}
                </select>
                {row.kind==="category"&&canEdit&&<select value="" onChange={function(e){if(e.target.value){copySequenceToRoom(row.id,e.target.value);e.target.value="";}}}
                  title="Copy this whole sequence onto another room (keeps links, clears durations)"
                  style={{padding:"5px 7px",fontSize:12,width:"100%",marginTop:6,color:"#1a73e8"}}>
                  <option value="">⧉ Copy this sequence to another room…</option>
                  {roomsOfZone.filter(function(rm){return rm.id!==row.roomId;}).map(function(rm){return <option key={rm.id} value={rm.id}>{rm.name}</option>;})}
                </select>}
              </div>}

              {/* ---- Timing ---- */}
              {!isCat&&<div style={sec}>
                <div style={secH}>Timing & links</div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <div style={{flex:1}}>
                    <label style={lbl}>Start week</label>
                    <select value={row.startWeek||spanFromCells(row.cells,wks,null).startWeek||""} disabled={!canEdit} onChange={function(e){applySpan(row,{startWeek:e.target.value});}} style={{padding:"4px 6px",fontSize:11,width:"100%"}}>
                      <option value="">—</option>
                      {wks.map(function(w){return <option key={w} value={w}>{fmtDate(w)}</option>;})}
                    </select>
                  </div>
                  <div style={{flex:1}}>
                    <label style={lbl}>End week</label>
                    <select value={row.endWeek||spanFromCells(row.cells,wks,null).endWeek||""} disabled={!canEdit} onChange={function(e){applySpan(row,{endWeek:e.target.value});}} style={{padding:"4px 6px",fontSize:11,width:"100%"}}>
                      <option value="">—</option>
                      {wks.map(function(w){return <option key={w} value={w}>{fmtDate(w)}</option>;})}
                    </select>
                  </div>
                </div>
                {canEdit&&<div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10}}>
                  <button className="btn btn-sm" onClick={function(){shiftRow(row.id,-1);}} title="Shift 1 week earlier — the tasks after it follow">◀ 1 wk</button>
                  <button className="btn btn-sm" onClick={function(){shiftRow(row.id,1);}} title="Shift 1 week later — the tasks after it follow">1 wk ▶</button>
                  <span style={{fontSize:10,color:"#9b968b"}}>the tasks after it follow</span>
                </div>}
                {activeBl&&(function(){
                  var v=blVar[row.id];
                  if(!v)return null;
                  return <div style={{marginBottom:10,padding:"6px 8px",borderRadius:6,fontSize:10.5,background:"#eceff1",color:"#37474f"}}>
                    📌 <b>{activeBl.name}</b>: {v.isNew?"not in this baseline (added since)"
                      :v.noPlan?fmtDate(v.bStart)+" → "+fmtDate(v.bEnd)+" — no planned week now"
                      :fmtDate(v.bStart)+" → "+fmtDate(v.bEnd)+" · start "+(v.start>0?"+":"")+v.start+" wk · finish "+(v.finish>0?"+":"")+v.finish+" wk"}
                  </div>;
                })()}

                <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <label style={lbl}>Starts after</label>
                    <input type="text" value={qAfter} onChange={function(e){setQAfter(e.target.value);}} placeholder="🔎 search a task…"
                      style={{padding:"4px 8px",fontSize:11,marginBottom:4,width:"100%"}}/>
                    <select value={row.afterId||""} disabled={!canEdit} size={qAfter.trim()?8:1}
                      onChange={function(e){
                        var v=e.target.value;
                        if(v&&linkMakesLoop(allRows,v,row.id)){safeAlert("This link would make a loop.");return;}
                        updRow(row.id,{afterId:v});
                        setQAfter("");
                      }}
                      style={{padding:"5px 7px",fontSize:12,width:"100%",color:row.afterId?"#1a73e8":"#888"}}>
                      <option value="">— nothing (free start) —</option>
                      {afterOpts.map(function(g,gi){
                        return <optgroup key={gi} label={g.room||"(no room)"}>
                          {g.items.map(function(r){return <option key={r.id} value={r.id}>{r.label||"(untitled)"}</option>;})}
                        </optgroup>;
                      })}
                    </select>
                  </div>
                  <div style={{width:74}}>
                    <label style={lbl} title="Weeks to wait after the previous task ends (curing, drying…)">Gap (wk)</label>
                    {canEdit
                      ?<SchedBufInput type="number" value={row.lagWeeks||""} placeholder="0"
                        onCommit={function(v){updRow(row.id,{lagWeeks:Math.max(0,Math.round(Number(v)||0))});}}
                        style={{padding:"5px 6px",fontSize:12,width:"100%"}}/>
                      :<div style={{fontSize:12}}>{row.lagWeeks||0}</div>}
                  </div>
                </div>
                {ls&&<div style={{marginTop:7,padding:"6px 8px",borderRadius:6,fontSize:10.5,display:"flex",alignItems:"center",gap:6,
                  background:ls.weeks<0?"#fce4ec":ls.weeks===0?"#e8f5e9":"#f5f4f0",color:ls.weeks<0?"#c62828":ls.weeks===0?"#2e7d32":"#6f6b62"}}>
                  <span style={{flex:1}}>
                    {ls.weeks<0
                      ?"🔴 Starts "+(-ls.weeks)+" week"+(-ls.weeks!==1?"s":"")+" too early: “"+(ls.pred.label||"untitled")+"”"+(Number(row.lagWeeks)?" + "+row.lagWeeks+" wk gap":"")+" allows "+(ls.earliestWeek?fmtDate(ls.earliestWeek):"a later week")
                      :ls.weeks===0
                        ?"✅ Starts right after “"+(ls.pred.label||"untitled")+"”"
                        :"⏸ "+ls.weeks+" week"+(ls.weeks!==1?"s":"")+" of slack after “"+(ls.pred.label||"untitled")+"”"}
                  </span>
                  {canEdit&&ls.weeks!==0&&ls.earliestWeek&&<button className="btn btn-sm" style={{padding:"1px 7px",fontSize:10,flexShrink:0}}
                    onClick={function(){moveAfterPredecessor(row);}}>{ls.weeks<0?"⇢ Move after it":"⇠ Pull back"}</button>}
                </div>}
                {followers.length>0&&<div style={{marginTop:7,fontSize:10.5,color:"#6f6b62"}}>
                  Followed by: {followers.map(function(f,fi){
                    return <span key={f.id}>{fi>0?", ":""}<a onClick={function(){setPanelRowId(f.id);}} style={{color:"#1a73e8",cursor:"pointer"}}>{f.label||"(untitled)"}</a></span>;
                  })}
                </div>}
              </div>}

              {/* ---- Procurement ---- */}
              {!isCat&&procRisk(row)&&<div style={sec}>
                <div style={secH}>Procurement</div>
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
              </div>}

              {/* ---- Quantity ---- */}
              {!isCat&&<div style={sec}>
                <div style={secH}>Quantity & rate</div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <div style={{flex:2}}>
                <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Quantity</label>
                <SchedBufInput type="number" value={row.qty||""} onCommit={function(v){updRow(row.id,{qty:v});}} placeholder="0" style={{padding:"4px 6px",fontSize:11}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:9,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Unit</label>
                <SchedBufInput type="text" value={row.unit||""} onCommit={function(v){updRow(row.id,{unit:v});}} placeholder="m3" style={{padding:"4px 6px",fontSize:11}}/>
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

              </div>}

              {/* ---- Prerequisites ---- */}
              {!isCat&&<div style={sec}>
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
              <div style={{fontSize:9,color:"#aaa",marginBottom:5}}>Add one under <b>Actions</b> below, choosing <b>🔒 Prerequisite</b>.</div>
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

              </div>}

              {/* ---- Actions ---- */}
              <div style={sec}>
                <div style={secH}>Actions ({linked.filter(function(t){return t.status!=="done";}).length} open)</div>
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
              </div>
            </div>

            {canEdit&&<div style={{padding:"10px 14px",borderTop:"1.5px solid #e8e6df",display:"flex",gap:6,flexWrap:"wrap",background:"#fafaf8"}}>
              <button className="btn btn-sm btn-gold" onClick={function(){insertTaskAfter(row.id);}}>{isCat?"＋ Task at the top":"＋ Task below"}</button>
              <button className="btn btn-sm" onClick={function(){isCat?duplicateCategoryBlock(row.id):duplicateRow(row.id);}}>{isCat?"⧉ Duplicate with its tasks":"⧉ Duplicate"}</button>
              <button className="btn btn-sm btn-danger" style={{marginLeft:"auto"}} onClick={function(){delRow(row.id);}}>🗑 Delete</button>
            </div>}
          </div>;
        })()}

        {linkMenu&&(function(){
          var succ=rowById(linkMenu.succId);
          var pred=succ&&succ.afterId?rowById(succ.afterId):null;
          if(!succ||!pred)return null;
          var ls=linkState(succ);
          var W=300;
          var item={padding:"7px 12px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"};
          function hov(e,on){e.currentTarget.style.background=on?"#f5f4f0":"transparent";}
          return <React.Fragment>
            <div className="sched-noprint" onClick={function(){setLinkMenu(null);}} style={{position:"fixed",inset:0,zIndex:1290}}></div>
            <div className="sched-noprint" style={{position:"fixed",zIndex:1300,left:Math.max(6,Math.min(linkMenu.x+8,window.innerWidth-W-6)),top:Math.max(6,Math.min(linkMenu.y+8,window.innerHeight-210)),
              width:W,background:"#fff",border:"1px solid #e0ddd6",borderRadius:9,boxShadow:"0 10px 32px rgba(0,0,0,.22)",padding:"6px 0"}}>
              <div style={{fontSize:11,color:"#6f6b62",padding:"3px 12px 6px",lineHeight:1.4}}>
                <b style={{color:"#16181d"}}>{succ.label||"(untitled)"}</b> starts after <b style={{color:"#16181d"}}>{pred.label||"(untitled)"}</b>
                {ls&&ls.weeks<0&&<div style={{color:"#c62828",fontWeight:700}}>⚠ starts {-ls.weeks} week{-ls.weeks!==1?"s":""} too early</div>}
                {ls&&ls.weeks>0&&<div>{ls.weeks} week{ls.weeks!==1?"s":""} of slack</div>}
              </div>
              {ls&&ls.weeks!==0&&ls.earliestWeek&&<div style={item} onMouseEnter={function(e){hov(e,true);}} onMouseLeave={function(e){hov(e,false);}}
                onClick={function(){setLinkMenu(null);moveAfterPredecessor(succ);}}>
                {ls.weeks<0?"⇢ Move “"+(succ.label||"task")+"” right after it":"⇠ Pull “"+(succ.label||"task")+"” back right after it"}</div>}
              <div style={item} onMouseEnter={function(e){hov(e,true);}} onMouseLeave={function(e){hov(e,false);}}
                onClick={function(){setLinkMenu(null);setPanelRowId(succ.id);}}>↻ Change the previous task… (details panel)</div>
              <div style={Object.assign({},item,{color:"#c62828"})} onMouseEnter={function(e){hov(e,true);}} onMouseLeave={function(e){hov(e,false);}}
                onClick={function(){setLinkMenu(null);removeLink(succ.id);}}>⛌ Remove the link</div>
              <div style={{fontSize:10,color:"#9b968b",padding:"5px 12px 2px",borderTop:"1px solid #f0ede6",marginTop:4}}>Tip: drag the arrow onto another task to move the link to it · Ctrl+Z undoes</div>
            </div>
          </React.Fragment>;
        })()}
        {ctxMenu&&(function(){
          var row=rowById(ctxMenu.rowId);
          if(!row)return null;
          var isCat=row.kind==="category"||row.kind==="section";
          var ls=isCat?null:linkState(row);
          var items=[
            {k:"open",t:"☰ Details…",f:function(){setPanelRowId(row.id);}},
            {k:"ren",t:"✎ Rename",f:function(){justInsertedRef.current="";setEditRowId(row.id);}},
            {k:"ins",t:isCat?"＋ Task at the top":"＋ Task below",f:function(){insertTaskAfter(row.id);}},
            {k:"dup",t:isCat?"⧉ Duplicate with its tasks":"⧉ Duplicate",f:function(){isCat?duplicateCategoryBlock(row.id):duplicateRow(row.id);}}
          ];
          if(!isCat){
            items.push({k:"e",t:"◀ 1 week earlier",f:function(){shiftRow(row.id,-1);}});
            items.push({k:"l",t:"1 week later ▶",f:function(){shiftRow(row.id,1);}});
            if(ls&&ls.weeks<0&&ls.earliestWeek)items.push({k:"fix",t:"⇢ Move after “"+(ls.pred.label||"untitled")+"”",f:function(){moveAfterPredecessor(row);}});
            if(row.afterId)items.push({k:"unl",t:"⛌ Remove the link to the previous task",f:function(){removeLink(row.id);}});
          }else{
            items.push({k:"col",t:collapsedCats[row.id]?"▾ Expand":"▸ Collapse",f:function(){toggleCat(row.id);}});
          }
          items.push({k:"del",t:"🗑 Delete",f:function(){delRow(row.id);},danger:true});
          var W=240,H=items.length*29+16;
          return <React.Fragment>
            <div className="sched-noprint" onClick={function(){setCtxMenu(null);}} onContextMenu={function(e){e.preventDefault();setCtxMenu(null);}}
              style={{position:"fixed",inset:0,zIndex:1290}}></div>
            <div className="sched-noprint" style={{position:"fixed",zIndex:1300,left:Math.max(6,Math.min(ctxMenu.x,window.innerWidth-W-6)),top:Math.max(6,Math.min(ctxMenu.y,window.innerHeight-H-6)),
              width:W,background:"#fff",border:"1px solid #e0ddd6",borderRadius:9,boxShadow:"0 10px 32px rgba(0,0,0,.22)",padding:"6px 0"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#9b968b",padding:"2px 12px 5px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{row.label||"(untitled)"}</div>
              {items.map(function(it){
                return <div key={it.k} onClick={function(){setCtxMenu(null);it.f();}}
                  onMouseEnter={function(e){e.currentTarget.style.background="#f5f4f0";}} onMouseLeave={function(e){e.currentTarget.style.background="transparent";}}
                  style={{padding:"6px 12px",fontSize:12,cursor:"pointer",color:it.danger?"#c62828":"#16181d",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{it.t}</div>;
              })}
            </div>
          </React.Fragment>;
        })()}

      </div>}

    {drag&&(drag.type==="link"||(drag.type==="relink"&&Math.abs(drag.x-drag.x0)+Math.abs(drag.y-drag.y0)>=6))&&<svg className="sched-noprint" style={{position:"fixed",inset:0,width:"100vw",height:"100vh",pointerEvents:"none",zIndex:1400}}>
      <line x1={drag.x0} y1={drag.y0} x2={drag.x} y2={drag.y} stroke={drag.target?"#1a73e8":"#9b968b"} strokeWidth={2} strokeDasharray="5 4"/>
      <circle cx={drag.x} cy={drag.y} r={5} fill={drag.target?"#1a73e8":"#fff"} stroke="#1a73e8" strokeWidth={2}/>
      {drag.target&&(function(){
        var t=rowById(drag.target);
        if(!t)return null;
        var ok=t.kind!=="category"&&t.kind!=="section";
        var predLbl=drag.type==="relink"?((rowById(drag.predId)||{}).label||"the previous task"):((rowById(drag.rowId)||{}).label||"this task");
        var txt=ok?"starts after “"+predLbl+"”":"drop on a task, not a header";
        return <text x={drag.x+12} y={drag.y-10} fontSize="11" fontWeight="700" fill={ok?"#1a73e8":"#c62828"}
          style={{paintOrder:"stroke",stroke:"#fff",strokeWidth:3}}>{(t.label||"(untitled)")+" — "+txt}</text>;
      })()}
    </svg>}
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
