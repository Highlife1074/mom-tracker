// ===========================================================================
// app-manpower.js — Manpower follow-up, week by week.
//
// One register, one Firestore document (pp_manpower), one entry per week:
//   {id, week:"YYYY-MM-DD" (the Monday), approved, planned, real:[{company, hours}], note,
//    updatedBy, updatedAt}
//   approved  hours approved for the week (budget)
//   planned   hours planned for the week
//   real      hours really spent, split by the company of the workers. Typed (or pasted)
//             from the external time-keeping app as weekly totals.
// Nothing is computed from the schedules: every figure is typed, the views only add up.
//
// Loaded after app-concrete.js and BEFORE app-mount.js. Shared scope: uuid, today, toISO,
// parseISODate, isValidDate, fmtDate, isAppAdmin, safeAlert, addCalDays, _flowMonday (app-core /
// app-tenders), _stParseNum (app-steel), InvModal, InvBig, invFmt, _invNum, invCanDelete,
// _invUpsert, _invRemove (app-inventory).
// ===========================================================================

var MP_COL_APPROVED="#a8862e";   // approved (budget) series
var MP_COL_PLANNED="#6f6b62";    // planned series
var MP_COL_REAL="#2b6cb0";       // real series
var MP_COMPANY_COLS=["#2b6cb0","#c2378a","#2e7d32","#d85a30","#7b1fa2","#00838f","#8d6e63","#5c6bc0"];
var MP_TOP=7;                    // companies drawn on their own in the chart; the rest = "Others"

