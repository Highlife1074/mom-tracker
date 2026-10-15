// ===========================================================================
// app-concrete.js — Concrete quantities: theoretical (per WBS) against real (pours).
//
// Three registers, one Firestore document each:
//   Types   concrete types (grades): C15 blinding, C40/50…
//   WBS     one line per work breakdown element: code, description, zone, planned start and
//           finish, theoretical m³ per type, and a "complete" flag
//   Pours   what was really poured: date, WBS, m³ per type and per supplier (one pour can be
//           fed by several plants). A pour with a "from" date is a cumulative entry (e.g.
//           everything poured to date) spread evenly over [from, date].
//
// No progress is ever estimated. Theoretical and poured volumes are shown as they are; the
// loss or gain of concrete is measured only at a cut-off, against the progress % typed by hand
// for each WBS (earned = budget × %), on the WBS that have one.
// The curve spreads each WBS's theoretical quantity evenly between its start and finish
// (planned), and each pour on its date or over its period (real).
//
// Schedule links (end of file): a WBS can follow the planned dates of zone-schedule activities,
// and their progress is offered at a cut-off.
// Cut-off cost control (see the section near the end): physical progress % per WBS at a date,
// budget unlocked vs real, remain to be spent theoretical and real (adjustable), EAC.
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

var CON_VERSION="2026-10-13-f";
var CON_UNIT="m³";
var CON_DEFAULT_TYPES=["C15 blinding","C30/37","C40/50","C50/60","C60/75"];
var CON_WARN_PCT=3;            // a variance above this % of the theoretical is flagged
var CON_EPS=1e-6;
var CON_COL_PLAN="#a8862e";    // planned (theoretical) series
var CON_COL_REAL="#2b6cb0";    // real series (volume poured)
var CON_COL_EARN="#c2378a";    // real progress (earned volume = budget × progress %, from the cut-offs)
console.log("Concrete module",CON_VERSION);

