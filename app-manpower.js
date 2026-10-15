// ===========================================================================
// app-manpower.js — Manpower: plan in workers, budget in hours, real hours, variances.
//
// Two registers, one Firestore document each:
//   pp_manpower_plan  plan lines — {id, label, company, workers, start, end (Mondays, inclusive),
//                     hpw (hours per worker per week), byWeek:{monday: workers}, note}
//                     byWeek overrides the head count for one week (the histogram cells).
//   pp_manpower       one entry per week — {id, week (Monday), real:[{company, activity, src, hours}], note,
//                     approved, planned, updatedBy, updatedAt}
//                     real = hours really spent, by company and by activity (activity optional; it
//                     matches the plan line names, so budget and real meet per activity), typed or pasted
//                     from the time-keeping app. src (optional) = the activity's name in the imported
//                     file, kept next to the webapp WBS it was matched to (activity), so both can be
//                     filtered. approved / planned are the older manual figures:
//                     approved is still used as the week's budget when no plan line covers it.
//
// Budget of a week = Σ plan lines (workers that week × hours per worker per week).
// A week's hours are spread over its working days (Mon–Sat) to build the months, so a week
// across two months is split between them.
// Cut-off = the last week with real hours entered: "to date" figures stop there, the plan after it
// is the remaining budget, and the forecast at completion = real to date + remaining budget.
//
// Loaded after app-concrete.js and BEFORE app-mount.js. Shared scope: uuid, today, toISO,
// parseISODate, isValidDate, fmtDate, isAppAdmin, safeAlert, addCalDays, _flowMonday (app-core /
// app-tenders), _stParseNum (app-steel), InvModal, InvBig, invFmt, _invNum, invCanDelete,
// _invUpsert, _invRemove (app-inventory), normCompanyName (app-tenders), ppPrompt (app-core).
// ===========================================================================

var MP_COL_BUDGET="#a8862e";     // budget (plan) series
var MP_COL_REAL="#2b6cb0";       // real series
var MP_COMPANY_COLS=["#2b6cb0","#c2378a","#2e7d32","#d85a30","#7b1fa2","#00838f","#8d6e63","#5c6bc0"];
var MP_TOP=7;                    // companies drawn on their own in the chart; the rest = "Others"
var MP_DEFAULT_HPW=48;           // hours per worker per week offered for a new plan line
var MP_WORK_DAYS=6;              // Mon–Sat: how a week's hours are split between months
var MP_WARN=10,MP_ALERT=20;      // |variance| % flagged amber / red

function newManpowerWeek(o){
  return Object.assign({id:uuid(),week:_flowMonday(today()),approved:"",planned:"",real:[],note:"",
    updatedBy:"",updatedAt:""},o||{});
}
function newMpPlanLine(o){
  var m=_flowMonday(today());
  return Object.assign({id:uuid(),label:"",company:"",workers:"",start:m,end:addCalDays(m,7*11),hpw:MP_DEFAULT_HPW,byWeek:{},note:""},o||{});
}
function mpHas(v){return v!==undefined&&v!==null&&v!==""&&isFinite(Number(v));}
function mpReal(w){return (w.real||[]).reduce(function(s,r){return s+_invNum(r.hours);},0);}
function mpIsoWeek(iso){
  var d=parseISODate(iso);if(!d)return"";
  var t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  var day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);
  var y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil(((t-y0)/86400000+1)/7);
}
function mpWeekLabel(iso){return "W"+mpIsoWeek(iso)+" · "+fmtDate(iso);}
// Company names are typed by hand: compare without case, accents, punctuation or legal suffixes.
function mpCompanyKey(s){
  return (typeof normCompanyName==="function"?normCompanyName(s):String(s||"").toLowerCase().trim())||String(s||"").trim().toLowerCase();
}
// Activities are typed by hand too: compare without case, accents or punctuation.
function mpActKey(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function mpPct(a,b){return b?Math.round(a/b*100):null;}
function mpFmtH(v){return v===null||v===undefined||!isFinite(v)?"—":invFmt(v,0);}
function mpSigned(v){if(v===null||v===undefined||!isFinite(v))return"—";return (v>0?"+":"")+invFmt(v,0);}

function mpMonthLabel(k){
  var p=String(k).split("-");if(p.length<2)return k;
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(p[1])-1]+" "+p[0];
}
function mpVarCol(pct){if(pct===null||!isFinite(pct))return"#9b968b";var a=Math.abs(pct);return a>MP_ALERT?"#b3302a":a>MP_WARN?"#b35c00":"#1e6b3a";}
// Mondays from a to b, inclusive.
function mpWeeksBetween(a,b){
  var out=[];if(!isValidDate(a)||!isValidDate(b))return out;
  var w=_flowMonday(a),e=_flowMonday(b),g=0;
  while(w<=e&&g<600){out.push(w);w=addCalDays(w,7);g++;}
  return out;
}
function mpLineHpw(l){return mpHas(l.hpw)?Number(l.hpw):MP_DEFAULT_HPW;}
function mpLineWorkers(l,w){
  if(!isValidDate(l.start)||!isValidDate(l.end)||w<l.start||w>l.end)return 0;
  var o=(l.byWeek||{})[w];
  return mpHas(o)?Number(o):_invNum(l.workers);
}
function mpLineTotal(l){return mpWeeksBetween(l.start,l.end).reduce(function(s,w){return s+mpLineWorkers(l,w)*mpLineHpw(l);},0);}
// Share of a week's hours falling in each month (by working day).
function mpMonthShares(w){
  var m={};
  for(var d=0;d<MP_WORK_DAYS;d++){var k=addCalDays(w,d).slice(0,7);m[k]=(m[k]||0)+1/MP_WORK_DAYS;}
  return m;
}

// "Company<TAB>hours" or "Company<TAB>activity<TAB>hours" lines, as copied from Excel or from the
// time-keeping app's export. The same company + activity twice is added up; a header line or a
// line without a number is skipped.
function mpParseCompanyPaste(text){
  var out=[],skipped=0;
  String(text||"").split(/\r?\n/).forEach(function(line){
    if(!line.trim())return;
    var cells=line.split(/\t|;|\s{2,}/).map(function(c){return c.trim();}).filter(function(c){return c!=="";});
    if(cells.length<2){var m=/^(.*?\S)\s+(\d[\d.,\s]*)$/.exec(line.trim());if(m)cells=[m[1],m[2]];}
    if(cells.length<2){skipped++;return;}
    var h=_stParseNum(cells[cells.length-1]);
    var name=cells[0].trim(),act=cells.length>2?cells.slice(1,cells.length-1).join(" ").trim():"";
    if(!name||!isFinite(h)||h===0&&!/^0+([.,]0+)?$/.test(cells[cells.length-1])){skipped++;return;}
    var hit=out.find(function(r){return mpCompanyKey(r.company)===mpCompanyKey(name)&&mpActKey(r.activity)===mpActKey(act);});
    if(hit)hit.hours=_invNum(hit.hours)+h;else out.push({company:name,activity:act,hours:h});
  });
  return {rows:out,skipped:skipped};
}

// Everything the views show, from the plan and the weekly entries.
function mpModel(plan,weeks,opt){
  opt=opt||{};
  plan=(plan||[]).filter(function(l){return isValidDate(l.start)&&isValidDate(l.end);});
  var entries={};(weeks||[]).forEach(function(e){if(isValidDate(e.week))entries[_flowMonday(e.week)]=e;});
  var set={};
  plan.forEach(function(l){mpWeeksBetween(l.start,l.end).forEach(function(w){set[w]=1;});});
  Object.keys(entries).forEach(function(w){set[w]=1;});
  var all=Object.keys(set).sort();
  var cutoff="";all.forEach(function(w){var e=entries[w];if(e&&(e.real||[]).length)cutoff=w;});
  if(opt.cutoff!==undefined)cutoff=opt.cutoff;     // a filtered view keeps the cut-off of the whole project
  var comp={};
  function C(name){
    var k=mpCompanyKey(name)||"(no company)";
    return comp[k]||(comp[k]={key:k,name:String(name||"").trim()||"(no company)",budget:0,budgetToDate:0,real:0,weeks:{}});
  }
  // Activities: budget from the plan line names, real from the activity typed on each real line.
  var acts={};
  function A(name){
    var k=mpActKey(name)||"(no activity)";
    return acts[k]||(acts[k]={key:k,name:String(name||"").trim()||"(no activity)",budget:0,budgetToDate:0,real:0,weeks:{},byCompany:{},bySrc:{}});
  }
  // File activities (name in the imported file): real only, with the WBS they were matched to.
  var srcs={};
  function S(name){
    var k=mpActKey(name)||"(not imported)";
    return srcs[k]||(srcs[k]={key:k,name:String(name||"").trim()||"(not imported)",real:0,weeks:{},byWbs:{}});
  }
  var rows=[],cB=0,cR=0,cBd=0,peak=0,peakWeek="";
  all.forEach(function(w){
    var e=entries[w]||null,covered=false,workers=0,budget=0;
    plan.forEach(function(l){
      var n=mpLineWorkers(l,w);if(!n&&!(w>=l.start&&w<=l.end))return;
      covered=true;workers+=n;var h=n*mpLineHpw(l);budget+=h;
      if(l.company){var c=C(l.company);c.budget+=h;if(cutoff&&w<=cutoff)c.budgetToDate+=h;}
      if(l.label){var a=A(l.label);a.budget+=h;if(cutoff&&w<=cutoff)a.budgetToDate+=h;}
    });
    var src=covered?"plan":"";
    if(!covered&&e&&mpHas(e.approved)){budget=Number(e.approved);src="manual";}
    var hasR=!!(e&&((e.real||[]).length||e._had)),real=hasR?mpReal(e):0;
    if(hasR)(e.real||[]).forEach(function(r){
      var h=_invNum(r.hours),c=C(r.company);c.real+=h;c.weeks[w]=(c.weeks[w]||0)+h;
      var a=A(r.activity);a.real+=h;a.weeks[w]=(a.weeks[w]||0)+h;
      var cn=String(r.company||"").trim()||"(no company)";a.byCompany[cn]=(a.byCompany[cn]||0)+h;
      if(r.src)a.bySrc[r.src]=(a.bySrc[r.src]||0)+h;
      var s_=S(r.src);s_.real+=h;s_.weeks[w]=(s_.weeks[w]||0)+h;
      var wn=String(r.activity||"").trim()||"(no WBS)";s_.byWbs[wn]=(s_.byWbs[wn]||0)+h;
    });
    cB+=budget;if(hasR)cR+=real;
    var toDate=!!cutoff&&w<=cutoff;if(toDate)cBd+=budget;
    if(workers>peak){peak=workers;peakWeek=w;}
    rows.push({week:w,entry:e,workers:workers,budget:budget,src:src,real:real,hasR:hasR,toDate:toDate,
      diff:hasR?real-budget:null,pct:hasR&&budget?Math.round((real-budget)/budget*100):null,cumB:cB,cumR:cR,cumBd:cBd});
  });
  // months: each week split over its working days
  var mon={};
  rows.forEach(function(r){
    var sh=mpMonthShares(r.week);
    Object.keys(sh).forEach(function(k){
      var m=mon[k]||(mon[k]={month:k,budget:0,budgetToDate:0,real:0,hasR:false});
      m.budget+=r.budget*sh[k];
      if(r.toDate)m.budgetToDate+=r.budget*sh[k];
      if(r.hasR){m.real+=r.real*sh[k];m.hasR=true;}
    });
  });
  var months=Object.keys(mon).sort().map(function(k){return mon[k];});
  var mb=0,mr=0,mbd=0;
  months.forEach(function(m){mb+=m.budget;mr+=m.real;mbd+=m.budgetToDate;m.cumB=mb;m.cumR=mr;m.cumBd=mbd;
    m.diff=m.hasR?m.real-m.budgetToDate:null;m.pct=m.hasR&&m.budgetToDate?Math.round((m.real-m.budgetToDate)/m.budgetToDate*100):null;});
  var tot={budget:cB,budgetToDate:cBd,real:cR,remaining:cB-cBd,eac:cR+(cB-cBd),
    diff:cutoff?cR-cBd:null,pct:cutoff&&cBd?Math.round((cR-cBd)/cBd*100):null,
    peak:peak,peakWeek:peakWeek,start:all[0]||"",end:all[all.length-1]||"",cutoff:cutoff,weeks:all.length};
  tot.eacDiff=tot.eac-cB;
  var companies=Object.keys(comp).map(function(k){return comp[k];}).sort(function(a,b){return (b.real+b.budget)-(a.real+a.budget);});
  var activities=Object.keys(acts).map(function(k){return acts[k];}).sort(function(a,b){return (b.real+b.budget)-(a.real+a.budget);});
  var srcList=Object.keys(srcs).map(function(k){return srcs[k];}).sort(function(a,b){return b.real-a.real;});
  return {rows:rows,months:months,tot:tot,companies:companies,activities:activities,srcs:srcList,plan:plan};
}