function newManpowerWeek(o){
  return Object.assign({id:uuid(),week:_flowMonday(today()),approved:"",planned:"",real:[],note:"",
    updatedBy:"",updatedAt:""},o||{});
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

// Every figure the views need, from the weeks inside [from, to] (ISO Mondays, inclusive).
function mpFigures(weeks,from,to){
  var list=(weeks||[]).filter(function(w){return isValidDate(w.week)&&(!from||w.week>=from)&&(!to||w.week<=to);})
    .slice().sort(function(a,b){return a.week.localeCompare(b.week);});
  var comp={};   // key -> {name, total, weeks:{week:hours}}
  var tot={approved:0,planned:0,real:0,weeksA:0,weeksP:0,weeksR:0};
  list.forEach(function(w){
    if(mpHas(w.approved)){tot.approved+=_invNum(w.approved);tot.weeksA++;}
    if(mpHas(w.planned)){tot.planned+=_invNum(w.planned);tot.weeksP++;}
    var r=mpReal(w);if((w.real||[]).length){tot.real+=r;tot.weeksR++;}
    (w.real||[]).forEach(function(x){
      var k=mpCompanyKey(x.company);if(!k)k="(no company)";
      var c=comp[k]||(comp[k]={key:k,name:String(x.company||"").trim()||"(no company)",total:0,weeks:{}});
      c.total+=_invNum(x.hours);c.weeks[w.week]=(c.weeks[w.week]||0)+_invNum(x.hours);
    });
  });
  var companies=Object.keys(comp).map(function(k){return comp[k];}).sort(function(a,b){return b.total-a.total;});
  return {list:list,tot:tot,companies:companies};
}

// ---------------------------------------------------------------- view
function ManpowerView({weeks,saveWeeks,contractors,canEdit,currentUser}){
  weeks=weeks||[];
  const [tab,setTab]=useState(weeks.length?"overview":"weeks");
  const [edit,setEdit]=useState(null);       // week entry being edited
  const [range,setRange]=useState("all");
  var can=canEdit&&!window._ppReadOnly;
  var last=weeks.reduce(function(m,w){return isValidDate(w.week)&&w.week>m?w.week:m;},"");
  var from=range==="12w"&&last?addCalDays(last,-7*11):range==="26w"&&last?addCalDays(last,-7*25):range==="year"?today().slice(0,4)+"-01-01":"";
  var F=mpFigures(weeks,from,"");
  // Company names offered while typing: subcontractors first, then every name already used.
  var known=[];
  (contractors||[]).forEach(function(c){if(c.name&&known.indexOf(c.name)<0)known.push(c.name);});
  mpFigures(weeks).companies.forEach(function(c){if(known.indexOf(c.name)<0)known.push(c.name);});

  function openNew(){
    // Next week after the latest one, or this week; approved / planned carried over as a start.
    var prev=weeks.slice().sort(function(a,b){return b.week.localeCompare(a.week);})[0];
    var wk=prev?addCalDays(prev.week,7):_flowMonday(today());
    setEdit(newManpowerWeek({week:wk,approved:prev?prev.approved:"",planned:"",
      real:prev?(prev.real||[]).map(function(r){return {company:r.company,hours:""};}):[]}));
  }
  function saveWeek(w){
    if(blockIfReadOnly())return;
    var clash=weeks.find(function(x){return x.week===w.week&&x.id!==w.id;});
    if(clash){safeAlert("The week of "+fmtDate(w.week)+" is already entered. Open it in the list to change it.");return;}
    var doc=Object.assign({},w,{approved:mpHas(w.approved)?Number(w.approved):"",planned:mpHas(w.planned)?Number(w.planned):"",real:(w.real||[]).filter(function(r){return String(r.company||"").trim()||mpHas(r.hours);})
      .map(function(r){return {company:String(r.company||"").trim(),hours:mpHas(r.hours)?Number(r.hours):0};}),
      updatedBy:currentUser||"",updatedAt:today()});
    _invUpsert(weeks,saveWeeks,doc);setEdit(null);
  }
  function delWeek(w){
    if(!invCanDelete()){safeAlert("Deleting is not allowed for your account.");return;}
    if(_invRemove(weeks,saveWeeks,w,"the week of "+fmtDate(w.week)))setEdit(null);
  }
  function exportCsv(){
    var all=mpFigures(weeks);
    var names=all.companies.map(function(c){return c.name;});
    var rows=[["Week","Monday","Approved h","Planned h","Real h"].concat(names)];
    all.list.forEach(function(w){
      var byC={};(w.real||[]).forEach(function(r){var k=mpCompanyKey(r.company);byC[k]=(byC[k]||0)+_invNum(r.hours);});
      rows.push(["W"+mpIsoWeek(w.week),w.week,w.approved,w.planned,mpReal(w)].concat(all.companies.map(function(c){return byC[c.key]||"";})));
    });
    var csv=rows.map(function(r){return r.map(function(v){v=String(v===undefined||v===null?"":v);return /[",;\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(";");}).join("\n");
    var a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
    a.download="manpower_"+today()+".csv";document.body.appendChild(a);a.click();a.remove();
  }

  var TABS=[["overview","📊 Overview"],["weeks","🗓 Weeks"],["companies","🏢 Companies"]];
  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">👷 Manpower</div>
        <div className="page-sub">Hours per week: approved, planned and really spent — the real hours split by the company of the workers. Weekly totals typed or pasted from the time-keeping app.</div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {!can&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Manpower editor”"}</span>}
        {weeks.length>0&&<button className="btn btn-sm" onClick={exportCsv} title="Every week, one column per company (Excel opens it)">⬇ CSV</button>}
        {can&&<button className="btn btn-pri btn-sm" onClick={openNew}>＋ Week</button>}
      </div>
    </div>
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
      <span style={{marginLeft:"auto",display:"flex",gap:4,alignItems:"center",fontSize:11,color:"#888"}}>Period
        {[["all","All"],["year","This year"],["26w","26 weeks"],["12w","12 weeks"]].map(function(r){
          return <button key={r[0]} className={"fchip"+(range===r[0]?" on":"")} onClick={function(){setRange(r[0]);}}>{r[1]}</button>;})}
      </span>
    </div>
    {weeks.length===0&&<div className="empty"><div className="empty-ico">👷</div>
      <div className="empty-txt">No week entered yet. Add the first week: approved and planned hours, then the real hours per company.</div>
      {can&&<div style={{marginTop:12}}><button className="btn btn-pri" onClick={openNew}>＋ Week</button></div>}</div>}
    {weeks.length>0&&tab==="overview"&&<MpOverview F={F}/>}
    {weeks.length>0&&tab==="weeks"&&<MpWeeks F={F} onOpen={function(w){setEdit(Object.assign({},w,{real:(w.real||[]).map(function(r){return Object.assign({},r);})}));}} can={can}/>}
    {weeks.length>0&&tab==="companies"&&<MpCompanies F={F}/>}
    {edit&&<MpWeekEditor w={edit} known={known} can={can} isNew={!weeks.some(function(x){return x.id===edit.id;})}
      onSave={saveWeek} onDelete={function(){delWeek(edit);}} onClose={function(){setEdit(null);}}/>}
  </div>;
}

// ---------------------------------------------------------------- overview
function MpOverview({F}){
  const [mode,setMode]=useState("weekly");
  var t=F.tot,list=F.list;
  var lastW=list.length?list[list.length-1]:null;
  var lastReal=lastW?mpReal(lastW):null;
  var last4=list.slice(-4).filter(function(w){return (w.real||[]).length;});
  var avg4=last4.length?last4.reduce(function(s,w){return s+mpReal(w);},0)/last4.length:null;
  // Variances only over the weeks that have both figures: a week without real hours yet is not "under".
  var both=list.filter(function(w){return (w.real||[]).length&&mpHas(w.approved);});
  var rA=both.reduce(function(s,w){return s+mpReal(w);},0),aA=both.reduce(function(s,w){return s+_invNum(w.approved);},0);
  var bothP=list.filter(function(w){return (w.real||[]).length&&mpHas(w.planned);});
  var rP=bothP.reduce(function(s,w){return s+mpReal(w);},0),pP=bothP.reduce(function(s,w){return s+_invNum(w.planned);},0);
  var vA=both.length?rA-aA:null,vP=bothP.length?rP-pP:null;
  return <div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
      <InvBig label="Approved" value={t.approved} unit="h" colour={MP_COL_APPROVED} sub={t.weeksA+" week"+(t.weeksA!==1?"s":"")}/>
      <InvBig label="Planned" value={t.planned} unit="h" colour={MP_COL_PLANNED} sub={t.weeksP+" week"+(t.weeksP!==1?"s":"")}/>
      <InvBig label="Real spent" value={t.real} unit="h" colour={MP_COL_REAL} sub={t.weeksR+" week"+(t.weeksR!==1?"s":"")+" · "+F.companies.length+" compan"+(F.companies.length!==1?"ies":"y")}/>
      <InvBig label="Real − approved" value={vA} unit="h" colour={vA>0?"#b3302a":"#1e6b3a"}
        sub={both.length?(mpPct(rA,aA)+" % of approved, on "+both.length+" week"+(both.length!==1?"s":"")):"needs both figures"}/>
      <InvBig label="Real − planned" value={vP} unit="h" colour={vP>0?"#b3302a":"#1e6b3a"}
        sub={bothP.length?(mpPct(rP,pP)+" % of planned, on "+bothP.length+" week"+(bothP.length!==1?"s":"")):"needs both figures"}/>
      <InvBig label={lastW?"Last week · W"+mpIsoWeek(lastW.week):"Last week"} value={lastReal} unit="h"
        sub={avg4===null?"":"avg of last "+last4.length+" weeks: "+invFmt(avg4,0)+" h"}/>
    </div>
    <div className="card" style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:14}}>Hours per week</div>
        <span style={{fontSize:11,color:"#888"}}>{mode==="weekly"?"bars = real hours by company · lines = approved and planned":"running totals since the first week shown"}</span>
        <span style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button className={"fchip"+(mode==="weekly"?" on":"")} onClick={function(){setMode("weekly");}}>Weekly</button>
          <button className={"fchip"+(mode==="cumul"?" on":"")} onClick={function(){setMode("cumul");}}>Cumulative</button>
        </span>
      </div>
      <MpChart F={F} mode={mode}/>
    </div>
    <div className="card">
      <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Real hours by company</div>
      <MpCompanyBars F={F}/>
    </div>
  </div>;
}

// Weekly bars stacked by company with the approved / planned lines, or the three running totals.
function MpChart({F,mode}){
  var list=F.list;
  if(!list.length)return <div style={{color:"#9b968b",fontSize:12}}>No week in this period.</div>;
  var top=F.companies.slice(0,MP_TOP),topKeys=top.map(function(c){return c.key;});
  var hasOthers=F.companies.length>MP_TOP;
  var W=Math.max(640,list.length*26+70),H=280,L=56,R=14,T=12,B=40;
  var iw=W-L-R,ih=H-T-B,bw=Math.max(4,Math.min(22,iw/list.length*0.7));
  function x(i){return L+(i+0.5)*iw/list.length;}
  var series=[],cA=0,cP=0,cR=0;
  list.forEach(function(w){
    var r=mpReal(w);cA+=_invNum(w.approved);cP+=_invNum(w.planned);cR+=r;
    series.push({w:w,real:r,a:mpHas(w.approved)?_invNum(w.approved):null,p:mpHas(w.planned)?_invNum(w.planned):null,cA:cA,cP:cP,cR:cR,hasR:(w.real||[]).length>0});
  });
  var max=1;
  series.forEach(function(s){max=Math.max(max,mode==="cumul"?Math.max(s.cA,s.cP,s.cR):Math.max(s.real,s.a||0,s.p||0));});
  var step=Math.pow(10,Math.floor(Math.log10(max)));var nice=[1,2,2.5,5,10].map(function(m){return m*step;}).find(function(v){return max/v<=6;})||step*10;
  var top_=Math.ceil(max/nice)*nice;
  function y(v){return T+ih-(v/top_)*ih;}
  var ticks=[];for(var v=0;v<=top_+1e-9;v+=nice)ticks.push(v);
  function line(key,col,dash){
    var pts=series.map(function(s,i){var v=s[key];return v===null?null:[x(i),y(v)];});
    var segs=[],cur=[];pts.forEach(function(p){if(p)cur.push(p);else if(cur.length){segs.push(cur);cur=[];}});if(cur.length)segs.push(cur);
    return segs.map(function(sg,k){return <polyline key={key+k} points={sg.map(function(p){return p[0]+","+p[1];}).join(" ")} fill="none" stroke={col} strokeWidth="2" strokeDasharray={dash||""}/>;}).concat(
      pts.map(function(p,i){return p?<circle key={key+"c"+i} cx={p[0]} cy={p[1]} r="2.5" fill={col}/>:null;}));
  }
  var labelEvery=Math.max(1,Math.ceil(list.length/16));
  return <div style={{overflowX:"auto"}}>
    <svg width={W} height={H} style={{display:"block",fontFamily:"var(--font-mono)"}}>
      {ticks.map(function(v){return <g key={v}><line x1={L} x2={W-R} y1={y(v)} y2={y(v)} stroke="#efece5"/>
        <text x={L-6} y={y(v)+3} fontSize="9.5" textAnchor="end" fill="#9b968b">{invFmt(v,0)}</text></g>;})}
      {mode==="weekly"&&series.map(function(s,i){
        var acc=0,byC={};(s.w.real||[]).forEach(function(r){var k=mpCompanyKey(r.company);k=topKeys.indexOf(k)>=0?k:"__others";byC[k]=(byC[k]||0)+_invNum(r.hours);});
        var keys=topKeys.concat(hasOthers?["__others"]:[]);
        return <g key={s.w.id}>{keys.map(function(k,ci){
          var h=byC[k]||0;if(!h)return null;
          var y0=y(acc+h),hh=y(acc)-y(acc+h);acc+=h;
          return <rect key={k} x={x(i)-bw/2} y={y0} width={bw} height={Math.max(0.5,hh)} fill={k==="__others"?"#b9b4a8":MP_COMPANY_COLS[ci%MP_COMPANY_COLS.length]}>
            <title>{mpWeekLabel(s.w.week)+"\n"+(k==="__others"?"Others":top[ci].name)+": "+invFmt(h,0)+" h"}</title></rect>;
        })}
        <rect x={x(i)-bw/2} y={T} width={bw} height={ih} fill="transparent"><title>{mpWeekLabel(s.w.week)+"\nReal "+mpFmtH(s.real)+" h\nApproved "+mpFmtH(s.a)+" h\nPlanned "+mpFmtH(s.p)+" h"}</title></rect></g>;
      })}
      {mode==="weekly"&&line("a",MP_COL_APPROVED)}
      {mode==="weekly"&&line("p",MP_COL_PLANNED,"5 4")}
      {mode==="cumul"&&line("cA",MP_COL_APPROVED)}
      {mode==="cumul"&&line("cP",MP_COL_PLANNED,"5 4")}
      {mode==="cumul"&&line("cR",MP_COL_REAL)}
      {series.map(function(s,i){return i%labelEvery?null:<text key={"l"+i} x={x(i)} y={H-B+14} fontSize="9.5" textAnchor="middle" fill="#6f6b62">W{mpIsoWeek(s.w.week)}</text>;})}
      {series.length>0&&<text x={x(0)} y={H-B+27} fontSize="9" textAnchor="start" fill="#9b968b">{fmtDate(series[0].w.week)}</text>}
      {series.length>1&&<text x={x(series.length-1)} y={H-B+27} fontSize="9" textAnchor="end" fill="#9b968b">{fmtDate(series[series.length-1].w.week)}</text>}
      <line x1={L} x2={W-R} y1={T+ih} y2={T+ih} stroke="#c9c4b8"/>
    </svg>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:"#6f6b62",marginTop:6}}>
      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:MP_COL_APPROVED}}/>Approved</span>
      <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:0,borderTop:"2px dashed "+MP_COL_PLANNED}}/>Planned</span>
      {mode==="cumul"&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:16,height:2,background:MP_COL_REAL}}/>Real</span>}
      {mode==="weekly"&&top.map(function(c,ci){return <span key={c.key} style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:MP_COMPANY_COLS[ci%MP_COMPANY_COLS.length]}}/>{c.name}</span>;})}
      {mode==="weekly"&&hasOthers&&<span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:"#b9b4a8"}}/>Others ({F.companies.length-MP_TOP})</span>}
    </div>
  </div>;
}
function MpCompanyBars({F}){
  var tot=F.tot.real||0;
  if(!F.companies.length)return <div style={{color:"#9b968b",fontSize:12}}>No real hours in this period.</div>;
  var max=F.companies[0].total||1;
  return <div>{F.companies.map(function(c,ci){
    return <div key={c.key} style={{display:"grid",gridTemplateColumns:"minmax(120px,220px) 1fr 90px 50px",gap:10,alignItems:"center",fontSize:12,padding:"3px 0"}}>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}} title={c.name}>{c.name}</span>
      <div style={{background:"#f2f0eb",borderRadius:3,height:12}}><div style={{width:(c.total/max*100)+"%",height:12,borderRadius:3,background:ci<MP_TOP?MP_COMPANY_COLS[ci%MP_COMPANY_COLS.length]:"#b9b4a8"}}/></div>
      <span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(c.total,0)} h</span>
      <span style={{textAlign:"right",color:"#888"}}>{tot?Math.round(c.total/tot*100):0} %</span>
    </div>;
  })}</div>;
}

