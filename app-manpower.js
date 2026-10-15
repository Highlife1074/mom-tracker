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
//   pp_manpower_meta  {id:"budget", kind:"budget", lines:[{id, wbs, amount (€), awarded (€), awardedTo, note}],
//                     amount (= Σ lines,
//                     the only figure of the first version), rate (€/h), start, end, byWeek:{monday: h},
//                     alignedTo, updatedBy, updatedAt} — the global budget, set by the admin only — and the
//                     overview notes {id, kind:"note", date, at, author, text}.
//
// Three series:
//   Budget   = Σ budget lines (€, one per budget WBS the money comes from) less what was awarded to a
//              subcontractor on each line (net = amount − awarded) ÷ hourly rate, spread evenly over the working days (Mon–Sat) from start to end;
//              byWeek holds the weeks the admin aligned on the real hours ("budget = real" on the past).
//   Planned  = Σ plan lines of a week (workers that week × hours per worker per week).
//   Real     = the hours entered or imported.
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

var MP_COL_BUDGET="#a8862e";     // planned series (plan lines) — the name predates the € budget
var MP_COL_BGT="#1f7a4d";        // budget series (€ budget ÷ hourly rate)
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
function mpSigned(v){if(v===null||v===undefined||!isFinite(v))return"—";if(Math.round(v)===0)return"0";return (v>0?"+":"")+invFmt(v,0);}

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

// ---------------------------------------------------------------- € budget
function mpBudgetRec(meta){return (meta||[]).find(function(x){return x&&x.kind==="budget";})||null;}
// Budget lines: the money comes from several budget WBS. A budget saved before the lines existed
// is read as one line without WBS.
function mpBudgetLines(b){
  if(!b)return [];
  if(Array.isArray(b.lines)&&b.lines.length)return b.lines;
  return mpHas(b.amount)&&Number(b.amount)?[{id:"l0",wbs:"",amount:Number(b.amount),note:""}]:[];
}
// Net of a line: the budget less what was awarded to a subcontractor (never below 0). The hours
// budget is built on the net: the awarded part is no longer our own manpower.
function mpLineNet(l){return Math.max(0,_invNum(l.amount)-_invNum(l.awarded));}
function mpBudgetAmount(b,wbs,what){
  return mpBudgetLines(b).filter(function(l){return !wbs||mpActKey(l.wbs)===mpActKey(wbs);})
    .reduce(function(s,l){return s+(what==="gross"?_invNum(l.amount):what==="awarded"?_invNum(l.awarded):mpLineNet(l));},0);
}
function mpBudgetHours(b,wbs){return b&&mpHas(b.rate)&&Number(b.rate)>0?mpBudgetAmount(b,wbs)/Number(b.rate):0;}
function mpBudgetRate(b){return b&&mpHas(b.rate)&&Number(b.rate)>0?Number(b.rate):0;}
// Budget hours per week (Monday → h): amount ÷ rate spread over the working days between start
// and end, then the weeks aligned on the real (byWeek) take their own figure. With wbs: the
// budget lines of that WBS only (the alignment on the real is the whole project's: left out).
function mpBudgetWeeks(b,wbs){
  var out={};if(!b)return out;
  if(isValidDate(b.start)&&isValidDate(b.end)&&b.end>=b.start){
    var H=mpBudgetHours(b,wbs),ws=mpWeeksBetween(b.start,b.end),days={},D=0;
    ws.forEach(function(w){var n=0;for(var d=0;d<MP_WORK_DAYS;d++){var x=addCalDays(w,d);if(x>=b.start&&x<=b.end)n++;}days[w]=n;D+=n;});
    ws.forEach(function(w){out[w]=D?H*days[w]/D:0;});
  }
  if(!wbs)Object.keys(b.byWeek||{}).forEach(function(w){if(mpHas(b.byWeek[w]))out[w]=Number(b.byWeek[w]);});
  return out;
}

// Everything the views show, from the plan and the weekly entries.
// opt.bgt = budget hours per week (mpBudgetWeeks) · opt.cutoff = the cut-off of a filtered view.
function mpModel(plan,weeks,opt){
  opt=opt||{};
  plan=(plan||[]).filter(function(l){return isValidDate(l.start)&&isValidDate(l.end);});
  var entries={};(weeks||[]).forEach(function(e){if(isValidDate(e.week))entries[_flowMonday(e.week)]=e;});
  var set={};
  plan.forEach(function(l){mpWeeksBetween(l.start,l.end).forEach(function(w){set[w]=1;});});
  Object.keys(entries).forEach(function(w){set[w]=1;});
  var bgtW=opt.bgt||null;
  if(bgtW)Object.keys(bgtW).forEach(function(w){set[w]=1;});
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
  var rows=[],cB=0,cR=0,cBd=0,peak=0,peakWeek="",cG=0,cGd=0;
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
    var bgt=bgtW?(bgtW[w]||0):0;cG+=bgt;if(toDate)cGd+=bgt;
    if(workers>peak){peak=workers;peakWeek=w;}
    rows.push({week:w,entry:e,workers:workers,budget:budget,src:src,real:real,hasR:hasR,toDate:toDate,
      diff:hasR?real-budget:null,pct:hasR&&budget?Math.round((real-budget)/budget*100):null,cumB:cB,cumR:cR,cumBd:cBd,
      bgt:bgt,cumG:cG,cumGd:cGd});
  });
  // months: each week split over its working days
  var mon={};
  rows.forEach(function(r){
    var sh=mpMonthShares(r.week);
    Object.keys(sh).forEach(function(k){
      var m=mon[k]||(mon[k]={month:k,budget:0,budgetToDate:0,real:0,hasR:false,bgt:0,bgtToDate:0});
      m.budget+=r.budget*sh[k];m.bgt+=r.bgt*sh[k];if(r.toDate)m.bgtToDate+=r.bgt*sh[k];
      if(r.toDate)m.budgetToDate+=r.budget*sh[k];
      if(r.hasR){m.real+=r.real*sh[k];m.hasR=true;}
    });
  });
  var months=Object.keys(mon).sort().map(function(k){return mon[k];});
  var mb=0,mr=0,mbd=0,mg=0;
  months.forEach(function(m){mb+=m.budget;mr+=m.real;mbd+=m.budgetToDate;m.cumB=mb;m.cumR=mr;m.cumBd=mbd;mg+=m.bgt;m.cumG=mg;
    m.diff=m.hasR?m.real-m.budgetToDate:null;m.pct=m.hasR&&m.budgetToDate?Math.round((m.real-m.budgetToDate)/m.budgetToDate*100):null;});
  var tot={budget:cB,budgetToDate:cBd,real:cR,remaining:cB-cBd,eac:cR+(cB-cBd),
    diff:cutoff?cR-cBd:null,pct:cutoff&&cBd?Math.round((cR-cBd)/cBd*100):null,
    peak:peak,peakWeek:peakWeek,start:all[0]||"",end:all[all.length-1]||"",cutoff:cutoff,weeks:all.length};
  tot.eacDiff=tot.eac-cB;
  var pw=rows.filter(function(r){return r.src==="plan";});      // the weeks the plan covers (the budget may run longer)
  tot.planStart=pw.length?pw[0].week:"";tot.planEnd=pw.length?pw[pw.length-1].week:"";tot.planWeeks=pw.length;
  // € budget: total, to date, variances of the real against it
  tot.hasBgt=!!bgtW&&cG>0;tot.bgt=cG;tot.bgtToDate=cGd;tot.bgtRemaining=cG-cGd;
  tot.bgtDiff=tot.hasBgt&&cutoff?cR-cGd:null;tot.bgtPct=tot.bgtDiff!==null&&cGd?Math.round(tot.bgtDiff/cGd*100):null;
  tot.eacBgtDiff=tot.hasBgt?tot.eac-cG:null;
  var companies=Object.keys(comp).map(function(k){return comp[k];}).sort(function(a,b){return (b.real+b.budget)-(a.real+a.budget);});
  var activities=Object.keys(acts).map(function(k){return acts[k];}).sort(function(a,b){return (b.real+b.budget)-(a.real+a.budget);});
  var srcList=Object.keys(srcs).map(function(k){return srcs[k];}).sort(function(a,b){return b.real-a.real;});
  return {rows:rows,months:months,tot:tot,companies:companies,activities:activities,srcs:srcList,plan:plan};
}

