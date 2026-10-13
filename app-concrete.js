// ===========================================================================
// app-concrete.js — Concrete quantities: theoretical (per WBS) against real (pours).
//
// Three registers, one Firestore document each:
//   Types   concrete types (grades): C15 blinding, C40/50…
//   WBS     one line per work breakdown element: code, description, zone, planned start and
//           finish, theoretical m³ per type, and a "complete" flag
//   Pours   what was really poured: date, WBS, m³ per type. A pour with a "from" date is a
//           cumulative entry (e.g. everything poured to date) spread evenly over [from, date].
//
// Figures, per WBS and in total, for one type or all of them:
//   variance = real − theoretical          (meaningful once the WBS is complete)
//   forecast at completion = real of completed WBS + max(real, theoretical) of the others
// The curve spreads each WBS's theoretical quantity evenly between its start and finish
// (planned), and each pour on its date or over its period (real).
//
// The past is entered as ONE WBS ("works to date") holding the total theoretical and real
// quantities; "Split" later breaks it into detailed WBS lines. A split moves theoretical
// quantities and the real pours themselves (same dates), so totals and curves do not change.
//
// Loaded after app-inventory.js and BEFORE app-mount.js. Shared scope: uuid, today, toISO,
// parseISODate, isValidDate, fmtDate, isAppAdmin, esc, openReport, safeAlert (app-core /
// app-reports), _stParseNum (app-steel), and InvModal, InvBig, InvQtyInput, invFmt, _invNum,
// _invHas, invCanDelete, _invUpsert, _invRemove (app-inventory).
// ===========================================================================

var CON_VERSION="2026-10-13-a";
var CON_UNIT="m³";
var CON_DEFAULT_TYPES=["C15 blinding","C30/37","C40/50","C50/60","C60/75"];
var CON_WARN_PCT=3;            // a variance above this % of the theoretical is flagged
var CON_EPS=1e-6;
var CON_COL_PLAN="#a8862e";    // planned (theoretical) series
var CON_COL_REAL="#2b6cb0";    // real series
console.log("Concrete module",CON_VERSION);

function _conStamp(){return{createdAt:new Date().toISOString(),createdBy:window._currentUser?window._currentUser.name:""};}
function newConType(o){return Object.assign({id:uuid(),name:"",note:"",archived:false},o||{});}
// theo: {typeId: m³}
function newConWbs(o){return Object.assign({id:uuid(),code:"",name:"",zone:"",start:"",finish:"",done:false,theo:{},splitFrom:"",note:""},_conStamp(),o||{});}
// from: "" for a pour on one day; a date for a cumulative entry spread over [from, date]
function newConPour(o){return Object.assign({id:uuid(),date:today(),from:"",wbsId:"",ref:"",lines:[],note:""},_conStamp(),o||{});}
function newConLine(o){return Object.assign({id:uuid(),typeId:"",qty:""},o||{});}

// ---------------------------------------------------------------- calculations
function conFmt(v){return invFmt(v,1);}
function conPct(v){return v===null||v===undefined||!isFinite(v)?"—":(v>0?"+":"")+v.toFixed(1)+"%";}
function conSortTypes(types){
  return(types||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name),undefined,{numeric:true});});
}
function conSortWbs(list){
  return(list||[]).slice().sort(function(a,b){return String(a.code||a.name).localeCompare(String(b.code||b.name),undefined,{numeric:true});});
}
function conWbsLabel(w){return w?(w.code?w.code+" — ":"")+(w.name||""):"(deleted WBS)";}
function conSum(map,typeIds){return typeIds.reduce(function(s,t){return s+_invNum((map||{})[t]);},0);}
function conPourQty(p,typeIds){
  return(p.lines||[]).reduce(function(s,l){return typeIds.indexOf(l.typeId)>=0?s+_invNum(l.qty):s;},0);
}
// Real m³ per WBS and per type: {wbsId: {typeId: m³}}
function conRealIndex(pours){
  var ix={};
  (pours||[]).forEach(function(p){
    if(!ix[p.wbsId])ix[p.wbsId]={};
    (p.lines||[]).forEach(function(l){if(l.typeId)ix[p.wbsId][l.typeId]=(ix[p.wbsId][l.typeId]||0)+_invNum(l.qty);});
  });
  return ix;
}
function conWbsFigures(w,realIx,typeIds){
  var theo=conSum(w.theo,typeIds),real=conSum(realIx[w.id],typeIds);
  var variance=real-theo;
  return{wbs:w,theo:theo,real:real,variance:variance,
    pct:theo>0?variance/theo*100:null,
    progress:theo>0?real/theo*100:null,
    remaining:w.done?0:Math.max(0,theo-real),
    forecast:w.done?real:Math.max(real,theo),
    status:w.done?"done":real>CON_EPS?"progress":"todo"};
}
function conTotals(figs){
  var t={theo:0,real:0,remaining:0,forecast:0,doneTheo:0,doneReal:0,nDone:0,nOverrun:0};
  figs.forEach(function(f){
    t.theo+=f.theo;t.real+=f.real;t.remaining+=f.remaining;t.forecast+=f.forecast;
    if(f.status==="done"){t.doneTheo+=f.theo;t.doneReal+=f.real;t.nDone++;}
    if(conFlag(f)==="over")t.nOverrun++;
  });
  t.doneVariance=t.doneReal-t.doneTheo;
  t.donePct=t.doneTheo>0?t.doneVariance/t.doneTheo*100:null;
  t.forecastVariance=t.forecast-t.theo;
  t.forecastPct=t.theo>0?t.forecastVariance/t.theo*100:null;
  return t;
}
// "over": more poured than theoretical (complete or not). "under": complete, below theoretical.
function conFlag(f){
  if(f.theo<=CON_EPS)return f.real>CON_EPS?"over":"";
  if(f.pct>CON_WARN_PCT)return"over";
  if(f.status==="done"&&f.pct<-CON_WARN_PCT)return"under";
  return"";
}
function conVarColour(f){var fl=conFlag(f);return fl==="over"?"#c62828":fl==="under"?"#2e7d32":f.status!=="done"?"#aaa":undefined;}

function _conDays(a,b){return Math.round((parseISODate(b)-parseISODate(a))/86400000);}
function _conRange(from,to){
  var a=from&&isValidDate(from)?from:"",b=to&&isValidDate(to)?to:"";
  if(!a&&!b)return null;
  if(!a)a=b;if(!b)b=a;
  if(a>b){var x=a;a=b;b=x;}
  return{a:a,b:b};
}
// Spreads qty evenly (per day) over [from, to] into out[YYYY-MM]. False when there is no date.
function conSpread(qty,from,to,out){
  var r=_conRange(from,to);
  if(!r)return false;
  if(!qty)return true;
  var da=parseISODate(r.a),db=parseISODate(r.b);
  var days=_conDays(r.a,r.b)+1;
  var cur=new Date(da.getFullYear(),da.getMonth(),1);
  while(cur<=db){
    var mEnd=new Date(cur.getFullYear(),cur.getMonth()+1,0);
    var s=cur<da?da:cur,e=mEnd>db?db:mEnd;
    var n=Math.round((e-s)/86400000)+1;
    var k=toISO(cur).slice(0,7);
    out[k]=(out[k]||0)+qty*n/days;
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  return true;
}
// The part of qty, spread over [from, to], that falls on or before date.
function conShareUpTo(qty,from,to,date){
  var r=_conRange(from,to);
  if(!r||!qty)return 0;
  if(date<r.a)return 0;
  if(date>=r.b)return qty;
  return qty*(_conDays(r.a,date)+1)/(_conDays(r.a,r.b)+1);
}
function conFmtMonth(k){
  var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return M[Number(k.slice(5,7))-1]+" "+k.slice(2,4);
}
function _conNextMonth(k){var y=Number(k.slice(0,4)),m=Number(k.slice(5,7));m++;if(m>12){m=1;y++;}return y+"-"+(m<10?"0":"")+m;}
// Month by month: planned (theoretical spread over the WBS dates) and real (pours).
function conSeries(wbsList,pours,typeIds){
  var plan={},real={},unscheduled=0,inList={};
  wbsList.forEach(function(w){
    inList[w.id]=true;
    var q=conSum(w.theo,typeIds);
    if(!conSpread(q,w.start,w.finish,plan))unscheduled+=q;
  });
  (pours||[]).forEach(function(p){
    if(!inList[p.wbsId])return;
    conSpread(conPourQty(p,typeIds),p.from||p.date,p.date,real);
  });
  var keys=Object.keys(plan).concat(Object.keys(real)).sort();
  var nowK=today().slice(0,7);
  var out={months:[],plan:[],real:[],cumPlan:[],cumReal:[],unscheduled:unscheduled,nowIdx:-1};
  if(!keys.length)return out;
  var cp=0,cr=0;
  for(var k=keys[0];k<=keys[keys.length-1];k=_conNextMonth(k)){
    var p=plan[k]||0,r=real[k]||0;
    cp+=p;cr+=r;
    out.months.push(k);out.plan.push(p);out.real.push(k<=nowK||r?r:null);
    out.cumPlan.push(cp);out.cumReal.push(k<=nowK||r?cr:null);
    if(k<=nowK)out.nowIdx=out.months.length-1;
  }
  return out;
}
function _conNiceMax(v){
  if(!(v>0))return 1;
  var p=Math.pow(10,Math.floor(Math.log10(v/4)));
  var steps=[1,2,2.5,5,10];
  for(var i=0;i<steps.length;i++)if(steps[i]*p*4>=v)return steps[i]*p*4;
  return 40*p;
}

// ---------------------------------------------------------------- pasting from Excel
function conParseDate(v){
  var s=String(v||"").trim();
  if(!s)return"";
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return isValidDate(s)?s:"";
  var m=/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s);
  if(m){
    var y=m[3].length===2?"20"+m[3]:m[3];
    var iso=y+"-"+(m[2].length<2?"0":"")+m[2]+"-"+(m[1].length<2?"0":"")+m[1];
    return isValidDate(iso)?iso:"";
  }
  return"";
}
function conParseNum(v){return typeof _stParseNum==="function"?_stParseNum(v):_invNum(String(v).replace(",","."));}
function _conNormName(s){return String(s||"").toLowerCase().replace(/[\s_]+/g,"").replace(/m3|m³|\(\)/g,"");}
// First line = headers. Known columns: code/WBS, description, zone, start, finish, done.
// Any other column is a concrete type (theoretical m³); "Real <type>" is the real m³.
function conParsePaste(text){
  var lines=String(text||"").split(/\r?\n/).filter(function(l){return l.trim();});
  if(lines.length<2)return{rows:[],typeNames:[],errors:lines.length?["Need a header line and at least one WBS line."]:[]};
  var head=lines[0].split("\t").map(function(h){return h.trim();});
  var cols=[],typeNames=[];
  head.forEach(function(h,i){
    var n=h.toLowerCase();
    if(/^(code|wbs|wbs code)$/.test(n))cols[i]={f:"code"};
    else if(/^(description|name|designation|désignation|libellé|label)$/.test(n))cols[i]={f:"name"};
    else if(/^zone$/.test(n))cols[i]={f:"zone"};
    else if(/^(start|début|debut|from)$/.test(n))cols[i]={f:"start"};
    else if(/^(finish|end|fin|to)$/.test(n))cols[i]={f:"finish"};
    else if(/^(done|complete|completed|status|terminé|termine)$/.test(n))cols[i]={f:"done"};
    else if(/^(real|réel|reel)\s+/.test(n)){var t=h.replace(/^\S+\s+/,"").trim();cols[i]={f:"real",type:t};if(typeNames.indexOf(t)<0)typeNames.push(t);}
    else if(h){cols[i]={f:"theo",type:h};if(typeNames.indexOf(h)<0)typeNames.push(h);}
  });
  if(!cols.some(function(c){return c&&c.f==="code";}))return{rows:[],typeNames:[],errors:["No “Code” (or “WBS”) column in the header line."]};
  var rows=[],errors=[];
  lines.slice(1).forEach(function(l,li){
    var c=l.split("\t");
    var r={code:"",name:"",zone:"",start:"",finish:"",done:false,theo:{},real:{}};
    cols.forEach(function(col,i){
      if(!col)return;
      var v=(c[i]||"").trim();
      if(col.f==="theo"||col.f==="real"){if(v!=="")r[col.f][col.type]=conParseNum(v);}
      else if(col.f==="start"||col.f==="finish"){r[col.f]=conParseDate(v);if(v&&!r[col.f])errors.push("Line "+(li+2)+": date “"+v+"” not understood (use dd/mm/yyyy).");}
      else if(col.f==="done")r.done=/^(y|yes|o|oui|1|x|done|complete|completed|terminé|termine)$/i.test(v);
      else r[col.f]=v;
    });
    if(!r.code){errors.push("Line "+(li+2)+": no code, skipped.");return;}
    rows.push(r);
  });
  return{rows:rows,typeNames:typeNames,errors:errors};
}
function conTypeByName(types,name){
  var n=_conNormName(name);
  return(types||[]).find(function(t){return _conNormName(t.name)===n;})||null;
}