function _conStamp(){return{createdAt:new Date().toISOString(),createdBy:window._currentUser?window._currentUser.name:""};}
function newConType(o){return Object.assign({id:uuid(),name:"",note:"",archived:false},o||{});}
// theo: {typeId: m³}
function newConWbs(o){return Object.assign({id:uuid(),code:"",name:"",zone:"",start:"",finish:"",done:false,theo:{},splitFrom:"",note:""},_conStamp(),o||{});}
// from: "" for a pour on one day; a date for a cumulative entry spread over [from, date]
function newConPour(o){return Object.assign({id:uuid(),date:today(),from:"",wbsId:"",ref:"",lines:[],note:""},_conStamp(),o||{});}
// supplier: free text (the plant / ready-mix company). "" on lines entered before suppliers existed.
function newConLine(o){return Object.assign({id:uuid(),typeId:"",supplier:"",qty:""},o||{});}

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
var CON_NO_SUPPLIER="(supplier not stated)";
function conSupplierOf(l){return String(l&&l.supplier||"").trim()||CON_NO_SUPPLIER;}
// Every supplier named on a pour line, for the suggestions and the filters.
function conSupplierNames(pours){
  var seen={};
  (pours||[]).forEach(function(p){(p.lines||[]).forEach(function(l){var n=String(l.supplier||"").trim();if(n&&!seen[n.toLowerCase()])seen[n.toLowerCase()]=n;});});
  return Object.keys(seen).map(function(k){return seen[k];}).sort(function(a,b){return a.localeCompare(b);});
}
// Real m³ per supplier and per type over the pours of the given WBS: {supplier: {typeId: m³, _month: m³ this month}}
function conBySupplier(pours,wbsIds,typeIds){
  var out={},nowK=today().slice(0,7);
  (pours||[]).forEach(function(p){
    if(!wbsIds[p.wbsId])return;
    (p.lines||[]).forEach(function(l){
      if(typeIds.indexOf(l.typeId)<0)return;
      var k=conSupplierOf(l),q=_invNum(l.qty);
      if(!out[k])out[k]={_total:0,_month:0};
      out[k][l.typeId]=(out[k][l.typeId]||0)+q;
      out[k]._total+=q;
      // a cumulative entry counts in this month only for its share of this month
      if(p.from){var m={};conSpread(q,p.from,p.date,m);out[k]._month+=m[nowK]||0;}
      else if(String(p.date).slice(0,7)===nowK)out[k]._month+=q;
    });
  });
  return out;
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
// Theoretical and real POURED volume of a WBS. This is volume, not progress: the variance
// real / theoretical is only measured at a cut-off, on a progress % typed by hand.
function conWbsFigures(w,realIx,typeIds){
  var theo=conSum(w.theo,typeIds),real=conSum(realIx[w.id],typeIds);
  return{wbs:w,theo:theo,real:real,status:w.done?"done":real>CON_EPS?"progress":"todo"};
}
function conTotals(figs){
  var t={theo:0,real:0};
  figs.forEach(function(f){t.theo+=f.theo;t.real+=f.real;});
  return t;
}

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
function conSeries(wbsList,pours,typeIds,extraMonths){
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
  var keys=Object.keys(plan).concat(Object.keys(real)).concat(extraMonths||[]).sort();
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

// Real progress: the earned volume (budget × progress % typed at the cut-off) against the
// volume poured by then, on the WBS that have a progress %. Only at cut-off dates: nothing is
// interpolated or estimated in between. Real − earned > 0 = concrete lost, < 0 = gained.
function conEarnedPoints(cutoffs,wbsList,pours,typeIds){
  return(cutoffs||[]).filter(function(c){return c.date&&isValidDate(c.date);}).slice()
    .sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;})
    .map(function(c){
      var t=conCutoffTotals(conCutoffRows(c,wbsList,pours,typeIds));
      return{cutoff:c,date:c.date,label:c.label||"",closed:!!c.closed,earned:t.earned,real:t.real,theo:t.theo,theoAll:t.theoAll,realAll:t.realAll,
        nPct:t.nPct,nNoPct:t.nNoPct,theoNoPct:t.theoNoPct,realNoPct:t.realNoPct,variance:t.variance,varPct:t.varPct,eac:t.eac,eacVar:t.eacVar,eacPct:t.eacPct};
    }).filter(function(p){return p.nPct>0;});
}
function conLatestCutoff(cutoffs){
  var last=null;
  (cutoffs||[]).forEach(function(c){if(c.date&&isValidDate(c.date)&&(!last||c.date>last.date))last=c;});
  return last;
}
function conLossCol(v){return v>CON_EPS?"#c62828":v<-CON_EPS?"#2e7d32":undefined;}
function conLossWord(v){return v>CON_EPS?"loss":v<-CON_EPS?"gain":"no difference";}

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
      theo:Object.assign({},r.theo),splitFrom:parent.code||parent.name});   // schedule links are set on each new line afterwards
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
      // Oldest pour first. Within one pour, the type's lines (one per supplier) give pro rata:
      // a split does not know which supplier fed which part, so each keeps its share.
      mine.forEach(function(p){
        if(need<=CON_EPS)return;
        var ls=p.lines.filter(function(l){return l.typeId===t&&l.qty>CON_EPS;});
        var avail=ls.reduce(function(s2,l){return s2+l.qty;},0);
        if(avail<=CON_EPS)return;
        var take=Math.min(need,avail);
        need-=take;
        if(!made[p.id]){made[p.id]=newConPour({date:p.date,from:p.from||"",wbsId:child.id,ref:p.ref,note:p.note,splitFrom:p.id,lines:[]});newPours.push(made[p.id]);}
        ls.forEach(function(l,i){
          var part=i===ls.length-1?take-ls.slice(0,i).reduce(function(s2,x){return s2+x._took;},0):take*l.qty/avail;
          l._took=part;
        });
        ls.forEach(function(l){
          l.qty-=l._took;
          var q=Math.round(l._took*1e6)/1e6;
          delete l._took;
          if(q<=CON_EPS)return;
          var ex=made[p.id].lines.find(function(x){return x.typeId===t&&x.supplier===(l.supplier||"");});
          if(ex)ex.qty=Math.round((ex.qty+q)*1e6)/1e6;
          else made[p.id].lines.push(newConLine({typeId:t,supplier:l.supplier||"",qty:q}));
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
function ConSupplierInput({value,onChange,disabled,suppliers}){
  return <>
    <input type="text" list="con-supplier-list" disabled={disabled} value={value||""} placeholder="Supplier" onChange={function(e){onChange(e.target.value);}} style={{flex:"1 1 150px",minWidth:120,width:"auto"}}/>
    <datalist id="con-supplier-list">{(suppliers||[]).map(function(n){return <option key={n} value={n}/>;})}</datalist>
  </>;
}
function ConStatus({f}){
  var s={done:["complete","#e8f5e9","#2e7d32"],progress:["in progress","#e8f0fe","#1a73e8"],todo:["not started","#eceae3","#555"]}[f.status];
  return <span className="pill" style={{background:s[1],color:s[2]}}>{s[0]}</span>;
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
function ConcreteView({types,saveTypes,wbs,saveWbs,pours,savePours,cutoffs,saveCutoffs,schedules,zones,canEdit,currentUser}){
  types=types||[];wbs=wbs||[];pours=pours||[];cutoffs=cutoffs||[];
  var schedIx=conSchedIndex(schedules);
  var wbsEff=conEffectiveWbs(wbs,schedIx);
  const [tab,setTab]=useState(wbs.length?"overview":types.length?"wbs":"types");
  const [importing,setImporting]=useState(false);
  var edit=canEdit&&!window._ppReadOnly;
  var realIx=conRealIndex(pours);
  var common={types:types,wbs:wbs,pours:pours,realIx:realIx,zones:zones,edit:edit,saveTypes:saveTypes,saveWbs:saveWbs,savePours:savePours,cutoffs:cutoffs,saveCutoffs:saveCutoffs,schedules:schedules||[],schedIx:schedIx,wbsEff:wbsEff};
  var TABS=[["overview","📊 Overview"],["wbs","🧱 WBS & variances"],["pours","🚚 Pours (real)"],["cutoff","💰 Cut-off cost control"],["types","🏷 Types"]];
  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">🧱 Concrete</div>
        <div className="page-sub">Theoretical quantities per WBS and per type, against what is really poured. Curve, variances in total and per WBS, and the quantities still to come.</div>
      </div>
      {!edit&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Concrete editor”"}</span>}
      {edit&&<button className="btn btn-sm" onClick={function(){setImporting(true);}} title="Delivery notes from the site follow-up workbook (e.g. sheet SUPERSTRUCTURE), descriptions matched to your WBS">⬆ Import Excel</button>}
    </div>
    {importing&&<ConImportModal types={types} saveTypes={saveTypes} wbs={wbs} saveWbs={saveWbs} pours={pours} savePours={savePours} onClose={function(){setImporting(false);}}/>}
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
    </div>
    {tab==="overview"&&<ConOverview {...common} wbs={wbsEff} rawWbs={wbs} onGo={setTab}/>}
    {tab==="wbs"&&<ConWbsList {...common}/>}
    {tab==="pours"&&<ConPours {...common}/>}
    {tab==="cutoff"&&<ConCutoff {...common}/>}
    {tab==="types"&&<ConTypes {...common}/>}
  </div>;
}

// ---------------------------------------------------------------- overview
function ConOverview({types,wbs,rawWbs,saveWbs,edit,pours,realIx,zones,cutoffs,onGo}){
  const [typeId,setTypeId]=useState("");
  const [zone,setZone]=useState("");
  const [showTable,setShowTable]=useState(false);
  if(!wbs.length)return <div className="empty"><div className="empty-ico">🧱</div>
    <div className="empty-txt">{types.length?"No WBS yet. Start with the works done to date as one WBS, then add the WBS still to come.":"Start with the concrete types (grades), then the WBS."}</div>
    <div style={{marginTop:12}}><button className="btn btn-pri" onClick={function(){onGo(types.length?"wbs":"types");}}>{types.length?"Go to WBS":"Go to Types"}</button></div></div>;
  var typeIds=typeId?[typeId]:types.map(function(t){return t.id;});
  var list=wbs.filter(function(w){return !zone||w.zone===zone;});
  var tot=conTotals(list.map(function(w){return conWbsFigures(w,realIx,typeIds);}));
  var t0=today();
  var plannedToDate=list.reduce(function(s,w){return s+conShareUpTo(conSum(w.theo,typeIds),w.start,w.finish,t0);},0);
  var ep=conEarnedPoints(cutoffs,list,pours,typeIds);
  var s=conSeries(list,pours,typeIds,ep.map(function(p){return p.date.slice(0,7);}));
  var last=ep.length?ep[ep.length-1]:null;
  var unit=CON_UNIT;
  var R={textAlign:"right"};
  var wbsZones=[...new Set(wbs.map(function(w){return w.zone;}).filter(Boolean))];
  var zoneList=[...new Set((zones||[]).concat(wbsZones))];
  // At the last cut-off with progress: per type, and the WBS whose variance is worth a look.
  var byType=[],worst=[];
  if(last){
    byType=conSortTypes(types).filter(function(t){return typeIds.indexOf(t.id)>=0;}).map(function(t){
      return{type:t,tot:conCutoffTotals(conCutoffRows(last.cutoff,list,pours,[t.id]))};
    }).filter(function(x){return x.tot.nPct>0&&(x.tot.theo>CON_EPS||x.tot.real>CON_EPS);});
    worst=conCutoffRows(last.cutoff,list,pours,typeIds).filter(function(r){return r.hasPct&&r.varPct!==null&&Math.abs(r.varPct)>CON_WARN_PCT;})
      .sort(function(a,b){return Math.abs(b.variance)-Math.abs(a.variance);}).slice(0,10);
  }
  var label=typeId?(types.find(function(t){return t.id===typeId;})||{}).name:"all types";
  return <div>
    <div className="filter-bar">
      <ConTypeFilter types={types} value={typeId} onChange={setTypeId}/>
      <ConZoneSelect zones={zoneList} value={zone} onChange={setZone} all/>
      <span style={{fontSize:12,color:"#888"}}>{list.length} WBS · {label}</span>
      <div style={{flex:1}}/>
      <button className="btn btn-sm" onClick={function(){conExportXlsx(types,list,pours,realIx,cutoffs);}}>⤓ Excel</button>
      <button className="btn btn-sm" onClick={function(){conOpenReport(types,list,pours,realIx,typeIds,label,cutoffs);}}>🖨 Report</button>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
      <InvBig label="Theoretical" value={tot.theo} unit={unit} sub={s.unscheduled>CON_EPS?conFmt(s.unscheduled)+" "+unit+" without dates":list.length+" WBS"}/>
      <InvBig label="Planned to date" value={plannedToDate} unit={unit} sub="theoretical spread over the WBS dates"/>
      <InvBig label="Poured to date" value={tot.real} unit={unit} sub="real volume (pours)"/>
      <InvBig label="Real progress (earned)" value={last?last.earned:null} unit={unit} colour={CON_COL_EARN}
        sub={last?"cut-off "+fmtDate(last.date)+" · "+(last.theoAll>0?(last.earned/last.theoAll*100).toFixed(1)+"% of budget":""):"needs a cut-off with progress % typed"}/>
      <InvBig label={"Concrete "+(last?conLossWord(last.variance):"loss / gain")} value={last?Math.abs(last.variance):null} unit={unit} colour={last?conLossCol(last.variance):null}
        sub={last?"poured "+conFmt(last.real)+" − earned "+conFmt(last.earned)+(last.varPct!==null?" ("+conPct(last.varPct)+")":"")+" · "+last.nPct+" WBS with progress":"real poured − earned, at a cut-off"}/>
      <InvBig label="Estimate at completion" value={last?last.eac+last.theoNoPct:null} unit={unit} colour={last?conVarCol(last.eacPct):null}
        sub={last?"cut-off "+fmtDate(last.date)+(last.nNoPct?" · "+last.nNoPct+" WBS without % at budget":""):"from the cut-off"}/>
    </div>
    <ConTheoEditor types={types} list={list} rawWbs={rawWbs||wbs} saveWbs={saveWbs} edit={edit} realIx={realIx} typeId={typeId}/>
    {last&&last.nNoPct>0&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>⚠ At the cut-off of {fmtDate(last.date)}, {last.nNoPct} WBS have no progress % ({conFmt(last.theoNoPct)} {unit} budget, {conFmt(last.realNoPct)} {unit} poured): they are left out of the loss / gain.</div>}
    {!last&&<div style={{fontSize:12,color:"#555",marginBottom:10}}>The loss or gain of concrete is measured only at a cut-off, against the progress % typed for each WBS. <button className="btn btn-sm" onClick={function(){onGo("cutoff");}}>Go to the cut-offs</button></div>}
    {s.months.length>0?<>
      <ConCurve s={s} theoTotal={tot.theo} earned={ep}/>
      <ConMonthly s={s}/>
      <div style={{margin:"4px 0 14px"}}><button className="btn btn-sm" onClick={function(){setShowTable(!showTable);}}>{showTable?"Hide":"Show"} the month-by-month table</button></div>
      {showTable&&<div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>Month</th><th style={R}>Planned</th><th style={R}>Poured</th><th style={R}>Cum. planned</th><th style={R}>Cum. poured</th></tr></thead>
        <tbody>{s.months.map(function(k,i){
          return <tr key={k} style={{background:i===s.nowIdx?"var(--gold-soft)":undefined}}><td><b>{conFmtMonth(k)}</b></td>
            <td style={R}>{conFmt(s.plan[i])}</td><td style={R}>{s.real[i]===null?"":conFmt(s.real[i])}</td>
            <td style={R}>{conFmt(s.cumPlan[i])}</td><td style={R}>{s.cumReal[i]===null?"":conFmt(s.cumReal[i])}</td></tr>;
        })}</tbody></table></div>}
    </>:<div style={{fontSize:12,color:"#888",marginBottom:12}}>No curve yet: give the WBS a start and a finish date, or enter pours.</div>}

    {ep.length>0&&<>
      <div className="card-title" style={{fontSize:15}}>Loss / gain of concrete, per cut-off <span style={{fontSize:12,fontWeight:400,color:"#888"}}>— progress typed by hand</span></div>
      <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>Cut-off</th><th style={R}>Budget (WBS with %)</th><th style={R}>Progress</th><th style={R}>Earned</th><th style={R}>Poured</th><th style={R}>Loss (+) / gain (−)</th><th style={R}>%</th><th style={R}>WBS without %</th></tr></thead>
        <tbody>{ep.slice().reverse().map(function(p){
          return <tr key={p.cutoff.id}><td><b>{fmtDate(p.date)}</b>{p.label?" — "+p.label:""}{p.closed?" 🔒":""}</td>
            <td style={R}>{conFmt(p.theo)}</td><td style={R}>{p.theo>0?(p.earned/p.theo*100).toFixed(1)+"%":"—"}</td>
            <td style={R}>{conFmt(p.earned)}</td><td style={R}>{conFmt(p.real)}</td>
            <td style={Object.assign({fontWeight:700,color:conLossCol(p.variance)},R)}>{(p.variance>0?"+":"")+conFmt(p.variance)}</td>
            <td style={Object.assign({color:conLossCol(p.variance)},R)}>{conPct(p.varPct)}</td>
            <td style={Object.assign({color:p.nNoPct?"#ef6c00":"#888"},R)}>{p.nNoPct?p.nNoPct+" ("+conFmt(p.realNoPct)+" poured)":"—"}</td></tr>;
        })}</tbody></table></div>
    </>}

    {byType.length>0&&<>
      <div className="card-title" style={{fontSize:15}}>Per type, at the cut-off of {fmtDate(last.date)}</div>
      <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>Type</th><th style={R}>Budget (WBS with %)</th><th style={R}>Earned</th><th style={R}>Poured</th><th style={R}>Loss (+) / gain (−)</th><th style={R}>%</th><th style={R}>RTS real</th><th style={R}>EAC</th><th style={R}>EAC − budget</th></tr></thead>
        <tbody>{byType.map(function(x){
          var t=x.tot;
          return <tr key={x.type.id}><td><b>{x.type.name}</b></td><td style={R}>{conFmt(t.theo)}</td><td style={R}>{conFmt(t.earned)}</td><td style={R}>{conFmt(t.real)}</td>
            <td style={Object.assign({fontWeight:700,color:conLossCol(t.variance)},R)}>{(t.variance>0?"+":"")+conFmt(t.variance)}</td><td style={Object.assign({color:conLossCol(t.variance)},R)}>{conPct(t.varPct)}</td>
            <td style={R}>{conFmt(t.rtsReal)}</td><td style={R}>{conFmt(t.eac)}</td><td style={Object.assign({color:conVarCol(t.eacPct)},R)}>{(t.eacVar>0?"+":"")+conFmt(t.eacVar)}</td></tr>;
        })}</tbody></table></div>
    </>}

    {(function(){
      var wIds={};list.forEach(function(w){wIds[w.id]=true;});
      var bs=conBySupplier(pours,wIds,typeIds);
      var names=Object.keys(bs).sort(function(a,b){return bs[b]._total-bs[a]._total;});
      if(!names.length||(names.length===1&&names[0]===CON_NO_SUPPLIER))return null;
      var cols=conSortTypes(types).filter(function(t){return names.some(function(n){return bs[n][t.id];});});
      var all=names.reduce(function(a,n){return a+bs[n]._total;},0);
      var allMonth=names.reduce(function(a,n){return a+bs[n]._month;},0);
      return <>
        <div className="card-title" style={{fontSize:15}}>Poured per supplier</div>
        <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
          <thead><tr><th>Supplier</th>{cols.map(function(t){return <th key={t.id} style={R}>{t.name}</th>;})}<th style={R}>Total</th><th>Share</th><th style={R}>This month</th></tr></thead>
          <tbody>{names.map(function(n){
            var pct=all>0?bs[n]._total/all*100:0;
            return <tr key={n}><td style={{color:n===CON_NO_SUPPLIER?"#888":undefined}}><b>{n}</b></td>
              {cols.map(function(t){return <td key={t.id} style={R}>{bs[n][t.id]?conFmt(bs[n][t.id]):""}</td>;})}
              <td style={Object.assign({fontWeight:700},R)}>{conFmt(bs[n]._total)}</td>
              <td><div style={{display:"flex",alignItems:"center",gap:6,minWidth:120}}><div style={{flex:1,background:"#f2f0eb",borderRadius:4,height:8}}><div style={{width:pct+"%",background:CON_COL_REAL,height:8,borderRadius:4}}/></div><span style={{fontSize:11,width:34,textAlign:"right"}}>{pct.toFixed(0)}%</span></div></td>
              <td style={R}>{bs[n]._month?conFmt(bs[n]._month):""}</td></tr>;
          })}
          <tr style={{fontWeight:700,background:"#f7f6f2"}}><td>Total</td>{cols.map(function(t){return <td key={t.id} style={R}>{conFmt(names.reduce(function(a,n){return a+(bs[n][t.id]||0);},0))}</td>;})}<td style={R}>{conFmt(all)}</td><td/><td style={R}>{conFmt(allMonth)}</td></tr>
          </tbody></table></div>
      </>;
    })()}
    {worst.length>0&&<>
      <div className="card-title" style={{fontSize:15}}>WBS to look at <span style={{fontSize:12,fontWeight:400,color:"#888"}}>— loss or gain above {CON_WARN_PCT}% at the cut-off of {fmtDate(last.date)}</span></div>
      <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>WBS</th><th style={R}>Budget</th><th style={R}>Progress</th><th style={R}>Earned</th><th style={R}>Poured</th><th style={R}>Loss (+) / gain (−)</th><th style={R}>%</th></tr></thead>
        <tbody>{worst.map(function(r){
          return <tr key={r.wbs.id}><td><b>{r.wbs.code}</b> {r.wbs.name}</td><td style={R}>{conFmt(r.theo)}</td><td style={R}>{r.pct.toFixed(0)}%</td><td style={R}>{conFmt(r.earned)}</td><td style={R}>{conFmt(r.real)}</td>
            <td style={Object.assign({fontWeight:700,color:conLossCol(r.variance)},R)}>{(r.variance>0?"+":"")+conFmt(r.variance)}</td><td style={Object.assign({color:conLossCol(r.variance)},R)}>{conPct(r.varPct)}</td></tr>;
        })}</tbody></table></div>
    </>}
    <div style={{fontSize:11,color:"#888"}}>Nothing here estimates progress. The loss or gain of concrete exists only at a cut-off: earned = budget × the progress % typed for each WBS, against the volume poured up to that date, on the WBS that have a %. Planned = theoretical spread evenly between each WBS's start and finish; poured = the pours.</div>
  </div>;
}
// Theoretical m³ per WBS and per type, typed straight in the overview (no dialog). Empty = none.
// The theoretical is never taken from an imported workbook; the WBS created by an import carry
// "Created by the import" in their note, and their theoretical can be cleared here in one go.
function ConTheoEditor({types,list,rawWbs,saveWbs,edit,realIx,typeId}){
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState("");
  var cols=conSortTypes(types).filter(function(t){
    if(typeId)return t.id===typeId;
    return !t.archived||list.some(function(w){return _invNum((w.theo||{})[t.id])>0;});
  });
  var ql=q.trim().toLowerCase();
  var rows=conSortWbs(list).filter(function(w){return !ql||[w.code,w.name].join(" ").toLowerCase().indexOf(ql)>=0;});
  var imported=rawWbs.filter(function(w){return /Created by the import/i.test(w.note||"")&&conSum(w.theo,types.map(function(t){return t.id;}))>CON_EPS;});
  function setTheo(id,tid,v){
    if(blockIfReadOnly())return;
    saveWbs(rawWbs.map(function(w){
      if(w.id!==id)return w;
      var t=Object.assign({},w.theo||{});if(v===null||!(v>0))delete t[tid];else t[tid]=v;
      return Object.assign({},w,{theo:t});
    }));
  }
  function clearImported(){
    if(blockIfReadOnly())return;
    if(!safeConfirm("Clear the theoretical m³ of the "+imported.length+" WBS created by an Excel import?\n\nTheir pours are kept; only the theoretical quantities are emptied, to be typed again in the app."))return;
    var ids={};imported.forEach(function(w){ids[w.id]=1;});
    saveWbs(rawWbs.map(function(w){return ids[w.id]?Object.assign({},w,{theo:{}}):w;}));
  }
  var R={textAlign:"right"};
  return <div className="card" style={{marginBottom:14}}>
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <button type="button" onClick={function(){setOpen(!open);}} style={{background:"none",border:"none",cursor:"pointer",fontWeight:700,fontSize:14,padding:0,fontFamily:"inherit"}}>
        {open?"▾":"▸"} Theoretical per WBS</button>
      <span style={{fontSize:12,color:"#888"}}>{rows.length} WBS · {conFmt(rows.reduce(function(s,w){return s+conSum(w.theo,cols.map(function(t){return t.id;}));},0))} {CON_UNIT}{edit?" · type the m³ in the cells, empty = none":""}</span>
      {edit&&imported.length>0&&<button className="btn btn-sm" style={{marginLeft:"auto",color:"#b3302a"}} onClick={clearImported}
        title="These WBS got their theoretical from the workbook's Theo Qty at an earlier import">✕ Clear the theoretical of {imported.length} imported WBS</button>}
    </div>
    {open&&<div style={{marginTop:10}}>
      <input type="text" placeholder="Search code, description…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:220,marginBottom:8}}/>
      <div style={{overflowX:"auto",maxHeight:"60vh",overflowY:"auto"}}><table className="tbl">
        <thead><tr><th>WBS</th>{cols.map(function(t){return <th key={t.id} style={R}>{t.name}</th>;})}<th style={R}>Total</th><th style={R}>Poured</th></tr></thead>
        <tbody>{rows.map(function(w){
          var tot=conSum(w.theo,cols.map(function(t){return t.id;}));
          return <tr key={w.id}>
            <td><b>{w.code}</b> {w.name}</td>
            {cols.map(function(t){var v=_invNum((w.theo||{})[t.id]);
              return <td key={t.id} style={R}>{edit
                ?<ConNumCell value={v||null} width={74} placeholder="—" title={"Theoretical m³ — "+t.name+" · empty = none"} onCommit={function(nv){setTheo(w.id,t.id,nv);}}/>
                :(v?conFmt(v):"—")}</td>;})}
            <td style={Object.assign({fontWeight:700},R)}>{conFmt(tot)}</td>
            <td style={Object.assign({color:"#555"},R)}>{conFmt(conSum(realIx[w.id],cols.map(function(t){return t.id;})))}</td>
          </tr>;
        })}</tbody></table></div>
    </div>}
  </div>;
}
// Cumulative curve: planned and poured month by month; real progress (earned) only as points
// at the cut-offs, where a progress % was typed. No line is drawn between cut-offs. Plain SVG.
function ConCurve({s,theoTotal,earned}){
  const [hi,setHi]=useState(null);
  earned=earned||[];
  var n=s.months.length,W=760,H=260,L=58,Rm=18,T=14,B=30;
  var max=_conNiceMax(Math.max.apply(null,s.cumPlan.concat(s.cumReal.filter(function(v){return v!==null;}),earned.map(function(p){return Math.max(p.realAll,p.realAll-p.variance);}),[theoTotal||0,1])));
  var x=function(i){return n===1?L+(W-L-Rm)/2:L+(W-L-Rm)*i/(n-1);};
  var y=function(v){return T+(H-T-B)*(1-Math.max(0,v)/max);};
  // A date inside the month grid: month index i is plotted at the end of month i.
  var step=n>1?(W-L-Rm)/(n-1):(W-L-Rm)/2;
  var xDate=function(d){
    var i=s.months.indexOf(d.slice(0,7));if(i<0)return null;
    var dt=parseISODate(d),dim=new Date(dt.getFullYear(),dt.getMonth()+1,0).getDate();
    return Math.max(L,x(i)-step+step*dt.getDate()/dim);
  };
  var ePts=earned.map(function(p){return{p:p,x:xDate(p.date)};}).filter(function(e){return e.x!==null;});
  var lastE=ePts.length?ePts[ePts.length-1]:null;
  var pts=function(arr){return arr.map(function(v,i){return v===null?null:x(i)+","+y(v);}).filter(Boolean).join(" ");};
  var every=Math.max(1,Math.ceil(n/12));
  var ni=s.nowIdx;
  var colW=n===1?(W-L-Rm):(W-L-Rm)/(n-1);
  var lastReal=-1;s.cumReal.forEach(function(v,i){if(v!==null)lastReal=i;});
  var hiCuts=hi===null?[]:ePts.filter(function(e){return e.p.date.slice(0,7)===s.months[hi];});
  return <div className="card" style={{position:"relative",marginBottom:10}}>
    <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,color:"#555",marginBottom:4}}>
      <b style={{color:"var(--ink)"}}>Cumulative quantity ({CON_UNIT})</b>
      <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_PLAN} strokeWidth="2"/></svg> Planned (theoretical)</span>
      <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_REAL} strokeWidth="2"/></svg> Poured</span>
      {ePts.length>0&&<span><svg width="12" height="10"><circle cx="6" cy="5" r="4" fill={CON_COL_EARN} stroke="#fff" strokeWidth="1.5"/></svg> Real progress at each cut-off — its gap to the poured volume is the loss / gain on the WBS with a %</span>}
      {lastE&&<span style={{fontWeight:700,color:conLossCol(lastE.p.variance)}}>Concrete {conLossWord(lastE.p.variance)} at {fmtDate(lastE.p.date)}: {lastE.p.variance>0?"+":lastE.p.variance<0?"−":""}{conFmt(Math.abs(lastE.p.variance))} {CON_UNIT}</span>}
    </div>
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",display:"block"}} onMouseLeave={function(){setHi(null);}}>
      {[0,.25,.5,.75,1].map(function(g){return <g key={g}><line x1={L} x2={W-Rm} y1={y(max*g)} y2={y(max*g)} stroke="#eee"/><text x={L-6} y={y(max*g)+3} fontSize="10" textAnchor="end" fill="#888">{invFmt(max*g,0)}</text></g>;})}
      {s.months.map(function(k,i){return i%every===0?<text key={k} x={x(i)} y={H-10} fontSize="10" textAnchor="middle" fill="#888">{conFmtMonth(k)}</text>:null;})}
      {theoTotal>0&&<g><line x1={L} x2={W-Rm} y1={y(theoTotal)} y2={y(theoTotal)} stroke="#bbb" strokeDasharray="2 3"/><text x={L+6} y={y(theoTotal)-4} fontSize="10" fill="#888">theoretical total {conFmt(theoTotal)}</text></g>}
      {ni>=0&&ni<n&&<line x1={x(ni)} x2={x(ni)} y1={T} y2={H-B} stroke="#ccc" strokeDasharray="3 3"/>}
      <polyline points={pts(s.cumPlan)} fill="none" stroke={CON_COL_PLAN} strokeWidth="2" strokeLinejoin="round"/>
      <polyline points={pts(s.cumReal)} fill="none" stroke={CON_COL_REAL} strokeWidth="2" strokeLinejoin="round"/>
      {n>0&&Math.abs(s.cumPlan[n-1]-theoTotal)>max*0.03&&<text x={x(n-1)-4} y={y(s.cumPlan[n-1])-6} fontSize="10" textAnchor="end" fill="var(--ink)">{conFmt(s.cumPlan[n-1])}</text>}
      {lastReal>=0&&<g><circle cx={x(lastReal)} cy={y(s.cumReal[lastReal])} r="4" fill={CON_COL_REAL} stroke="#fff" strokeWidth="2"/>
        <text x={x(lastReal)+6} y={y(s.cumReal[lastReal])+14} fontSize="10" fill="var(--ink)">{conFmt(s.cumReal[lastReal])}</text></g>}
      {ePts.map(function(e){
        // Drawn against the poured curve: the point sits at "poured − loss / gain", so the gap
        // between the point and the poured volume IS the loss / gain measured on the WBS with a %.
        var v=e.p.variance,yp=y(e.p.realAll),ye=y(e.p.realAll-v),big=Math.abs(ye-yp)>=18;
        return <g key={e.p.date}>
          <circle cx={e.x} cy={yp} r="3" fill={CON_COL_REAL} stroke="#fff" strokeWidth="1.5"/>
          {Math.abs(v)>CON_EPS&&<line x1={e.x} x2={e.x} y1={yp} y2={ye} stroke={conLossCol(v)} strokeWidth="3" opacity=".6"/>}
          <circle cx={e.x} cy={ye} r="4.5" fill={CON_COL_EARN} stroke="#fff" strokeWidth="2"><title>{"Cut-off "+fmtDate(e.p.date)+": on "+e.p.nPct+" WBS with a % typed, earned "+conFmt(e.p.earned)+", poured "+conFmt(e.p.real)+" → "+conLossWord(v)+" "+conFmt(Math.abs(v))}</title></circle>
          {big&&<text x={e.x-8} y={(yp+ye)/2+4} fontSize="10" textAnchor="end" fontWeight="700" fill={conLossCol(v)}>{conLossWord(v)} {v>0?"+":"−"}{conFmt(Math.abs(v))}</text>}
        </g>;
      })}
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
      <div>Poured: <b>{s.cumReal[hi]===null?"—":conFmt(s.cumReal[hi])}</b>{s.real[hi]!==null&&<span style={{color:"#888"}}> (+{conFmt(s.real[hi])} this month)</span>}</div>
      {hiCuts.map(function(e){return <div key={e.p.date} style={{borderTop:"1px solid #eee",marginTop:4,paddingTop:4}}>
        Cut-off {fmtDate(e.p.date)}: earned <b>{conFmt(e.p.earned)}</b>, poured <b>{conFmt(e.p.real)}</b>
        <div>Concrete {conLossWord(e.p.variance)}: <b style={{color:conLossCol(e.p.variance)}}>{conFmt(Math.abs(e.p.variance))}</b> <span style={{color:"#888"}}>({e.p.nPct} WBS with %)</span></div></div>;})}
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
function ConWbsList({types,wbs,wbsEff,schedIx,schedules,pours,realIx,zones,edit,saveWbs,savePours,saveTypes,cutoffs,saveCutoffs}){
  var effById={};(wbsEff||wbs).forEach(function(w){effById[w.id]=w;});
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
    return !status||f.status===status;
  });
  var tot=conTotals(list);
  // The latest cut-off: progress typed by hand there, and the loss / gain it measures.
  var lc=conLatestCutoff(cutoffs);
  var cutRows={};
  if(lc)conCutoffRows(lc,list.map(function(f){return f.wbs;}),pours,typeIds).forEach(function(r){cutRows[r.wbs.id]=r;});
  var cutTot=lc?conCutoffTotals(Object.keys(cutRows).map(function(k){return cutRows[k];})):null;
  function cutCells(r){
    if(!lc)return null;
    if(!r||!r.hasPct)return [<td key="p" style={Object.assign({color:"#bbb"},R)}>—</td>,<td key="e" style={Object.assign({color:"#bbb"},R)}>—</td>,<td key="v" style={Object.assign({color:"#bbb"},R)}>—</td>];
    return [<td key="p" style={R}>{r.pct.toFixed(0)}%</td>,<td key="e" style={R}>{conFmt(r.earned)}</td>,
      <td key="v" style={Object.assign({fontWeight:700,color:conLossCol(r.variance)},R)}>{(r.variance>0?"+":"")+conFmt(r.variance)}{r.varPct!==null&&<div style={{fontSize:10,fontWeight:400}}>{conPct(r.varPct)}</div>}</td>];
  }
  var sortedTypes=conSortTypes(types);
  // Inline edits: planned dates and theoretical m³ change in the table itself, no dialog.
  function updW(id,patch){
    if(blockIfReadOnly())return;
    saveWbs(wbs.map(function(x){return x.id===id?Object.assign({},x,patch):x;}));
  }
  function setDate(w,k,v){
    var n=Object.assign({start:w.start||"",finish:w.finish||""},{[k]:v||""});
    if(n.start&&n.finish&&n.start>n.finish){safeAlert("The start is after the finish.");return;}
    updW(w.id,{[k]:v||""});
  }
  function setTheo(w,tid,v){
    var t=Object.assign({},w.theo||{});
    if(v===null||!(v>0))delete t[tid];else t[tid]=v;
    updW(w.id,{theo:t});
  }
  // The type whose theoretical the main row edits: the filtered type, or the WBS's only type.
  function rowType(w){
    if(typeId)return typeId;
    var ks=Object.keys(w.theo||{}).filter(function(k){return _invNum(w.theo[k])>0;});
    if(ks.length===1)return ks[0];
    if(!ks.length&&types.length===1)return types[0].id;
    return "";
  }
  var dIn={padding:"3px 4px",fontSize:11.5,width:118};
  var wbsZones=[...new Set(wbs.map(function(w){return w.zone;}).filter(Boolean))];
  var R={textAlign:"right"};
  if(!types.length)return <div className="empty"><div className="empty-ico">🏷</div><div className="empty-txt">Create the concrete types first (Types tab): every quantity is entered per type.</div></div>;
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search code, description…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:200}}/>
      <ConTypeFilter types={types} value={typeId} onChange={setTypeId}/>
      <ConZoneSelect zones={[...new Set((zones||[]).concat(wbsZones))]} value={zone} onChange={setZone} all/>
      <select style={{width:"auto"}} value={status} onChange={function(e){setStatus(e.target.value);}}>
        <option value="">All statuses</option><option value="todo">Not started</option><option value="progress">In progress</option><option value="done">Complete</option>
      </select>
      {!typeId&&<button className={"fchip"+(detail?" on":"")} onClick={function(){setDetail(!detail);}}>Detail per type</button>}
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={function(){setPast(true);}} title="The works already done, as one WBS with the total theoretical and real quantities">⏮ Works to date</button>}
      {edit&&<button className="btn btn-sm" onClick={function(){setPaste(true);}}>⤓ Paste from Excel</button>}
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newConWbs());}}>+ New WBS</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🧱</div><div className="empty-txt">{wbs.length?"No WBS matches.":"No WBS yet. “Works to date” enters the past as one WBS; it can be split into detailed WBS later."}</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>WBS</th><th>Zone</th><th>Planned</th><th>Status</th><th style={R}>Theoretical</th><th style={R}>Poured</th>
        {lc&&<><th style={R} title={"Progress % typed at the cut-off of "+fmtDate(lc.date)}>Progress {fmtDate(lc.date)}</th><th style={R} title="Budget × progress %">Earned</th><th style={R} title="Poured up to the cut-off − earned: > 0 loss, < 0 gain">Loss (+) / gain (−)</th></>}<th/></tr></thead>
      <tbody>{list.map(function(f){
        var w=f.wbs;
        var rows=[<tr key={w.id} onClick={function(){setEditing(w);}} style={{cursor:"pointer"}}>
          <td title="Open the WBS (code, name, zone, schedule links)"><b>{w.code}</b> {w.name}{w.splitFrom&&<div style={{fontSize:10,color:"#888"}}>split from {w.splitFrom}</div>}</td>
          <td>{w.zone}</td>
          <td style={{fontSize:12,whiteSpace:"nowrap"}} onClick={edit?function(e){e.stopPropagation();}:undefined}>{(function(){var e=effById[w.id]||w;var n=(w.schedLinks||[]).length;
            var inl=edit&&!e._schedDates;
            return <span>{inl
              ?<span style={{display:"inline-flex",gap:3,alignItems:"center"}}>
                <input type="date" value={w.start||""} onChange={function(ev){setDate(w,"start",ev.target.value);}} style={dIn} title="Planned start"/>→
                <input type="date" value={w.finish||""} onChange={function(ev){setDate(w,"finish",ev.target.value);}} style={dIn} title="Planned finish"/>
                {(w.start||w.finish)&&<button type="button" title="Clear the planned dates" onClick={function(){updW(w.id,{start:"",finish:""});}}
                  style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:13,padding:"0 2px"}}>✕</button>}
              </span>
              :e.start||e.finish?fmtDate(e.start)+" → "+fmtDate(e.finish):<span style={{color:"#ef6c00"}}>no dates</span>}
              {n>0&&<div style={{fontSize:10,color:e._schedDates?"var(--gold-ink)":"#888"}} title={e._schedDates?"Dates from the schedule":"Linked, dates typed on the WBS"}>🗓 {n} activit{n===1?"y":"ies"}{e._schedDates?" · dates from schedule":""}</div>}</span>;})()}</td>
          <td><ConStatus f={f}/></td>
          <td style={R} onClick={edit?function(e){e.stopPropagation();}:undefined}>{(function(){
            var rt=edit?rowType(w):"";
            if(!rt)return <span title={edit?"Several types: edit them with “Detail per type”":""}>{conFmt(f.theo)}</span>;
            return <span style={{display:"inline-flex",gap:3,alignItems:"center"}}>
              <ConNumCell value={_invNum((w.theo||{})[rt])||null} width={80} placeholder="m³" title={"Theoretical m³ — "+((types.find(function(t){return t.id===rt;})||{}).name||"")+" · empty = none"} onCommit={function(v){setTheo(w,rt,v);}}/>
              {!typeId&&<span style={{fontSize:10,color:"#888"}}>{(types.find(function(t){return t.id===rt;})||{}).name}</span>}
              {_invNum((w.theo||{})[rt])>0&&<button type="button" title="Delete this theoretical quantity" onClick={function(){setTheo(w,rt,null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:13,padding:"0 2px"}}>✕</button>}
            </span>;})()}</td><td style={R}>{conFmt(f.real)}</td>
          {cutCells(cutRows[w.id])}
          <td onClick={function(e){e.stopPropagation();}}>{edit&&(conSum(w.theo,allTypeIds)>CON_EPS||conSum(realIx[w.id],allTypeIds)>CON_EPS)&&<button className="btn btn-sm" title="Split into detailed WBS" onClick={function(){setSplitting(w);}}>✂ Split</button>}</td>
        </tr>];
        if(detail&&!typeId)sortedTypes.forEach(function(t){
          var tf=conWbsFigures(w,realIx,[t.id]);
          if(!edit&&tf.theo<=CON_EPS&&tf.real<=CON_EPS)return;
          rows.push(<tr key={w.id+t.id} style={{fontSize:12,color:"#555",background:"#fbfaf7"}}>
            <td style={{paddingLeft:24}}>{t.name}</td><td/><td/><td/>
            <td style={R}>{edit?<span style={{display:"inline-flex",gap:3,alignItems:"center"}}>
              <ConNumCell value={_invNum((w.theo||{})[t.id])||null} width={80} placeholder="—" title={"Theoretical m³ — "+t.name+" · empty = none"} onCommit={function(v){setTheo(w,t.id,v);}}/>
              {_invNum((w.theo||{})[t.id])>0&&<button type="button" title="Delete this theoretical quantity" onClick={function(){setTheo(w,t.id,null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:13,padding:"0 2px"}}>✕</button>}
            </span>:conFmt(tf.theo)}</td><td style={R}>{conFmt(tf.real)}</td>
            {lc&&cutCells(conCutoffRows(lc,[w],pours,[t.id])[0])}<td/></tr>);
        });
        return rows;
      })}
      <tr style={{fontWeight:700,background:"#f7f6f2"}}><td colSpan={4}>Total — {list.length} WBS</td>
        <td style={R}>{conFmt(tot.theo)}</td><td style={R}>{conFmt(tot.real)}</td>
        {lc&&<><td style={R}>{cutTot.nPct} WBS</td><td style={R}>{conFmt(cutTot.earned)}</td><td style={Object.assign({color:conLossCol(cutTot.variance)},R)}>{cutTot.nPct?(cutTot.variance>0?"+":"")+conFmt(cutTot.variance):"—"}</td></>}<td/></tr>
      </tbody></table></div>}
    <div style={{fontSize:11,color:"#888",marginTop:8}}>Poured = the pours, a volume, not a progress. {lc?"The loss / gain comes from the cut-off of "+fmtDate(lc.date)+": earned = theoretical × the progress % typed there; a WBS without a % shows —.":"The loss / gain of concrete appears once a cut-off has progress % typed by hand."} {edit?"Planned dates and theoretical m³ are edited in the table (✕ clears them; with several types use “Detail per type”). Click the WBS name for the other fields.":"Click a WBS to see its details."}</div>
    {editing&&<ConWbsEditor w={editing} types={types} wbs={wbs} pours={pours} realIx={realIx} zones={zones} edit={edit} schedIx={schedIx} schedules={schedules}
      onSave={function(d){_invUpsert(wbs,saveWbs,d);setEditing(null);}}
      onDelete={wbs.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){
        if(pours.some(function(p){return p.wbsId===d.id;})){safeAlert("Pours are recorded on this WBS. Delete or move them first (Pours tab).");return;}
        if(_invRemove(wbs,saveWbs,d,"WBS "+conWbsLabel(d)))setEditing(null);
      }:null}
      onClose={function(){setEditing(null);}}/>}
    {splitting&&<ConSplitModal parent={splitting} types={types} wbs={wbs} pours={pours} realIx={realIx} zones={zones}
      onApply={function(res){
        var kids=res.wbs.filter(function(w){return !wbs.some(function(x){return x.id===w.id;});}).map(function(w){return w.id;});
        var gone=!res.wbs.some(function(w){return w.id===splitting.id;});
        if(cutoffs&&cutoffs.length&&saveCutoffs)saveCutoffs(conSplitCutoffs(cutoffs,splitting.id,kids,gone));
        saveWbs(res.wbs);savePours(res.pours);setSplitting(null);}}
      onClose={function(){setSplitting(null);}}/>}
    {past&&<ConPastModal types={types} wbs={wbs} pours={pours} zones={zones}
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
function ConWbsEditor({w,types,wbs,pours,realIx,zones,edit,schedIx,schedules,onSave,onDelete,onClose}){
  const [d,setD]=useState(Object.assign({},w,{theo:Object.assign({},w.theo||{})}));
  var ro=!edit;
  function set(p){setD(Object.assign({},d,p));}
  var err=conWbsError(d,wbs);
  var f=conWbsFigures(Object.assign({},d,{theo:conCleanTheo(d.theo)}),realIx,types.map(function(t){return t.id;}));
  var nPours=pours.filter(function(p){return p.wbsId===w.id;}).length;
  var sd=null;
  if(d.datesFromSched&&(d.schedLinks||[]).length){var ss=conWbsSched(d,schedIx||{},"");if(ss.start||ss.finish)sd=ss;}
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
      {sd?<div className="fg"><label>Planned (from the schedule)</label><div style={{padding:"7px 0",fontSize:13,fontWeight:600}}>{fmtDate(sd.start)} → {fmtDate(sd.finish)}</div></div>:<>
      <div className="fg"><label>Planned start</label><input type="date" disabled={ro} value={d.start||""} onChange={function(e){set({start:e.target.value});}}/></div>
      <div className="fg"><label>Planned finish</label><input type="date" disabled={ro} value={d.finish||""} onChange={function(e){set({finish:e.target.value});}}/></div></>}
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,marginBottom:12,textTransform:"none",letterSpacing:"normal",fontWeight:600}}>
        <input type="checkbox" disabled={ro} checked={!!d.done} onChange={function(){set({done:!d.done});}} style={{width:15,height:15}}/> Complete — all its concrete is poured, the variance is final
      </label>
    </div>
    <ConSchedLinks w={d} ix={schedIx||{}} edit={!ro} schedules={schedules} onChange={set}/>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"4px 0 6px"}}>Theoretical quantities per type</div>
    <ConTypeQtyInputs types={types} map={d.theo} ro={ro} realMap={realIx[w.id]||{}} onChange={function(m){set({theo:m});}}/>
    <div style={{fontSize:12,margin:"10px 0",color:"#555"}}>
      Theoretical <b>{conFmt(f.theo)}</b> · poured <b>{conFmt(f.real)}</b> {CON_UNIT} ({nPours} pour{nPours===1?"":"s"}) — the loss / gain is measured at the cut-offs
    </div>
    <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note||""} onChange={function(e){set({note:e.target.value});}}/></div>
    {err&&!ro&&<div style={{fontSize:12,color:"#c62828"}}>{err}</div>}
  </InvModal>;
}