// "Planned = real on the past": every plan line gets, for each week up to the cut-off, the head
// count that gives the real hours of its WBS (real ÷ hours per worker), so planned = real per WBS
// and per week. A WBS with real hours and no plan line gets a new line. Several lines with the
// same name: the first one takes the real, the others 0. Real hours without a WBS cannot be
// placed (returned as untagged). prev = what the touched lines were, to undo.
function mpAlignPlan(plan,weeks,cutoff){
  var realBy={},names={},untagged=0,first="";
  (weeks||[]).forEach(function(e){
    if(!isValidDate(e.week))return;var w=_flowMonday(e.week);if(w>cutoff)return;
    (e.real||[]).forEach(function(r){
      var h=_invNum(r.hours);if(!h)return;
      var k=mpActKey(r.activity);if(!k){untagged+=h;return;}
      var m=realBy[k]||(realBy[k]={});m[w]=(m[w]||0)+h;names[k]=names[k]||String(r.activity).trim();
      if(!first||w<first)first=w;
    });
  });
  var next=plan.map(function(l){return l;}),prev=[],created=[];
  Object.keys(realBy).forEach(function(k){
    if(next.some(function(l){return l.label&&mpActKey(l.label)===k;}))return;
    var ws=Object.keys(realBy[k]).sort();
    var nl=newMpPlanLine({label:names[k],workers:0,start:ws[0],end:ws[ws.length-1],note:"Created by “Planned = real on the past”"});
    next.push(nl);created.push(nl.id);
  });
  var firstOf={};                                            // the line of each WBS that takes the real
  next.slice().sort(function(a,b){return (a.start||"").localeCompare(b.start||"");})
    .forEach(function(l){var k=mpActKey(l.label);if(k&&!firstOf[k])firstOf[k]=l.id;});
  next=next.map(function(l){
    if(!isValidDate(l.start)||!isValidDate(l.end))return l;
    var k=mpActKey(l.label),mine=k&&firstOf[k]===l.id?(realBy[k]||{}):{};
    var rw=Object.keys(mine).sort();
    var st=l.start,en=l.end;
    if(rw.length){if(rw[0]<st)st=rw[0];if(rw[rw.length-1]>en)en=rw[rw.length-1];}
    if(st>cutoff&&!rw.length)return l;                      // a line that starts after the cut-off is left alone
    var hpw=mpLineHpw(l),bw=Object.assign({},l.byWeek||{});
    mpWeeksBetween(st,en<cutoff?en:cutoff).forEach(function(w){bw[w]=Math.round((mine[w]||0)/hpw*1e6)/1e6;});
    if(created.indexOf(l.id)<0)prev.push({id:l.id,start:l.start,end:l.end,byWeek:l.byWeek||{}});
    return Object.assign({},l,{start:st,end:en,byWeek:bw});
  });
  return {plan:next,prev:prev,created:created,untagged:untagged};
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
function ManpowerView({weeks,saveWeeks,plan,savePlan,meta,saveMeta,isAdmin,contractors,canEdit,currentUser}){
  weeks=weeks||[];plan=plan||[];meta=meta||[];saveMeta=saveMeta||function(){};
  const [tab,setTab]=useState(plan.length||weeks.length?"overview":"plan");
  const [edit,setEdit]=useState(null);       // week entry being edited
  const [importing,setImporting]=useState(false);
  const [fWbs,setFWbs]=useState("");         // filter: webapp WBS (activity / plan line name)
  const [fSrc,setFSrc]=useState("");         // filter: activity name in the imported file
  var can=canEdit&&!window._ppReadOnly;
  var bRec=mpBudgetRec(meta);
  var M0=mpModel(plan,weeks,{bgt:bRec?mpBudgetWeeks(bRec):null});
  var filtered=!!(fWbs||fSrc);
  var F=mpFilter(plan,weeks,fWbs,fSrc);
  // the € budget is the whole project's: a filtered view compares real to planned only
  // a WBS filter keeps the budget lines of that WBS, when there are some
  var fBgt=fWbs&&!fSrc&&bRec&&mpBudgetAmount(bRec,fWbs)>0?mpBudgetWeeks(bRec,fWbs):null;
  var M=filtered?mpModel(F.plan,F.weeks,{cutoff:M0.tot.cutoff,bgt:fBgt}):M0;
  // ---- planned = real on the past (admin), with undo
  var planAlign=meta.find(function(x){return x&&x.kind==="planAlign";})||null;
  function alignPlanOnReal(){
    if(!isAdmin){safeAlert("Only the admin may align the planned hours on the real.");return;}
    if(blockIfReadOnly())return;
    var co=M0.tot.cutoff;if(!co){safeAlert("No real hours yet: nothing to align.");return;}
    var r=mpAlignPlan(plan,weeks,co);
    var before=M0.tot.budgetToDate,after=mpModel(r.plan,weeks).tot.budgetToDate;
    if(!safeConfirm("Set the planned hours equal to the real hours on every week up to W"+mpIsoWeek(co)+" ("+fmtDate(co)+"), WBS by WBS?\n\n"+
      "Planned to date: "+invFmt(before,0)+" h → "+invFmt(after,0)+" h (real "+invFmt(M0.tot.real,0)+" h).\n"+
      "The weeks after the cut-off keep their plan."+(r.created.length?"\n"+r.created.length+" plan line(s) created for WBS with real hours and no plan line.":"")+
      (r.untagged?"\n"+invFmt(r.untagged,0)+" h of real hours have no WBS and cannot be placed: tag them in the weeks first.":"")+
      "\n\n“Undo” in the Plan tab puts the plan back as it was."))return;
    savePlan(r.plan);
    var rec={id:"planAlign",kind:"planAlign",cutoff:co,prev:r.prev,created:r.created,at:today(),by:currentUser||""};
    _invUpsert(meta,saveMeta,rec);
  }
  function undoPlanAlign(){
    if(!isAdmin||blockIfReadOnly()||!planAlign)return;
    if(!safeConfirm("Put the plan back as it was before “Planned = real on the past” of "+fmtDate(planAlign.at)+"?\nChanges made to these lines since then are lost."))return;
    var pv={};(planAlign.prev||[]).forEach(function(x){pv[x.id]=x;});
    var next=plan.filter(function(l){return (planAlign.created||[]).indexOf(l.id)<0;})
      .map(function(l){var x=pv[l.id];return x?Object.assign({},l,{start:x.start,end:x.end,byWeek:x.byWeek||{}}):l;});
    savePlan(next);
    saveMeta(meta.filter(function(x){return x.id!=="planAlign";}));
  }
  var notes=meta.filter(function(x){return x&&x.kind==="note";}).sort(function(a,b){return String(b.at||b.date||"").localeCompare(String(a.at||a.date||""));});
  var filterLabel=filtered?[fWbs?"WBS “"+fWbs+"”":"",fSrc?"file activity “"+fSrc+"”":""].filter(Boolean).join(" · "):"";
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
    var rows=[["Week","Monday","Planned workers","Budget h","Planned h","Real h","Variance h (vs planned)","Variance %","Cumulative budget h","Cumulative planned h","Cumulative real h"].concat(names)];
    M.rows.forEach(function(r){
      var byC={};((r.entry&&r.entry.real)||[]).forEach(function(x){var k=mpCompanyKey(x.company)||"(no company)";byC[k]=(byC[k]||0)+_invNum(x.hours);});
      rows.push(["W"+mpIsoWeek(r.week),r.week,r.workers,M.tot.hasBgt?Math.round(r.bgt):"",Math.round(r.budget),r.hasR?r.real:"",r.diff===null?"":Math.round(r.diff),r.pct===null?"":r.pct,M.tot.hasBgt?Math.round(r.cumG):"",Math.round(r.cumB),r.hasR?r.cumR:""]
        .concat(M.companies.map(function(c){return byC[c.key]||"";})));
    });
    rows.push([]);rows.push(["Activity","","","Planned h","Planned to date h","Real h","Variance h (vs planned to date)"]);
    M.activities.forEach(function(a){rows.push([a.name,"","",Math.round(a.budget),Math.round(a.budgetToDate),a.real,a.real-a.budgetToDate]);});
    if(M.srcs.some(function(x){return x.key!=="(not imported)";})){
      rows.push([]);rows.push(["File activity","WBS (webapp)","","","","Real h"]);
      M.srcs.forEach(function(x){Object.keys(x.byWbs).forEach(function(wn){rows.push([x.name,wn,"","","",x.byWbs[wn]]);});});
    }
    rows.push([]);rows.push(["Month","","","Budget h","Planned h","Real h","Variance h (vs planned to date)","Variance %","Cumulative budget h","Cumulative planned h"]);
    M.months.forEach(function(m){rows.push([mpMonthLabel(m.month),"","",M.tot.hasBgt?Math.round(m.bgt):"",Math.round(m.budget),m.hasR?Math.round(m.real):"",m.diff===null?"":Math.round(m.diff),m.pct===null?"":m.pct,M.tot.hasBgt?Math.round(m.cumG):"",Math.round(m.cumB)]);});
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
        <div className="page-sub">Budget (€ ÷ hourly rate, spread over the duration) · planned (workers week by week) · real hours per week by company and activity → variances.</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        {!can&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Manpower editor”"}</span>}
        {!empty&&<button className="btn btn-sm" onClick={function(){mpOpenReport(M,bRec,notes,filterLabel,fBgt?fWbs:"");}} title="Printable report of the hours: budget, planned, real, months, weeks, activities, notes">🖨 Report</button>}
        {!empty&&<button className="btn btn-sm" onClick={exportCsv} title="Weeks and months, budget, planned, real and variances, one column per company (Excel opens it)">⬇ CSV</button>}
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
    {empty&&tab!=="plan"&&tab!=="overview"&&<div className="empty"><div className="empty-ico">👷</div>
      <div className="empty-txt">Nothing yet. Start with the plan: one line per trade or team, the number of workers and the weeks. The budget in hours follows.</div>
      {can&&<div style={{marginTop:12}}><button className="btn btn-pri" onClick={function(){setTab("plan");}}>Go to the plan</button></div>}</div>}
    {(tab==="overview"&&(!empty||bRec||isAdmin))&&<MpOverview M={M} M0={M0} filtered={filtered} fWbs={fWbs} knownActs={knownActs} onOpenWeek={openWeek} onAlignPlan={alignPlanOnReal} bRec={bRec} meta={meta} saveMeta={saveMeta}
      notes={notes} isAdmin={!!isAdmin&&!window._ppReadOnly} can={can} currentUser={currentUser}/>}
    {filtered&&tab!=="plan"&&!empty&&<div style={{fontSize:11.5,color:"#6f6b62",background:"#fff8e1",border:"1px solid #f0e2b8",borderRadius:8,padding:"5px 10px",marginBottom:10}}>
      Filtered on {fWbs?<b>WBS “{fWbs}”</b>:null}{fWbs&&fSrc?" · ":""}{fSrc?<b>file activity “{fSrc}”</b>:null} — real hours of these lines only; planned = the plan lines of {fWbs?"this WBS":"the WBS these hours are matched to"}{fSrc?" (shared with the other file activities matched to the same WBS)":""}.</div>}
    {tab==="plan"&&<MpPlan plan={plan} savePlan={savePlan} M={M0} can={can} known={known} isAdmin={!!isAdmin&&!window._ppReadOnly}
      onAlign={alignPlanOnReal} onUndoAlign={planAlign?undoPlanAlign:null} planAlign={planAlign}/>}
    {!empty&&tab==="weeks"&&<MpWeeks M={M} onOpen={openWeek} can={can}/>}
    {!empty&&tab==="months"&&<MpMonths M={M}/>}
    {!empty&&tab==="companies"&&<MpCompanies M={M}/>}
    {!empty&&tab==="activities"&&<MpActivities M={M} onPick={function(k,v){if(k==="wbs"){setFWbs(v);setFSrc("");}else setFSrc(v);}}/>}
    {empty&&tab==="overview"&&!bRec&&!isAdmin&&<div className="empty"><div className="empty-ico">👷</div>
      <div className="empty-txt">Nothing yet. Start with the plan: one line per trade or team, the number of workers and the weeks.</div></div>}
    {importing&&<MpImportModal weeks={weeks} saveWeeks={saveWeeks} plan={plan} savePlan={savePlan} knownActs={knownActs} currentUser={currentUser} onClose={function(){setImporting(false);}}/>}
    {edit&&<MpWeekEditor w={edit} known={known} knownActs={knownActs} can={can} M={M0} isNew={!weeks.some(function(x){return x.id===edit.id;})}
      onSave={saveWeek} onDelete={function(){delWeek(edit);}} onClose={function(){setEdit(null);}}/>}
  </div>;
}

// ---------------------------------------------------------------- overview
function MpOverview({M,M0,filtered,fWbs,knownActs,onOpenWeek,onAlignPlan,bRec,meta,saveMeta,notes,isAdmin,can,currentUser}){
  const [mode,setMode]=useState("cumul");
  const [editB,setEditB]=useState(null);
  var t=M.tot,rate=mpBudgetRate(bRec);
  var worst=M.rows.filter(function(r){return r.hasR&&r.diff!==null;}).slice().sort(function(a,b){return Math.abs(b.diff)-Math.abs(a.diff);}).slice(0,5);
  function eur(h){return rate&&h!==null&&isFinite(h)?invFmt(h*rate,0)+" €":"";}
  var hasB=t.hasBgt;
  // ---- budget (admin only)
  function saveBudget(b){
    if(!isAdmin){safeAlert("Only the admin may change the budget.");return;}
    if(blockIfReadOnly())return;
    var lines=(b.lines||[]).filter(function(l){return String(l.wbs||"").trim()||mpHas(l.amount);})
      .map(function(l){return {id:l.id||uuid(),wbs:String(l.wbs||"").trim(),amount:mpHas(l.amount)?Number(l.amount):0,
        awarded:mpHas(l.awarded)?Number(l.awarded):0,awardedTo:String(l.awardedTo||"").trim(),note:String(l.note||"").trim()};});
    var amount=lines.reduce(function(s,l){return s+l.amount;},0);
    var over=lines.filter(function(l){return l.awarded>l.amount;});
    if(over.length&&!safeConfirm("The awarded amount is above the budget on "+over.map(function(l){return l.wbs||"(no WBS)";}).join(", ")+
      ": the net of these lines counts as 0 €. Save anyway?"))return;
    if(!(amount>0)||!(Number(b.rate)>0)){safeAlert("Give at least one budget line in € and the hourly rate.");return;}
    if(lines.some(function(l){return !(l.amount>0);})){safeAlert("Every budget line needs an amount in € (remove the empty ones).");return;}
    if(!isValidDate(b.start)||!isValidDate(b.end)||b.end<b.start){safeAlert("Give the start and the end of the budget (the end after the start).");return;}
    _invUpsert(meta,saveMeta,Object.assign({},b,{id:"budget",kind:"budget",lines:lines,amount:amount,rate:Number(b.rate),
      updatedBy:currentUser||"",updatedAt:today()}));
    setEditB(null);
  }
  // The real hours become the budget of every week up to the cut-off; the weeks after keep the spread.
  function alignOnReal(){
    if(!isAdmin){safeAlert("Only the admin may adjust the budget.");return;}
    if(blockIfReadOnly()||!bRec)return;
    var co=M0.tot.cutoff;
    if(!co){safeAlert("No real hours yet: nothing to align.");return;}
    var past=M0.rows.filter(function(r){return r.week<=co;});
    var before=past.reduce(function(s,r){return s+r.bgt;},0),after=past.reduce(function(s,r){return s+r.real;},0);
    if(!safeConfirm("Adjust the budget to the real hours on every week up to W"+mpIsoWeek(co)+" ("+fmtDate(co)+")?\n\n"+
      "Budget of these weeks: "+invFmt(before,0)+" h → "+invFmt(after,0)+" h (the real spent).\n"+
      "The weeks after the cut-off keep their budget, so the total budget becomes "+invFmt(M0.tot.bgt-before+after,0)+" h.\n\n"+
      "“Reset adjustments” in the budget card brings the even spread back."))return;
    var bw=Object.assign({},bRec.byWeek||{});
    past.forEach(function(r){bw[r.week]=Math.round(r.real*100)/100;});
    _invUpsert(meta,saveMeta,Object.assign({},bRec,{byWeek:bw,alignedTo:co,alignedBy:currentUser||"",alignedAt:today()}));
  }
  function resetAlign(){
    if(!isAdmin||blockIfReadOnly()||!bRec)return;
    if(!safeConfirm("Remove the adjustments and spread the budget evenly again over its duration?"))return;
    _invUpsert(meta,saveMeta,Object.assign({},bRec,{byWeek:{},alignedTo:"",alignedBy:"",alignedAt:""}));
  }
  // ---- notes
  const [txt,setTxt]=useState("");
  function addNote(){
    var v=txt.trim();if(!v)return;
    if(!can||blockIfReadOnly())return;
    saveMeta([{id:uuid(),kind:"note",date:today(),at:new Date().toISOString(),author:currentUser||"",text:v}].concat(meta));
    setTxt("");
  }
  function delNote(n){
    if(!(isAdmin||(can&&n.author===currentUser))){safeAlert("Only the author or the admin may delete a note.");return;}
    _invRemove(meta,saveMeta,n,"this note");
  }
  var nAligned=bRec?Object.keys(bRec.byWeek||{}).length:0;
  return <div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
      <InvBig label="Budget · whole duration" value={hasB?t.bgt:null} unit="h" colour={MP_COL_BGT} sub={hasB?(bRec?invFmt(mpBudgetAmount(bRec,filtered?fWbs:""),0)+" € net"+(mpBudgetAmount(bRec,filtered?fWbs:"","awarded")?" (awarded "+invFmt(mpBudgetAmount(bRec,filtered?fWbs:"","awarded"),0)+" € deducted)":"")+" · "+invFmt(rate,2)+" €/h"+(filtered?" · budget lines of this WBS":""):""):filtered&&bRec?"no budget line for this filter":"not set"+(isAdmin?" — set it below":" (admin)")}/>
      <InvBig label="Budget to date" value={hasB&&t.cutoff?t.bgtToDate:null} unit="h" colour={MP_COL_BGT} sub={hasB&&t.cutoff?"to W"+mpIsoWeek(t.cutoff)+(rate?" · "+eur(t.bgtToDate):""):""}/>
      <InvBig label="Planned · whole duration" value={t.budget} unit="h" colour={MP_COL_BUDGET} sub={t.planStart?fmtDate(t.planStart)+" → "+fmtDate(addCalDays(t.planEnd,6))+" · "+t.planWeeks+" weeks":""}/>
      <InvBig label="Planned to date" value={t.cutoff?t.budgetToDate:null} unit="h" colour={MP_COL_BUDGET} sub={t.cutoff?"to W"+mpIsoWeek(t.cutoff):"no real hours yet"}/>
      <InvBig label="Spent to date" value={t.real} unit="h" colour={MP_COL_REAL} sub={rate&&t.real?eur(t.real)+" at "+invFmt(rate,2)+" €/h":""}/>
      {hasB&&<InvBig label="Variance vs budget" value={t.bgtDiff} unit="h" colour={t.bgtDiff===null?null:mpVarCol(t.bgtPct)} sub={t.bgtPct===null?"spent − budget to date":(t.bgtPct>0?"+":"")+t.bgtPct+" % · "+(rate?eur(t.bgtDiff)+" · ":"")+(t.bgtDiff>0?"overspent":t.bgtDiff<0?"under budget":"on budget")}/>}
      <InvBig label="Variance vs planned" value={t.diff} unit="h" colour={t.diff===null?null:mpVarCol(t.pct)} sub={t.pct===null?"spent − planned to date":(t.pct>0?"+":"")+t.pct+" % · "+(t.diff>0?"above plan":t.diff<0?"below plan":"on plan")}/>
      <InvBig label="Remaining planned" value={t.remaining} unit="h" sub="plan after the cut-off"/>
      <InvBig label="Forecast at completion" value={t.eac} unit="h" colour={(hasB?t.eacBgtDiff:t.eacDiff)>0?"#b3302a":"#1e6b3a"} sub={"spent + remaining planned · "+(hasB?mpSigned(t.eacBgtDiff)+" h vs budget"+(rate?" ("+eur(t.eacBgtDiff)+")":""):mpSigned(t.eacDiff)+" h vs planned")}/>
      <InvBig label="Peak workers" value={t.peak} sub={t.peakWeek?"W"+mpIsoWeek(t.peakWeek)+" · "+fmtDate(t.peakWeek):""}/>
    </div>
    {!filtered&&(bRec||isAdmin)&&<div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:14}}>💶 Budget</div>
        {bRec?<span style={{fontSize:12.5,color:"#444"}}>
          {mpBudgetAmount(bRec,"","awarded")>0&&<span>{invFmt(mpBudgetAmount(bRec,"","gross"),0)} € − awarded {invFmt(mpBudgetAmount(bRec,"","awarded"),0)} € = </span>}
          <b>{invFmt(mpBudgetAmount(bRec),0)} €</b> ÷ <b>{invFmt(rate,2)} €/h</b> = <b style={{color:MP_COL_BGT}}>{invFmt(mpBudgetHours(bRec),0)} h</b>
          {" "}spread from {fmtDate(bRec.start)} to {fmtDate(bRec.end)}
          {nAligned>0&&<span style={{color:"#b35c00"}}> · aligned on the real up to W{mpIsoWeek(bRec.alignedTo)} ({nAligned} week{nAligned!==1?"s":""}) → total {invFmt(M0.tot.bgt,0)} h{rate?" = "+invFmt(M0.tot.bgt*rate,0)+" €":""}</span>}
        </span>:<span style={{fontSize:12,color:"#888"}}>No budget yet: give the amount in €, the hourly rate and the duration — the hours are spread evenly over the working days.</span>}
        <span style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          {isAdmin&&<button className="btn btn-sm" onClick={function(){var m=_flowMonday(today());var init=Object.assign({rate:"",start:M0.tot.start||m,end:M0.tot.end?addCalDays(M0.tot.end,5):addCalDays(m,365)},bRec||{});
            init.lines=mpBudgetLines(bRec).map(function(l){return Object.assign({},l);});if(!init.lines.length)init.lines=[{id:uuid(),wbs:"",amount:"",note:""}];
            setEditB(init);}}>{bRec?"✎ Edit budget":"＋ Set the budget"}</button>}
          {isAdmin&&bRec&&M0.tot.cutoff&&<button className="btn btn-sm" onClick={alignOnReal} title="The real hours become the budget of every week up to the cut-off">⇆ Budget = real on the past</button>}
          {isAdmin&&M0.tot.cutoff&&<button className="btn btn-sm" onClick={onAlignPlan} title="The real hours become the planned hours of every week up to the cut-off, WBS by WBS">⇆ Planned = real on the past</button>}
          {isAdmin&&nAligned>0&&<button className="btn btn-sm" onClick={resetAlign} title="Spread the budget evenly again">↺ Reset adjustments</button>}
        </span>
      </div>
      {bRec&&<table className="tbl" style={{fontSize:12,marginTop:8}}>
        <thead><tr><th>Budget WBS</th><th style={{textAlign:"right"}}>Budget €</th><th style={{textAlign:"right"}} title="Awarded to a subcontractor: deducted from the budget">Awarded €</th><th>Awarded to</th>
          <th style={{textAlign:"right"}} title="Budget − awarded: our own manpower">Net €</th><th style={{textAlign:"right"}}>Hours</th><th style={{textAlign:"right"}}>Share</th><th>Note</th></tr></thead>
        <tbody>{mpBudgetLines(bRec).map(function(l){
          var tot=mpBudgetAmount(bRec),net=mpLineNet(l),aw=_invNum(l.awarded);
          return <tr key={l.id}>
            <td style={{fontWeight:600}}>{l.wbs||<span style={{color:"#999",fontStyle:"italic"}}>(no WBS)</span>}</td>
            <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(_invNum(l.amount),0)}</td>
            <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:aw?"#b35c00":"#ccc"}}>{aw?"− "+invFmt(aw,0):"—"}</td>
            <td style={{fontSize:11.5}}>{l.awardedTo||""}{aw>_invNum(l.amount)&&<span style={{color:"#b3302a"}}> · above the budget</span>}</td>
            <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700}}>{invFmt(net,0)}</td>
            <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BGT}}>{rate?invFmt(net/rate,0):"—"}</td>
            <td style={{textAlign:"right",color:"#888"}}>{tot?Math.round(net/tot*100)+" %":"—"}</td>
            <td style={{fontSize:11,color:"#666"}}>{l.note||""}</td>
          </tr>;
        })}
        <tr style={{background:"#f3f8f4",fontWeight:700}}><td>Total</td><td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(mpBudgetAmount(bRec,"","gross"),0)}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#b35c00"}}>{mpBudgetAmount(bRec,"","awarded")?"− "+invFmt(mpBudgetAmount(bRec,"","awarded"),0):"—"}</td><td/>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(mpBudgetAmount(bRec),0)}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BGT}}>{invFmt(mpBudgetHours(bRec),0)}</td><td/><td/></tr></tbody>
      </table>}
      {!isAdmin&&<div style={{fontSize:11,color:"#9b968b",marginTop:4}}>Only the admin may change the budget.</div>}
    </div>}
    <div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:14}}>Budget, planned and real hours</div>
        <span style={{fontSize:11,color:"#888"}}>{mode==="weekly"?"bars = real hours by company · lines = budget and planned per week":"running totals: budget, planned and real"}</span>
        <span style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button className={"fchip"+(mode==="weekly"?" on":"")} onClick={function(){setMode("weekly");}}>Weekly</button>
          <button className={"fchip"+(mode==="cumul"?" on":"")} onClick={function(){setMode("cumul");}}>Cumulative</button>
        </span>
      </div>
      <MpChart M={M} mode={mode}/>
    </div>
    <div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8}}>
        <div style={{fontWeight:700,fontSize:14}}>📝 Notes</div>
        <span style={{fontSize:11,color:"#888"}}>comments on the hours, shared with everyone and printed in the report</span>
      </div>
      {can&&<div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:8}}>
        <textarea value={txt} onChange={function(e){setTxt(e.target.value);}} rows={2} placeholder="e.g. W41: rain 2 days, overtime on the rainwater channel…"
          onKeyDown={function(e){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))addNote();}} style={{flex:1,padding:6,fontSize:13,fontFamily:"inherit"}}/>
        <button className="btn btn-pri btn-sm" disabled={!txt.trim()} onClick={addNote}>Add</button>
      </div>}
      {!notes.length&&<div style={{color:"#9b968b",fontSize:12}}>No note yet.</div>}
      {notes.map(function(n){
        return <div key={n.id} style={{display:"flex",gap:10,padding:"6px 2px",borderTop:"1px solid #f0ede6",fontSize:12.5}}>
          <span style={{color:"#888",whiteSpace:"nowrap",width:150,flexShrink:0}}>{fmtDate(n.date)}<div style={{fontSize:10.5}}>{n.author}</div></span>
          <span style={{flex:1,whiteSpace:"pre-wrap"}}>{n.text}</span>
          {(isAdmin||(can&&n.author===currentUser))&&<button onClick={function(){delNote(n);}} title="Delete" style={{background:"none",border:"none",cursor:"pointer",color:"#ccc"}}>✕</button>}
        </div>;
      })}
    </div>
    {worst.length>0&&<div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Largest weekly variances (real vs planned)</div>
      {worst.map(function(r){
        return <div key={r.week} onClick={function(){onOpenWeek(r.week);}} style={{display:"flex",gap:10,alignItems:"center",padding:"6px 2px",borderBottom:"1px solid #f0ede6",cursor:"pointer",fontSize:12.5}}>
          <b style={{width:44}}>W{mpIsoWeek(r.week)}</b><span style={{color:"#888",width:72}}>{fmtDate(r.week)}</span>
          <span style={{flex:1,color:"#555"}}>planned {mpFmtH(r.budget)} h{hasB?" · budget "+mpFmtH(r.bgt)+" h":""} · real {mpFmtH(r.real)} h{r.entry&&r.entry.note?" · "+r.entry.note:""}</span>
          <b style={{color:mpVarCol(r.pct),fontFamily:"var(--font-mono)"}}>{mpSigned(r.diff)} h{r.pct!==null?" ("+(r.pct>0?"+":"")+r.pct+" %)":""}</b>
        </div>;
      })}
    </div>}
    {editB&&<MpBudgetEditor b={editB} knownActs={knownActs} onSave={saveBudget} onClose={function(){setEditB(null);}}/>}
  </div>;
}