// ---------------------------------------------------------------- split
// Moves theoretical quantities and real pours from parent to the new child lines.
// rows: [{code,name,zone,start,finish,done,theo:{typeId},real:{typeId}}]
// Real quantities are taken from the parent's pours oldest first; each child pour keeps the
// date (and spread period) of the pour it was taken from, so the curve does not move.
function conApplySplit(parent,rows,wbsAll,poursAll,dropParent){
  var children=rows.map(function(r){
    return newConWbs({code:r.code,name:r.name,zone:r.zone,start:r.start,finish:r.finish,done:!!r.done,
      theo:Object.assign({},r.theo),splitFrom:parent.code||parent.name});
  });
  var theoLeft=Object.assign({},parent.theo||{});
  rows.forEach(function(r){Object.keys(r.theo||{}).forEach(function(t){theoLeft[t]=_invNum(theoLeft[t])-_invNum(r.theo[t]);});});
  Object.keys(theoLeft).forEach(function(t){if(Math.abs(theoLeft[t])<CON_EPS)delete theoLeft[t];});

  var mine=poursAll.filter(function(p){return p.wbsId===parent.id;})
    .map(function(p){return Object.assign({},p,{lines:(p.lines||[]).map(function(l){return Object.assign({},l,{qty:_invNum(l.qty)});})});})
    .sort(function(a,b){return(a.from||a.date)<(b.from||b.date)?-1:(a.from||a.date)>(b.from||b.date)?1:0;});
  var newPours=[];
  rows.forEach(function(r,ri){
    var child=children[ri],made={};
    Object.keys(r.real||{}).forEach(function(t){
      var need=_invNum(r.real[t]);
      mine.forEach(function(p){
        p.lines.forEach(function(l){
          if(need<=CON_EPS||l.typeId!==t||l.qty<=CON_EPS)return;
          var take=Math.min(need,l.qty);
          l.qty-=take;need-=take;
          if(!made[p.id]){made[p.id]=newConPour({date:p.date,from:p.from||"",wbsId:child.id,ref:p.ref,note:p.note,splitFrom:p.id,lines:[]});newPours.push(made[p.id]);}
          made[p.id].lines.push(newConLine({typeId:t,qty:Math.round(take*1e6)/1e6}));
        });
      });
    });
  });
  var left={};
  mine.forEach(function(p){
    var ls=p.lines.filter(function(l){return l.qty>CON_EPS;}).map(function(l){return Object.assign({},l,{qty:Math.round(l.qty*1e6)/1e6});});
    left[p.id]=ls.length?Object.assign({},p,{lines:ls}):null;
  });
  var pours=poursAll.map(function(p){return p.wbsId===parent.id?left[p.id]:p;}).filter(Boolean).concat(newPours);
  var parentEmpty=!Object.keys(theoLeft).length&&!pours.some(function(p){return p.wbsId===parent.id;});
  var wbs=wbsAll.map(function(w){return w.id===parent.id?Object.assign({},w,{theo:theoLeft}):w;});
  if(dropParent&&parentEmpty)wbs=wbs.filter(function(w){return w.id!==parent.id;});
  return{wbs:wbs.concat(children),pours:pours,parentEmpty:parentEmpty};
}

// ---------------------------------------------------------------- shared bits
function ConTypeFilter({types,value,onChange}){
  return <select value={value} style={{width:"auto"}} onChange={function(e){onChange(e.target.value);}}>
    <option value="">All types</option>
    {conSortTypes(types).map(function(t){return <option key={t.id} value={t.id}>{t.name}{t.archived?" (archived)":""}</option>;})}
  </select>;
}
function ConZoneSelect({zones,value,onChange,disabled,all}){
  var list=(zones||[]).slice();
  if(value&&list.indexOf(value)<0)list.push(value);
  return <select style={all?{width:"auto"}:undefined} disabled={disabled} value={value||""} onChange={function(e){onChange(e.target.value);}}>
    <option value="">{all?"All zones":"— zone —"}</option>
    {list.map(function(z){return <option key={z} value={z}>{z}</option>;})}
  </select>;
}
function ConStatus({f}){
  var s={done:["complete","#e8f5e9","#2e7d32"],progress:["in progress","#e8f0fe","#1a73e8"],todo:["not started","#eceae3","#555"]}[f.status];
  return <span className="pill" style={{background:s[1],color:s[2]}}>{s[0]}</span>;
}
function ConProgress({f}){
  if(f.progress===null)return <span style={{color:"#888"}}>—</span>;
  var p=Math.max(0,Math.min(100,f.progress));
  return <div style={{display:"flex",alignItems:"center",gap:6,minWidth:110}}>
    <div style={{flex:1,background:"#f2f0eb",borderRadius:4,height:8}}><div style={{width:p+"%",background:f.progress>100+CON_WARN_PCT?"#c62828":CON_COL_REAL,height:8,borderRadius:4}}/></div>
    <span style={{fontSize:11,fontVariantNumeric:"tabular-nums",width:38,textAlign:"right"}}>{f.progress.toFixed(0)}%</span>
  </div>;
}
function ConTypeQtyInputs({types,map,onChange,ro,realMap}){
  return <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
    {conSortTypes(types).filter(function(t){return !t.archived||_invNum((map||{})[t.id])||_invNum((realMap||{})[t.id]);}).map(function(t){
      return <div key={t.id} style={{background:"#fafafa",borderRadius:8,padding:"6px 8px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#555",marginBottom:3}}>{t.name}</div>
        <InvQtyInput disabled={ro} value={(map||{})[t.id]} onChange={function(v){var n=Object.assign({},map||{});if(v===""||v===0)delete n[t.id];else n[t.id]=v;onChange(n);}}/> <span style={{fontSize:11}}>{CON_UNIT}</span>
        {realMap&&<div style={{fontSize:10,color:"#888",marginTop:2}}>real {conFmt(_invNum(realMap[t.id]))}</div>}
      </div>;
    })}
  </div>;
}