// Plan and weeks narrowed to one webapp WBS and/or one file activity. The budget follows the WBS:
// the plan lines of the chosen WBS, or — for a file activity alone — of the WBS its hours were
// matched to.
function mpFilter(plan,weeks,fWbs,fSrc){
  if(!fWbs&&!fSrc)return {plan:plan,weeks:weeks};
  var wk=fWbs?mpActKey(fWbs):"",sk=fSrc?mpActKey(fSrc):"";
  function ok(r){return (!fWbs||mpActKey(r.activity)===wk)&&(!fSrc||mpActKey(r.src)===sk);}
  var wbsSet={};if(fWbs)wbsSet[wk]=1;
  var w2=weeks.map(function(e){
    var rs=(e.real||[]).filter(ok);
    if(!fWbs)rs.forEach(function(r){if(r.activity)wbsSet[mpActKey(r.activity)]=1;});
    return Object.assign({},e,{real:rs,_had:(e.real||[]).length>0,approved:""});
  });
  return {plan:plan.filter(function(l){return l.label&&wbsSet[mpActKey(l.label)];}),weeks:w2};
}

// ---------------------------------------------------------------- view
function ManpowerView({weeks,saveWeeks,plan,savePlan,contractors,canEdit,currentUser}){
  weeks=weeks||[];plan=plan||[];
  const [tab,setTab]=useState(plan.length||weeks.length?"overview":"plan");
  const [edit,setEdit]=useState(null);       // week entry being edited
  const [importing,setImporting]=useState(false);
  const [fWbs,setFWbs]=useState("");         // filter: webapp WBS (activity / plan line name)
  const [fSrc,setFSrc]=useState("");         // filter: activity name in the imported file
  var can=canEdit&&!window._ppReadOnly;
  var M0=mpModel(plan,weeks);
  var filtered=!!(fWbs||fSrc);
  var F=mpFilter(plan,weeks,fWbs,fSrc);
  var M=filtered?mpModel(F.plan,F.weeks,{cutoff:M0.tot.cutoff}):M0;
  // Company names offered while typing: subcontractors first, then every name already used.
  var known=[];
  (contractors||[]).forEach(function(c){if(c.name&&known.indexOf(c.name)<0)known.push(c.name);});
  M0.companies.forEach(function(c){if(c.name!=="(no company)"&&known.indexOf(c.name)<0)known.push(c.name);});
  // Activities offered while typing: the plan line names first, then every activity already used.
  var knownActs=[];
  plan.forEach(function(l){if(l.label&&knownActs.indexOf(l.label)<0)knownActs.push(l.label);});
  M0.activities.forEach(function(a){if(a.name!=="(no activity)"&&!knownActs.some(function(x){return mpActKey(x)===a.key;}))knownActs.push(a.name);});
  // File activities offered in the filter: those met with the chosen WBS, or all of them.
  var srcOpts=[];
  weeks.forEach(function(e){(e.real||[]).forEach(function(r){
    if(!r.src||fWbs&&mpActKey(r.activity)!==mpActKey(fWbs))return;
    if(!srcOpts.some(function(x){return mpActKey(x)===mpActKey(r.src);}))srcOpts.push(r.src);
  });});
  srcOpts.sort(function(a,b){return a.localeCompare(b);});

  function openWeek(w){
    var e=weeks.find(function(x){return _flowMonday(x.week)===w;});
    if(e)setEdit(Object.assign({},e,{real:(e.real||[]).map(function(r){return Object.assign({},r);})}));
    else{
      var prev=weeks.slice().sort(function(a,b){return b.week.localeCompare(a.week);})[0];
      setEdit(newManpowerWeek({week:w,real:prev?(prev.real||[]).map(function(r){return {company:r.company,activity:r.activity||"",hours:""};}):[]}));
    }
  }
  function openNew(){
    var prev=weeks.slice().sort(function(a,b){return b.week.localeCompare(a.week);})[0];
    openWeek(prev?addCalDays(_flowMonday(prev.week),7):_flowMonday(today()));
  }
  function saveWeek(w){
    if(blockIfReadOnly())return;
    var clash=weeks.find(function(x){return _flowMonday(x.week)===w.week&&x.id!==w.id;});
    if(clash){safeAlert("The week of "+fmtDate(w.week)+" is already entered. Open it in the list to change it.");return;}
    var doc=Object.assign({},w,{approved:mpHas(w.approved)?Number(w.approved):"",real:(w.real||[]).filter(function(r){return String(r.company||"").trim()||mpHas(r.hours);})
      .map(function(r){
        // an activity matching a plan line (case, accents aside) takes the plan line's exact name
        var act=String(r.activity||"").trim(),hit=act?plan.find(function(l){return l.label&&mpActKey(l.label)===mpActKey(act);}):null;
        var o={company:String(r.company||"").trim(),activity:hit?hit.label:act,hours:mpHas(r.hours)?Number(r.hours):0};
        if(String(r.src||"").trim())o.src=String(r.src).trim();
        return o;}),
      updatedBy:currentUser||"",updatedAt:today()});
    _invUpsert(weeks,saveWeeks,doc);setEdit(null);
  }
  function delWeek(w){
    if(!invCanDelete()){safeAlert("Deleting is not allowed for your account.");return;}
    if(_invRemove(weeks,saveWeeks,w,"the week of "+fmtDate(w.week)))setEdit(null);
  }
  function exportCsv(){
    var names=M.companies.map(function(c){return c.name;});
    var rows=[["Week","Monday","Planned workers","Budget h","Real h","Variance h","Variance %","Cumulative budget h","Cumulative real h"].concat(names)];
    M.rows.forEach(function(r){
      var byC={};((r.entry&&r.entry.real)||[]).forEach(function(x){var k=mpCompanyKey(x.company)||"(no company)";byC[k]=(byC[k]||0)+_invNum(x.hours);});
      rows.push(["W"+mpIsoWeek(r.week),r.week,r.workers,Math.round(r.budget),r.hasR?r.real:"",r.diff===null?"":Math.round(r.diff),r.pct===null?"":r.pct,Math.round(r.cumB),r.hasR?r.cumR:""]
        .concat(M.companies.map(function(c){return byC[c.key]||"";})));
    });
    rows.push([]);rows.push(["Activity","","","Budget h","Budget to date h","Real h","Variance h (vs budget to date)"]);
    M.activities.forEach(function(a){rows.push([a.name,"","",Math.round(a.budget),Math.round(a.budgetToDate),a.real,a.real-a.budgetToDate]);});
    if(M.srcs.some(function(x){return x.key!=="(not imported)";})){
      rows.push([]);rows.push(["File activity","WBS (webapp)","","","","Real h"]);
      M.srcs.forEach(function(x){Object.keys(x.byWbs).forEach(function(wn){rows.push([x.name,wn,"","","",x.byWbs[wn]]);});});
    }
    rows.push([]);rows.push(["Month","","","Budget h","Real h","Variance h (vs budget to date)","Variance %"]);
    M.months.forEach(function(m){rows.push([mpMonthLabel(m.month),"","",Math.round(m.budget),m.hasR?Math.round(m.real):"",m.diff===null?"":Math.round(m.diff),m.pct===null?"":m.pct]);});
    var csv=rows.map(function(r){return r.map(function(v){v=String(v===undefined||v===null?"":v);return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(";");}).join("\n");
    var a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
    a.download="manpower_"+(filtered?mpActKey(fWbs||fSrc).replace(/ /g,"_").slice(0,40)+"_":"")+today()+".csv";document.body.appendChild(a);a.click();a.remove();
  }

  var TABS=[["overview","📊 Overview"],["plan","🧮 Plan"],["weeks","🗓 Weeks"],["months","📅 Months"],["companies","🏢 Companies"],["activities","🛠 Activities"]];
  var empty=!plan.length&&!weeks.length;
  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">👷 Manpower</div>
        <div className="page-sub">Plan the workers week by week → budget in hours per week, per month and in total. Real hours per week by company → variances.</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        {!can&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Manpower editor”"}</span>}
        {!empty&&<button className="btn btn-sm" onClick={exportCsv} title="Weeks and months, budget, real and variances, one column per company (Excel opens it)">⬇ CSV</button>}
        {can&&<button className="btn btn-sm" onClick={function(){setImporting(true);}} title="Real hours from an Excel or CSV file: weeks as numbers or dates, activities matched to the webapp's">⬆ Import Excel</button>}
        {can&&<button className="btn btn-pri btn-sm" onClick={openNew} title="Real hours of a week, by company">＋ Real hours</button>}
      </div>
    </div>
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
      {(knownActs.length>0||srcOpts.length>0||filtered)&&tab!=="plan"&&<span style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginLeft:8}}>
        <select value={fWbs} onChange={function(e){setFWbs(e.target.value);setFSrc("");}} title="Webapp WBS (plan line / activity of the real hours)"
          style={{padding:"3px 6px",fontSize:12,maxWidth:220,background:fWbs?"#fff8e1":"#fff"}}>
          <option value="">All WBS</option>{knownActs.map(function(a){return <option key={a} value={a}>{a}</option>;})}</select>
        {(srcOpts.length>0||fSrc)&&<select value={fSrc} onChange={function(e){setFSrc(e.target.value);}} title="Activity as named in the imported Excel file"
          style={{padding:"3px 6px",fontSize:12,maxWidth:260,background:fSrc?"#fff8e1":"#fff"}}>
          <option value="">All file activities</option>{srcOpts.map(function(a){return <option key={a} value={a}>{a}</option>;})}</select>}
        {filtered&&<button className="btn btn-sm" onClick={function(){setFWbs("");setFSrc("");}}>✕ Clear</button>}
      </span>}
      {M.tot.cutoff&&<span style={{marginLeft:"auto",fontSize:11,color:"#888"}} title="Last week with real hours entered: “to date” figures stop there">Cut-off <b>W{mpIsoWeek(M.tot.cutoff)}</b> · {fmtDate(M.tot.cutoff)}</span>}
    </div>
    {empty&&tab!=="plan"&&<div className="empty"><div className="empty-ico">👷</div>
      <div className="empty-txt">Nothing yet. Start with the plan: one line per trade or team, the number of workers and the weeks. The budget in hours follows.</div>
      {can&&<div style={{marginTop:12}}><button className="btn btn-pri" onClick={function(){setTab("plan");}}>Go to the plan</button></div>}</div>}
    {!empty&&tab==="overview"&&<MpOverview M={M} onOpenWeek={openWeek}/>}
    {filtered&&tab!=="plan"&&!empty&&<div style={{fontSize:11.5,color:"#6f6b62",background:"#fff8e1",border:"1px solid #f0e2b8",borderRadius:8,padding:"5px 10px",marginBottom:10}}>
      Filtered on {fWbs?<b>WBS “{fWbs}”</b>:null}{fWbs&&fSrc?" · ":""}{fSrc?<b>file activity “{fSrc}”</b>:null} — real hours of these lines only; budget = the plan lines of {fWbs?"this WBS":"the WBS these hours are matched to"}{fSrc?" (shared with the other file activities matched to the same WBS)":""}.</div>}
    {tab==="plan"&&<MpPlan plan={plan} savePlan={savePlan} M={M0} can={can} known={known}/>}
    {!empty&&tab==="weeks"&&<MpWeeks M={M} onOpen={openWeek} can={can}/>}
    {!empty&&tab==="months"&&<MpMonths M={M}/>}
    {!empty&&tab==="companies"&&<MpCompanies M={M}/>}
    {!empty&&tab==="activities"&&<MpActivities M={M} onPick={function(k,v){if(k==="wbs"){setFWbs(v);setFSrc("");}else setFSrc(v);}}/>}
    {importing&&<MpImportModal weeks={weeks} saveWeeks={saveWeeks} plan={plan} savePlan={savePlan} knownActs={knownActs} currentUser={currentUser} onClose={function(){setImporting(false);}}/>}
    {edit&&<MpWeekEditor w={edit} known={known} knownActs={knownActs} can={can} M={M0} isNew={!weeks.some(function(x){return x.id===edit.id;})}
      onSave={saveWeek} onDelete={function(){delWeek(edit);}} onClose={function(){setEdit(null);}}/>}
  </div>;
}

// ---------------------------------------------------------------- overview
function MpOverview({M,onOpenWeek}){
  const [mode,setMode]=useState("weekly");
  var t=M.tot;
  var worst=M.rows.filter(function(r){return r.hasR&&r.diff!==null;}).slice().sort(function(a,b){return Math.abs(b.diff)-Math.abs(a.diff);}).slice(0,5);
  return <div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
      <InvBig label="Budget · whole duration" value={t.budget} unit="h" colour={MP_COL_BUDGET} sub={t.start?fmtDate(t.start)+" → "+fmtDate(addCalDays(t.end,6))+" · "+t.weeks+" weeks":""}/>
      <InvBig label="Budget to date" value={t.cutoff?t.budgetToDate:null} unit="h" colour={MP_COL_BUDGET} sub={t.cutoff?"to W"+mpIsoWeek(t.cutoff):"no real hours yet"}/>
      <InvBig label="Spent to date" value={t.real} unit="h" colour={MP_COL_REAL}/>
      <InvBig label="Variance to date" value={t.diff} unit="h" colour={t.diff===null?null:mpVarCol(t.pct)} sub={t.pct===null?"spent − budget to date":(t.pct>0?"+":"")+t.pct+" % · "+(t.diff>0?"overspent":t.diff<0?"under budget":"on budget")}/>
      <InvBig label="Remaining budget" value={t.remaining} unit="h" sub="plan after the cut-off"/>
      <InvBig label="Forecast at completion" value={t.eac} unit="h" colour={t.eacDiff>0?"#b3302a":"#1e6b3a"} sub={"spent + remaining · "+mpSigned(t.eacDiff)+" h vs budget"}/>
      <InvBig label="Peak workers" value={t.peak} sub={t.peakWeek?"W"+mpIsoWeek(t.peakWeek)+" · "+fmtDate(t.peakWeek):""}/>
    </div>
    <div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:14}}>Budget and real hours</div>
        <span style={{fontSize:11,color:"#888"}}>{mode==="weekly"?"bars = real hours by company · line = budget from the plan":"running totals: budget (whole plan) and real"}</span>
        <span style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button className={"fchip"+(mode==="weekly"?" on":"")} onClick={function(){setMode("weekly");}}>Weekly</button>
          <button className={"fchip"+(mode==="cumul"?" on":"")} onClick={function(){setMode("cumul");}}>Cumulative</button>
        </span>
      </div>
      <MpChart M={M} mode={mode}/>
    </div>
    {worst.length>0&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Largest weekly variances</div>
      {worst.map(function(r){
        return <div key={r.week} onClick={function(){onOpenWeek(r.week);}} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 2px",borderBottom:"1px solid #f0ede6",cursor:"pointer",fontSize:12.5}}>
          <b style={{width:44}}>W{mpIsoWeek(r.week)}</b><span style={{color:"#888",width:72}}>{fmtDate(r.week)}</span>
          <span style={{flex:1,color:"#555"}}>budget {mpFmtH(r.budget)} h · real {mpFmtH(r.real)} h{r.entry&&r.entry.note?" · "+r.entry.note:""}</span>
          <b style={{color:mpVarCol(r.pct),fontFamily:"var(--font-mono)"}}>{mpSigned(r.diff)} h{r.pct!==null?" ("+(r.pct>0?"+":"")+r.pct+" %)":""}</b>
        </div>;
      })}
    </div>}
  </div>;
}