function MpBudgetEditor({b,knownActs,onSave,onClose}){
  const [d,setD]=useState(b);
  function set(k,v){setD(function(o){var n=Object.assign({},o);n[k]=v;return n;});}
  function setLine(i,k,v){setD(function(o){return Object.assign({},o,{lines:(o.lines||[]).map(function(l,j){if(j!==i)return l;var u=Object.assign({},l);u[k]=v;return u;})});});}
  function addLine(){setD(function(o){return Object.assign({},o,{lines:(o.lines||[]).concat([{id:uuid(),wbs:"",amount:"",note:""}])});});}
  function delLine(i){setD(function(o){return Object.assign({},o,{lines:(o.lines||[]).filter(function(_,j){return j!==i;})});});}
  var gross=(d.lines||[]).reduce(function(s,l){return s+_invNum(l.amount);},0);
  var awarded=(d.lines||[]).reduce(function(s,l){return s+_invNum(l.awarded);},0);
  var total=(d.lines||[]).reduce(function(s,l){return s+mpLineNet(l);},0);
  var H=mpHas(d.rate)&&Number(d.rate)>0?total/Number(d.rate):0,ws=isValidDate(d.start)&&isValidDate(d.end)&&d.end>=d.start?mpWeeksBetween(d.start,d.end).length:0;
  var months=ws?Math.max(1,Math.round(ws/4.345)):0;
  var inp={padding:"6px 8px",fontSize:13};
  var footer=<React.Fragment>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-pri" onClick={function(){onSave(d);}}>Save</button>
  </React.Fragment>;
  return <InvModal title="💶 Manpower budget" width={920} onClose={onClose} footer={footer}>
    <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>Budget lines <span style={{fontWeight:400,fontSize:11,color:"#888"}}>— one per budget WBS the money comes from</span></div>
    <datalist id="mp-bgt-wbs">{(knownActs||[]).map(function(n){return <option key={n} value={n}/>;})}</datalist>
    <table className="tbl" style={{fontSize:12,marginBottom:6}}>
      <thead><tr><th>Budget WBS</th><th style={{textAlign:"right",width:115}}>Budget €</th><th style={{textAlign:"right",width:115}} title="Subcontract awarded on this line: deducted from the budget">Awarded €</th>
        <th style={{width:150}}>Awarded to</th><th style={{textAlign:"right",width:95}}>Net €</th><th>Note</th><th style={{width:30}}></th></tr></thead>
      <tbody>{(d.lines||[]).map(function(l,i){
        return <tr key={l.id||i}>
          <td><input type="text" list="mp-bgt-wbs" value={l.wbs||""} onChange={function(e){setLine(i,"wbs",e.target.value);}} placeholder="e.g. 3.2 External works — labour" style={{width:"100%",padding:"4px 6px"}}/></td>
          <td><input type="number" min="0" value={l.amount} onChange={function(e){setLine(i,"amount",e.target.value);}} style={{width:"100%",padding:"4px 6px",textAlign:"right"}}/></td>
          <td><input type="number" min="0" value={l.awarded===undefined?"":l.awarded} onChange={function(e){setLine(i,"awarded",e.target.value);}} placeholder="0" title="Amount of the subcontract awarded on this line" style={{width:"100%",padding:"4px 6px",textAlign:"right",background:_invNum(l.awarded)?"#fff4dc":"#fff"}}/></td>
          <td><input type="text" value={l.awardedTo||""} onChange={function(e){setLine(i,"awardedTo",e.target.value);}} placeholder="subcontractor" style={{width:"100%",padding:"4px 6px"}}/></td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:_invNum(l.awarded)>_invNum(l.amount)?"#b3302a":"#14171c"}}>{invFmt(mpLineNet(l),0)}</td>
          <td><input type="text" value={l.note||""} onChange={function(e){setLine(i,"note",e.target.value);}} placeholder="optional" style={{width:"100%",padding:"4px 6px"}}/></td>
          <td><button onClick={function(){delLine(i);}} title="Remove the line" style={{background:"none",border:"none",cursor:"pointer",color:"#bbb"}}>✕</button></td>
        </tr>;
      })}
      <tr style={{background:"#f3f8f4",fontWeight:700}}><td>Total</td><td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(gross,0)}</td>
        <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#b35c00"}}>{awarded?"− "+invFmt(awarded,0):"—"}</td><td/>
        <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(total,0)} €</td><td/><td/></tr></tbody>
    </table>
    <button className="btn btn-sm" onClick={addLine} style={{marginBottom:4}}>＋ Budget line</button>
    <div style={{fontSize:11,color:"#9b968b",marginBottom:12}}>Awarded = the part of a line given to a subcontractor (signed contract): it is deducted, and the hours budget is built on the net.</div>
    <div className="frow">
      <div className="fg"><label>Hourly rate (€/h)</label><input type="number" min="0" step="0.01" value={d.rate} onChange={function(e){set("rate",e.target.value);}} style={inp}/></div>
    </div>
    <div className="frow">
      <div className="fg"><label>From</label><input type="date" value={d.start||""} onChange={function(e){set("start",e.target.value);}} style={inp}/></div>
      <div className="fg"><label>To</label><input type="date" value={d.end||""} onChange={function(e){set("end",e.target.value);}} style={inp}/></div>
    </div>
    <div style={{background:"#f3f8f4",border:"1px solid #d5e8db",borderRadius:8,padding:"8px 12px",fontSize:12.5}}>
      {H?<span><b style={{color:MP_COL_BGT}}>{invFmt(H,0)} h</b> over {ws} weeks ≈ <b>{invFmt(ws?H/ws:0,0)} h / week</b> ≈ {invFmt(months?H/months:0,0)} h / month, spread evenly over the working days (Mon–Sat).</span>
        :<span style={{color:"#888"}}>Budget ÷ hourly rate = the budget in hours.</span>}
      {Object.keys(d.byWeek||{}).length>0&&<div style={{color:"#b35c00",marginTop:4}}>{Object.keys(d.byWeek).length} week(s) aligned on the real keep their figure.</div>}
    </div>
  </InvModal>;
}