// The past as one WBS: total theoretical, and the total real as one pour spread from start to the cut-off.
function ConPastModal({types,wbs,pours,zones,onApply,onClose}){
  // real: one block per supplier, each with m³ per type
  const [d,setD]=useState({code:"PAST",name:"Works completed to date",zone:"",start:"",cutoff:today(),done:true,theo:{},real:[{key:uuid(),supplier:"",q:{}}]});
  function set(p){setD(Object.assign({},d,p));}
  function setBlock(k,p){set({real:d.real.map(function(b){return b.key===k?Object.assign({},b,p):b;})});}
  var w=newConWbs({code:d.code.trim(),name:d.name,zone:d.zone,start:d.start,finish:d.cutoff,done:d.done,theo:conCleanTheo(d.theo)});
  var lines=[];
  d.real.forEach(function(b){var q=conCleanTheo(b.q);Object.keys(q).forEach(function(t){lines.push(newConLine({typeId:t,supplier:String(b.supplier||"").trim(),qty:q[t]}));});});
  var real=lines;
  var dupSup={},dupErr="";
  d.real.forEach(function(b){var k=String(b.supplier||"").trim().toLowerCase();if(dupSup[k])dupErr="Supplier “"+(b.supplier||"not stated")+"” is listed twice.";dupSup[k]=true;});
  var err=conWbsError(w,wbs)||(!d.cutoff?"Give the cut-off date.":"")||(!d.start?"Give the date the concrete works started: the real quantity is spread from it to the cut-off on the curve.":"")
    ||(!Object.keys(w.theo).length&&!real.length?"Enter at least one quantity.":"")||dupErr;
  function apply(){
    var pour=real.length?newConPour({date:d.cutoff,from:d.start,wbsId:w.id,ref:"Cumulative to "+fmtDate(d.cutoff),
      note:"Total poured to date, entered as one cumulative quantity",lines:real}):null;
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
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"12px 0 6px"}}>Real to date, per supplier and per type</div>
    {d.real.map(function(b){
      return <div key={b.key} style={{border:"1px solid #eee",borderRadius:8,padding:8,marginBottom:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
          <ConSupplierInput value={b.supplier} suppliers={conSupplierNames(pours)} onChange={function(v){setBlock(b.key,{supplier:v});}}/>
          {d.real.length>1&&<button className="btn btn-sm" onClick={function(){set({real:d.real.filter(function(x){return x.key!==b.key;})});}}>×</button>}
        </div>
        <ConTypeQtyInputs types={types} map={b.q} onChange={function(m){setBlock(b.key,{q:m});}}/>
      </div>;
    })}
    <button className="btn btn-sm" onClick={function(){set({real:d.real.concat([{key:uuid(),supplier:"",q:{}}])});}}>+ Supplier</button>
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
    <div style={{fontSize:12,color:"#555",marginBottom:8}}>Give each detailed WBS its share of the theoretical and real quantities. What is not allocated stays on <b>{parent.code}</b>. Real quantities are moved with their pour dates, so the totals and the curve do not change; when several suppliers fed a pour, each part keeps their share pro rata.</div>
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
  const [supplier,setSupplier]=useState("");
  const [q,setQ]=useState("");
  const [editing,setEditing]=useState(null);
  var wById={};wbs.forEach(function(w){wById[w.id]=w;});
  var tById={};types.forEach(function(t){tById[t.id]=t;});
  var ql=q.trim().toLowerCase();
  var suppliers=conSupplierNames(pours);
  // With a supplier filter, a pour shows only that supplier's lines.
  function linesOf(p){return supplier?(p.lines||[]).filter(function(l){return conSupplierOf(l)===supplier;}):(p.lines||[]);}
  var list=pours.filter(function(p){
    if(wbsId&&p.wbsId!==wbsId)return false;
    if(supplier&&!linesOf(p).length)return false;
    return !ql||[p.ref,p.note,conWbsLabel(wById[p.wbsId])].concat((p.lines||[]).map(function(l){return l.supplier||"";})).join(" ").toLowerCase().indexOf(ql)>=0;
  }).slice().sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  var allIds=types.map(function(t){return t.id;});
  var total=list.reduce(function(s,p){return s+conPourQty({lines:linesOf(p)},allIds);},0);
  if(!wbs.length)return <div className="empty"><div className="empty-ico">🚚</div><div className="empty-txt">Create the WBS first: every pour is booked on a WBS.</div></div>;
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search reference, supplier, note…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:200}}/>
      <select value={wbsId} onChange={function(e){setWbsId(e.target.value);}} style={{width:"auto",maxWidth:280}}><option value="">All WBS</option>{conSortWbs(wbs).map(function(w){return <option key={w.id} value={w.id}>{conWbsLabel(w)}</option>;})}</select>
      {suppliers.length>0&&<select value={supplier} onChange={function(e){setSupplier(e.target.value);}} style={{width:"auto",maxWidth:240}}><option value="">All suppliers</option>
        {suppliers.concat(pours.some(function(p){return(p.lines||[]).some(function(l){return !String(l.supplier||"").trim();});})?[CON_NO_SUPPLIER]:[]).map(function(n){return <option key={n} value={n}>{n}</option>;})}</select>}
      <span style={{fontSize:12,color:"#888"}}>{list.length} pour{list.length===1?"":"s"} · {conFmt(total)} {CON_UNIT}</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newConPour({wbsId:wbsId,lines:[newConLine({supplier:supplier&&supplier!==CON_NO_SUPPLIER?supplier:""})]}));}}>+ New pour</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🚚</div><div className="empty-txt">No pour recorded{wbsId?" on this WBS":""}.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Date</th><th>WBS</th><th>Reference</th><th>Type · supplier</th><th style={{textAlign:"right"}}>Total</th><th>Note</th></tr></thead>
      <tbody>{list.map(function(p){
        return <tr key={p.id} onClick={function(){setEditing(p);}} style={{cursor:"pointer"}}>
          <td style={{whiteSpace:"nowrap"}}>{p.from?<span>{fmtDate(p.from)} → </span>:null}<b>{fmtDate(p.date)}</b>{p.from&&<div style={{fontSize:10,color:"#888"}}>cumulative</div>}</td>
          <td>{wById[p.wbsId]?<span><b>{wById[p.wbsId].code}</b> {wById[p.wbsId].name}</span>:<span style={{color:"#c62828"}}>(deleted WBS)</span>}</td>
          <td>{p.ref}</td>
          <td style={{fontSize:12}}>{linesOf(p).map(function(l){return <div key={l.id}>{tById[l.typeId]?tById[l.typeId].name:"?"} <b>{conFmt(_invNum(l.qty))}</b> <span style={{color:l.supplier?"#555":"#aaa"}}>· {l.supplier||"no supplier"}</span></div>;})}</td>
          <td style={{textAlign:"right",fontWeight:700}}>{conFmt(conPourQty({lines:linesOf(p)},allIds))}</td>
          <td style={{fontSize:12,color:"#555"}}>{p.note}</td>
        </tr>;
      })}</tbody></table></div>}
    {editing&&<ConPourEditor p={editing} types={types} wbs={wbs} edit={edit} suppliers={suppliers} isNew={!pours.some(function(x){return x.id===editing.id;})}
      onSave={function(d){_invUpsert(pours,savePours,d);setEditing(null);}}
      onSaveNext={function(d){_invUpsert(pours,savePours,d);setEditing(newConPour({date:d.date,wbsId:d.wbsId,lines:[newConLine({typeId:(d.lines[0]||{}).typeId||"",supplier:(d.lines[0]||{}).supplier||""})]}));}}
      onDelete={pours.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){if(_invRemove(pours,savePours,d,"this pour"))setEditing(null);}:null}
      onClose={function(){setEditing(null);}}/>}
  </div>;
}
function ConPourEditor({p,types,wbs,edit,isNew,suppliers,onSave,onSaveNext,onDelete,onClose}){
  const [d,setD]=useState(Object.assign({},p,{lines:(p.lines||[]).slice()}));
  const [spread,setSpread]=useState(!!p.from);
  var ro=!edit;
  function set(x){setD(Object.assign({},d,x));}
  function setLine(id,x){set({lines:d.lines.map(function(l){return l.id===id?Object.assign({},l,x):l;})});}
  var dup={};d.lines.forEach(function(l){if(l.typeId){var k=l.typeId+"|"+String(l.supplier||"").trim().toLowerCase();dup[k]=(dup[k]||0)+1;}});
  var err=!d.date||!isValidDate(d.date)?"Give the pour date.":!d.wbsId?"Choose the WBS.":
    spread&&(!d.from||!isValidDate(d.from))?"Give the start of the period.":spread&&d.from>d.date?"The period starts after it ends.":
    !d.lines.length||!d.lines.every(function(l){return l.typeId&&_invNum(l.qty)>0;})?"Every line needs a type and a quantity above zero.":
    Object.keys(dup).some(function(k){return dup[k]>1;})?"The same type and supplier are listed twice.":"";
  function clean(){return Object.assign({},d,{from:spread?d.from:"",lines:d.lines.map(function(l){return{id:l.id,typeId:l.typeId,supplier:String(l.supplier||"").trim(),qty:_invNum(l.qty)};}),
    updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""});}
  var w=wbs.find(function(x){return x.id===d.wbsId;});
  return <InvModal title={isNew?"🚚 New pour":"🚚 Pour "+(d.ref||fmtDate(d.date))} width={760} onClose={onClose} footer={<>
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
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"6px 0"}}>Quantities <span style={{textTransform:"none",fontWeight:400}}>— one line per type and supplier</span></div>
    {d.lines.map(function(l){
      return <div key={l.id} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:6,padding:"6px 8px",background:"#fafafa",borderRadius:8}}>
        <select disabled={ro} value={l.typeId} onChange={function(e){setLine(l.id,{typeId:e.target.value});}} style={{flex:"1 1 180px"}}>
          <option value="">— type —</option>{conSortTypes(types).filter(function(t){return !t.archived||t.id===l.typeId;}).map(function(t){return <option key={t.id} value={t.id}>{t.name}{w&&_invNum((w.theo||{})[t.id])?" · theor. "+conFmt(w.theo[t.id]):""}</option>;})}
        </select>
        <ConSupplierInput disabled={ro} value={l.supplier} suppliers={suppliers} onChange={function(v){setLine(l.id,{supplier:v});}}/>
        <InvQtyInput disabled={ro} value={l.qty} onChange={function(v){setLine(l.id,{qty:v});}}/> <span style={{fontSize:12}}>{CON_UNIT}</span>
        {!ro&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){set({lines:d.lines.filter(function(x){return x.id!==l.id;})});}}>×</button>}
      </div>;
    })}
    {!ro&&<button className="btn btn-sm" onClick={function(){var last=d.lines[d.lines.length-1]||{};set({lines:d.lines.concat([newConLine({supplier:last.supplier||""})])});}}>+ Line</button>}
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
function conOpenReport(types,list,pours,realIx,typeIds,label,cutoffs){
  var E=esc,t0=today();
  var figs=conSortWbs(list).map(function(w){return conWbsFigures(w,realIx,typeIds);});
  var tot=conTotals(figs);
  var s=conSeries(list,pours,typeIds);
  var plannedToDate=list.reduce(function(a,w){return a+conShareUpTo(conSum(w.theo,typeIds),w.start,w.finish,t0);},0);
  var td=function(v,b,c){return'<td style="text-align:right;'+(b?"font-weight:700;":"")+(c?"color:"+c+";":"")+'">'+v+"</td>";};
  var sg=function(v){return(v>0?"+":"")+conFmt(v);};
  var ep=conEarnedPoints(cutoffs,list,pours,typeIds);
  var last=ep.length?ep[ep.length-1]:null;
  var eRows=ep.map(function(p){return"<tr><td>"+E(fmtDate(p.date))+(p.label?" — "+E(p.label):"")+(p.closed?" 🔒":"")+"</td>"+td(conFmt(p.theo))+td(p.theo>0?(p.earned/p.theo*100).toFixed(1)+"%":"—")+td(conFmt(p.earned))+td(conFmt(p.real))
    +td(sg(p.variance)+" ("+conLossWord(p.variance)+")",true,conLossCol(p.variance))+td(conPct(p.varPct))+td(p.nNoPct?p.nNoPct+" WBS":"—")+"</tr>";}).join("");
  var byType="",cut={};
  if(last){
    byType=conSortTypes(types).filter(function(t){return typeIds.indexOf(t.id)>=0;}).map(function(t){
      var tt=conCutoffTotals(conCutoffRows(last.cutoff,list,pours,[t.id]));
      if(!tt.nPct||(tt.theo<=CON_EPS&&tt.real<=CON_EPS))return"";
      return"<tr><td><b>"+E(t.name)+"</b></td>"+td(conFmt(tt.theo))+td(conFmt(tt.earned))+td(conFmt(tt.real))+td(sg(tt.variance),true,conLossCol(tt.variance))+td(conPct(tt.varPct))+td(conFmt(tt.rtsReal))+td(conFmt(tt.eac))+td(sg(tt.eacVar))+"</tr>";
    }).join("");
    conCutoffRows(last.cutoff,list,pours,typeIds).forEach(function(r){cut[r.wbs.id]=r;});
  }
  var wRows=figs.map(function(f){
    var st={done:"complete",progress:"in progress",todo:"not started"}[f.status],r=cut[f.wbs.id];
    return"<tr><td><b>"+E(f.wbs.code)+"</b> "+E(f.wbs.name)+"</td><td>"+E(f.wbs.zone||"")+"</td><td>"+E(f.wbs.start||f.wbs.finish?fmtDate(f.wbs.start)+" → "+fmtDate(f.wbs.finish):"")+"</td><td>"+st+"</td>"
      +td(conFmt(f.theo))+td(conFmt(f.real))
      +(last?(r&&r.hasPct?td(r.pct.toFixed(0)+"%")+td(conFmt(r.earned))+td(sg(r.variance),true,conLossCol(r.variance)):td("—")+td("—")+td("—")):"")+"</tr>";
  }).join("");
  var wIds={};list.forEach(function(w){wIds[w.id]=true;});
  var bs=conBySupplier(pours,wIds,typeIds);
  var sNames=Object.keys(bs).sort(function(a,b){return bs[b]._total-bs[a]._total;});
  var sAll=sNames.reduce(function(a,n){return a+bs[n]._total;},0);
  var sCols=conSortTypes(types).filter(function(t){return sNames.some(function(n){return bs[n][t.id];});});
  var sRows=sNames.map(function(n){return"<tr><td><b>"+E(n)+"</b></td>"+sCols.map(function(t){return td(bs[n][t.id]?conFmt(bs[n][t.id]):"");}).join("")+td(conFmt(bs[n]._total),true)+td(sAll>0?(bs[n]._total/sAll*100).toFixed(0)+"%":"")+td(bs[n]._month?conFmt(bs[n]._month):"")+"</tr>";}).join("");
  var nowK=t0.slice(0,7);
  var mRows=s.months.filter(function(k){return k>=nowK;}).slice(0,12).map(function(k){var i=s.months.indexOf(k);return"<tr><td>"+conFmtMonth(k)+"</td>"+td(conFmt(s.plan[i]))+td(conFmt(s.cumPlan[i]))+"</tr>";}).join("");
  var html="<h1>Concrete — theoretical vs real</h1><div class=\"sub\">Riviera Tower · "+E(label)+" · situation at "+E(fmtDate(t0))+"</div>"
    +"<h2>Summary ("+CON_UNIT+")</h2><table><tr><th>Theoretical</th><th>Planned to date</th><th>Poured to date</th>"+(last?"<th>Earned at "+E(fmtDate(last.date))+"</th><th>Loss (+) / gain (−)</th><th>EAC</th>":"")+"</tr><tr>"
    +td(conFmt(tot.theo))+td(conFmt(plannedToDate))+td(conFmt(tot.real))
    +(last?td(conFmt(last.earned))+td(sg(last.variance)+" ("+conPct(last.varPct)+")",true,conLossCol(last.variance))+td(conFmt(last.eac+last.theoNoPct)):"")+"</tr></table>"
    +(last&&last.nNoPct?"<div style=\"font-size:11px;color:#b45309\">"+last.nNoPct+" WBS without progress % at that cut-off ("+conFmt(last.theoNoPct)+" budget, "+conFmt(last.realNoPct)+" poured) are left out of the loss / gain; they count at budget in the EAC.</div>":"")
    +(eRows?"<h2>Loss / gain of concrete, per cut-off</h2><table><tr><th>Cut-off</th><th>Budget (WBS with %)</th><th>Progress</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−)</th><th>%</th><th>Without %</th></tr>"+eRows+"</table>"
      :"<h2>Loss / gain of concrete</h2><div>No cut-off with a progress % typed yet: the loss or gain is measured only at a cut-off.</div>")
    +(byType?"<h2>Per type, at the cut-off of "+E(fmtDate(last.date))+"</h2><table><tr><th>Type</th><th>Budget (WBS with %)</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−)</th><th>%</th><th>RTS real</th><th>EAC</th><th>EAC − budget</th></tr>"+byType+"</table>":"")
    +(sRows?"<h2>Poured per supplier</h2><table><tr><th>Supplier</th>"+sCols.map(function(t){return"<th>"+E(t.name)+"</th>";}).join("")+"<th>Total</th><th>Share</th><th>This month</th></tr>"+sRows+"</table>":"")
    +(mRows?"<h2>Planned quantities, coming months</h2><table><tr><th>Month</th><th>Planned</th><th>Cumulative planned</th></tr>"+mRows+"</table>":"")
    +"<h2>Per WBS</h2><table><tr><th>WBS</th><th>Zone</th><th>Planned</th><th>Status</th><th>Theoretical</th><th>Poured</th>"+(last?"<th>Progress "+E(fmtDate(last.date))+"</th><th>Earned</th><th>Loss (+) / gain (−)</th>":"")+"</tr>"+wRows+"</table>"
    +"<div style=\"font-size:10px;color:#8b8578\">No progress is estimated: the loss or gain = poured up to the cut-off − earned (budget × the progress % typed by hand), on the WBS that have a %. Poured = the pours, a volume.</div>";
  openReport("CONCRETE - "+t0,html);
}
function conExportXlsx(types,list,pours,realIx,cutoffs){
  if(!window.XLSX||!window.XLSX.utils||!window.XLSX.writeFile){safeAlert("The Excel library is not loaded.");return;}
  var st=conSortTypes(types),allIds=types.map(function(t){return t.id;});
  var r2=function(v){return Math.round(v*100)/100;};
  var lc=conLatestCutoff(cutoffs),cut={};
  if(lc)conCutoffRows(lc,list,pours,allIds).forEach(function(r){cut[r.wbs.id]=r;});
  var rows=conSortWbs(list).map(function(w){
    var f=conWbsFigures(w,realIx,allIds);
    var o={"Code":w.code,"Description":w.name,"Zone":w.zone,"Start":w.start,"Finish":w.finish,"Complete":w.done?"Y":"","Split from":w.splitFrom||""};
    st.forEach(function(t){
      var tf=conWbsFigures(w,realIx,[t.id]);
      o[t.name+" theor."]=r2(tf.theo);o[t.name+" poured"]=r2(tf.real);
    });
    o["Total theor."]=r2(f.theo);o["Total poured"]=r2(f.real);
    if(lc){var r=cut[w.id];var k=" @"+lc.date;
      o["Progress %"+k]=r&&r.hasPct?r.pct:"";o["Earned"+k]=r&&r.hasPct?r2(r.earned):"";o["Loss(+)/gain(-)"+k]=r&&r.hasPct?r2(r.variance):"";}
    return o;
  });
  var inList={};list.forEach(function(w){inList[w.id]=w;});
  var tById={};types.forEach(function(t){tById[t.id]=t;});
  var pr=[];
  pours.forEach(function(p){if(!inList[p.wbsId])return;(p.lines||[]).forEach(function(l){
    pr.push({"Date":p.date,"From (cumulative)":p.from||"","WBS":inList[p.wbsId].code,"Reference":p.ref,"Type":tById[l.typeId]?tById[l.typeId].name:"","Supplier":l.supplier||"","m³":_invNum(l.qty),"Note":p.note||""});
  });});
  pr.sort(function(a,b){return a.Date<b.Date?-1:1;});
  var bs=conBySupplier(pours,inList,allIds);
  var sr=Object.keys(bs).sort().map(function(n){var o={"Supplier":n};st.forEach(function(t){if(bs[n][t.id])o[t.name]=r2(bs[n][t.id]);});o["Total"]=r2(bs[n]._total);return o;});
  var s=conSeries(list,pours,allIds);
  var mr=s.months.map(function(k,i){return{"Month":k,"Planned":r2(s.plan[i]),"Poured":s.real[i]===null?"":r2(s.real[i]),"Cum. planned":r2(s.cumPlan[i]),"Cum. poured":s.cumReal[i]===null?"":r2(s.cumReal[i])};});
  var cr=conEarnedPoints(cutoffs,list,pours,allIds).map(function(p){return{"Cut-off":p.date,"Label":p.label,"Closed":p.closed?"Y":"","Budget (WBS with %)":r2(p.theo),"Earned":r2(p.earned),"Poured":r2(p.real),"Loss(+)/gain(-)":r2(p.variance),"%":p.varPct===null?"":r2(p.varPct),"WBS without %":p.nNoPct};});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(rows),"WBS");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(cr),"Cut-offs");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(pr),"Pours");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(sr),"Suppliers");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(mr),"Monthly");
  window.XLSX.writeFile(wb,"Concrete "+today()+".xlsx");
}