function MpChart({M,mode}){
  var list=M.rows;
  if(!list.length)return <div style={{color:"#9b968b",fontSize:12}}>No week yet.</div>;
  var top=M.companies.filter(function(c){return c.real>0;}).slice(0,MP_TOP),topKeys=top.map(function(c){return c.key;});
  var hasOthers=M.companies.filter(function(c){return c.real>0;}).length>MP_TOP;
  var W=Math.max(640,list.length*22+70),H=280,L=56,R=14,T=12,B=40;
  var iw=W-L-R,ih=H-T-B,bw=Math.max(4,Math.min(20,iw/list.length*0.7));
  function x(i){return L+(i+0.5)*iw/list.length;}
  var max=1;
  list.forEach(function(r){max=Math.max(max,mode==="cumul"?Math.max(r.cumB,r.cumR):Math.max(r.real,r.budget));});
  var step=Math.pow(10,Math.floor(Math.log10(max)));var nice=[1,2,2.5,5,10].map(function(m){return m*step;}).find(function(v){return max/v<=6;})||step*10;
  var top_=Math.ceil(max/nice)*nice;
  function y(v){return T+ih-(v/top_)*ih;}
  var ticks=[];for(var v=0;v<=top_+1e-9;v+=nice)ticks.push(v);
  function line(get,col,dash,only){
    var pts=list.map(function(r,i){if(only&&!only(r))return null;return [x(i),y(get(r))];});
    var segs=[],cur=[];pts.forEach(function(p){if(p)cur.push(p);else if(cur.length){segs.push(cur);cur=[];}});if(cur.length)segs.push(cur);
    return segs.map(function(sg,k){return <polyline key={col+k} points={sg.map(function(p){return p[0]+","+p[1];}).join(" ")} fill="none" stroke={col} strokeWidth="2" strokeDasharray={dash||""}/>;});
  }
  var ci=M.tot.cutoff?list.findIndex(function(r){return r.week===M.tot.cutoff;}):-1;
  var labelEvery=Math.max(1,Math.ceil(list.length/16));
  return <div style={{overflowX:"auto"}}>
    <svg width={W} height={H} style={{display:"block",fontFamily:"var(--font-mono)"}}>
      {ticks.map(function(v){return <g key={v}><line x1={L} x2={W-R} y1={y(v)} y2={y(v)} stroke="#efece5"/>
        <text x={L-6} y={y(v)+3} fontSize="9.5" textAnchor="end" fill="#9b968b">{invFmt(v,0)}</text></g>;})}
      {mode==="weekly"&&list.map(function(r,i){
        var acc=0,byC={};((r.entry&&r.entry.real)||[]).forEach(function(z){var k=mpCompanyKey(z.company)||"(no company)";k=topKeys.indexOf(k)>=0?k:"__others";byC[k]=(byC[k]||0)+_invNum(z.hours);});
        var keys=topKeys.concat(hasOthers?["__others"]:[]);
        return <g key={r.week}>{keys.map(function(k,c){
          var h=byC[k]||0;if(!h)return null;
          var y0=y(acc+h),hh=y(acc)-y(acc+h);acc+=h;
          return <rect key={k} x={x(i)-bw/2} y={y0} width={bw} height={Math.max(0.5,hh)} fill={k==="__others"?"#b9b4a8":MP_COMPANY_COLS[c%MP_COMPANY_COLS.length]}/>;
        })}
        <rect x={x(i)-bw/2} y={T} width={bw} height={ih} fill="transparent"><title>{mpWeekLabel(r.week)+"\nWorkers planned "+r.workers+"\nBudget "+mpFmtH(r.budget)+" h\nReal "+(r.hasR?mpFmtH(r.real)+" h":"—")+(r.diff!==null?"\nVariance "+mpSigned(r.diff)+" h":"")}</title></rect></g>;
      })}
      {mode==="weekly"&&line(function(r){return r.budget;},MP_COL_BUDGET)}
      {mode==="cumul"&&line(function(r){return r.cumB;},MP_COL_BUDGET)}
      {mode==="cumul"&&line(function(r){return r.cumR;},MP_COL_REAL,"",function(r){return r.toDate;})}
      {ci>=0&&<g><line x1={x(ci)} x2={x(ci)} y1={T} y2={T+ih} stroke="#14171c" strokeDasharray="3 3"/><text x={x(ci)+3} y={T+9} fontSize="9" fill="#14171c">cut-off</text></g>}
      {list.map(function(r,i){return i%labelEvery?null:<text key={"l"+i} x={x(i)} y={H-B+14} fontSize="9.5" textAnchor="middle" fill="#6f6b62">W{mpIsoWeek(r.week)}</text>;})}
      <text x={x(0)} y={H-B+27} fontSize="9" textAnchor="start" fill="#9b968b">{fmtDate(list[0].week)}</text>
      {list.length>1&&<text x={x(list.length-1)} y={H-B+27} fontSize="9" textAnchor="end" fill="#9b968b">{fmtDate(list[list.length-1].week)}</text>}
      <line x1={L} x2={W-R} y1={T+ih} y2={T+ih} stroke="#c9c4b8"/>
    </svg>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:"#6f6b62",marginTop:6}}>
      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:MP_COL_BUDGET}}/>Budget (plan)</span>
      {mode==="cumul"&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:MP_COL_REAL}}/>Real</span>}
      {mode==="weekly"&&top.map(function(c,k){return <span key={c.key} style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:MP_COMPANY_COLS[k%MP_COMPANY_COLS.length]}}/>{c.name}</span>;})}
      {mode==="weekly"&&hasOthers&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:"#b9b4a8"}}/>Others</span>}
    </div>
  </div>;
}