// ---------------------------------------------------------------- main view
function ConcreteView({types,saveTypes,wbs,saveWbs,pours,savePours,zones,canEdit,currentUser}){
  types=types||[];wbs=wbs||[];pours=pours||[];
  const [tab,setTab]=useState(wbs.length?"overview":types.length?"wbs":"types");
  var edit=canEdit&&!window._ppReadOnly;
  var realIx=conRealIndex(pours);
  var common={types:types,wbs:wbs,pours:pours,realIx:realIx,zones:zones,edit:edit,saveTypes:saveTypes,saveWbs:saveWbs,savePours:savePours};
  var TABS=[["overview","📊 Overview"],["wbs","🧱 WBS & variances"],["pours","🚚 Pours (real)"],["types","🏷 Types"]];
  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">🧱 Concrete</div>
        <div className="page-sub">Theoretical quantities per WBS and per type, against what is really poured. Curve, variances in total and per WBS, and the quantities still to come.</div>
      </div>
      {!edit&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Concrete editor”"}</span>}
    </div>
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
    </div>
    {tab==="overview"&&<ConOverview {...common} onGo={setTab}/>}
    {tab==="wbs"&&<ConWbsList {...common}/>}
    {tab==="pours"&&<ConPours {...common}/>}
    {tab==="types"&&<ConTypes {...common}/>}
  </div>;
}

// ---------------------------------------------------------------- overview
function ConOverview({types,wbs,pours,realIx,zones,onGo}){
  const [typeId,setTypeId]=useState("");
  const [zone,setZone]=useState("");
  const [showTable,setShowTable]=useState(false);
  if(!wbs.length)return <div className="empty"><div className="empty-ico">🧱</div>
    <div className="empty-txt">{types.length?"No WBS yet. Start with the works done to date as one WBS, then add the WBS still to come.":"Start with the concrete types (grades), then the WBS."}</div>
    <div style={{marginTop:12}}><button className="btn btn-pri" onClick={function(){onGo(types.length?"wbs":"types");}}>{types.length?"Go to WBS":"Go to Types"}</button></div></div>;
  var typeIds=typeId?[typeId]:types.map(function(t){return t.id;});
  var list=wbs.filter(function(w){return !zone||w.zone===zone;});
  var figs=list.map(function(w){return conWbsFigures(w,realIx,typeIds);});
  var tot=conTotals(figs);
  var t0=today();
  var plannedToDate=list.reduce(function(s,w){return s+conShareUpTo(conSum(w.theo,typeIds),w.start,w.finish,t0);},0);
  var s=conSeries(list,pours,typeIds);
  var unit=CON_UNIT;
  var R={textAlign:"right"};
  var wbsZones=[...new Set(wbs.map(function(w){return w.zone;}).filter(Boolean))];
  var zoneList=[...new Set((zones||[]).concat(wbsZones))];
  // Per type, over the WBS in the zone filter.
  var byType=conSortTypes(types).map(function(t){
    var tf=list.map(function(w){return conWbsFigures(w,realIx,[t.id]);});
    return{type:t,tot:conTotals(tf)};
  }).filter(function(x){return x.tot.theo>CON_EPS||x.tot.real>CON_EPS;});
  var worst=figs.filter(function(f){return conFlag(f);}).sort(function(a,b){return Math.abs(b.variance)-Math.abs(a.variance);}).slice(0,10);
  var label=typeId?(types.find(function(t){return t.id===typeId;})||{}).name:"all types";
  return <div>
    <div className="filter-bar">
      <ConTypeFilter types={types} value={typeId} onChange={setTypeId}/>
      <ConZoneSelect zones={zoneList} value={zone} onChange={setZone} all/>
      <span style={{fontSize:12,color:"#888"}}>{list.length} WBS · {label}</span>
      <div style={{flex:1}}/>
      <button className="btn btn-sm" onClick={function(){conExportXlsx(types,list,pours,realIx);}}>⤓ Excel</button>
      <button className="btn btn-sm" onClick={function(){conOpenReport(types,list,pours,realIx,typeIds,label);}}>🖨 Report</button>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
      <InvBig label="Theoretical" value={tot.theo} unit={unit} sub={s.unscheduled>CON_EPS?conFmt(s.unscheduled)+" "+unit+" without dates":list.length+" WBS"}/>
      <InvBig label="Planned to date" value={plannedToDate} unit={unit} sub={tot.theo>0?(plannedToDate/tot.theo*100).toFixed(0)+"% of theoretical":null}/>
      <InvBig label="Real to date" value={tot.real} unit={unit} sub={(tot.theo>0?(tot.real/tot.theo*100).toFixed(0)+"% of theoretical · ":"")+(plannedToDate>0?conPct((tot.real-plannedToDate)/plannedToDate*100)+" vs planned":"")}/>
      <InvBig label="Variance, complete WBS" value={tot.nDone?tot.doneVariance:null} unit={unit} colour={tot.donePct!==null&&tot.donePct>CON_WARN_PCT?"#c62828":tot.donePct!==null&&tot.donePct<-CON_WARN_PCT?"#2e7d32":null}
        sub={tot.nDone?conPct(tot.donePct)+" on "+tot.nDone+" WBS ("+conFmt(tot.doneTheo)+" theor.)":"no WBS complete yet"}/>
      <InvBig label="Still to pour" value={tot.remaining} unit={unit} sub="theoretical − real, open WBS"/>
      <InvBig label="Forecast at completion" value={tot.forecast} unit={unit} colour={tot.forecastPct!==null&&tot.forecastPct>CON_WARN_PCT?"#c62828":null} sub={conPct(tot.forecastPct)+" vs theoretical"}/>
    </div>
    {s.months.length>0?<>
      <ConCurve s={s} theoTotal={tot.theo} forecast={tot.forecast}/>
      <ConMonthly s={s}/>
      <div style={{margin:"4px 0 14px"}}><button className="btn btn-sm" onClick={function(){setShowTable(!showTable);}}>{showTable?"Hide":"Show"} the month-by-month table</button></div>
      {showTable&&<div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>Month</th><th style={R}>Planned</th><th style={R}>Real</th><th style={R}>Difference</th><th style={R}>Cum. planned</th><th style={R}>Cum. real</th><th style={R}>Cum. difference</th></tr></thead>
        <tbody>{s.months.map(function(k,i){
          return <tr key={k} style={{background:i===s.nowIdx?"var(--gold-soft)":undefined}}><td><b>{conFmtMonth(k)}</b></td>
            <td style={R}>{conFmt(s.plan[i])}</td><td style={R}>{s.real[i]===null?"":conFmt(s.real[i])}</td>
            <td style={R}>{s.real[i]===null?"":conFmt(s.real[i]-s.plan[i])}</td>
            <td style={R}>{conFmt(s.cumPlan[i])}</td><td style={R}>{s.cumReal[i]===null?"":conFmt(s.cumReal[i])}</td>
            <td style={Object.assign({fontWeight:700},R)}>{s.cumReal[i]===null?"":conFmt(s.cumReal[i]-s.cumPlan[i])}</td></tr>;
        })}</tbody></table></div>}
    </>:<div style={{fontSize:12,color:"#888",marginBottom:12}}>No curve yet: give the WBS a start and a finish date, or enter pours.</div>}

    <div className="card-title" style={{fontSize:15}}>Variances per type</div>
    <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
      <thead><tr><th>Type</th><th style={R}>Theoretical</th><th style={R}>Real</th><th style={R}>Complete WBS: variance</th><th style={R}>%</th><th style={R}>Still to pour</th><th style={R}>Forecast</th><th style={R}>Forecast variance</th></tr></thead>
      <tbody>{byType.map(function(x){
        var t=x.tot;
        var col=t.donePct!==null&&t.donePct>CON_WARN_PCT?"#c62828":t.donePct!==null&&t.donePct<-CON_WARN_PCT?"#2e7d32":undefined;
        return <tr key={x.type.id}><td><b>{x.type.name}</b></td><td style={R}>{conFmt(t.theo)}</td><td style={R}>{conFmt(t.real)}</td>
          <td style={Object.assign({fontWeight:700,color:col},R)}>{t.nDone?conFmt(t.doneVariance):"—"}</td><td style={Object.assign({color:col},R)}>{t.nDone?conPct(t.donePct):"—"}</td>
          <td style={R}>{conFmt(t.remaining)}</td><td style={R}>{conFmt(t.forecast)}</td><td style={R}>{conFmt(t.forecastVariance)} <span style={{fontSize:10,color:"#888"}}>{conPct(t.forecastPct)}</span></td></tr>;
      })}
      <tr style={{fontWeight:700,background:"#f7f6f2"}}><td>Total</td><td style={R}>{conFmt(tot.theo)}</td><td style={R}>{conFmt(tot.real)}</td>
        <td style={R}>{tot.nDone?conFmt(tot.doneVariance):"—"}</td><td style={R}>{tot.nDone?conPct(tot.donePct):"—"}</td><td style={R}>{conFmt(tot.remaining)}</td><td style={R}>{conFmt(tot.forecast)}</td><td style={R}>{conFmt(tot.forecastVariance)}</td></tr>
      </tbody></table></div>

    {worst.length>0&&<>
      <div className="card-title" style={{fontSize:15}}>WBS to look at <span style={{fontSize:12,fontWeight:400,color:"#888"}}>— variance above {CON_WARN_PCT}%</span></div>
      <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>WBS</th><th>Status</th><th style={R}>Theoretical</th><th style={R}>Real</th><th style={R}>Variance</th><th style={R}>%</th></tr></thead>
        <tbody>{worst.map(function(f){
          return <tr key={f.wbs.id}><td><b>{f.wbs.code}</b> {f.wbs.name}</td><td><ConStatus f={f}/></td><td style={R}>{conFmt(f.theo)}</td><td style={R}>{conFmt(f.real)}</td>
            <td style={Object.assign({fontWeight:700,color:conVarColour(f)},R)}>{conFmt(f.variance)}</td><td style={Object.assign({color:conVarColour(f)},R)}>{conPct(f.pct)}</td></tr>;
        })}</tbody></table></div>
    </>}
    <div style={{fontSize:11,color:"#888"}}>Planned = theoretical spread evenly between each WBS's start and finish. The variance only becomes final when a WBS is marked complete; on an open WBS, red means more has already been poured than its theoretical quantity.</div>
  </div>;
}

// Cumulative curve: planned vs real, and the forecast from today to completion. Plain SVG.
function ConCurve({s,theoTotal,forecast}){
  const [hi,setHi]=useState(null);
  var n=s.months.length,W=760,H=260,L=58,Rm=18,T=14,B=30;
  var max=_conNiceMax(Math.max.apply(null,s.cumPlan.concat(s.cumReal.filter(function(v){return v!==null;}),[theoTotal||0,forecast||0,1])));
  var x=function(i){return n===1?L+(W-L-Rm)/2:L+(W-L-Rm)*i/(n-1);};
  var y=function(v){return T+(H-T-B)*(1-Math.max(0,v)/max);};
  var pts=function(arr){return arr.map(function(v,i){return v===null?null:x(i)+","+y(v);}).filter(Boolean).join(" ");};
  var every=Math.max(1,Math.ceil(n/12));
  var ni=s.nowIdx;
  var showFc=ni>=0&&ni<n-1&&s.cumReal[ni]!==null;
  var colW=n===1?(W-L-Rm):(W-L-Rm)/(n-1);
  var lastReal=-1;s.cumReal.forEach(function(v,i){if(v!==null)lastReal=i;});
  return <div className="card" style={{position:"relative",marginBottom:10}}>
    <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,color:"#555",marginBottom:4}}>
      <b style={{color:"var(--ink)"}}>Cumulative quantity ({CON_UNIT})</b>
      <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_PLAN} strokeWidth="2"/></svg> Planned (theoretical)</span>
      <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_REAL} strokeWidth="2"/></svg> Real</span>
      {showFc&&<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_REAL} strokeWidth="2" strokeDasharray="4 3"/></svg> Forecast at completion</span>}
    </div>
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",display:"block"}} onMouseLeave={function(){setHi(null);}}>
      {[0,.25,.5,.75,1].map(function(g){return <g key={g}><line x1={L} x2={W-Rm} y1={y(max*g)} y2={y(max*g)} stroke="#eee"/><text x={L-6} y={y(max*g)+3} fontSize="10" textAnchor="end" fill="#888">{invFmt(max*g,0)}</text></g>;})}
      {s.months.map(function(k,i){return i%every===0?<text key={k} x={x(i)} y={H-10} fontSize="10" textAnchor="middle" fill="#888">{conFmtMonth(k)}</text>:null;})}
      {theoTotal>0&&<g><line x1={L} x2={W-Rm} y1={y(theoTotal)} y2={y(theoTotal)} stroke="#bbb" strokeDasharray="2 3"/><text x={L+6} y={y(theoTotal)-4} fontSize="10" fill="#888">theoretical total {conFmt(theoTotal)}</text></g>}
      {ni>=0&&ni<n&&<line x1={x(ni)} x2={x(ni)} y1={T} y2={H-B} stroke="#ccc" strokeDasharray="3 3"/>}
      <polyline points={pts(s.cumPlan)} fill="none" stroke={CON_COL_PLAN} strokeWidth="2" strokeLinejoin="round"/>
      <polyline points={pts(s.cumReal)} fill="none" stroke={CON_COL_REAL} strokeWidth="2" strokeLinejoin="round"/>
      {showFc&&<line x1={x(ni)} y1={y(s.cumReal[ni])} x2={x(n-1)} y2={y(forecast)} stroke={CON_COL_REAL} strokeWidth="2" strokeDasharray="5 4"/>}
      {n>0&&Math.abs(s.cumPlan[n-1]-theoTotal)>max*0.03&&<text x={x(n-1)-4} y={y(s.cumPlan[n-1])-6} fontSize="10" textAnchor="end" fill="var(--ink)">{conFmt(s.cumPlan[n-1])}</text>}
      {lastReal>=0&&<g><circle cx={x(lastReal)} cy={y(s.cumReal[lastReal])} r="4" fill={CON_COL_REAL} stroke="#fff" strokeWidth="2"/>
        <text x={x(lastReal)+6} y={y(s.cumReal[lastReal])+14} fontSize="10" fill="var(--ink)">{conFmt(s.cumReal[lastReal])}</text></g>}
      {hi!==null&&<g>
        <line x1={x(hi)} x2={x(hi)} y1={T} y2={H-B} stroke="#888"/>
        <circle cx={x(hi)} cy={y(s.cumPlan[hi])} r="4" fill={CON_COL_PLAN} stroke="#fff" strokeWidth="2"/>
        {s.cumReal[hi]!==null&&<circle cx={x(hi)} cy={y(s.cumReal[hi])} r="4" fill={CON_COL_REAL} stroke="#fff" strokeWidth="2"/>}
      </g>}
      {s.months.map(function(k,i){return <rect key={k} x={x(i)-colW/2} y={T} width={colW} height={H-T-B} fill="transparent" onMouseEnter={function(){setHi(i);}}/>;})}
    </svg>
    {hi!==null&&<div style={{position:"absolute",top:34,left:(x(hi)/W*100)+"%",transform:x(hi)>W/2?"translateX(calc(-100% - 10px))":"translateX(10px)",background:"#fff",border:"1px solid #ddd",borderRadius:8,padding:"6px 10px",fontSize:12,pointerEvents:"none",boxShadow:"0 2px 8px rgba(0,0,0,.08)",whiteSpace:"nowrap"}}>
      <b>{conFmtMonth(s.months[hi])}</b>
      <div>Planned: <b>{conFmt(s.cumPlan[hi])}</b> <span style={{color:"#888"}}>(+{conFmt(s.plan[hi])} this month)</span></div>
      <div>Real: <b>{s.cumReal[hi]===null?"—":conFmt(s.cumReal[hi])}</b>{s.real[hi]!==null&&<span style={{color:"#888"}}> (+{conFmt(s.real[hi])} this month)</span>}</div>
      {s.cumReal[hi]!==null&&<div>Difference: <b>{conFmt(s.cumReal[hi]-s.cumPlan[hi])}</b></div>}
    </div>}
  </div>;
}
// Month by month: planned vs real volumes — what the supply has to deliver in the coming months.
function ConMonthly({s}){
  const [hi,setHi]=useState(null);
  var n=s.months.length,W=760,H=180,L=58,Rm=18,T=12,B=28;
  var max=_conNiceMax(Math.max.apply(null,s.plan.concat(s.real.filter(function(v){return v!==null;}),[1])));
  var slot=(W-L-Rm)/n,bw=Math.max(1,Math.min(16,(slot-6)/2));
  var y=function(v){return T+(H-T-B)*(1-Math.max(0,v)/max);};
  var every=Math.max(1,Math.ceil(n/12));
  return <div className="card" style={{position:"relative",marginBottom:4}}>
    <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,color:"#555",marginBottom:4}}>
      <b style={{color:"var(--ink)"}}>Per month ({CON_UNIT})</b>
      <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:CON_COL_PLAN,verticalAlign:"middle",marginRight:4}}/>Planned</span>
      <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:CON_COL_REAL,verticalAlign:"middle",marginRight:4}}/>Real</span>
    </div>
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",display:"block"}} onMouseLeave={function(){setHi(null);}}>
      {[0,.5,1].map(function(g){return <g key={g}><line x1={L} x2={W-Rm} y1={y(max*g)} y2={y(max*g)} stroke="#eee"/><text x={L-6} y={y(max*g)+3} fontSize="10" textAnchor="end" fill="#888">{invFmt(max*g,0)}</text></g>;})}
      {s.months.map(function(k,i){
        var cx=L+slot*i+slot/2;
        var hp=H-B-y(s.plan[i]),hr=s.real[i]===null?0:H-B-y(s.real[i]);
        return <g key={k} opacity={hi===null||hi===i?1:.55}>
          {hp>0&&<rect x={cx-bw-1} y={y(s.plan[i])} width={bw} height={hp} rx={Math.min(2,bw/2)} fill={CON_COL_PLAN}/>}
          {hr>0&&<rect x={cx+1} y={y(s.real[i])} width={bw} height={hr} rx={Math.min(2,bw/2)} fill={CON_COL_REAL}/>}
          {i%every===0&&<text x={cx} y={H-10} fontSize="10" textAnchor="middle" fill="#888">{conFmtMonth(k)}</text>}
          <rect x={cx-slot/2} y={T} width={slot} height={H-T-B} fill="transparent" onMouseEnter={function(){setHi(i);}}/>
        </g>;
      })}
    </svg>
    {hi!==null&&<div style={{position:"absolute",top:30,left:((L+slot*hi+slot/2)/W*100)+"%",transform:hi>n/2?"translateX(calc(-100% - 10px))":"translateX(10px)",background:"#fff",border:"1px solid #ddd",borderRadius:8,padding:"6px 10px",fontSize:12,pointerEvents:"none",boxShadow:"0 2px 8px rgba(0,0,0,.08)",whiteSpace:"nowrap"}}>
      <b>{conFmtMonth(s.months[hi])}</b>
      <div>Planned: <b>{conFmt(s.plan[hi])}</b></div>
      <div>Real: <b>{s.real[hi]===null?"—":conFmt(s.real[hi])}</b></div>
    </div>}
  </div>;
}