// ---------------------------------------------------------------- weeks
function MpWeeks({F,onOpen,can}){
  var list=F.list.slice().reverse();
  var cA=0,cP=0,cR=0,cum={};
  F.list.forEach(function(w){cA+=_invNum(w.approved);cP+=_invNum(w.planned);cR+=mpReal(w);cum[w.id]={a:cA,p:cP,r:cR};});
  function vcell(v){return <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:v===null?"#ccc":v>0?"#b3302a":"#1e6b3a"}}>{mpSigned(v)}</td>;}
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    <table className="tbl" style={{fontSize:12,margin:0}}>
      <thead><tr>
        <th>Week</th><th style={{textAlign:"right"}}>Approved</th><th style={{textAlign:"right"}}>Planned</th><th style={{textAlign:"right"}}>Real</th>
        <th style={{textAlign:"right"}} title="Real − approved">Δ approved</th><th style={{textAlign:"right"}} title="Real − planned">Δ planned</th>
        <th style={{textAlign:"right"}} title="Running totals: approved / real">Cumul. A / R</th>
        <th>Companies</th><th>Note</th>
      </tr></thead>
      <tbody>{list.map(function(w){
        var r=mpReal(w),hasR=(w.real||[]).length>0;
        var real=(w.real||[]).slice().sort(function(a,b){return _invNum(b.hours)-_invNum(a.hours);});
        var c=cum[w.id];
        return <tr key={w.id} onClick={function(){onOpen(w);}} style={{cursor:"pointer"}} title={can?"Open to edit":"Open"}>
          <td style={{whiteSpace:"nowrap"}}><b>W{mpIsoWeek(w.week)}</b> <span style={{color:"#888"}}>{fmtDate(w.week)}</span></td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{mpHas(w.approved)?invFmt(_invNum(w.approved),0):"—"}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{mpHas(w.planned)?invFmt(_invNum(w.planned),0):"—"}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700,color:MP_COL_REAL}}>{hasR?invFmt(r,0):"—"}</td>
          {vcell(hasR&&mpHas(w.approved)?r-_invNum(w.approved):null)}
          {vcell(hasR&&mpHas(w.planned)?r-_invNum(w.planned):null)}
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"#888",whiteSpace:"nowrap"}}>{invFmt(c.a,0)} / {invFmt(c.r,0)}</td>
          <td style={{fontSize:11,color:"#555"}}>{real.slice(0,3).map(function(x){return (x.company||"?")+" "+invFmt(_invNum(x.hours),0);}).join(" · ")}{real.length>3?" · +"+(real.length-3):""}</td>
          <td style={{fontSize:11,color:"#888",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.note||""}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// ---------------------------------------------------------------- companies
function MpCompanies({F}){
  var weeks=F.list.map(function(w){return w.week;});
  var last=weeks.slice(-4);
  var tot=F.tot.real||0;
  if(!F.companies.length)return <div className="empty"><div className="empty-txt">No real hours in this period.</div></div>;
  return <div className="card" style={{padding:0,overflowX:"auto"}}>
    <table className="tbl" style={{fontSize:12,margin:0}}>
      <thead><tr><th>Company</th><th style={{textAlign:"right"}}>Total h</th><th style={{textAlign:"right"}}>Share</th>
        <th style={{textAlign:"right"}}>Weeks present</th><th style={{textAlign:"right"}} title="Average over the weeks the company was present">Avg / week</th>
        <th style={{textAlign:"right"}}>Last week</th><th style={{textAlign:"right"}} title="Average of the last 4 weeks of the period, absent weeks counted as 0">Avg last 4 wks</th>
        <th>First → last week</th></tr></thead>
      <tbody>{F.companies.map(function(c){
        var ws=Object.keys(c.weeks).sort();
        var lastW=weeks[weeks.length-1];
        var l4=last.reduce(function(s,w){return s+(c.weeks[w]||0);},0)/(last.length||1);
        return <tr key={c.key}>
          <td style={{fontWeight:600}}>{c.name}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700}}>{invFmt(c.total,0)}</td>
          <td style={{textAlign:"right"}}>{tot?Math.round(c.total/tot*100):0} %</td>
          <td style={{textAlign:"right"}}>{ws.length}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(c.total/(ws.length||1),0)}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{c.weeks[lastW]?invFmt(c.weeks[lastW],0):"—"}</td>
          <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{invFmt(l4,0)}</td>
          <td style={{fontSize:11,color:"#888",whiteSpace:"nowrap"}}>{ws.length?"W"+mpIsoWeek(ws[0])+" "+fmtDate(ws[0])+" → W"+mpIsoWeek(ws[ws.length-1])+" "+fmtDate(ws[ws.length-1]):"—"}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// ---------------------------------------------------------------- week editor
function MpWeekEditor({w,known,can,isNew,onSave,onDelete,onClose}){
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
      <div className="fg"><label>Approved hours</label>
        <input type="number" min="0" value={d.approved} disabled={!can} onChange={function(e){set("approved",e.target.value);}} style={inp}/></div>
      <div className="fg"><label>Planned hours</label>
        <input type="number" min="0" value={d.planned} disabled={!can} onChange={function(e){set("planned",e.target.value);}} style={inp}/></div>
    </div>
    <div style={{display:"flex",alignItems:"baseline",gap:8,margin:"6px 0 6px"}}>
      <div style={{fontWeight:700,fontSize:13}}>Real hours by company</div>
      <span style={{fontSize:12,color:MP_COL_REAL,fontWeight:700,fontFamily:"var(--font-mono)"}}>{invFmt(real,0)} h</span>
      {mpHas(d.approved)&&(d.real||[]).length>0&&<span style={{fontSize:11,color:real>_invNum(d.approved)?"#b3302a":"#1e6b3a"}}>{mpSigned(real-_invNum(d.approved))} vs approved</span>}
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