// ---------------------------------------------------------------- cut-off cost control
// A cut-off is a dated situation. Each WBS gets a physical progress %, which unlocks budget:
//   earned (budget unlocked)  = theoretical × progress %
//   real at cut-off           = pours up to the cut-off date (a cumulative pour counts pro rata)
//   loss / gain               = real − earned          (> 0: concrete lost, < 0: gained)
// The progress % is ONLY typed by hand: never carried over, copied from the schedule or deduced
// from the volumes. A WBS without a % is left out of the loss / gain, RTS and EAC.
//   remain to be spent, theo. = theoretical − earned
//   remain to be spent, real  = RTS theo., unless adjusted by hand (per type)
//   estimate at completion    = real at cut-off + RTS real;  EAC variance = EAC − theoretical
// Stored in pp_concrete_cutoffs: [{id, date, label, closed, lines:[{id: wbsId, pct, rts:{typeId: m³}, note}],
//   reported: totals per type frozen when the cut-off is closed}]. The lines are a list of items
// with ids, so two people entering progress on different WBS of the same cut-off both keep it.
function newConCutoff(o){return Object.assign({id:uuid(),date:today(),label:"",closed:false,lines:[],note:""},_conStamp(),o||{});}
function conCutoffLine(c,wbsId){return(c.lines||[]).find(function(l){return l.id===wbsId;})||null;}
function conClampPct(v){var n=_invNum(v);return Math.max(0,Math.min(100,n));}
// The cut-off before this one (by date), to show what moved in the period.
function conPrevCutoff(cutoffs,c){
  var prev=null;
  (cutoffs||[]).forEach(function(x){if(x.id!==c.id&&x.date<c.date&&(!prev||x.date>prev.date))prev=x;});
  return prev;
}
// Real m³ per WBS and per type poured on or before date: {wbsId: {typeId: m³}}
function conRealAt(pours,date){
  var ix={};
  (pours||[]).forEach(function(p){
    if(!ix[p.wbsId])ix[p.wbsId]={};
    (p.lines||[]).forEach(function(l){
      var q=conShareUpTo(_invNum(l.qty),p.from||p.date,p.date,date);
      if(q)ix[p.wbsId][l.typeId]=(ix[p.wbsId][l.typeId]||0)+q;
    });
  });
  return ix;
}
// One row per WBS with figures for the given types.
function conCutoffRows(c,wbs,pours,typeIds){
  var realAt=conRealAt(pours,c.date);
  return conSortWbs(wbs).map(function(w){
    var ln=conCutoffLine(c,w.id)||{};
    var has=_invHas(ln.pct),pct=has?conClampPct(ln.pct):0;
    var r={wbs:w,line:ln,hasPct:has,pct:pct,theo:0,earned:0,real:0,rtsTheo:0,rtsReal:0,adjusted:false,byType:{}};
    typeIds.forEach(function(t){
      var th=_invNum((w.theo||{})[t]),re=_invNum((realAt[w.id]||{})[t]);
      var ea=th*pct/100,rt=th-ea;
      var adj=!!(ln.rts&&_invHas(ln.rts[t]));
      var rr=adj?_invNum(ln.rts[t]):rt;
      r.byType[t]={theo:th,earned:ea,real:re,rtsTheo:rt,rtsReal:rr,adjusted:adj};
      r.theo+=th;r.earned+=ea;r.real+=re;r.rtsTheo+=rt;r.rtsReal+=rr;if(adj)r.adjusted=true;
    });
    // Without a progress % typed by hand nothing is measured: no earned, no loss / gain, no EAC.
    r.variance=has?r.real-r.earned:null;
    r.varPct=has&&r.earned>CON_EPS?r.variance/r.earned*100:null;
    r.eac=has?r.real+r.rtsReal:null;
    r.eacVar=has?r.eac-r.theo:null;
    r.eacPct=has&&r.theo>CON_EPS?r.eacVar/r.theo*100:null;
    r.realPct=r.theo>CON_EPS?r.real/r.theo*100:null;   // volume ratio, for reference only
    return r;
  }).filter(function(r){return r.theo>CON_EPS||r.real>CON_EPS||r.hasPct;});
}
// Totals. theoAll / realAll cover every WBS; the measured figures (earned, real, loss / gain,
// remain to be spent, EAC) cover only the WBS with a progress %.
// Totals. theoAll / realAll cover every WBS; the measured figures (earned, real, loss / gain,
// remain to be spent, EAC) cover only the WBS with a progress %.
function conCutoffTotals(rows){
  var t={theoAll:0,realAll:0,theo:0,earned:0,real:0,rtsTheo:0,rtsReal:0,eac:0,n:rows.length,nPct:0,nNoPct:0,theoNoPct:0,realNoPct:0,nAdj:0};
  rows.forEach(function(r){
    t.theoAll+=r.theo;t.realAll+=r.real;
    if(!r.hasPct){
      if(r.theo>CON_EPS||r.real>CON_EPS){t.nNoPct++;t.theoNoPct+=r.theo;t.realNoPct+=r.real;}
      return;
    }
    t.nPct++;
    t.theo+=r.theo;t.earned+=r.earned;t.real+=r.real;t.rtsTheo+=r.rtsTheo;t.rtsReal+=r.rtsReal;t.eac+=r.eac;
    if(r.adjusted)t.nAdj++;
  });
  t.pct=t.theoAll>CON_EPS?t.earned/t.theoAll*100:null;
  t.variance=t.real-t.earned;
  t.varPct=t.earned>CON_EPS?t.variance/t.earned*100:null;
  t.eacVar=t.eac-t.theo;
  t.eacPct=t.theo>CON_EPS?t.eacVar/t.theo*100:null;
  return t;
}
function conVarCol(pct){return pct===null||pct===undefined?undefined:pct>CON_WARN_PCT?"#c62828":pct<-CON_WARN_PCT?"#2e7d32":undefined;}
// Remaining real m³ entered as one total for a WBS: shared over the types in proportion to
// their remaining theoretical (or their theoretical when nothing remains).
function conSplitRts(row,typeIds,total){
  var w=typeIds.map(function(t){return row.byType[t].rtsTheo;});
  var sw=w.reduce(function(a,b){return a+b;},0);
  if(sw<=CON_EPS){w=typeIds.map(function(t){return row.byType[t].theo;});sw=w.reduce(function(a,b){return a+b;},0);}
  if(sw<=CON_EPS){w=typeIds.map(function(_,i){return i===0?1:0;});sw=1;}
  var out={},acc=0;
  typeIds.forEach(function(t,i){
    var v=i===typeIds.length-1?total-acc:Math.round(total*w[i]/sw*1000)/1000;
    acc+=v;out[t]=v;
  });
  return out;
}