// ---------------------------------------------------------------- WBS
function ConWbsList({types,wbs,pours,realIx,zones,edit,saveWbs,savePours,saveTypes}){
  const [q,setQ]=useState("");
  const [typeId,setTypeId]=useState("");
  const [status,setStatus]=useState("");
  const [zone,setZone]=useState("");
  const [detail,setDetail]=useState(false);
  const [editing,setEditing]=useState(null);
  const [splitting,setSplitting]=useState(null);
  const [past,setPast]=useState(false);
  const [paste,setPaste]=useState(false);
  var allTypeIds=types.map(function(t){return t.id;});
  var typeIds=typeId?[typeId]:allTypeIds;
  var ql=q.trim().toLowerCase();
  var list=conSortWbs(wbs).filter(function(w){
    if(zone&&w.zone!==zone)return false;
    return !ql||[w.code,w.name,w.zone,w.splitFrom].join(" ").toLowerCase().indexOf(ql)>=0;
  }).map(function(w){return conWbsFigures(w,realIx,typeIds);}).filter(function(f){
    if(status==="over")return conFlag(f)==="over";
    return !status||f.status===status;
  });
  var tot=conTotals(list);
  var sortedTypes=conSortTypes(types);
  var wbsZones=[...new Set(wbs.map(function(w){return w.zone;}).filter(Boolean))];
  var R={textAlign:"right"};
  if(!types.length)return <div className="empty"><div className="empty-ico">🏷</div><div className="empty-txt">Create the concrete types first (Types tab): every quantity is entered per type.</div></div>;
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search code, description…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:200}}/>
      <ConTypeFilter types={types} value={typeId} onChange={setTypeId}/>
      <ConZoneSelect zones={[...new Set((zones||[]).concat(wbsZones))]} value={zone} onChange={setZone} all/>
      <select style={{width:"auto"}} value={status} onChange={function(e){setStatus(e.target.value);}}>
        <option value="">All statuses</option><option value="todo">Not started</option><option value="progress">In progress</option><option value="done">Complete</option><option value="over">Over theoretical</option>
      </select>
      {!typeId&&<button className={"fchip"+(detail?" on":"")} onClick={function(){setDetail(!detail);}}>Detail per type</button>}
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={function(){setPast(true);}} title="The works already done, as one WBS with the total theoretical and real quantities">⏮ Works to date</button>}
      {edit&&<button className="btn btn-sm" onClick={function(){setPaste(true);}}>⤓ Paste from Excel</button>}
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newConWbs());}}>+ New WBS</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🧱</div><div className="empty-txt">{wbs.length?"No WBS matches.":"No WBS yet. “Works to date” enters the past as one WBS; it can be split into detailed WBS later."}</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>WBS</th><th>Zone</th><th>Planned</th><th>Status</th><th style={R}>Theoretical</th><th style={R}>Real</th><th style={R}>Variance</th><th style={R}>%</th><th>Progress</th><th style={R}>Still to pour</th><th/></tr></thead>
      <tbody>{list.map(function(f){
        var w=f.wbs;
        var rows=[<tr key={w.id} onClick={function(){setEditing(w);}} style={{cursor:"pointer"}}>
          <td><b>{w.code}</b> {w.name}{w.splitFrom&&<div style={{fontSize:10,color:"#888"}}>split from {w.splitFrom}</div>}</td>
          <td>{w.zone}</td>
          <td style={{fontSize:12,whiteSpace:"nowrap"}}>{w.start||w.finish?fmtDate(w.start)+" → "+fmtDate(w.finish):<span style={{color:"#ef6c00"}}>no dates</span>}</td>
          <td><ConStatus f={f}/></td>
          <td style={R}>{conFmt(f.theo)}</td><td style={R}>{conFmt(f.real)}</td>
          <td style={Object.assign({fontWeight:700,color:conVarColour(f)},R)}>{conFmt(f.variance)}</td>
          <td style={Object.assign({color:conVarColour(f)},R)}>{conPct(f.pct)}</td>
          <td><ConProgress f={f}/></td>
          <td style={R}>{f.remaining?conFmt(f.remaining):"—"}</td>
          <td onClick={function(e){e.stopPropagation();}}>{edit&&(conSum(w.theo,allTypeIds)>CON_EPS||conSum(realIx[w.id],allTypeIds)>CON_EPS)&&<button className="btn btn-sm" title="Split into detailed WBS" onClick={function(){setSplitting(w);}}>✂ Split</button>}</td>
        </tr>];
        if(detail&&!typeId)sortedTypes.forEach(function(t){
          var tf=conWbsFigures(w,realIx,[t.id]);
          if(tf.theo<=CON_EPS&&tf.real<=CON_EPS)return;
          rows.push(<tr key={w.id+t.id} style={{fontSize:12,color:"#555",background:"#fbfaf7"}}>
            <td style={{paddingLeft:24}}>{t.name}</td><td/><td/><td/>
            <td style={R}>{conFmt(tf.theo)}</td><td style={R}>{conFmt(tf.real)}</td>
            <td style={Object.assign({color:conVarColour(tf)},R)}>{conFmt(tf.variance)}</td><td style={Object.assign({color:conVarColour(tf)},R)}>{conPct(tf.pct)}</td>
            <td><ConProgress f={tf}/></td><td style={R}>{tf.remaining?conFmt(tf.remaining):"—"}</td><td/></tr>);
        });
        return rows;
      })}
      <tr style={{fontWeight:700,background:"#f7f6f2"}}><td colSpan={4}>Total — {list.length} WBS{tot.nDone?" · complete: variance "+conFmt(tot.doneVariance)+" "+CON_UNIT+" ("+conPct(tot.donePct)+")":""}</td>
        <td style={R}>{conFmt(tot.theo)}</td><td style={R}>{conFmt(tot.real)}</td><td style={Object.assign({color:"#aaa"},R)}>{conFmt(tot.real-tot.theo)}</td><td style={Object.assign({color:"#aaa"},R)}>{tot.theo>0?conPct((tot.real-tot.theo)/tot.theo*100):"—"}</td><td/><td style={R}>{conFmt(tot.remaining)}</td><td/></tr>
      </tbody></table></div>}
    <div style={{fontSize:11,color:"#888",marginTop:8}}>Variance = real − theoretical, in {CON_UNIT}. It is final once the WBS is marked complete; on an open WBS it is greyed (still being poured), red if already over. Click a WBS to edit its dates and theoretical quantities; real quantities come from the Pours tab.</div>
    {editing&&<ConWbsEditor w={editing} types={types} wbs={wbs} pours={pours} realIx={realIx} zones={zones} edit={edit}
      onSave={function(d){_invUpsert(wbs,saveWbs,d);setEditing(null);}}
      onDelete={wbs.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){
        if(pours.some(function(p){return p.wbsId===d.id;})){safeAlert("Pours are recorded on this WBS. Delete or move them first (Pours tab).");return;}
        if(_invRemove(wbs,saveWbs,d,"WBS "+conWbsLabel(d)))setEditing(null);
      }:null}
      onClose={function(){setEditing(null);}}/>}
    {splitting&&<ConSplitModal parent={splitting} types={types} wbs={wbs} pours={pours} realIx={realIx} zones={zones}
      onApply={function(res){saveWbs(res.wbs);savePours(res.pours);setSplitting(null);}}
      onClose={function(){setSplitting(null);}}/>}
    {past&&<ConPastModal types={types} wbs={wbs} zones={zones}
      onApply={function(w,pour){saveWbs([w].concat(wbs));if(pour)savePours([pour].concat(pours));setPast(false);}}
      onClose={function(){setPast(false);}}/>}
    {paste&&<ConPasteModal types={types} wbs={wbs} saveTypes={saveTypes}
      onImport={function(next){saveWbs(next);setPaste(false);}} onClose={function(){setPaste(false);}}/>}
  </div>;
}
function conWbsError(d,wbs){
  if(!String(d.code||"").trim())return"A WBS needs a code.";
  if(wbs.some(function(x){return x.id!==d.id&&String(x.code).trim().toLowerCase()===String(d.code).trim().toLowerCase();}))return"Code “"+d.code+"” is already used.";
  if(d.start&&!isValidDate(d.start))return"Start date is not valid.";
  if(d.finish&&!isValidDate(d.finish))return"Finish date is not valid.";
  if(d.start&&d.finish&&d.finish<d.start)return"The finish is before the start.";
  return"";
}
function conCleanTheo(m){var o={};Object.keys(m||{}).forEach(function(k){var v=_invNum(m[k]);if(v)o[k]=v;});return o;}
function ConWbsEditor({w,types,wbs,pours,realIx,zones,edit,onSave,onDelete,onClose}){
  const [d,setD]=useState(Object.assign({},w,{theo:Object.assign({},w.theo||{})}));
  var ro=!edit;
  function set(p){setD(Object.assign({},d,p));}
  var err=conWbsError(d,wbs);
  var f=conWbsFigures(Object.assign({},d,{theo:conCleanTheo(d.theo)}),realIx,types.map(function(t){return t.id;}));
  var nPours=pours.filter(function(p){return p.wbsId===w.id;}).length;
  return <InvModal title={"🧱 "+(wbs.some(function(x){return x.id===w.id;})?"WBS "+conWbsLabel(w):"New WBS")} width={760} onClose={onClose} footer={<>
      {onDelete&&<button className="btn" style={{color:"#c62828",marginRight:"auto"}} onClick={function(){onDelete(d);}}>Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!!err} title={err} onClick={function(){onSave(Object.assign({},d,{code:String(d.code).trim(),theo:conCleanTheo(d.theo),updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""}));}}>Save</button>}
    </>}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <div className="fg" style={{flex:"0 0 140px"}}><label>Code</label><input type="text" disabled={ro} value={d.code} onChange={function(e){set({code:e.target.value});}}/></div>
      <div className="fg" style={{flex:"1 1 260px"}}><label>Description</label><input type="text" disabled={ro} value={d.name} onChange={function(e){set({name:e.target.value});}}/></div>
      <div className="fg" style={{flex:"0 0 140px"}}><label>Zone</label><ConZoneSelect zones={zones} value={d.zone} disabled={ro} onChange={function(v){set({zone:v});}}/></div>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
      <div className="fg"><label>Planned start</label><input type="date" disabled={ro} value={d.start||""} onChange={function(e){set({start:e.target.value});}}/></div>
      <div className="fg"><label>Planned finish</label><input type="date" disabled={ro} value={d.finish||""} onChange={function(e){set({finish:e.target.value});}}/></div>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,marginBottom:12,textTransform:"none",letterSpacing:"normal",fontWeight:600}}>
        <input type="checkbox" disabled={ro} checked={!!d.done} onChange={function(){set({done:!d.done});}} style={{width:15,height:15}}/> Complete — all its concrete is poured, the variance is final
      </label>
    </div>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"4px 0 6px"}}>Theoretical quantities per type</div>
    <ConTypeQtyInputs types={types} map={d.theo} ro={ro} realMap={realIx[w.id]||{}} onChange={function(m){set({theo:m});}}/>
    <div style={{fontSize:12,margin:"10px 0",color:"#555"}}>
      Theoretical <b>{conFmt(f.theo)}</b> · real <b>{conFmt(f.real)}</b> {CON_UNIT} ({nPours} pour{nPours===1?"":"s"}) · variance <b style={{color:conVarColour(f)}}>{conFmt(f.variance)} ({conPct(f.pct)})</b>
    </div>
    <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note||""} onChange={function(e){set({note:e.target.value});}}/></div>
    {err&&!ro&&<div style={{fontSize:12,color:"#c62828"}}>{err}</div>}
  </InvModal>;
}