// ---------------------------------------------------------------- plan
// One line per trade / team: workers × weeks × hours per worker. The grid underneath is the
// histogram: a cell changes the head count of one week only (empty = the line's default).
function MpPlan({plan,savePlan,M,can,known}){
  const [edit,setEdit]=useState(null);
  var weeks=M.rows.filter(function(r){return r.src==="plan"||r.workers>0;}).map(function(r){return r.week;});
  var lines=plan.slice().sort(function(a,b){return (a.start||"").localeCompare(b.start||"")||(a.label||"").localeCompare(b.label||"");});
  function save(l){
    if(blockIfReadOnly())return;
    var st=_flowMonday(l.start),en=_flowMonday(l.end);
    if(!isValidDate(st)||!isValidDate(en)){safeAlert("Give the first and the last week.");return;}
    if(en<st){safeAlert("The last week is before the first one.");return;}
    var bw={};Object.keys(l.byWeek||{}).forEach(function(w){if(w>=st&&w<=en)bw[w]=l.byWeek[w];});
    _invUpsert(plan,savePlan,Object.assign({},l,{start:st,end:en,byWeek:bw,
      workers:mpHas(l.workers)?Number(l.workers):0,hpw:mpHas(l.hpw)?Number(l.hpw):MP_DEFAULT_HPW}));
    setEdit(null);
  }
  function del(l){
    if(!invCanDelete()){safeAlert("Deleting is not allowed for your account.");return;}
    if(_invRemove(plan,savePlan,l,"the plan line “"+(l.label||"untitled")+"”"))setEdit(null);
  }
  function setCell(l,w,v){
    if(!can||blockIfReadOnly())return;
    var bw=Object.assign({},l.byWeek||{});
    v=String(v).trim();
    if(v===""||Number(v)===_invNum(l.workers))delete bw[w];else if(isFinite(Number(v)))bw[w]=Math.max(0,Number(v));else return;
    _invUpsert(plan,savePlan,Object.assign({},l,{byWeek:bw}));
  }
  var weekTot={};M.rows.forEach(function(r){weekTot[r.week]=r;});
  return <div>
    <div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:14}}>Plan lines</div>
        <span style={{fontSize:11,color:"#888"}}>workers × hours per worker per week, from the first to the last week</span>
        {can&&<button className="btn btn-pri btn-sm" style={{marginLeft:"auto"}} onClick={function(){
          var last=lines[lines.length-1];
          setEdit(newMpPlanLine(last?{hpw:last.hpw}:{}));}}>＋ Plan line</button>}
      </div>
      {!lines.length&&<div style={{color:"#9b968b",fontSize:12}}>No plan yet. Add one line per trade or team, e.g. “Formwork carpenters — 12 workers — W43 to W8 — 48 h”.</div>}
      {lines.length>0&&<table className="tbl tbl-cards" style={{fontSize:12}}>
        <thead><tr><th>Trade / team</th><th>Company</th><th style={{textAlign:"right"}}>Workers</th><th>From</th><th>To</th>
          <th style={{textAlign:"right"}}>h / worker / week</th><th style={{textAlign:"right"}}>Weeks</th><th style={{textAlign:"right"}}>Budget h</th></tr></thead>
        <tbody>{lines.map(function(l){
          var n=mpWeeksBetween(l.start,l.end).length,ov=Object.keys(l.byWeek||{}).length;
          return <tr key={l.id} onClick={function(){setEdit(Object.assign({},l));}} style={{cursor:"pointer"}}>
            <td className="card-main" style={{fontWeight:600}}>{l.label||"(untitled)"}{l.note&&<div style={{fontSize:10.5,color:"#888",fontWeight:400}}>{l.note}</div>}</td>
            <td data-l="Company">{l.company||"—"}</td>
            <td data-l="Workers" style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(_invNum(l.workers),1)}{ov?<span title={ov+" week(s) with a different head count"} style={{color:"#b35c00"}}> *</span>:null}</td>
            <td data-l="From" style={{whiteSpace:"nowrap"}}>W{mpIsoWeek(l.start)} <span style={{color:"#888"}}>{fmtDate(l.start)}</span></td>
            <td data-l="To" style={{whiteSpace:"nowrap"}}>W{mpIsoWeek(l.end)} <span style={{color:"#888"}}>{fmtDate(l.end)}</span></td>
            <td data-l="h/worker/wk" style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{mpLineHpw(l)}</td>
            <td data-l="Weeks" style={{textAlign:"right"}}>{n}</td>
            <td data-l="Budget h" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_BUDGET}}>{invFmt(mpLineTotal(l),0)}</td>
          </tr>;
        })}
        <tr style={{background:"#fffaf0"}}><td className="card-main" style={{fontWeight:700}}>Total</td><td/><td/><td data-l="From">{M.tot.start?fmtDate(M.tot.start):""}</td><td data-l="To">{M.tot.end?fmtDate(M.tot.end):""}</td><td/><td/>
          <td data-l="Budget h" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_BUDGET}}>{invFmt(lines.reduce(function(s,l){return s+mpLineTotal(l);},0),0)}</td></tr>
        </tbody>
      </table>}
    </div>
    {lines.length>0&&weeks.length>0&&<div className="card">
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:14}}>Workers per week</div>
        <span style={{fontSize:11,color:"#888"}}>{can?"type in a cell to change that week only · empty = the line's default · highlighted = changed":"head count per line and per week"}</span>
      </div>
      <div className="phone-scroll" style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",fontSize:11,minWidth:"100%"}}>
          <thead><tr>
            <th style={{position:"sticky",left:0,background:"#fff",textAlign:"left",padding:"4px 8px",minWidth:150,borderBottom:"1px solid #ddd9cf"}}>Line</th>
            {weeks.map(function(w){return <th key={w} title={fmtDate(w)} style={{padding:"4px 2px",fontWeight:600,color:"#6f6b62",minWidth:38,borderBottom:"1px solid #ddd9cf",
              background:M.tot.cutoff&&w<=M.tot.cutoff?"#f5f3ee":"#fff"}}>W{mpIsoWeek(w)}<div style={{fontSize:8.5,fontWeight:400,color:"#9b968b"}}>{w.slice(8,10)}/{w.slice(5,7)}</div></th>;})}
          </tr></thead>
          <tbody>
            {lines.map(function(l){
              return <tr key={l.id}>
                <td style={{position:"sticky",left:0,background:"#fff",padding:"3px 8px",fontWeight:600,whiteSpace:"nowrap",borderBottom:"1px solid #f0ede6"}}>{l.label||"(untitled)"}<span style={{fontWeight:400,color:"#888"}}> · {mpLineHpw(l)} h</span></td>
                {weeks.map(function(w){
                  var inR=w>=l.start&&w<=l.end;
                  if(!inR)return <td key={w} style={{borderBottom:"1px solid #f0ede6"}}/>;
                  var ov=(l.byWeek||{})[w],val=mpLineWorkers(l,w);
                  return <td key={w} style={{padding:1,borderBottom:"1px solid #f0ede6",textAlign:"center"}}>
                    {can?<input key={l.id+w+val} type="number" min="0" defaultValue={val} onBlur={function(e){if(String(e.target.value)!==String(val))setCell(l,w,e.target.value);}}
                        onKeyDown={function(e){if(e.key==="Enter")e.target.blur();}}
                        style={{width:36,padding:"2px 1px",fontSize:11,textAlign:"center",border:"1px solid "+(mpHas(ov)?"#e0b25a":"#e8e6df"),borderRadius:3,background:mpHas(ov)?"#fff4dc":"#fbfaf7"}}/>
                      :<span style={{fontFamily:"var(--font-mono)",color:mpHas(ov)?"#b35c00":"#14171c"}}>{val}</span>}
                  </td>;
                })}
              </tr>;
            })}
            <tr style={{background:"#fffaf0",fontWeight:700}}>
              <td style={{position:"sticky",left:0,background:"#fffaf0",padding:"4px 8px"}}>Workers</td>
              {weeks.map(function(w){return <td key={w} style={{textAlign:"center",fontFamily:"var(--font-mono)"}}>{invFmt((weekTot[w]||{}).workers||0,1)}</td>;})}
            </tr>
            <tr style={{background:"#fffaf0"}}>
              <td style={{position:"sticky",left:0,background:"#fffaf0",padding:"4px 8px",fontWeight:700,color:MP_COL_BUDGET}}>Budget h</td>
              {weeks.map(function(w){return <td key={w} style={{textAlign:"center",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET,fontSize:10}}>{invFmt((weekTot[w]||{}).budget||0,0)}</td>;})}
            </tr>
          </tbody>
        </table>
      </div>
    </div>}
    {edit&&<MpPlanEditor l={edit} known={known} can={can} isNew={!plan.some(function(x){return x.id===edit.id;})}
      onSave={save} onDelete={function(){del(edit);}} onClose={function(){setEdit(null);}}/>}
  </div>;
}
function MpPlanEditor({l,known,can,isNew,onSave,onDelete,onClose}){
  const [d,setD]=useState(l);
  function set(k,v){setD(function(o){var n=Object.assign({},o);n[k]=v;return n;});}
  var st=isValidDate(d.start)?_flowMonday(d.start):"",en=isValidDate(d.end)?_flowMonday(d.end):"";
  var n=st&&en&&en>=st?mpWeeksBetween(st,en).length:0;
  var tot=Object.assign({},d,{start:st,end:en});
  var inp={padding:"6px 8px",fontSize:13};
  var footer=<React.Fragment>
    {can&&!isNew&&<button className="btn btn-danger" style={{marginRight:"auto"}} onClick={onDelete}>🗑 Delete</button>}
    {can&&!isNew&&<button className="btn" onClick={function(){onSave(Object.assign({},d,{id:uuid(),label:(d.label||"")+" (copy)"}));}} title="Same line, saved as a new one">⧉ Duplicate</button>}
    <button className="btn" onClick={onClose}>{can?"Cancel":"Close"}</button>
    {can&&<button className="btn btn-pri" disabled={!n} onClick={function(){onSave(d);}}>Save</button>}
  </React.Fragment>;
  return <InvModal title={isNew?"New plan line":"Plan line"} width={600} onClose={onClose} footer={footer}>
    <datalist id="mp-plan-companies">{known.map(function(x){return <option key={x} value={x}/>;})}</datalist>
    <div className="frow">
      <div className="fg" style={{flex:2}}><label>Trade / team</label>
        <input type="text" value={d.label||""} disabled={!can} onChange={function(e){set("label",e.target.value);}} placeholder="e.g. Formwork carpenters" style={inp}/></div>
      <div className="fg"><label>Company</label>
        <input type="text" list="mp-plan-companies" value={d.company||""} disabled={!can} onChange={function(e){set("company",e.target.value);}} placeholder="optional" style={inp}/></div>
    </div>
    <div className="frow">
      <div className="fg"><label>Workers</label>
        <input type="number" min="0" value={d.workers} disabled={!can} onChange={function(e){set("workers",e.target.value);}} style={inp}/></div>
      <div className="fg"><label>Hours per worker per week</label>
        <input type="number" min="0" value={d.hpw} disabled={!can} onChange={function(e){set("hpw",e.target.value);}} style={inp}/></div>
    </div>
    <div className="frow">
      <div className="fg"><label>First week</label>
        <input type="date" value={d.start||""} disabled={!can} onChange={function(e){set("start",e.target.value);}} style={inp}/>
        {st&&<span style={{fontSize:11,color:"#888"}}>W{mpIsoWeek(st)} · Monday {fmtDate(st)}</span>}</div>
      <div className="fg"><label>Last week (included)</label>
        <input type="date" value={d.end||""} disabled={!can} onChange={function(e){set("end",e.target.value);}} style={inp}/>
        {en&&<span style={{fontSize:11,color:"#888"}}>W{mpIsoWeek(en)} · Monday {fmtDate(en)}</span>}</div>
    </div>
    <div style={{background:"#fffaf0",border:"1px solid #f0e2b8",borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:12}}>
      {n?<span><b>{n}</b> week{n>1?"s":""} × <b>{invFmt(_invNum(d.workers),1)}</b> workers × <b>{mpLineHpw(d)}</b> h = <b style={{color:MP_COL_BUDGET}}>{invFmt(mpLineTotal(tot),0)} h</b>
        {Object.keys(d.byWeek||{}).length?<span style={{color:"#b35c00"}}> · includes {Object.keys(d.byWeek).length} week(s) changed in the grid</span>:null}</span>
        :<span style={{color:"#b3302a"}}>Give a first and a last week (the last one on or after the first).</span>}
    </div>
    <div className="fg"><label>Note</label>
      <input type="text" value={d.note||""} disabled={!can} onChange={function(e){set("note",e.target.value);}} placeholder="optional" style={inp}/></div>
  </InvModal>;
}

