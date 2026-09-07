// ===========================================================================
// app-reports.js — Printable reports, minutes of meeting, timeline, dashboard, trackers.
//
// index.html fetches these files and concatenates them in this fixed order:
//   core -> tenders -> schedule -> zone -> reports -> mount
// They share one scope, exactly as when everything lived in app.js.
// Function declarations hoist across the whole bundle, so the order only
// matters for the mount, which must come last.
// ===========================================================================

function esc(v){
  return String(v===undefined||v===null?"":v)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
const REPORT_CSS=`
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans',Segoe UI,system-ui,sans-serif;color:#14171c;background:#fff;font-size:12px;line-height:1.45;padding:26px 30px;max-width:210mm;margin:0 auto}
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
@page{size:A4 portrait;margin:20mm 16mm 16mm}
@media print{
  body{padding:0;max-width:none}
  .noprint{display:none}
  /* the first block used to print hard against the top trim */
  body>*:first-child{margin-top:0!important}
  .mom-head{padding-top:2mm}
  h1,h2{break-after:avoid;page-break-after:avoid}
  table{page-break-inside:auto}tr{page-break-inside:avoid}thead{display:table-header-group}}
.noprint{margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid #ddd8cc;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.noprint button{font:inherit;font-size:12px;padding:8px 16px;border-radius:7px;border:1.5px solid #14171c;background:#14171c;color:#fff;cursor:pointer}
.noprint .fn{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#5a5348}
.noprint .hint{font-size:11px;color:#8b8578;flex:1;min-width:240px}
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
  // The document title is what Chrome, Edge and Safari propose as the PDF file name in
  // "Save as PDF", so it has to be exactly the name the user wants on disk.
  w.document.write("<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>"+esc(title)+
    "</title><link href=\"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap\" rel=\"stylesheet\"/><style>"+REPORT_CSS+"</style></head><body>"+
    "<div class=\"noprint\">"+
      "<button onclick=\"window.print()\">🖨 Print / Save as PDF</button>"+
      "<span class=\"fn\">File name: <b>"+esc(title)+"</b></span>"+
      "<span class=\"hint\">In the print dialog choose <b>Save as PDF</b> — the name above is proposed automatically. Tick <b>Background graphics</b> to keep the colours.</span>"+
    "</div>"+
    bodyHtml+"</body></html>");
  w.document.close();
  // Chrome, Edge and Safari use document.title as the proposed PDF file name. Writing it
  // again after close(), and once more right before printing, is what makes it stick.
  try{
    w.document.title=title;
    w.addEventListener("beforeprint",function(){w.document.title=title;});
    w.focus();
  }catch(e){}
  // Some browsers only pick the title up once the document is fully parsed.
  try{w.document.title=title;}catch(e){}
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

const MOM_SECTIONS=["General organisation / Resources","Administrative","Financial","Design","Program","Quality","Others"];
function newMomItem(o){return Object.assign({id:uuid(),ref:"",notes:"",actionWith:"",dueBy:"",status:"",taskId:""},o||{});}
function newMom(o){
  return Object.assign({
    id:uuid(),number:"",date:today(),projectName:"Riviera Tower",preparedBy:"",location:"",
    subcontractor:"",package:"",tenderRef:"",copiesTo:"The meeting participants",
    participants:[],
    sections:MOM_SECTIONS.map(function(t,i){return{id:uuid(),index:String(i+1),title:t,items:[newMomItem()]};}),
    createdAt:today(),createdBy:window._currentUser?window._currentUser.name:""
  },o||{});
}
// "MOM-014 - ACME Construction - 2026-08-19"
function momFileName(m){
  // Keep the name readable: only strip what a file system refuses.
  function clean(v){return String(v||"").trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g," ");}
  var num=clean(m.number)||"MOM";
  var sub=clean(m.subcontractor)||"NO SUBCON";
  var dt=(m.date||today());
  return num+" - "+sub+" - "+dt;
}
// Colours lifted from the Word template's theme: accent1 #00578C is the header blue,
// accent3 #80ABC6 the section band, dk2 #404140 the ink, lt2 #F1F1F0 the light fill.
const MOM_CSS=`
:root{--mom-blue:#00578c;--mom-mid:#4081a9;--mom-light:#80abc6;--mom-ink:#404140;--mom-tint:#f1f1f0;}
body{color:var(--mom-ink)}
.mom-head{display:flex;align-items:flex-start;gap:16px;border-bottom:3px solid var(--mom-blue);padding:4px 0 12px;margin-bottom:16px;page-break-inside:avoid;page-break-after:avoid}
.mom-head .t{flex:1}
.mom-head h1{font-family:'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif;font-weight:700;
  font-size:26px;color:var(--mom-blue);letter-spacing:-.01em;line-height:1.05}
.mom-head .sub{font-size:12px;color:var(--mom-ink);opacity:.75;margin-top:3px}
.mom-head .num{border:2px solid var(--mom-blue);border-radius:6px;padding:8px 14px;text-align:center;min-width:120px}
.mom-head .num b{display:block;font-family:'IBM Plex Mono',monospace;font-size:17px;color:var(--mom-blue);line-height:1.1}
.mom-head .num span{font-size:9px;text-transform:uppercase;letter-spacing:.1em;opacity:.7}
h2{font-family:'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif;font-size:14px;font-weight:700;
  color:#fff;background:var(--mom-blue);padding:5px 11px;border-radius:4px;margin:20px 0 8px;
  text-transform:uppercase;letter-spacing:.06em;border:none;page-break-after:avoid;page-break-inside:avoid}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11.5px}
th{background:var(--mom-blue);color:#fff;font-weight:600;text-align:left;padding:6px 9px;
  border:1px solid var(--mom-blue);font-size:10px;text-transform:uppercase;letter-spacing:.05em}
td{border:1px solid #ccd6de;padding:6px 9px;vertical-align:top}
tr:nth-child(even) td{background:#fafbfc}
table.hdr th{width:130px;background:var(--mom-tint);color:var(--mom-ink);border:1px solid #ccd6de;
  text-transform:none;letter-spacing:0;font-size:11px}
table.hdr td{font-weight:600}
table.hdr tr:nth-child(even) td{background:#fff}
tr.sec td{background:var(--mom-light)!important;color:#0b2d45;font-weight:700;border-color:var(--mom-mid)}
tr.sec td b{font-family:'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif;letter-spacing:.03em;text-transform:uppercase;font-size:12px}
td.no{font-family:'IBM Plex Mono',monospace;color:var(--mom-mid);font-weight:600;white-space:nowrap}
td.late{color:#b3302a;font-weight:700}
.st{display:inline-block;padding:1px 8px;border-radius:10px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.st-open{background:#fdf1e0;color:#b35c00}.st-ongoing{background:#e8f0fe;color:#0f5299}.st-closed{background:#e6f2e9;color:#1e6b3a}
.none{color:#9b968b;font-style:italic}
.foot{margin-top:24px;border-top:1px solid #ccd6de;padding-top:8px;font-size:9px;color:#9b968b;
  display:flex;justify-content:space-between}
`;
function buildMomHtml(m){
  var rows=(m.participants||[]).filter(function(p){return (p.name||"").trim()||(p.company||"").trim();}).map(function(p){
    return '<tr><td><b>'+esc(p.name)+'</b></td><td class="no">'+esc(p.initials)+'</td><td>'+esc(p.company)+'</td><td>'+esc(p.position)+'</td></tr>';
  }).join("");
  function stPill(v){
    var k=(v||"open").toLowerCase();
    var cls=k==="closed"?"st-closed":k==="ongoing"?"st-ongoing":"st-open";
    return '<span class="st '+cls+'">'+esc(k)+'</span>';
  }
  var body="",openCount=0;
  (m.sections||[]).forEach(function(sec){
    var items=(sec.items||[]).filter(function(it){return (it.notes||"").trim()||(it.actionWith||"").trim();});
    body+='<tr class="sec"><td class="no">'+esc(sec.index)+'</td><td colspan="4"><b>'+esc(sec.title)+'</b></td></tr>';
    if(items.length===0){body+='<tr><td></td><td colspan="4" class="none">Nothing raised</td></tr>';return;}
    items.forEach(function(it,k){
      var late=it.dueBy&&it.dueBy<today()&&it.status!=="closed";
      if((it.actionWith||"").trim()&&it.status!=="closed")openCount++;
      body+='<tr><td class="no">'+esc(sec.index+"."+(k+1))+'</td>'+
        '<td>'+esc(it.notes).replace(/\n/g,"<br/>")+'</td>'+
        '<td>'+(it.actionWith?'<b>'+esc(it.actionWith)+'</b>':'<span class="none">—</span>')+'</td>'+
        '<td class="no'+(late?' late':'')+'">'+(it.dueBy?esc(fmtDate(it.dueBy)):"—")+'</td>'+
        '<td>'+stPill(it.status)+'</td></tr>';
    });
  });

  function hdrRow(k,v){return '<tr><th>'+esc(k)+'</th><td>'+(v?esc(v):'<span class="none">—</span>')+'</td></tr>';}

  return '<style>'+MOM_CSS+'</style>'+
    '<div class="mom-head">'+
      '<div class="t"><h1>Minutes of Meeting</h1>'+
      '<div class="sub">'+esc(m.projectName||"")+(m.subcontractor?' &nbsp;·&nbsp; <b>'+esc(m.subcontractor)+'</b>':'')+
      (m.package?' &nbsp;·&nbsp; '+esc(m.package):'')+'</div></div>'+
      '<div class="num"><b>'+esc(m.number||"—")+'</b><span>'+esc(fmtDate(m.date))+'</span>'+
      (m.previousMomNumber?'<span style="font-size:8px;opacity:.6">follows '+esc(m.previousMomNumber)+'</span>':'')+'</div>'+
    '</div>'+
    '<table class="hdr">'+
      hdrRow("Date",fmtDate(m.date))+hdrRow("MoM Number",m.number)+hdrRow("Project name",m.projectName)+
      hdrRow("Subcontractor",m.subcontractor)+hdrRow("Package",m.package)+
      hdrRow("Prepared by",m.preparedBy)+hdrRow("Location",m.location)+hdrRow("Copies to",m.copiesTo)+
    '</table>'+
    '<h2>Participants</h2>'+
    '<table><tr><th>Name</th><th style="width:70px">Initials</th><th style="width:150px">Company</th><th>Position</th></tr>'+
    (rows||'<tr><td colspan="4" class="none">No participant recorded</td></tr>')+'</table>'+
    '<h2>Notes &amp; actions</h2>'+
    '<table><tr><th style="width:46px">No.</th><th>Notes</th><th style="width:120px">Action with</th>'+
    '<th style="width:82px">Due by</th><th style="width:76px">Status</th></tr>'+body+'</table>'+
    '<div class="foot"><span>'+esc(momFileName(m))+'</span>'+
    '<span>'+openCount+' open action'+(openCount!==1?"s":"")+' · generated '+esc(fmtDate(today()))+'</span></div>';
}

function MomView({moms,saveMoms,tenders,packages,people,contractors,tasks,saveTasks,onNavTender,memory,setMemory}){
  var mem=memory||{};
  const [selId,setSelId]=useState(null);
  const [fSub,setFSub]=useState(mem.fSub||"all");
  const [fPkg,setFPkg]=useState(mem.fPkg||"all");
  const [fTender,setFTender]=useState(mem.fTender||"all");
  const [q,setQ]=useState(mem.q||"");
  useEffect(function(){if(setMemory)setMemory({fSub:fSub,fPkg:fPkg,fTender:fTender,q:q});},[fSub,fPkg,fTender,q]);

  var list=moms||[];
  var sel=list.find(function(m){return m.id===selId;});
  function save(next){saveMoms(next);}
  function updM(patch){
    save(list.map(function(m){return m.id!==selId?m:Object.assign({},m,patch);}));
  }
  // A follow-up meeting repeats most of the previous one. Copy the header, the participants
  // and the items that are still open; leave behind what was closed, and the links to the
  // actions already created — otherwise the new MoM would claim someone else's actions.
  function duplicateMom(src){
    var kept=0,dropped=0;
    var sections=(src.sections||[]).map(function(sec){
      var items=(sec.items||[]).filter(function(it){
        var has=(it.notes||"").trim()||(it.actionWith||"").trim();
        if(!has)return false;
        if(it.status==="closed"){dropped++;return false;}
        kept++;return true;
      }).map(function(it){
        return newMomItem({notes:it.notes,actionWith:it.actionWith,dueBy:it.dueBy,status:it.status||"",taskId:""});
      });
      return{id:uuid(),index:sec.index,title:sec.title,items:items.length?items:[newMomItem()]};
    });
    var num=nextNumber();
    if(!safeConfirm("Create "+num+" from "+(src.number||"this MoM")+"?\n\n"+
      "· header, subcontractor, package and participants are copied\n"+
      "· "+kept+" open item"+(kept!==1?"s":"")+" carried over"+(dropped>0?"\n· "+dropped+" closed item"+(dropped!==1?"s":"")+" left behind":"")+
      "\n· today's date, and no link to the actions already created"))return;
    var m=newMom({
      number:num,date:today(),projectName:src.projectName,preparedBy:(window._currentUser?window._currentUser.name:src.preparedBy),
      location:src.location,subcontractor:src.subcontractor,package:src.package,tenderRef:src.tenderRef,
      copiesTo:src.copiesTo,
      participants:(src.participants||[]).map(function(p){return Object.assign({},p,{id:uuid()});}),
      sections:sections,
      previousMomId:src.id,previousMomNumber:src.number||""
    });
    save([m,...list]);
    setSelId(m.id);
  }
  function nextNumber(){
    var nums=list.map(function(m){var d=String(m.number||"").match(/(\d+)\s*$/);return d?parseInt(d[1],10):0;});
    var mx=nums.length?Math.max.apply(null,nums):0;
    return "MOM-"+String(mx+1).padStart(3,"0");
  }

  // ---- list view ----
  if(!sel){
    var subs=[...new Set(list.map(function(m){return m.subcontractor;}).filter(Boolean))].sort();
    var shown=list.filter(function(m){
      if(fSub!=="all"&&m.subcontractor!==fSub)return false;
      if(fPkg!=="all"&&(m.package||"")!==fPkg)return false;
      if(fTender!=="all"&&(m.tenderRef||"")!==fTender)return false;
      if(q.trim()){
        var hay=[m.number,m.subcontractor,m.package,m.location,m.preparedBy].join(" ").toLowerCase();
        if(hay.indexOf(q.trim().toLowerCase())<0)return false;
      }
      return true;
    }).sort(function(a,b){return (b.date||"").localeCompare(a.date||"");});

    function openCount(m){
      var n=0;
      (m.sections||[]).forEach(function(sec){(sec.items||[]).forEach(function(it){
        if((it.actionWith||"").trim()&&it.status!=="closed")n++;
      });});
      return n;
    }

    return <div>
      <div className="page-hdr">
        <div>
          <div className="page-title">Minutes of meeting</div>
          <div className="page-sub">{list.length} MoM{list.length!==1?"s":""}{subs.length?" · "+subs.length+" subcontractors":""}</div>
        </div>
        {!isReadOnly()&&<button className="btn btn-gold" onClick={function(){
          var m=newMom({number:nextNumber(),preparedBy:(window._currentUser?window._currentUser.name:"")});
          save([m,...list]);setSelId(m.id);
        }}>＋ New MoM</button>}
      </div>

      <div className="filter-bar">
        <select value={fSub} onChange={function(e){setFSub(e.target.value);}} style={{width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="all">All subcontractors</option>
          {subs.map(function(x){return <option key={x} value={x}>{x}</option>;})}
        </select>
        <select value={fPkg} onChange={function(e){setFPkg(e.target.value);}} style={{width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="all">All packages</option>
          {(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
        </select>
        <select value={fTender} onChange={function(e){setFTender(e.target.value);}} style={{width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="all">All tenders</option>
          {(tenders||[]).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}
        </select>
        <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔎 Search…" style={{width:170,padding:"4px 9px",fontSize:11}}/>
      </div>

      {shown.length===0
        ?<div className="empty"><div className="empty-ico">📝</div><div className="empty-txt">No minutes yet.</div></div>
        :<table className="tbl">
          <thead><tr><th style={{width:104}}>Number</th><th>Subcontractor</th><th>Package</th>
            <th style={{width:96}}>Date</th><th>Prepared by</th><th style={{width:96,textAlign:"center"}}>Open actions</th><th style={{width:150}}></th></tr></thead>
          <tbody>{shown.map(function(m){
            var oc=openCount(m);
            return <tr key={m.id}>
              <td><span onClick={function(){setSelId(m.id);}} style={{fontFamily:"var(--font-mono)",fontWeight:700,color:"var(--blue,#0f5299)",cursor:"pointer"}}>{m.number||"—"}</span></td>
              <td style={{fontWeight:600}}>{m.subcontractor||"—"}</td>
              <td style={{color:"var(--ink-3,#6f6b62)"}}>{m.package||"—"}</td>
              <td style={{fontFamily:"var(--font-mono)"}}>{fmtDate(m.date)}</td>
              <td style={{color:"var(--ink-3,#6f6b62)"}}>{m.preparedBy||"—"}</td>
              <td style={{textAlign:"center"}}>{oc>0
                ?<span className="badge" style={{background:"var(--amber-soft,#fdf1e0)",color:"var(--amber,#b35c00)"}}>{oc}</span>
                :<span style={{color:"#ddd"}}>—</span>}</td>
              <td style={{textAlign:"right"}}>
                <button className="btn btn-sm" onClick={function(){setSelId(m.id);}}>Open</button>
                <button className="btn btn-sm" style={{marginLeft:4}} onClick={function(){duplicateMom(m);}} title="Start the next meeting from this one">⧉</button>
                <button className="btn btn-sm" style={{marginLeft:4}} onClick={function(){openReport(momFileName(m),buildMomHtml(m));}}>🖨 PDF</button>
              </td>
            </tr>;
          })}</tbody>
        </table>}
    </div>;
  }

  // ---- one MoM ----
  // Anyone who can carry an action: subcontractor records, the Settings list, and the
  // companies already used on this MoM. In a subcontractor meeting the action usually sits
  // with the company, not with one of our own people.
  var ctrNames=[...new Set([].concat(
    (contractors||[]).map(function(c){return c.name;}),
    (window._ppSubList||[]),
    (moms||[]).map(function(m){return m.subcontractor;})
  ).filter(Boolean))].sort(function(a,b){return a.localeCompare(b);});
  function updSection(si,patch){
    updM({sections:(sel.sections||[]).map(function(s2,i){return i!==si?s2:Object.assign({},s2,patch);})});
  }
  function updItem(si,ii,patch){
    var sec=(sel.sections||[])[si];
    updSection(si,{items:(sec.items||[]).map(function(it,k){return k!==ii?it:Object.assign({},it,patch);})});
  }
  function pushToActions(si,ii){
    var sec=(sel.sections||[])[si], it=(sec.items||[])[ii];
    if(!(it.notes||"").trim()){safeAlert("Write the note first — it becomes the action text.");return;}
    if(it.taskId&&(tasks||[]).some(function(t){return t.id===it.taskId;})){safeAlert("This item is already in the action list.");return;}
    // `owner` is one of our people; a company goes to contractorRef so the action still
    // shows who owes it without inventing a fake person.
    var isPerson=(people||[]).indexOf(it.actionWith)>=0;
    var t=newTask({
      text:it.notes.trim(),
      owner:isPerson?it.actionWith:(sel.preparedBy||""),
      contractorName:isPerson?"":(it.actionWith||""),
      due:it.dueBy||"",
      package:sel.package||"",tenderRef:sel.tenderRef||"",
      note:"From "+(sel.number||"MoM")+" · "+(sel.subcontractor||"")+" · "+fmtDate(sel.date)+" · §"+sec.index+"."+(ii+1)+
        (isPerson?"":"\nAction with: "+(it.actionWith||"—")+" (subcontractor)")
    });
    saveTasks([t,...(tasks||[])]);
    updItem(si,ii,{taskId:t.id});
  }

  return <div>
    <div className="page-hdr">
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button className="btn btn-sm" onClick={function(){setSelId(null);}}>← All minutes</button>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn" onClick={function(){duplicateMom(sel);}} title="Create the next meeting from this one">⧉ Duplicate</button>
        <button className="btn" onClick={function(){openReport(momFileName(sel),buildMomHtml(sel));}}>🖨 Print / PDF</button>
        {mayDelete()&&<button className="btn btn-danger" onClick={function(){
          if(blockIfReadOnly())return;
          if(!safeConfirm("Delete "+(sel.number||"this MoM")+"?\n\nActions already pushed to the action list are kept, and keep their reference to this number.\n\nThis cannot be undone."))return;
          save(list.filter(function(m){return m.id!==sel.id;}));setSelId(null);
        }}>🗑 Delete MoM</button>}
      </div>
    </div>

    <div className="titleblock" style={{display:"flex",alignItems:"stretch",overflow:"hidden",
      border:"1.5px solid var(--ink,#16181d)",borderRadius:8,background:"#fff",marginBottom:16}}>
      <div className="tb-main" style={{flex:1,minWidth:0,padding:"12px 16px"}}>
        <div className="tb-eyebrow" style={{fontSize:11,fontWeight:600,letterSpacing:".09em",textTransform:"uppercase",color:"var(--ink-3,#6f6b62)",marginBottom:3}}>Minutes of meeting</div>
        <h2 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-page,24px)",lineHeight:1.08}}>
          {sel.number||"—"} · {sel.subcontractor||"no subcontractor"}</h2>
        <div className="tb-sub" style={{fontSize:12,color:"var(--ink-3,#6f6b62)",marginTop:3}}>
          File name: <span style={{fontFamily:"var(--font-mono)"}}>{momFileName(sel)}</span>
          {sel.previousMomNumber&&<span style={{marginLeft:8}}>· follows <b>{sel.previousMomNumber}</b></span>}</div>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginBottom:16}}>
      {[["number","MoM Number","text"],["date","Date","date"],["projectName","Project name","text"],
        ["preparedBy","Prepared by","people"],["location","Location","text"],["subcontractor","Subcontractor","sub"],
        ["package","Package","pkg"],["tenderRef","Tender","tender"],["copiesTo","Copies to","text"]].map(function(f){
        return <div className="fg" key={f[0]}>
          <label>{f[1]}</label>
          {f[2]==="date"
            ?<input type="date" min="1990-01-01" max="2200-12-31" value={sel[f[0]]||""} onChange={function(e){updM({[f[0]]:e.target.value});}}/>
            :f[2]==="people"
              ?<select value={sel[f[0]]||""} onChange={function(e){updM({[f[0]]:e.target.value});}}>
                <option value="">—</option>{(people||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}</select>
            :f[2]==="sub"
              ?<select value={sel[f[0]]||""} onChange={function(e){updM({[f[0]]:e.target.value});}}>
                <option value="">—</option>{ctrNames.map(function(p){return <option key={p} value={p}>{p}</option>;})}</select>
            :f[2]==="pkg"
              ?<select value={sel[f[0]]||""} onChange={function(e){updM({[f[0]]:e.target.value});}}>
                <option value="">—</option>{(packages||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}</select>
            :f[2]==="tender"
              ?<select value={sel[f[0]]||""} onChange={function(e){updM({[f[0]]:e.target.value});}}>
                <option value="">—</option>{(tenders||[]).map(function(t){return <option key={t.id} value={t.id}>{t.title}</option>;})}</select>
            :<input type="text" value={sel[f[0]]||""} onChange={function(e){updM({[f[0]]:e.target.value});}}/>}
        </div>;
      })}
    </div>

    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)"}}>Participants</h3>
      <button className="btn btn-sm" style={{marginLeft:"auto"}}
        onClick={function(){updM({participants:[...(sel.participants||[]),{id:uuid(),name:"",initials:"",company:"",position:""}]});}}>＋ Participant</button>
    </div>
    <table className="tbl" style={{fontSize:12,marginBottom:8}}>
      <thead><tr><th>Name</th><th style={{width:90}}>Initials</th><th style={{width:150}}>Company</th><th>Position</th><th style={{width:34}}></th></tr></thead>
      <tbody>{(sel.participants||[]).map(function(p,i){
        return <tr key={p.id||i}>
          {["name","initials","company","position"].map(function(k){
            return <td key={k}><input type="text" value={p[k]||""} style={{fontSize:11,padding:"4px 6px"}}
              onChange={function(e){updM({participants:(sel.participants||[]).map(function(x,j){return j!==i?x:Object.assign({},x,{[k]:e.target.value});})});}}/></td>;
          })}
          <td style={{textAlign:"center"}}><button onClick={function(){updM({participants:(sel.participants||[]).filter(function(_,j){return j!==i;})});}}
            style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13}}>🗑</button></td>
        </tr>;
      })}
      {(sel.participants||[]).length===0&&<tr><td colSpan={5} style={{color:"var(--ink-4,#9b968b)",fontSize:12}}>No participant yet.</td></tr>}
      </tbody>
    </table>

    <div className="sheet-h" style={{display:"flex",alignItems:"baseline",gap:9,margin:"22px 0 9px",paddingBottom:6,borderBottom:"1.5px solid var(--rule,#ddd9cf)"}}>
      <h3 style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:"var(--fs-title,18px)"}}>Notes &amp; actions</h3>
      <span className="hint" style={{fontSize:"var(--fs-small,12px)",color:"var(--ink-3,#6f6b62)"}}>an item with an owner can be pushed into the action list</span>
    </div>

    {(sel.sections||[]).map(function(sec,si){
      return <div key={sec.id} style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#f0ede6",borderRadius:7,marginBottom:6}}>
          <span style={{fontFamily:"var(--font-mono)",fontWeight:700,fontSize:12}}>{sec.index}</span>
          <input type="text" value={sec.title||""} onChange={function(e){updSection(si,{title:e.target.value});}}
            style={{flex:1,border:"none",background:"transparent",fontWeight:700,fontSize:13,padding:"2px 0"}}/>
          <button className="btn btn-sm" onClick={function(){updSection(si,{items:[...(sec.items||[]),newMomItem()]});}}>＋ Item</button>
        </div>
        <table className="tbl" style={{fontSize:12}}>
          <thead><tr><th style={{width:52}}>No.</th><th>Notes</th><th style={{width:140}}>Action with</th>
            <th style={{width:126}}>Due by</th><th style={{width:110}}>Status</th><th style={{width:120}}></th></tr></thead>
          <tbody>{(sec.items||[]).map(function(it,ii){
            var linked=it.taskId&&(tasks||[]).some(function(t){return t.id===it.taskId;});
            return <tr key={it.id}>
              <td style={{fontFamily:"var(--font-mono)",color:"var(--ink-3,#6f6b62)"}}>{sec.index}.{ii+1}</td>
              <td><textarea value={it.notes||""} onChange={function(e){updItem(si,ii,{notes:e.target.value});}}
                placeholder="What was said, decided or requested…" style={{minHeight:42,fontSize:12,padding:"5px 7px"}}/></td>
              <td><select value={it.actionWith||""} onChange={function(e){updItem(si,ii,{actionWith:e.target.value});}} style={{fontSize:11,padding:"4px 6px"}}>
                <option value="">—</option>
                {sel.subcontractor&&<option value={sel.subcontractor}>{sel.subcontractor}</option>}
                <optgroup label="Subcontractors">
                  {ctrNames.filter(function(p){return p!==sel.subcontractor;}).map(function(p){return <option key={"c"+p} value={p}>{p}</option>;})}
                </optgroup>
                <optgroup label="Our team">
                  {(people||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
                </optgroup>
              </select></td>
              <td><input type="date" min="1990-01-01" max="2200-12-31" value={it.dueBy||""} onChange={function(e){updItem(si,ii,{dueBy:e.target.value});}}
                style={{fontSize:11,padding:"3px 5px"}}/></td>
              <td><select value={it.status||""} onChange={function(e){updItem(si,ii,{status:e.target.value});}}
                style={{fontSize:11,padding:"4px 6px",fontWeight:700,
                  color:it.status==="closed"?"var(--green,#1e6b3a)":it.status==="ongoing"?"var(--amber,#b35c00)":"var(--ink-3,#6f6b62)"}}>
                <option value="">open</option><option value="ongoing">ongoing</option><option value="closed">closed</option>
              </select></td>
              <td style={{textAlign:"right"}}>
                {linked
                  ?<span className="badge" style={{background:"var(--green-soft,#e6f2e9)",color:"var(--green,#1e6b3a)"}}>✓ in actions</span>
                  :<button className="btn btn-sm" disabled={!(it.notes||"").trim()} onClick={function(){pushToActions(si,ii);}}
                    title="Create an action in the app from this item">→ action</button>}
                <button onClick={function(){updSection(si,{items:(sec.items||[]).filter(function(_,k){return k!==ii;})});}}
                  style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13,marginLeft:4}}>🗑</button>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>;
    })}
  </div>;
}

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
              return <th key={w} title={"Week of "+fmtDate(w)+" — ends Sunday "+fmtDate(addCalDays(w,6))}
                style={{width:COL,minWidth:COL,padding:"5px 2px",textAlign:"center",
                background:isNow?"var(--ink,#16181d)":"#faf9f7",color:isNow?"#fff":"var(--ink-3,#6f6b62)",
                borderBottom:"1.5px solid var(--rule,#ddd9cf)",borderLeft:"1px solid var(--rule-2,#efece5)",
                borderRight:"7px solid "+(isNow?"#3a3d45":"#e4e1d8"),
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
                // A strip on the right edge of each column marks the Sunday, so weeks read
                // as blocks instead of an undifferentiated grid.
                return <td key={w} style={{width:COL,minWidth:COL,height:38,padding:2,verticalAlign:"middle",
                  borderBottom:"1px solid var(--rule-2,#efece5)",borderLeft:"1px solid var(--rule-2,#efece5)",
                  borderRight:"7px solid "+(isNow?"#e4e1d8":"#eeebe3"),
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
            <tr><td style={{width:110,color:"var(--ink-3,#6f6b62)"}}>Owner</td>
              <td><select value={sel.owner||""} onChange={function(e){
                  var v=e.target.value;
                  saveTasks((tasks||[]).map(function(x){return x.id!==sel.id?x:stampModified(Object.assign({},x,{owner:v}));}));
                  setSel(Object.assign({},sel,{owner:v}));
                }} style={{width:"100%",fontSize:12,padding:"4px 7px"}}>
                <option value="">— unassigned —</option>
                {(people||[]).map(function(p){return <option key={p} value={p}>{p}</option>;})}
              </select></td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Due</td>
              <td style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <input type="date" min="1990-01-01" max="2200-12-31" value={sel.due||""}
                  onChange={function(e){
                    var v=e.target.value;
                    saveTasks((tasks||[]).map(function(x){return x.id!==sel.id?x:stampModified(Object.assign({},x,{due:v}));}));
                    setSel(Object.assign({},sel,{due:v}));
                  }}
                  style={{width:150,fontSize:12,padding:"4px 7px",
                    borderColor:sel.due?"var(--rule,#ddd9cf)":"var(--amber,#b35c00)"}}/>
                {!sel.due&&[["this Friday",5],["in 2 weeks",14],["in a month",30]].map(function(o){
                  return <button key={o[0]} className="btn btn-sm" style={{padding:"3px 9px",fontSize:10}}
                    onClick={function(){
                      var v=o[1]===5?(function(){var d=new Date(today());var g=d.getDay();d.setDate(d.getDate()+((5-(g===0?7:g))+7)%7||7);return toISO(d);})()
                            :addCalDays(today(),o[1]);
                      saveTasks((tasks||[]).map(function(x){return x.id!==sel.id?x:stampModified(Object.assign({},x,{due:v}));}));
                      setSel(Object.assign({},sel,{due:v}));
                    }}>{o[0]}</button>;
                })}
                {!sel.due&&<div style={{fontSize:10,color:"var(--amber,#b35c00)",width:"100%"}}>Without a date this action cannot sit on the frieze.</div>}
              </td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Status</td><td>{sel.status||"pending"}</td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Zone</td><td>{sel.zone||"—"}</td></tr>
            <tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Package</td><td>{sel.package||"—"}</td></tr>
            {sel.note&&<tr><td style={{color:"var(--ink-3,#6f6b62)"}}>Note</td><td style={{whiteSpace:"pre-wrap"}}>{sel.note}</td></tr>}
          </tbody></table>
        </div>
        <div className="modal-footer">
          {mayDelete()&&<button className="btn btn-danger" style={{marginRight:"auto"}}
            onClick={function(){
              if(blockIfReadOnly())return;
              if(!safeConfirm("Delete this action?\n\n“"+(sel.text||"")+"”\n\nThis cannot be undone."))return;
              saveTasks((tasks||[]).filter(function(x){return x.id!==sel.id;}));
              setSel(null);
            }}>🗑 Delete</button>}
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