// The past as one WBS: total theoretical, and the total real as one pour spread from start to the cut-off.
function ConPastModal({types,wbs,zones,onApply,onClose}){
  const [d,setD]=useState({code:"PAST",name:"Works completed to date",zone:"",start:"",cutoff:today(),done:true,theo:{},real:{}});
  function set(p){setD(Object.assign({},d,p));}
  var w=newConWbs({code:d.code.trim(),name:d.name,zone:d.zone,start:d.start,finish:d.cutoff,done:d.done,theo:conCleanTheo(d.theo)});
  var real=conCleanTheo(d.real);
  var err=conWbsError(w,wbs)||(!d.cutoff?"Give the cut-off date.":"")||(!d.start?"Give the date the concrete works started: the real quantity is spread from it to the cut-off on the curve.":"")
    ||(!Object.keys(w.theo).length&&!Object.keys(real).length?"Enter at least one quantity.":"");
  function apply(){
    var pour=Object.keys(real).length?newConPour({date:d.cutoff,from:d.start,wbsId:w.id,ref:"Cumulative to "+fmtDate(d.cutoff),
      note:"Total poured to date, entered as one cumulative quantity",lines:Object.keys(real).map(function(t){return newConLine({typeId:t,qty:real[t]});})}):null;
    onApply(w,pour);
  }
  return <InvModal title="⏮ Works to date — one WBS for the past" width={760} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!!err} title={err} onClick={apply}>Create</button>
    </>}>
    <div style={{fontSize:12,color:"#555",marginBottom:10}}>Everything poured so far, as one WBS: the total theoretical quantity, and the total real quantity as one cumulative pour spread from the start of the works to the cut-off date. Use <b>✂ Split</b> on it later to break it into detailed WBS — theoretical and real quantities move with each part.</div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <div className="fg" style={{flex:"0 0 140px"}}><label>Code</label><input type="text" value={d.code} onChange={function(e){set({code:e.target.value});}}/></div>
      <div className="fg" style={{flex:"1 1 240px"}}><label>Description</label><input type="text" value={d.name} onChange={function(e){set({name:e.target.value});}}/></div>
      <div className="fg" style={{flex:"0 0 140px"}}><label>Zone</label><ConZoneSelect zones={zones} value={d.zone} onChange={function(v){set({zone:v});}}/></div>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
      <div className="fg"><label>Works started</label><input type="date" value={d.start} onChange={function(e){set({start:e.target.value});}}/></div>
      <div className="fg"><label>Cut-off (to date)</label><input type="date" value={d.cutoff} onChange={function(e){set({cutoff:e.target.value});}}/></div>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,marginBottom:12,textTransform:"none",letterSpacing:"normal",fontWeight:600}}>
        <input type="checkbox" checked={!!d.done} onChange={function(){set({done:!d.done});}} style={{width:15,height:15}}/> Complete (the variance is final)
      </label>
    </div>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"4px 0 6px"}}>Theoretical to date, per type</div>
    <ConTypeQtyInputs types={types} map={d.theo} onChange={function(m){set({theo:m});}}/>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"12px 0 6px"}}>Real to date, per type</div>
    <ConTypeQtyInputs types={types} map={d.real} onChange={function(m){set({real:m});}}/>
    {err&&<div style={{fontSize:12,color:"#c62828",marginTop:10}}>{err}</div>}
  </InvModal>;
}

