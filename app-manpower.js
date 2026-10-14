// ===========================================================================
// app-manpower.js — Manpower: plan in workers, budget in hours, real hours, variances.
//
// Two registers, one Firestore document each:
//   pp_manpower_plan  plan lines — {id, label, company, workers, start, end (Mondays, inclusive),
//                     hpw (hours per worker per week), byWeek:{monday: workers}, note}
//                     byWeek overrides the head count for one week (the histogram cells).
//   pp_manpower       one entry per week — {id, week (Monday), real:[{company, hours}], note,
//                     approved, planned, updatedBy, updatedAt}
//                     real = hours really spent, by the company of the workers, typed or pasted
//                     from the time-keeping app. approved / planned are the older manual figures:
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

// "Company<TAB>hours" lines, as copied from Excel or from the time-keeping app's export.
// Repeated companies are added up; a header line or a line without a number is skipped.
function mpParseCompanyPaste(text){
  var out=[],skipped=0;
  String(text||"").split(/\r?\n/).forEach(function(line){
    if(!line.trim())return;
    var cells=line.split(/\t|;|\s{2,}/).map(function(c){return c.trim();}).filter(function(c){return c!=="";});
    if(cells.length<2){var m=/^(.*?\S)\s+(\d[\d.,\s]*)$/.exec(line.trim());if(m)cells=[m[1],m[2]];}
    if(cells.length<2){skipped++;return;}
    var h=_stParseNum(cells[cells.length-1]);
    var name=cells.slice(0,cells.length-1).join(" ").trim();
    if(!name||!isFinite(h)||h===0&&!/^0+([.,]0+)?$/.test(cells[cells.length-1])){skipped++;return;}
    var hit=out.find(function(r){return mpCompanyKey(r.company)===mpCompanyKey(name);});
    if(hit)hit.hours=_invNum(hit.hours)+h;else out.push({company:name,hours:h});
  });
  return {rows:out,skipped:skipped};
}


