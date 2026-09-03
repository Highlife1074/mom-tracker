
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
function esc(v){
  return String(v===undefined||v===null?"":v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
const REPORT_CSS=`
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',Segoe UI,system-ui,sans-serif;color:#14171c;background:#fff;font-size:12px;line-height:1.45;padding:22px}
h1{font-size:21px;margin-bottom:2px}
.sub{color:#8b8578;font-size:11px;margin-bottom:16px}
h2{font-size:15px;margin:20px 0 7px;padding-bottom:4px;border-bottom:2px solid #14171c;page-break-after:avoid}
h3{font-size:12px;margin:12px 0 5px;color:#5a5348;page-break-after:avoid}
table{width:100%;border-collapse:collapse;margin-bottom:10px;page-break-inside:auto}
th{background:#f2f0eb;text-align:left;padding:4px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#8b8578;border:1px solid #ddd8cc}
td{padding:4px 7px;border:1px solid #e5e1d6;vertical-align:top}
tr{page-break-inside:avoid}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;white-space:nowrap}
.red{background:#fce4ec;color:#c62828}.amb{background:#fff3e0;color:#ef6c00}
.grn{background:#e8f5e9;color:#2e7d32}.blu{background:#e8f0fe;color:#1a73e8}
.gry{background:#f2f0eb;color:#8b8578}.yel{background:#fff8e1;color:#f57f17}
.kpi{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.kpi div{border:1.5px solid #e5e1d6;border-radius:8px;padding:6px 12px;min-width:78px}
.kpi b{display:block;font-size:17px;line-height:1.1}
.kpi span{font-size:9px;color:#8b8578}
.pkg{page-break-inside:avoid;margin-bottom:18px;border-left:3px solid #c9a84c;padding-left:11px}
.none{color:#b9b3a6;font-style:italic;font-size:11px}
.chk{font-family:monospace;font-size:11px;letter-spacing:1px}
.q td{padding:6px 7px}
.foot{margin-top:22px;border-top:1px solid #ddd8cc;padding-top:7px;font-size:9px;color:#b9b3a6}
@page{size:A4 portrait;margin:11mm}
@media print{body{padding:0}.noprint{display:none}}
.noprint{margin-bottom:14px}
.noprint button{font:inherit;font-size:12px;padding:7px 15px;border-radius:7px;border:1.5px solid #14171c;background:#14171c;color:#fff;cursor:pointer}
`;
// Report 2 — zone weekly pack, printed Friday morning for the afternoon meeting.
const READINESS_Qs=["Materials","Manpower","Method","Equipment","WMS","ITP","Others"];
function buildZoneWeeklyReport(zone,schedules,rooms,tasks,tenders,opts){
  var t=today();
  var scs=(schedules||[]).filter(function(x){return x.zone===zone;});
  var zTasks=(tasks||[]).filter(function(x){return x.zone===zone;});
  var zRooms=(rooms||[]).filter(function(x){return x.zone===zone;});

  // Monday of next week, then the two after: the +1 / +2 / +3 windows
  function mondayAfter(d){
    var x=new Date(d);
    var day=x.getDay();                       // 0 Sun … 1 Mon
    var add=(8-(day===0?7:day))%7||7;
    x.setDate(x.getDate()+add);
    return toISO(x);
  }
  var w1=mondayAfter(t);
  var w2=addCalDays(w1,7), w3=addCalDays(w1,14);
  var windows=[{k:"+1",start:w1},{k:"+2",start:w2},{k:"+3",start:w3}];

  var doneActs=zTasks.filter(function(a){return a.status==="done";});
  var openActs=zTasks.filter(function(a){return a.status!=="done";});
  var prereqs=zTasks.filter(function(a){return (a.tags||[]).indexOf("Prerequisite")>=0;});

  var html='<h1>Weekly Zone Report — '+esc(zone)+'</h1>'+
    '<div class="sub">Riviera Tower · '+esc(fmtDate(t))+' · prepared for the Friday afternoon meeting</div>';
  html+='<div class="kpi">'+
    '<div><b>'+doneActs.length+'</b><span>actions done</span></div>'+
    '<div><b>'+openActs.length+'</b><span>still open</span></div>'+
    '<div><b>'+openActs.filter(function(a){return (a.tags||[]).indexOf("Blocking Point")>=0;}).length+'</b><span>blocking</span></div>'+
    '<div><b>'+prereqs.filter(function(a){return a.status!=="done"&&!a.dateConfirmed;}).length+'</b><span>prereq TBC</span></div>'+
    '<div><b>'+zRooms.length+'</b><span>rooms</span></div>'+
    '</div>';

  // ---- 1. programme progress
  html+='<h2>1 · Programme progress</h2>';
  scs.forEach(function(sc){
    var wl=scheduleWeeks(sc);
    var rowsT=(sc.rows||[]).filter(function(r){return r.kind!=="category";});
    var planned=0,actual=0;
    rowsT.forEach(function(r){
      wl.forEach(function(w){
        var v=(r.cells||{})[w];
        if(v==="plan"||v==="both")planned++;
        if(v==="actual"||v==="both")actual++;
      });
    });
    var pct=planned>0?Math.round(actual/planned*100):0;
    html+='<h3>'+esc(sc.title)+' — '+rowsT.length+' tasks · '+wl.length+' weeks</h3>';
    html+='<table><tr><th>Planned cells</th><th>Actual cells</th><th>Completion</th><th>Tasks started</th><th>Tasks not started</th></tr>'+
      '<tr><td>'+planned+'</td><td>'+actual+'</td>'+
      '<td><span class="pill '+(pct>=90?"grn":pct>=50?"amb":"red")+'">'+pct+'%</span></td>'+
      '<td>'+rowsT.filter(function(r){return Object.keys(r.cells||{}).some(function(w){var v=r.cells[w];return v==="actual"||v==="both";});}).length+'</td>'+
      '<td>'+rowsT.filter(function(r){return !Object.keys(r.cells||{}).some(function(w){var v=r.cells[w];return v==="actual"||v==="both";});}).length+'</td></tr></table>';
  });
  if(scs.length===0)html+='<div class="none">No schedule for this zone.</div>';

  // ---- 2. rooms
  html+='<h2>2 · Room by room</h2><table><tr><th style="width:22%">Room</th><th>Tasks</th><th>Blocking</th><th>Prerequisites</th><th>Status</th></tr>';
  zRooms.forEach(function(rm){
    var blockers=zTasks.filter(function(a){
      return a.status!=="done"&&(a.tags||[]).indexOf("Blocking Point")>=0&&
        (a.blockedRooms==="all"||(a.blockedRooms||[]).indexOf(rm.id)>=0);
    });
    var rmRows=[];
    scs.forEach(function(sc){
      var rows=(sc.rows||[]);
      for(var i=0;i<rows.length;i++){
        if(rows[i].kind==="category"&&rows[i].roomId===rm.id){
          for(var j=i+1;j<rows.length&&rows[j].kind!=="category";j++)rmRows.push(rows[j]);
        }
      }
    });
    var rmPq=[];
    rmRows.forEach(function(r){
      zTasks.forEach(function(a){
        if(a.scheduleRowRef===r.id&&(a.tags||[]).indexOf("Prerequisite")>=0)rmPq.push(a);
      });
    });
    var pqTbc=rmPq.filter(function(a){return a.status!=="done"&&!a.dateConfirmed;});
    html+='<tr><td><b>'+esc(rm.name)+'</b></td><td>'+rmRows.length+'</td>'+
      '<td>'+(blockers.length?'<span class="pill red">'+blockers.length+'</span> '+esc(blockers.map(function(b){return b.text;}).join("; ").slice(0,90)):'—')+'</td>'+
      '<td>'+(rmPq.length?(pqTbc.length?'<span class="pill yel">'+pqTbc.length+' TBC</span> ':'<span class="pill grn">all confirmed</span> ')+esc(rmPq.map(function(a){return a.text;}).join("; ").slice(0,80)):'—')+'</td>'+
      '<td>'+(blockers.length?'<span class="pill red">BLOCKED</span>':pqTbc.length?'<span class="pill yel">AT RISK</span>':'<span class="pill grn">CLEAR</span>')+'</td></tr>';
  });
  if(zRooms.length===0)html+='<tr><td colspan="5" class="none">No room in this zone.</td></tr>';
  html+='</table>';

  // ---- 3. procurement delays
  html+='<h2>3 · Forecast delays from procurement</h2>';
  var risks=[];
  scs.forEach(function(sc){
    (sc.rows||[]).forEach(function(r){
      if(r.kind==="category"||!r.tenderRef||!r.startWeek)return;
      var td=(tenders||[]).find(function(x){return x.id===r.tenderRef;});
      if(!td)return;
      var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
      if(!proc.deliveryDate)return;
      var wkEnd=addCalDays(r.startWeek,6);
      var gap=Math.round((new Date(wkEnd)-new Date(proc.deliveryDate))/86400000);
      if(gap<21)risks.push({r:r,td:td,delivery:proc.deliveryDate,gap:gap,sc:sc});
    });
  });
  risks.sort(function(a,b){return a.gap-b.gap;});
  if(risks.length===0)html+='<div class="none">No task at risk: every linked delivery lands more than 3 weeks before its start.</div>';
  else{
    html+='<table><tr><th style="width:28%">Task</th><th>Tender</th><th>Delivery</th><th>Start week</th><th>Float</th></tr>';
    risks.forEach(function(x){
      html+='<tr><td>'+esc(x.r.label)+'</td><td>'+esc(x.td.title)+'</td><td>'+esc(fmtDate(x.delivery))+'</td>'+
        '<td>'+esc(fmtDate(x.r.startWeek))+'</td>'+
        '<td>'+(x.gap<0?'<span class="pill red">'+(-x.gap)+'d late</span>':'<span class="pill amb">'+x.gap+'d</span>')+'</td></tr>';
    });
    html+='</table>';
  }

  // ---- 4. readiness for the next three weeks
  html+='<h2>4 · Starting in the next 3 weeks — readiness check</h2>';
  windows.forEach(function(win){
    var end=addCalDays(win.start,6);
    var starting=[];
    scs.forEach(function(sc){
      // The same task name is repeated room by room, so the room is what tells the reader
      // where to go. Track the current category and section while walking the rows.
      var curRoom="",curSection="";
      (sc.rows||[]).forEach(function(r){
        if(r.kind==="section"){curSection=r.label||"";curRoom="";return;}
        if(r.kind==="category"){curRoom=r.label||"";return;}
        if(!r.startWeek)return;
        if(r.startWeek>=win.start&&r.startWeek<=end)starting.push({r:r,sc:sc,where:curRoom,section:curSection});
      });
    });
    html+='<h3>Week '+win.k+' — '+esc(fmtDate(win.start))+' · '+starting.length+' task'+(starting.length!==1?"s":"")+' starting</h3>';
    if(starting.length===0){html+='<div class="none">Nothing starting this week.</div>';return;}
    html+='<table class="q"><tr><th style="width:17%">Room / area</th><th style="width:21%">Task</th><th>Subcontractor</th>'+
      READINESS_Qs.map(function(q){return '<th style="text-align:center">'+esc(q)+'</th>';}).join("")+'</tr>';
    starting.forEach(function(x){
      html+='<tr><td><b>'+esc(x.where||"—")+'</b>'+(x.section?'<div style="font-size:9px;color:#8b8578">'+esc(x.section)+'</div>':'')+'</td>'+
        '<td>'+esc(x.r.label)+'<div style="font-size:9px;color:#8b8578">'+esc(x.sc.title)+'</div></td>'+
        '<td>'+esc(x.r.group||"—")+'</td>'+
        READINESS_Qs.map(function(){return '<td style="text-align:center" class="chk">☐&nbsp;Y&nbsp;&nbsp;☐&nbsp;N</td>';}).join("")+'</tr>';
    });
    html+='</table>';
  });

  // ---- 5. actions
  html+='<h2>5 · Actions</h2><h3>Not done ('+openActs.length+')</h3>';
  if(openActs.length===0)html+='<div class="none">Nothing open.</div>';
  else{
    html+='<table><tr><th style="width:46%">Action</th><th>Owner</th><th>Due</th><th>Level</th></tr>';
    openActs.slice().sort(function(a,b){return (a.due||"9999").localeCompare(b.due||"9999");}).forEach(function(a){
      var blk=(a.tags||[]).indexOf("Blocking Point")>=0, pq=(a.tags||[]).indexOf("Prerequisite")>=0;
      var late=a.due&&a.due<t;
      html+='<tr><td>'+esc(a.text)+'</td><td>'+esc(a.owner||"—")+'</td>'+
        '<td>'+(a.due?(late?'<span class="pill red">'+esc(fmtDate(a.due))+'</span>':esc(fmtDate(a.due))):'—')+'</td>'+
        '<td>'+(blk?'<span class="pill red">blocking</span>':pq?'<span class="pill yel">prerequisite</span>':'<span class="pill gry">action</span>')+'</td></tr>';
    });
    html+='</table>';
  }
  html+='<h3>Done ('+doneActs.length+')</h3>';
  if(doneActs.length===0)html+='<div class="none">Nothing closed yet.</div>';
  else{
    html+='<table><tr><th style="width:60%">Action</th><th>Owner</th><th>Closed</th></tr>';
    doneActs.slice().sort(function(a,b){return (b.completedAt||"").localeCompare(a.completedAt||"");}).forEach(function(a){
      html+='<tr><td>'+esc(a.text)+'</td><td>'+esc(a.owner||"—")+'</td><td>'+esc(a.completedAt?fmtDate(a.completedAt):"—")+'</td></tr>';
    });
    html+='</table>';
  }

  html+='<div class="foot">Riviera Tower Project Pilot Tracker · build '+esc(APP_BUILD)+' · zone '+esc(zone)+'</div>';
  return html;
}

// Report 1 — procurement, one section per package.
function buildProcurementReport(tenders,tasks,packages){
  var t=today();
  var tds=(tenders||[]).slice();
  var pkgs=[...new Set(tds.map(function(x){return x.package||"— no package —";}))].sort();
  var openAll=(tasks||[]).filter(function(a){return a.status!=="done"&&a.tenderRef;});

  var html='<h1>Procurement Report</h1><div class="sub">Riviera Tower · generated '+esc(fmtDate(t))+' · '+tds.length+' tenders across '+pkgs.length+' packages</div>';
  html+='<div class="kpi">'+
    '<div><b>'+openAll.length+'</b><span>open actions</span></div>'+
    '<div><b>'+openAll.filter(function(a){return (a.tags||[]).indexOf("Blocking Point")>=0;}).length+'</b><span>blocking</span></div>'+
    '<div><b>'+openAll.filter(function(a){return a.due&&a.due<t;}).length+'</b><span>overdue</span></div>'+
    '<div><b>'+tds.filter(function(x){return isApprovedStatus(((x.stepDates||{}).acc||{}).approvalStatus);}).length+'</b><span>ACC approved</span></div>'+
    '</div>'+
    '<div style="font-size:10px;color:#8b8578;margin-bottom:14px">Float = days between the forecast delivery and the start on site. '+
    '<span class="pill red">red</span> the material arrives after the crew · '+
    '<span class="pill amb">amber</span> less than 3 weeks of cover · '+
    '<span class="pill grn">green</span> comfortable.</div>';

  pkgs.forEach(function(p){
    var list=tds.filter(function(x){return (x.package||"— no package —")===p;})
      .sort(function(a,b){return (a.title||"").localeCompare(b.title||"");});
    html+='<div class="pkg"><h2>'+esc(p)+' <span style="font-weight:400;font-size:11px;color:#8b8578">· '+list.length+' tender'+(list.length!==1?"s":"")+'</span></h2>';

    // --- procurement recap
    html+='<h3>Procurement status</h3><table><tr><th>Tender</th><th>Ref</th><th>Contract</th><th>ACC / Aconex</th><th>Approval</th><th>Delivery</th><th>Start on site</th><th>Float</th></tr>';
    list.forEach(function(td){
      var acc=(td.stepDates||{}).acc||{};
      var ct=(td.stepDates||{}).contract||{};
      var proc=(function(){try{return calcProcurement(td);}catch(e){return{};}})();
      var accSt=acc.approvalStatus||"";
      var cls=isApprovedStatus(accSt)?"grn":/reject|not approved/i.test(accSt)?"red":accSt?"yel":"gry";
      var signed=ct.signedDone||ct.done||"";
      // Float = days between the delivery forecast and the start on site. Under three weeks
      // is the same warning the schedule shows; negative means the crew arrives first.
      var floatTxt='—',rowStyle='',floatCell='<td>—</td>';
      if(proc.deliveryDate&&td.startOnSite){
        var gap=Math.round((new Date(td.startOnSite)-new Date(proc.deliveryDate))/86400000);
        if(gap<0){floatCell='<td><span class="pill red">'+(-gap)+'d LATE</span></td>';rowStyle=' style="background:#fdeced"';}
        else if(gap<21){floatCell='<td><span class="pill amb">'+gap+'d</span></td>';rowStyle=' style="background:#fdf6ec"';}
        else floatCell='<td><span class="pill grn">'+gap+'d</span></td>';
      }
      html+='<tr'+rowStyle+'><td><b>'+esc(td.title)+'</b></td>'+
        '<td>'+esc(acc.reference||td.reference||'—')+'</td>'+
        '<td>'+(signed?'<span class="pill grn">signed '+esc(fmtDate(signed))+'</span>':'<span class="pill gry">not signed</span>')+'</td>'+
        '<td>'+(acc.done?esc(fmtDate(acc.done)):'<span class="none">not submitted</span>')+'</td>'+
        '<td><span class="pill '+cls+'">'+esc(accSt||"pending")+'</span></td>'+
        '<td>'+(proc.deliveryDate?esc(fmtDate(proc.deliveryDate)):'—')+'</td>'+
        '<td>'+(td.startOnSite?esc(fmtDate(td.startOnSite)):'—')+'</td>'+
        floatCell+'</tr>';
    });
    html+='</table>';

    // --- open actions
    var acts=openAll.filter(function(a){
      var td=tds.find(function(x){return x.id===a.tenderRef;});
      return td&&(td.package||"— no package —")===p;
    }).sort(function(a,b){return (a.due||"9999").localeCompare(b.due||"9999");});
    html+='<h3>Open actions ('+acts.length+')</h3>';
    if(acts.length===0)html+='<div class="none">No open action.</div>';
    else{
      html+='<table><tr><th style="width:44%">Action</th><th>Tender</th><th>Owner</th><th>Due</th><th>Level</th></tr>';
      acts.forEach(function(a){
        var td=tds.find(function(x){return x.id===a.tenderRef;});
        var blk=(a.tags||[]).indexOf("Blocking Point")>=0;
        var warn=(a.tags||[]).indexOf("Warning")>=0;
        var late=a.due&&a.due<t;
        html+='<tr><td>'+esc(a.text)+'</td><td>'+esc(td?td.title:"")+'</td><td>'+esc(a.owner||"—")+'</td>'+
          '<td>'+(a.due?(late?'<span class="pill red">'+esc(fmtDate(a.due))+'</span>':esc(fmtDate(a.due))):'—')+'</td>'+
          '<td>'+(blk?'<span class="pill red">blocking</span>':warn?'<span class="pill amb">warning</span>':'<span class="pill gry">info</span>')+'</td></tr>';
      });
      html+='</table>';
    }

    // --- MAR
    var mars=[];
    list.forEach(function(td){(td.materials||[]).forEach(function(m){mars.push({td:td,m:m});});});
    html+='<h3>MAR — material approval requests ('+mars.length+')</h3>';
    if(mars.length===0)html+='<div class="none">No material registered.</div>';
    else{
      html+='<table><tr><th style="width:28%">Material</th><th>Tender</th><th>MSS</th><th>MAR submitted</th><th>Ref</th><th>Approval</th><th>Lead time</th></tr>';
      mars.forEach(function(x){
        var st=x.m.marStatus||x.m.status||"";
        var cls=isApprovedStatus(st)?"grn":/reject|not approved/i.test(st)?"red":st?"yel":"gry";
        html+='<tr><td><b>'+esc(x.m.name||x.m.title||"(unnamed)")+'</b></td><td>'+esc(x.td.title)+'</td>'+
          '<td>'+(x.m.mssDone?esc(fmtDate(x.m.mssDone)):'—')+'</td>'+
          '<td>'+(x.m.marDone?esc(fmtDate(x.m.marDone)):'—')+'</td>'+
          '<td>'+esc(x.m.marRef||x.m.mssRef||"—")+'</td>'+
          '<td><span class="pill '+cls+'">'+esc(st||"pending")+'</span></td>'+
          '<td>'+esc(x.m.leadTime||"—")+'</td></tr>';
      });
      html+='</table>';
    }

    // --- WMS / ITP
    html+='<h3>WMS &amp; ITP</h3><table><tr><th style="width:30%">Tender</th><th>Doc</th><th>Theoretical</th><th>Target</th><th>Done</th><th>Ref</th><th>Approval</th></tr>';
    list.forEach(function(td){
      var theo=theoreticalDates(td);
      ["wms","itp"].forEach(function(k){
        var d=(td.stepDates||{})[k]||{};
        var st=d.approvalStatus||"";
        var cls=isApprovedStatus(st)?"grn":/reject|not approved/i.test(st)?"red":st?"yel":"gry";
        var due=d.target||theo[k].theoretical;
        var late=due&&due<t&&!d.done;
        html+='<tr><td>'+esc(td.title)+'</td><td><span class="pill '+(k==="wms"?"blu":"gry")+'">'+k.toUpperCase()+'</span></td>'+
          '<td>'+(theo[k].theoretical?esc(fmtDate(theo[k].theoretical)):'—')+'</td>'+
          '<td>'+(d.target?(late?'<span class="pill red">'+esc(fmtDate(d.target))+'</span>':esc(fmtDate(d.target))):'—')+'</td>'+
          '<td>'+(d.done?esc(fmtDate(d.done)):'—')+'</td>'+
          '<td>'+esc(d.reference||"—")+'</td>'+
          '<td><span class="pill '+cls+'">'+esc(st||"pending")+'</span></td></tr>';
      });
    });
    html+='</table></div>';
  });

  html+='<div class="foot">Riviera Tower Project Pilot Tracker · build '+esc(APP_BUILD)+'</div>';
  return html;
}

function openReport(title,bodyHtml){
  var w=window.open("","_blank");
  if(!w){safeAlert("Your browser blocked the report window.\n\nAllow pop-ups for this site, then try again.");return;}
  w.document.write("<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>"+esc(title)+
    "</title><link href=\"https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap\" rel=\"stylesheet\"/><style>"+REPORT_CSS+"</style></head><body>"+
    "<div class=\"noprint\"><button onclick=\"window.print()\">🖨 Print / Save as PDF</button></div>"+
    bodyHtml+"</body></html>");
  w.document.close();
}
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
function canEditZoneSchedule(zoneOwners,zone,user){
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
function newRoom(overrides){return Object.assign({id:uuid(),name:"",zone:""},overrides||{});}
function newKPI(overrides){return Object.assign({id:uuid(),zone:"",name:"",unit:"",totalTarget:0,startDate:"",endDate:"",weeklyActuals:{},createdAt:today()},overrides||{});}
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

function uuid(){return"id_"+Math.random().toString(36).slice(2)+Date.now().toString(36);}
function qualityTag(pkg){
  if(!pkg)return"Quality External";
  var p=pkg.toLowerCase();
  if(p.includes("podium"))return"Quality Podium";
  if(p.includes("external")||p.includes("works"))return"Quality External";
  return"Quality Tower";
}
var APP_BUILD="2026-08-16-f";
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

function TrackersView({trackers,setTrackers,saveX,people,packages,tags,tenders,contractors,tagrules,pkgrules,tasks,saveTasks,zones}){
  const [trackerQ,setTrackerQ]=useState("");
  const [view,setView]=useState("list");
  const [sel,setSel]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [formData,setFormData]=useState(null);
  const [showImport,setShowImport]=useState(false);

  const openNew=()=>{setFormData(newTracker());setShowForm(true);};
  const openEdit=tr=>{setFormData(JSON.parse(JSON.stringify(tr)));setShowForm(true);};

  const saveTracker=td=>{
    const d=trackers.find(x=>x.id===td.id)?trackers.map(x=>x.id===td.id?td:x):[td,...trackers];
    saveX(d);setShowForm(false);
    if(sel&&sel.id===td.id)setSel(td);
  };
  const delTracker=id=>{if(safeConfirm("Delete tracker? Any linked actions will remain in Actions but lose their tracker link.")){saveX(trackers.filter(t=>t.id!==id));setSel(null);setView("list");}};

  // Unified actions for a tracker: entries in the shared tasks collection tagged with this trackerRef.
  // This is the SAME action object that can also appear in a Package or Zone view — no duplication.
  function trackerTasks(trId){return(tasks||[]).filter(function(t){return t.trackerRef===trId;});}

  const updAction=(taskId,field,val)=>{
    saveTasks((tasks||[]).map(function(t){return t.id!==taskId?t:stampModified(Object.assign({},t,{[field]:val}));}));
  };
  const addAction=(trId,isInfo)=>{
    var td={trackerRef:trId,text:"",owner:"",package:"",status:"pending",importance:1,urgence:1,tags:[]};
    if(isInfo)td.isInfo=true;
    saveTasks([newTask(td),...(tasks||[])]);
  };
  const delAction=(taskId)=>{
    if(safeConfirm("Delete this action?"))saveTasks((tasks||[]).filter(function(t){return t.id!==taskId;}));
  };

  // One-click migration: convert legacy embedded tracker.actions[] into unified tasks (so they can be sent to Zones/Packages too)
  function migrateLegacy(tr){
    var newTasksArr=(tr.actions||[]).map(function(ac){
      return newTask({
        text:ac.text||"",owner:ac.owner||"",package:ac.package||"",status:ac.status||"pending",
        importance:ac.importance||1,urgence:ac.urgence||1,due:ac.due||"",tags:ac.tags||[],
        note:ac.details||"",trackerRef:tr.id,createdAt:ac.createdAt||today()
      });
    });
    saveTasks([...newTasksArr,...(tasks||[])]);
    var d=trackers.map(function(t){return t.id!==tr.id?t:Object.assign({},t,{actions:[]});});
    saveX(d);
    setSel(d.find(function(t){return t.id===tr.id;}));
  }

  function handleExcelImport(rows){
    if(!sel)return;
    var newTasksArr=rows.map(function(r){
      return newTask({text:r.text,owner:r.owner||"",package:r.package||"",due:r.due||"",trackerRef:sel.id,importance:1,urgence:1,tags:[]});
    });
    saveTasks([...newTasksArr,...(tasks||[])]);
    setShowImport(false);
  }

  if(view==="detail"&&sel){
    var unifiedActions=trackerTasks(sel.id);
    var legacyCount=(sel.actions||[]).length;
    const done=unifiedActions.filter(a=>a.status==="done").length;
    const pct=unifiedActions.length?Math.round(done/unifiedActions.length*100):0;
    return <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <button className="btn btn-sm" onClick={()=>setView("list")}>← Back</button>
        <div style={{flex:1}}><div className="page-title">{sel.title}</div>
          {sel.description&&<div className="page-sub">{sel.description}</div>}
        </div>
        <button className="btn btn-sm" onClick={()=>setShowImport(true)} style={{background:"#fffdf0",color:"#7b1fa2",border:"1.5px solid #c9a84c"}}>📥 Import Excel</button>
        <button className="btn btn-sm" onClick={()=>openEdit(sel)}>✏️ Edit</button>
        <button className="btn btn-sm btn-danger" onClick={()=>delTracker(sel.id)}>🗑 Delete</button>
      </div>
      <div className="pbar"><div className="pfill" style={{width:pct+"%",background:"#2e7d32"}}/></div>
      <div style={{fontSize:11,color:"#888",marginBottom:14}}>{done}/{unifiedActions.length} done ({pct}%)</div>

      {legacyCount>0&&<div style={{padding:"10px 14px",background:"#fff8e1",border:"1px solid #ffe082",borderRadius:8,marginBottom:14,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#f57f17",flex:1}}>⚠️ This tracker has {legacyCount} older action{legacyCount!==1?"s":""} not yet unified with the shared Actions system — they can't be sent to a Zone or filtered elsewhere yet. Migrate them to unlock full tagging.</span>
        <button className="btn btn-sm" onClick={()=>migrateLegacy(sel)}>🔄 Migrate now</button>
      </div>}

      {unifiedActions.length===0&&legacyCount===0&&<div className="empty" style={{padding:"20px 0"}}><div className="empty-ico">📋</div><div className="empty-txt">No actions yet. Add one manually or import from Excel.</div></div>}

      {unifiedActions.map(ac=>{
        const sc=calcScore(ac.importance||1,ac.urgence||1);const ss=scoreStyle(sc);
        const ccs=getAllCCs(ac.tags||[],ac.package||"",ac.owner||"",tagrules,pkgrules);
        return <div key={ac.id} className="ac-item">
          <div className="ac-check" style={{borderColor:ac.status==="done"?"#2e7d32":"#ddd",background:ac.status==="done"?"#2e7d32":"transparent",flexShrink:0}}
            onClick={()=>updAction(ac.id,"status",ac.status==="done"?"pending":"done")}>
            {ac.status==="done"&&<span style={{fontSize:11,color:"#fff",fontWeight:900}}>✓</span>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <input type="text" value={ac.text} onChange={e=>updAction(ac.id,"text",e.target.value)} placeholder="Action…"
              style={{width:"100%",fontSize:13,fontWeight:500,border:"none",borderBottom:"1px solid #f0ede6",borderRadius:0,padding:"2px 0",background:"transparent",marginBottom:6}}/>
            <div style={{display:"flex",gap:6,marginBottom:5}}>
              <input type="date" min="1990-01-01" max="2200-12-31" value={ac.due||""} onChange={e=>updAction(ac.id,"due",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}/>
              <select value={ac.status} onChange={e=>updAction(ac.id,"status",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}>
                {STATUS_OPTS.map(s=><option key={s} value={s}>{STATUS_ICONS[s]} {s}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:5}}>
              <select value={ac.owner||""} onChange={e=>updAction(ac.id,"owner",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}>
                <option value="">— owner —</option>{people.map(p=><option key={p} value={p}>{p.split(",")[0]}</option>)}
              </select>
              <select value={ac.package||""} onChange={e=>updAction(ac.id,"package",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px"}}>
                <option value="">— package —</option>{packages.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <select value={ac.zone||""} onChange={e=>updAction(ac.id,"zone",e.target.value)} style={{flex:1,fontSize:11,padding:"3px 6px",color:ac.zone?"#7b1fa2":"inherit",fontWeight:ac.zone?700:400}}>
                <option value="">📍 — no zone —</option>{(zones||[]).map(z=><option key={z} value={z}>📍 {z}</option>)}
              </select>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
              <span style={{fontSize:10,fontWeight:700,color:"#aaa",minWidth:20}}>I</span>
              {[1,2,3].map(v=><button key={v} onClick={()=>updAction(ac.id,"importance",v)}
                style={{width:22,height:22,borderRadius:4,border:"1.5px solid "+((ac.importance||1)===v?"#1c1c1e":"#ddd"),background:(ac.importance||1)===v?"#1c1c1e":"#fff",color:(ac.importance||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>)}
              <span style={{fontSize:10,fontWeight:700,color:"#aaa",marginLeft:6,minWidth:20}}>U</span>
              {[1,2,3].map(v=><button key={v} onClick={()=>updAction(ac.id,"urgence",v)}
                style={{width:22,height:22,borderRadius:4,border:"1.5px solid "+((ac.urgence||1)===v?"#1c1c1e":"#ddd"),background:(ac.urgence||1)===v?"#1c1c1e":"#fff",color:(ac.urgence||1)===v?"#fff":"#aaa",fontFamily:"inherit",fontSize:11,fontWeight:800,cursor:"pointer"}}>{v}</button>)}
              {sc>1&&<span className="chip" style={{background:ss.bg,color:ss.color,fontSize:10,marginLeft:4}}>{ss.label}</span>}
            </div>

            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
              {tags.map(tg=>{const on=(ac.tags||[]).includes(tg);const tc=tagColor(tg);return <button key={tg} onClick={()=>{const cur=ac.tags||[];updAction(ac.id,"tags",on?cur.filter(x=>x!==tg):[...cur,tg]);}}
                style={{padding:"2px 8px",borderRadius:12,border:"1.5px solid "+(on?tc.color:"#ddd"),background:on?tc.bg:"#fff",color:on?tc.color:"#bbb",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>{tg}</button>;})}
            </div>

            {ccs.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:10,fontWeight:700,color:"#aaa"}}>CC:</span>
              {ccs.map((p,i)=><span key={p} style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:"#e8f5e9",color:"#2e7d32",fontWeight:700,border:"1px solid #c8e6c9"}}>CC{i+1} {p.split(",")[0]}</span>)}
            </div>}

            <textarea value={ac.note||""} onChange={e=>updAction(ac.id,"note",e.target.value)} placeholder="Details…"
              style={{width:"100%",marginTop:5,fontSize:11,minHeight:30,border:"1px solid #f0ede6",borderRadius:5,padding:"3px 6px",background:"#fafaf8",resize:"vertical"}}/>
          </div>
          <button className="btn btn-sm btn-danger" onClick={()=>delAction(ac.id)} style={{padding:"3px 7px",flexShrink:0,alignSelf:"flex-start"}}>🗑</button>
        </div>;
      })}
      <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
        <button className="btn btn-sm" onClick={function(){addAction(sel.id,false);}}>＋ Add Action</button>
        <button className="btn btn-sm" onClick={function(){addAction(sel.id,true);}} style={{background:"#e3f2fd",color:"#1565c0",border:"1.5px solid #1565c0"}}>＋ Add Info</button>
      </div>
      {showForm&&formData&&<TrackerFormModal data={formData} onChange={setFormData} onSave={saveTracker} onClose={()=>setShowForm(false)} people={people} packages={packages} tags={tags}/>}
      {showImport&&<ExcelImportModal onImport={handleExcelImport} onClose={()=>setShowImport(false)} people={people} packages={packages}/>}
    </div>;
  }

  var filteredTr=trackerQ?trackers.filter(function(t){return (t.title||"").toLowerCase().includes(trackerQ.toLowerCase());}):trackers;
  return <div>
    <div className="page-hdr">
      <div><div className="page-title">Trackers</div><div className="page-sub">Action groups by theme or project phase — actions here are the same shared actions visible in Packages/Zones</div></div>
      <button className="btn btn-gold" onClick={openNew}>＋ New Tracker</button>
    </div>
    <div style={{marginBottom:12}}>
      <input type="text" value={trackerQ} onChange={function(e){setTrackerQ(e.target.value);}} placeholder="🔍 Search tracker..." style={{width:220,padding:"5px 10px",fontSize:12}}/>
    </div>
    {filteredTr.length===0?<div className="empty"><div className="empty-ico">📊</div><div className="empty-txt">{trackerQ?"No tracker matches your search.":"No trackers yet. Create one to track a recurring theme."}</div></div>
    :filteredTr.map(tr=>{
      var unified=trackerTasks(tr.id);
      var totalCount=unified.length+(tr.actions||[]).length;
      var doneCount=unified.filter(a=>a.status==="done").length+(tr.actions||[]).filter(a=>a.status==="done").length;
      const pct=totalCount?Math.round(doneCount/totalCount*100):0;
      return <div key={tr.id} className="ctr-card" onClick={()=>{setSel(tr);setView("detail");}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14}}>{tr.title}</div>
            {tr.description&&<div style={{fontSize:12,color:"#888",marginTop:2}}>{tr.description}</div>}
            <div style={{fontSize:11,color:"#aaa",marginTop:4}}>📅 {fmtDate(tr.createdAt)} · {doneCount}/{totalCount} done</div>
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
                <span style={{fontFamily:"var(--font-mono)"}}>{fmtDate(proc.fabStart||"")}</span>
                <span style={{color:"var(--ink-4,#9b968b)"}}>fabrication launch</span>
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
                {src==="manual"&&<button className="btn btn-sm" style={{padding:"2px 8px",fontSize:10}}
                  onClick={function(){updTd("leadTimeDays","");}}>↺ use material</button>}
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
                        try{lsSet("pp_zone_cur",f.sc.zone||"");lsSet("pp_zone_subtab","schedule");lsSet("pp_sched_selId",f.sc.id);lsSet("pp_sched_focusRow",f.r.id);}catch(e){}
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

  var steps = [];
  var ov=td.procOverrides||{};

  steps.push({key:"accSub", label:"ACC Submittal", date:accSubmittal, done:accDoneActual, duration:null, manual:true, note:accDoneActual?"From 'Date done' of ACC step":"Provisional — from ACC target date (not yet submitted)"});

  var accApprTargetAuto = addWorkDays(accSubmittal, getDur("accApproval"));
  var accApprTarget = ov.accApp||accApprTargetAuto;
  steps.push({key:"accApp", label:"ACC Approval", date:accApprTarget, done:accApproval, duration:14, manual:false, autoDate:accApprTargetAuto, overridden:!!(ov.accApp&&ov.accApp!==accApprTargetAuto)});

  var contractTargetAuto = addWorkDays(accApproval||accApprTarget, getDur("contractSigning"));
  var contractTarget = ov.contract||contractTargetAuto;
  steps.push({key:"contract", label:"Contract Signing", date:contractTarget, done:contractDone, duration:28, manual:false, autoDate:contractTargetAuto, overridden:!!(ov.contract&&ov.contract!==contractTargetAuto)});

  var fabStart = contractDone||contractTarget;

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
    procStart = toISO(ps);
  }

  return {steps:steps, deliveryDate:deliveryDate, procStart:procStart, margin:margin, totalDays:totalDays, LEAD:LEAD,
    leadSource:leadSource, leadMaterial:leadMaterial?(leadMaterial.name||""):"", fabStart:fabStart};
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

function DashboardView({tasks,trackers,people,tenders,contractors,packages,tags,tagrules,pkgrules,onJumpOwner,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [dashTab,setDashTab]=useState(mem.dashTab||"overview");
  useEffect(function(){if(setMemory)setMemory({dashTab:dashTab});},[dashTab]);
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
function TimelineView({tasks,tenders,people,packages,zones,saveTasks,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [groupBy,setGroupBy]=useState(mem.groupBy||"owner");     // owner | tender | zone | package
  const [weeksBack,setWeeksBack]=useState(mem.weeksBack||4);
  const [weeksFwd,setWeeksFwd]=useState(mem.weeksFwd||12);
  const [fKind,setFKind]=useState(mem.fKind||"open");            // open | blocking | all
  const [q,setQ]=useState(mem.q||"");
  const [sel,setSel]=useState(null);
  useEffect(function(){if(setMemory)setMemory({groupBy:groupBy,weeksBack:weeksBack,weeksFwd:weeksFwd,fKind:fKind,q:q});},
    [groupBy,weeksBack,weeksFwd,fKind,q]);

  var t=today();
  // Monday of the current week, then the window around it
  var mon=(function(){var d=new Date(t);var g=d.getDay();d.setDate(d.getDate()-((g===0?7:g)-1));return toISO(d);})();
  var weeks=[];
  for(var i=-weeksBack;i<=weeksFwd;i++)weeks.push(addCalDays(mon,i*7));
  var wStart=weeks[0],wEnd=addCalDays(weeks[weeks.length-1],6);

  var items=(tasks||[]).filter(function(a){
    if(fKind==="open"&&a.status==="done")return false;
    if(fKind==="blocking"&&(a.tags||[]).indexOf("Blocking Point")<0)return false;
    if(q.trim()){
      var hay=[a.text,a.owner,a.package,a.zone,(a.tags||[]).join(" ")].join(" ").toLowerCase();
      if(!q.trim().toLowerCase().split(/\s+/).every(function(w){return hay.indexOf(w)>=0;}))return false;
    }
    return true;
  });

  function laneOf(a){
    if(groupBy==="owner")return a.owner||"— unassigned —";
    if(groupBy==="zone")return a.zone||"— no zone —";
    if(groupBy==="package")return a.package||"— no package —";
    var td=(tenders||[]).find(function(x){return x.id===a.tenderRef;});
    return td?td.title:"— no tender —";
  }
  function weekIndex(due){
    if(!due)return -1;
    for(var k=0;k<weeks.length;k++){if(due>=weeks[k]&&due<=addCalDays(weeks[k],6))return k;}
    return -1;
  }

  var lanes={},order=[],undated=[],outside=0;
  items.forEach(function(a){
    var L=laneOf(a);
    if(!lanes[L]){lanes[L]={cells:{},total:0};order.push(L);}
    if(!a.due){undated.push(a);lanes[L].total++;return;}
    if(a.due<wStart||a.due>wEnd){outside++;lanes[L].total++;return;}
    var idx=weekIndex(a.due);
    if(idx<0){outside++;return;}
    (lanes[L].cells[idx]=lanes[L].cells[idx]||[]).push(a);
    lanes[L].total++;
  });
  order.sort(function(a,b){return lanes[b].total-lanes[a].total;});

  var COL=54, LANE=210;
  function dotColor(a){
    if(a.status==="done")return{bg:"#e6f2e9",fg:"#1e6b3a",br:"#c8e6c9"};
    if((a.tags||[]).indexOf("Blocking Point")>=0)return{bg:"#fbe6e8",fg:"#b3302a",br:"#f0cdc9"};
    if((a.tags||[]).indexOf("Prerequisite")>=0)return{bg:"#faf3e0",fg:"#8a6a1e",br:"#e6c48c"};
    if((a.tags||[]).indexOf("Warning")>=0)return{bg:"#fdf1e0",fg:"#b35c00",br:"#e6c48c"};
    return{bg:"#e8f0fe",fg:"#0f5299",br:"#c6d9f5"};
  }

  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">Action timeline</div>
        <div className="page-sub">{items.length} actions across {order.length} {groupBy==="owner"?"people":groupBy==="tender"?"tenders":groupBy+"s"}
          {undated.length>0?" · "+undated.length+" with no date":""}{outside>0?" · "+outside+" outside the window":""}</div>
      </div>
    </div>

    <div className="filter-bar">
      <span style={{fontSize:11,fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em"}}>Lanes</span>
      {[["owner","Person"],["tender","Tender"],["zone","Zone"],["package","Package"]].map(function(o){
        return <button key={o[0]} className={"fchip"+(groupBy===o[0]?" on":"")} onClick={function(){setGroupBy(o[0]);}}>{o[1]}</button>;
      })}
      <span style={{width:12}}></span>
      {[["open","Open only"],["blocking","Blocking only"],["all","Including done"]].map(function(o){
        return <button key={o[0]} className={"fchip"+(fKind===o[0]?" on gold":"")} onClick={function(){setFKind(o[0]);}}>{o[1]}</button>;
      })}
      <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔎 Search…" style={{width:170,padding:"4px 9px",fontSize:11}}/>
      <span style={{display:"flex",gap:4,alignItems:"center",marginLeft:"auto",fontSize:11,color:"var(--ink-3,#6f6b62)"}}>
        <button className="btn btn-sm" onClick={function(){setWeeksBack(Math.min(26,weeksBack+4));}}>◀ earlier</button>
        <span style={{fontFamily:"var(--font-mono)"}}>{weeksBack}w back · {weeksFwd}w ahead</span>
        <button className="btn btn-sm" onClick={function(){setWeeksFwd(Math.min(52,weeksFwd+4));}}>later ▶</button>
      </span>
    </div>

    {order.length===0
      ?<div className="empty"><div className="empty-ico">🗓</div><div className="empty-txt">No action matches these filters.</div></div>
      :<div style={{overflowX:"auto",border:"1.5px solid var(--rule,#ddd9cf)",borderRadius:10,background:"#fff"}}>
        <table style={{borderCollapse:"collapse",width:"max-content",minWidth:"100%"}}>
          <thead><tr>
            <th style={{position:"sticky",left:0,top:0,zIndex:3,background:"#faf9f7",width:LANE,minWidth:LANE,
              textAlign:"left",padding:"7px 10px",borderBottom:"1.5px solid var(--rule,#ddd9cf)",
              borderRight:"1.5px solid var(--rule,#ddd9cf)",fontSize:10,textTransform:"uppercase",
              letterSpacing:".06em",color:"var(--ink-3,#6f6b62)",fontFamily:"var(--font-mono)"}}>
              {groupBy==="owner"?"Person":groupBy==="tender"?"Tender":groupBy==="zone"?"Zone":"Package"}</th>
            {weeks.map(function(w,k){
              var isNow=w===mon;
              return <th key={w} style={{width:COL,minWidth:COL,padding:"5px 2px",textAlign:"center",
                background:isNow?"var(--ink,#16181d)":"#faf9f7",color:isNow?"#fff":"var(--ink-3,#6f6b62)",
                borderBottom:"1.5px solid var(--rule,#ddd9cf)",borderLeft:"1px solid var(--rule-2,#efece5)",
                fontFamily:"var(--font-mono)",fontSize:9,fontWeight:600,lineHeight:1.3}}>
                {fmtDate(w).slice(0,5)}{isNow?<div style={{fontSize:8,opacity:.85}}>now</div>:null}
              </th>;
            })}
          </tr></thead>
          <tbody>{order.map(function(L){
            return <tr key={L}>
              <td style={{position:"sticky",left:0,zIndex:1,background:"#fff",width:LANE,minWidth:LANE,
                padding:"6px 10px",borderBottom:"1px solid var(--rule-2,#efece5)",
                borderRight:"1.5px solid var(--rule,#ddd9cf)"}}>
                <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={L}>{L}</div>
                <div style={{fontSize:10,color:"var(--ink-4,#9b968b)",fontFamily:"var(--font-mono)"}}>{lanes[L].total} action{lanes[L].total!==1?"s":""}</div>
              </td>
              {weeks.map(function(w,k){
                var cell=lanes[L].cells[k]||[];
                var isNow=w===mon;
                return <td key={w} style={{width:COL,minWidth:COL,height:38,padding:2,verticalAlign:"middle",
                  borderBottom:"1px solid var(--rule-2,#efece5)",borderLeft:"1px solid var(--rule-2,#efece5)",
                  background:isNow?"#fbfaf7":"#fff"}}>
                  <div style={{display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center"}}>
                    {cell.slice(0,4).map(function(a){
                      var c=dotColor(a);
                      var late=a.due&&a.due<t&&a.status!=="done";
                      return <span key={a.id} onClick={function(){setSel(a);}}
                        title={a.text+"\n"+(a.owner||"no owner")+" · due "+fmtDate(a.due)}
                        style={{width:11,height:11,borderRadius:"50%",cursor:"pointer",flexShrink:0,
                          background:c.fg,border:"1.5px solid "+(late?"#b3302a":c.br),
                          boxShadow:late?"0 0 0 1.5px #fbe6e8":"none"}}></span>;
                    })}
                    {cell.length>4&&<span style={{fontSize:9,fontFamily:"var(--font-mono)",color:"var(--ink-3,#6f6b62)"}}>+{cell.length-4}</span>}
                  </div>
                </td>;
              })}
            </tr>;
          })}</tbody>
        </table>
      </div>}

    {undated.length>0&&<div style={{marginTop:12,padding:"10px 12px",border:"1.5px solid var(--rule,#ddd9cf)",borderRadius:8,background:"#faf9f7"}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--ink-3,#6f6b62)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>
        No due date — nowhere to place them ({undated.length})</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {undated.slice(0,25).map(function(a){
          var c=dotColor(a);
          return <span key={a.id} onClick={function(){setSel(a);}}
            style={{fontSize:11,padding:"3px 9px",borderRadius:12,cursor:"pointer",background:c.bg,color:c.fg,border:"1px solid "+c.br}}>
            {(a.text||"").slice(0,42)}{(a.text||"").length>42?"…":""}</span>;
        })}
        {undated.length>25&&<span style={{fontSize:11,color:"var(--ink-4,#9b968b)"}}>+{undated.length-25} more</span>}
      </div>
    </div>}

    {sel&&<div className="overlay" style={{zIndex:1400}} onClick={function(e){if(e.target===e.currentTarget)setSel(null);}}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-hdr">
          <div className="modal-title">Action</div>
          <button className="btn btn-sm" onClick={function(){setSel(null);}}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{fontSize:14,lineHeight:1.45,marginBottom:12}}>{sel.text}</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>
            {(sel.tags||[]).map(function(tg){
              var c=tagColor(tg);
              return <span key={tg} className="badge" style={{background:c.bg,color:c.color}}>{tg}</span>;
            })}
          </div>
          <table className="tbl"><tbody>
            <tr><td style={{width:110,color:"var(--ink-3,#6f6b62)"}}>Owner</td><td>{sel.owner||"—"}</td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Due</td><td>{sel.due?fmtDate(sel.due):"—"}</td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Status</td><td>{sel.status||"pending"}</td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Zone</td><td>{sel.zone||"—"}</td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Package</td><td>{sel.package||"—"}</td></tr>
            {sel.note&&<tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Note</td><td style={{whiteSpace:"pre-wrap"}}>{sel.note}</td></tr>}
          </tbody></table>
        </div>
        <div className="modal-footer">
          {sel.tenderRef&&onNavTender&&<button className="btn" onClick={function(){onNavTender(sel.tenderRef);setSel(null);}}>Open its tender →</button>}
          <button className="btn btn-pri" onClick={function(){
            saveTasks((tasks||[]).map(function(x){return x.id!==sel.id?x:stampModified(Object.assign({},x,
              {status:sel.status==="done"?"pending":"done",completedAt:sel.status==="done"?"":today()}));}));
            setSel(null);
          }}>{sel.status==="done"?"Reopen":"Mark done"}</button>
        </div>
      </div>
    </div>}
  </div>;
}

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

function ScheduleView({curZone,schedules,saveSchedules,tasks,saveTasks,people,tags,zones,rooms,saveRooms,canEdit,roomBlockersOf,tenders,saveTenders,pkgOwners}){
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

function ZoneView({tasks,saveTasks,rooms,saveRooms,zones,people,tags,memory,setMemory,peopleEmails,defaultCC,kpis,saveKpis,meetings,saveMeetings,zoneOwners,schedules,saveSchedules,tenders,saveTenders,pkgOwners}){
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
          <span style={{fontSize:10,color:"#bbb",fontStyle:"italic"}}>blocking points or due within 3 weeks, on a package worked in {curZone} — not counted until adopted</span>
        </div>
        {incomingActions.map(function(t){
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

{subTab==="schedule"&&<ScheduleView curZone={curZone} schedules={schedules} saveSchedules={saveSchedules} tasks={tasks} saveTasks={saveTasks} people={people} tags={tags} zones={zones} rooms={rooms} saveRooms={saveRooms} canEdit={canEditZoneSchedule(zoneOwners,curZone,window._currentUser?window._currentUser.name:"")} roomBlockersOf={roomBlockers} tenders={tenders} saveTenders={saveTenders} pkgOwners={pkgOwners}/>}

    {roomModalTask&&<BlockedRoomsModal zone={curZone} rooms={rooms} selected={roomModalTask.blockedRooms||[]}
      onSave={function(sel){updateTask(roomModalTask.id,{blockedRooms:sel});}}
      onClose={function(){setRoomModalTask(null);}}/>}
  </div>;
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
        {view==="zone"&&<ZoneView tasks={tasks} saveTasks={saveT} rooms={rooms} saveRooms={saveRooms} zones={zones} people={people} tags={tags} memory={memoryFor("zone")} setMemory={function(p){setMemoryFor("zone",p);}} peopleEmails={peopleEmails} defaultCC={defaultCC} kpis={kpis} saveKpis={saveKpis} meetings={meetings} saveMeetings={saveMeetings} zoneOwners={zoneOwners} schedules={schedules} saveSchedules={saveSchedules} tenders={tenders} saveTenders={saveTenders} pkgOwners={pkgOwners}/>}
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

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