// A number typed in a table cell, saved when the cell is left (not on every keystroke).
function ConNumCell({value,onCommit,disabled,width,placeholder,highlight,title}){
  const [txt,setTxt]=useState(_invHas(value)?String(Math.round(_invNum(value)*1000)/1000):"");
  const [focus,setFocus]=useState(false);
  var shown=focus?txt:(_invHas(value)?String(Math.round(_invNum(value)*1000)/1000):"");
  function commit(){
    setFocus(false);
    var s=txt.trim().replace(",",".");
    var cur=_invHas(value)?_invNum(value):null;
    var nv=s===""?null:Number(s);
    if(nv!==null&&!isFinite(nv))return;
    if(nv===cur)return;
    onCommit(nv);
  }
  return <input type="text" inputMode="decimal" disabled={disabled} value={shown} placeholder={placeholder} title={title}
    onFocus={function(){setTxt(_invHas(value)?String(Math.round(_invNum(value)*1000)/1000):"");setFocus(true);}}
    onChange={function(e){setTxt(e.target.value);}} onBlur={commit}
    onKeyDown={function(e){if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setTxt(_invHas(value)?String(value):"");e.target.blur();}}}
    style={{width:width||70,textAlign:"right",fontVariantNumeric:"tabular-nums",padding:"4px 6px",background:highlight?"var(--gold-soft)":undefined,fontWeight:highlight?700:undefined}}/>;
}