// ---------------------------------------------------------------- weeks
function MpWeeks({M,onOpen,can}){
  // Weeks up to the cut-off, latest first; then the plan ahead, in date order.
  var co=M.tot.cutoff;
  var past=M.rows.filter(function(r){return co&&r.week<=co;}).reverse();
  var ahead=M.rows.filter(function(r){return !co||r.week>co;});
  var list=past.concat(ahead.length?[{sep:true}]:[],ahead);
  function vcell(v,pct){return <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:v===null?"#ccc":mpVarCol(pct)}}>{mpSigned(v)}{pct!==null&&v!==null?<span style={{fontSize:10,marginLeft:4}}>{(pct>0?"+":"")+pct}%</span>:null}</td>;}
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
      <thead><tr>
        <th>Week</th><th style={{textAlign:"right"}}>Workers</th><th style={{textAlign:"right"}}>Budget</th><th style={{textAlign:"right"}}>Real</th>
        <th style={{textAlign:"right"}} title="Real − budget">Variance</th>
        <th style={{textAlign:"right"}} title="Running totals to date: budget / real">Cumul. B / R</th>
        <th style={{textAlign:"right"}} title="Running variance to date">Cumul. var.</th>
        <th>Companies</th><th>Note</th>
      </tr></thead>
      <tbody>{list.map(function(r){
        if(r.sep)return <tr key="sep"><td colSpan={9} style={{background:"#f5f3ee",fontSize:11,fontWeight:700,color:"#6f6b62",textTransform:"uppercase",letterSpacing:".06em"}}>
          Plan ahead · {ahead.length} week{ahead.length!==1?"s":""} · {invFmt(ahead.reduce(function(a,x){return a+x.budget;},0),0)} h</td></tr>;
        var real=((r.entry&&r.entry.real)||[]).slice().sort(function(a,b){return _invNum(b.hours)-_invNum(a.hours);});
        var future=M.tot.cutoff?r.week>M.tot.cutoff:true;
        var cd=r.toDate?r.cumR-r.cumBd:null;
        return <tr key={r.week} onClick={function(){onOpen(r.week);}} style={{cursor:"pointer",opacity:future&&!r.hasR?.7:1}} title={can?"Open to enter the real hours":"Open"}>
          <td className="card-main" style={{whiteSpace:"nowrap"}}><b>W{mpIsoWeek(r.week)}</b> <span style={{color:"#888"}}>{fmtDate(r.week)}</span>{r.src==="manual"&&<span title="No plan line covers this week: the budget is the manual figure" style={{fontSize:10,color:"#b35c00",marginLeft:4}}>manual</span>}</td>
          <td data-l="Workers" style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{r.workers?invFmt(r.workers,1):"—"}</td>
          <td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{r.budget?invFmt(r.budget,0):"—"}</td>
          <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{r.hasR?invFmt(r.real,0):"—"}</td>
          {vcell(r.diff,r.pct)}
          <td data-l="Cumul. B / R" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888",whiteSpace:"nowrap"}}>{invFmt(r.cumB,0)} / {r.toDate?invFmt(r.cumR,0):"—"}</td>
          <td data-l="Cumul. var." style={{textAlign:"right",fontFamily:"var(--font-mono)",color:cd===null?"#ccc":mpVarCol(r.cumBd?cd/r.cumBd*100:null)}}>{cd===null?"—":mpSigned(cd)}</td>
          <td data-l="Companies" style={{fontSize:11,color:"#555"}}>{real.slice(0,3).map(function(x){return (x.company||"?")+" "+invFmt(_invNum(x.hours),0);}).join(" · ")}{real.length>3?" · +"+(real.length-3):""}</td>
          <td data-l="Note" style={{fontSize:11,color:"#888",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(r.entry&&r.entry.note)||""}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// ---------------------------------------------------------------- months
function MpMonths({M}){
  var t=M.tot;
  var max=Math.max.apply(null,M.months.map(function(m){return Math.max(m.budget,m.real);}).concat([1]));
  return <div>
    <div className="card" style={{padding:0,overflowX:"auto",marginBottom:12}}>
      <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
        <thead><tr><th>Month</th><th style={{textAlign:"right"}}>Budget</th><th style={{textAlign:"right"}} title="Budget of the weeks up to the cut-off">Budget to date</th>
          <th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}} title="Real − budget to date">Variance</th>
          <th style={{textAlign:"right"}}>Cumul. budget</th><th style={{textAlign:"right"}}>Cumul. real</th><th style={{minWidth:140}}></th></tr></thead>
        <tbody>
          {M.months.map(function(m){
            return <tr key={m.month}>
              <td className="card-main" style={{fontWeight:700,whiteSpace:"nowrap"}}>{mpMonthLabel(m.month)}</td>
              <td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{invFmt(m.budget,0)}</td>
              <td data-l="Budget to date" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{m.budgetToDate?invFmt(m.budgetToDate,0):"—"}</td>
              <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{m.hasR?invFmt(m.real,0):"—"}</td>
              <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:mpVarCol(m.pct)}}>{m.diff===null?"—":mpSigned(m.diff)}{m.pct!==null?<span style={{fontSize:10,marginLeft:4}}>{(m.pct>0?"+":"")+m.pct}%</span>:null}</td>
              <td data-l="Cumul. budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{invFmt(m.cumB,0)}</td>
              <td data-l="Cumul. real" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{m.hasR?invFmt(m.cumR,0):"—"}</td>
              <td className="phone-hide"><div style={{position:"relative",height:14}}>
                <div style={{position:"absolute",left:0,top:0,height:6,width:(m.budget/max*100)+"%",background:MP_COL_BUDGET,borderRadius:2,opacity:.75}}/>
                {m.hasR&&<div style={{position:"absolute",left:0,top:7,height:6,width:(m.real/max*100)+"%",background:MP_COL_REAL,borderRadius:2}}/>}
              </div></td>
            </tr>;
          })}
          <tr style={{background:"#fffaf0"}}>
            <td className="card-main" style={{fontWeight:800}}>Whole duration</td>
            <td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_BUDGET}}>{invFmt(t.budget,0)}</td>
            <td data-l="Budget to date" style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{t.cutoff?invFmt(t.budgetToDate,0):"—"}</td>
            <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_REAL}}>{invFmt(t.real,0)}</td>
            <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:mpVarCol(t.pct)}}>{t.diff===null?"—":mpSigned(t.diff)}{t.pct!==null?<span style={{fontSize:10,marginLeft:4}}>{(t.pct>0?"+":"")+t.pct}%</span>:null}</td>
            <td data-l="Forecast" colSpan={3} style={{fontSize:11.5,color:"#555"}}>Remaining {invFmt(t.remaining,0)} h · forecast at completion <b style={{color:t.eacDiff>0?"#b3302a":"#1e6b3a"}}>{invFmt(t.eac,0)} h ({mpSigned(t.eacDiff)})</b></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style={{fontSize:11,color:"#9b968b"}}>A week across two months is split by working day (Mon–Sat). Variance = real − budget of the weeks up to the cut-off (W{t.cutoff?mpIsoWeek(t.cutoff):"—"}).</div>
  </div>;
}

// ---------------------------------------------------------------- companies
function MpCompanies({M}){
  var tot=M.tot.real||0;
  var list=M.companies;
  if(!list.length)return <div className="empty"><div className="empty-txt">No company yet: give a company to the plan lines and to the real hours.</div></div>;
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
      <thead><tr><th>Company</th><th style={{textAlign:"right"}}>Budget (plan)</th><th style={{textAlign:"right"}}>Budget to date</th>
        <th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}} title="Real − budget to date">Variance</th><th style={{textAlign:"right"}}>Share of real</th>
        <th style={{textAlign:"right"}}>Weeks present</th></tr></thead>
      <tbody>{list.map(function(c){
        var d=c.budgetToDate||c.real?c.real-c.budgetToDate:null;
        var pct=c.budgetToDate?Math.round(d/c.budgetToDate*100):null;
        return <tr key={c.key}>
          <td className="card-main" style={{fontWeight:600}}>{c.name}</td>
          <td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{c.budget?invFmt(c.budget,0):"—"}</td>
          <td data-l="Budget to date" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{c.budgetToDate?invFmt(c.budgetToDate,0):"—"}</td>
          <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{c.real?invFmt(c.real,0):"—"}</td>
          <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:c.budgetToDate?mpVarCol(pct):"#888"}}
            title={c.budgetToDate?"":"No plan line with this company: everything spent counts as variance"}>{d===null?"—":mpSigned(d)}{pct!==null?<span style={{fontSize:10,marginLeft:4}}>{(pct>0?"+":"")+pct}%</span>:null}</td>
          <td data-l="Share" style={{textAlign:"right"}}>{tot&&c.real?Math.round(c.real/tot*100)+" %":"—"}</td>
          <td data-l="Weeks" style={{textAlign:"right"}}>{Object.keys(c.weeks).length||"—"}</td>
        </tr>;
      })}</tbody>
    </table>
    <div style={{fontSize:11,color:"#9b968b",padding:"8px 12px"}}>Budget per company comes from the plan lines that name a company. Lines without one are only in the totals.</div>
  </div>;
}

// ---------------------------------------------------------------- activities
// Budget per activity = the plan lines with that name; real = the real lines tagged with it.
// ▸ shows which companies spent the hours of an activity.
function MpActivities({M,onPick}){
  const [open,setOpen]=useState({});
  const [by,setBy]=useState("wbs");          // "wbs" = webapp WBS (plan lines) · "src" = activities of the imported file
  var tot=M.tot.real||0;
  var list=M.activities;
  var hasSrc=M.srcs.some(function(x){return x.key!=="(not imported)";});
  if(!list.length)return <div className="empty"><div className="empty-txt">No activity yet: name the plan lines, and pick the activity on each line of real hours.</div></div>;
  var untagged=list.find(function(a){return a.key==="(no activity)";});
  function tog(k){setOpen(function(o){var n=Object.assign({},o);n[k]=!o[k];return n;});}
  var pickBtn=function(kind,name){return onPick&&name.charAt(0)!=="("?<button className="btn btn-sm" style={{padding:"0 6px",fontSize:10,marginLeft:6}} title="Filter the whole manpower view on it"
    onClick={function(e){e.stopPropagation();onPick(kind,name);}}>⚲ filter</button>:null;};
  var switcher=hasSrc&&<div style={{display:"flex",gap:6,padding:"8px 12px",borderBottom:"1px solid #ece9e1",alignItems:"center"}}>
    <span style={{fontSize:11,color:"#888"}}>Group by</span>
    <button className={"fchip"+(by==="wbs"?" on":"")} onClick={function(){setBy("wbs");}}>WBS (webapp)</button>
    <button className={"fchip"+(by==="src"?" on":"")} onClick={function(){setBy("src");}}>Activity in the file</button>
  </div>;
  if(by==="src"&&hasSrc)return <div className="card" style={{padding:0,overflowX:"auto"}}>
    {switcher}
    <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
      <thead><tr><th>Activity in the file</th><th>WBS (webapp)</th><th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}}>Share of real</th><th style={{textAlign:"right"}}>Weeks</th></tr></thead>
      <tbody>{M.srcs.map(function(x){
        var ws=Object.keys(x.byWbs).sort(function(p,q){return x.byWbs[q]-x.byWbs[p];});
        return <tr key={x.key}>
          <td className="card-main" style={{fontWeight:600,fontStyle:x.key==="(not imported)"?"italic":"normal"}}>{x.name}{pickBtn("src",x.name)}</td>
          <td data-l="WBS" style={{fontSize:11,color:"#555"}}>{ws.map(function(wn){return wn+(ws.length>1?" ("+invFmt(x.byWbs[wn],0)+" h)":"");}).join(" · ")}</td>
          <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{x.real?invFmt(x.real,0):"—"}</td>
          <td data-l="Share" style={{textAlign:"right"}}>{tot&&x.real?Math.round(x.real/tot*100)+" %":"—"}</td>
          <td data-l="Weeks" style={{textAlign:"right"}}>{Object.keys(x.weeks).length||"—"}</td>
        </tr>;
      })}</tbody>
    </table>
    <div style={{fontSize:11,color:"#9b968b",padding:"8px 12px"}}>The activity names of the imported files, as they are in the file, with the webapp WBS they were matched to at the import. The budget lives on the WBS.</div>
  </div>;
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    {switcher}
    <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
      <thead><tr><th>{hasSrc?"WBS (webapp)":"Activity"}</th><th style={{textAlign:"right"}}>Budget (plan)</th><th style={{textAlign:"right"}}>Budget to date</th>
        <th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}} title="Real − budget to date">Variance</th><th style={{textAlign:"right"}}>Share of real</th>
        <th>Companies</th></tr></thead>
      <tbody>{list.map(function(a){
        var d=a.budgetToDate||a.real?a.real-a.budgetToDate:null;
        var pct=a.budgetToDate?Math.round(d/a.budgetToDate*100):null;
        var cos=Object.keys(a.byCompany).sort(function(x,y){return a.byCompany[y]-a.byCompany[x];});
        var srcs=Object.keys(a.bySrc).sort(function(x,y){return a.bySrc[y]-a.bySrc[x];});
        var more=cos.length+srcs.length;
        var isOpen=!!open[a.key];
        return <React.Fragment key={a.key}>
          <tr onClick={function(){if(more)tog(a.key);}} style={{cursor:more?"pointer":"default"}}>
            <td className="card-main" style={{fontWeight:600,fontStyle:a.key==="(no activity)"?"italic":"normal"}}>{more?<span style={{color:"#8b8578",fontSize:10,marginRight:4}}>{isOpen?"▾":"▸"}</span>:null}{a.name}
              {srcs.length>0&&<span style={{fontSize:10,color:"#8b8578",fontWeight:400,marginLeft:6}}>{srcs.length} file activit{srcs.length>1?"ies":"y"}</span>}{pickBtn("wbs",a.name)}</td>
            <td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{a.budget?invFmt(a.budget,0):"—"}</td>
            <td data-l="Budget to date" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{a.budgetToDate?invFmt(a.budgetToDate,0):"—"}</td>
            <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{a.real?invFmt(a.real,0):"—"}</td>
            <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:a.budgetToDate?mpVarCol(pct):"#888"}}
              title={a.budgetToDate?"":"No plan line with this name: everything spent counts as variance"}>{d===null?"—":mpSigned(d)}{pct!==null?<span style={{fontSize:10,marginLeft:4}}>{(pct>0?"+":"")+pct}%</span>:null}</td>
            <td data-l="Share" style={{textAlign:"right"}}>{tot&&a.real?Math.round(a.real/tot*100)+" %":"—"}</td>
            <td data-l="Companies" style={{fontSize:11,color:"#555"}}>{cos.slice(0,3).join(" · ")}{cos.length>3?" · +"+(cos.length-3):""}</td>
          </tr>
          {isOpen&&srcs.map(function(sn){
            return <tr key={a.key+"|s|"+sn} style={{background:"#f6f8fc"}}>
              <td className="card-main" style={{paddingLeft:28,color:"#2b4c7e"}}><span style={{fontSize:10,color:"#8b8578",marginRight:4}}>file</span>{sn}{pickBtn("src",sn)}</td><td/><td/>
              <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_REAL}}>{invFmt(a.bySrc[sn],0)}</td><td/>
              <td data-l="Share of WBS" style={{textAlign:"right",color:"#888"}}>{a.real?Math.round(a.bySrc[sn]/a.real*100)+" %":""}</td><td/>
            </tr>;
          })}
          {isOpen&&cos.map(function(cn){
            return <tr key={a.key+"|"+cn} style={{background:"#faf9f6"}}>
              <td className="card-main" style={{paddingLeft:28,color:"#555"}}>{cn}</td><td/><td/>
              <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_REAL}}>{invFmt(a.byCompany[cn],0)}</td><td/>
              <td data-l="Share of activity" style={{textAlign:"right",color:"#888"}}>{a.real?Math.round(a.byCompany[cn]/a.real*100)+" %":""}</td><td/>
            </tr>;
          })}
        </React.Fragment>;
      })}</tbody>
    </table>
    <div style={{fontSize:11,color:"#9b968b",padding:"8px 12px"}}>Budget per activity comes from the plan lines of the same name.{hasSrc?" Open a WBS to see the file activities matched to it.":""}{untagged&&untagged.real?" "+invFmt(untagged.real,0)+" h of real hours have no activity yet: open the weeks to tag them.":""}</div>
  </div>;
}