function MpChart({M,mode}){
  var list=M.rows;
  if(!list.length)return <div style={{color:"#9b968b",fontSize:12}}>No week yet.</div>;
  var hasB=M.tot.hasBgt;
  var top=M.companies.filter(function(c){return c.real>0;}).slice(0,MP_TOP),topKeys=top.map(function(c){return c.key;});
  var hasOthers=M.companies.filter(function(c){return c.real>0;}).length>MP_TOP;
  var W=Math.max(640,list.length*22+70),H=280,L=56,R=14,T=12,B=40;
  var iw=W-L-R,ih=H-T-B,bw=Math.max(4,Math.min(20,iw/list.length*0.7));
  function x(i){return L+(i+0.5)*iw/list.length;}
  var max=1;
  list.forEach(function(r){max=Math.max(max,mode==="cumul"?Math.max(r.cumB,r.cumR,r.cumG):Math.max(r.real,r.budget,r.bgt));});
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
        <rect x={x(i)-bw/2} y={T} width={bw} height={ih} fill="transparent"><title>{mpWeekLabel(r.week)+"\nWorkers planned "+r.workers+(hasB?"\nBudget "+mpFmtH(r.bgt)+" h":"")+"\nPlanned "+mpFmtH(r.budget)+" h\nReal "+(r.hasR?mpFmtH(r.real)+" h":"—")+(r.diff!==null?"\nVariance vs planned "+mpSigned(r.diff)+" h":"")}</title></rect></g>;
      })}
      {mode==="weekly"&&hasB&&line(function(r){return r.bgt;},MP_COL_BGT,"6 3")}
      {mode==="weekly"&&line(function(r){return r.budget;},MP_COL_BUDGET)}
      {mode==="cumul"&&hasB&&line(function(r){return r.cumG;},MP_COL_BGT,"6 3")}
      {mode==="cumul"&&line(function(r){return r.cumB;},MP_COL_BUDGET)}
      {mode==="cumul"&&line(function(r){return r.cumR;},MP_COL_REAL,"",function(r){return r.toDate;})}
      {mode==="cumul"&&list.map(function(r,i){return <rect key={"t"+i} x={x(i)-iw/list.length/2} y={T} width={iw/list.length} height={ih} fill="transparent">
        <title>{mpWeekLabel(r.week)+(hasB?"\nBudget cumul. "+mpFmtH(r.cumG)+" h":"")+"\nPlanned cumul. "+mpFmtH(r.cumB)+" h"+(r.toDate?"\nReal cumul. "+mpFmtH(r.cumR)+" h":"")}</title></rect>;})}
      {ci>=0&&<g><line x1={x(ci)} x2={x(ci)} y1={T} y2={T+ih} stroke="#14171c" strokeDasharray="3 3"/><text x={x(ci)+3} y={T+9} fontSize="9" fill="#14171c">cut-off</text></g>}
      {list.map(function(r,i){return i%labelEvery?null:<text key={"l"+i} x={x(i)} y={H-B+14} fontSize="9.5" textAnchor="middle" fill="#6f6b62">W{mpIsoWeek(r.week)}</text>;})}
      <text x={x(0)} y={H-B+27} fontSize="9" textAnchor="start" fill="#9b968b">{fmtDate(list[0].week)}</text>
      {list.length>1&&<text x={x(list.length-1)} y={H-B+27} fontSize="9" textAnchor="end" fill="#9b968b">{fmtDate(list[list.length-1].week)}</text>}
      <line x1={L} x2={W-R} y1={T+ih} y2={T+ih} stroke="#c9c4b8"/>
    </svg>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:"#6f6b62",marginTop:6}}>
      {hasB&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:0,borderTop:"2px dashed "+MP_COL_BGT}}/>Budget</span>}
      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:MP_COL_BUDGET}}/>Planned</span>
      {mode==="cumul"&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:MP_COL_REAL}}/>Real</span>}
      {mode==="weekly"&&top.map(function(c,k){return <span key={c.key} style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:MP_COMPANY_COLS[k%MP_COMPANY_COLS.length]}}/>{c.name}</span>;})}
      {mode==="weekly"&&hasOthers&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:"#b9b4a8"}}/>Others</span>}
    </div>
  </div>;
}