function ConCutoff({types,wbs,pours,cutoffs,saveCutoffs,zones,edit,schedIx}){
  cutoffs=cutoffs||[];
  var sorted=cutoffs.slice().sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  const [curId,setCurId]=useState(sorted[0]?sorted[0].id:"");
  const [typeId,setTypeId]=useState("");
  const [zone,setZone]=useState("");
  const [q,setQ]=useState("");
  const [creating,setCreating]=useState(false);
  var cur=cutoffs.find(function(c){return c.id===curId;})||sorted[0]||null;
  var isAdmin=isAppAdmin(window._currentUser&&window._currentUser.name);
  if(!types.length||!wbs.length)return <div className="empty"><div className="empty-ico">💰</div><div className="empty-txt">Create the types and the WBS first.</div></div>;
  var newBtn=edit&&<button className="btn btn-pri btn-sm" onClick={function(){setCreating(true);}}>+ New cut-off</button>;
  var creator=creating&&<ConCutoffNew cutoffs={cutoffs} wbs={wbs} onClose={function(){setCreating(false);}}
    onCreate={function(c){saveCutoffs([c].concat(cutoffs));setCurId(c.id);setCreating(false);}}/>;
  if(!cur)return <div>
    <div className="empty"><div className="empty-ico">💰</div><div className="empty-txt">No cut-off yet. A cut-off is a dated situation: give each WBS its physical progress %, which unlocks the budget (theoretical × %) to compare with the concrete really poured, and set the remain to be spent.</div>
      <div style={{marginTop:12}}>{newBtn}</div></div>
    {creator}
  </div>;
  var allIds=types.map(function(t){return t.id;});
  var typeIds=typeId?[typeId]:allIds;
  var ro=!edit||cur.closed;
  var ql=q.trim().toLowerCase();
  var rows=conCutoffRows(cur,wbs.filter(function(w){
    if(zone&&w.zone!==zone)return false;
    return !ql||[w.code,w.name].join(" ").toLowerCase().indexOf(ql)>=0;
  }),pours,typeIds);
  var tot=conCutoffTotals(rows);
  var prev=conPrevCutoff(cutoffs,cur);
  var prevTot=prev?conCutoffTotals(conCutoffRows(prev,wbs.filter(function(w){return !zone||w.zone===zone;}),pours,typeIds)):null;
  var wbsZones=[...new Set(wbs.map(function(w){return w.zone;}).filter(Boolean))];
  var R={textAlign:"right"};

  function setCur(patch){saveCutoffs(cutoffs.map(function(c){return c.id===cur.id?Object.assign({},c,patch):c;}));}
  function setLine(wbsId,patch){
    var lines=(cur.lines||[]).slice(),i=lines.findIndex(function(l){return l.id===wbsId;});
    var ln=Object.assign({id:wbsId},i>=0?lines[i]:{},patch,{updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""});
    if(i>=0)lines[i]=ln;else lines.push(ln);
    setCur({lines:lines});
  }
  // Progress is only ever typed by hand.
  function commitPct(r,v){
    var w=r.wbs;
    if(v!==null&&(v<0||v>100)){safeAlert("Progress is a percentage between 0 and 100.");return;}
    var patch={pct:v===null?undefined:v,pctFrom:undefined};
    // At 100% nothing remains to be spent: an adjustment of the remain would be stale.
    if(v===100&&r.line.rts)patch.rts=undefined;
    setLine(w.id,patch);
  }
  function commitRts(r,v){
    var rts=Object.assign({},r.line.rts||{});
    if(v===null){typeIds.forEach(function(t){delete rts[t];});}
    else if(v<0){safeAlert("The remain to be spent cannot be negative.");return;}
    else if(typeIds.length===1)rts[typeIds[0]]=v;
    else{
      // only the types this WBS uses
      var used=typeIds.filter(function(t){return r.byType[t].theo>CON_EPS||r.byType[t].real>CON_EPS;});
      if(!used.length)used=[typeIds[0]];
      var sp=conSplitRts(r,used,v);
      typeIds.forEach(function(t){delete rts[t];});
      Object.keys(sp).forEach(function(t){rts[t]=sp[t];});
    }
    setLine(r.wbs.id,{rts:Object.keys(rts).length?rts:undefined});
  }
  // Progress of the linked schedule activities at the cut-off date: for reference only, never copied.
  var schedPct={};
  rows.forEach(function(r){if((r.wbs.schedLinks||[]).length){var s=conWbsSched(r.wbs,schedIx||{},cur.date);if(s.pct!==null)schedPct[r.wbs.id]=s.pct;}});
  function close(){
    if(tot.nNoPct&&!confirm(tot.nNoPct+" WBS have no progress %: they stay out of the loss / gain. Close the cut-off anyway?"))return;
    var all=conCutoffRows(cur,wbs,pours,allIds),rep={};
    allIds.forEach(function(t){
      var x={theo:0,earned:0,real:0,rtsReal:0};
      all.forEach(function(r){if(!r.hasPct)return;var b=r.byType[t];x.theo+=b.theo;x.earned+=b.earned;x.real+=b.real;x.rtsReal+=b.rtsReal;});
      if(x.theo>CON_EPS||x.real>CON_EPS)rep[t]=x;
    });
    setCur({closed:true,closedAt:new Date().toISOString(),closedBy:window._currentUser?window._currentUser.name:"",reported:rep});
  }
  function reopen(){if(confirm("Reopen this cut-off? The progress and the remain to be spent become editable again; the figures frozen at closing are dropped."))setCur({closed:false,reported:undefined,closedAt:undefined,closedBy:undefined});}
  function del(){
    if(!confirm("Delete the cut-off of "+fmtDate(cur.date)+" with all its progress figures? There is no undo."))return;
    saveCutoffs(cutoffs.filter(function(c){return c.id!==cur.id;}));setCurId("");
  }
  // What was frozen at closing, against today's recalculation (a pour or a theoretical changed since).
  var drift=null;
  if(cur.closed&&cur.reported){
    var rp={theo:0,earned:0,real:0};
    typeIds.forEach(function(t){var x=cur.reported[t];if(x){rp.theo+=x.theo;rp.earned+=x.earned;rp.real+=x.real;}});
    if(!zone&&!ql&&(Math.abs(rp.theo-tot.theo)>0.5||Math.abs(rp.earned-tot.earned)>0.5||Math.abs(rp.real-tot.real)>0.5))drift=rp;
  }
  var label=typeId?(types.find(function(t){return t.id===typeId;})||{}).name:"all types";
  return <div>
    <div className="filter-bar">
      <select value={cur.id} onChange={function(e){setCurId(e.target.value);}} style={{width:"auto",fontWeight:700}}>
        {sorted.map(function(c){return <option key={c.id} value={c.id}>{fmtDate(c.date)}{c.label?" — "+c.label:""}{c.closed?" 🔒":""}</option>;})}
      </select>
      {cur.closed?<span className="pill" style={{background:"#eceae3",color:"#555"}}>🔒 closed{cur.closedBy?" by "+cur.closedBy:""}{cur.closedAt?" "+fmtDate(cur.closedAt.slice(0,10)):""}</span>
        :<span className="pill" style={{background:"#e8f0fe",color:"#1a73e8"}}>open</span>}
      <ConTypeFilter types={types} value={typeId} onChange={setTypeId}/>
      <ConZoneSelect zones={[...new Set((zones||[]).concat(wbsZones))]} value={zone} onChange={setZone} all/>
      <input type="text" placeholder="Search WBS…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:150}}/>
      <div style={{flex:1}}/>
      <button className="btn btn-sm" onClick={function(){conCutoffXlsx(cur,types,wbs,pours);}}>⤓ Excel</button>
      <button className="btn btn-sm" onClick={function(){conCutoffReport(cur,prev,rows,tot,prevTot,label);}}>🖨 Report</button>
      {edit&&!cur.closed&&<button className="btn btn-sm" onClick={close} title="Freeze the progress and the remain to be spent of this cut-off">🔒 Close</button>}
      {cur.closed&&isAdmin&&!window._ppReadOnly&&<button className="btn btn-sm" onClick={reopen}>Reopen</button>}
      {edit&&invCanDelete()&&<button className="btn btn-sm" style={{color:"#c62828"}} onClick={del}>Delete</button>}
      {newBtn}
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
      <InvBig label="Budget (theoretical)" value={tot.theoAll} unit={CON_UNIT} sub={rows.length+" WBS · "+label}/>
      <InvBig label="Budget unlocked (earned)" value={tot.earned} unit={CON_UNIT} sub={(tot.pct===null?"":tot.pct.toFixed(1)+"% of the budget")+(prevTot?" · +"+conFmt(tot.earned-prevTot.earned)+" since "+fmtDate(prev.date):"")}/>
      <InvBig label="Poured at cut-off" value={tot.realAll} unit={CON_UNIT} sub={"to "+fmtDate(cur.date)+(prevTot?" · +"+conFmt(tot.realAll-prevTot.realAll)+" in the period":"")}/>
      <InvBig label={"Concrete "+(tot.nPct?conLossWord(tot.variance):"loss / gain")} value={tot.nPct?Math.abs(tot.variance):null} unit={CON_UNIT} colour={tot.nPct?conLossCol(tot.variance):null}
        sub={tot.nPct?"poured "+conFmt(tot.real)+" − earned "+conFmt(tot.earned)+" ("+conPct(tot.varPct)+") · "+tot.nPct+" WBS with %":"type the progress % of the WBS"}/>
      <InvBig label="Remain to be spent, theo." value={tot.nPct?tot.rtsTheo:null} unit={CON_UNIT} sub="WBS with % · budget − earned"/>
      <InvBig label="Remain to be spent, real" value={tot.nPct?tot.rtsReal:null} unit={CON_UNIT} sub={tot.nAdj?tot.nAdj+" WBS adjusted":"= theoretical (no adjustment)"}/>
      <InvBig label="Estimate at completion" value={tot.nPct?tot.eac:null} unit={CON_UNIT} colour={conVarCol(tot.eacPct)} sub={tot.nPct?(tot.eacVar>0?"+":"")+conFmt(tot.eacVar)+" ("+conPct(tot.eacPct)+") vs their budget"+(prevTot&&prevTot.nPct?" · was "+(prevTot.eacVar>0?"+":"")+conFmt(prevTot.eacVar):""):"WBS with % only"}/>
    </div>
    {tot.nNoPct>0&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>⚠ {tot.nNoPct} WBS have no progress % at this cut-off ({conFmt(tot.theoNoPct)} {CON_UNIT} budget, {conFmt(tot.realNoPct)} {CON_UNIT} poured): they are left out of the loss / gain, the remain to be spent and the EAC until a % is typed.</div>}
    {drift&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>⚠ Figures moved since the cut-off was closed (pours or theoretical quantities edited): at closing, budget {conFmt(drift.theo)}, earned {conFmt(drift.earned)}, real {conFmt(drift.real)} {CON_UNIT}.</div>}
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>WBS</th><th style={R}>Budget</th><th style={R} title="Physical progress at the cut-off date">Progress %</th><th style={R} title="Progress of the linked schedule activities at the cut-off date — for reference only, never used in the figures">Sched. % (ref.)</th><th style={R} title="Budget × progress %">Earned</th>
        <th style={R} title="Concrete poured up to the cut-off date">Poured</th><th style={R} title="Poured ÷ budget, a volume ratio for reference — not a progress">Poured / budget</th><th style={R} title="Poured − earned: > 0 loss, < 0 gain">Loss (+) / gain (−)</th><th style={R}>%</th>
        <th style={R} title="Budget − earned">RTS theo.</th><th style={R} title="Remain to be spent, real. Empty = RTS theo. Type a value to adjust it.">RTS real</th>
        <th style={R} title="Real + RTS real">EAC</th><th style={R}>EAC − budget</th></tr></thead>
      <tbody>{rows.map(function(r){
        var w=r.wbs;
        var mismatch=r.hasPct&&r.realPct!==null&&Math.abs(r.realPct-r.pct)>25;
        return <tr key={w.id}>
          <td><b>{w.code}</b> {w.name}{w.done&&<span style={{fontSize:10,color:"#2e7d32"}}> · complete</span>}
            {w.done&&r.hasPct&&r.pct<100&&<div style={{fontSize:10,color:"#ef6c00"}}>marked complete but below 100%</div>}</td>
          <td style={R}>{conFmt(r.theo)}</td>
          <td style={Object.assign({whiteSpace:"nowrap"},R)}>{ro?(r.hasPct?r.pct.toFixed(0)+"%":<span style={{color:"#ef6c00"}}>—</span>)
            :<ConNumCell key={cur.id+w.id+"p"} value={r.line.pct} width={58} placeholder="—" onCommit={function(v){commitPct(r,v);}}/>}</td>
          <td style={Object.assign({fontSize:12},R)}>{schedPct[w.id]===undefined?<span style={{color:"#ccc"}}>{(w.schedLinks||[]).length?"—":""}</span>
            :<span style={{color:r.hasPct&&Math.abs(r.pct-schedPct[w.id])>10?"#ef6c00":"#888"}} title="Schedule progress, for reference only">{schedPct[w.id]}%</span>}</td>
          <td style={R}>{r.hasPct?conFmt(r.earned):<span style={{color:"#bbb"}}>—</span>}</td>
          <td style={R}>{conFmt(r.real)}</td>
          <td style={Object.assign({color:mismatch?"#ef6c00":"#888",fontSize:12},R)} title={mismatch?"Volume progress far from the physical progress: check the % or the pours":""}>{r.realPct===null?"—":r.realPct.toFixed(0)+"%"}</td>
          <td style={Object.assign({fontWeight:700,color:r.hasPct?conLossCol(r.variance):"#bbb"},R)}>{r.hasPct?(r.variance>0?"+":"")+conFmt(r.variance):"—"}</td>
          <td style={Object.assign({color:r.hasPct?conLossCol(r.variance):"#bbb"},R)}>{r.hasPct?conPct(r.varPct):""}</td>
          <td style={R}>{r.hasPct?conFmt(r.rtsTheo):<span style={{color:"#bbb"}}>—</span>}</td>
          <td style={R}>{!r.hasPct?<span style={{color:"#bbb"}}>—</span>:ro?<span style={{fontWeight:r.adjusted?700:undefined,color:r.adjusted?"var(--gold-ink)":undefined}}>{conFmt(r.rtsReal)}</span>
            :<ConNumCell key={cur.id+w.id+"r"+typeIds.join()} value={r.adjusted?r.rtsReal:null} width={80} placeholder={conFmt(r.rtsTheo)} highlight={r.adjusted}
              title={r.adjusted?"Adjusted. Clear the cell to go back to the theoretical remain.":"Same as RTS theo. Type a value to adjust."} onCommit={function(v){commitRts(r,v);}}/>}</td>
          <td style={R}>{r.hasPct?conFmt(r.eac):<span style={{color:"#bbb"}}>—</span>}</td>
          <td style={Object.assign({fontWeight:700,color:conVarCol(r.eacPct)},R)}>{r.hasPct?<>{(r.eacVar>0?"+":"")+conFmt(r.eacVar)}<div style={{fontSize:10,fontWeight:400}}>{conPct(r.eacPct)}</div></>:<span style={{color:"#bbb"}}>—</span>}</td>
        </tr>;
      })}
      <tr style={{fontWeight:700,background:"#f7f6f2"}}><td>Total — {rows.length} WBS ({tot.nPct} with %)</td><td style={R}>{conFmt(tot.theoAll)}</td><td style={R}>{tot.pct===null?"—":tot.pct.toFixed(1)+"%"}</td><td/><td style={R}>{conFmt(tot.earned)}</td>
        <td style={R}>{conFmt(tot.realAll)}</td><td style={R}>{tot.theoAll>CON_EPS?(tot.realAll/tot.theoAll*100).toFixed(0)+"%":"—"}</td><td style={Object.assign({color:conLossCol(tot.variance)},R)}>{tot.nPct?(tot.variance>0?"+":"")+conFmt(tot.variance):"—"}</td><td style={Object.assign({color:conLossCol(tot.variance)},R)}>{tot.nPct?conPct(tot.varPct):""}</td>
        <td style={R}>{conFmt(tot.rtsTheo)}</td><td style={R}>{conFmt(tot.rtsReal)}</td><td style={R}>{conFmt(tot.eac)}</td><td style={Object.assign({color:conVarCol(tot.eacPct)},R)}>{(tot.eacVar>0?"+":"")+conFmt(tot.eacVar)} <span style={{fontWeight:400,fontSize:11}}>{conPct(tot.eacPct)}</span></td></tr>
      </tbody></table></div>
    <div style={{fontSize:11,color:"#888",marginTop:8}}>
      Only the progress % typed here counts: nothing is filled in automatically, and a WBS without a % is left out of the loss / gain, the RTS and the EAC. Earned = budget × progress %. Poured = concrete poured up to {fmtDate(cur.date)}; loss (+) / gain (−) = poured − earned. RTS = remain to be spent: theoretical = budget − earned; real = the theoretical one unless you type another value (shown in gold; clear the cell to undo).
      {!typeId&&" With all types shown, a typed RTS real is shared over the WBS's types pro rata; pick a type to adjust it type by type."} EAC = real + RTS real.
    </div>
    <div className="fg" style={{marginTop:10,maxWidth:700}}><label>Cut-off note</label>
      <textarea rows={2} disabled={ro} defaultValue={cur.note||""} key={cur.id} onBlur={function(e){if(e.target.value!==(cur.note||""))setCur({note:e.target.value});}}/></div>
    {creator}
  </div>;
}
function ConCutoffNew({cutoffs,wbs,onCreate,onClose}){
  // default: last day of the previous month
  var t=parseISODate(today());var lastPrev=toISO(new Date(t.getFullYear(),t.getMonth(),0));
  const [date,setDate]=useState(lastPrev);
  const [label,setLabel]=useState("");
  var prev=null;cutoffs.forEach(function(c){if(c.date<date&&(!prev||c.date>prev.date))prev=c;});
  var err=!isValidDate(date)?"Give the cut-off date.":cutoffs.some(function(c){return c.date===date;})?"There is already a cut-off at this date.":"";
  function create(){
    // A new cut-off starts empty: every progress % is typed by hand, nothing is carried over.
    onCreate(newConCutoff({date:date,label:label.trim(),lines:[]}));
  }
  return <InvModal title="💰 New cut-off" width={520} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!!err} title={err} onClick={create}>Create</button>
    </>}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <div className="fg"><label>Cut-off date</label><input type="date" value={date} onChange={function(e){setDate(e.target.value);}}/></div>
      <div className="fg" style={{flex:"1 1 200px"}}><label>Label</label><input type="text" value={label} placeholder="e.g. October 2026" onChange={function(e){setLabel(e.target.value);}}/></div>
    </div>
    <div style={{fontSize:12,color:"#555"}}>The cut-off starts empty: type the progress % of each WBS by hand. Nothing is carried over{prev?" from the cut-off of "+fmtDate(prev.date):""} or taken from the schedule. Poured quantities are the pours dated up to the cut-off.</div>
    {err&&<div style={{fontSize:12,color:"#c62828",marginTop:8}}>{err}</div>}
  </InvModal>;
}
function conCutoffReport(c,prev,rows,tot,prevTot,label){
  var E=esc;
  var td=function(v,b,col){return'<td style="text-align:right;'+(b?"font-weight:700;":"")+(col?"color:"+col+";":"")+'">'+v+"</td>";};
  var sg=function(v){return(v>0?"+":"")+conFmt(v);};
  var body=rows.map(function(r){
    if(!r.hasPct)return"<tr><td><b>"+E(r.wbs.code)+"</b> "+E(r.wbs.name)+"</td>"+td(conFmt(r.theo))+td("—")+td("—")+td(conFmt(r.real))+td("—")+td("")+td("—")+td("—")+td("—")+td("—")+"</tr>";
    return"<tr><td><b>"+E(r.wbs.code)+"</b> "+E(r.wbs.name)+"</td>"+td(conFmt(r.theo))+td(r.pct.toFixed(0)+"%")+td(conFmt(r.earned))+td(conFmt(r.real))
      +td(sg(r.variance),true,conLossCol(r.variance))+td(conPct(r.varPct),false,conLossCol(r.variance))+td(conFmt(r.rtsTheo))+td(conFmt(r.rtsReal)+(r.adjusted?" *":""))+td(conFmt(r.eac))+td(sg(r.eacVar),true,conVarCol(r.eacPct))+"</tr>";
  }).join("");
  var html="<h1>Concrete — cut-off cost control</h1><div class=\"sub\">Riviera Tower · cut-off "+E(fmtDate(c.date))+(c.label?" ("+E(c.label)+")":"")+" · "+E(label)+(c.closed?" · closed":" · open (provisional)")+"</div>"
    +"<h2>Summary ("+CON_UNIT+") — WBS with a progress % ("+tot.nPct+" of "+tot.n+")</h2><table><tr><th>Budget</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−)</th><th>RTS theo.</th><th>RTS real</th><th>EAC</th><th>EAC − budget</th></tr><tr>"
    +td(conFmt(tot.theo))+td(conFmt(tot.earned))+td(conFmt(tot.real))+td(sg(tot.variance)+" ("+conPct(tot.varPct)+")",true,conLossCol(tot.variance))+td(conFmt(tot.rtsTheo))+td(conFmt(tot.rtsReal))+td(conFmt(tot.eac))+td(sg(tot.eacVar)+" ("+conPct(tot.eacPct)+")",true)+"</tr>"
    +(prevTot?"<tr><td colspan=\"8\" style=\"font-size:11px;color:#555\">Since "+E(fmtDate(prev.date))+": earned +"+conFmt(tot.earned-prevTot.earned)+", poured (all WBS) +"+conFmt(tot.realAll-prevTot.realAll)+"</td></tr>":"")+"</table>"
    +(tot.nNoPct?"<div style=\"font-size:11px;color:#b45309\">"+tot.nNoPct+" WBS without progress % ("+conFmt(tot.theoNoPct)+" budget, "+conFmt(tot.realNoPct)+" poured) are not measured.</div>":"")
    +"<h2>Per WBS</h2><table><tr><th>WBS</th><th>Budget</th><th>Progress</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−)</th><th>%</th><th>RTS theo.</th><th>RTS real</th><th>EAC</th><th>EAC − budget</th></tr>"+body+"</table>"
    +(c.note?"<h2>Note</h2><div>"+E(c.note)+"</div>":"")
    +"<div style=\"font-size:10px;color:#8b8578\">Progress % typed by hand only. Earned = budget × progress %. Poured = pours up to the cut-off date. Loss (+) / gain (−) = poured − earned. RTS = remain to be spent (* = adjusted by hand). EAC = poured + RTS real.</div>";
  openReport("CONCRETE CUT-OFF - "+c.date,html);
}
function conCutoffXlsx(c,types,wbs,pours){
  if(!window.XLSX||!window.XLSX.utils||!window.XLSX.writeFile){safeAlert("The Excel library is not loaded.");return;}
  var st=conSortTypes(types),allIds=types.map(function(t){return t.id;});
  var r2=function(v){return Math.round(v*100)/100;};
  var rows=conCutoffRows(c,wbs,pours,allIds);
  var h=function(r,v){return r.hasPct?r2(v):"";};
  var sum=rows.map(function(r){return{"Code":r.wbs.code,"Description":r.wbs.name,"Zone":r.wbs.zone,"Budget":r2(r.theo),"Progress %":r.hasPct?r.pct:"","Earned":h(r,r.earned),"Poured":r2(r.real),
    "Loss(+)/gain(-)":h(r,r.variance),"%":r.varPct===null?"":r2(r.varPct),"RTS theo.":h(r,r.rtsTheo),"RTS real":h(r,r.rtsReal),"Adjusted":r.adjusted?"Y":"","EAC":h(r,r.eac),"EAC − budget":h(r,r.eacVar)};});
  var det=[];
  rows.forEach(function(r){st.forEach(function(t){var b=r.byType[t.id];if(!b||(b.theo<=CON_EPS&&b.real<=CON_EPS))return;
    det.push({"Code":r.wbs.code,"Type":t.name,"Budget":r2(b.theo),"Progress %":r.hasPct?r.pct:"","Earned":h(r,b.earned),"Poured":r2(b.real),"Loss(+)/gain(-)":h(r,b.real-b.earned),"RTS theo.":h(r,b.rtsTheo),"RTS real":h(r,b.rtsReal),"Adjusted":b.adjusted?"Y":"","EAC":h(r,b.real+b.rtsReal),"EAC − budget":h(r,b.real+b.rtsReal-b.theo)});});});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(sum),"Per WBS");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(det),"Per WBS and type");
  window.XLSX.writeFile(wb,"Concrete cut-off "+c.date+".xlsx");
}
// A split moves a WBS's quantities to new lines. In CLOSED cut-offs the new lines keep the % that
// was typed for the WBS they come from, so a closed situation does not move. Open cut-offs are
// left alone: the % of the new lines is typed by hand there.
function conSplitCutoffs(cutoffs,parentId,childIds,parentGone){
  return(cutoffs||[]).map(function(c){
    if(!c.closed)return c;
    var pl=conCutoffLine(c,parentId);
    if(!pl||!_invHas(pl.pct))return c;
    var lines=(c.lines||[]).filter(function(l){return !(parentGone&&l.id===parentId)&&childIds.indexOf(l.id)<0;});
    childIds.forEach(function(id){lines.push({id:id,pct:pl.pct});});
    return Object.assign({},c,{lines:lines});
  });
}