// Everything the views show, from the plan and the weekly entries.
function mpModel(plan,weeks){
  plan=(plan||[]).filter(function(l){return isValidDate(l.start)&&isValidDate(l.end);});
  var entries={};(weeks||[]).forEach(function(e){if(isValidDate(e.week))entries[_flowMonday(e.week)]=e;});
  var set={};
  plan.forEach(function(l){mpWeeksBetween(l.start,l.end).forEach(function(w){set[w]=1;});});
  Object.keys(entries).forEach(function(w){set[w]=1;});
  var all=Object.keys(set).sort();
  var cutoff="";all.forEach(function(w){var e=entries[w];if(e&&(e.real||[]).length)cutoff=w;});
  var comp={};
  function C(name){
    var k=mpCompanyKey(name)||"(no company)";
    return comp[k]||(comp[k]={key:k,name:String(name||"").trim()||"(no company)",budget:0,budgetToDate:0,real:0,weeks:{}});
  }
  var rows=[],cB=0,cR=0,cBd=0,peak=0,peakWeek="";
  all.forEach(function(w){
    var e=entries[w]||null,covered=false,workers=0,budget=0;
    plan.forEach(function(l){
      var n=mpLineWorkers(l,w);if(!n&&!(w>=l.start&&w<=l.end))return;
      covered=true;workers+=n;var h=n*mpLineHpw(l);budget+=h;
      if(l.company){var c=C(l.company);c.budget+=h;if(cutoff&&w<=cutoff)c.budgetToDate+=h;}
    });
    var src=covered?"plan":"";
    if(!covered&&e&&mpHas(e.approved)){budget=Number(e.approved);src="manual";}
    var hasR=!!(e&&(e.real||[]).length),real=hasR?mpReal(e):0;
    if(hasR)(e.real||[]).forEach(function(r){var c=C(r.company);c.real+=_invNum(r.hours);c.weeks[w]=(c.weeks[w]||0)+_invNum(r.hours);});
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
  return {rows:rows,months:months,tot:tot,companies:companies,plan:plan};
}

// ---------------------------------------------------------------- view
function ManpowerView({weeks,saveWeeks,plan,savePlan,contractors,canEdit,currentUser}){
  weeks=weeks||[];plan=plan||[];
  const [tab,setTab]=useState(plan.length||weeks.length?"overview":"plan");
  const [edit,setEdit]=useState(null);       // week entry being edited
  var can=canEdit&&!window._ppReadOnly;
  var M=mpModel(plan,weeks);
  // Company names offered while typing: subcontractors first, then every name already used.
  var known=[];
  (contractors||[]).forEach(function(c){if(c.name&&known.indexOf(c.name)<0)known.push(c.name);});
  M.companies.forEach(function(c){if(c.name!=="(no company)"&&known.indexOf(c.name)<0)known.push(c.name);});

  function openWeek(w){
    var e=weeks.find(function(x){return _flowMonday(x.week)===w;});
    if(e)setEdit(Object.assign({},e,{real:(e.real||[]).map(function(r){return Object.assign({},r);})}));
    else{
      var prev=weeks.slice().sort(function(a,b){return b.week.localeCompare(a.week);})[0];
      setEdit(newManpowerWeek({week:w,real:prev?(prev.real||[]).map(function(r){return {company:r.company,hours:""};}):[]}));
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
      .map(function(r){return {company:String(r.company||"").trim(),hours:mpHas(r.hours)?Number(r.hours):0};}),
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
    rows.push([]);rows.push(["Month","","","Budget h","Real h","Variance h (vs budget to date)","Variance %"]);
    M.months.forEach(function(m){rows.push([mpMonthLabel(m.month),"","",Math.round(m.budget),m.hasR?Math.round(m.real):"",m.diff===null?"":Math.round(m.diff),m.pct===null?"":m.pct]);});
    var csv=rows.map(function(r){return r.map(function(v){v=String(v===undefined||v===null?"":v);return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(";");}).join("\n");
    var a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
    a.download="manpower_"+today()+".csv";document.body.appendChild(a);a.click();a.remove();
  }

  var TABS=[["overview","📊 Overview"],["plan","🧮 Plan"],["weeks","🗓 Weeks"],["months","📅 Months"],["companies","🏢 Companies"]];
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
        {can&&<button className="btn btn-pri btn-sm" onClick={openNew} title="Real hours of a week, by company">＋ Real hours</button>}
      </div>
    </div>
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
      {M.tot.cutoff&&<span style={{marginLeft:"auto",fontSize:11,color:"#888"}} title="Last week with real hours entered: “to date” figures stop there">Cut-off <b>W{mpIsoWeek(M.tot.cutoff)}</b> · {fmtDate(M.tot.cutoff)}</span>}
    </div>
    {empty&&tab!=="plan"&&<div className="empty"><div className="empty-ico">👷</div>
      <div className="empty-txt">Nothing yet. Start with the plan: one line per trade or team, the number of workers and the weeks. The budget in hours follows.</div>
      {can&&<div style={{marginTop:12}}><button className="btn btn-pri" onClick={function(){setTab("plan");}}>Go to the plan</button></div>}</div>}
    {!empty&&tab==="overview"&&<MpOverview M={M} onOpenWeek={openWeek}/>}
    {tab==="plan"&&<MpPlan plan={plan} savePlan={savePlan} M={M} can={can} known={known}/>}
    {!empty&&tab==="weeks"&&<MpWeeks M={M} onOpen={openWeek} can={can}/>}
    {!empty&&tab==="months"&&<MpMonths M={M}/>}
    {!empty&&tab==="companies"&&<MpCompanies M={M}/>}
    {edit&&<MpWeekEditor w={edit} known={known} can={can} M={M} isNew={!weeks.some(function(x){return x.id===edit.id;})}
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

// ---------------------------------------------------------------- week editor (real hours)
function MpWeekEditor({w,known,can,isNew,M,onSave,onDelete,onClose}){
  const [d,setD]=useState(w);
  const [paste,setPaste]=useState("");
  const [showPaste,setShowPaste]=useState(false);
  function set(k,v){setD(function(o){var n=Object.assign({},o);n[k]=v;return n;});}
  function setRow(i,k,v){setD(function(o){var rs=(o.real||[]).map(function(r,j){if(j!==i)return r;var u=Object.assign({},r);u[k]=v;return u;});return Object.assign({},o,{real:rs});});}
  function addRow(){setD(function(o){return Object.assign({},o,{real:(o.real||[]).concat([{company:"",hours:""}])});});}
  function delRow(i){setD(function(o){return Object.assign({},o,{real:(o.real||[]).filter(function(_,j){return j!==i;})});});}
  function applyPaste(replace){
    var res=mpParseCompanyPaste(paste);
    if(!res.rows.length){safeAlert("Nothing recognised. One line per company: the company name, then the hours (tab or ; between them).");return;}
    setD(function(o){
      var rs=replace?[]:(o.real||[]).filter(function(r){return String(r.company||"").trim();}).map(function(r){return Object.assign({},r);});
      res.rows.forEach(function(p){
        var hit=rs.find(function(r){return mpCompanyKey(r.company)===mpCompanyKey(p.company);});
        if(hit)hit.hours=p.hours;else rs.push({company:p.company,hours:p.hours});
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
      <div style={{fontWeight:700,fontSize:13}}>Real hours by company</div>
      <span style={{fontSize:12,color:MP_COL_REAL,fontWeight:700,fontFamily:"var(--font-mono)"}}>{invFmt(real,0)} h</span>
      {budget!==null&&real>0&&<span style={{fontSize:11,color:real>budget?"#b3302a":"#1e6b3a"}}>{mpSigned(real-budget)} h vs budget{budget?" ("+(real>=budget?"+":"")+Math.round((real-budget)/budget*100)+" %)":""}</span>}
      {can&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){setShowPaste(!showPaste);}}>📋 Paste from Excel</button>}
    </div>
    {showPaste&&<div style={{background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:10,marginBottom:10}}>
      <div style={{fontSize:11,color:"#6f6b62",marginBottom:6}}>One line per company: name, then hours (copied from Excel or the time-keeping export). The same company twice is added up.</div>
      <textarea value={paste} onChange={function(e){setPaste(e.target.value);}} rows={6} placeholder={"Glassco\t1 240\nSteelworks Ltd\t860"}
        style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12,padding:6}}/>
      <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
        <button className="btn btn-sm" onClick={function(){applyPaste(false);}} title="Companies already listed get the pasted hours; the others are added">Merge</button>
        <button className="btn btn-sm" onClick={function(){applyPaste(true);}} title="The pasted list replaces the lines below">Replace</button>
      </div>
    </div>}
    <datalist id="mp-companies">{known.map(function(n){return <option key={n} value={n}/>;})}</datalist>
    <table className="tbl" style={{fontSize:12}}>
      <thead><tr><th>Company</th><th style={{textAlign:"right",width:130}}>Hours</th><th style={{width:34}}></th></tr></thead>
      <tbody>
        {(d.real||[]).length===0&&<tr><td colSpan={3} style={{color:"#9b968b"}}>No company yet.</td></tr>}
        {(d.real||[]).map(function(r,i){
          return <tr key={i}>
            <td><input type="text" list="mp-companies" value={r.company||""} disabled={!can} onChange={function(e){setRow(i,"company",e.target.value);}} placeholder="Company of the workers" style={{width:"100%",padding:"4px 6px"}}/></td>
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