// ---------------------------------------------------------------- import (Excel / CSV / paste)
// Three layouts are understood:
//   long  one row per week × company × activity — columns Week (or Monday / Date), Company,
//         Activity, Hours (any order, header names in English or French)
//   wide  one row per week, then one column per company (or per activity) holding the hours —
//         e.g. the CSV exported by this view; its Budget / Real / Variance / Cumulative columns
//         are recognised and ignored
//   matrix one row per activity, one column per week (e.g. the time-keeping export "Week · 2026-13 ·
//         2026-14 …" with "Zoning / Activity" rows): the label columns before the first week give
//         the zoning (carried down) and the activity; "Total" rows and columns are ignored
// Weeks may be ISO week numbers (W42, S42, 42, 2026-W42) — the year is chosen in the dialog and
// rolls over when the numbers go back to 1 — or dates (any day, taken as its Monday).
// Activities from the file are matched to the webapp's activities; the dialog asks for every
// one it cannot match: map to an existing activity, create it (a new plan line), import
// without activity, or skip. The choices are remembered on this browser for the next import.
// The file's own activity name is kept on each line (src) next to the webapp WBS it went to.
var MP_IMP_IGNORE=/^(monday|lundi|date|planned workers|workers|budget( h)?|real( h)?|variance( h| %)?|cumulative.*|total.*|month|year|week start|semaine du)$/i;
var MP_IMP_COLS={
  week:/^(week|wk|week ?(no|n°|#|number)|semaine|sem|s|n° ?semaine|week nr)$/i,
  date:/^(monday|lundi|date|week start|semaine du|start)$/i,
  company:/^(company|companies|entreprise|soci[eé]t[eé]|subcontractor|sous[- ]?traitant|contractor|employer|employeur)$/i,
  activity:/^(activity|activities|activit[eé]|trade|corps d'?[eé]tat|task|t[aâ]che|poste|discipline|m[eé]tier|work ?type|cost code)$/i,
  hours:/^(hours|heures|hrs|h|real h|real hours|man ?hours|total hours|qty|quantity|quantit[eé])$/i
};
// CSV / pasted text → rows of cells. The separator is the most frequent of ; , tab on line 1.
function mpImpParseText(text){
  var lines=String(text||"").replace(/^﻿/,"").split(/\r?\n/);
  var first=lines.find(function(l){return l.trim();})||"";
  var seps=["\t",";",","],sep=seps.reduce(function(b,c){return first.split(c).length>first.split(b).length?c:b;},";");
  return lines.map(function(line){
    var out=[],cur="",q=false;
    for(var i=0;i<line.length;i++){
      var ch=line[i];
      if(q){if(ch==='"'&&line[i+1]==='"'){cur+='"';i++;}else if(ch==='"')q=false;else cur+=ch;}
      else if(ch==='"')q=true;else if(ch===sep){out.push(cur);cur="";}else cur+=ch;
    }
    out.push(cur);return out;
  });
}
function mpImpNum(v){if(typeof v==="number")return v;var s=String(v===undefined||v===null?"":v).trim();if(!s)return null;var n=_stParseNum(s);return isFinite(n)?n:null;}
// Monday of ISO week w of year y.
function mpIsoMonday(y,w){
  var j4=new Date(Date.UTC(y,0,4)),d=j4.getUTCDay()||7;
  var m=new Date(j4.getTime()-(d-1)*86400000+(w-1)*7*86400000);
  return m.toISOString().slice(0,10);
}
// A week cell → {week:n, year:y|null} or {date:"YYYY-MM-DD"} or null.
function mpImpWeekCell(v){
  if(v===undefined||v===null||v==="")return null;
  if(typeof v==="number"){
    if(v>=1&&v<=53&&Math.floor(v)===v)return {week:v,year:null};
    if(v>20000&&v<80000){var d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);return {date:d.toISOString().slice(0,10)};}
    return null;
  }
  if(v instanceof Date&&!isNaN(v))return {date:toISO(v)};
  var s=String(v).trim();
  var m=/^(\d{4})\s*[-_ ]?\s*[WwSs]\s*(\d{1,2})$/.exec(s);if(m)return {week:+m[2],year:+m[1]};
  m=/^(\d{4})\s*[-_\/.]\s*(\d{1,2})$/.exec(s);if(m&&+m[2]>=1&&+m[2]<=53)return {week:+m[2],year:+m[1]};   // 2026-13
  m=/^(?:w|wk|week|s|sem|semaine)?\s*\.?\s*(\d{1,2})(?:\s*[-\/]\s*(\d{4}))?$/i.exec(s);if(m&&+m[1]>=1&&+m[1]<=53)return {week:+m[1],year:m[2]?+m[2]:null};
  m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);if(m)return {date:m[0].slice(0,10)};
  m=/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/.exec(s);
  if(m){var y=+m[3];if(y<100)y+=2000;var iso=y+"-"+String(+m[2]).padStart(2,"0")+"-"+String(+m[1]).padStart(2,"0");if(isValidDate(iso))return {date:iso};}
  return null;
}
// Rows of cells → {layout, header, items:[{wk, company, activity, hours}], valueCols, issues}
function mpImpAnalyse(rows){
  rows=(rows||[]).map(function(r){return (r||[]).map(function(c){return c===undefined||c===null?"":c;});});
  var norm=function(c){return String(c).trim();};
  var hi=rows.findIndex(function(r){return r.some(function(c){return MP_IMP_COLS.week.test(norm(c))||MP_IMP_COLS.date.test(norm(c));});});
  if(hi<0)return {error:"No week column found. The first row of the table must have a “Week” (or “Semaine”, “Monday”, “Date”) heading."};
  var head=rows[hi].map(norm);
  function col(re){return head.findIndex(function(h){return re.test(h);});}
  var cW=col(MP_IMP_COLS.week),cD=col(MP_IMP_COLS.date),cC=col(MP_IMP_COLS.company),cA=col(MP_IMP_COLS.activity),cH=col(MP_IMP_COLS.hours);
  var layout=(cH>=0&&(cC>=0||cA>=0))?"long":"wide";
  // weeks along the heading row → matrix (one row per activity)
  var weekCols=[];
  rows[hi].forEach(function(c,j){if(j===cW||j===cD||norm(c)==="")return;var wc=mpImpWeekCell(c);if(wc)weekCols.push({j:j,cell:wc});});
  if(weekCols.length>=2)layout="matrix";else weekCols=[];
  var body=[];
  for(var i=hi+1;i<rows.length;i++){
    var r=rows[i];
    if(!r.some(function(c){return norm(c)!=="";}))break;          // an empty row ends the table
    body.push(r);
  }
  var valueCols=[];
  if(layout==="wide")head.forEach(function(h,j){if(j!==cW&&j!==cD&&h&&!MP_IMP_IGNORE.test(h)&&!MP_IMP_COLS.week.test(h))valueCols.push({j:j,name:h});});
  return {layout:layout,head:head,body:body,cW:cW,cD:cD,cC:cC,cA:cA,cH:cH,valueCols:valueCols,weekCols:weekCols,
    labelCols:weekCols.length?weekCols[0].j:0};
}
// Analysis + options → items with their Monday. Week numbers get a year: the chosen one, +1 each
// time the numbers wrap back (52 → 1).
var MP_IMP_TOTAL=/^(sub[- ]?)?total\b|^grand total|^sous[- ]?total/i;
function mpImpItems(an,opts){
  var items=[],skipped=0,year=opts.year,prevW=null;
  if(an.layout==="matrix"){
    var mons=an.weekCols.map(function(wc){
      var c=wc.cell;if(c.date)return _flowMonday(c.date);
      var y=c.year;if(!y){if(prevW!==null&&c.week<prevW-26)year++;y=year;}
      prevW=c.week;return mpIsoMonday(y,c.week);
    });
    var zone="";
    an.body.forEach(function(r){
      var labels=[];for(var j=0;j<an.labelCols;j++)labels.push(String(r[j]===undefined||r[j]===null?"":r[j]).trim());
      if(labels.length>1&&labels[0]&&!MP_IMP_TOTAL.test(labels[0]))zone=labels[0];
      if(labels.some(function(l){return MP_IMP_TOTAL.test(l);}))return;      // sub-totals and grand total
      var act="";for(var k=labels.length-1;k>=(labels.length>1?1:0);k--)if(labels[k]){act=labels[k];break;}
      if(!act)return;                                                        // a zoning heading
      an.weekCols.forEach(function(wc,i){
        var h=mpImpNum(r[wc.j]);if(h===null||!h)return;
        items.push({week:mons[i],company:opts.fixed||"",activity:act,zone:labels.length>1?zone:"",hours:h});
      });
    });
    return {items:items,skipped:skipped};
  }
  an.body.forEach(function(r){
    var wk=null;
    if(an.cD>=0){var dc=mpImpWeekCell(r[an.cD]);if(dc&&dc.date)wk=_flowMonday(dc.date);}
    if(!wk&&an.cW>=0){
      var c=mpImpWeekCell(r[an.cW]);
      if(c&&c.date)wk=_flowMonday(c.date);
      else if(c){
        var y=c.year;
        if(!y){if(prevW!==null&&c.week<prevW-26)year++;y=year;}
        prevW=c.week;wk=mpIsoMonday(y,c.week);
      }
    }
    if(!wk){skipped++;return;}
    if(an.layout==="long"){
      var h=mpImpNum(r[an.cH]);if(h===null||!h){if(h===null)skipped++;return;}
      items.push({week:wk,company:an.cC>=0?String(r[an.cC]).trim():(opts.fixed||""),activity:an.cA>=0?String(r[an.cA]).trim():"",hours:h});
    }else{
      an.valueCols.forEach(function(vc){
        var h=mpImpNum(r[vc.j]);if(h===null||!h)return;
        if(opts.colsAre==="activity")items.push({week:wk,company:opts.fixed||"",activity:vc.name,hours:h});
        else items.push({week:wk,company:vc.name,activity:opts.fixed||"",hours:h});
      });
    }
  });
  return {items:items,skipped:skipped};
}
// Best guess for an activity name from the file: same name, one containing the other, or most
// words in common.
function mpImpGuess(name,acts){
  var k=mpActKey(name);if(!k)return "";
  var exact=acts.find(function(a){return mpActKey(a)===k;});if(exact)return exact;
  var cont=acts.find(function(a){var ak=mpActKey(a);return ak&&(ak.indexOf(k)>=0||k.indexOf(ak)>=0);});if(cont)return cont;
  var kw=k.split(" ").filter(function(w){return w.length>2;}),best="",bs=0;
  acts.forEach(function(a){
    var aw=mpActKey(a).split(" ").filter(function(w){return w.length>2;});
    var common=kw.filter(function(w){return aw.indexOf(w)>=0;}).length;
    var sc=common/Math.max(1,Math.min(kw.length,aw.length));
    if(common&&sc>bs){bs=sc;best=a;}
  });
  return bs>=0.5?best:"";
}
function mpImpMapLoad(){try{return JSON.parse(localStorage.getItem("pp_mp_actmap")||"{}")||{};}catch(e){return {};}}
function mpImpMapSave(m){try{localStorage.setItem("pp_mp_actmap",JSON.stringify(m));}catch(e){}}

function MpImportModal({weeks,saveWeeks,plan,savePlan,knownActs,currentUser,onClose}){
  const [an,setAn]=useState(null);
  const [err,setErr]=useState("");
  const [fileName,setFileName]=useState("");
  const [paste,setPaste]=useState("");
  const [year,setYear]=useState(Number(today().slice(0,4)));
  const [colsAre,setColsAre]=useState("company");
  const [fixed,setFixed]=useState("");
  const [mode,setMode]=useState("replace");
  const [map,setMap]=useState({});            // file activity → "new" | "none" | "skip" | existing name
  function load(rows,name){
    var a=mpImpAnalyse(rows);
    if(a.error){setErr(a.error);setAn(null);return;}
    setErr("");setAn(a);setFileName(name||"");
    // the year of the first week: the current year, unless the file names one
    var y=null;
    if(a.layout==="matrix")a.weekCols.some(function(wc){if(wc.cell.year){y=wc.cell.year;return true;}return false;});
    else a.body.some(function(r){var c=a.cW>=0?mpImpWeekCell(r[a.cW]):null;if(c&&c.year){y=c.year;return true;}return false;});
    if(y)setYear(y);
  }
  function onFile(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    var rd=new FileReader();
    if(/\.(csv|txt)$/i.test(f.name)){
      rd.onload=function(){load(mpImpParseText(rd.result),f.name);};rd.readAsText(f);
    }else{
      if(!window.XLSX||!window.XLSX.read){setErr("The Excel library is not loaded: save the sheet as CSV and import the CSV.");return;}
      rd.onload=function(){
        try{
          var wb=window.XLSX.read(new Uint8Array(rd.result),{type:"array",cellDates:true});
          var sh=wb.Sheets[wb.SheetNames[0]];
          load(window.XLSX.utils.sheet_to_json(sh,{header:1,defval:"",raw:true}),f.name+" · "+wb.SheetNames[0]);
        }catch(x){setErr("This file could not be read: "+x.message);}
      };
      rd.readAsArrayBuffer(f);
    }
  }
  var res=an?mpImpItems(an,{year:year,colsAre:colsAre,fixed:fixed}):{items:[],skipped:0};
  // activities met in the file, and their default choice
  var fileActs={};res.items.forEach(function(it){if(it.activity){var k=mpActKey(it.activity);var o=fileActs[k]||(fileActs[k]={name:it.activity,zone:it.zone||"",hours:0,rows:0});o.hours+=it.hours;o.rows++;}});
  var remembered=mpImpMapLoad();
  function choice(k){
    if(map[k]!==undefined)return map[k];
    var r=remembered[k];if(r&&(r==="none"||r==="skip"||knownActs.indexOf(r)>=0))return r;
    return mpImpGuess(fileActs[k].name,knownActs)||"new";
  }
  // how each file activity meets the webapp: same name, a remembered choice, a guess, or nothing
  function status(k,noPick){
    if(!noPick&&map[k]!==undefined)return "chosen";
    if(knownActs.some(function(a){return mpActKey(a)===k;}))return "same";
    var r=remembered[k];if(r&&(r==="none"||r==="skip"||knownActs.indexOf(r)>=0))return "remembered";
    return mpImpGuess(fileActs[k].name,knownActs)?"guess":"none";
  }
  var ST_ORDER={none:0,guess:1,chosen:2,remembered:3,same:4};
  var actKeys=Object.keys(fileActs).sort(function(a,b){return ST_ORDER[status(a,true)]-ST_ORDER[status(b,true)]||fileActs[b].hours-fileActs[a].hours;});
  var unmatched=actKeys.filter(function(k){var st=status(k,true);return st==="none"||st==="guess";}).length;
  var wkSet={};res.items.forEach(function(it){wkSet[it.week]=1;});
  var wkList=Object.keys(wkSet).sort();
  var existing=wkList.filter(function(w){return weeks.some(function(x){return _flowMonday(x.week)===w&&(x.real||[]).length;});});
  var total=res.items.reduce(function(s,it){return s+it.hours;},0);
  var skipH=res.items.filter(function(it){return it.activity&&choice(mpActKey(it.activity))==="skip";}).reduce(function(s,it){return s+it.hours;},0);

  function apply(){
    if(blockIfReadOnly())return;
    if(!res.items.length)return;
    // 1. new activities become plan lines (0 workers over the weeks they appear in), so they get a budget later
    var newPlan=plan.slice(),created=[];
    actKeys.forEach(function(k){
      if(choice(k)!=="new")return;
      var ws=res.items.filter(function(it){return mpActKey(it.activity)===k;}).map(function(it){return it.week;}).sort();
      var line=newMpPlanLine({label:fileActs[k].name,workers:0,start:ws[0],end:ws[ws.length-1],note:"Created by the import of "+(fileName||"a file")+" — set the workers to give it a budget"});
      newPlan.push(line);created.push(line.label);
    });
    // 2. the hours, week by week
    var byWeek={};
    res.items.forEach(function(it){
      var act="",src="";
      if(it.activity){var c=choice(mpActKey(it.activity));if(c==="skip")return;act=c==="none"?"":c==="new"?fileActs[mpActKey(it.activity)].name:c;src=fileActs[mpActKey(it.activity)].name;}
      var l=byWeek[it.week]||(byWeek[it.week]=[]);
      var hit=l.find(function(x){return mpCompanyKey(x.company)===mpCompanyKey(it.company)&&mpActKey(x.activity)===mpActKey(act)&&mpActKey(x.src)===mpActKey(src);});
      if(hit)hit.hours+=it.hours;else l.push({company:it.company,activity:act,src:src,hours:it.hours});
    });
    var next=weeks.slice();
    Object.keys(byWeek).forEach(function(w){
      var i=next.findIndex(function(x){return _flowMonday(x.week)===w;});
      var lines=byWeek[w].map(function(x){var o={company:x.company,activity:x.activity,hours:Math.round(x.hours*100)/100};if(x.src)o.src=x.src;return o;});
      if(i<0){next.push(newManpowerWeek({week:w,real:lines,note:"Imported"+(fileName?" from "+fileName:""),updatedBy:currentUser||"",updatedAt:today()}));return;}
      var cur=next[i],real;
      if(mode==="replace")real=lines;
      else{
        real=(cur.real||[]).map(function(r){return Object.assign({},r);});
        lines.forEach(function(x){
          var h=real.find(function(r){return mpCompanyKey(r.company)===mpCompanyKey(x.company)&&mpActKey(r.activity)===mpActKey(x.activity)&&mpActKey(r.src)===mpActKey(x.src);});
          if(h)h.hours=x.hours;else real.push(x);
        });
      }
      next[i]=Object.assign({},cur,{real:real,updatedBy:currentUser||"",updatedAt:today()});
    });
    // remember the choices for the next file
    var mem=mpImpMapLoad();actKeys.forEach(function(k){var c=choice(k);mem[k]=c==="new"?fileActs[k].name:c;});mpImpMapSave(mem);
    if(created.length)savePlan(newPlan);
    saveWeeks(next);
    safeAlert(invFmt(total-skipH,0)+" h imported over "+Object.keys(byWeek).length+" week(s)."+(created.length?"\n\nNew WBS added to the plan (0 workers — give them workers to get a budget):\n• "+created.join("\n• "):""));
    onClose();
  }

  var inp={padding:"5px 8px",fontSize:13};
  var footer=<React.Fragment>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-pri" disabled={!res.items.length} onClick={apply}>Import {res.items.length?invFmt(total-skipH,0)+" h":""}</button>
  </React.Fragment>;
  return <InvModal title="⬆ Import real hours" width={820} onClose={onClose} footer={footer}>
    <div style={{fontSize:12,color:"#6f6b62",marginBottom:10}}>
      Excel or CSV. Either <b>one row per week</b> with a <b>Week</b> column and one column per company (or per activity) — like the CSV exported here —
      or <b>one row per week × company × activity</b> with columns <b>Week · Company · Activity · Hours</b>,
      or <b>one row per activity and one column per week</b> (time-keeping export: Week · 2026-13 · 2026-14 …, Zoning / Activity rows). Weeks as numbers (W42, S42, 42, 2026-42) or dates.
    </div>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
      <input type="file" accept=".xlsx,.xls,.xlsm,.csv,.txt" onChange={onFile}/>
      <span style={{fontSize:11,color:"#9b968b"}}>or paste the cells:</span>
      <textarea value={paste} onChange={function(e){setPaste(e.target.value);}} rows={2} placeholder="paste from Excel, headings included"
        style={{flex:"1 1 220px",fontFamily:"var(--font-mono)",fontSize:11,padding:4}}/>
      <button className="btn btn-sm" disabled={!paste.trim()} onClick={function(){load(mpImpParseText(paste),"pasted cells");}}>Read</button>
    </div>
    {err&&<div style={{color:"#b3302a",fontSize:12.5,margin:"6px 0"}}>{err}</div>}
    {an&&<div>
      <div style={{background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 12px",marginBottom:10,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",fontSize:12.5}}>
        <span><b>{fileName}</b> · {an.layout==="long"?"one row per week × company × activity":an.layout==="matrix"?"one row per activity, "+an.weekCols.length+" week columns":"one row per week, "+an.valueCols.length+" value column"+(an.valueCols.length!==1?"s":"")}</span>
        {(an.layout==="matrix"?an.weekCols.some(function(wc){return !wc.cell.year&&!wc.cell.date;}):an.cW>=0&&an.cD<0)&&<label style={{display:"flex",alignItems:"center",gap:5,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12.5,fontFamily:"inherit"}}>Year of the first week
          <input type="number" value={year} onChange={function(e){setYear(Number(e.target.value)||year);}} style={Object.assign({},inp,{width:80})}/></label>}
        {an.layout==="wide"&&<span style={{display:"flex",alignItems:"center",gap:6}}>Columns {an.valueCols.map(function(c){return c.name;}).slice(0,4).join(", ")}{an.valueCols.length>4?"…":""} are
          <select value={colsAre} onChange={function(e){setColsAre(e.target.value);setFixed("");setMap({});}} style={inp}>
            <option value="company">companies</option><option value="activity">activities</option></select></span>}
        {(an.layout==="wide"||(an.cC<0)||(an.cA<0))&&<span style={{display:"flex",alignItems:"center",gap:6}}>
          {(an.layout==="wide"?colsAre==="company":an.layout!=="matrix"&&an.cA<0)?"Activity for all these hours":"Company for all these hours"}
          {(an.layout==="wide"?colsAre==="company":an.layout!=="matrix"&&an.cA<0)
            ?<select value={fixed} onChange={function(e){setFixed(e.target.value);}} style={inp}><option value="">— none —</option>{knownActs.map(function(a){return <option key={a} value={a}>{a}</option>;})}</select>
            :<input type="text" value={fixed} onChange={function(e){setFixed(e.target.value);}} placeholder="optional" style={Object.assign({},inp,{width:140})}/>}
        </span>}
      </div>
      {!res.items.length&&<div style={{color:"#b3302a",fontSize:12.5}}>No hours found under the headings{res.skipped?" ("+res.skipped+" row(s) without a readable week)":""}.</div>}
      {res.items.length>0&&<div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12.5,marginBottom:10}}>
        <span><b>{invFmt(total,0)} h</b> in {res.items.length} line{res.items.length!==1?"s":""}</span>
        <span>{wkList.length} week{wkList.length!==1?"s":""}: W{mpIsoWeek(wkList[0])} {fmtDate(wkList[0])} → W{mpIsoWeek(wkList[wkList.length-1])} {fmtDate(wkList[wkList.length-1])}</span>
        {res.skipped>0&&<span style={{color:"#b35c00"}}>{res.skipped} row(s) skipped (no readable week or hours)</span>}
      </div>}
      {existing.length>0&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12.5,background:"#fff8e1",border:"1px solid #f0e2b8",borderRadius:8,padding:"6px 10px",marginBottom:10}}>
        <span>{existing.length} week{existing.length!==1?"s":""} already have real hours ({existing.slice(0,4).map(function(w){return "W"+mpIsoWeek(w);}).join(", ")}{existing.length>4?"…":""}):</span>
        <label style={{display:"flex",alignItems:"center",gap:4,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12.5,fontFamily:"inherit"}}><input type="radio" checked={mode==="replace"} onChange={function(){setMode("replace");}}/>replace them with the file</label>
        <label style={{display:"flex",alignItems:"center",gap:4,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12.5,fontFamily:"inherit"}}><input type="radio" checked={mode==="merge"} onChange={function(){setMode("merge");}}/>keep them, update the same company + activity</label>
      </div>}
      {actKeys.length>0&&<div>
        <div style={{display:"flex",alignItems:"baseline",gap:8,margin:"4px 0 6px",flexWrap:"wrap"}}>
          <div style={{fontWeight:700,fontSize:13}}>Activities in the file → WBS in the webapp</div>
          <span style={{fontSize:11.5,color:unmatched?"#b35c00":"#1e6b3a"}}>{unmatched?unmatched+" of "+actKeys.length+" without a WBS of the same name — check the proposals":"all matched"}</span>
        </div>
        <table className="tbl" style={{fontSize:12}}>
          <thead><tr><th>In the file</th><th style={{textAlign:"right"}}>Hours</th><th>WBS in the webapp</th></tr></thead>
          <tbody>{actKeys.map(function(k){
            var c=choice(k),isNew=c==="new",st=status(k);
            var badge={same:["✓ same name","#1e6b3a"],remembered:["↺ last choice","#555"],chosen:["✎ your choice","#2b6cb0"],guess:["? proposal","#b35c00"],none:["no match","#b3302a"]}[st];
            return <tr key={k}>
              <td style={{fontWeight:600}}>{fileActs[k].name}
                <div style={{fontSize:10,fontWeight:400,color:badge[1]}}>{badge[0]}{fileActs[k].zone?<span style={{color:"#9b968b"}}> · {fileActs[k].zone}</span>:null}</div></td>
              <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(fileActs[k].hours,0)}</td>
              <td><select value={c} onChange={function(e){var v=e.target.value;setMap(function(m){var n=Object.assign({},m);n[k]=v;return n;});}}
                style={Object.assign({},inp,{width:"100%",maxWidth:360,background:isNew?"#e8f5e9":c==="skip"?"#fce4ec":"#fff"})}>
                <option value="new">➕ Add the WBS “{fileActs[k].name}” to the webapp</option>
                {knownActs.length>0&&<optgroup label="Match to the WBS">{knownActs.map(function(a){return <option key={a} value={a}>= {a}</option>;})}</optgroup>}
                <option value="none">Import without WBS</option>
                <option value="skip">Do not import these hours</option>
              </select></td>
            </tr>;
          })}</tbody>
        </table>
        <div style={{fontSize:11,color:"#9b968b",marginTop:4}}>Proposals come from the names; your choices are remembered on this browser for the next import. Whatever the choice, the file's activity name is kept on each line, so the views can be filtered by WBS and by file activity. An added WBS becomes a plan line with 0 workers over the weeks it appears in — give it workers in the Plan tab to get its budget.</div>
      </div>}
    </div>}
  </InvModal>;
}