// ---------------------------------------------------------------- link to the zone schedules
// A WBS can be linked to one or more task rows of the zone schedules (pp_schedules):
//   schedLinks: [{schedId, rowId}]
//   datesFromSched: true → the WBS's planned start/finish follow the linked activities
//     (earliest planned week → end of the latest planned week); the curve uses them.
// The schedule's progress of the linked activities (weighted by their planned weeks) is
// offered as the progress % at a cut-off.
function conSchedIndex(schedules){
  var ix={};
  (schedules||[]).forEach(function(sc){
    var sec="",cat="";
    (sc.rows||[]).forEach(function(r){
      if(r.kind==="section"){sec=r.label||"";cat="";return;}
      if(r.kind==="category"){cat=r.label||"";return;}
      ix[sc.id+":"+r.id]={sc:sc,row:r,ctx:[sec,cat].filter(Boolean).join(" › ")};
    });
  });
  return ix;
}
function conSchedName(sc){return(sc.zone?sc.zone+" — ":"")+(sc.title||"Schedule");}
function _conAddDays(iso,n){var d=parseISODate(iso);if(isNaN(d.getTime()))return"";d.setDate(d.getDate()+n);return toISO(d);}
// Planned span of a schedule row: its planned bars, or startWeek/endWeek, else any bar.
function conSchedRowSpan(row){
  var c=row.cells||{},ks=Object.keys(c).sort();
  var plan=ks.filter(function(w){return c[w]==="plan"||c[w]==="both";});
  var s=plan[0]||row.startWeek||"",e=plan[plan.length-1]||row.endWeek||"";
  if(!s&&!e){var any=ks.filter(function(w){return c[w];});s=any[0]||"";e=any[any.length-1]||"";}
  return{start:s,finish:e?_conAddDays(e,WORK_DAYS_PER_WEEK-1):"",weeks:Math.max(1,plan.length)};
}
// Progress of a schedule row at a date: the latest weekly entry up to that date, else the
// manual %, else actual weeks ÷ planned weeks counted up to that date. null = nothing known.
function conSchedRowProgress(row,date){
  var wp=row.weekProgress||{};
  var ks=Object.keys(wp).filter(function(k){return k<=date&&wp[k]!==""&&wp[k]!==null&&wp[k]!==undefined;}).sort();
  if(ks.length)return conClampPct(wp[ks[ks.length-1]]);
  if(row.progress!==undefined&&row.progress!==null&&row.progress!=="")return conClampPct(row.progress);
  var c=row.cells||{},plan=0,act=0;
  Object.keys(c).forEach(function(w){
    if(c[w]==="plan"||c[w]==="both")plan++;
    if((c[w]==="actual"||c[w]==="both")&&w<=date)act++;
  });
  if(!plan&&!act)return null;
  if(!plan)return 100;
  return Math.min(100,Math.round(act/plan*100));
}
// What the links of a WBS point to, its dates from the schedule and its progress at a date.
function conWbsSched(w,ix,date){
  var acts=(w.schedLinks||[]).map(function(l){var e=ix[l.schedId+":"+l.rowId];return e?Object.assign({link:l},e,{span:conSchedRowSpan(e.row)}):{link:l,missing:true};});
  var ok=acts.filter(function(a){return !a.missing;});
  var start="",finish="";
  ok.forEach(function(a){
    if(a.span.start&&(!start||a.span.start<start))start=a.span.start;
    if(a.span.finish&&(!finish||a.span.finish>finish))finish=a.span.finish;
  });
  var pct=null;
  if(date){
    var sw=0,sp=0;
    ok.forEach(function(a){var p=conSchedRowProgress(a.row,date);if(p===null)return;sw+=a.span.weeks;sp+=p*a.span.weeks;});
    if(sw>0)pct=Math.round(sp/sw*10)/10;
  }
  return{acts:acts,nMissing:acts.length-ok.length,start:start,finish:finish,pct:pct};
}
// The WBS list used for the curve and the tables: planned dates taken from the schedule where
// the WBS says so. Never saved back (the stored WBS keep their own typed dates).
function conEffectiveWbs(wbs,ix){
  return(wbs||[]).map(function(w){
    if(!w.datesFromSched||!(w.schedLinks||[]).length)return w;
    var s=conWbsSched(w,ix,"");
    if(!s.start&&!s.finish)return w;
    return Object.assign({},w,{start:s.start,finish:s.finish,_schedDates:true});
  });
}
// Pick schedule task rows for a WBS.
function ConSchedPicker({schedules,ix,links,zone,onChange,onClose}){
  var scs=(schedules||[]).slice().sort(function(a,b){return conSchedName(a).localeCompare(conSchedName(b));});
  var first=scs.find(function(s){return zone&&s.zone===zone;})||scs[0];
  const [scId,setScId]=useState(first?first.id:"");
  const [q,setQ]=useState("");
  const [sel,setSel]=useState((links||[]).slice());
  var sc=scs.find(function(s){return s.id===scId;});
  var ql=q.trim().toLowerCase();
  var rows=sc?Object.keys(ix).map(function(k){return ix[k];}).filter(function(e){
    return e.sc.id===sc.id&&(e.row.kind||"task")==="task"&&(!ql||[e.row.label,e.ctx,e.row.group].join(" ").toLowerCase().indexOf(ql)>=0);
  }):[];
  function on(e){return sel.some(function(l){return l.schedId===e.sc.id&&l.rowId===e.row.id;});}
  function toggle(e){setSel(on(e)?sel.filter(function(l){return !(l.schedId===e.sc.id&&l.rowId===e.row.id);}):sel.concat([{schedId:e.sc.id,rowId:e.row.id}]));}
  return <InvModal title="🗓 Link schedule activities" width={820} onClose={onClose} footer={<>
      <span style={{fontSize:12,color:"#555",marginRight:"auto"}}>{sel.length} activit{sel.length===1?"y":"ies"} selected</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" onClick={function(){onChange(sel);}}>Apply</button>
    </>}>
    {!scs.length?<div style={{fontSize:12,color:"#888"}}>No zone schedule yet.</div>:<>
    <div className="filter-bar">
      <select value={scId} onChange={function(e){setScId(e.target.value);}} style={{width:"auto"}}>
        {scs.map(function(s){return <option key={s.id} value={s.id}>{conSchedName(s)}{sel.some(function(l){return l.schedId===s.id;})?" ●":""}</option>;})}
      </select>
      <input type="text" placeholder="Search activity…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:220}}/>
    </div>
    <div style={{maxHeight:420,overflowY:"auto"}}><table className="tbl" style={{fontSize:12}}>
      <thead><tr><th/><th>Activity</th><th>Company</th><th>Planned</th><th style={{textAlign:"right"}}>Progress</th></tr></thead>
      <tbody>{rows.map(function(e){
        var sp=conSchedRowSpan(e.row),p=conSchedRowProgress(e.row,today());
        return <tr key={e.row.id} onClick={function(){toggle(e);}} style={{cursor:"pointer",background:on(e)?"var(--gold-soft)":undefined}}>
          <td><input type="checkbox" checked={on(e)} readOnly style={{width:14,height:14}}/></td>
          <td><b>{e.row.label||"(no label)"}</b>{e.ctx&&<div style={{fontSize:10,color:"#888"}}>{e.ctx}</div>}</td>
          <td>{e.row.group||""}</td>
          <td style={{whiteSpace:"nowrap"}}>{sp.start?fmtDate(sp.start)+" → "+fmtDate(sp.finish):<span style={{color:"#aaa"}}>no bar</span>}</td>
          <td style={{textAlign:"right"}}>{p===null?"—":p+"%"}</td>
        </tr>;
      })}</tbody></table>
      {!rows.length&&<div style={{fontSize:12,color:"#888",padding:8}}>No activity{q?" matches":" in this schedule"}.</div>}</div>
    </>}
  </InvModal>;
}
// The linked activities, as shown in the WBS editor.
function ConSchedLinks({w,ix,edit,schedules,onChange}){
  const [picking,setPicking]=useState(false);
  var s=conWbsSched(w,ix,today());
  return <div style={{background:"#fafafa",borderRadius:8,padding:"8px 10px",margin:"6px 0 10px"}}>
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <span style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase"}}>Schedule activities</span>
      {s.acts.length>0&&<span style={{fontSize:12,color:"#555"}}>{s.start?fmtDate(s.start)+" → "+fmtDate(s.finish):"no planned bar"}{s.pct!==null?" · progress "+s.pct+"%":""}</span>}
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={function(){setPicking(true);}}>{s.acts.length?"Change links":"🗓 Link activities"}</button>}
    </div>
    {s.acts.map(function(a,i){
      return <div key={i} style={{fontSize:12,marginTop:4}}>
        {a.missing?<span style={{color:"#c62828"}}>(activity deleted from the schedule)</span>
          :<span><b>{a.row.label}</b> <span style={{color:"#888"}}>· {conSchedName(a.sc)}{a.ctx?" › "+a.ctx:""} · {a.span.start?fmtDate(a.span.start)+" → "+fmtDate(a.span.finish):"no bar"}</span></span>}
        {edit&&<button className="btn btn-sm" style={{marginLeft:6,padding:"0 6px"}} onClick={function(){onChange({schedLinks:(w.schedLinks||[]).filter(function(l){return l!==a.link;})});}}>×</button>}
      </div>;
    })}
    {s.acts.length>0&&<label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,marginTop:6,textTransform:"none",letterSpacing:"normal"}}>
      <input type="checkbox" disabled={!edit} checked={!!w.datesFromSched} onChange={function(){onChange({datesFromSched:!w.datesFromSched});}}/> Planned dates follow the schedule (used by the curve)
    </label>}
    {picking&&<ConSchedPicker schedules={schedules} ix={ix} links={w.schedLinks} zone={w.zone} onClose={function(){setPicking(false);}}
      onChange={function(l){var p={schedLinks:l};if(l.length&&!(w.schedLinks||[]).length)p.datesFromSched=true;onChange(p);setPicking(false);}}/>}
  </div>;
}

// ---------------------------------------------------------------- import pours from the site follow-up workbook
// Reads a delivery-note register (one row per truck: Zone, Level, Description, Supplier, Date,
// N° delivery note, Type of concrete, Real Qty, Theo Qty, Month, Year — e.g. the sheet
// SUPERSTRUCTURE of "RT - Superstructure Concrete FOLLOW UP"), keeps the rows of one value of a
// filter column (Zone = EXTERNAL by default), and books them as pours.
// The workbook's "Description" is not our WBS: every description is matched by hand to an
// existing WBS, or to a new WBS created on the spot (several descriptions may share one new WBS
// by giving it the same name), or skipped. The matches are remembered on this browser.
// Concrete types and suppliers are matched by name; an unknown type can be created.
// The workbook's Theo Qty is NEVER read: the theoretical m³ are typed in the app only.
// A delivery note already imported (supplier + note + date) is never booked twice.
var CON_IMP_COLS={
  desc:/^(description|désignation|designation)$/i,
  supplier:/^(supplier|fournisseur|plant)$/i,
  date:/^(date|pour date|delivery date)$/i,
  note:/^(n°|no\.?|nr)\s*(of\s*)?(delivery note|dn|docket|bl|bon)$|^(delivery note|docket|bl)( n°| no\.?)?$/i,
  type:/^(type of concrete|concrete type|type|grade|class)$/i,
  qty:/^(real qty|real quantity|qty|quantity|quantité|m3|m³|volume)$/i,
  month:/^(month|mois)$/i,
  year:/^(year|année|annee)$/i,
  level:/^(level|niveau)$/i,
  element:/^(elements?|élément)$/i
};
function conImpKey(s){return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function conImpDate(v){
  if(v instanceof Date&&!isNaN(v))return toISO(new Date(v.getTime()+12*3600000));
  if(typeof v==="number"&&v>20000&&v<80000)return new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000).toISOString().slice(0,10);
  var s=String(v||"").trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  return conParseDate(s);
}
function conImpGuessWbs(desc,wbs){
  var k=conImpKey(desc);if(!k)return"";
  var hit=wbs.find(function(w){return conImpKey(w.name)===k||conImpKey(w.code)===k||conImpKey(conWbsLabel(w))===k;});
  if(hit)return hit.id;
  hit=wbs.find(function(w){var n=conImpKey(w.name);return n&&n.length>3&&(n.indexOf(k)>=0||k.indexOf(n)>=0);});
  if(hit)return hit.id;
  var kw=k.split(" ").filter(function(x){return x.length>1;}),best="",bs=0;
  wbs.forEach(function(w){
    var ww=conImpKey((w.code||"")+" "+(w.name||"")).split(" ").filter(function(x){return x.length>1;});
    var c=kw.filter(function(x){return ww.indexOf(x)>=0;}).length,sc=c/Math.max(1,Math.min(kw.length,ww.length));
    if(c>=2&&sc>bs){bs=sc;best=w.id;}
  });
  return bs>=0.75?best:"";
}
function conImpMapLoad(){try{return JSON.parse(localStorage.getItem("pp_con_wbsmap")||"{}")||{};}catch(e){return {};}}
function conImpMapSave(m){try{localStorage.setItem("pp_con_wbsmap",JSON.stringify(m));}catch(e){}}