function ConSplitModal({parent,types,wbs,pours,realIx,zones,onApply,onClose}){
  var real=realIx[parent.id]||{};
  var tIds=conSortTypes(types).filter(function(t){return _invNum((parent.theo||{})[t.id])>CON_EPS||_invNum(real[t.id])>CON_EPS;}).map(function(t){return t.id;});
  var tById={};types.forEach(function(t){tById[t.id]=t;});
  function blank(){return{key:uuid(),code:"",name:"",zone:parent.zone||"",start:parent.start||"",finish:parent.finish||"",done:!!parent.done,theo:{},real:{}};}
  const [rows,setRows]=useState([blank()]);
  const [drop,setDrop]=useState(true);
  const [pasteText,setPasteText]=useState("");
  const [pasteMsg,setPasteMsg]=useState("");
  function setRow(k,p){setRows(rows.map(function(r){return r.key===k?Object.assign({},r,p):r;}));}
  function setQ(k,kind,t,v){setRows(rows.map(function(r){if(r.key!==k)return r;var m=Object.assign({},r[kind]);if(v===""||v===0)delete m[t];else m[t]=v;var o=Object.assign({},r);o[kind]=m;return o;}));}
  var left={theo:{},real:{}};
  tIds.forEach(function(t){
    left.theo[t]=_invNum((parent.theo||{})[t])-rows.reduce(function(s,r){return s+_invNum(r.theo[t]);},0);
    left.real[t]=_invNum(real[t])-rows.reduce(function(s,r){return s+_invNum(r.real[t]);},0);
  });
  var neg=tIds.some(function(t){return left.theo[t]<-CON_EPS||left.real[t]<-CON_EPS;});
  var allZero=tIds.every(function(t){return Math.abs(left.theo[t])<=CON_EPS&&Math.abs(left.real[t])<=CON_EPS;});
  var codes={},err="";
  rows.forEach(function(r){
    var c=String(r.code).trim().toLowerCase();
    if(!err&&!c)err="Every new WBS needs a code.";
    else if(!err&&codes[c])err="Code “"+r.code+"” is listed twice.";
    else if(!err&&wbs.some(function(x){return String(x.code).trim().toLowerCase()===c&&!(x.id===parent.id&&allZero&&drop);}))err="Code “"+r.code+"” is already used.";
    else if(!err&&r.start&&r.finish&&r.finish<r.start)err=r.code+": the finish is before the start.";
    codes[c]=true;
  });
  if(!err&&neg)err="More is allocated than the WBS holds (red figures below).";
  if(!err&&!rows.length)err="Add at least one line.";
  function loadPaste(){
    var res=conParsePaste(pasteText);
    var bad=res.typeNames.filter(function(n){var t=conTypeByName(types,n);return !t||tIds.indexOf(t.id)<0;});
    if(res.errors.length||bad.length){setPasteMsg(res.errors.concat(bad.length?["Type not in this WBS: "+bad.join(", ")]:[]).join(" "));return;}
    var out=res.rows.map(function(p){
      var r=blank();
      ["code","name","zone","start","finish"].forEach(function(k){if(p[k])r[k]=p[k];});
      if(p.done)r.done=true;
      Object.keys(p.theo).forEach(function(n){r.theo[conTypeByName(types,n).id]=p.theo[n];});
      Object.keys(p.real).forEach(function(n){r.real[conTypeByName(types,n).id]=p.real[n];});
      return r;
    });
    setRows(rows.filter(function(r){return r.code||Object.keys(r.theo).length||Object.keys(r.real).length;}).concat(out));
    setPasteMsg(out.length+" line"+(out.length===1?"":"s")+" added.");setPasteText("");
  }
  function apply(){
    var clean=rows.map(function(r){return Object.assign({},r,{code:String(r.code).trim(),theo:conCleanTheo(r.theo),real:conCleanTheo(r.real)});});
    onApply(conApplySplit(parent,clean,wbs,pours,drop));
  }
  var cell={padding:"3px 4px"};
  return <InvModal title={"✂ Split "+conWbsLabel(parent)} width={1180} onClose={onClose} footer={<>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,marginRight:"auto",textTransform:"none",letterSpacing:"normal"}}>
        <input type="checkbox" checked={drop} onChange={function(){setDrop(!drop);}}/> Remove {parent.code||"the WBS"} once everything is allocated
      </label>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!!err} title={err} onClick={apply}>Split into {rows.length} WBS</button>
    </>}>
    <div style={{fontSize:12,color:"#555",marginBottom:8}}>Give each detailed WBS its share of the theoretical and real quantities. What is not allocated stays on <b>{parent.code}</b>. Real quantities are moved with their pour dates, so the totals and the curve do not change.</div>
    <div style={{overflowX:"auto"}}><table className="tbl" style={{fontSize:12}}>
      <thead><tr><th>Code</th><th>Description</th><th>Zone</th><th>Start</th><th>Finish</th><th title="Complete">✔</th>
        {tIds.map(function(t){return <th key={t} colSpan={2} style={{textAlign:"center"}}>{tById[t].name}<div style={{fontSize:10,fontWeight:400}}>theor. · real</div></th>;})}<th/></tr></thead>
      <tbody>
        {rows.map(function(r){return <tr key={r.key}>
          <td style={cell}><input type="text" value={r.code} onChange={function(e){setRow(r.key,{code:e.target.value});}} style={{width:90}}/></td>
          <td style={cell}><input type="text" value={r.name} onChange={function(e){setRow(r.key,{name:e.target.value});}} style={{width:180}}/></td>
          <td style={cell}><ConZoneSelect zones={zones} value={r.zone} onChange={function(v){setRow(r.key,{zone:v});}}/></td>
          <td style={cell}><input type="date" value={r.start} onChange={function(e){setRow(r.key,{start:e.target.value});}}/></td>
          <td style={cell}><input type="date" value={r.finish} onChange={function(e){setRow(r.key,{finish:e.target.value});}}/></td>
          <td style={cell}><input type="checkbox" checked={!!r.done} onChange={function(){setRow(r.key,{done:!r.done});}}/></td>
          {tIds.map(function(t){return [
            <td key={t+"t"} style={cell}><InvQtyInput width={74} value={r.theo[t]} onChange={function(v){setQ(r.key,"theo",t,v);}}/></td>,
            <td key={t+"r"} style={cell}><InvQtyInput width={74} value={r.real[t]} onChange={function(v){setQ(r.key,"real",t,v);}}/></td>];})}
          <td style={cell}><button className="btn btn-sm" onClick={function(){setRows(rows.filter(function(x){return x.key!==r.key;}));}}>×</button></td>
        </tr>;})}
        <tr style={{background:"#f7f6f2",fontWeight:700}}><td colSpan={6}>Left on {parent.code} <span style={{fontWeight:400,color:"#888"}}>(of {tIds.map(function(t){return tById[t].name+" "+conFmt(_invNum((parent.theo||{})[t]))+" / "+conFmt(_invNum(real[t]));}).join(" · ")})</span></td>
          {tIds.map(function(t){return [
            <td key={t+"t"} style={{textAlign:"right",color:left.theo[t]<-CON_EPS?"#c62828":undefined}}>{conFmt(left.theo[t])}</td>,
            <td key={t+"r"} style={{textAlign:"right",color:left.real[t]<-CON_EPS?"#c62828":undefined}}>{conFmt(left.real[t])}</td>];})}<td/></tr>
      </tbody></table></div>
    <div style={{display:"flex",gap:8,margin:"8px 0"}}><button className="btn btn-sm" onClick={function(){setRows(rows.concat([blank()]));}}>+ Line</button></div>
    <details style={{fontSize:12}}><summary style={{cursor:"pointer",color:"#555"}}>Paste the lines from Excel</summary>
      <div style={{color:"#555",margin:"6px 0"}}>Header line first: <b>Code · Description · Zone · Start · Finish · Done</b>, then one column per type for the theoretical m³ (header = type name, e.g. <i>C40/50</i>) and <b>Real &lt;type&gt;</b> for the real m³ (e.g. <i>Real C40/50</i>). Only Code is required.</div>
      <textarea rows={6} value={pasteText} onChange={function(e){setPasteText(e.target.value);}} style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12}}
        placeholder={"Code\tDescription\tStart\tFinish\t"+(tIds[0]?tById[tIds[0]].name+"\tReal "+tById[tIds[0]].name:"C40/50\tReal C40/50")}/>
      <button className="btn btn-sm" disabled={!pasteText.trim()} onClick={loadPaste}>Add these lines</button> <span style={{color:/added/.test(pasteMsg)?"#2e7d32":"#c62828"}}>{pasteMsg}</span>
    </details>
    {err&&<div style={{fontSize:12,color:"#c62828",marginTop:8}}>{err}</div>}
  </InvModal>;
}