// ---------------------------------------------------------------- week editor (real hours)
function MpWeekEditor({w,known,knownActs,can,isNew,M,onSave,onDelete,onClose}){
  const [d,setD]=useState(w);
  const [paste,setPaste]=useState("");
  const [showPaste,setShowPaste]=useState(false);
  function set(k,v){setD(function(o){var n=Object.assign({},o);n[k]=v;return n;});}
  function setRow(i,k,v){setD(function(o){var rs=(o.real||[]).map(function(r,j){if(j!==i)return r;var u=Object.assign({},r);u[k]=v;return u;});return Object.assign({},o,{real:rs});});}
  function addRow(){setD(function(o){return Object.assign({},o,{real:(o.real||[]).concat([{company:"",activity:"",hours:""}])});});}
  function delRow(i){setD(function(o){return Object.assign({},o,{real:(o.real||[]).filter(function(_,j){return j!==i;})});});}
  function applyPaste(replace){
    var res=mpParseCompanyPaste(paste);
    if(!res.rows.length){safeAlert("Nothing recognised. One line per company: the company name, then the hours (tab or ; between them).");return;}
    setD(function(o){
      var rs=replace?[]:(o.real||[]).filter(function(r){return String(r.company||"").trim();}).map(function(r){return Object.assign({},r);});
      res.rows.forEach(function(p){
        var hit=rs.find(function(r){return mpCompanyKey(r.company)===mpCompanyKey(p.company)&&mpActKey(r.activity)===mpActKey(p.activity);});
        if(hit)hit.hours=p.hours;else rs.push({company:p.company,activity:p.activity,hours:p.hours});
      });
      return Object.assign({},o,{real:rs});
    });
    setPaste("");setShowPaste(false);
    if(res.skipped)safeAlert(res.skipped+" line(s) skipped (no company or no number).");
  }
  var real=mpReal(d);
  var monday=isValidDate(d.week)?_flowMonday(d.week):"";
  var row=monday&&M?M.rows.find(function(r){return r.week===monday;}):null;
  var budget=row&&row.src==="plan"?row.budget:(mpHas(d.approved)?Number(d.approved):null);
  var inp={padding:"6px 8px",fontSize:13};
  var footer=<React.Fragment>
    {can&&!isNew&&<button className="btn btn-danger" style={{marginRight:"auto"}} onClick={onDelete}>🗑 Delete</button>}
    <button className="btn" onClick={onClose}>{can?"Cancel":"Close"}</button>
    {can&&<button className="btn btn-pri" disabled={!monday} onClick={function(){onSave(Object.assign({},d,{week:monday}));}}>Save</button>}
  </React.Fragment>;
  return <InvModal title={(isNew?"New week":"Week")+(monday?" · W"+mpIsoWeek(monday):"")} width={640} onClose={onClose} footer={footer}>
    <div className="frow">
      <div className="fg"><label>Week (any day, saved as its Monday)</label>
        <input type="date" value={d.week||""} disabled={!can} onChange={function(e){set("week",e.target.value);}} style={inp}/>
        {monday&&<span style={{fontSize:11,color:"#888"}}>Monday {fmtDate(monday)} → Sunday {fmtDate(addCalDays(monday,6))}</span>}</div>
      {row&&row.src==="plan"
        ?<div className="fg"><label>Budget from the plan</label>
          <div style={{fontSize:15,fontWeight:800,color:MP_COL_BUDGET,fontFamily:"var(--font-mono)",padding:"6px 0"}}>{invFmt(row.budget,0)} h</div>
          <span style={{fontSize:11,color:"#888"}}>{invFmt(row.workers,1)} workers planned</span></div>
        :<div className="fg"><label>Budget (manual — no plan line covers this week)</label>
          <input type="number" min="0" value={d.approved} disabled={!can} onChange={function(e){set("approved",e.target.value);}} style={inp}/></div>}
    </div>
    <div style={{display:"flex",alignItems:"baseline",gap:8,margin:"6px 0 6px"}}>
      <div style={{fontWeight:700,fontSize:13}}>Real hours by company and activity</div>
      <span style={{fontSize:12,color:MP_COL_REAL,fontWeight:700,fontFamily:"var(--font-mono)"}}>{invFmt(real,0)} h</span>
      {budget!==null&&real>0&&<span style={{fontSize:11,color:real>budget?"#b3302a":"#1e6b3a"}}>{mpSigned(real-budget)} h vs budget{budget?" ("+(real>=budget?"+":"")+Math.round((real-budget)/budget*100)+" %)":""}</span>}
      {can&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){setShowPaste(!showPaste);}}>📋 Paste from Excel</button>}
    </div>
    {showPaste&&<div style={{background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:10,marginBottom:10}}>
      <div style={{fontSize:11,color:"#6f6b62",marginBottom:6}}>One line per company: name, then hours — or name, activity, hours (copied from Excel or the time-keeping export). The same company and activity twice are added up.</div>
      <textarea value={paste} onChange={function(e){setPaste(e.target.value);}} rows={6} placeholder={"Glassco\tFormwork carpenters\t1 240\nSteelworks Ltd\tSteel fixers\t860\nCleanco\t120"}
        style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12,padding:6}}/>
      <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={function(){applyPaste(false);}} title="Companies already listed get the pasted hours; the others are added">Merge</button>
        <button className="btn btn-sm" onClick={function(){applyPaste(true);}} title="The pasted list replaces the lines below">Replace</button>
      </div>
    </div>}
    <datalist id="mp-activities">{(knownActs||[]).map(function(n){return <option key={n} value={n}/>;})}</datalist>
    <datalist id="mp-companies">{known.map(function(n){return <option key={n} value={n}/>;})}</datalist>
    <table className="tbl" style={{fontSize:12}}>
      <thead><tr><th>Company</th><th>Activity</th><th style={{textAlign:"right",width:110}}>Hours</th><th style={{width:34}}></th></tr></thead>
      <tbody>
        {(d.real||[]).length===0&&<tr><td colSpan={4} style={{color:"#9b968b"}}>No company yet.</td></tr>}
        {(d.real||[]).map(function(r,i){
          return <tr key={i}>
            <td><input type="text" list="mp-companies" value={r.company||""} disabled={!can} onChange={function(e){setRow(i,"company",e.target.value);}} placeholder="Company of the workers" style={{width:"100%",padding:"4px 6px"}}/></td>
            <td><input type="text" list="mp-activities" value={r.activity||""} disabled={!can} onChange={function(e){setRow(i,"activity",e.target.value);}} placeholder="Activity (plan line)" style={{width:"100%",padding:"4px 6px"}}/>
              {r.src&&<div style={{fontSize:10,color:"#8b8578",marginTop:2}} title="Activity as named in the imported file">file: {r.src}</div>}</td>
            <td><input type="number" min="0" value={r.hours} disabled={!can} onChange={function(e){setRow(i,"hours",e.target.value);}} style={{width:"100%",padding:"4px 6px",textAlign:"right"}}/></td>
            <td>{can&&<button onClick={function(){delRow(i);}} style={{background:"none",border:"none",cursor:"pointer",color:"#ccc"}}>✕</button>}</td>
          </tr>;
        })}
      </tbody>
    </table>
    {can&&<button className="btn btn-sm" style={{marginTop:6}} onClick={addRow}>＋ Company</button>}
    <div className="fg" style={{marginTop:12}}><label>Note</label>
      <input type="text" value={d.note||""} disabled={!can} onChange={function(e){set("note",e.target.value);}} placeholder="e.g. 2 days of rain, public holiday…" style={inp}/></div>
    {d.updatedBy&&<div style={{fontSize:11,color:"#9b968b"}}>Last saved by {d.updatedBy}{d.updatedAt?" · "+fmtDate(d.updatedAt):""}</div>}
  </InvModal>;
}