// ---------------------------------------------------------------- printable report
// Standalone HTML in a new tab (openReport, app-reports.js): figures, cumulative curves, months,
// weeks, WBS, companies and the notes.
function mpReportChart(M){
  var list=M.rows;if(!list.length)return "";
  var hasB=M.tot.hasBgt,W=900,H=260,L=60,R=12,T=12,B=34,iw=W-L-R,ih=H-T-B;
  function x(i){return L+(i+0.5)*iw/list.length;}
  var max=1;list.forEach(function(r){max=Math.max(max,r.cumB,r.cumR,r.cumG);});
  var step=Math.pow(10,Math.floor(Math.log10(max)));var nice=[1,2,2.5,5,10].map(function(m){return m*step;}).find(function(v){return max/v<=6;})||step*10;
  var top=Math.ceil(max/nice)*nice;
  function y(v){return T+ih-(v/top)*ih;}
  function pl(get,col,dash,only){
    var pts=[];list.forEach(function(r,i){if(!only||only(r))pts.push(x(i).toFixed(1)+","+y(get(r)).toFixed(1));});
    return pts.length?'<polyline points="'+pts.join(" ")+'" fill="none" stroke="'+col+'" stroke-width="2"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>':"";
  }
  var g="";
  for(var v=0;v<=top+1e-9;v+=nice)g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#e6e2d8"/><text x="'+(L-6)+'" y="'+(y(v)+3)+'" font-size="9" text-anchor="end" fill="#888">'+invFmt(v,0)+'</text>';
  var every=Math.max(1,Math.ceil(list.length/18));
  list.forEach(function(r,i){if(i%every===0)g+='<text x="'+x(i)+'" y="'+(H-B+13)+'" font-size="9" text-anchor="middle" fill="#666">W'+mpIsoWeek(r.week)+'</text>';});
  var ci=M.tot.cutoff?list.findIndex(function(r){return r.week===M.tot.cutoff;}):-1;
  if(ci>=0)g+='<line x1="'+x(ci)+'" x2="'+x(ci)+'" y1="'+T+'" y2="'+(T+ih)+'" stroke="#14171c" stroke-dasharray="3 3"/><text x="'+(x(ci)+3)+'" y="'+(T+9)+'" font-size="9">cut-off</text>';
  g+=(hasB?pl(function(r){return r.cumG;},MP_COL_BGT,"6 3"):"")+pl(function(r){return r.cumB;},MP_COL_BUDGET)+pl(function(r){return r.cumR;},MP_COL_REAL,"",function(r){return r.toDate;});
  g+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(T+ih)+'" y2="'+(T+ih)+'" stroke="#bbb"/>';
  var leg=(hasB?'<span><i style="border-top:2px dashed '+MP_COL_BGT+'"></i>Budget</span>':'')+'<span><i style="border-top:2px solid '+MP_COL_BUDGET+'"></i>Planned</span><span><i style="border-top:2px solid '+MP_COL_REAL+'"></i>Real</span>';
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="max-width:'+W+'px;font-family:IBM Plex Mono,monospace">'+g+'</svg><div class="mp-leg">'+leg+'</div>';
}
function mpOpenReport(M,bRec,notes,filterLabel,bWbs){
  var t=M.tot,hasB=t.hasBgt,rate=mpBudgetRate(bRec);
  function h(v){return v===null||v===undefined||!isFinite(v)?"—":invFmt(v,0);}
  function sg(v){return v===null||v===undefined||!isFinite(v)?"—":mpSigned(v);}
  function eur(v){return rate&&v!==null&&isFinite(v)?invFmt(v*rate,0)+" €":"";}
  function vc(v,base){if(v===null||!isFinite(v))return "";var p=base?v/base*100:null;return ' style="color:'+mpVarCol(p)+';font-weight:600"';}
  var kpi=[];
  if(hasB)kpi.push(["Budget",h(t.bgt)+" h",bRec?invFmt(mpBudgetAmount(bRec,bWbs||""),0)+" € · "+invFmt(rate,2)+" €/h":""],["Budget to date",h(t.bgtToDate)+" h",eur(t.bgtToDate)]);
  kpi.push(["Planned",h(t.budget)+" h",t.planStart?fmtDate(t.planStart)+" → "+fmtDate(addCalDays(t.planEnd,6)):""],["Planned to date",h(t.budgetToDate)+" h",""],
    ["Spent to date",h(t.real)+" h",eur(t.real)]);
  if(hasB)kpi.push(["Variance vs budget",sg(t.bgtDiff)+" h",(t.bgtPct!==null?(t.bgtPct>0?"+":"")+t.bgtPct+" % · ":"")+eur(t.bgtDiff)]);
  kpi.push(["Variance vs planned",sg(t.diff)+" h",t.pct!==null?(t.pct>0?"+":"")+t.pct+" %":""],
    ["Forecast at completion",h(t.eac)+" h",hasB?sg(t.eacBgtDiff)+" h vs budget":sg(t.eacDiff)+" h vs planned"]);
  var html='<style>.mp h1{font-size:20px;margin:0 0 2px}.mp h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #14171c;padding-bottom:3px}'+
    '.mp .sub{color:#666;font-size:11.5px;margin-bottom:10px}.mp table{border-collapse:collapse;width:100%;font-size:10.5px}'+
    '.mp th,.mp td{border-bottom:1px solid #e6e2d8;padding:3px 5px;text-align:right}.mp th:first-child,.mp td:first-child{text-align:left}'+
    '.mp th{background:#f5f3ee;font-weight:700}.mp .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}'+
    '.mp .k{border:1px solid #e6e2d8;border-radius:6px;padding:6px 8px}.mp .k b{display:block;font-size:15px}.mp .k span{font-size:9.5px;color:#777;text-transform:uppercase;letter-spacing:.04em}'+
    '.mp .k i{font-size:10px;color:#666;font-style:normal}.mp .mp-leg{display:flex;gap:14px;font-size:10.5px;color:#555}.mp .mp-leg i{display:inline-block;width:18px;margin-right:4px;vertical-align:middle}'+
    '.mp .tot td{font-weight:800;background:#fffaf0}.mp .note{border-bottom:1px solid #eee;padding:4px 0;font-size:11px}.mp .note em{color:#777;font-style:normal;margin-right:8px}'+
    '@media print{.mp h2{break-after:avoid}.mp tr{break-inside:avoid}}</style><div class="mp">';
  html+='<h1>Riviera Tower — Manpower hours report</h1><div class="sub">Printed '+fmtDate(today())+(t.cutoff?' · cut-off W'+mpIsoWeek(t.cutoff)+' ('+fmtDate(t.cutoff)+')':' · no real hours yet')+
    (filterLabel?' · filtered on '+esc(filterLabel)+(hasB?' (budget lines of this WBS)':' (no budget line for it)'):'')+'</div>';
  html+='<div class="kpis">'+kpi.map(function(k){return '<div class="k"><span>'+esc(k[0])+'</span><b>'+k[1]+'</b><i>'+esc(k[2])+'</i></div>';}).join("")+'</div>';
  var bl=mpBudgetLines(bRec);
  if(bl.length&&!filterLabel){
    html+='<h2>Budget lines</h2><table><thead><tr><th>Budget WBS</th><th>Budget €</th><th>Awarded €</th><th style="text-align:left">Awarded to</th><th>Net €</th><th>Hours</th><th style="text-align:left">Note</th></tr></thead><tbody>'+
      bl.map(function(l){var net=mpLineNet(l),aw=_invNum(l.awarded);return '<tr><td>'+esc(l.wbs||"(no WBS)")+'</td><td>'+invFmt(_invNum(l.amount),0)+'</td><td>'+(aw?"− "+invFmt(aw,0):"—")+'</td><td style="text-align:left">'+esc(l.awardedTo||"")+'</td><td>'+invFmt(net,0)+'</td><td>'+(rate?invFmt(net/rate,0):"—")+'</td><td style="text-align:left">'+esc(l.note||"")+'</td></tr>';}).join("")+
      '<tr class="tot"><td>Total</td><td>'+invFmt(mpBudgetAmount(bRec,"","gross"),0)+'</td><td>'+(mpBudgetAmount(bRec,"","awarded")?"− "+invFmt(mpBudgetAmount(bRec,"","awarded"),0):"—")+'</td><td></td><td>'+invFmt(mpBudgetAmount(bRec),0)+'</td><td>'+(rate?invFmt(mpBudgetAmount(bRec)/rate,0):"—")+'</td><td></td></tr></tbody></table>';
  }
  html+='<h2>Cumulative hours</h2>'+mpReportChart(M);
  // months
  html+='<h2>Months</h2><table><thead><tr><th>Month</th>'+(hasB?'<th>Budget</th>':'')+'<th>Planned</th><th>Planned to date</th><th>Real</th><th>Variance vs planned</th>'+(hasB?'<th>Cumul. budget</th>':'')+'<th>Cumul. planned</th><th>Cumul. real</th></tr></thead><tbody>';
  M.months.forEach(function(m){html+='<tr><td>'+mpMonthLabel(m.month)+'</td>'+(hasB?'<td>'+h(m.bgt)+'</td>':'')+'<td>'+h(m.budget)+'</td><td>'+(m.budgetToDate?h(m.budgetToDate):"—")+'</td><td>'+(m.hasR?h(m.real):"—")+'</td><td'+vc(m.diff,m.budgetToDate)+'>'+sg(m.diff)+'</td>'+(hasB?'<td>'+h(m.cumG)+'</td>':'')+'<td>'+h(m.cumB)+'</td><td>'+(m.hasR?h(m.cumR):"—")+'</td></tr>';});
  html+='<tr class="tot"><td>Whole duration</td>'+(hasB?'<td>'+h(t.bgt)+'</td>':'')+'<td>'+h(t.budget)+'</td><td>'+h(t.budgetToDate)+'</td><td>'+h(t.real)+'</td><td>'+sg(t.diff)+'</td><td colspan="'+(hasB?3:2)+'">forecast '+h(t.eac)+' h</td></tr></tbody></table>';
  // weeks up to the cut-off
  var past=M.rows.filter(function(r){return t.cutoff&&r.week<=t.cutoff;});
  if(past.length){
    html+='<h2>Weeks to the cut-off</h2><table><thead><tr><th>Week</th>'+(hasB?'<th>Budget</th>':'')+'<th>Planned</th><th>Real</th><th>Variance vs planned</th>'+(hasB?'<th>Cumul. budget</th>':'')+'<th>Cumul. planned</th><th>Cumul. real</th><th style="text-align:left">Note</th></tr></thead><tbody>';
    past.forEach(function(r){html+='<tr><td>W'+mpIsoWeek(r.week)+' · '+fmtDate(r.week)+'</td>'+(hasB?'<td>'+h(r.bgt)+'</td>':'')+'<td>'+h(r.budget)+'</td><td>'+(r.hasR?h(r.real):"—")+'</td><td'+vc(r.diff,r.budget)+'>'+sg(r.diff)+'</td>'+(hasB?'<td>'+h(r.cumG)+'</td>':'')+'<td>'+h(r.cumB)+'</td><td>'+h(r.cumR)+'</td><td style="text-align:left;color:#666">'+esc((r.entry&&r.entry.note)||"")+'</td></tr>';});
    html+='</tbody></table>';
  }
  // WBS / activities
  if(M.activities.length){
    html+='<h2>By WBS</h2><table><thead><tr><th>WBS</th><th>Planned</th><th>Planned to date</th><th>Real</th><th>Variance vs planned to date</th><th>Share of real</th></tr></thead><tbody>';
    M.activities.forEach(function(a){var d=a.real-a.budgetToDate;html+='<tr><td>'+esc(a.name)+'</td><td>'+h(a.budget)+'</td><td>'+h(a.budgetToDate)+'</td><td>'+h(a.real)+'</td><td'+vc(d,a.budgetToDate)+'>'+sg(d)+'</td><td>'+(t.real&&a.real?Math.round(a.real/t.real*100)+" %":"—")+'</td></tr>';});
    html+='</tbody></table>';
  }
  var cos=M.companies.filter(function(c){return c.real>0;});
  if(cos.length){
    html+='<h2>By company</h2><table><thead><tr><th>Company</th><th>Real</th><th>Share of real</th><th>Weeks present</th></tr></thead><tbody>';
    cos.forEach(function(c){html+='<tr><td>'+esc(c.name)+'</td><td>'+h(c.real)+'</td><td>'+(t.real?Math.round(c.real/t.real*100)+" %":"—")+'</td><td>'+Object.keys(c.weeks).length+'</td></tr>';});
    html+='</tbody></table>';
  }
  if((notes||[]).length){
    html+='<h2>Notes</h2>'+notes.map(function(n){return '<div class="note"><em>'+fmtDate(n.date)+' · '+esc(n.author||"")+'</em>'+esc(n.text).replace(/\n/g,"<br/>")+'</div>';}).join("");
  }
  html+='</div>';
  openReport("Manpower report "+today(),html);
}