function ConPasteModal({types,wbs,saveTypes,onImport,onClose}){
  const [text,setText]=useState("");
  var res=text.trim()?conParsePaste(text):{rows:[],typeNames:[],errors:[]};
  var newTypes=res.typeNames.filter(function(n){return !conTypeByName(types,n);});
  var byCode={};wbs.forEach(function(w){byCode[String(w.code).trim().toLowerCase()]=w;});
  var nNew=res.rows.filter(function(r){return !byCode[r.code.toLowerCase()];}).length;
  var hasReal=res.rows.some(function(r){return Object.keys(r.real).length;});
  function go(){
    var allTypes=types.slice();
    var created=newTypes.map(function(n){return newConType({name:n});});
    if(created.length){allTypes=allTypes.concat(created);saveTypes(types.concat(created));}
    var next=wbs.slice();
    res.rows.forEach(function(r){
      var theo={};Object.keys(r.theo).forEach(function(n){var t=conTypeByName(allTypes,n);if(t&&r.theo[n])theo[t.id]=r.theo[n];});
      var ex=byCode[r.code.toLowerCase()];
      if(ex){
        var p={theo:Object.assign({},ex.theo||{},theo)};
        ["name","zone","start","finish"].forEach(function(k){if(r[k])p[k]=r[k];});
        if(r.done)p.done=true;
        next=next.map(function(w){return w.id===ex.id?Object.assign({},w,p):w;});
      } else next.push(newConWbs({code:r.code,name:r.name,zone:r.zone,start:r.start,finish:r.finish,done:r.done,theo:theo}));
    });
    onImport(next);
  }
  return <InvModal title="⤓ Paste WBS from Excel" width={760} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!res.rows.length} onClick={go}>Import {res.rows.length} WBS</button>
    </>}>
    <div style={{fontSize:12,color:"#555",marginBottom:8}}>Copy from Excel <b>with the header line</b>: <b>Code · Description · Zone · Start · Finish · Done</b>, then one column per concrete type holding the theoretical m³ — the header is the type name (<i>C40/50</i>…). Only Code is required; columns can be in any order. A code that already exists is updated (only the columns given).</div>
    <textarea rows={10} value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12}}
      placeholder={"Code\tDescription\tZone\tStart\tFinish\tC40/50\tC50/60\nB1-RAFT\tRaft slab B1\tP2/P1\t01/11/2026\t15/12/2026\t850\t"}/>
    {res.rows.length>0&&<div style={{fontSize:12,marginTop:8}}>{nNew} new WBS, {res.rows.length-nNew} updated. Types: {res.typeNames.join(", ")||"none"}.</div>}
    {newTypes.length>0&&<div style={{fontSize:12,color:"#ef6c00",marginTop:4}}>New types will be created: {newTypes.join(", ")}</div>}
    {hasReal&&<div style={{fontSize:12,color:"#ef6c00",marginTop:4}}>“Real” columns are ignored here: real quantities are entered as pours.</div>}
    {res.errors.length>0&&<div style={{fontSize:12,color:"#c62828",marginTop:4}}>{res.errors.slice(0,6).join(" ")}</div>}
  </InvModal>;
}

// ---------------------------------------------------------------- pours (real)
function ConPours({types,wbs,pours,zones,edit,savePours}){
  const [wbsId,setWbsId]=useState("");
  const [q,setQ]=useState("");
  const [editing,setEditing]=useState(null);
  var wById={};wbs.forEach(function(w){wById[w.id]=w;});
  var tById={};types.forEach(function(t){tById[t.id]=t;});
  var ql=q.trim().toLowerCase();
  var list=pours.filter(function(p){
    if(wbsId&&p.wbsId!==wbsId)return false;
    return !ql||[p.ref,p.note,conWbsLabel(wById[p.wbsId])].join(" ").toLowerCase().indexOf(ql)>=0;
  }).slice().sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  var allIds=types.map(function(t){return t.id;});
  var total=list.reduce(function(s,p){return s+conPourQty(p,allIds);},0);
  if(!wbs.length)return <div className="empty"><div className="empty-ico">🚚</div><div className="empty-txt">Create the WBS first: every pour is booked on a WBS.</div></div>;
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search reference, note…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:200}}/>
      <select value={wbsId} onChange={function(e){setWbsId(e.target.value);}} style={{width:"auto",maxWidth:280}}><option value="">All WBS</option>{conSortWbs(wbs).map(function(w){return <option key={w.id} value={w.id}>{conWbsLabel(w)}</option>;})}</select>
      <span style={{fontSize:12,color:"#888"}}>{list.length} pour{list.length===1?"":"s"} · {conFmt(total)} {CON_UNIT}</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newConPour({wbsId:wbsId,lines:[newConLine()]}));}}>+ New pour</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🚚</div><div className="empty-txt">No pour recorded{wbsId?" on this WBS":""}.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Date</th><th>WBS</th><th>Reference</th><th>Types</th><th style={{textAlign:"right"}}>Total</th><th>Note</th></tr></thead>
      <tbody>{list.map(function(p){
        return <tr key={p.id} onClick={function(){setEditing(p);}} style={{cursor:"pointer"}}>
          <td style={{whiteSpace:"nowrap"}}>{p.from?<span>{fmtDate(p.from)} → </span>:null}<b>{fmtDate(p.date)}</b>{p.from&&<div style={{fontSize:10,color:"#888"}}>cumulative</div>}</td>
          <td>{wById[p.wbsId]?<span><b>{wById[p.wbsId].code}</b> {wById[p.wbsId].name}</span>:<span style={{color:"#c62828"}}>(deleted WBS)</span>}</td>
          <td>{p.ref}</td>
          <td style={{fontSize:12}}>{(p.lines||[]).map(function(l){return(tById[l.typeId]?tById[l.typeId].name:"?")+" "+conFmt(_invNum(l.qty));}).join(" · ")}</td>
          <td style={{textAlign:"right",fontWeight:700}}>{conFmt(conPourQty(p,allIds))}</td>
          <td style={{fontSize:12,color:"#555"}}>{p.note}</td>
        </tr>;
      })}</tbody></table></div>}
    {editing&&<ConPourEditor p={editing} types={types} wbs={wbs} edit={edit} isNew={!pours.some(function(x){return x.id===editing.id;})}
      onSave={function(d){_invUpsert(pours,savePours,d);setEditing(null);}}
      onSaveNext={function(d){_invUpsert(pours,savePours,d);setEditing(newConPour({date:d.date,wbsId:d.wbsId,lines:[newConLine({typeId:(d.lines[0]||{}).typeId||""})]}));}}
      onDelete={pours.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){if(_invRemove(pours,savePours,d,"this pour"))setEditing(null);}:null}
      onClose={function(){setEditing(null);}}/>}
  </div>;
}
function ConPourEditor({p,types,wbs,edit,isNew,onSave,onSaveNext,onDelete,onClose}){
  const [d,setD]=useState(Object.assign({},p,{lines:(p.lines||[]).slice()}));
  const [spread,setSpread]=useState(!!p.from);
  var ro=!edit;
  function set(x){setD(Object.assign({},d,x));}
  function setLine(id,x){set({lines:d.lines.map(function(l){return l.id===id?Object.assign({},l,x):l;})});}
  var dup={};d.lines.forEach(function(l){if(l.typeId)dup[l.typeId]=(dup[l.typeId]||0)+1;});
  var err=!d.date||!isValidDate(d.date)?"Give the pour date.":!d.wbsId?"Choose the WBS.":
    spread&&(!d.from||!isValidDate(d.from))?"Give the start of the period.":spread&&d.from>d.date?"The period starts after it ends.":
    !d.lines.length||!d.lines.every(function(l){return l.typeId&&_invNum(l.qty)>0;})?"Every line needs a type and a quantity above zero.":
    Object.keys(dup).some(function(k){return dup[k]>1;})?"A type is listed twice.":"";
  function clean(){return Object.assign({},d,{from:spread?d.from:"",lines:d.lines.map(function(l){return{id:l.id,typeId:l.typeId,qty:_invNum(l.qty)};}),
    updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""});}
  var w=wbs.find(function(x){return x.id===d.wbsId;});
  return <InvModal title={isNew?"🚚 New pour":"🚚 Pour "+(d.ref||fmtDate(d.date))} width={680} onClose={onClose} footer={<>
      {onDelete&&<button className="btn" style={{color:"#c62828",marginRight:"auto"}} onClick={function(){onDelete(d);}}>Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&isNew&&<button className="btn" disabled={!!err} title={err} onClick={function(){onSaveNext(clean());}}>Save & next</button>}
      {!ro&&<button className="btn btn-pri" disabled={!!err} title={err} onClick={function(){onSave(clean());}}>Save</button>}
    </>}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
      {spread&&<div className="fg"><label>From</label><input type="date" disabled={ro} value={d.from||""} onChange={function(e){set({from:e.target.value});}}/></div>}
      <div className="fg"><label>{spread?"To":"Date"}</label><input type="date" disabled={ro} value={d.date} onChange={function(e){set({date:e.target.value});}}/></div>
      <div className="fg" style={{flex:"1 1 160px"}}><label>Reference (pour / docket no.)</label><input type="text" disabled={ro} value={d.ref} onChange={function(e){set({ref:e.target.value});}}/></div>
    </div>
    <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,marginBottom:10,textTransform:"none",letterSpacing:"normal"}}>
      <input type="checkbox" disabled={ro} checked={spread} onChange={function(){setSpread(!spread);if(!spread&&!d.from&&w&&w.start)set({from:w.start});}}/> Cumulative quantity over a period (spread evenly on the curve)
    </label>
    <div className="fg"><label>WBS</label><select disabled={ro} value={d.wbsId} onChange={function(e){set({wbsId:e.target.value});}}>
      <option value="">— WBS —</option>{conSortWbs(wbs).map(function(x){return <option key={x.id} value={x.id}>{conWbsLabel(x)}{x.done?" (complete)":""}</option>;})}</select></div>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"6px 0"}}>Quantities</div>
    {d.lines.map(function(l){
      return <div key={l.id} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,padding:"6px 8px",background:"#fafafa",borderRadius:8}}>
        <select disabled={ro} value={l.typeId} onChange={function(e){setLine(l.id,{typeId:e.target.value});}} style={{flex:"1 1 180px"}}>
          <option value="">— type —</option>{conSortTypes(types).filter(function(t){return !t.archived||t.id===l.typeId;}).map(function(t){return <option key={t.id} value={t.id}>{t.name}{w&&_invNum((w.theo||{})[t.id])?" · theor. "+conFmt(w.theo[t.id]):""}</option>;})}
        </select>
        <InvQtyInput disabled={ro} value={l.qty} onChange={function(v){setLine(l.id,{qty:v});}}/> <span style={{fontSize:12}}>{CON_UNIT}</span>
        {!ro&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){set({lines:d.lines.filter(function(x){return x.id!==l.id;})});}}>×</button>}
      </div>;
    })}
    {!ro&&<button className="btn btn-sm" onClick={function(){set({lines:d.lines.concat([newConLine()])});}}>+ Type</button>}
    <div className="fg" style={{marginTop:10}}><label>Note</label><textarea rows={2} disabled={ro} value={d.note||""} onChange={function(e){set({note:e.target.value});}}/></div>
    {err&&!ro&&<div style={{fontSize:12,color:"#c62828"}}>{err}</div>}
  </InvModal>;
}