function ConImportModal({types,saveTypes,wbs,saveWbs,pours,savePours,onClose}){
  const [book,setBook]=useState(null);        // {name, sheets:{name:rows}}
  const [sheet,setSheet]=useState("");
  const [busy,setBusy]=useState("");
  const [err,setErr]=useState("");
  const [fCol,setFCol]=useState(-1);
  const [fVal,setFVal]=useState("EXTERNAL");
  const [group,setGroup]=useState(true);
  const [choice,setChoice]=useState({});       // desc key → {to:"wbs id"|"new"|"skip", name, code}
  const [tChoice,setTChoice]=useState({});     // type key → type id | "new" | "skip"
  const [q,setQ]=useState("");
  const [onlyOpen,setOnlyOpen]=useState(false);

  function onFile(e){
    var f=e.target.files&&e.target.files[0];if(!f)return;
    if(!window.XLSX||!window.XLSX.read){setErr("The Excel library is not loaded.");return;}
    setErr("");setBusy("Reading "+f.name+"…");setBook(null);
    var rd=new FileReader();
    rd.onload=function(){
      setTimeout(function(){
        try{
          var wb=window.XLSX.read(new Uint8Array(rd.result),{type:"array",cellDates:true,dense:true});
          var pick=wb.SheetNames.find(function(n){return /superstructure/i.test(n);})||wb.SheetNames[0];
          var sheets={};
          wb.SheetNames.forEach(function(n){
            var sh=wb.Sheets[n];if(!sh||!sh["!ref"])return;
            // only the first 40 columns: these registers carry hundreds of empty formatted ones
            var rg=window.XLSX.utils.decode_range(sh["!ref"]);if(rg.e.c>39)rg.e.c=39;
            sheets[n]=function(){return window.XLSX.utils.sheet_to_json(sh,{header:1,defval:"",raw:true,range:rg});};
          });
          setBook({name:f.name,names:wb.SheetNames.filter(function(n){return sheets[n];}),sheets:sheets,cache:{}});
          setSheet(pick);setBusy("");
        }catch(x){setBusy("");setErr("This file could not be read: "+x.message);}
      },30);
    };
    rd.readAsArrayBuffer(f);
  }
  // rows of the chosen sheet, and its header line (the first line holding Description + a quantity)
  var parsed=(function(){
    if(!book||!sheet||!book.sheets[sheet])return null;
    if(!book.cache[sheet])book.cache[sheet]=book.sheets[sheet]();
    var rows=book.cache[sheet];
    var hi=rows.findIndex(function(r){return r.some(function(c){return CON_IMP_COLS.desc.test(String(c).trim());})&&r.some(function(c){return CON_IMP_COLS.qty.test(String(c).trim());});});
    if(hi<0)return {error:"No header line with “Description” and “Real Qty” in this sheet."};
    var head=rows[hi].map(function(c){return String(c).trim();});
    var col={};Object.keys(CON_IMP_COLS).forEach(function(k){col[k]=head.findIndex(function(h){return CON_IMP_COLS[k].test(h);});});
    return {hi:hi,head:head,col:col,body:rows.slice(hi+1)};
  })();
  var filterCol=parsed&&!parsed.error?(fCol>=0?fCol:Math.max(0,parsed.head.findIndex(function(h){return /^zone$/i.test(h);}))):-1;
  var filterVals=[];
  if(parsed&&!parsed.error&&filterCol>=0){
    var cnt={};parsed.body.forEach(function(r){var v=String(r[filterCol]===undefined?"":r[filterCol]).trim();if(v)cnt[v]=(cnt[v]||0)+1;});
    filterVals=Object.keys(cnt).sort(function(a,b){return cnt[b]-cnt[a];}).map(function(v){return {v:v,n:cnt[v]};});
  }
  // the rows kept, read into {desc, date, note, supplier, type, qty, theo}
  var items=[],issues={noQty:0,dateFixed:0,noDate:0};
  if(parsed&&!parsed.error){
    var c=parsed.col,lastDate="";
    parsed.body.forEach(function(r){
      if(filterCol>=0&&String(r[filterCol]).trim().toUpperCase()!==String(fVal).trim().toUpperCase())return;
      var qty=c.qty>=0?conParseNum(r[c.qty]):0;
      if(!(qty>0)){if(String(r[c.desc]||"").trim())issues.noQty++;return;}
      var d=c.date>=0?conImpDate(r[c.date]):"";
      var mo=c.month>=0?Number(r[c.month]):0,yr=c.year>=0?Number(r[c.year]):0;
      if(!d||d<"2000-01-01"){
        // a typo in the date: the previous row's date when it is in the same month, else the 1st of the month
        if(mo&&yr){var pre=yr+"-"+(mo<10?"0":"")+mo;d=lastDate&&lastDate.slice(0,7)===pre?lastDate:pre+"-01";issues.dateFixed++;}
        else{issues.noDate++;return;}
      }
      lastDate=d;
      items.push({desc:String(r[c.desc]||"").trim()||"(no description)",date:d,note:c.note>=0?String(r[c.note]||"").trim():"",
        supplier:c.supplier>=0?String(r[c.supplier]||"").trim():"",type:c.type>=0?String(r[c.type]||"").trim():"",qty:qty,
        level:c.level>=0?String(r[c.level]||"").trim():""});
    });
  }
  // delivery notes already booked
  var done={};pours.forEach(function(p){(p.importNotes||[]).forEach(function(k){done[k]=1;});});
  function noteKey(it){return it.note?conImpKey(it.supplier)+"|"+it.note+"|"+it.date:"";}
  var fresh=items.filter(function(it){var k=noteKey(it);return !k||!done[k];});
  var already=items.length-fresh.length;
  // descriptions and types met
  var descs={};fresh.forEach(function(it){var k=conImpKey(it.desc);var o=descs[k]||(descs[k]={key:k,name:it.desc,n:0,qty:0,from:it.date,to:it.date,levels:{}});
    o.n++;o.qty+=it.qty;if(it.date<o.from)o.from=it.date;if(it.date>o.to)o.to=it.date;if(it.level)o.levels[it.level]=1;});
  var dKeys=Object.keys(descs).sort(function(a,b){return descs[b].qty-descs[a].qty;});
  var tNames={};fresh.forEach(function(it){var k=_conNormName(it.type);if(!tNames[k])tNames[k]={name:it.type.trim(),qty:0};tNames[k].qty+=it.qty;});
  var tKeys=Object.keys(tNames).sort(function(a,b){return tNames[b].qty-tNames[a].qty;});
  var mem=conImpMapLoad();
  function cho(k){
    if(choice[k])return choice[k];
    var m=mem[k];
    if(m&&(m==="skip"||wbs.some(function(w){return w.id===m;})))return {to:m};
    var g=conImpGuessWbs(descs[k].name,wbs);
    return g?{to:g}:{to:"new"};
  }
  function setCho(k,patch){setChoice(function(o){var n=Object.assign({},o);n[k]=Object.assign({},cho(k),patch);return n;});}
  function tCho(k){if(tChoice[k])return tChoice[k];var t=conTypeByName(types,tNames[k].name);return t?t.id:"new";}
  function newName(k){var c=cho(k);return (c.name!==undefined?c.name:descs[k].name).trim();}
  var nNewWbs={};dKeys.forEach(function(k){if(cho(k).to==="new")nNewWbs[conImpKey(newName(k))]=1;});
  var keptQty=fresh.filter(function(it){return cho(conImpKey(it.desc)).to!=="skip"&&tCho(_conNormName(it.type))!=="skip";}).reduce(function(s,it){return s+it.qty;},0);
  var wSorted=conSortWbs(wbs);
  var ql=q.trim().toLowerCase();
  var shown=dKeys.filter(function(k){return (!ql||descs[k].name.toLowerCase().indexOf(ql)>=0)&&(!onlyOpen||cho(k).to==="new");});

  function apply(){
    if(blockIfReadOnly())return;
    // 1. types
    var allTypes=types.slice(),tMap={},createdT=[];
    tKeys.forEach(function(k){
      var v=tCho(k);
      if(v==="new"){var t=newConType({name:tNames[k].name});allTypes.push(t);createdT.push(t);tMap[k]=t.id;}
      else if(v!=="skip")tMap[k]=v;
    });
    // 2. WBS: one new WBS per distinct new name (theoretical left empty: typed in the app only)
    var nextWbs=wbs.slice(),byNew={},dMap={},createdW=[];
    var n0=wbs.length;
    dKeys.forEach(function(k){
      var c=cho(k);
      if(c.to==="skip")return;
      if(c.to!=="new"){dMap[k]=c.to;return;}
      var nk=conImpKey(newName(k));
      if(!byNew[nk]){
        var w=newConWbs({code:(c.code||"").trim()||("X-"+String(n0+createdW.length+1).padStart(3,"0")),name:newName(k)||descs[k].name,
          start:descs[k].from,finish:descs[k].to,note:"Created by the import of "+(book?book.name:"a workbook")+" ("+sheet+(filterCol>=0?" · "+fVal:"")+")"});
        byNew[nk]=w;createdW.push(w);nextWbs.push(w);
      }else{var w2=byNew[nk];if(descs[k].from<w2.start)w2.start=descs[k].from;if(descs[k].to>w2.finish)w2.finish=descs[k].to;}
      dMap[k]=byNew[nk].id;
    });
    // 3. pours: one per delivery note, or one per day × WBS (each type × supplier a line)
    var newPours=[],groups={};
    fresh.forEach(function(it){
      var wid=dMap[conImpKey(it.desc)],tid=tMap[_conNormName(it.type)];
      if(!wid||!tid)return;
      var gk=group?it.date+"|"+wid:noteKey(it)||(it.date+"|"+wid+"|"+Math.random());
      var p=groups[gk];
      if(!p){p=newConPour({date:it.date,wbsId:wid,ref:"",lines:[],note:"Imported from "+(book?book.name:"workbook")+" — "+it.desc,importNotes:[]});groups[gk]=p;newPours.push(p);}
      var sup=it.supplier;
      var l=p.lines.find(function(x){return x.typeId===tid&&String(x.supplier).toLowerCase()===sup.toLowerCase();});
      if(l)l.qty=Math.round((_invNum(l.qty)+it.qty)*100)/100;else p.lines.push(newConLine({typeId:tid,supplier:sup,qty:it.qty}));
      var nk=noteKey(it);if(nk)p.importNotes.push(nk);
      if(it.note&&p.ref.length<60)p.ref=p.ref?p.ref+", "+it.note:it.note;
      if(p.note.indexOf(it.desc)<0&&p.note.length<160)p.note+=" / "+it.desc;
    });
    newPours.forEach(function(p){if(p.ref.length>=60)p.ref+="…";});
    // 4. remember the matches
    var m=conImpMapLoad();dKeys.forEach(function(k){var c=cho(k);m[k]=c.to==="new"?dMap[k]||"":c.to;});conImpMapSave(m);
    if(createdT.length)saveTypes(types.concat(createdT));
    if(createdW.length)saveWbs(nextWbs);
    savePours(newPours.concat(pours));
    safeAlert(newPours.length+" pour(s) imported — "+conFmt(newPours.reduce(function(s,p){return s+conPourQty(p,allTypes.map(function(t){return t.id;}));},0))+" "+CON_UNIT+"."+
      (createdW.length?"\n\nNew WBS ("+createdW.length+"):\n• "+createdW.slice(0,15).map(function(w){return w.code+" — "+w.name;}).join("\n• ")+(createdW.length>15?"\n• …":""):"")+
      (createdT.length?"\n\nNew concrete types: "+createdT.map(function(t){return t.name;}).join(", "):""));
    onClose();
  }

  var inp={padding:"4px 7px",fontSize:12.5,width:"auto"};
  var footer=<React.Fragment>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-pri" disabled={!fresh.length} onClick={apply}>Import {fresh.length?conFmt(keptQty)+" "+CON_UNIT:""}</button>
  </React.Fragment>;
  return <InvModal title="⬆ Import pours from the follow-up workbook" width={980} onClose={onClose} footer={footer}>
    <div style={{fontSize:12,color:"#6f6b62",marginBottom:8}}>One row per delivery note (Description · Supplier · Date · N° delivery note · Type of concrete · Real Qty). Choose the sheet and the rows to keep, then match each <b>Description</b> of the workbook to one of your WBS — or create the WBS here.</div>
    <input type="file" accept=".xlsx,.xlsm,.xls" onChange={onFile}/>
    {busy&&<div style={{fontSize:12.5,color:"#1a73e8",marginTop:6}}>⏳ {busy}</div>}
    {err&&<div style={{fontSize:12.5,color:"#b3302a",marginTop:6}}>{err}</div>}
    {book&&<div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 12px",margin:"10px 0",fontSize:12.5}}>
      <span>Sheet <select value={sheet} onChange={function(e){setSheet(e.target.value);setFCol(-1);setChoice({});setTChoice({});}} style={inp}>{book.names.map(function(n){return <option key={n} value={n}>{n}</option>;})}</select></span>
      {parsed&&!parsed.error&&<span>Keep rows where <select value={filterCol} onChange={function(e){setFCol(Number(e.target.value));setFVal("");setChoice({});}} style={inp}>
          {parsed.head.map(function(h,i){return h?<option key={i} value={i}>{String.fromCharCode(65+i)} · {h}</option>:null;})}</select>
        {" = "}<select value={fVal} onChange={function(e){setFVal(e.target.value);setChoice({});}} style={inp}><option value="">— choose —</option>{filterVals.map(function(x){return <option key={x.v} value={x.v}>{x.v} ({x.n})</option>;})}</select></span>}
      <label style={{display:"flex",alignItems:"center",gap:4,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12.5,fontFamily:"inherit"}} title="One pour per day and WBS, each type × supplier a line; the delivery notes are kept in the reference. Unticked: one pour per delivery note (much heavier).">
        <input type="checkbox" checked={group} onChange={function(e){setGroup(e.target.checked);}}/>one pour per day × WBS</label>
    </div>}
    {parsed&&parsed.error&&<div style={{fontSize:12.5,color:"#b3302a"}}>{parsed.error}</div>}
    {parsed&&!parsed.error&&<div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12.5,marginBottom:8}}>
        <span><b>{items.length}</b> delivery notes · <b>{conFmt(items.reduce(function(s,it){return s+it.qty;},0))} {CON_UNIT}</b></span>
        {items.length>0&&<span>{fmtDate(items.reduce(function(m,it){return it.date<m?it.date:m;},"9999"))} → {fmtDate(items.reduce(function(m,it){return it.date>m?it.date:m;},""))}</span>}
        {already>0&&<span style={{color:"#1e6b3a"}}>{already} already imported (skipped)</span>}
        {issues.noQty>0&&<span style={{color:"#b35c00"}}>{issues.noQty} row(s) without quantity</span>}
        {issues.dateFixed>0&&<span style={{color:"#b35c00"}} title="Date missing or before 2000: taken from the Month / Year columns">{issues.dateFixed} date(s) taken from Month/Year</span>}
        {issues.noDate>0&&<span style={{color:"#b3302a"}}>{issues.noDate} row(s) without date (skipped)</span>}
      </div>
      {tKeys.length>0&&<div style={{marginBottom:10}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>Concrete types</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{tKeys.map(function(k){var v=tCho(k);
          return <span key={k} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,background:v==="new"?"#e8f5e9":"#fff",border:"1px solid #e8e6df",borderRadius:6,padding:"3px 6px"}}>
            <b>{tNames[k].name||"(no type)"}</b> <span style={{color:"#888"}}>{conFmt(tNames[k].qty)}</span> →
            <select value={v} onChange={function(e){var val=e.target.value;setTChoice(function(o){var n=Object.assign({},o);n[k]=val;return n;});}} style={Object.assign({},inp,{fontSize:12})}>
              <option value="new">➕ new type</option>{conSortTypes(types).map(function(t){return <option key={t.id} value={t.id}>{t.name}</option>;})}<option value="skip">skip</option></select>
          </span>;})}</div>
      </div>}
      {dKeys.length>0&&<div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
          <div style={{fontWeight:700,fontSize:13}}>Descriptions → WBS</div>
          <span style={{fontSize:12,color:"#888"}}>{dKeys.length} descriptions · {dKeys.filter(function(k){return cho(k).to!=="new"&&cho(k).to!=="skip";}).length} matched · {Object.keys(nNewWbs).length} new WBS · {dKeys.filter(function(k){return cho(k).to==="skip";}).length} skipped</span>
          <input type="text" value={q} onChange={function(e){setQ(e.target.value);}} placeholder="🔍 filter descriptions" style={Object.assign({},inp,{width:180,marginLeft:"auto"})}/>
          <label style={{display:"flex",alignItems:"center",gap:4,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12,fontFamily:"inherit"}}><input type="checkbox" checked={onlyOpen} onChange={function(e){setOnlyOpen(e.target.checked);}}/>only “new WBS”</label>
        </div>
        <div style={{maxHeight:"46vh",overflowY:"auto",border:"1px solid #ece9e1",borderRadius:8}}>
        <table className="tbl" style={{fontSize:12,margin:0}}>
          <thead><tr><th>Description in the workbook</th><th style={{textAlign:"right"}}>Notes</th><th style={{textAlign:"right"}}>{CON_UNIT}</th><th>Your WBS</th><th>New WBS: code · name</th></tr></thead>
          <tbody>{shown.map(function(k){
            var d=descs[k],c=cho(k),isNew=c.to==="new";
            return <tr key={k} style={{background:isNew?"#f3fbf4":c.to==="skip"?"#fdf3f4":"#fff"}}>
              <td style={{fontWeight:600}}>{d.name}<div style={{fontSize:10.5,color:"#888",fontWeight:400}}>{fmtDate(d.from)}{d.to!==d.from?" → "+fmtDate(d.to):""}{Object.keys(d.levels).length?" · "+Object.keys(d.levels).join(", "):""}</div></td>
              <td style={{textAlign:"right"}}>{d.n}</td>
              <td style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{conFmt(d.qty)}</td>
              <td><select value={c.to} onChange={function(e){setCho(k,{to:e.target.value});}} style={Object.assign({},inp,{width:"100%",maxWidth:300})}>
                <option value="new">➕ Create a new WBS</option>
                {wSorted.length>0&&<optgroup label="Existing WBS">{wSorted.map(function(w){return <option key={w.id} value={w.id}>{conWbsLabel(w)}</option>;})}</optgroup>}
                <option value="skip">Do not import</option>
              </select></td>
              <td>{isNew&&<span style={{display:"flex",gap:4}}>
                <input type="text" value={c.code||""} onChange={function(e){setCho(k,{code:e.target.value});}} placeholder="code (auto)" style={Object.assign({},inp,{width:86,fontFamily:"var(--font-mono)"})}/>
                <input type="text" value={c.name!==undefined?c.name:d.name} onChange={function(e){setCho(k,{name:e.target.value});}} title="Descriptions given the same name go into ONE new WBS" style={Object.assign({},inp,{flex:1,minWidth:150})}/>
              </span>}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div style={{fontSize:11,color:"#9b968b",marginTop:5}}>Suggestions come from the names; your matches are remembered on this browser. Give several descriptions the same new name to put them in one new WBS. New WBS take the dates of their pours; their theoretical m³ stay empty — the workbook's Theo Qty is never imported, type the theoretical in the app.</div>
      </div>}
    </div>}
  </InvModal>;
}