// ---------------------------------------------------------------- plan
// One line per trade / team: workers × weeks × hours per worker. The grid underneath is the
// histogram: a cell changes the head count of one week only (empty = the line's default).
function MpPlan({plan,savePlan,M,can,known,isAdmin,onAlign,onUndoAlign,planAlign}){
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
        <span style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          {isAdmin&&M.tot.cutoff&&<button className="btn btn-sm" onClick={onAlign} title="For every week up to the cut-off, the head count of each line is set so that planned = real hours of its WBS">⇆ Planned = real on the past</button>}
          {isAdmin&&onUndoAlign&&<button className="btn btn-sm" onClick={onUndoAlign} title="Put the plan back as it was before the alignment">↺ Undo alignment</button>}
          {can&&<button className="btn btn-pri btn-sm" onClick={function(){
            var last=lines[lines.length-1];
            setEdit(newMpPlanLine(last?{hpw:last.hpw}:{}));}}>＋ Plan line</button>}
        </span>
      </div>
      {planAlign&&<div style={{fontSize:11.5,color:"#b35c00",marginBottom:8}}>Planned aligned on the real up to W{mpIsoWeek(planAlign.cutoff)} ({fmtDate(planAlign.cutoff)}) on {fmtDate(planAlign.at)}{planAlign.by?" by "+planAlign.by:""}: the head counts of those weeks are real hours ÷ hours per worker.</div>}
      {!lines.length&&<div style={{color:"#9b968b",fontSize:12}}>No plan yet. Add one line per trade or team, e.g. “Formwork carpenters — 12 workers — W43 to W8 — 48 h”.</div>}
      {lines.length>0&&<table className="tbl tbl-cards" style={{fontSize:12}}>
        <thead><tr><th>Trade / team</th><th>Company</th><th style={{textAlign:"right"}}>Workers</th><th>From</th><th>To</th>
          <th style={{textAlign:"right"}}>h / worker / week</th><th style={{textAlign:"right"}}>Weeks</th><th style={{textAlign:"right"}}>Planned h</th></tr></thead>
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
            <td data-l="Planned h" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_BUDGET}}>{invFmt(mpLineTotal(l),0)}</td>
          </tr>;
        })}
        <tr style={{background:"#fffaf0"}}><td className="card-main" style={{fontWeight:700}}>Total</td><td/><td/><td data-l="From">{M.tot.planStart?fmtDate(M.tot.planStart):""}</td><td data-l="To">{M.tot.planEnd?fmtDate(addCalDays(M.tot.planEnd,6)):""}</td><td/><td/>
          <td data-l="Planned h" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_BUDGET}}>{invFmt(lines.reduce(function(s,l){return s+mpLineTotal(l);},0),0)}</td></tr>
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
            {[["Planned h","budget",MP_COL_BUDGET,true],["Planned cumul.","cumB",MP_COL_BUDGET,true]]
              .concat(M.tot.hasBgt?[["Budget h","bgt",MP_COL_BGT,false],["Budget cumul.","cumG",MP_COL_BGT,false]]:[])
              .concat([["Real h","real",MP_COL_REAL,false],["Real cumul.","cumR",MP_COL_REAL,false]])
              .map(function(rw){
                var isReal=rw[1]==="real"||rw[1]==="cumR";
                return <tr key={rw[1]} style={{background:"#fffaf0"}}>
                  <td style={{position:"sticky",left:0,background:"#fffaf0",padding:"4px 8px",fontWeight:700,color:rw[2],whiteSpace:"nowrap"}}>{rw[0]}</td>
                  {weeks.map(function(w){var r=weekTot[w]||{};var v=r[rw[1]];
                    return <td key={w} style={{textAlign:"center",fontFamily:"var(--font-mono)",color:rw[2],fontSize:10,fontWeight:/cum/.test(rw[1])?700:400}}>{isReal&&!r.toDate?"":invFmt(v||0,0)}</td>;})}
                </tr>;
              })}
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
        <th>Week</th><th style={{textAlign:"right"}}>Workers</th>{M.tot.hasBgt&&<th style={{textAlign:"right"}}>Budget</th>}<th style={{textAlign:"right"}}>Planned</th><th style={{textAlign:"right"}}>Real</th>
        <th style={{textAlign:"right"}} title="Real − planned">Variance</th>
        <th style={{textAlign:"right"}} title={"Running totals: "+(M.tot.hasBgt?"budget / ":"")+"planned / real"}>Cumul. {M.tot.hasBgt?"B / ":""}P / R</th>
        <th style={{textAlign:"right"}} title="Running variance to date">Cumul. var.</th>
        <th>Companies</th><th>Note</th>
      </tr></thead>
      <tbody>{list.map(function(r){
        if(r.sep)return <tr key="sep"><td colSpan={M.tot.hasBgt?10:9} style={{background:"#f5f3ee",fontSize:11,fontWeight:700,color:"#6f6b62",textTransform:"uppercase",letterSpacing:".06em"}}>
          Plan ahead · {ahead.length} week{ahead.length!==1?"s":""} · planned {invFmt(ahead.reduce(function(a,x){return a+x.budget;},0),0)} h{M.tot.hasBgt?" · budget "+invFmt(ahead.reduce(function(a,x){return a+x.bgt;},0),0)+" h":""}</td></tr>;
        var real=((r.entry&&r.entry.real)||[]).slice().sort(function(a,b){return _invNum(b.hours)-_invNum(a.hours);});
        var future=M.tot.cutoff?r.week>M.tot.cutoff:true;
        var cd=r.toDate?r.cumR-r.cumBd:null;
        return <tr key={r.week} onClick={function(){onOpen(r.week);}} style={{cursor:"pointer",opacity:future&&!r.hasR?.7:1}} title={can?"Open to enter the real hours":"Open"}>
          <td className="card-main" style={{whiteSpace:"nowrap"}}><b>W{mpIsoWeek(r.week)}</b> <span style={{color:"#888"}}>{fmtDate(r.week)}</span>{r.src==="manual"&&<span title="No plan line covers this week: the planned figure is the manual one" style={{fontSize:10,color:"#b35c00",marginLeft:4}}>manual</span>}</td>
          <td data-l="Workers" style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{r.workers?invFmt(r.workers,1):"—"}</td>
          {M.tot.hasBgt&&<td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BGT}}>{r.bgt?invFmt(r.bgt,0):"—"}</td>}
          <td data-l="Planned" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{r.budget?invFmt(r.budget,0):"—"}</td>
          <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{r.hasR?invFmt(r.real,0):"—"}</td>
          {vcell(r.diff,r.pct)}
          <td data-l="Cumulative" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888",whiteSpace:"nowrap"}}>{M.tot.hasBgt?<span style={{color:MP_COL_BGT}}>{invFmt(r.cumG,0)} / </span>:null}<span style={{color:MP_COL_BUDGET}}>{invFmt(r.cumB,0)}</span> / <span style={{color:MP_COL_REAL}}>{r.toDate?invFmt(r.cumR,0):"—"}</span></td>
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
  var max=Math.max.apply(null,M.months.map(function(m){return Math.max(m.budget,m.real,m.bgt);}).concat([1]));
  var hasB=t.hasBgt;
  return <div>
    <div className="card" style={{padding:0,overflowX:"auto",marginBottom:12}}>
      <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
        <thead><tr><th>Month</th>{hasB&&<th style={{textAlign:"right"}}>Budget</th>}<th style={{textAlign:"right"}}>Planned</th><th style={{textAlign:"right"}} title="Planned hours of the weeks up to the cut-off">Planned to date</th>
          <th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}} title="Real − planned to date">Variance</th>
          {hasB&&<th style={{textAlign:"right"}}>Cumul. budget</th>}<th style={{textAlign:"right"}}>Cumul. planned</th><th style={{textAlign:"right"}}>Cumul. real</th><th style={{minWidth:140}}></th></tr></thead>
        <tbody>
          {M.months.map(function(m){
            return <tr key={m.month}>
              <td className="card-main" style={{fontWeight:700,whiteSpace:"nowrap"}}>{mpMonthLabel(m.month)}</td>
              {hasB&&<td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BGT}}>{invFmt(m.bgt,0)}</td>}
              <td data-l="Planned" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{invFmt(m.budget,0)}</td>
              <td data-l="Planned to date" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{m.budgetToDate?invFmt(m.budgetToDate,0):"—"}</td>
              <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{m.hasR?invFmt(m.real,0):"—"}</td>
              <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:mpVarCol(m.pct)}}>{m.diff===null?"—":mpSigned(m.diff)}{m.pct!==null?<span style={{fontSize:10,marginLeft:4}}>{(m.pct>0?"+":"")+m.pct}%</span>:null}</td>
              {hasB&&<td data-l="Cumul. budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BGT}}>{invFmt(m.cumG,0)}</td>}
              <td data-l="Cumul. planned" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:MP_COL_BUDGET}}>{invFmt(m.cumB,0)}</td>
              <td data-l="Cumul. real" style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888"}}>{m.hasR?invFmt(m.cumR,0):"—"}</td>
              <td className="phone-hide"><div style={{position:"relative",height:14}}>
                {hasB&&<div style={{position:"absolute",left:0,top:0,height:4,width:(m.bgt/max*100)+"%",background:MP_COL_BGT,borderRadius:2,opacity:.75}}/>}
                <div style={{position:"absolute",left:0,top:hasB?5:0,height:hasB?4:6,width:(m.budget/max*100)+"%",background:MP_COL_BUDGET,borderRadius:2,opacity:.75}}/>
                {m.hasR&&<div style={{position:"absolute",left:0,top:hasB?10:7,height:hasB?4:6,width:(m.real/max*100)+"%",background:MP_COL_REAL,borderRadius:2}}/>}
              </div></td>
            </tr>;
          })}
          <tr style={{background:"#fffaf0"}}>
            <td className="card-main" style={{fontWeight:800}}>Whole duration</td>
            {hasB&&<td data-l="Budget" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_BGT}}>{invFmt(t.bgt,0)}</td>}
            <td data-l="Planned" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_BUDGET}}>{invFmt(t.budget,0)}</td>
            <td data-l="Planned to date" style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{t.cutoff?invFmt(t.budgetToDate,0):"—"}</td>
            <td data-l="Real" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:MP_COL_REAL}}>{invFmt(t.real,0)}</td>
            <td data-l="Variance" style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:mpVarCol(t.pct)}}>{t.diff===null?"—":mpSigned(t.diff)}{t.pct!==null?<span style={{fontSize:10,marginLeft:4}}>{(t.pct>0?"+":"")+t.pct}%</span>:null}</td>
            <td data-l="Forecast" colSpan={hasB?4:3} style={{fontSize:11.5,color:"#555"}}>Remaining planned {invFmt(t.remaining,0)} h · forecast at completion <b style={{color:(hasB?t.eacBgtDiff:t.eacDiff)>0?"#b3302a":"#1e6b3a"}}>{invFmt(t.eac,0)} h ({hasB?mpSigned(t.eacBgtDiff)+" vs budget":mpSigned(t.eacDiff)+" vs planned"})</b></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style={{fontSize:11,color:"#9b968b"}}>A week across two months is split by working day (Mon–Sat). Variance = real − planned hours of the weeks up to the cut-off (W{t.cutoff?mpIsoWeek(t.cutoff):"—"}).</div>
  </div>;
}