// ---------------------------------------------------------------- types
function ConTypes({types,wbs,pours,edit,saveTypes}){
  const [editing,setEditing]=useState(null);
  var used={};
  wbs.forEach(function(w){Object.keys(w.theo||{}).forEach(function(t){used[t]=true;});});
  pours.forEach(function(p){(p.lines||[]).forEach(function(l){used[l.typeId]=true;});});
  function addDefaults(){
    var add=CON_DEFAULT_TYPES.filter(function(n){return !conTypeByName(types,n);}).map(function(n){return newConType({name:n});});
    if(add.length)saveTypes(types.concat(add));
  }
  return <div>
    <div className="filter-bar">
      <span style={{fontSize:12,color:"#888"}}>{types.length} type{types.length===1?"":"s"} — every quantity, theoretical or real, is entered per type</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={addDefaults} title={CON_DEFAULT_TYPES.join(", ")}>+ Usual grades</button>}
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newConType());}}>+ New type</button>}
    </div>
    {!types.length?<div className="empty"><div className="empty-ico">🏷</div><div className="empty-txt">No concrete type yet. “Usual grades” adds {CON_DEFAULT_TYPES.join(", ")}.</div></div>:
    <table className="tbl"><thead><tr><th>Type</th><th>Note</th><th>Used</th></tr></thead>
      <tbody>{conSortTypes(types).map(function(t){
        return <tr key={t.id} onClick={function(){setEditing(t);}} style={{cursor:"pointer",opacity:t.archived?.5:1}}>
          <td><b>{t.name}</b>{t.archived&&<span className="pill" style={{marginLeft:6,background:"#eceae3",color:"#555"}}>archived</span>}</td><td>{t.note}</td><td>{used[t.id]?"yes":""}</td>
        </tr>;
      })}</tbody></table>}
    {editing&&<ConTypeEditor t={editing} types={types} edit={edit}
      onSave={function(d){_invUpsert(types,saveTypes,d);setEditing(null);}}
      onDelete={types.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){
        if(used[d.id]){safeAlert("This type has quantities on WBS lines or pours. Archive it instead.");return;}
        if(_invRemove(types,saveTypes,d,"type "+d.name))setEditing(null);
      }:null}
      onClose={function(){setEditing(null);}}/>}
  </div>;
}
function ConTypeEditor({t,types,edit,onSave,onDelete,onClose}){
  const [d,setD]=useState(Object.assign({},t));
  var ro=!edit;
  function set(x){setD(Object.assign({},d,x));}
  var other=conTypeByName(types.filter(function(x){return x.id!==d.id;}),d.name);
  var err=!String(d.name).trim()?"Give the type a name.":other?"“"+d.name+"” already exists.":"";
  return <InvModal title={"🏷 "+(d.name||"New type")} width={520} onClose={onClose} footer={<>
      {onDelete&&<button className="btn" style={{color:"#c62828",marginRight:"auto"}} onClick={function(){onDelete(d);}}>Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!!err} title={err} onClick={function(){onSave(Object.assign({},d,{name:String(d.name).trim()}));}}>Save</button>}
    </>}>
    <div className="fg"><label>Name</label><input type="text" disabled={ro} value={d.name} placeholder="C40/50" onChange={function(e){set({name:e.target.value});}}/></div>
    <div className="fg"><label>Note</label><input type="text" disabled={ro} value={d.note||""} placeholder="e.g. columns and cores, pumped" onChange={function(e){set({note:e.target.value});}}/></div>
    <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,textTransform:"none",letterSpacing:"normal"}}>
      <input type="checkbox" disabled={ro} checked={!!d.archived} onChange={function(){set({archived:!d.archived});}}/> Archived (no longer offered for new entries)
    </label>
    {err&&!ro&&<div style={{fontSize:12,color:"#c62828",marginTop:8}}>{err}</div>}
  </InvModal>;
}

// ---------------------------------------------------------------- report & export
function conOpenReport(types,list,pours,realIx,typeIds,label){
  var E=esc,t0=today();
  var figs=conSortWbs(list).map(function(w){return conWbsFigures(w,realIx,typeIds);});
  var tot=conTotals(figs);
  var s=conSeries(list,pours,typeIds);
  var td=function(v,b,c){return'<td style="text-align:right;'+(b?"font-weight:700;":"")+(c?"color:"+c+";":"")+'">'+v+"</td>";};
  var byType=conSortTypes(types).filter(function(t){return typeIds.indexOf(t.id)>=0;}).map(function(t){
    var tt=conTotals(list.map(function(w){return conWbsFigures(w,realIx,[t.id]);}));
    if(tt.theo<=CON_EPS&&tt.real<=CON_EPS)return"";
    return"<tr><td><b>"+E(t.name)+"</b></td>"+td(conFmt(tt.theo))+td(conFmt(tt.real))+td(tt.nDone?conFmt(tt.doneVariance)+" ("+conPct(tt.donePct)+")":"—",true)+td(conFmt(tt.remaining))+td(conFmt(tt.forecast))+td(conFmt(tt.forecastVariance))+"</tr>";
  }).join("");
  var wRows=figs.map(function(f){
    var st={done:"complete",progress:"in progress",todo:"not started"}[f.status];
    return"<tr><td><b>"+E(f.wbs.code)+"</b> "+E(f.wbs.name)+"</td><td>"+E(f.wbs.zone||"")+"</td><td>"+E(f.wbs.start||f.wbs.finish?fmtDate(f.wbs.start)+" → "+fmtDate(f.wbs.finish):"")+"</td><td>"+st+"</td>"
      +td(conFmt(f.theo))+td(conFmt(f.real))+td(conFmt(f.variance),true,conVarColour(f))+td(conPct(f.pct),false,conVarColour(f))+td(f.remaining?conFmt(f.remaining):"—")+"</tr>";
  }).join("");
  var nowK=t0.slice(0,7);
  var mRows=s.months.filter(function(k){return k>=nowK;}).slice(0,12).map(function(k){var i=s.months.indexOf(k);return"<tr><td>"+conFmtMonth(k)+"</td>"+td(conFmt(s.plan[i]))+td(conFmt(s.cumPlan[i]))+"</tr>";}).join("");
  var html="<h1>Concrete — theoretical vs real</h1><div class=\"sub\">Riviera Tower · "+E(label)+" · situation at "+E(fmtDate(t0))+"</div>"
    +"<h2>Summary ("+CON_UNIT+")</h2><table><tr><th>Theoretical</th><th>Real to date</th><th>Variance, complete WBS</th><th>Still to pour</th><th>Forecast at completion</th><th>Forecast variance</th></tr><tr>"
    +td(conFmt(tot.theo))+td(conFmt(tot.real))+td(tot.nDone?conFmt(tot.doneVariance)+" ("+conPct(tot.donePct)+")":"—",true)+td(conFmt(tot.remaining))+td(conFmt(tot.forecast))+td(conFmt(tot.forecastVariance)+" ("+conPct(tot.forecastPct)+")")+"</tr></table>"
    +(byType?"<h2>Per type</h2><table><tr><th>Type</th><th>Theoretical</th><th>Real</th><th>Variance, complete WBS</th><th>Still to pour</th><th>Forecast</th><th>Forecast variance</th></tr>"+byType+"</table>":"")
    +(mRows?"<h2>Planned quantities, coming months</h2><table><tr><th>Month</th><th>Planned</th><th>Cumulative planned</th></tr>"+mRows+"</table>":"")
    +"<h2>Per WBS</h2><table><tr><th>WBS</th><th>Zone</th><th>Planned</th><th>Status</th><th>Theoretical</th><th>Real</th><th>Variance</th><th>%</th><th>Still to pour</th></tr>"+wRows+"</table>"
    +"<div style=\"font-size:10px;color:#8b8578\">Variance = real − theoretical; final once a WBS is complete. Forecast at completion = real of complete WBS + the larger of real and theoretical for the others.</div>";
  openReport("CONCRETE - "+t0,html);
}
function conExportXlsx(types,list,pours,realIx){
  if(!window.XLSX||!window.XLSX.utils||!window.XLSX.writeFile){safeAlert("The Excel library is not loaded.");return;}
  var st=conSortTypes(types),allIds=types.map(function(t){return t.id;});
  var r2=function(v){return Math.round(v*100)/100;};
  var rows=conSortWbs(list).map(function(w){
    var f=conWbsFigures(w,realIx,allIds);
    var o={"Code":w.code,"Description":w.name,"Zone":w.zone,"Start":w.start,"Finish":w.finish,"Complete":w.done?"Y":"","Split from":w.splitFrom||""};
    st.forEach(function(t){
      var tf=conWbsFigures(w,realIx,[t.id]);
      o[t.name+" theor."]=r2(tf.theo);o[t.name+" real"]=r2(tf.real);o[t.name+" variance"]=r2(tf.variance);
    });
    o["Total theor."]=r2(f.theo);o["Total real"]=r2(f.real);o["Total variance"]=r2(f.variance);o["Variance %"]=f.pct===null?"":r2(f.pct);o["Still to pour"]=r2(f.remaining);
    return o;
  });
  var inList={};list.forEach(function(w){inList[w.id]=w;});
  var tById={};types.forEach(function(t){tById[t.id]=t;});
  var pr=[];
  pours.forEach(function(p){if(!inList[p.wbsId])return;(p.lines||[]).forEach(function(l){
    pr.push({"Date":p.date,"From (cumulative)":p.from||"","WBS":inList[p.wbsId].code,"Reference":p.ref,"Type":tById[l.typeId]?tById[l.typeId].name:"","m³":_invNum(l.qty),"Note":p.note||""});
  });});
  pr.sort(function(a,b){return a.Date<b.Date?-1:1;});
  var s=conSeries(list,pours,allIds);
  var mr=s.months.map(function(k,i){return{"Month":k,"Planned":r2(s.plan[i]),"Real":s.real[i]===null?"":r2(s.real[i]),"Cum. planned":r2(s.cumPlan[i]),"Cum. real":s.cumReal[i]===null?"":r2(s.cumReal[i])};});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(rows),"WBS");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(pr),"Pours");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(mr),"Monthly");
  window.XLSX.writeFile(wb,"Concrete "+today()+".xlsx");
}