// ---------------------------------------------------------------- companies
function MpCompanies({M}){
  var tot=M.tot.real||0;
  var list=M.companies;
  if(!list.length)return <div className="empty"><div className="empty-txt">No company yet: give a company to the plan lines and to the real hours.</div></div>;
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
      <thead><tr><th>Company</th><th style={{textAlign:"right"}}>Planned</th><th style={{textAlign:"right"}}>Planned to date</th>
        <th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}} title="Real − planned to date">Variance</th><th style={{textAlign:"right"}}>Share of real</th>
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
    <div style={{fontSize:11,color:"#9b968b",padding:"8px 12px"}}>Planned hours per company come from the plan lines that name a company. Lines without one are only in the totals.</div>
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
    <div style={{fontSize:11,color:"#9b968b",padding:"8px 12px"}}>The activity names of the imported files, as they are in the file, with the webapp WBS they were matched to at the import. The planned hours live on the WBS.</div>
  </div>;
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    {switcher}
    <table className="tbl tbl-cards" style={{fontSize:12,margin:0}}>
      <thead><tr><th>{hasSrc?"WBS (webapp)":"Activity"}</th><th style={{textAlign:"right"}}>Planned</th><th style={{textAlign:"right"}}>Planned to date</th>
        <th style={{textAlign:"right"}}>Real</th><th style={{textAlign:"right"}} title="Real − planned to date">Variance</th><th style={{textAlign:"right"}}>Share of real</th>
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
    <div style={{fontSize:11,color:"#9b968b",padding:"8px 12px"}}>Planned hours per activity come from the plan lines of the same name.{hasSrc?" Open a WBS to see the file activities matched to it.":""}{untagged&&untagged.real?" "+invFmt(untagged.real,0)+" h of real hours have no activity yet: open the weeks to tag them.":""}</div>
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
  return {layout:layout,hi:hi,head:head,body:body,cW:cW,cD:cD,cC:cC,cA:cA,cH:cH,valueCols:valueCols,weekCols:weekCols,
    labelCols:weekCols.length?weekCols[0].j:0};
}
// Analysis + options → items with their Monday. Week numbers get a year: the chosen one, +1 each
// time the numbers wrap back (52 → 1).
// The first non-empty rows of a sheet, shown when nothing could be read from it.
function mpImpPeek(rows){
  var out=(rows||[]).filter(function(r){return (r||[]).some(function(c){return String(c===undefined||c===null?"":c).trim();});}).slice(0,3)
    .map(function(r){return r.slice(0,5).map(function(c){return String(c);}).join(" | ");});
  return out.length?"\nFirst rows read: "+out.join("  /  "):"\nThe sheet is empty.";
}
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
// Lines of a week keyed by company + WBS + file activity, to compare a week with the file's version.
function mpImpLineMap(lines){
  var m={};
  (lines||[]).forEach(function(r){
    var k=mpCompanyKey(r.company)+"|"+mpActKey(r.activity)+"|"+mpActKey(r.src);
    var o=m[k]||(m[k]={hours:0,label:[r.src||r.activity||"(no activity)",r.company].filter(Boolean).join(" · ")});
    o.hours+=_invNum(r.hours);
  });
  Object.keys(m).forEach(function(k){m[k].hours=Math.round(m[k].hours*100)/100;});
  return m;
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
  const [picks,setPicks]=useState({});        // changed week (Monday) → "old" | "new"
  const [map,setMap]=useState({});            // file activity → "new" | "none" | "skip" | existing name
  const [book,setBook]=useState(null);        // {name, sheets:{name: rows}} of an Excel file, to switch sheet
  const [sheet,setSheet]=useState("");
  function load(rows,name){
    var a=mpImpAnalyse(rows);
    if(a.error){setErr(a.error+mpImpPeek(rows));setAn(null);return;}
    setErr("");setAn(a);setFileName(name||"");
    // the year of the first week: the current year, unless the file names one
    var y=null;
    if(a.layout==="matrix")a.weekCols.some(function(wc){if(wc.cell.year){y=wc.cell.year;return true;}return false;});
    else a.body.some(function(r){var c=a.cW>=0?mpImpWeekCell(r[a.cW]):null;if(c&&c.year){y=c.year;return true;}return false;});
    if(y)setYear(y);
  }
  function onFile(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    e.target.value="";                         // the same file can be picked again after a change
    setBook(null);setSheet("");setMap({});setPicks({});
    var rd=new FileReader();
    if(/\.(csv|txt)$/i.test(f.name)){
      rd.onload=function(){load(mpImpParseText(rd.result),f.name);};rd.readAsText(f);
    }else{
      if(!window.XLSX||!window.XLSX.read){setErr("The Excel library is not loaded: save the sheet as CSV and import the CSV.");return;}
      rd.onload=function(){
        try{
          var wb=window.XLSX.read(new Uint8Array(rd.result),{type:"array",cellDates:true});
          // every sheet is read; the first one holding hours is shown (not always the first sheet)
          var sheets={},pick="";
          wb.SheetNames.forEach(function(n){
            var rows=window.XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:"",raw:true});sheets[n]=rows;
            if(!pick){var a=mpImpAnalyse(rows);if(!a.error&&mpImpItems(a,{year:Number(today().slice(0,4)),colsAre:"company",fixed:""}).items.length)pick=n;}
          });
          pick=pick||wb.SheetNames[0];
          setBook({name:f.name,sheets:sheets,order:wb.SheetNames});setSheet(pick);
          load(sheets[pick],f.name+" · "+pick);
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
  var total=res.items.reduce(function(s,it){return s+it.hours;},0);
  var skipH=res.items.filter(function(it){return it.activity&&choice(mpActKey(it.activity))==="skip";}).reduce(function(s,it){return s+it.hours;},0);
  // The file's lines per week, activities mapped as chosen above.
  var incoming={};
  res.items.forEach(function(it){
    var act="",src="";
    if(it.activity){var c=choice(mpActKey(it.activity));if(c==="skip")return;act=c==="none"?"":c==="new"?fileActs[mpActKey(it.activity)].name:c;src=fileActs[mpActKey(it.activity)].name;}
    var l=incoming[it.week]||(incoming[it.week]=[]);
    var hit=l.find(function(x){return mpCompanyKey(x.company)===mpCompanyKey(it.company)&&mpActKey(x.activity)===mpActKey(act)&&mpActKey(x.src)===mpActKey(src);});
    if(hit)hit.hours+=it.hours;else l.push({company:it.company,activity:act,src:src,hours:it.hours});
  });
  Object.keys(incoming).forEach(function(w){incoming[w]=incoming[w].map(function(x){var o={company:x.company,activity:x.activity,hours:Math.round(x.hours*100)/100};if(x.src)o.src=x.src;return o;});});
  // Each week of the file against what the webapp holds: new, unchanged, or changed (→ old or new?).
  var cmp=Object.keys(incoming).sort().map(function(w){
    var cur=weeks.find(function(x){return _flowMonday(x.week)===w;});
    if(!cur||!(cur.real||[]).length)return {week:w,state:"new",lines:incoming[w],cur:cur||null};
    var a=mpImpLineMap(cur.real),b=mpImpLineMap(incoming[w]),diffs=[];
    Object.keys(a).concat(Object.keys(b).filter(function(k){return !(k in a);})).forEach(function(k){
      var o=a[k]?a[k].hours:0,n=b[k]?b[k].hours:0;
      if(Math.abs(o-n)>0.005)diffs.push({label:(a[k]||b[k]).label,old:o,neu:n});
    });
    return {week:w,state:diffs.length?"changed":"same",lines:incoming[w],cur:cur,diffs:diffs,
      oldH:mpReal(cur),newH:incoming[w].reduce(function(s,x){return s+x.hours;},0)};
  });
  var cNew=cmp.filter(function(c){return c.state==="new";}),cSame=cmp.filter(function(c){return c.state==="same";}),cChg=cmp.filter(function(c){return c.state==="changed";});
  var undecided=cChg.filter(function(c){return !picks[c.week];}).length;
  function pickAll(v){var n={};cChg.forEach(function(c){n[c.week]=v;});setPicks(n);}
  var nToWrite=cNew.length+cChg.filter(function(c){return picks[c.week]==="new";}).length;

  function apply(){
    if(blockIfReadOnly())return;
    if(!res.items.length)return;
    if(undecided){safeAlert("Choose the old or the new figures for the "+undecided+" changed week(s) first.");return;}
    // 1. new activities become plan lines (0 workers over the weeks they appear in), so they get a budget later
    var newPlan=plan.slice(),created=[];
    actKeys.forEach(function(k){
      if(choice(k)!=="new")return;
      var ws=res.items.filter(function(it){return mpActKey(it.activity)===k;}).map(function(it){return it.week;}).sort();
      var line=newMpPlanLine({label:fileActs[k].name,workers:0,start:ws[0],end:ws[ws.length-1],note:"Created by the import of "+(fileName||"a file")+" — set the workers to give it a budget"});
      newPlan.push(line);created.push(line.label);
    });
    // 2. the hours: new weeks added, changed weeks as picked, unchanged weeks left alone
    var next=weeks.slice(),added=0,updated=0,kept=0;
    cmp.forEach(function(c){
      if(c.state==="same")return;
      if(c.state==="changed"&&picks[c.week]!=="new"){kept++;return;}
      var stamp={updatedBy:currentUser||"",updatedAt:today()};
      if(!c.cur){next.push(newManpowerWeek(Object.assign({week:c.week,real:c.lines,note:"Imported"+(fileName?" from "+fileName:"")},stamp)));added++;return;}
      var i=next.findIndex(function(x){return x.id===c.cur.id;});
      next[i]=Object.assign({},c.cur,{real:c.lines},stamp);
      if(c.state==="new")added++;else updated++;
    });
    // remember the choices for the next file
    var mem=mpImpMapLoad();actKeys.forEach(function(k){var c=choice(k);mem[k]=c==="new"?fileActs[k].name:c;});mpImpMapSave(mem);
    if(created.length)savePlan(newPlan);
    if(added||updated)saveWeeks(next);
    safeAlert((added?added+" new week(s) added":"No new week")+(updated?", "+updated+" week(s) updated with the file":"")+
      (kept?", "+kept+" changed week(s) kept as before":"")+(cSame.length?", "+cSame.length+" week(s) unchanged":"")+"."+(created.length?"\n\nNew WBS added to the plan (0 workers — give them workers to get a budget):\n• "+created.join("\n• "):""));
    onClose();
  }

  var inp={padding:"5px 8px",fontSize:13};
  var footer=<React.Fragment>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-pri" disabled={!res.items.length||undecided>0||(!nToWrite&&!actKeys.some(function(k){return choice(k)==="new";}))} onClick={apply}
      title={undecided?"Choose old or new for every changed week":""}>{undecided?"Choose old / new for "+undecided+" week(s)":nToWrite?"Import "+nToWrite+" week"+(nToWrite!==1?"s":""):"Nothing new to import"}</button>
  </React.Fragment>;
  return <InvModal title={"⬆ Import real hours · build "+(window._appBuild||"")} width={820} onClose={onClose} footer={footer}>
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
    {err&&<div style={{color:"#b3302a",fontSize:12.5,margin:"6px 0",whiteSpace:"pre-wrap"}}>{err}</div>}
    {an&&<div>
      <div style={{background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 12px",marginBottom:10,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",fontSize:12.5}}>
        {book&&book.order.length>1&&<span style={{display:"flex",alignItems:"center",gap:5}}>Sheet
          <select value={sheet} onChange={function(e){var n=e.target.value;setSheet(n);setMap({});load(book.sheets[n],book.name+" · "+n);}} style={inp}>
            {book.order.map(function(n){return <option key={n} value={n}>{n}</option>;})}</select></span>}
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
      {!res.items.length&&<div style={{color:"#b3302a",fontSize:12.5}}>No hours found under the headings{res.skipped?" ("+res.skipped+" row(s) without a readable week)":""}.
        <div style={{color:"#6f6b62",fontSize:11.5,marginTop:4,whiteSpace:"pre-wrap"}}>Read: heading row {an.hi+1} = {an.head.filter(function(h){return h;}).slice(0,6).join(" | ")||"(empty)"}{an.layout==="matrix"?" · "+an.weekCols.length+" week columns, label columns "+an.labelCols:""} · {an.body.length} row(s) under it{an.body[0]?" — first: "+an.body[0].slice(0,4).map(function(c){return String(c);}).join(" | "):""}</div></div>}
      {res.items.length>0&&<div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12.5,marginBottom:10}}>
        <span><b>{invFmt(total,0)} h</b> in {res.items.length} line{res.items.length!==1?"s":""}</span>
        <span>{wkList.length} week{wkList.length!==1?"s":""}: W{mpIsoWeek(wkList[0])} {fmtDate(wkList[0])} → W{mpIsoWeek(wkList[wkList.length-1])} {fmtDate(wkList[wkList.length-1])}</span>
        {res.skipped>0&&<span style={{color:"#b35c00"}}>{res.skipped} row(s) skipped (no readable week or hours)</span>}
      </div>}
      {cmp.length>0&&<div style={{background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12.5}}>
        <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{color:"#1e6b3a"}}><b>{cNew.length}</b> new week{cNew.length!==1?"s":""}{cNew.length?" ("+cNew.slice(0,3).map(function(c){return "W"+mpIsoWeek(c.week);}).join(", ")+(cNew.length>3?"…":"")+")":""} → added</span>
          <span style={{color:"#888"}}><b>{cSame.length}</b> unchanged → left as they are</span>
          <span style={{color:cChg.length?"#b35c00":"#888"}}><b>{cChg.length}</b> changed since the last import</span>
          {cChg.length>0&&<span style={{marginLeft:"auto",display:"flex",gap:6}}>
            <button className="btn btn-sm" onClick={function(){pickAll("old");}}>Keep all old</button>
            <button className="btn btn-sm" onClick={function(){pickAll("new");}}>Take all new</button></span>}
        </div>
        {cChg.length>0&&<table className="tbl" style={{fontSize:12,marginTop:8,background:"#fff"}}>
          <thead><tr><th>Week</th><th style={{textAlign:"right"}}>In the webapp</th><th style={{textAlign:"right"}}>In the file</th><th>What changed</th><th style={{whiteSpace:"nowrap"}}>Keep</th></tr></thead>
          <tbody>{cChg.map(function(c){
            var p=picks[c.week];
            function set(v){setPicks(function(o){var n=Object.assign({},o);n[c.week]=v;return n;});}
            return <tr key={c.week} style={{background:p?"#fff":"#fff8e1"}}>
              <td style={{whiteSpace:"nowrap"}}><b>W{mpIsoWeek(c.week)}</b> <span style={{color:"#888"}}>{fmtDate(c.week)}</span></td>
              <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(c.oldH,1)} h</td>
              <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:c.newH>c.oldH?"#b3302a":c.newH<c.oldH?"#1e6b3a":"#14171c"}}>{invFmt(c.newH,1)} h</td>
              <td style={{fontSize:11,color:"#555"}}>{c.diffs.slice(0,3).map(function(d){return d.label+": "+invFmt(d.old,1)+" → "+invFmt(d.neu,1);}).join(" · ")}{c.diffs.length>3?" · +"+(c.diffs.length-3)+" more":""}</td>
              <td style={{whiteSpace:"nowrap"}}>
                <label style={{display:"inline-flex",alignItems:"center",gap:3,margin:"0 8px 0 0",textTransform:"none",letterSpacing:"normal",fontSize:12,fontFamily:"inherit"}}><input type="radio" checked={p==="old"} onChange={function(){set("old");}}/>old</label>
                <label style={{display:"inline-flex",alignItems:"center",gap:3,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12,fontFamily:"inherit"}}><input type="radio" checked={p==="new"} onChange={function(){set("new");}}/>new</label>
              </td>
            </tr>;
          })}</tbody>
        </table>}
        {cChg.length>0&&<div style={{fontSize:11,color:"#9b968b",marginTop:4}}>“new” replaces the whole week with the file's lines; “old” keeps the webapp's week as it is.</div>}
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
        ?<div className="fg"><label>Planned (from the plan)</label>
          <div style={{fontSize:15,fontWeight:800,color:MP_COL_BUDGET,fontFamily:"var(--font-mono)",padding:"6px 0"}}>{invFmt(row.budget,0)} h</div>
          <span style={{fontSize:11,color:"#888"}}>{invFmt(row.workers,1)} workers planned</span></div>
        :<div className="fg"><label>Planned (manual — no plan line covers this week)</label>
          <input type="number" min="0" value={d.approved} disabled={!can} onChange={function(e){set("approved",e.target.value);}} style={inp}/></div>}
    </div>
    <div style={{display:"flex",alignItems:"baseline",gap:8,margin:"6px 0 6px"}}>
      <div style={{fontWeight:700,fontSize:13}}>Real hours by company and activity</div>
      <span style={{fontSize:12,color:MP_COL_REAL,fontWeight:700,fontFamily:"var(--font-mono)"}}>{invFmt(real,0)} h</span>
      {budget!==null&&real>0&&<span style={{fontSize:11,color:real>budget?"#b3302a":"#1e6b3a"}}>{mpSigned(real-budget)} h vs planned{budget?" ("+(real>=budget?"+":"")+Math.round((real-budget)/budget*100)+" %)":""}</span>}
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

