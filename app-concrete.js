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
// budget unlocked vs real, remain to be spent theoretical and real (adjustable), EOS.
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
// theo: {typeId: m³}  = the budget
// dwg:  {typeId: m³}  = the quantities measured on the drawings (plans), typed in Overview ›
//       Theoretical per WBS; optional. At a cut-off the poured is compared with both.
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
// Period of a date: a month (key YYYY-MM) or, week=true, a Monday-to-Sunday week (key = the
// Monday, YYYY-MM-DD).
function _conPerStart(dt,week){
  if(!week)return new Date(dt.getFullYear(),dt.getMonth(),1);
  var d=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return d;
}
function _conPerNext(dt,week){
  return week?new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()+7):new Date(dt.getFullYear(),dt.getMonth()+1,1);
}
function _conPerKeyOf(dt,week){return week?toISO(dt):toISO(dt).slice(0,7);}
// Key of the period holding an ISO date (YYYY-MM accepted = its 1st).
function conPerKey(iso,week){
  var d=String(iso||"");if(d.length===7)d+="-01";
  var dt=parseISODate(d);if(!dt||isNaN(dt))return"";
  return _conPerKeyOf(_conPerStart(dt,week),week);
}
// Spreads qty evenly (per day) over [from, to] into out[YYYY-MM] (or out[Monday] with week).
// False when there is no date.
function conSpread(qty,from,to,out,week){
  var r=_conRange(from,to);
  if(!r)return false;
  if(!qty)return true;
  var da=parseISODate(r.a),db=parseISODate(r.b);
  var days=_conDays(r.a,r.b)+1;
  var cur=_conPerStart(da,week);
  while(cur<=db){
    var nxt=_conPerNext(cur,week);
    var pEnd=new Date(nxt.getFullYear(),nxt.getMonth(),nxt.getDate()-1);
    var s=cur<da?da:cur,e=pEnd>db?db:pEnd;
    var n=Math.round((e-s)/86400000)+1;
    var k=_conPerKeyOf(cur,week);
    out[k]=(out[k]||0)+qty*n/days;
    cur=nxt;
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
// pastReal planned of one WBS, as pieces {q, from, to}. The planned NEVER follows the real: in
// total it is always the WBS's theoretical. The pours make the planned of the past, oldest first,
// but only up to the theoretical (an over-pour is a loss, not more planned). What is left of the
// theoretical is spread from tomorrow (or the start, if later) to the finish; on a WBS marked
// complete, or whose finish is past, it is put on its finish (or last pour) so the planned still
// reaches the theoretical. rem = what could not be dated (no dates at all).
function conPastRealPieces(w,pours,typeIds,tm){
  var theo=conSum(w.theo,typeIds),acc=0,out=[],last="";
  (pours||[]).filter(function(p){return p.wbsId===w.id;}).sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;}).forEach(function(p){
    var q=Math.min(conPourQty(p,typeIds),Math.max(0,theo-acc));
    if(p.date>last)last=p.date;
    if(q>CON_EPS){acc+=q;out.push({q:q,from:p.from||p.date,to:p.date});}
  });
  var left=theo-acc;
  if(left>CON_EPS){
    if(!w.done&&_conRange(w.start,w.finish)&&(!w.finish||w.finish>=tm)){
      var a=w.start&&w.start>tm?w.start:tm,b=w.finish&&w.finish>tm?w.finish:a;
      out.push({q:left,from:a,to:b});left=0;
    }else{
      var d=w.finish||last||w.start;
      if(d){out.push({q:left,from:d,to:d});left=0;}
    }
  }
  return{pieces:out,rem:Math.max(0,left)};
}
// Planned up to date: the theoretical spread over the WBS dates, or (pastReal) what was poured
// by then, capped at each WBS's theoretical (conPastRealPieces).
function conPlannedToDate(list,pours,typeIds,date,pastReal){
  if(pastReal){
    var tm=_conTomorrow();
    return list.reduce(function(a,w){
      return a+conPastRealPieces(w,pours,typeIds,tm).pieces.reduce(function(s,x){return s+conShareUpTo(x.q,x.from,x.to,date);},0);
    },0);
  }
  return list.reduce(function(a,w){return a+conShareUpTo(conSum(w.theo,typeIds),w.start,w.finish,date);},0);
}
function conFmtMonth(k){
  var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return M[Number(k.slice(5,7))-1]+" "+k.slice(2,4);
}
// Label of a period key: "Mar 26" for a month, "W12 · 16 Mar" for a week (ISO week number).
function conFmtPer(k,week,short){
  if(!week||k.length===7)return conFmtMonth(k);
  var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var d=parseISODate(k),th=new Date(d.getFullYear(),d.getMonth(),d.getDate()+3);
  var j1=new Date(th.getFullYear(),0,4);
  var wn=1+Math.round(((th-j1)/86400000-3+((j1.getDay()+6)%7))/7);
  if(short)return d.getDate()+" "+M[d.getMonth()];
  return "W"+wn+" · "+d.getDate()+" "+M[d.getMonth()]+" "+String(d.getFullYear()).slice(2);
}
function _conNextMonth(k){var y=Number(k.slice(0,4)),m=Number(k.slice(5,7));m++;if(m>12){m=1;y++;}return y+"-"+(m<10?"0":"")+m;}
// Month by month: planned (theoretical spread over the WBS dates) and real (pours).
// pastReal ("Planned = real for the past"): the planned of the past is what was poured (up to
// the theoretical), and what is left of each WBS's theoretical is spread from tomorrow (or its
// start, if later) to its finish — the planned total always stays the theoretical.
function _conTomorrow(){var d=parseISODate(today());d.setDate(d.getDate()+1);return toISO(d);}
// week=true: the same, week by week (keys = Mondays). extraDates: dates (or YYYY-MM) to include.
function conSeries(wbsList,pours,typeIds,extraDates,pastReal,week){
  var plan={},real={},unscheduled=0,inList={};
  var tm=pastReal?_conTomorrow():"";
  wbsList.forEach(function(w){
    inList[w.id]=true;
    if(pastReal){
      var pr=conPastRealPieces(w,pours,typeIds,tm);
      pr.pieces.forEach(function(x){conSpread(x.q,x.from,x.to,plan,week);});
      unscheduled+=pr.rem;return;
    }
    var q=conSum(w.theo,typeIds);
    if(!conSpread(q,w.start,w.finish,plan,week))unscheduled+=q;
  });
  (pours||[]).forEach(function(p){
    if(!inList[p.wbsId])return;
    conSpread(conPourQty(p,typeIds),p.from||p.date,p.date,real,week);
  });
  var keys=Object.keys(plan).concat(Object.keys(real)).concat((extraDates||[]).map(function(d){return conPerKey(d,week);}).filter(Boolean)).sort();
  var nowK=conPerKey(today(),week);
  // months: the period keys (months, or Mondays with week) — name kept for the callers.
  var out={months:[],plan:[],real:[],cumPlan:[],cumReal:[],unscheduled:unscheduled,nowIdx:-1,week:!!week};
  if(!keys.length)return out;
  var cp=0,cr=0;
  var nextK=function(k){return week?toISO(_conPerNext(parseISODate(k),true)):_conNextMonth(k);};
  for(var k=keys[0];k<=keys[keys.length-1];k=nextK(k)){
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
        nPct:t.nPct,nNoPct:t.nNoPct,theoNoPct:t.theoNoPct,realNoPct:t.realNoPct,variance:t.variance,varPct:t.varPct,eac:t.eac,eacVar:t.eacVar,eacPct:t.eacPct,
        nRtsMissing:t.nRtsMissing,theoRtsMissing:t.theoRtsMissing||0};
    }).filter(function(p){return p.nPct>0;});
}
function conLatestCutoff(cutoffs){
  var last=null;
  (cutoffs||[]).forEach(function(c){if(c.date&&isValidDate(c.date)&&(!last||c.date>last.date))last=c;});
  return last;
}
function conLossCol(v){return v>CON_EPS?"#b3302a":v<-CON_EPS?"#1e6b3a":undefined;}
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
  // Drawings quantities are not split (they stay on the parent): a parent that still holds some is kept.
  var parentEmpty=!Object.keys(theoLeft).length&&!pours.some(function(p){return p.wbsId===parent.id;})&&!(conSum(parent.dwg,Object.keys(parent.dwg||{}))>CON_EPS);
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
  var s={done:["complete","#e6f2e9","#1e6b3a"],progress:["in progress","#e8f0fe","#0f5299"],todo:["not started","#eceae3","#555"]}[f.status];
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
  conNoteLive(wbs);
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
        <div className="page-title">Concrete</div>
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
function ConOverview({types,saveTypes,wbs,rawWbs,saveWbs,edit,pours,savePours,realIx,zones,cutoffs,saveCutoffs,onGo}){
  const [typeId,setTypeId]=useState("");
  const [zone,setZone]=useState("");
  const [showTable,setShowTable]=useState(false);
  const [byWeek,setByWeek]=useState(function(){try{return localStorage.getItem("pp_con_period")==="week";}catch(e){return false;}});
  function setPeriod(w){setByWeek(w);try{localStorage.setItem("pp_con_period",w?"week":"month");}catch(e){}}
  const [pastReal,setPastReal]=useState(function(){try{return localStorage.getItem("pp_con_pastreal")==="1";}catch(e){return false;}});
  function togglePastReal(){var v=!pastReal;setPastReal(v);try{localStorage.setItem("pp_con_pastreal",v?"1":"0");}catch(e){}}
  if(!wbs.length)return <div className="empty"><div className="empty-ico">🧱</div>
    <div className="empty-txt">{types.length?"No WBS yet. Start with the works done to date as one WBS, then add the WBS still to come.":"Start with the concrete types (grades), then the WBS."}</div>
    <div style={{marginTop:12}}><button className="btn btn-pri" onClick={function(){onGo(types.length?"wbs":"types");}}>{types.length?"Go to WBS":"Go to Types"}</button></div></div>;
  var typeIds=typeId?[typeId]:types.map(function(t){return t.id;});
  var list=wbs.filter(function(w){return !zone||w.zone===zone;});
  var tot=conTotals(list.map(function(w){return conWbsFigures(w,realIx,typeIds);}));
  // A project total typed by hand (no detail per WBS) counts in the theoretical shown, whole project only.
  var budTot=!zone?conSetTotals(types,list,"theo",typeIds):null;
  var theoShown=budTot&&budTot.manualOn?budTot.shown:tot.theo;
  var t0=today();
  var plannedToDate=conPlannedToDate(list,pours,typeIds,t0,pastReal);
  var ep=conEarnedPoints(cutoffs,list,pours,typeIds);
  var s=conSeries(list,pours,typeIds,ep.map(function(p){return p.date;}),pastReal,byWeek);
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
      <span style={{display:"inline-flex",gap:4}} title="Curve, bars and table month by month or week by week (Monday to Sunday)">
        <button className={"fchip"+(!byWeek?" on":"")} onClick={function(){setPeriod(false);}}>Months</button>
        <button className={"fchip"+(byWeek?" on":"")} onClick={function(){setPeriod(true);}}>Weeks</button>
      </span>
      <button className={"btn btn-sm"+(pastReal?" btn-pri":"")} onClick={togglePastReal}
        title={pastReal?"On: the planned of the past = what was poured; what each WBS still needs (theoretical − poured) is spread from tomorrow to its finish. The planned of a WBS always adds up to its theoretical, never to the poured. Click to go back to the theoretical spread over the WBS dates.":"Set the planned of the past equal to the real pours, and spread what remains of each WBS from tomorrow to its finish."}>
        {pastReal?"✓ ":""}Planned = real (past)</button>
      <button className="btn btn-sm" onClick={function(){conExportXlsx(types,list,pours,realIx,cutoffs,pastReal);}}>⤓ Excel</button>
      <button className="btn btn-sm" onClick={function(){conOpenReport(types,list,pours,realIx,typeIds,label,cutoffs,pastReal,byWeek);}}>Report</button>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
      <InvBig label="Theoretical" value={theoShown} unit={unit} sub={(budTot&&budTot.manualOn?"project total typed · "+conFmt(tot.theo)+" split on the WBS · ":"")+(s.unscheduled>CON_EPS?conFmt(s.unscheduled)+" "+unit+" without dates":list.length+" WBS")}/>
      <InvBig label="Planned to date" value={plannedToDate} unit={unit} sub={pastReal?"= poured, never above the theoretical of each WBS":"theoretical spread over the WBS dates"}/>
      <InvBig label="Poured to date" value={tot.real} unit={unit} sub="real volume (pours)"/>
      <InvBig label="Real progress (earned)" value={last?last.earned:null} unit={unit} colour={CON_COL_EARN}
        sub={last?"cut-off "+fmtDate(last.date)+" · "+(last.theoAll>0?(last.earned/last.theoAll*100).toFixed(1)+"% of budget":""):"needs a cut-off with progress % typed"}/>
      <InvBig label={"Concrete "+(last?conLossWord(last.variance):"loss / gain")} value={last?Math.abs(last.variance):null} unit={unit} colour={last?conLossCol(last.variance):null}
        sub={last?"poured "+conFmt(last.real)+" − earned "+conFmt(last.earned)+(last.varPct!==null?" ("+conPct(last.varPct)+")":"")+" · "+last.nPct+" WBS with progress":"real poured − earned, at a cut-off"}/>
      <InvBig label="EOS" value={last?last.eac:null} unit={unit} colour={last?conLossCol(last.eacVar):null}
        sub={last?"cut-off "+fmtDate(last.date)+" · poured + RTS real"+(last.nRtsMissing?" · ⚠ "+last.nRtsMissing+" WBS with something left and no RTS real":""):"from the cut-off"}/>
    </div>
    <ConTheoEditor types={types} saveTypes={saveTypes} allShown={!zone} list={list} rawWbs={rawWbs||wbs} saveWbs={saveWbs} edit={edit} realIx={realIx} typeId={typeId} pours={pours} savePours={savePours} cutoffs={cutoffs} saveCutoffs={saveCutoffs}/>
    {last&&last.nNoPct>0&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>⚠ At the cut-off of {fmtDate(last.date)}, {last.nNoPct} WBS have no progress % ({conFmt(last.theoNoPct)} {unit} budget, {conFmt(last.realNoPct)} {unit} poured): they are left out of the loss / gain.</div>}
    {!last&&<div style={{fontSize:12,color:"#555",marginBottom:10}}>The loss or gain of concrete is measured only at a cut-off, against the progress % typed for each WBS. <button className="btn btn-sm" onClick={function(){onGo("cutoff");}}>Go to the cut-offs</button></div>}
    {s.months.length>0?<>
      <ConCurve s={s} theoTotal={theoShown} earned={ep}/>
      <ConMonthly s={s}/>
      <div style={{margin:"4px 0 14px"}}><button className="btn btn-sm" onClick={function(){setShowTable(!showTable);}}>{showTable?"Hide":"Show"} the {byWeek?"week-by-week":"month-by-month"} table</button></div>
      {showTable&&<div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>{byWeek?"Week":"Month"}</th><th style={R}>Planned</th><th style={R}>Poured</th><th style={R}>Cum. planned</th><th style={R}>Cum. poured</th></tr></thead>
        <tbody>{s.months.map(function(k,i){
          return <tr key={k} style={{background:i===s.nowIdx?"var(--gold-soft)":undefined}}><td><b>{conFmtPer(k,s.week)}</b></td>
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
        <thead><tr><th>Type</th><th style={R}>Budget (WBS with %)</th><th style={R}>Earned</th><th style={R}>Poured</th><th style={R}>Loss (+) / gain (−)</th><th style={R}>%</th><th style={R}>RTS real</th><th style={R}>EOS</th><th style={R}>EOS − budget</th></tr></thead>
        <tbody>{byType.map(function(x){
          var t=x.tot;
          return <tr key={x.type.id}><td><b>{x.type.name}</b></td><td style={R}>{conFmt(t.theo)}</td><td style={R}>{conFmt(t.earned)}</td><td style={R}>{conFmt(t.real)}</td>
            <td style={Object.assign({fontWeight:700,color:conLossCol(t.variance)},R)}>{(t.variance>0?"+":"")+conFmt(t.variance)}</td><td style={Object.assign({color:conLossCol(t.variance)},R)}>{conPct(t.varPct)}</td>
            <td style={R}>{conFmt(t.rtsReal)}</td><td style={R}>{conFmt(t.eac)}</td><td style={Object.assign({color:conLossCol(t.eacVar)},R)}>{(t.eacVar>0?"+":"")+conFmt(t.eacVar)}</td></tr>;
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
    <div style={{fontSize:11,color:"#888"}}>Nothing here estimates progress. The loss or gain of concrete exists only at a cut-off: earned = budget × the progress % typed for each WBS, against the volume poured up to that date, on the WBS that have a %. {pastReal?"Planned = real for the past: up to today the planned is what was poured; what is left of each WBS's theoretical (theoretical − poured) is spread evenly from tomorrow, or its start if later, to its finish — on its finish for a complete WBS; an over-pour never raises the planned, which always adds up to the theoretical.":"Planned = theoretical spread evenly between each WBS's start and finish."} Poured = the pours.</div>
  </div>;
}
// Theoretical m³ per WBS and per type, typed straight in the overview (no dialog). Empty = none.
// The code and description of each WBS are typed in the same table; tick two WBS or more to merge
// them (budget and pours together, ConMergeModal).
// The theoretical is never taken from an imported workbook; the WBS created by an import carry
// "Created by the import" in their note, and their theoretical can be cleared here in one go.
function ConTheoEditor({types,saveTypes,allShown,list,rawWbs,saveWbs,edit,realIx,typeId,pours,savePours,cutoffs,saveCutoffs}){
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState("");
  const [sel,setSel]=useState({});
  const [merging,setMerging]=useState(false);
  // Which quantities the type columns edit: the budget (theo) or the drawings (dwg).
  const [qset,setQset]=useState(function(){try{return localStorage.getItem("pp_con_qset")==="dwg"?"dwg":"theo";}catch(e){return "theo";}});
  function pickSet(v){setQset(v);try{localStorage.setItem("pp_con_qset",v);}catch(e){}}
  pours=pours||[];cutoffs=cutoffs||[];
  var selIds=Object.keys(sel).filter(function(id){return sel[id]&&rawWbs.some(function(w){return w.id===id;});});
  function toggle(id){setSel(function(o){var n=Object.assign({},o);if(n[id])delete n[id];else n[id]=1;return n;});}
  // Rename: code (unique, required) or description. Returns false when refused.
  function rename(id,field,v){
    if(blockIfReadOnly())return false;
    var w=rawWbs.find(function(x){return x.id===id;});if(!w)return false;
    var d=Object.assign({},w);d[field]=v;
    var err=field==="code"?conWbsError(Object.assign({},d,{start:"",finish:""}),rawWbs):"";
    if(err){safeAlert(err);return false;}
    saveWbs(rawWbs.map(function(x){return x.id===id?Object.assign({},d,{updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""}):x;}));
    return true;
  }
  function setNote(id,v){
    if(blockIfReadOnly())return;
    saveWbs(rawWbs.map(function(w){
      if(w.id!==id)return w;
      var o=Object.assign({},w,{theoNote:v,theoNoteBy:window._currentUser?window._currentUser.name:"",theoNoteAt:new Date().toISOString()});
      if(!v){delete o.theoNote;delete o.theoNoteBy;delete o.theoNoteAt;}
      return o;
    }));
  }
  var nNotes=list.filter(function(w){return String(w.theoNote||"").trim();}).length;
  function applyMerge(keepId,ids,code,name){
    if(blockIfReadOnly())return;
    var res=conApplyMerge(keepId,ids,code,name,rawWbs,pours,cutoffs,types.map(function(t){return t.id;}));
    if(res.moved&&savePours)savePours(res.pours);
    if(saveCutoffs&&res.cutoffs.some(function(c,i){return c!==cutoffs[i];}))saveCutoffs(res.cutoffs);
    saveWbs(res.wbs);
    conMergeImpMap(keepId,ids);
    setSel({});setMerging(false);
  }
  var cols=conSortTypes(types).filter(function(t){
    if(typeId)return t.id===typeId;
    return !t.archived||list.some(function(w){return _invNum((w.theo||{})[t.id])>0||_invNum((w.dwg||{})[t.id])>0;});
  });
  var colIds=cols.map(function(t){return t.id;});
  var ql=q.trim().toLowerCase();
  var rows=conSortWbs(list).filter(function(w){return !ql||[w.code,w.name].join(" ").toLowerCase().indexOf(ql)>=0;});
  // Totals at the bottom. The project total of a type can be typed by hand (no detail per WBS),
  // only when the whole project is shown (no zone filter, no search).
  var whole=!!allShown&&!ql;
  var totB=conSetTotals(types,rows,"theo",colIds),totD=conSetTotals(types,rows,"dwg",colIds);
  var totCur=qset==="dwg"?totD:totB;
  function projOf(T){return whole?T.shown:T.detail;}
  function setManual(tid,v,f){
    if(blockIfReadOnly()||!saveTypes)return;
    var k=conManualKey(qset);
    saveTypes(types.map(function(t){
      if(t.id!==tid)return t;
      var o=Object.assign({},t);
      if(v===null){delete o[k];delete o[k+"F"];}else if(v<0){safeAlert("A total cannot be negative.");return t;}else{o[k]=v;if(f)o[k+"F"]=f;else delete o[k+"F"];}
      return o;
    }));
  }
  var realTot=rows.reduce(function(a,w){return a+conSum(realIx[w.id],colIds);},0);
  // Drawings − budget in total = the Drawings total − the Budget total shown in the same row.
  var gapD=projOf(totD),gapB=projOf(totB);
  var gapTot=gapD>CON_EPS?gapD-gapB:null;
  var imported=rawWbs.filter(function(w){return /Created by the import/i.test(w.note||"")&&conSum(w.theo,types.map(function(t){return t.id;}))>CON_EPS;});
  function setTheo(id,tid,v,f){
    if(blockIfReadOnly())return;
    saveWbs(rawWbs.map(function(w){
      if(w.id!==id)return w;
      var t=Object.assign({},w[qset]||{});if(v===null||!(v>0))delete t[tid];else t[tid]=v;
      var o=Object.assign({},w);o[qset]=t;
      if(qset==="dwg"&&!Object.keys(t).length)delete o.dwg;
      conSetFormula(o,qset,tid,v===null||!(v>0)?null:f);
      return o;
    }));
  }
  // Admin, one go: the budget and the drawings quantities change places on every WBS (e.g. the
  // quantities typed as budget were in fact the drawings). Clicking again puts them back.
  var isAdmin=isAppAdmin(window._currentUser&&window._currentUser.name);
  var nSwap=rawWbs.filter(function(w){return Object.keys(w.theo||{}).length||Object.keys(w.dwg||{}).length;}).length;
  function swapSets(){
    if(blockIfReadOnly())return;
    var allIds=types.map(function(t){return t.id;});
    var bud=rawWbs.reduce(function(a,w){return a+conSum(w.theo,allIds);},0),dw=rawWbs.reduce(function(a,w){return a+conSum(w.dwg,allIds);},0);
    if(!safeConfirm("Swap the budget and the drawings quantities on all "+nSwap+" WBS?\n\nBudget now: "+conFmt(bud)+" "+CON_UNIT+" → becomes the drawings.\nDrawings now: "+conFmt(dw)+" "+CON_UNIT+" → becomes the budget"+(dw>CON_EPS?"":" (empty: the budget is then to be typed)")+".\n\nPours, comments and cut-off % are not touched; the earned volumes of the cut-offs follow the new budget. Click the button again to swap back."))return;
    var by=window._currentUser?window._currentUser.name:"",at=new Date().toISOString();
    saveWbs(rawWbs.map(function(w){
      var th=Object.assign({},w.theo||{}),d=Object.assign({},w.dwg||{});
      if(!Object.keys(th).length&&!Object.keys(d).length)return w;
      var o=Object.assign({},w,{theo:d,updatedAt:at,updatedBy:by});
      if(Object.keys(th).length)o.dwg=th;else delete o.dwg;
      var tf=w.theoF,df=w.dwgF;delete o.theoF;delete o.dwgF;if(df)o.theoF=df;if(tf)o.dwgF=tf;
      return o;
    }));
    pickSet("theo");
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
      <span style={{fontSize:12,color:"#888"}}>{rows.length} WBS · budget {conFmt(rows.reduce(function(s,w){return s+conSum(w.theo,colIds);},0))} {CON_UNIT}{(function(){var d=rows.filter(function(w){return conSum(w.dwg,colIds)>CON_EPS;});return d.length?" · drawings "+conFmt(d.reduce(function(s,w){return s+conSum(w.dwg,colIds);},0))+" "+CON_UNIT+" on "+d.length+" WBS":"";})()}{edit?" · type the m³ in the cells, empty = none · code and description editable · tick WBS to merge them":""}</span>
      {nNotes>0&&<span className="pill" style={{background:"var(--gold-soft)",color:"var(--gold-ink)",cursor:"pointer"}} onClick={function(){setOpen(true);}} title="WBS with a comment on their budget">💬 {nNotes} comment{nNotes>1?"s":""}</span>}
      {edit&&open&&<button className="btn btn-sm" style={{marginLeft:"auto"}} disabled={selIds.length<2}
        title={selIds.length<2?"Tick two WBS or more in the table to merge them":"Merge the ticked WBS into one: budget added up, pours moved"}
        onClick={function(){setMerging(true);}}>⇄ Merge {selIds.length>=2?selIds.length+" ":""}WBS</button>}
      {edit&&open&&selIds.length>0&&<button className="btn btn-sm" onClick={function(){setSel({});}}>Clear selection ({selIds.length})</button>}
      {edit&&isAdmin&&open&&nSwap>0&&<button className="btn btn-sm" onClick={swapSets} title="Admin: on every WBS, the budget becomes the drawings quantities and the drawings become the budget. Click again to swap back.">⇄ Swap budget ⇄ drawings</button>}
      {edit&&imported.length>0&&<button className="btn btn-sm" style={{marginLeft:open?undefined:"auto",color:"#b3302a"}} onClick={clearImported}
        title="These WBS got their theoretical from the workbook's Theo Qty at an earlier import">✕ Clear the theoretical of {imported.length} imported WBS</button>}
    </div>
    {open&&<div style={{marginTop:10}}>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
        <input type="text" placeholder="Search code, description…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:220}}/>
        <span style={{fontSize:12,color:"#555"}}>Quantities per type:</span>
        <button className={"fchip"+(qset==="theo"?" on":"")} onClick={function(){pickSet("theo");}} title="The type columns show and edit the budget">Budget</button>
        <button className={"fchip"+(qset==="dwg"?" on":"")} onClick={function(){pickSet("dwg");}} title="The type columns show and edit the quantities measured on the drawings">Drawings (plans)</button>
      </div>
      <div style={{overflow:"auto",maxHeight:"65vh",border:"1px solid var(--rule)",borderRadius:"var(--r-sm)"}}><table className="tbl con-sticky" style={{overflow:"visible",border:"none"}}>
        <thead><tr>{edit&&<th style={{width:24}}/>}<th>WBS</th>{cols.map(function(t){return <th key={t.id} style={R} title={(qset==="dwg"?"Drawings":"Budget")+" m³ — "+t.name}>{t.name}<div style={{fontSize:9,fontWeight:400,color:qset==="dwg"?"var(--blue)":"#888"}}>{qset==="dwg"?"drawings":"budget"}</div></th>;})}
          <th style={R}>Budget</th><th style={R} title="Quantities measured on the drawings">Drawings</th><th style={R} title="Drawings − budget: > 0 the drawings need more than the budget">Drawings − budget</th><th style={R}>Poured</th><th title="Comment on the budget, e.g. a gap between the drawings and the budget">Comment</th></tr></thead>
        <tbody>{rows.map(function(w){
          var tot=conSum(w.theo,colIds),dw=conSum(w.dwg,colIds),hasDw=dw>CON_EPS,gap=dw-tot;
          return <tr key={w.id} style={sel[w.id]?{background:"var(--brand-soft)"}:undefined}>
            {edit&&<td><input type="checkbox" checked={!!sel[w.id]} onChange={function(){toggle(w.id);}} title="Tick to merge with other WBS"/></td>}
            {edit?<td style={{minWidth:300}}><div style={{display:"flex",gap:4}}>
                <ConTextCell value={w.code} width={96} bold={true} title="WBS code (unique) — Enter to save, Esc to cancel" onCommit={function(v){rename(w.id,"code",v);}}/>
                <ConTextCell value={w.name} placeholder="Description" title="Description — Enter to save, Esc to cancel" onCommit={function(v){rename(w.id,"name",v);}}/>
              </div></td>
            :<td><b>{w.code}</b> {w.name}</td>}
            {cols.map(function(t){var v=_invNum((w[qset]||{})[t.id]);
              return <td key={t.id} style={R}>{edit
                ?<ConNumCell key={qset} value={v||null} formula={(w[qset+"F"]||{})[t.id]} width={74} placeholder="—" title={(qset==="dwg"?"Drawings":"Budget")+" m³ — "+t.name+" · empty = none"} onCommit={function(nv,f){setTheo(w.id,t.id,nv,f);}}/>
                :(v?conFmt(v):"—")}</td>;})}
            <td style={Object.assign({fontWeight:qset==="theo"?700:400},R)}>{conFmt(tot)}</td>
            <td style={Object.assign({fontWeight:qset==="dwg"?700:400},R)}>{hasDw?conFmt(dw):<span style={{color:"#bbb"}}>—</span>}</td>
            <td style={Object.assign({fontWeight:700,color:hasDw?conLossCol(gap):undefined},R)}>{hasDw?<>{(gap>0?"+":"")+conFmt(gap)}{tot>CON_EPS&&<div style={{fontSize:10,fontWeight:400}}>{conPct(gap/tot*100)}</div>}</>:<span style={{color:"#bbb"}}>—</span>}</td>
            <td style={Object.assign({color:"#555"},R)}>{conFmt(conSum(realIx[w.id],colIds))}</td>
            <td style={{minWidth:240}} title={conTheoNoteTip(w)}>{edit
              ?<ConTextCell value={w.theoNote||""} placeholder="Comment, e.g. drawings rev C = +12 m³ vs budget" title={conTheoNoteTip(w)||"Comment on the budget — Enter to save, Esc to cancel"} onCommit={function(v){setNote(w.id,v);}}/>
              :<span style={{fontSize:12,color:"#555",whiteSpace:"pre-wrap"}}>{w.theoNote||""}</span>}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr>
          {edit&&<td/>}
          <td style={{fontWeight:700}}>Total — {rows.length} WBS{!whole&&<div style={{fontSize:10,fontWeight:400,color:"#888"}}>sum of the WBS shown{allShown?"":" (zone)"}</div>}</td>
          {cols.map(function(t){var x=totCur.byType[t.id]||{detail:0,manual:null,shown:0};
            var canType=edit&&whole&&!!saveTypes;
            return <td key={t.id} style={R}>
              {canType?<ConNumCell key={qset+t.id} value={x.manual} formula={t[conManualKey(qset)+"F"]} width={84} placeholder={conFmt(x.detail)} highlight={x.manual!==null}
                  title={"Total "+(qset==="dwg"?"drawings":"budget")+" — "+t.name+": type the project total if you do not have the detail per WBS. Empty = the sum of the WBS ("+conFmt(x.detail)+")."}
                  onCommit={function(v,f){setManual(t.id,v,f);}}/>
                :<b>{conFmt(whole?x.shown:x.detail)}</b>}
              {whole&&x.manual!==null&&<div style={{fontSize:10,color:"var(--gold-ink)"}} title="Typed by hand; the WBS detail is below">typed · WBS {conFmt(x.detail)}{Math.abs(x.manual-x.detail)>CON_EPS?" · not split "+(x.manual-x.detail>0?"+":"")+conFmt(x.manual-x.detail):""}</div>}
            </td>;})}
          <td style={Object.assign({fontWeight:700},R)}>{conFmt(projOf(totB))}{whole&&totB.manualOn&&<div style={{fontSize:10,fontWeight:400,color:"var(--gold-ink)"}}>WBS {conFmt(totB.detail)}</div>}</td>
          <td style={Object.assign({fontWeight:700},R)}>{projOf(totD)>CON_EPS?conFmt(projOf(totD)):"—"}{whole&&totD.manualOn&&<div style={{fontSize:10,fontWeight:400,color:"var(--gold-ink)"}}>WBS {conFmt(totD.detail)}</div>}</td>
          <td style={Object.assign({fontWeight:700,color:gapTot!==null?conLossCol(gapTot):undefined},R)} title="Drawings total − Budget total of this row">{gapTot!==null?<>{(gapTot>0?"+":"")+conFmt(gapTot)}{gapB>CON_EPS&&<div style={{fontSize:10,fontWeight:400}}>{conPct(gapTot/gapB*100)}</div>}</>:"—"}</td>
          <td style={Object.assign({fontWeight:700,color:"#555"},R)}>{conFmt(realTot)}</td>
          <td style={{fontSize:11,color:"#888"}}>{edit&&whole?"Type a type's total by hand when the detail per WBS is missing; clear it to go back to the sum.":""}</td>
        </tr></tfoot></table></div>
    </div>}
    {merging&&<ConMergeModal ids={selIds} wbs={rawWbs} types={types} realIx={realIx} pours={pours} cutoffs={cutoffs}
      onApply={applyMerge} onClose={function(){setMerging(false);}}/>}
  </div>;
}
// ---------------------------------------------------------------- merge WBS
// Several WBS become one, budget and spending together: the kept WBS takes the summed
// theoretical per type, every pour of the others (moved, never copied), the union of the
// schedule links, the earliest start / latest finish, and one line per cut-off. At a cut-off
// the merged progress % is weighted by the theoretical of each WBS, so the earned volume does
// not move; it stays empty when a WBS with a budget had no % there (nothing is invented).
// The RTS real typed is kept as the sum of what was typed on each WBS (untyped = 0, as in the EOS).
function conMergeCutoffs(cutoffs,keepId,ids,wbsById,typeIds){
  var inSet={};ids.forEach(function(id){inSet[id]=1;});
  var lost=0;
  var out=(cutoffs||[]).map(function(c){
    var mine=(c.lines||[]).filter(function(l){return inSet[l.id];});
    if(!mine.length)return c;
    var byId={};mine.forEach(function(l){byId[l.id]=l;});
    var num=0,den=0,all=true,anyPct=false;
    ids.forEach(function(id){
      var th=conSum((wbsById[id]||{}).theo,typeIds),l=byId[id];
      if(l&&_invHas(l.pct)){anyPct=true;num+=th*conClampPct(l.pct);den+=th;}
      else if(th>CON_EPS)all=false;
    });
    var ln={id:keepId};
    if(anyPct&&all)ln.pct=den>CON_EPS?Math.round(num/den*100)/100:conClampPct(mine.filter(function(l){return _invHas(l.pct);})[0].pct);
    else if(anyPct)lost++;
    // RTS real: the sum of what was TYPED on the parts (an untyped part counts 0, as in the EOS),
    // kept even when the % cannot be merged — so the EOS of the merged WBS = Σ EOS of the parts.
    var rts={},adj=false;
    typeIds.forEach(function(t){
      var s=0,a=false;
      ids.forEach(function(id){var l=byId[id]||{};if(l.rts&&_invHas(l.rts[t])){a=true;s+=_invNum(l.rts[t]);}});
      if(a){adj=true;rts[t]=Math.round(s*1000)/1000;}
    });
    if(adj)ln.rts=rts;
    var notes=mine.map(function(l){return String(l.note||"").trim();}).filter(Boolean);
    if(notes.length)ln.note=notes.join(" · ");
    ln.updatedAt=new Date().toISOString();ln.updatedBy=window._currentUser?window._currentUser.name:"";
    var lines=(c.lines||[]).filter(function(l){return !inSet[l.id];}).concat([ln]);
    return Object.assign({},c,{lines:lines});
  });
  return{cutoffs:out,lost:lost};
}
function conApplyMerge(keepId,ids,code,name,wbs,pours,cutoffs,typeIds){
  var wbsById={};wbs.forEach(function(w){wbsById[w.id]=w;});
  var inSet={};ids.forEach(function(id){inSet[id]=1;});
  var parts=ids.map(function(id){return wbsById[id];}).filter(Boolean);
  var keep=wbsById[keepId];
  var theo={};parts.forEach(function(w){Object.keys(w.theo||{}).forEach(function(t){var v=_invNum(w.theo[t]);if(v)theo[t]=Math.round(((theo[t]||0)+v)*1000)/1000;});});
  var dwg={};parts.forEach(function(w){Object.keys(w.dwg||{}).forEach(function(t){var v=_invNum(w.dwg[t]);if(v)dwg[t]=Math.round(((dwg[t]||0)+v)*1000)/1000;});});
  var starts=parts.map(function(w){return w.start;}).filter(Boolean).sort(),fins=parts.map(function(w){return w.finish;}).filter(Boolean).sort();
  var links=[],seen={};
  parts.forEach(function(w){(w.schedLinks||[]).forEach(function(l){var k=l.schedId+"|"+l.rowId;if(!seen[k]){seen[k]=1;links.push(l);}});});
  var others=parts.filter(function(w){return w.id!==keepId;});
  var stamp="Merged from "+others.map(conWbsLabel).join(", ")+" ("+fmtDate(today())+")";
  var merged=Object.assign({},keep,{code:code,name:name,theo:theo,start:starts[0]||"",finish:fins.length?fins[fins.length-1]:"",
    done:parts.every(function(w){return !!w.done;}),schedLinks:links,
    datesFromSched:links.length?parts.some(function(w){return !!w.datesFromSched;}):keep.datesFromSched,
    note:[String(keep.note||"").trim(),stamp].filter(Boolean).join("\n"),
    updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""});
  if(!links.length)delete merged.schedLinks;
  if(Object.keys(dwg).length)merged.dwg=dwg;else delete merged.dwg;
  delete merged.theoF;delete merged.dwgF;   // summed values: the formulas of the parts no longer apply
  var tn=parts.filter(function(w){return String(w.theoNote||"").trim();});
  if(tn.length){merged.theoNote=tn.length===1?tn[0].theoNote:tn.map(function(w){return (w.code||w.name)+": "+String(w.theoNote).trim();}).join(" · ");
    merged.theoNoteBy=window._currentUser?window._currentUser.name:"";merged.theoNoteAt=new Date().toISOString();}
  var newWbs=wbs.filter(function(w){return !inSet[w.id]||w.id===keepId;}).map(function(w){return w.id===keepId?merged:w;});
  var moved=0;
  var newPours=pours.map(function(p){if(inSet[p.wbsId]&&p.wbsId!==keepId){moved++;return Object.assign({},p,{wbsId:keepId});}return p;});
  var mc=conMergeCutoffs(cutoffs,keepId,ids,wbsById,typeIds);
  return{wbs:newWbs,pours:newPours,cutoffs:mc.cutoffs,moved:moved,lost:mc.lost};
}
// The Excel import remembers "description → WBS id" in this browser: point the merged ids to the kept one.
function conMergeImpMap(keepId,ids){
  var m=conImpMapLoad(),ch=false;
  Object.keys(m).forEach(function(k){if(ids.indexOf(m[k])>=0&&m[k]!==keepId){m[k]=keepId;ch=true;}});
  if(ch)conImpMapSave(m);
}
function ConMergeModal({ids,wbs,types,realIx,pours,cutoffs,onApply,onClose}){
  var typeIds=types.map(function(t){return t.id;});
  var parts=conSortWbs(wbs.filter(function(w){return ids.indexOf(w.id)>=0;}));
  function nPoursOf(id){return pours.filter(function(p){return p.wbsId===id;}).length;}
  var best=parts.slice().sort(function(a,b){return conSum(b.theo,typeIds)+conSum(realIx[b.id],typeIds)-conSum(a.theo,typeIds)-conSum(realIx[a.id],typeIds);})[0]||{};
  const [keepId,setKeepId]=useState(best.id||"");
  var keep=parts.find(function(w){return w.id===keepId;})||{};
  const [code,setCode]=useState(keep.code||"");
  const [name,setName]=useState(keep.name||"");
  function pick(w){setKeepId(w.id);setCode(w.code||"");setName(w.name||"");}
  var wbsById={};wbs.forEach(function(w){wbsById[w.id]=w;});
  var preview=conMergeCutoffs(cutoffs,keepId,parts.map(function(w){return w.id;}),wbsById,typeIds);
  var nCut=(cutoffs||[]).filter(function(c){return (c.lines||[]).some(function(l){return ids.indexOf(l.id)>=0;});}).length;
  var tById={};types.forEach(function(t){tById[t.id]=t;});
  var theo={},real={};
  parts.forEach(function(w){typeIds.forEach(function(t){theo[t]=(theo[t]||0)+_invNum((w.theo||{})[t]);real[t]=(real[t]||0)+_invNum((realIx[w.id]||{})[t]);});});
  var shownT=conSortTypes(types).filter(function(t){return theo[t.id]>CON_EPS||real[t.id]>CON_EPS;});
  var err=parts.length<2?"Select at least two WBS.":conWbsError({id:keepId,code:code,name:name},wbs.filter(function(w){return ids.indexOf(w.id)<0||w.id===keepId;}));
  var R={textAlign:"right"};
  return <InvModal title={"⇄ Merge "+parts.length+" WBS"} width={760} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!!err} title={err} onClick={function(){onApply(keepId,parts.map(function(w){return w.id;}),code.trim(),name.trim());}}>Merge into 1 WBS</button>
    </>}>
    <div style={{fontSize:12,color:"#555",marginBottom:8}}>The budget (theoretical per type) is added up and every pour is moved to the WBS kept: nothing is lost. The other WBS are removed. Schedule links are put together, dates run from the earliest start to the latest finish.</div>
    <table className="tbl" style={{fontSize:12,marginBottom:10}}>
      <thead><tr><th>Keep</th><th>WBS</th><th style={R}>Budget</th><th style={R}>Poured</th><th style={R}>Pours</th></tr></thead>
      <tbody>{parts.map(function(w){return <tr key={w.id} style={{cursor:"pointer"}} onClick={function(){pick(w);}}>
        <td><input type="radio" checked={w.id===keepId} onChange={function(){pick(w);}}/></td>
        <td><b>{w.code}</b> {w.name}</td>
        <td style={R}>{conFmt(conSum(w.theo,typeIds))}</td><td style={R}>{conFmt(conSum(realIx[w.id],typeIds))}</td><td style={R}>{nPoursOf(w.id)}</td></tr>;})}</tbody>
    </table>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
      <div className="fg" style={{flex:"0 0 160px"}}><label>Code of the merged WBS</label><input type="text" value={code} onChange={function(e){setCode(e.target.value);}}/></div>
      <div className="fg" style={{flex:"1 1 260px"}}><label>Description</label><input type="text" value={name} onChange={function(e){setName(e.target.value);}}/></div>
    </div>
    <table className="tbl" style={{fontSize:12,marginBottom:8}}>
      <thead><tr><th>Result</th>{shownT.map(function(t){return <th key={t.id} style={R}>{t.name}</th>;})}<th style={R}>Total</th></tr></thead>
      <tbody>
        <tr><td>Budget</td>{shownT.map(function(t){return <td key={t.id} style={R}>{conFmt(theo[t.id])}</td>;})}<td style={Object.assign({fontWeight:700},R)}>{conFmt(conSum(theo,typeIds))}</td></tr>
        <tr><td>Poured</td>{shownT.map(function(t){return <td key={t.id} style={R}>{conFmt(real[t.id])}</td>;})}<td style={Object.assign({fontWeight:700},R)}>{conFmt(conSum(real,typeIds))}</td></tr>
      </tbody>
    </table>
    {nCut>0&&<div style={{fontSize:12,color:"#555"}}>{nCut} cut-off{nCut>1?"s":""}: the progress % becomes one %, weighted by the budget of each WBS (the earned volume is unchanged).</div>}
    {preview.lost>0&&<div style={{fontSize:12,color:"#ef6c00",marginTop:4}}>⚠ At {preview.lost} cut-off{preview.lost>1?"s":""}, one of these WBS with a budget has no progress %: the merged WBS will have no % there (to type again in Cut-off cost control).</div>}
    {err&&<div style={{fontSize:12,color:"#b3302a",marginTop:6}}>{err}</div>}
  </InvModal>;
}
// A text typed in a table cell, saved when the cell is left or on Enter; Escape cancels.
// EXPLANATION of a cut-off line (the reason for its variances): free text, several lines,
// saved when the cell is left (Ctrl+Enter too), Esc cancels.
function ConExplCell({value,onCommit,ro}){
  const [txt,setTxt]=useState(value||"");
  const [focus,setFocus]=useState(false);
  const cancel=useRef(false);
  if(ro)return <div style={{whiteSpace:"pre-wrap",fontSize:12,minWidth:180,maxWidth:320}}>{value||""}</div>;
  return <textarea value={focus?txt:(value||"")} placeholder="Explain the variances…" rows={Math.min(4,Math.max(1,String((focus?txt:value)||"").split("\n").length))}
    onFocus={function(){cancel.current=false;setTxt(value||"");setFocus(true);}}
    onChange={function(e){setTxt(e.target.value);}}
    onBlur={function(){setFocus(false);if(cancel.current)return;var s=txt.trim();if(s!==String(value||"").trim())onCommit(s);}}
    onKeyDown={function(e){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))e.target.blur();if(e.key==="Escape"){cancel.current=true;e.target.blur();}}}
    style={{width:240,minWidth:180,padding:"4px 6px",fontSize:12,fontFamily:"inherit",resize:"vertical"}}/>;
}
function ConTextCell({value,onCommit,width,placeholder,title,bold}){
  const [txt,setTxt]=useState(value||"");
  const [focus,setFocus]=useState(false);
  const cancel=useRef(false);
  return <input type="text" value={focus?txt:(value||"")} placeholder={placeholder} title={title}
    onFocus={function(){cancel.current=false;setTxt(value||"");setFocus(true);}}
    onChange={function(e){setTxt(e.target.value);}}
    onBlur={function(){setFocus(false);if(cancel.current)return;var s=txt.trim();if(s!==String(value||"").trim())onCommit(s);}}
    onKeyDown={function(e){if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){cancel.current=true;e.target.blur();}}}
    style={{width:width||"100%",padding:"4px 6px",fontWeight:bold?700:undefined}}/>;
}
// Cumulative curve: planned and poured period by period (month or week); real progress (earned)
// only as points at the cut-offs, where a progress % was typed. No line is drawn between
// cut-offs. Same column layout as the bars: one column per period with separators, the
// cumulative value written at each point (planned above, poured below, or the other way round
// when the poured is ahead), sideways scroll with the y axis fixed on the left. Plain SVG.
function ConCurve({s,theoTotal,earned}){
  const [hi,setHi]=useState(null);
  earned=earned||[];
  var n=s.months.length,wk=!!s.week,H=300,L=58,Rm=14,T=20,B=wk?40:24;
  var lay=useConCols(n,wk,s.nowIdx,L,Rm),slot=lay.slot,Wp=lay.Wp;
  var max=_conNiceMax(Math.max.apply(null,s.cumPlan.concat(s.cumReal.filter(function(v){return v!==null;}),earned.map(function(p){return Math.max(p.realAll,p.realAll-p.variance);}),[theoTotal||0,1])));
  // cumulative at the END of period i = right edge of its column
  var x=function(i){return (i+1)*slot;};
  var y=function(v){return T+(H-T-B)*(1-Math.max(0,v)/max);};
  var xDate=function(d){
    var i=s.months.indexOf(conPerKey(d,wk));if(i<0)return null;
    var dt=parseISODate(d),frac;
    if(wk)frac=(((dt.getDay()+6)%7)+1)/7;
    else frac=dt.getDate()/new Date(dt.getFullYear(),dt.getMonth()+1,0).getDate();
    return i*slot+slot*frac;
  };
  var ePts=earned.map(function(p){return{p:p,x:xDate(p.date)};}).filter(function(e){return e.x!==null;});
  var lastE=ePts.length?ePts[ePts.length-1]:null;
  var pts=function(arr){var o=[];if(arr.length&&arr[0]!==null)o.push("0,"+y(0));arr.forEach(function(v,i){if(v!==null)o.push(x(i)+","+y(v));});return o.join(" ");};
  var grid=[0,.25,.5,.75,1];
  var per=wk?"week":"month";
  var hiCuts=hi===null?[]:ePts.filter(function(e){return conPerKey(e.p.date,wk)===s.months[hi];});
  // a value next to its point, inside its column (right-aligned on the point)
  var lab=function(v,i,above,col,bold){
    var yy=y(v)+(above?-6:13);if(yy<10)yy=y(v)+13;if(yy>H-B-2)yy=y(v)-6;
    return <text x={x(i)-3} y={yy} fontSize="9.5" textAnchor="end" fill={col} fontWeight={bold?700:600}>{invFmt(v,0)}</text>;
  };
  return <div className="card" style={{position:"relative",marginBottom:10}}>
    <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,color:"#555",marginBottom:4,alignItems:"center"}}>
      <b style={{color:"var(--ink)"}}>Cumulative quantity ({CON_UNIT}) · per {per}</b>
      <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_PLAN} strokeWidth="2"/></svg> Planned (theoretical)</span>
      <span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke={CON_COL_REAL} strokeWidth="2"/></svg> Poured</span>
      <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:"var(--gold-soft)",border:"1px solid #e0cf9a",verticalAlign:"middle",marginRight:4}}/>This {per}</span>
      {ePts.length>0&&<span><svg width="12" height="10"><circle cx="6" cy="5" r="4" fill={CON_COL_EARN} stroke="#fff" strokeWidth="1.5"/></svg> Real progress at each cut-off — its gap to the poured volume is the loss / gain on the WBS with a %</span>}
      {lastE&&<span style={{fontWeight:700,color:conLossCol(lastE.p.variance)}}>Concrete {conLossWord(lastE.p.variance)} at {fmtDate(lastE.p.date)}: {lastE.p.variance>0?"+":lastE.p.variance<0?"−":""}{conFmt(Math.abs(lastE.p.variance))} {CON_UNIT}</span>}
      {lay.scrolls&&<span style={{color:"#888"}}>← scroll sideways →</span>}
    </div>
    <div ref={lay.boxRef} style={{position:"relative",display:"flex"}}>
      <svg width={L} height={H} style={{flex:"0 0 auto",display:"block"}}>
        {grid.map(function(g){return <text key={g} x={L-6} y={y(max*g)+3} fontSize="10" textAnchor="end" fill="#888">{invFmt(max*g,0)}</text>;})}
      </svg>
      <div ref={lay.scRef} style={{overflowX:"auto",overflowY:"hidden",flex:"1 1 auto",position:"relative"}}>
        <div style={{position:"relative",width:Wp}}>
        <svg width={Wp} height={H} style={{display:"block"}} onMouseLeave={function(){setHi(null);}}>
          {s.months.map(function(k,i){return <ConColFrame key={k} s={s} i={i} slot={slot} top={T-10} base={H-B} H={H}/>;})}
          <line x1={n*slot} x2={n*slot} y1={T-10} y2={H-B} stroke="#e6e2d8"/>
          {wk&&<line x1={0} x2={n*slot} y1={H-B+18} y2={H-B+18} stroke="#e6e2d8"/>}
          {grid.map(function(g){return <line key={g} x1={0} x2={n*slot} y1={y(max*g)} y2={y(max*g)} stroke={g===0?"#bbb":"#eee"}/>;})}
          {theoTotal>0&&<g><line x1={0} x2={n*slot} y1={y(theoTotal)} y2={y(theoTotal)} stroke="#bbb" strokeDasharray="2 3"/>
            {s.months.map(function(k,i){var every=Math.max(1,Math.round(700/slot));return i%every===0?<text key={k} x={i*slot+6} y={y(theoTotal)-4} fontSize="10" fill="#888">theoretical total {conFmt(theoTotal)}</text>:null;})}</g>}
          <polyline points={pts(s.cumPlan)} fill="none" stroke={CON_COL_PLAN} strokeWidth="2" strokeLinejoin="round"/>
          <polyline points={pts(s.cumReal)} fill="none" stroke={CON_COL_REAL} strokeWidth="2" strokeLinejoin="round"/>
          {s.months.map(function(k,i){
            var p=s.cumPlan[i],r=s.cumReal[i],planUp=r===null||p>=r;
            return <g key={k} opacity={hi===null||hi===i?1:.45}>
              <circle cx={x(i)} cy={y(p)} r="2.5" fill={CON_COL_PLAN}/>
              {r!==null&&<circle cx={x(i)} cy={y(r)} r="2.5" fill={CON_COL_REAL}/>}
              {lab(p,i,planUp,"#7a6120")}
              {r!==null&&lab(r,i,!planUp,"#1f4f85",i===s.nowIdx)}
            </g>;
          })}
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
            <line x1={x(hi)} x2={x(hi)} y1={T-10} y2={H-B} stroke="#888"/>
            <circle cx={x(hi)} cy={y(s.cumPlan[hi])} r="4" fill={CON_COL_PLAN} stroke="#fff" strokeWidth="2"/>
            {s.cumReal[hi]!==null&&<circle cx={x(hi)} cy={y(s.cumReal[hi])} r="4" fill={CON_COL_REAL} stroke="#fff" strokeWidth="2"/>}
          </g>}
          {s.months.map(function(k,i){return <rect key={k} x={i*slot} y={T-10} width={slot} height={H-T-B+10} fill="transparent" onMouseEnter={function(){setHi(i);}}/>;})}
        </svg>
        {hi!==null&&<div style={{position:"absolute",top:6,left:x(hi),transform:x(hi)>Wp/2?"translateX(calc(-100% - 12px))":"translateX(12px)",background:"#fff",border:"1px solid #ddd",borderRadius:8,padding:"6px 10px",fontSize:12,pointerEvents:"none",boxShadow:"0 2px 8px rgba(0,0,0,.08)",whiteSpace:"nowrap",zIndex:2}}>
          <b>{conFmtPer(s.months[hi],wk)}</b> <span style={{color:"#888"}}>— cumulative at the end of the {per}</span>
          <div>Planned: <b>{conFmt(s.cumPlan[hi])}</b> <span style={{color:"#888"}}>(+{conFmt(s.plan[hi])} this {per})</span></div>
          <div>Poured: <b>{s.cumReal[hi]===null?"—":conFmt(s.cumReal[hi])}</b>{s.real[hi]!==null&&<span style={{color:"#888"}}> (+{conFmt(s.real[hi])} this {per})</span>}</div>
          {s.cumReal[hi]!==null&&<div>Poured − planned: <b>{s.cumReal[hi]-s.cumPlan[hi]>0?"+":""}{conFmt(s.cumReal[hi]-s.cumPlan[hi])}</b></div>}
          {hiCuts.map(function(e){return <div key={e.p.date} style={{borderTop:"1px solid #eee",marginTop:4,paddingTop:4}}>
            Cut-off {fmtDate(e.p.date)}: earned <b>{conFmt(e.p.earned)}</b>, poured <b>{conFmt(e.p.real)}</b>
            <div>Concrete {conLossWord(e.p.variance)}: <b style={{color:conLossCol(e.p.variance)}}>{conFmt(Math.abs(e.p.variance))}</b> <span style={{color:"#888"}}>({e.p.nPct} WBS with %)</span></div></div>;})}
        </div>}
        </div>
      </div>
    </div>
  </div>;
}
// Per period (month or week): planned vs real volumes — what the supply has to deliver next.
// One column per period with a separator line, the value above each bar, the week number and a
// month band below (weeks). Columns never shrink below a readable width: the chart scrolls
// sideways (y axis fixed on the left) and opens on the current period.
// Column layout shared by the curve and the bars: one column per period, never narrower than
// a readable width (48 px a week, 56 px a month) — wider charts scroll sideways, opened on the
// current period.
function useConCols(n,wk,nowIdx,L,Rm){
  const [cw,setCw]=useState(760);
  const boxRef=useRef(null),scRef=useRef(null);
  useEffect(function(){
    var el=boxRef.current;if(!el)return;
    var upd=function(){if(el.clientWidth)setCw(el.clientWidth);};upd();
    if(window.ResizeObserver){var ro=new ResizeObserver(upd);ro.observe(el);return function(){ro.disconnect();};}
    window.addEventListener("resize",upd);return function(){window.removeEventListener("resize",upd);};
  },[]);
  var slot=Math.max(wk?48:56,(cw-L-Rm)/Math.max(1,n));
  useEffect(function(){
    var el=scRef.current;if(!el||nowIdx<0)return;
    el.scrollLeft=Math.max(0,nowIdx*slot-el.clientWidth*0.35);
  },[n,wk,Math.round(slot)]);
  return{boxRef:boxRef,scRef:scRef,slot:slot,cw:cw,Wp:Math.ceil(n*slot)+Rm,scrolls:Math.ceil(n*slot)+Rm>cw-L};
}
var CON_MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function _conNewMonth(s,i){
  if(i===0)return true;
  return s.week?parseISODate(s.months[i-1]).getMonth()!==parseISODate(s.months[i]).getMonth():s.months[i].slice(5,7)==="01";
}
// Separators, period labels (week number + month band, or month) and the current-period band
// of one column. top / base = y of the plot area.
function ConColFrame({s,i,slot,top,base,H}){
  var k=s.months[i],wk=!!s.week,x0=i*slot,cx=x0+slot/2,nm=_conNewMonth(s,i),now=i===s.nowIdx;
  var d=wk?parseISODate(k):null;
  return <g>
    {now&&<rect x={x0} y={top} width={slot} height={base-top} fill="var(--gold-soft)"/>}
    <line x1={x0} x2={x0} y1={top} y2={wk&&nm?H-2:base+(wk?16:0)} stroke={nm?"#b9b2a3":"#e6e2d8"} strokeWidth={nm?1.2:1}/>
    {wk?<>
      <text x={cx} y={base+13} fontSize="10" textAnchor="middle" fill={now?"var(--ink)":"#777"} fontWeight={now?700:400}>W{_conWeekNo(k)}</text>
      {nm&&<text x={x0+4} y={H-6} fontSize="10.5" fill="#555" fontWeight="600">{CON_MON[d.getMonth()]+" "+String(d.getFullYear()).slice(2)}</text>}
    </>:<text x={cx} y={base+14} fontSize="10.5" textAnchor="middle" fill={now?"var(--ink)":"#666"} fontWeight={now||nm?700:400}>{conFmtMonth(k)}</text>}
  </g>;
}
function _conWeekNo(k){var d=parseISODate(k),th=new Date(d.getFullYear(),d.getMonth(),d.getDate()+3),j1=new Date(th.getFullYear(),0,4);
  return 1+Math.round(((th-j1)/86400000-3+((j1.getDay()+6)%7))/7);}
function ConMonthly({s}){
  const [hi,setHi]=useState(null);
  var n=s.months.length,wk=!!s.week,H=270,L=52,Rm=10,T=22,B=wk?40:24;
  var lay=useConCols(n,wk,s.nowIdx,L,Rm),boxRef=lay.boxRef,scRef=lay.scRef,slot=lay.slot,Wp=lay.Wp,cw=lay.cw;
  var max=_conNiceMax(Math.max.apply(null,s.plan.concat(s.real.filter(function(v){return v!==null;}),[1])));
  var bw=Math.max(4,Math.min(22,(slot-10)/2));
  var y=function(v){return T+(H-T-B)*(1-Math.max(0,v)/max);};
  var grid=[0,.25,.5,.75,1];
  var per=wk?"week":"month";
  // value above a bar: horizontal when it fits, else written upwards
  var val=function(v,cx,col){
    if(!(v>CON_EPS))return null;
    var t=invFmt(v,0),wide=t.length*5.4>bw+8,yy=y(v)-4;
    return wide?<text x={cx+3} y={yy} fontSize="9.5" fill={col} fontWeight="600" transform={"rotate(-90 "+(cx+3)+" "+yy+")"}>{t}</text>
      :<text x={cx} y={yy} fontSize="9.5" textAnchor="middle" fill={col} fontWeight="600">{t}</text>;
  };
  var mi=hi;
  return <div className="card" style={{position:"relative",marginBottom:4}}>
    <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,color:"#555",marginBottom:4,alignItems:"center"}}>
      <b style={{color:"var(--ink)"}}>Per {per} ({CON_UNIT})</b>
      <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:CON_COL_PLAN,verticalAlign:"middle",marginRight:4}}/>Planned</span>
      <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:CON_COL_REAL,verticalAlign:"middle",marginRight:4}}/>Real</span>
      <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:"var(--gold-soft)",border:"1px solid #e0cf9a",verticalAlign:"middle",marginRight:4}}/>This {per}</span>
      {Wp>cw-L&&<span style={{color:"#888"}}>← scroll sideways →</span>}
    </div>
    <div ref={boxRef} style={{position:"relative",display:"flex"}}>
      <svg width={L} height={H} style={{flex:"0 0 auto",display:"block"}}>
        {grid.map(function(g){return <text key={g} x={L-6} y={y(max*g)+3} fontSize="10" textAnchor="end" fill="#888">{invFmt(max*g,0)}</text>;})}
      </svg>
      <div ref={scRef} style={{overflowX:"auto",overflowY:"hidden",flex:"1 1 auto",position:"relative"}}>
        <div style={{position:"relative",width:Wp}}>
        <svg width={Wp} height={H} style={{display:"block"}} onMouseLeave={function(){setHi(null);}}>
          {s.months.map(function(k,i){return <ConColFrame key={k} s={s} i={i} slot={slot} top={T-14} base={H-B} H={H}/>;})}
          {grid.map(function(g){return <line key={g} x1={0} x2={n*slot} y1={y(max*g)} y2={y(max*g)} stroke={g===0?"#bbb":"#eee"}/>;})}
          {s.months.map(function(k,i){
            var x0=i*slot,cx=x0+slot/2;
            var hp=H-B-y(s.plan[i]),hr=s.real[i]===null?0:H-B-y(s.real[i]);
            return <g key={k}>
              <g opacity={hi===null||hi===i?1:.5}>
                {hp>0&&<rect x={cx-bw-1} y={y(s.plan[i])} width={bw} height={hp} rx="2" fill={CON_COL_PLAN}/>}
                {hr>0&&<rect x={cx+1} y={y(s.real[i])} width={bw} height={hr} rx="2" fill={CON_COL_REAL}/>}
                {val(s.plan[i],cx-bw/2-1,"#7a6120")}
                {s.real[i]!==null&&val(s.real[i],cx+bw/2+1,"#1f4f85")}
              </g>
              <rect x={x0} y={T-14} width={slot} height={H-T-B+14} fill="transparent" onMouseEnter={function(){setHi(i);}}/>
            </g>;
          })}
          <line x1={n*slot} x2={n*slot} y1={T-14} y2={H-B} stroke="#e6e2d8"/>
          {wk&&<line x1={0} x2={n*slot} y1={H-B+18} y2={H-B+18} stroke="#e6e2d8"/>}
        </svg>
        {mi!==null&&<div style={{position:"absolute",top:6,left:mi*slot+slot/2,transform:mi*slot>Wp/2?"translateX(calc(-100% - 14px))":"translateX(14px)",background:"#fff",border:"1px solid #ddd",borderRadius:8,padding:"6px 10px",fontSize:12,pointerEvents:"none",boxShadow:"0 2px 8px rgba(0,0,0,.08)",whiteSpace:"nowrap",zIndex:2}}>
          <b>{conFmtPer(s.months[mi],wk)}</b>
          <div>Planned: <b>{conFmt(s.plan[mi])}</b></div>
          <div>Real: <b>{s.real[mi]===null?"—":conFmt(s.real[mi])}</b>{s.real[mi]!==null&&<span style={{color:conLossCol(s.real[mi]-s.plan[mi])}}> ({s.real[mi]-s.plan[mi]>0?"+":""}{conFmt(s.real[mi]-s.plan[mi])})</span>}</div>
          <div style={{color:"#888"}}>Cumulative: planned {conFmt(s.cumPlan[mi])} · poured {s.cumReal[mi]===null?"—":conFmt(s.cumReal[mi])}</div>
        </div>}
        </div>
      </div>
    </div>
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
  // Drawings (plans) next to the budget; drawings − budget on the WBS that have drawings.
  function dwgOf(w,ids){return conSum(w.dwg,ids||typeIds);}
  var totDwg=0,totDwgB=0,nDwg=0;
  list.forEach(function(f){var d=dwgOf(f.wbs);if(d>CON_EPS){nDwg++;totDwg+=d;totDwgB+=f.theo;}});
  // The latest cut-off: progress typed by hand there, and the loss / gain it measures.
  var lc=conLatestCutoff(cutoffs);
  var cutRows={};
  if(lc)conCutoffRows(lc,list.map(function(f){return f.wbs;}),pours,typeIds).forEach(function(r){cutRows[r.wbs.id]=r;});
  var cutTot=lc?conCutoffTotals(Object.keys(cutRows).map(function(k){return cutRows[k];})):null;
  function cutCells(r){
    if(!lc)return null;
    if(!r||!r.hasPct)return [<td key="p" style={Object.assign({color:"#bbb"},R)}>—</td>,<td key="pc" style={R}>{r?conFmt(r.real):"—"}</td>,<td key="e" style={Object.assign({color:"#bbb"},R)}>—</td>,<td key="v" style={Object.assign({color:"#bbb"},R)}>—</td>,<td key="d" style={Object.assign({color:"#bbb"},R)}>—</td>];
    return [<td key="p" style={R}>{r.pct.toFixed(0)}%</td>,<td key="pc" style={R}>{conFmt(r.real)}</td>,<td key="e" style={R}>{conFmt(r.earned)}</td>,
      <td key="v" style={Object.assign({fontWeight:700,color:conLossCol(r.variance)},R)}>{(r.variance>0?"+":"")+conFmt(r.variance)}{r.varPct!==null&&<div style={{fontSize:10,fontWeight:400}}>{conPct(r.varPct)}</div>}</td>,
      <td key="d" style={Object.assign({fontWeight:700,color:r.varDwg===null?"#bbb":conLossCol(r.varDwg)},R)} title="Poured − drawings × progress %">{r.varDwg===null?"—":<>{(r.varDwg>0?"+":"")+conFmt(r.varDwg)}{r.varDwgPct!==null&&<div style={{fontSize:10,fontWeight:400}}>{conPct(r.varDwgPct)}</div>}</>}</td>];
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
  // set: "theo" (budget) or "dwg" (drawings)
  function setQty(w,set,tid,v,f){
    var t=Object.assign({},w[set]||{});
    if(v===null||!(v>0))delete t[tid];else t[tid]=v;
    var fo={};fo[set+"F"]=w[set+"F"];
    var o=conSetFormula(fo,set,tid,v===null||!(v>0)?null:f);
    var patch={};patch[set]=Object.keys(t).length||set==="theo"?t:undefined;patch[set+"F"]=o[set+"F"];
    updW(w.id,patch);
  }
  function setTheo(w,tid,v,f){setQty(w,"theo",tid,v,f);}
  // One quantity cell (budget or drawings) of the main row or of a type row.
  function qtyCell(w,set,tid,showType){
    var v=_invNum((w[set]||{})[tid]);
    var nm=(types.find(function(t){return t.id===tid;})||{}).name||"";
    return <span style={{display:"inline-flex",gap:3,alignItems:"center"}}>
      <ConNumCell value={v||null} formula={(w[set+"F"]||{})[tid]} width={80} placeholder={set==="dwg"?"—":"m³"} title={(set==="dwg"?"Drawings":"Budget")+" m³ — "+nm+" · empty = none"} onCommit={function(nv,f){setQty(w,set,tid,nv,f);}}/>
      {showType&&<span style={{fontSize:10,color:"#888"}}>{nm}</span>}
      {v>0&&<button type="button" title={"Delete this "+(set==="dwg"?"drawings":"budget")+" quantity"} onClick={function(){setQty(w,set,tid,null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#bbb",fontSize:13,padding:"0 2px"}}>✕</button>}
    </span>;
  }
  function gapCell(b,d){
    if(!(d>CON_EPS))return <td style={Object.assign({color:"#bbb"},R)}>—</td>;
    var g=d-b,p=b>CON_EPS?g/b*100:null;
    return <td style={Object.assign({fontWeight:700,color:conLossCol(g)},R)}>{(g>0?"+":"")+conFmt(g)}{p!==null&&<div style={{fontSize:10,fontWeight:400}}>{conPct(p)}</div>}</td>;
  }
  // The type whose theoretical the main row edits: the filtered type, or the WBS's only type.
  function rowType(w){
    if(typeId)return typeId;
    var ks=Object.keys(Object.assign({},w.theo||{},w.dwg||{})).filter(function(k){return _invNum((w.theo||{})[k])>0||_invNum((w.dwg||{})[k])>0;});
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
      <thead><tr><th>WBS</th><th>Zone</th><th>Planned</th><th>Status</th><th style={R}>Budget</th><th style={R} title="Quantities measured on the drawings">Drawings</th><th style={R} title="Drawings − budget: > 0 the drawings need more than the budget">Drawings − budget</th><th style={R} title="Every pour recorded so far (the loss / gain uses the poured at the cut-off)">Poured to date</th>
        {lc&&<><th style={R} title={"Progress % typed at the cut-off of "+fmtDate(lc.date)}>Progress {fmtDate(lc.date)}</th><th style={R} title="Concrete poured up to the cut-off date: the figure the loss / gain is measured on">Poured at cut-off</th><th style={R} title="Budget × progress %">Earned</th><th style={R} title="Poured up to the cut-off − budget × progress: > 0 loss, < 0 gain">vs budget<div style={{fontSize:9,fontWeight:400}}>loss (+) / gain (−)</div></th><th style={R} title="Poured up to the cut-off − drawings × progress: > 0 loss, < 0 gain">vs drawings<div style={{fontSize:9,fontWeight:400}}>loss (+) / gain (−)</div></th></>}<th/></tr></thead>
      <tbody>{list.map(function(f){
        var w=f.wbs;
        var rows=[<tr key={w.id} onClick={function(){setEditing(w);}} style={{cursor:"pointer"}}>
          <td title="Open the WBS (code, name, zone, schedule links)"><b>{w.code}</b> {w.name}{w.splitFrom&&<div style={{fontSize:10,color:"#888"}}>split from {w.splitFrom}</div>}{w.theoNote&&<div style={{fontSize:11,color:"var(--gold-ink)",fontStyle:"italic"}} title={conTheoNoteTip(w)}>💬 {w.theoNote}</div>}</td>
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
            return qtyCell(w,"theo",rt,!typeId);})()}</td>
          <td style={R} onClick={edit?function(e){e.stopPropagation();}:undefined}>{(function(){
            var rt=edit?rowType(w):"",d=dwgOf(w);
            if(!rt)return d>CON_EPS?<span title={edit?"Several types: edit them with “Detail per type”":""}>{conFmt(d)}</span>:<span style={{color:"#ccc"}}>—</span>;
            return qtyCell(w,"dwg",rt,false);})()}</td>
          {gapCell(f.theo,dwgOf(w))}
          <td style={R}>{conFmt(f.real)}</td>
          {cutCells(cutRows[w.id])}
          <td onClick={function(e){e.stopPropagation();}}>{edit&&(conSum(w.theo,allTypeIds)>CON_EPS||conSum(realIx[w.id],allTypeIds)>CON_EPS)&&<button className="btn btn-sm" title="Split into detailed WBS" onClick={function(){setSplitting(w);}}>✂ Split</button>}</td>
        </tr>];
        if(detail&&!typeId)sortedTypes.forEach(function(t){
          var tf=conWbsFigures(w,realIx,[t.id]);
          var tdw=dwgOf(w,[t.id]);
          if(!edit&&tf.theo<=CON_EPS&&tf.real<=CON_EPS&&tdw<=CON_EPS)return;
          rows.push(<tr key={w.id+t.id} style={{fontSize:12,color:"#555",background:"#fbfaf7"}}>
            <td style={{paddingLeft:24}}>{t.name}</td><td/><td/><td/>
            <td style={R}>{edit?qtyCell(w,"theo",t.id,false):conFmt(tf.theo)}</td>
            <td style={R}>{edit?qtyCell(w,"dwg",t.id,false):(tdw>CON_EPS?conFmt(tdw):"—")}</td>
            {gapCell(tf.theo,tdw)}
            <td style={R}>{conFmt(tf.real)}</td>
            {lc&&cutCells(conCutoffRows(lc,[w],pours,[t.id])[0])}<td/></tr>);
        });
        return rows;
      })}
      <tr style={{fontWeight:700,background:"#f7f6f2"}}><td colSpan={4}>Total — {list.length} WBS</td>
        <td style={R}>{conFmt(tot.theo)}</td><td style={R}>{nDwg?conFmt(totDwg):"—"}{nDwg>0&&nDwg<list.length&&<div style={{fontSize:10,fontWeight:400,color:"#888"}}>{nDwg} WBS</div>}</td>
        {(function(){if(!nDwg)return <td style={R}>—</td>;var g=totDwg-tot.theo,p=tot.theo>CON_EPS?g/tot.theo*100:null;
          return <td style={Object.assign({color:conLossCol(g)},R)} title="Drawings total − Budget total">{(g>0?"+":"")+conFmt(g)}{p!==null&&<div style={{fontSize:10,fontWeight:400}}>{conPct(p)}</div>}</td>;})()}
        <td style={R}>{conFmt(tot.real)}</td>
        {lc&&<><td style={R}>{cutTot.nPct} WBS</td><td style={R}>{conFmt(cutTot.realAll)}</td><td style={R}>{conFmt(cutTot.earned)}</td><td style={Object.assign({color:conLossCol(cutTot.variance)},R)}>{cutTot.nPct?(cutTot.variance>0?"+":"")+conFmt(cutTot.variance):"—"}</td>
          <td style={Object.assign({color:cutTot.nDwg?conLossCol(cutTot.varDwg):undefined},R)}>{cutTot.nDwg?(cutTot.varDwg>0?"+":"")+conFmt(cutTot.varDwg):"—"}</td></>}<td/></tr>
      </tbody></table></div>}
    <div style={{fontSize:11,color:"#888",marginTop:8}}>Poured = the pours, a volume, not a progress. {lc?"The loss / gain comes from the cut-off of "+fmtDate(lc.date)+": vs budget = poured − budget × the progress % typed there, vs drawings = poured − drawings × the same %; a WBS without a % (or without drawings) shows —.":"The loss / gain of concrete appears once a cut-off has progress % typed by hand."} {edit?"Planned dates, budget and drawings m³ are edited in the table (a formula such as =12,5*3 works) (✕ clears them; with several types use “Detail per type”). Click the WBS name for the other fields.":"Click a WBS to see its details."}</div>
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
        if(cutoffs&&cutoffs.length&&saveCutoffs)saveCutoffs(conSplitCutoffs(cutoffs,splitting.id,kids,gone,res.wbs));
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
// Comment on the budget of a WBS (e.g. a gap between the quantities on the drawings and the
// budget), typed in Overview › Theoretical per WBS. theoNote + who / when; separate from note.
function conTheoNoteTip(w){return w&&w.theoNote?w.theoNote+(w.theoNoteBy?"\n— "+w.theoNoteBy+(w.theoNoteAt?", "+fmtDate(String(w.theoNoteAt).slice(0,10)):""):""):"";}
// Project total per type typed by hand (when the detail per WBS is not known): stored on the
// type, t.budgetTotal (budget) / t.dwgTotal (drawings). Empty = the sum of the WBS.
function conManualKey(set){return set==="dwg"?"dwgTotal":"budgetTotal";}
// Formulas typed in the quantity cells, kept next to their results: w.theoF / w.dwgF {typeId: "=…"}
// and, for the typed project totals, t.budgetTotalF / t.dwgTotalF. Only the result is ever used.
function conSetFormula(o,set,tid,f){
  var k=set+"F",m=Object.assign({},o[k]||{});
  if(f)m[tid]=f;else delete m[tid];
  if(Object.keys(m).length)o[k]=m;else delete o[k];
  return o;
}
function conManualTotal(t,set){var v=t?t[conManualKey(set)]:null;return _invHas(v)?_invNum(v):null;}
// Per type over the given WBS: detail (sum of the WBS), manual (typed or null), shown (manual, else detail).
function conSetTotals(types,list,set,typeIds){
  var out={detail:0,shown:0,manualOn:false,byType:{}};
  (types||[]).forEach(function(t){
    if(typeIds.indexOf(t.id)<0)return;
    var d=list.reduce(function(a,w){return a+_invNum((w[set]||{})[t.id]);},0),m=conManualTotal(t,set);
    out.byType[t.id]={detail:d,manual:m,shown:m===null?d:m};
    out.detail+=d;out.shown+=(m===null?d:m);if(m!==null)out.manualOn=true;
  });
  return out;
}
// WBS saved from its dialog: empty drawings dropped, and a kept formula dropped when the value
// was changed there by hand (the formula would no longer give it).
function conCleanDwg(d){
  var o=Object.assign({},d),dw=conCleanTheo(d.dwg);
  if(Object.keys(dw).length)o.dwg=dw;else delete o.dwg;
  ["theo","dwg"].forEach(function(set){
    var fm=o[set+"F"];if(!fm)return;
    var m={};Object.keys(fm).forEach(function(t){if(conEvalFormula(fm[t])===_invNum((o[set]||{})[t]))m[t]=fm[t];});
    if(Object.keys(m).length)o[set+"F"]=m;else delete o[set+"F"];
  });
  return o;
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
      {onDelete&&<button className="btn" style={{color:"#b3302a",marginRight:"auto"}} onClick={function(){onDelete(d);}}>Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!!err} title={err} onClick={function(){onSave(conCleanDwg(Object.assign({},d,{code:String(d.code).trim(),theo:conCleanTheo(d.theo),updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""})));}}>Save</button>}
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
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"4px 0 6px"}}>Budget quantities per type</div>
    <ConTypeQtyInputs types={types} map={d.theo} ro={ro} realMap={realIx[w.id]||{}} onChange={function(m){set({theo:m});}}/>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"10px 0 6px"}}>Drawings quantities per type</div>
    <ConTypeQtyInputs types={types} map={d.dwg||{}} ro={ro} onChange={function(m){set({dwg:m});}}/>
    <div style={{fontSize:12,margin:"10px 0",color:"#555"}}>
      Theoretical <b>{conFmt(f.theo)}</b> · poured <b>{conFmt(f.real)}</b> {CON_UNIT} ({nPours} pour{nPours===1?"":"s"}) — the loss / gain is measured at the cut-offs
    </div>
    <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note||""} onChange={function(e){set({note:e.target.value});}}/></div>
    {err&&!ro&&<div style={{fontSize:12,color:"#b3302a"}}>{err}</div>}
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
    {err&&<div style={{fontSize:12,color:"#b3302a",marginTop:10}}>{err}</div>}
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
            <td key={t+"t"} style={{textAlign:"right",color:left.theo[t]<-CON_EPS?"#b3302a":undefined}}>{conFmt(left.theo[t])}</td>,
            <td key={t+"r"} style={{textAlign:"right",color:left.real[t]<-CON_EPS?"#b3302a":undefined}}>{conFmt(left.real[t])}</td>];})}<td/></tr>
      </tbody></table></div>
    <div style={{display:"flex",gap:8,margin:"8px 0"}}><button className="btn btn-sm" onClick={function(){setRows(rows.concat([blank()]));}}>+ Line</button></div>
    <details style={{fontSize:12}}><summary style={{cursor:"pointer",color:"#555"}}>Paste the lines from Excel</summary>
      <div style={{color:"#555",margin:"6px 0"}}>Header line first: <b>Code · Description · Zone · Start · Finish · Done</b>, then one column per type for the theoretical m³ (header = type name, e.g. <i>C40/50</i>) and <b>Real &lt;type&gt;</b> for the real m³ (e.g. <i>Real C40/50</i>). Only Code is required.</div>
      <textarea rows={6} value={pasteText} onChange={function(e){setPasteText(e.target.value);}} style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12}}
        placeholder={"Code\tDescription\tStart\tFinish\t"+(tIds[0]?tById[tIds[0]].name+"\tReal "+tById[tIds[0]].name:"C40/50\tReal C40/50")}/>
      <button className="btn btn-sm" disabled={!pasteText.trim()} onClick={loadPaste}>Add these lines</button> <span style={{color:/added/.test(pasteMsg)?"#1e6b3a":"#b3302a"}}>{pasteMsg}</span>
    </details>
    {err&&<div style={{fontSize:12,color:"#b3302a",marginTop:8}}>{err}</div>}
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
    {res.errors.length>0&&<div style={{fontSize:12,color:"#b3302a",marginTop:4}}>{res.errors.slice(0,6).join(" ")}</div>}
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
          <td>{wById[p.wbsId]?<span><b>{wById[p.wbsId].code}</b> {wById[p.wbsId].name}</span>:<span style={{color:"#b3302a"}}>(deleted WBS)</span>}</td>
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
      {onDelete&&<button className="btn" style={{color:"#b3302a",marginRight:"auto"}} onClick={function(){onDelete(d);}}>Delete</button>}
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
    {err&&!ro&&<div style={{fontSize:12,color:"#b3302a"}}>{err}</div>}
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
    <table className="tbl"><thead><tr><th>Type</th><th>Group</th><th>Note</th><th>Used</th></tr></thead>
      <tbody>{conSortTypes(types).map(function(t){
        return <tr key={t.id} onClick={function(){setEditing(t);}} style={{cursor:"pointer",opacity:t.archived?.5:1}}>
          <td><b>{t.name}</b>{t.archived&&<span className="pill" style={{marginLeft:6,background:"#eceae3",color:"#555"}}>archived</span>}</td><td style={{fontSize:12}}>{conIsLean(t)?<span className="pill" style={{background:"#eceae3",color:"#555"}}>Lean concrete</span>:"Other concretes"}{t.lean===undefined&&conIsLean(t)?<span style={{fontSize:10,color:"#888"}}> (from the name)</span>:null}</td><td>{t.note}</td><td>{used[t.id]?"yes":""}</td>
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
      {onDelete&&<button className="btn" style={{color:"#b3302a",marginRight:"auto"}} onClick={function(){onDelete(d);}}>Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!!err} title={err} onClick={function(){onSave(Object.assign({},d,{name:String(d.name).trim()}));}}>Save</button>}
    </>}>
    <div className="fg"><label>Name</label><input type="text" disabled={ro} value={d.name} placeholder="C40/50" onChange={function(e){set({name:e.target.value});}}/></div>
    <div className="fg"><label>Note</label><input type="text" disabled={ro} value={d.note||""} placeholder="e.g. columns and cores, pumped" onChange={function(e){set({note:e.target.value});}}/></div>
    <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,textTransform:"none",letterSpacing:"normal"}}>
      <input type="checkbox" disabled={ro} checked={!!d.archived} onChange={function(){set({archived:!d.archived});}}/> Archived (no longer offered for new entries)
    </label>
    <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,textTransform:"none",letterSpacing:"normal",marginTop:6}}>
      <input type="checkbox" disabled={ro} checked={conIsLean(d)} onChange={function(){set({lean:!conIsLean(d)});}}/> Lean concrete (C16/20, blinding) — its progress is measured apart from the other concretes at the cut-off
    </label>
    {err&&!ro&&<div style={{fontSize:12,color:"#b3302a",marginTop:8}}>{err}</div>}
  </InvModal>;
}

// ---------------------------------------------------------------- report & export
function conOpenReport(types,list,pours,realIx,typeIds,label,cutoffs,pastReal,byWeek){
  var E=esc,t0=today();
  var figs=conSortWbs(list).map(function(w){return conWbsFigures(w,realIx,typeIds);});
  var tot=conTotals(figs);
  var s=conSeries(list,pours,typeIds,null,pastReal,byWeek);
  var plannedToDate=conPlannedToDate(list,pours,typeIds,t0,pastReal);
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
      return"<tr><td><b>"+E(t.name)+"</b></td>"+td(conFmt(tt.theo))+td(conFmt(tt.earned))+td(conFmt(tt.real))+td(sg(tt.variance),true,conLossCol(tt.variance))+td(conPct(tt.varPct))+td(conFmt(tt.rtsReal))+td(conFmt(tt.eac))+td(sg(tt.eacVar),true,conLossCol(tt.eacVar))+"</tr>";
    }).join("");
    conCutoffRows(last.cutoff,list,pours,typeIds).forEach(function(r){cut[r.wbs.id]=r;});
  }
  var wRows=figs.map(function(f){
    var st={done:"complete",progress:"in progress",todo:"not started"}[f.status],r=cut[f.wbs.id];
    return"<tr><td><b>"+E(f.wbs.code)+"</b> "+E(f.wbs.name)+(f.wbs.theoNote?"<div style=\"font-size:10px;color:#6b5a1e;font-style:italic\">💬 "+E(f.wbs.theoNote)+"</div>":"")+"</td><td>"+E(f.wbs.zone||"")+"</td><td>"+E(f.wbs.start||f.wbs.finish?fmtDate(f.wbs.start)+" → "+fmtDate(f.wbs.finish):"")+"</td><td>"+st+"</td>"
      +td(conFmt(f.theo))+td(conFmt(f.real))
      +(last?(r&&r.hasPct?td(r.pct.toFixed(0)+"%")+td(conFmt(r.earned))+td(sg(r.variance),true,conLossCol(r.variance)):td("—")+td("—")+td("—")):"")+"</tr>";
  }).join("");
  var wIds={};list.forEach(function(w){wIds[w.id]=true;});
  var bs=conBySupplier(pours,wIds,typeIds);
  var sNames=Object.keys(bs).sort(function(a,b){return bs[b]._total-bs[a]._total;});
  var sAll=sNames.reduce(function(a,n){return a+bs[n]._total;},0);
  var sCols=conSortTypes(types).filter(function(t){return sNames.some(function(n){return bs[n][t.id];});});
  var sRows=sNames.map(function(n){return"<tr><td><b>"+E(n)+"</b></td>"+sCols.map(function(t){return td(bs[n][t.id]?conFmt(bs[n][t.id]):"");}).join("")+td(conFmt(bs[n]._total),true)+td(sAll>0?(bs[n]._total/sAll*100).toFixed(0)+"%":"")+td(bs[n]._month?conFmt(bs[n]._month):"")+"</tr>";}).join("");
  var nowK=conPerKey(t0,byWeek);
  var mRows=s.months.filter(function(k){return k>=nowK;}).slice(0,byWeek?16:12).map(function(k){var i=s.months.indexOf(k);return"<tr><td>"+conFmtPer(k,byWeek)+"</td>"+td(conFmt(s.plan[i]))+td(conFmt(s.cumPlan[i]))+"</tr>";}).join("");
  var html="<h1>Concrete — theoretical vs real</h1><div class=\"sub\">Riviera Tower · "+E(label)+" · situation at "+E(fmtDate(t0))+(pastReal?" · planned = real for the past":"")+"</div>"
    +"<h2>Summary ("+CON_UNIT+")</h2><table><tr><th>Theoretical</th><th>Planned to date</th><th>Poured to date</th>"+(last?"<th>Earned at "+E(fmtDate(last.date))+"</th><th>Loss (+) / gain (−)</th><th>EOS</th>":"")+"</tr><tr>"
    +td(conFmt(tot.theo))+td(conFmt(plannedToDate))+td(conFmt(tot.real))
    +(last?td(conFmt(last.earned))+td(sg(last.variance)+" ("+conPct(last.varPct)+")",true,conLossCol(last.variance))+td(conFmt(last.eac)):"")+"</tr></table>"
    +(last&&last.nNoPct?"<div style=\"font-size:11px;color:#b45309\">"+last.nNoPct+" WBS without progress % at that cut-off ("+conFmt(last.theoNoPct)+" budget, "+conFmt(last.realNoPct)+" poured) are left out of the loss / gain; they count at budget in the EOS.</div>":"")
    +(eRows?"<h2>Loss / gain of concrete, per cut-off</h2><table><tr><th>Cut-off</th><th>Budget (WBS with %)</th><th>Progress</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−)</th><th>%</th><th>Without %</th></tr>"+eRows+"</table>"
      :"<h2>Loss / gain of concrete</h2><div>No cut-off with a progress % typed yet: the loss or gain is measured only at a cut-off.</div>")
    +(byType?"<h2>Per type, at the cut-off of "+E(fmtDate(last.date))+"</h2><table><tr><th>Type</th><th>Budget (WBS with %)</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−)</th><th>%</th><th>RTS real</th><th>EOS</th><th>EOS − budget</th></tr>"+byType+"</table>":"")
    +(sRows?"<h2>Poured per supplier</h2><table><tr><th>Supplier</th>"+sCols.map(function(t){return"<th>"+E(t.name)+"</th>";}).join("")+"<th>Total</th><th>Share</th><th>This month</th></tr>"+sRows+"</table>":"")
    +(mRows?"<h2>Planned quantities, coming "+(byWeek?"weeks":"months")+"</h2><table><tr><th>"+(byWeek?"Week":"Month")+"</th><th>Planned</th><th>Cumulative planned</th></tr>"+mRows+"</table>":"")
    +"<h2>Per WBS</h2><table><tr><th>WBS</th><th>Zone</th><th>Planned</th><th>Status</th><th>Theoretical</th><th>Poured</th>"+(last?"<th>Progress "+E(fmtDate(last.date))+"</th><th>Earned</th><th>Loss (+) / gain (−)</th>":"")+"</tr>"+wRows+"</table>"
    +"<div style=\"font-size:10px;color:#8b8578\">No progress is estimated: the loss or gain = poured up to the cut-off − earned (budget × the progress % typed by hand), on the WBS that have a %. Poured = the pours, a volume.</div>";
  openReport("CONCRETE - "+t0,html);
}
function conExportXlsx(types,list,pours,realIx,cutoffs,pastReal){
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
    o["Budget comment"]=w.theoNote||"";
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
  var s=conSeries(list,pours,allIds,null,pastReal);
  var mr=s.months.map(function(k,i){return{"Month":k,"Planned":r2(s.plan[i]),"Poured":s.real[i]===null?"":r2(s.real[i]),"Cum. planned":r2(s.cumPlan[i]),"Cum. poured":s.cumReal[i]===null?"":r2(s.cumReal[i])};});
  var sw=conSeries(list,pours,allIds,null,pastReal,true);
  var wr=sw.months.map(function(k,i){return{"Week (Monday)":k,"Week":conFmtPer(k,true),"Planned":r2(sw.plan[i]),"Poured":sw.real[i]===null?"":r2(sw.real[i]),"Cum. planned":r2(sw.cumPlan[i]),"Cum. poured":sw.cumReal[i]===null?"":r2(sw.cumReal[i])};});
  var cr=conEarnedPoints(cutoffs,list,pours,allIds).map(function(p){return{"Cut-off":p.date,"Label":p.label,"Closed":p.closed?"Y":"","Budget (WBS with %)":r2(p.theo),"Earned":r2(p.earned),"Poured":r2(p.real),"Loss(+)/gain(-)":r2(p.variance),"%":p.varPct===null?"":r2(p.varPct),"WBS without %":p.nNoPct};});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(rows),"WBS");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(cr),"Cut-offs");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(pr),"Pours");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(sr),"Suppliers");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(mr),"Monthly");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(wr),"Weekly");
  window.XLSX.writeFile(wb,"Concrete "+today()+".xlsx");
}

// ---------------------------------------------------------------- cut-off cost control
// A cut-off is a dated situation. Each WBS gets a physical progress %, which unlocks budget:
//   earned (budget unlocked)  = theoretical × progress %
//   real at cut-off           = pours up to the cut-off date (a cumulative pour counts pro rata)
//   loss / gain               = real − earned          (> 0: concrete lost, < 0: gained)
// The progress % is ONLY typed by hand: never carried over, copied from the schedule or deduced
// from the volumes. A WBS without a % is left out of the loss / gain, RTS and EOS.
//   remain to be spent, theo. = on the basis chosen for the cut-off (c.rtsBasis, button
//                               Budget / Drawings): budget − earned, or drawings − drawings × %
//                               (a type without drawings quantities falls back to the budget)
//   remain to be spent, real  = TYPED BY HAND only (line.rts {typeId: m³}); the button
//                               "Fill RTS real" copies the RTS theo. into every cell, then any cell
//                               can be changed. Not typed (and something left) = no EOS for that WBS.
//   estimate at completion    = real at cut-off + RTS real;  EOS variance = EOS − theoretical
// Stored in pp_concrete_cutoffs: [{id, date, label, closed, lines:[{id: wbsId, pct, rts:{typeId: m³}, note}],
//   reported: totals per type frozen when the cut-off is closed}]. The lines are a list of items
// with ids, so two people entering progress on different WBS of the same cut-off both keep it.
function newConCutoff(o){return Object.assign({id:uuid(),date:today(),label:"",closed:false,lines:[],note:""},_conStamp(),o||{});}
// Basis of the RTS theo. of a cut-off: "budget", "dwg" (drawings) or "both" (the two analyses
// side by side; the single RTS theo. figure — totals, split of a typed RTS — is then the budget one).
function conRtsBasis(c){return c&&(c.rtsBasis==="dwg"||c.rtsBasis==="both")?c.rtsBasis:"budget";}
// Background of each analysis, screen and print: blue = against the budget, salmon = against the drawings.
var CON_BG_BUD="#e8f0fb",CON_BG_DWG="#fde9e1";
// ---- frozen cut-offs. Closing a cut-off stores a snapshot (c.snap) of everything its figures
// are made of: each WBS (code, name, zone, budget, drawings, complete), the m³ poured per WBS and
// type up to its date, its lines (% and RTS real), and the project totals typed on the types.
// While it is closed, every figure of that cut-off (table, tiles, groups, report, Excel, the
// Overview history) is read from the snapshot: editing a budget, a pour, or merging / splitting
// WBS afterwards changes nothing in a closed cut-off. Reopening drops the snapshot.
// A cut-off closed before snapshots existed stays live until it is reopened and closed again.
var _conLive={ids:{},n:0};
function conNoteLive(wbs){var ids={};(wbs||[]).forEach(function(w){ids[w.id]=1;});_conLive={ids:ids,n:(wbs||[]).length};}
function conMakeSnap(c,wbs,pours,types){
  var real={},ra=conRealAt(pours,c.date);
  Object.keys(ra).forEach(function(k){var m={};Object.keys(ra[k]).forEach(function(t){var v=Math.round(ra[k][t]*1e6)/1e6;if(v)m[t]=v;});if(Object.keys(m).length)real[k]=m;});
  var tt={};(types||[]).forEach(function(t){var b=conManualTotal(t,"theo"),d=conManualTotal(t,"dwg");if(b!==null||d!==null)tt[t.id]={theo:b,dwg:d};});
  return{at:new Date().toISOString(),by:window._currentUser?window._currentUser.name:"",
    wbs:(wbs||[]).map(function(w){var o={id:w.id,code:w.code||"",name:w.name||"",zone:w.zone||"",theo:Object.assign({},w.theo||{}),done:!!w.done};if(w.dwg)o.dwg=Object.assign({},w.dwg);return o;}),
    real:real,lines:JSON.parse(JSON.stringify(c.lines||[])),typeTotals:tt};
}
// The snapshot view of a closed cut-off for the WBS list a caller passes (null = live figures).
// The caller's WBS are matched by id; a WBS of the snapshot that no longer exists at all
// (deleted, merged away) is kept when the caller passes the whole register.
function conSnapView(c,wbs){
  var sn=c&&c.closed&&c.snap;
  if(!sn)return null;
  var pass={};(wbs||[]).forEach(function(w){pass[w.id]=1;});
  var full=(wbs||[]).length>=_conLive.n;
  return{wbs:sn.wbs.filter(function(e){return pass[e.id]||(full&&!_conLive.ids[e.id]);}),real:sn.real||{},
    c:Object.assign({},c,{lines:sn.lines||[]}),typeTotals:sn.typeTotals||{}};
}
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
function conCutoffRows(c,wbs,pours,typeIds,opt){
  // closed cut-off with a snapshot: frozen figures (opt.live = recompute from today's data)
  var sv=opt&&opt.live?null:conSnapView(c,wbs);
  if(sv){wbs=sv.wbs;c=sv.c;}
  var realAt=sv?sv.real:conRealAt(pours,c.date),onDwgBasis=conRtsBasis(c)==="dwg";
  return conSortWbs(wbs).map(function(w){
    var ln=conCutoffLine(c,w.id)||{};
    var has=_invHas(ln.pct),pct=has?conClampPct(ln.pct):0;
    var wDwg=conSum(w.dwg,typeIds);
    var r={wbs:w,line:ln,hasPct:has,pct:pct,theo:0,earned:0,real:0,rtsTheo:0,rtsTheoB:0,rtsTheoD:0,rtsReal:0,adjusted:false,byType:{},dwg:0,earnedDwg:0};
    typeIds.forEach(function(t){
      var th=_invNum((w.theo||{})[t]),re=_invNum((realAt[w.id]||{})[t]),dw=_invNum((w.dwg||{})[t]);
      // RTS theo. on the chosen basis: drawings when typed for this type (else budget), or budget.
      // rtB on the budget, rtD on the drawings (budget when this type has no drawings quantities).
      // On the drawings: a WBS WITH drawings quantities counts only them (a type budgeted but not
      // on the drawings = 0 — the budget and the drawings may use different concrete types, so
      // mixing them per type would count the same concrete twice); a WBS without any drawings
      // quantities falls back to the budget.
      var ea=th*pct/100,ed=dw*pct/100,rtB=th-ea,rtD=wDwg>CON_EPS?(dw>CON_EPS?dw-ed:0):rtB,onD=onDwgBasis&&wDwg>CON_EPS,rt=onDwgBasis?rtD:rtB;
      if(onD)r.rtsOnDwg=true;
      if(wDwg>CON_EPS)r.rtsDwgAny=true;else if(th>CON_EPS)r.rtsDwgFallback=true;
      // RTS real: typed by hand only. Nothing left in theory (100 %, no quantity) = 0, not missing.
      var adj=!!(ln.rts&&_invHas(ln.rts[t]));
      // Missing: something is left in theory (budget / drawings − % done; everything when no % is
      // typed) and no RTS real typed. Counted 0 in the EOS, but flagged on every WBS.
      var miss=!adj&&rt>CON_EPS;
      var rr=adj?_invNum(ln.rts[t]):0;
      r.byType[t]={theo:th,earned:ea,real:re,rtsTheo:rt,rtsTheoB:rtB,rtsTheoD:rtD,rtsReal:miss?null:rr,adjusted:adj,missing:miss,dwg:dw,earnedDwg:ed};
      r.theo+=th;r.earned+=ea;r.real+=re;r.rtsTheo+=rt;r.rtsTheoB+=rtB;r.rtsTheoD+=rtD;r.rtsReal+=rr;if(adj)r.adjusted=true;if(miss)r.rtsMissing=true;
      r.dwg+=dw;r.earnedDwg+=ed;
    });
    // Against the drawings (plans): same progress %, applied to the drawings quantities.
    // Only on the WBS whose drawings quantities are typed.
    r.hasDwg=r.dwg>CON_EPS;
    var mD=has&&r.hasDwg;
    r.varDwg=mD?r.real-r.earnedDwg:null;
    r.varDwgPct=mD&&r.earnedDwg>CON_EPS?r.varDwg/r.earnedDwg*100:null;
    // Without a progress % typed by hand nothing is measured: no earned, no loss / gain, no EOS.
    r.variance=has?r.real-r.earned:null;
    r.varPct=has&&r.earned>CON_EPS?r.variance/r.earned*100:null;
    // EOS (estimate, shown as "EOS") = poured to date + RTS real typed (empty = nothing left),
    // on EVERY WBS — also those without a progress % — so the total adds up: Σ EOS = Σ poured + Σ RTS real.
    // rtsMissing (a WBS with a % whose RTS real is not typed) is only a warning.
    r.hasEac=true;
    r.eac=r.real+r.rtsReal;
    r.eacVar=r.eac-r.theo;
    r.eacPct=r.theo>CON_EPS?r.eacVar/r.theo*100:null;
    r.realPct=r.theo>CON_EPS?r.real/r.theo*100:null;   // volume ratio, for reference only
    r.eacVarDwg=r.hasDwg?r.eac-r.dwg:null;
    r.eacDwgPct=r.hasDwg?r.eacVarDwg/r.dwg*100:null;
    return r;
  }).filter(function(r){return r.theo>CON_EPS||r.real>CON_EPS||r.hasPct||r.hasDwg;});
}
// Totals. theoAll / realAll, the RTS real and the EOS cover every WBS; the measured figures
// (earned, real, loss / gain, RTS theo.) cover only the WBS with a progress %.
function conCutoffTotals(rows){
  var t={dwgAll:0,nDwg:0,dwg:0,earnedDwg:0,realDwg:0,eacDwg:0,dwgEac:0,theoDwg:0,theoAll:0,realAll:0,theo:0,earned:0,real:0,rtsTheo:0,rtsReal:0,eac:0,theoEac:0,nEac:0,nRtsMissing:0,n:rows.length,nPct:0,nNoPct:0,theoNoPct:0,realNoPct:0,nAdj:0};
  rows.forEach(function(r){
    t.theoAll+=r.theo;t.realAll+=r.real;t.dwgAll+=r.dwg;
    // EOS on every WBS (with or without %): poured + RTS real.
    t.eac+=r.eac;t.theoEac+=r.theo;t.nEac++;t.rtsReal+=r.rtsReal||0;
    if(r.rtsMissing){t.nRtsMissing++;t.theoRtsMissing=(t.theoRtsMissing||0)+r.theo;t.rtsTheoMissing=(t.rtsTheoMissing||0)+r.rtsTheo;}
    if(r.hasDwg){t.eacDwg+=r.eac;t.dwgEac+=r.dwg;}
    if(r.hasPct&&r.hasDwg){t.nDwg++;t.dwg+=r.dwg;t.earnedDwg+=r.earnedDwg;t.realDwg+=r.real;t.theoDwg+=r.theo;}
    if(!r.hasPct){
      if(r.theo>CON_EPS||r.real>CON_EPS){t.nNoPct++;t.theoNoPct+=r.theo;t.realNoPct+=r.real;}
      return;
    }
    t.nPct++;
    t.theo+=r.theo;t.earned+=r.earned;t.real+=r.real;t.rtsTheo+=r.rtsTheo;t.rtsTheoB=(t.rtsTheoB||0)+r.rtsTheoB;t.rtsTheoD=(t.rtsTheoD||0)+r.rtsTheoD;
    if(r.adjusted)t.nAdj++;
    if(r.rtsOnDwg)t.nRtsDwg=(t.nRtsDwg||0)+1;
  });
  t.pct=t.theoAll>CON_EPS?t.earned/t.theoAll*100:null;
  t.variance=t.real-t.earned;
  t.varPct=t.earned>CON_EPS?t.variance/t.earned*100:null;
  // EOS on every WBS (poured + RTS real); null when there is no WBS at all.
  if(!t.nEac)t.eac=null;
  t.eacVar=t.nEac?t.eac-t.theoEac:null;
  t.eacPct=t.nEac&&t.theoEac>CON_EPS?t.eacVar/t.theoEac*100:null;
  // Against the drawings: WBS with a progress % AND drawings quantities only.
  t.varDwg=t.realDwg-t.earnedDwg;
  t.varDwgPct=t.earnedDwg>CON_EPS?t.varDwg/t.earnedDwg*100:null;
  t.eacVarDwg=t.dwgEac>CON_EPS?t.eacDwg-t.dwgEac:null;
  t.eacDwgPct=t.dwgEac>CON_EPS?t.eacVarDwg/t.dwgEac*100:null;
  return t;
}
// ---- progress per group: lean concrete (C16/20, blinding…) apart from all the other concretes.
// A type is lean when ticked in its editor (t.lean); not set yet → guessed from its name.
function conIsLean(t){
  if(!t)return false;
  if(t.lean===true||t.lean===false)return t.lean;
  return /lean|blinding|propret|\bc\s*(8|10|12|15|16)\b/i.test(t.name||"");
}
var CON_GROUPS=[{key:"lean",label:"Lean concrete"},{key:"other",label:"Other concretes"}];
// At a cut-off, per group: the progress % typed on the items (WBS) applied to their drawings
// quantities gives the progress of the drawings; that % is applied to the TOTAL budget of the
// group, even when the budget is not split per WBS. A WBS with drawings but no % counts at 0%.
// Without any drawings quantities in a group, its WBS budget lines are the basis instead.
// whole: no zone / search filter → typed project totals (budgetTotal / dwgTotal) are used.
function conGroupProgress(c,types,wbs,pours,whole){
  var sv=conSnapView(c,wbs);
  if(sv){wbs=sv.wbs;c=sv.c;}
  var realAt=sv?sv.real:conRealAt(pours,c.date);
  // typed project totals: frozen with the cut-off too
  function manTot(t,set){if(sv){var x=sv.typeTotals[t.id];return x&&x[set]!==null&&x[set]!==undefined?x[set]:null;}return conManualTotal(t,set);}
  function one(ids){
    // Every WBS weighs in the progress, so the % always means something: measured on its
    // drawings quantities when it has some, else on its budget lines. A WBS without a % = 0 %.
    var meas=0,earnM=0,nNoPct=0,nD=0,nB=0;
    wbs.forEach(function(w){
      var ln=conCutoffLine(c,w.id)||{},has=_invHas(ln.pct),p=has?conClampPct(ln.pct)/100:0;
      var d=conSum(w.dwg,ids),th=conSum(w.theo,ids),q=d>CON_EPS?d:th;
      if(q<=CON_EPS)return;
      if(d>CON_EPS)nD++;else nB++;
      meas+=q;earnM+=q*p;if(!has)nNoPct++;
    });
    var basis=!meas?"":nD&&nB?"drawings + budget":nD?"drawings":"budget lines";
    var pct=meas>CON_EPS?earnM/meas:null;
    var dwgD=meas,earnD=earnM,theoD=meas,earnT=earnM;
    var budget=0,dwgP=0,budMan=false,dwgMan=false;
    (types||[]).forEach(function(t){if(ids.indexOf(t.id)<0)return;
      var bd=wbs.reduce(function(a,w){return a+_invNum((w.theo||{})[t.id]);},0),dd=wbs.reduce(function(a,w){return a+_invNum((w.dwg||{})[t.id]);},0);
      var bm=whole?manTot(t,"theo"):null,dm=whole?manTot(t,"dwg"):null;
      budget+=bm===null?bd:bm;dwgP+=dm===null?dd:dm;if(bm!==null)budMan=true;if(dm!==null)dwgMan=true;});
    var poured=0;Object.keys(realAt).forEach(function(k){poured+=conSum(realAt[k],ids);});
    var r={ids:ids,basis:basis,basisQty:basis==="drawings"?dwgD:theoD,basisEarned:basis==="drawings"?earnD:earnT,pct:pct,nNoPct:nNoPct,
      budget:budget,budMan:budMan,dwg:dwgP,dwgMan:dwgMan,poured:poured};
    r.budgetEarned=pct===null?null:budget*pct;
    r.variance=pct===null?null:poured-r.budgetEarned;
    r.varPct=pct!==null&&r.budgetEarned>CON_EPS?r.variance/r.budgetEarned*100:null;
    // RTS on the cut-off's basis: drawings (total drawings of the group × what is left, when
    // typed) or budget.
    r.rtsOnDwg=conRtsBasis(c)==="dwg"&&dwgP>CON_EPS;
    r.rtsB=pct===null?null:budget-r.budgetEarned;
    r.rtsD=pct===null||dwgP<=CON_EPS?null:dwgP*(1-pct);
    r.rts=pct===null?null:r.rtsOnDwg?r.rtsD:r.rtsB;
    r.eac=pct===null?null:poured+r.rts;
    r.eacVar=pct===null?null:r.eac-budget;
    r.dwgEarned=pct===null||dwgP<=CON_EPS?null:dwgP*pct;
    r.varDwg=r.dwgEarned===null?null:poured-r.dwgEarned;
    return r;
  }
  var groups=CON_GROUPS.map(function(g){
    var ids=(types||[]).filter(function(t){return g.key==="lean"?conIsLean(t):!conIsLean(t);}).map(function(t){return t.id;});
    return Object.assign({key:g.key,label:g.label,names:(types||[]).filter(function(t){return ids.indexOf(t.id)>=0;}).map(function(t){return t.name;})},one(ids));
  }).filter(function(g){return g.budget>CON_EPS||g.basisQty>CON_EPS||g.poured>CON_EPS;});
  // Total: sum of the groups (each group keeps its own %).
  var t={key:"total",label:"Total",budget:0,budgetEarned:0,poured:0,dwg:0,dwgEarned:0,ok:true,okD:true};
  groups.forEach(function(g){t.budget+=g.budget;t.poured+=g.poured;t.dwg+=g.dwg;
    if(g.budgetEarned===null)t.ok=false;else t.budgetEarned+=g.budgetEarned;
    if(g.dwgEarned===null)t.okD=t.okD&&g.dwg<=CON_EPS;else t.dwgEarned+=g.dwgEarned;});
  t.pct=t.ok&&t.budget>CON_EPS?t.budgetEarned/t.budget:null;
  t.variance=t.ok?t.poured-t.budgetEarned:null;
  t.varPct=t.ok&&t.budgetEarned>CON_EPS?t.variance/t.budgetEarned*100:null;
  t.rts=t.ok?groups.reduce(function(a,g){return a+(g.rts||0);},0):null;
  t.rtsB=t.ok?t.budget-t.budgetEarned:null;
  t.rtsD=t.okD&&t.dwg>CON_EPS&&t.dwgEarned!==null?t.dwg-t.dwgEarned:null;t.eac=t.ok?t.poured+t.rts:null;t.eacVar=t.ok?t.eac-t.budget:null;
  t.varDwg=t.okD&&t.dwgEarned>CON_EPS?t.poured-t.dwgEarned:null;
  return{groups:groups,total:t};
}
function ConGroupProgress({gp,whole,basis}){
  // Columns grouped by analysis, like the cut-off table: blue = vs budget, salmon = vs drawings.
  var R={textAlign:"right"},B=R,D=R;   // backgrounds from the classes cb / cd (con-cut CSS)
  var showB=basis!=="dwg",showD=basis!=="budget";
  var sg=function(v){return v===null||v===undefined?"—":(v>0?"+":"")+conFmt(v);};
  function row(g,isTot){
    var eacB=g.rtsB===null||g.rtsB===undefined?null:g.poured+g.rtsB,eacD=g.rtsD===null||g.rtsD===undefined?null:g.poured+g.rtsD;
    return <tr key={g.key} style={isTot?{fontWeight:700,background:"#f7f6f2"}:undefined}>
      <td><b>{g.label}</b>{!isTot&&<div style={{fontSize:10,color:"#888"}}>{g.names.join(", ")}</div>}</td>
      <td style={R}>{isTot?"":g.basis?<>{conFmt(g.basisQty)}<div style={{fontSize:10,color:"#888"}}>{g.basis}</div></>:"—"}</td>
      <td style={R}>{isTot?"":g.basis?conFmt(g.basisEarned):"—"}</td>
      <td style={Object.assign({fontWeight:700},R)}>{g.pct===null?"—":(g.pct*100).toFixed(1)+"%"}{!isTot&&g.nNoPct>0&&<div style={{fontSize:10,fontWeight:400,color:"#ef6c00"}} title="Items with quantities but no progress % typed: counted at 0%">{g.nNoPct} at 0%</div>}</td>
      <td style={R}>{conFmt(g.poured)}</td>
      {showB&&<>
        <td className="cb" style={B}>{conFmt(g.budget)}{g.budMan&&<div style={{fontSize:10,color:"var(--gold-ink)"}}>typed total</div>}</td>
        <td className="cb" style={B}>{g.budgetEarned===null?"—":conFmt(g.budgetEarned)}</td>
        <td className="cb" style={Object.assign({},B,{fontWeight:700,color:g.variance===null?undefined:conLossCol(g.variance)})}>{sg(g.variance)}<div style={{fontSize:10,fontWeight:400}}>{g.varPct===null?"":conPct(g.varPct)}</div></td>
        <td className="cb" style={B}>{g.rtsB===null||g.rtsB===undefined?"—":conFmt(g.rtsB)}</td>
        <td className="cb" style={Object.assign({},B,{fontWeight:700,color:eacB===null?undefined:conLossCol(eacB-g.budget)})}>{eacB===null?"—":conFmt(eacB)}<div style={{fontSize:10,fontWeight:400}}>{eacB===null?"":sg(eacB-g.budget)+" vs budget"}</div></td>
      </>}
      {showD&&<>
        <td className="cd" style={D}>{g.dwg>CON_EPS?conFmt(g.dwg):"—"}{g.dwgMan&&<div style={{fontSize:10,color:"var(--gold-ink)"}}>typed total</div>}</td>
        <td className="cd" style={D}>{g.dwgEarned===null||g.dwgEarned===undefined?"—":conFmt(g.dwgEarned)}</td>
        <td className="cd" style={Object.assign({},D,{fontWeight:700,color:g.varDwg===null||g.varDwg===undefined?undefined:conLossCol(g.varDwg)})}>{sg(g.varDwg)}</td>
        <td className="cd" style={D}>{g.rtsD===null||g.rtsD===undefined?"—":conFmt(g.rtsD)}</td>
        <td className="cd" style={Object.assign({},D,{fontWeight:700,color:eacD===null?undefined:conLossCol(eacD-g.dwg)})}>{eacD===null?"—":conFmt(eacD)}<div style={{fontSize:10,fontWeight:400}}>{eacD===null?"":sg(eacD-g.dwg)+" vs drawings"}</div></td>
      </>}
    </tr>;
  }
  return <div className="card" style={{marginBottom:12}}>
    <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Progress per group — the progress of the WBS applied to the total budget and drawings</div>
    <div style={{fontSize:11,color:"#888",marginBottom:8}}>Lean concrete is measured apart from all the other concretes (tick “Lean concrete” on a type in Types). Progress of a group = Σ (quantity × progress % of each WBS) ÷ Σ quantities, the quantity of a WBS being its drawings, or its budget when it has no drawings; WBS without a % count at 0%. That % unlocks the budget (budget unlocked) and the drawings (drawings unlocked). That % unlocks the group's total budget{whole?" (the typed project total when there is one)":""}, split per WBS or not. All types, whatever the type filter.{whole?"":" Zone / search filter on: totals are the sums of the WBS shown, typed project totals are not used."} RTS here = what is left of the budget / of the drawings at that progress; EOS = poured + RTS.</div>
    {!gp.groups.length?<div style={{fontSize:12,color:"#888"}}>No quantities yet.</div>:
    <div style={{overflowX:"auto"}}><table className="tbl con-cut" style={{fontSize:12,overflow:"visible"}}>
      <thead>
        <tr><th colSpan={5} style={{borderBottom:"none"}}/>
          {showB&&<th colSpan={5} className="cb" style={{textAlign:"center",color:"var(--brand-ink,#173b63)"}}>Analysis vs budget</th>}
          {showD&&<th colSpan={5} className="cd" style={{textAlign:"center",color:"#8a3a1c"}}>Analysis vs drawings</th>}</tr>
        <tr><th>Group</th><th style={R} title="What the progress is measured on: each WBS's drawings quantities, or its budget lines when it has no drawings">Measured qty</th><th style={R} title="Measured qty × progress %">Done</th><th style={R}>Progress</th>
        <th style={R} title="Concrete poured up to the cut-off date, these types">Poured</th>
        {showB&&<><th className="cb" style={B}>Budget</th><th className="cb" style={B} title="Budget × progress">Budget unlocked</th><th className="cb" style={B} title="Poured − budget unlocked: > 0 loss, < 0 gain">vs budget</th><th className="cb" style={B} title="Budget − budget unlocked">RTS</th><th className="cb" style={B} title="Poured + RTS on the budget">EOS</th></>}
        {showD&&<><th className="cd" style={D}>Drawings</th><th className="cd" style={D} title="Drawings × progress of the group">Drawings unlocked</th><th className="cd" style={D} title="Poured − drawings × progress">vs drawings</th><th className="cd" style={D} title="Drawings × (1 − progress)">RTS</th><th className="cd" style={D} title="Poured + RTS on the drawings">EOS</th></>}</tr></thead>
      <tbody>{gp.groups.map(function(g){return row(g,false);})}{gp.groups.length>1&&row(gp.total,true)}</tbody>
    </table></div>}
  </div>;
}
// Every variance is coloured by its sign: red = loss / overrun (> 0), green = gain (< 0), whatever its size.
function conVarCol(v){return conLossCol(v);}
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

// A formula typed in a quantity cell, like a spreadsheet: "=12,5*3+4", "2*(3.5+1)", "120/4".
// + − × ÷ and brackets, decimal point or comma, x / × for times, ÷ or : for divide. No eval:
// a small parser. Returns the number, or null when the text is not a valid formula.
function conEvalFormula(str){
  var s=String(str||"").trim().replace(/^=/,"").replace(/\s+/g,"").replace(/[x×]/gi,"*").replace(/[÷:]/g,"/").replace(/−/g,"-").replace(/,/g,".");
  if(!s||!/^[0-9.+\-*/()]+$/.test(s))return null;
  var i=0;
  function num(){var m=/^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));if(!m)throw 0;i+=m[0].length;return Number(m[0]);}
  function atom(){
    if(s[i]==="-"){i++;return -atom();}
    if(s[i]==="+"){i++;return atom();}
    if(s[i]==="("){i++;var v=sum();if(s[i]!==")")throw 0;i++;return v;}
    return num();
  }
  function prod(){var v=atom();while(s[i]==="*"||s[i]==="/"){var o=s[i++],r=atom();if(o==="/"){if(r===0)throw 0;v=v/r;}else v=v*r;}return v;}
  function sum(){var v=prod();while(s[i]==="+"||s[i]==="-"){var o=s[i++],r=prod();v=o==="+"?v+r:v-r;}return v;}
  try{var v=sum();if(i!==s.length||!isFinite(v))return null;return Math.round(v*1000)/1000;}catch(e){return null;}
}
// A formula, not a plain number? (a plain number may start with a minus sign)
function conIsFormula(str){var t=String(str||"").trim();return /^=/.test(t)||/[0-9.,)]\s*[+\-*/x×÷:]/i.test(t)||/[()]/.test(t);}
// A number typed in a table cell, saved when the cell is left (not on every keystroke).
// A formula is accepted (conEvalFormula): its result is saved, and the formula text is passed as
// the 2nd argument of onCommit (null for a plain number) so that it can be kept and shown again.
function ConNumCell({value,onCommit,disabled,width,placeholder,highlight,title,formula}){
  var plain=_invHas(value)?String(Math.round(_invNum(value)*1000)/1000):"";
  function editText(){return formula?String(formula):plain;}
  const [txt,setTxt]=useState(editText());
  const [focus,setFocus]=useState(false);
  var shown=focus?txt:plain;
  function commit(){
    setFocus(false);
    var raw=txt.trim(),nv,f=null;
    if(raw===""){nv=null;}
    else if(conIsFormula(raw)){
      nv=conEvalFormula(raw);
      if(nv===null){safeAlert("“"+raw+"” is not a valid formula.\n\nUse numbers with + − * / and brackets, e.g. =12,5*3+4");return;}
      f="="+raw.replace(/^=/,"").trim();
    }else{nv=Number(raw.replace(/\s+/g,"").replace(",","."));if(!isFinite(nv)){safeAlert("“"+raw+"” is not a number.");return;}}
    var cur=_invHas(value)?_invNum(value):null;
    if(nv===cur&&(f||null)===(formula||null))return;
    onCommit(nv,f);
  }
  return <input type="text" inputMode={formula?"text":"decimal"} disabled={disabled} value={shown} placeholder={placeholder}
    title={(formula?formula+" = "+plain+(title?"\n":""):"")+(title||"")+(title&&!formula?"\nA formula is accepted, e.g. =12,5*3+4":"")}
    onFocus={function(){setTxt(editText());setFocus(true);}}
    onChange={function(e){setTxt(e.target.value);}} onBlur={commit}
    onKeyDown={function(e){if(e.key==="Enter")e.target.blur();if(e.key==="Escape"){setTxt(editText());e.target.blur();}}}
    style={{width:width||70,textAlign:focus&&formula?"left":"right",fontVariantNumeric:"tabular-nums",padding:"4px 6px",
      background:highlight?"var(--gold-soft)":formula?"#eef4fb":undefined,fontWeight:highlight?700:undefined,
      borderBottom:formula&&!focus?"1.5px dotted var(--blue)":undefined}}/>;
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
  var gpWbs=wbs.filter(function(w){if(zone&&w.zone!==zone)return false;return !ql||[w.code,w.name].join(" ").toLowerCase().indexOf(ql)>=0;});
  var gp=conGroupProgress(cur,types,gpWbs,(zone||ql)?pours.filter(function(p){return gpWbs.some(function(w){return w.id===p.wbsId;});}):pours,!zone&&!ql);
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
  // RTS basis of this cut-off (Budget / Drawings), shared by everyone and kept with the cut-off.
  var basis=conRtsBasis(cur);
  function setBasis(b){if(ro||b===basis)return;setCur({rtsBasis:b});}
  var showB=basis!=="dwg",showD=basis!=="budget";
  // "Fill RTS real": every WBS with a progress % (whole cut-off, every type, whatever the filters)
  // gets RTS real = RTS theo. on the current basis, in one write; any cell can be changed after.
  function fillRts(from){
    if(ro)return;
    from=from||(basis==="dwg"?"dwg":"budget");
    var all=conCutoffRows(cur,wbs,pours,allIds).filter(function(r){return r.hasPct;});
    if(!all.length){safeAlert("Type the progress % of the WBS first: the RTS is worked out from it.");return;}
    var nTyped=all.filter(function(r){return r.adjusted;}).length;
    if(!safeConfirm("Fill the RTS real of the "+all.length+" WBS with a progress % with the RTS calculated on the "+(from==="dwg"?"drawings (drawings − drawings × %; budget − earned on a WBS without drawings)":"budget (budget − earned)")+"?"+
      (nTyped?"\n\n"+nTyped+" WBS already have an RTS real typed: they are overwritten too.":"")+"\n\nYou can then change any cell."))return;
    var lines=(cur.lines||[]).slice(),stamp={updatedAt:new Date().toISOString(),updatedBy:window._currentUser?window._currentUser.name:""};
    all.forEach(function(r){
      var rts={};allIds.forEach(function(t){var b=r.byType[t];var v=b?(from==="dwg"?b.rtsTheoD:b.rtsTheoB):0;if(b&&(b.theo>CON_EPS||b.dwg>CON_EPS||v>CON_EPS))rts[t]=Math.round(Math.max(0,v)*1000)/1000;});
      var i=lines.findIndex(function(l){return l.id===r.wbs.id;});
      var ln=Object.assign({id:r.wbs.id},i>=0?lines[i]:{},{rts:Object.keys(rts).length?rts:undefined},stamp);
      if(i>=0)lines[i]=ln;else lines.push(ln);
    });
    setCur({lines:lines});
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
    setCur({closed:true,closedAt:new Date().toISOString(),closedBy:window._currentUser?window._currentUser.name:"",reported:rep,
      snap:conMakeSnap(cur,wbs,pours,types)});
  }
  function reopen(){if(confirm("Reopen this cut-off? The progress and the remain to be spent become editable again, and its frozen figures are dropped: it is recalculated from today's budgets, drawings and pours until it is closed again."))setCur({closed:false,reported:undefined,closedAt:undefined,closedBy:undefined,snap:undefined});}
  function del(){
    if(!confirm("Delete the cut-off of "+fmtDate(cur.date)+" with all its progress figures? There is no undo."))return;
    saveCutoffs(cutoffs.filter(function(c){return c.id!==cur.id;}));setCurId("");
  }
  // What was frozen at closing, against today's recalculation (a pour or a theoretical changed since).
  var drift=null,frozenDiff=null;
  if(cur.closed&&cur.snap&&!zone&&!ql){
    // What today's data would give: shown for information, the frozen figures stay the reference.
    var lv=conCutoffTotals(conCutoffRows(cur,wbs,pours,typeIds,{live:true}));
    var d1=Math.abs(lv.theoAll-tot.theoAll)>0.5||Math.abs(lv.realAll-tot.realAll)>0.5||Math.abs((lv.eac||0)-(tot.eac||0))>0.5||Math.abs(lv.earned-tot.earned)>0.5||Math.abs(lv.dwgAll-tot.dwgAll)>0.5;
    if(d1)frozenDiff=lv;
  }
  if(cur.closed&&cur.reported&&!cur.snap){
    var rp={theo:0,earned:0,real:0};
    typeIds.forEach(function(t){var x=cur.reported[t];if(x){rp.theo+=x.theo;rp.earned+=x.earned;rp.real+=x.real;}});
    if(!zone&&!ql&&(Math.abs(rp.theo-tot.theo)>0.5||Math.abs(rp.earned-tot.earned)>0.5||Math.abs(rp.real-tot.real)>0.5))drift=rp;
  }
  var label=typeId?(types.find(function(t){return t.id===typeId;})||{}).name:"all types";
  // Reconciliation: every m³ in the pour register up to the cut-off must sit in a WBS row of a
  // known type. A gap = pours on a deleted WBS / type or without a type: shown, never hidden.
  var recon=(function(){
    var ra=conRealAt(pours,cur.date),all=0;
    Object.keys(ra).forEach(function(k){Object.keys(ra[k]).forEach(function(t){all+=ra[k][t];});});
    var inRows=conCutoffTotals(conCutoffRows(cur,wbs,pours,allIds,{live:true})).realAll;
    return Math.abs(all-inRows)>0.5?{all:all,inRows:inRows}:null;
  })();
  return <div>
    <div className="filter-bar">
      <select value={cur.id} onChange={function(e){setCurId(e.target.value);}} style={{width:"auto",fontWeight:700}}>
        {sorted.map(function(c){return <option key={c.id} value={c.id}>{fmtDate(c.date)}{c.label?" — "+c.label:""}{c.closed?" 🔒":""}</option>;})}
      </select>
      {cur.closed?<span className="pill" style={{background:"#eceae3",color:"#555"}}>🔒 closed{cur.closedBy?" by "+cur.closedBy:""}{cur.closedAt?" "+fmtDate(cur.closedAt.slice(0,10)):""}</span>
        :<span className="pill" style={{background:"#e8f0fe",color:"#0f5299"}}>open</span>}
      <ConTypeFilter types={types} value={typeId} onChange={setTypeId}/>
      <ConZoneSelect zones={[...new Set((zones||[]).concat(wbsZones))]} value={zone} onChange={setZone} all/>
      <input type="text" placeholder="Search WBS…" value={q} onChange={function(e){setQ(e.target.value);}} style={{width:"auto",minWidth:150}}/>
      <div style={{flex:1}}/>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}} title="Basis of the RTS theo.: the budget (budget − earned) or the drawings (drawings − drawings × progress %). Kept with the cut-off, for everyone.">
        <span style={{fontSize:11,color:"#888",fontWeight:600}}>RTS on</span>
        <button className={"fchip"+(basis==="budget"?" on":"")} disabled={ro} onClick={function(){setBasis("budget");}}>Budget</button>
        <button className={"fchip"+(basis==="dwg"?" on":"")} disabled={ro} onClick={function(){setBasis("dwg");}}>Drawings</button>
        <button className={"fchip"+(basis==="both"?" on":"")} disabled={ro} onClick={function(){setBasis("both");}} title="Both analyses side by side: blue = vs budget, salmon = vs drawings">Both</button>
      </span>
      {!ro&&basis!=="both"&&<button className="btn btn-sm" onClick={function(){fillRts();}} title="Copy the RTS theo. (on the basis chosen) into the RTS real of every WBS with a progress %, then change the cells you want">⇩ Fill RTS real</button>}
      {!ro&&basis==="both"&&<><button className="btn btn-sm" style={{background:CON_BG_BUD}} onClick={function(){fillRts("budget");}} title="RTS real of every WBS with a % = RTS theo. on the budget">⇩ Fill RTS real from budget</button>
        <button className="btn btn-sm" style={{background:CON_BG_DWG}} onClick={function(){fillRts("dwg");}} title="RTS real of every WBS with a % = RTS theo. on the drawings">⇩ Fill RTS real from drawings</button></>}
      <button className="btn btn-sm" onClick={function(){conCutoffXlsx(cur,types,wbs,pours,gp);}}>⤓ Excel</button>
      <button className="btn btn-sm" onClick={function(){conCutoffReport(cur,prev,rows,tot,prevTot,label,gp);}}>Report</button>
      {edit&&!cur.closed&&<button className="btn btn-sm" onClick={close} title="Freeze the progress and the remain to be spent of this cut-off">🔒 Close</button>}
      {cur.closed&&isAdmin&&!window._ppReadOnly&&<button className="btn btn-sm" onClick={reopen}>Reopen</button>}
      {edit&&invCanDelete()&&<button className="btn btn-sm" style={{color:"#b3302a"}} onClick={del}>Delete</button>}
      {newBtn}
    </div>
    {(function(){
      // Tiles: common figures, then one block per analysis (blue = vs budget, salmon = vs drawings).
      var box=function(bg,title,kids){return <div style={{display:"flex",gap:8,flexWrap:"wrap",flex:"1 1 420px",padding:8,borderRadius:8,background:bg,alignContent:"flex-start"}}>
        <div style={{width:"100%",fontSize:10.5,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--brand-ink,#173b63)"}}>{title}</div>{kids}</div>;};
      var tB="#f6f9fe",tD="#fff6f2";
      return <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12,alignItems:"stretch"}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",flex:"1 1 300px",padding:8,alignContent:"flex-start"}}>
          <div style={{width:"100%",fontSize:10.5,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#888"}}>Common</div>
          <InvBig label="Poured at cut-off" value={tot.realAll} unit={CON_UNIT} sub={"to "+fmtDate(cur.date)+(prevTot?" · +"+conFmt(tot.realAll-prevTot.realAll)+" in the period":"")}/>
          <InvBig label="Remain to be spent, real" value={tot.nAdj?tot.rtsReal:null} unit={CON_UNIT} colour={tot.nRtsMissing?"#b35c00":null}
            sub={"typed by hand · "+tot.nAdj+" WBS"+(tot.nRtsMissing?" · "+tot.nRtsMissing+" WBS still to type (no EOS)":"")}/>
          <InvBig label="EOS" value={tot.nEac?tot.eac:null} unit={CON_UNIT} sub={"poured "+conFmt(tot.realAll)+" + RTS real "+conFmt(tot.rtsReal)+(tot.nRtsMissing?" · ⚠ "+tot.nRtsMissing+" WBS with something left and no RTS real (counted 0; RTS theo. "+conFmt(tot.rtsTheoMissing||0)+")":"")}/>
        </div>
        {showB&&box(CON_BG_BUD,"Analysis vs budget",<>
          <InvBig bg={tB} label="Budget (theoretical)" value={tot.theoAll} unit={CON_UNIT} sub={rows.length+" WBS · "+label}/>
          <InvBig bg={tB} label="Budget unlocked (earned)" value={tot.earned} unit={CON_UNIT} sub={(tot.pct===null?"":tot.pct.toFixed(1)+"% of the budget")+(prevTot?" · +"+conFmt(tot.earned-prevTot.earned)+" since "+fmtDate(prev.date):"")}/>
          <InvBig bg={tB} label={"Concrete "+(tot.nPct?conLossWord(tot.variance):"loss / gain")+" vs budget"} value={tot.nPct?Math.abs(tot.variance):null} unit={CON_UNIT} colour={tot.nPct?conLossCol(tot.variance):null}
            sub={tot.nPct?"poured "+conFmt(tot.real)+" − earned "+conFmt(tot.earned)+" ("+conPct(tot.varPct)+") · "+tot.nPct+" WBS with %":"type the progress % of the WBS"}/>
          <InvBig bg={tB} label="RTS theo. on the budget" value={tot.nPct?tot.rtsTheoB:null} unit={CON_UNIT} sub="budget − earned"/>
          <InvBig bg={tB} label="EOS − budget" value={tot.nEac?tot.eacVar:null} unit={CON_UNIT} colour={conLossCol(tot.eacVar)} sub={tot.nEac?conPct(tot.eacPct)+(prevTot&&prevTot.nEac?" · was "+(prevTot.eacVar>0?"+":"")+conFmt(prevTot.eacVar):""):"needs the RTS real"}/>
        </>)}
        {showD&&box(CON_BG_DWG,"Analysis vs drawings",<>
          <InvBig bg={tD} label="Drawings" value={tot.dwgAll>CON_EPS?tot.dwgAll:null} unit={CON_UNIT} sub={tot.dwgAll>CON_EPS?"quantities measured on the drawings":"type them in Overview › Theoretical per WBS › Drawings"}/>
          <InvBig bg={tD} label="Drawings unlocked" value={tot.nDwg?tot.earnedDwg:null} unit={CON_UNIT} sub={tot.nDwg?tot.nDwg+" WBS with % and drawings":""}/>
          <InvBig bg={tD} label={"Concrete "+(tot.nDwg?conLossWord(tot.varDwg):"loss / gain")+" vs drawings"} value={tot.nDwg?Math.abs(tot.varDwg):null} unit={CON_UNIT} colour={tot.nDwg?conLossCol(tot.varDwg):null}
            sub={tot.nDwg?"poured "+conFmt(tot.realDwg)+" − drawings × % "+conFmt(tot.earnedDwg)+" ("+conPct(tot.varDwgPct)+")":""}/>
          <InvBig bg={tD} label="RTS theo. on the drawings" value={tot.nPct?tot.rtsTheoD:null} unit={CON_UNIT} sub="drawings − drawings × % (budget − earned on a WBS without drawings)"/>
          <InvBig bg={tD} label="EOS − drawings" value={tot.eacVarDwg} unit={CON_UNIT} colour={conLossCol(tot.eacVarDwg)} sub={tot.eacVarDwg!==null?conPct(tot.eacDwgPct)+" · WBS with drawings and RTS real":"needs drawings and the RTS real"}/>
        </>)}
      </div>;
    })()}
    <ConGroupProgress gp={gp} whole={!zone&&!ql} basis={basis}/>
    {tot.nNoPct>0&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>⚠ {tot.nNoPct} WBS have no progress % at this cut-off ({conFmt(tot.theoNoPct)} {CON_UNIT} budget, {conFmt(tot.realNoPct)} {CON_UNIT} poured): they are left out of the loss / gain, the remain to be spent and the EOS until a % is typed.</div>}
    {recon&&<div style={{fontSize:12,color:"#b3302a",marginBottom:8}}>⚠ Reconciliation: the pour register holds {conFmt(recon.all)} {CON_UNIT} up to {fmtDate(cur.date)}, the WBS of this cut-off {conFmt(recon.inRows)} {CON_UNIT} — {conFmt(recon.all-recon.inRows)} {CON_UNIT} are on a deleted WBS or type, or on a line without a type (Pours tab).</div>}
    {cur.closed&&cur.snap&&<div style={{fontSize:12,color:"#0f5299",marginBottom:8}}>🔒 Frozen figures: this cut-off shows the budgets, drawings, pours, progress and RTS as they were when it was closed{cur.snap.by?" by "+cur.snap.by:""}{cur.snap.at?" on "+fmtDate(cur.snap.at.slice(0,10)):""}. Later edits do not change it; reopen it to recalculate.</div>}
    {frozenDiff&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>ℹ Since the closing the data moved (budget, drawings or pours edited, WBS merged / split): recalculated today this cut-off would give budget {conFmt(frozenDiff.theoAll)} (frozen {conFmt(tot.theoAll)}), drawings {conFmt(frozenDiff.dwgAll)} ({conFmt(tot.dwgAll)}), poured {conFmt(frozenDiff.realAll)} ({conFmt(tot.realAll)}), budget unlocked {conFmt(frozenDiff.earned)} ({conFmt(tot.earned)}), EOS {conFmt(frozenDiff.eac)} ({conFmt(tot.eac)}) {CON_UNIT}.</div>}
    {cur.closed&&!cur.snap&&<div style={{fontSize:12,color:"#888",marginBottom:8}}>This cut-off was closed before the figures were frozen at closing: it is still recalculated from today's data. Reopen and close it again to freeze it.</div>}
    {drift&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:8}}>⚠ Figures moved since the cut-off was closed (pours or theoretical quantities edited): at closing, budget {conFmt(drift.theo)}, earned {conFmt(drift.earned)}, real {conFmt(drift.real)} {CON_UNIT}.</div>}
    {(function(){
      // Columns grouped by analysis: common (WBS, progress, poured), vs budget (blue), vs drawings
      // (salmon), then the RTS real typed by hand and the EOS (common to both).
      var B=R,D=R;   // backgrounds from the classes cb / cd (con-cut CSS: zebra rows, grid lines)
      var bS=function(o){return Object.assign({},B,o||{});},dS=function(o){return Object.assign({},D,o||{});};
      var dash=<span style={{color:"#bbb"}}>—</span>;
      var sg=function(v){return (v>0?"+":"")+conFmt(v);};
      var nB=7,nD=6;
      return <div style={{overflow:"auto",maxHeight:"70vh",border:"1px solid var(--rule)",borderRadius:"var(--r-sm)"}}><table className="tbl con-cut" style={{overflow:"visible",border:"none"}}>
      <thead>
        <tr>
          <th colSpan={4} style={{borderBottom:"none"}}/>
          {showB&&<th colSpan={nB} className="cb" style={{textAlign:"center",color:"var(--brand-ink,#173b63)"}}>Analysis vs budget</th>}
          {showD&&<th colSpan={nD} className="cd" style={{textAlign:"center",color:"#8a3a1c"}}>Analysis vs drawings</th>}
          <th colSpan={2} style={{textAlign:"center"}}>Remain &amp; forecast</th>
          <th style={{borderBottom:"none"}}/>
        </tr>
        <tr><th>WBS</th><th style={R} title="Physical progress at the cut-off date">Progress %</th><th style={R} title="Progress of the linked schedule activities at the cut-off date — for reference only, never used in the figures">Sched. % (ref.)</th>
        <th style={R} title="Concrete poured up to the cut-off date">Poured at cut-off</th>
        {showB&&<><th className="cb" style={B}>Budget</th><th className="cb" style={B} title="Budget × progress %">Budget unlocked</th><th className="cb" style={B} title="Poured ÷ budget, a volume ratio for reference — not a progress">Poured / budget</th>
          <th className="cb" style={B} title="Poured − budget × progress %: > 0 loss, < 0 gain">vs budget<div style={{fontSize:9,fontWeight:400}}>loss (+) / gain (−)</div></th><th className="cb" style={B}>%</th>
          <th className="cb" style={B} title="Budget − earned">RTS theo.</th><th className="cb" style={B} title="EOS − budget">EOS − budget</th></>}
        {showD&&<><th className="cd" style={D} title="Quantities measured on the drawings (Overview › Theoretical per WBS › Drawings)">Drawings</th><th className="cd" style={D} title="Drawings × progress %">Drawings unlocked</th>
          <th className="cd" style={D} title="Poured − drawings × progress %: > 0 loss, < 0 gain. Only on the WBS with drawings quantities.">vs drawings<div style={{fontSize:9,fontWeight:400}}>loss (+) / gain (−)</div></th><th className="cd" style={D}>%</th>
          <th className="cd" style={D} title="Drawings − drawings × progress % (budget − earned, in grey, where the WBS has no drawings quantities)">RTS theo.</th><th className="cd" style={D} title="EOS − drawings quantities">EOS − drawings</th></>}
        <th style={R} title="Remain to be spent, real: typed by hand. ⇩ Fill RTS real copies the RTS theo. into every cell.">RTS real</th>
        <th style={R} title="Poured + RTS real">EOS</th>
        <th style={{minWidth:200}} title="Why this WBS shows a loss, a gain, an overrun… Shared with everyone, printed and exported. Can be written after the cut-off is closed.">EXPLANATION</th></tr></thead>
      <tbody>{rows.map(function(r){
        var w=r.wbs;
        var mismatch=r.hasPct&&r.realPct!==null&&Math.abs(r.realPct-r.pct)>25;
        return <tr key={w.id}>
          <td><b>{w.code}</b> {w.name}{w.done&&<span style={{fontSize:10,color:"#1e6b3a"}}> · complete</span>}
            {w.done&&r.hasPct&&r.pct<100&&<div style={{fontSize:10,color:"#ef6c00"}}>marked complete but below 100%</div>}</td>
          <td style={Object.assign({whiteSpace:"nowrap"},R)}>{ro?(r.hasPct?r.pct.toFixed(0)+"%":<span style={{color:"#ef6c00"}}>—</span>)
            :<ConNumCell key={cur.id+w.id+"p"} value={r.line.pct} width={58} placeholder="—" onCommit={function(v){commitPct(r,v);}}/>}</td>
          <td style={Object.assign({fontSize:12},R)}>{schedPct[w.id]===undefined?<span style={{color:"#ccc"}}>{(w.schedLinks||[]).length?"—":""}</span>
            :<span style={{color:r.hasPct&&Math.abs(r.pct-schedPct[w.id])>10?"#ef6c00":"#888"}} title="Schedule progress, for reference only">{schedPct[w.id]}%</span>}</td>
          <td style={R}>{conFmt(r.real)}</td>
          {showB&&<>
            <td className="cb" style={B}>{conFmt(r.theo)}</td>
            <td className="cb" style={B}>{r.hasPct?conFmt(r.earned):dash}</td>
            <td className="cb" style={bS({color:mismatch?"#ef6c00":"#888",fontSize:12})} title={mismatch?"Volume progress far from the physical progress: check the % or the pours":""}>{r.realPct===null?"—":r.realPct.toFixed(0)+"%"}</td>
            <td className="cb" style={bS({fontWeight:700,color:r.hasPct?conLossCol(r.variance):"#bbb"})}>{r.hasPct?sg(r.variance):"—"}</td>
            <td className="cb" style={bS({color:r.hasPct?conLossCol(r.variance):"#bbb"})}>{r.hasPct?conPct(r.varPct):""}</td>
            <td className="cb" style={B}>{r.hasPct?conFmt(r.rtsTheoB):dash}</td>
            <td className="cb" style={bS({fontWeight:700,color:conLossCol(r.eacVar)})}>{r.eacVar!==null?<>{sg(r.eacVar)}<div style={{fontSize:10,fontWeight:400}}>{conPct(r.eacPct)}</div></>:dash}</td>
          </>}
          {showD&&<>
            <td className="cd" style={dS({color:"#555"})} title={r.hasDwg?"Drawings − budget: "+sg(r.dwg-r.theo):"No drawings quantities typed"}>{r.hasDwg?conFmt(r.dwg):<span style={{color:"#ccc"}}>—</span>}</td>
            <td className="cd" style={D}>{r.hasPct&&r.hasDwg?conFmt(r.earnedDwg):dash}</td>
            <td className="cd" style={dS({fontWeight:700,color:r.varDwg!==null?conLossCol(r.varDwg):"#bbb"})}>{r.varDwg!==null?sg(r.varDwg):"—"}</td>
            <td className="cd" style={dS({color:r.varDwg!==null?conLossCol(r.varDwg):"#bbb"})}>{r.varDwg!==null?conPct(r.varDwgPct):""}</td>
            <td className="cd" style={dS(!r.rtsDwgAny?{color:"#999",fontStyle:"italic"}:null)} title={!r.rtsDwgAny?"No drawings quantities on this WBS: budget − earned":"Drawings − drawings × progress % (only the types on the drawings)"}>{r.hasPct?conFmt(r.rtsTheoD):dash}</td>
            <td className="cd" style={dS({fontWeight:700,color:conLossCol(r.eacVarDwg)})}>{r.eacVarDwg!==null?<>{sg(r.eacVarDwg)}<div style={{fontSize:10,fontWeight:400}}>{conPct(r.eacDwgPct)}</div></>:dash}</td>
          </>}
          <td style={Object.assign({background:r.hasPct&&r.rtsMissing?"#fdf1e0":undefined},R)}>{ro?<span>{r.rtsMissing?<span style={{color:"#b35c00"}}>not typed</span>:r.adjusted?conFmt(r.rtsReal):dash}</span>
            :<ConNumCell key={cur.id+w.id+"r"+typeIds.join()} value={r.adjusted?r.rtsReal:null} width={80} placeholder={r.rtsMissing?"to type":"—"}
              title={"Remain to be spent, real: typed by hand (RTS theo.: budget "+conFmt(r.rtsTheoB)+" · drawings "+conFmt(r.rtsTheoD)+"). ⇩ Fill RTS real copies the RTS theo. into every cell."+(r.rtsMissing?" Not typed yet: counted as 0 in the EOS.":" Empty = nothing left to pour.")} onCommit={function(v){commitRts(r,v);}}/>}</td>
          <td style={Object.assign({fontWeight:600},R)}>{conFmt(r.eac)}</td>
          <td style={{verticalAlign:"top"}}><ConExplCell key={cur.id+w.id+"x"} value={(conCutoffLine(cur,w.id)||{}).note||""} ro={!edit}
            onCommit={function(v){if(blockIfReadOnly())return;setLine(w.id,{note:v||undefined});}}/></td>
        </tr>;
      })}
      </tbody><tfoot><tr style={{fontWeight:700}}><td>Total — {rows.length} WBS ({tot.nPct} with %{tot.nDwg?", "+tot.nDwg+" with drawings":""})</td>
        <td style={R}>{tot.pct===null?"—":tot.pct.toFixed(1)+"%"}</td><td/><td style={R}>{conFmt(tot.realAll)}</td>
        {showB&&<><td className="cb" style={B}>{conFmt(tot.theoAll)}</td><td className="cb" style={B}>{conFmt(tot.earned)}</td><td className="cb" style={B}>{tot.theoAll>CON_EPS?(tot.realAll/tot.theoAll*100).toFixed(0)+"%":"—"}</td>
          <td className="cb" style={bS({color:conLossCol(tot.variance)})}>{tot.nPct?sg(tot.variance):"—"}</td><td className="cb" style={bS({color:conLossCol(tot.variance)})}>{tot.nPct?conPct(tot.varPct):""}</td>
          <td className="cb" style={B}>{conFmt(tot.rtsTheoB)}</td><td className="cb" style={bS({color:conLossCol(tot.eacVar)})}>{tot.eacVar!==null?<>{sg(tot.eacVar)} <span style={{fontWeight:400,fontSize:11}}>{conPct(tot.eacPct)}</span></>:"—"}</td></>}
        {showD&&<><td className="cd" style={D}>{tot.dwgAll>CON_EPS?conFmt(tot.dwgAll):"—"}</td><td className="cd" style={D}>{tot.nDwg?conFmt(tot.earnedDwg):"—"}</td>
          <td className="cd" style={dS({color:conLossCol(tot.varDwg)})}>{tot.nDwg?sg(tot.varDwg):"—"}</td><td className="cd" style={dS({color:conLossCol(tot.varDwg)})}>{tot.nDwg?conPct(tot.varDwgPct):""}</td>
          <td className="cd" style={D}>{conFmt(tot.rtsTheoD)}</td><td className="cd" style={dS({color:conLossCol(tot.eacVarDwg)})}>{tot.eacVarDwg!==null?<>{sg(tot.eacVarDwg)} <span style={{fontWeight:400,fontSize:11}}>{conPct(tot.eacDwgPct)}</span></>:"—"}</td></>}
        <td style={R}>{conFmt(tot.rtsReal)}</td><td style={R}>{tot.eac===null?"—":conFmt(tot.eac)}</td><td/></tr>
      </tfoot></table></div>;
    })()}
    <div style={{fontSize:11,color:"#888",marginTop:8}}>
      Only the progress % typed here counts: nothing is filled in automatically, and a WBS without a % is left out of the loss / gain, the RTS and the EOS. Earned = budget × progress %. Poured = concrete poured up to {fmtDate(cur.date)}; loss (+) / gain (−) vs budget = poured − earned. Vs drawings = poured − drawings quantities × the same progress %, on the WBS whose drawings quantities are typed (Overview › Theoretical per WBS › Drawings); EOS − drawings = EOS − drawings quantities. RTS = remain to be spent: theoretical = on the basis chosen above — budget − earned, or drawings − drawings × progress % (budget − earned on a WBS without drawings quantities); real = typed by hand only (⇩ Fill RTS real copies the theoretical one into every cell, then change the ones you want); a WBS without its RTS real has no EOS.
      {!typeId&&" With all types shown, a typed RTS real is shared over the WBS's types pro rata; pick a type to adjust it type by type."} EOS = real + RTS real.
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
    {err&&<div style={{fontSize:12,color:"#b3302a",marginTop:8}}>{err}</div>}
  </InvModal>;
}
function conCutoffReport(c,prev,rows,tot,prevTot,label,gp){
  var E=esc;
  var td=function(v,b,col){return'<td style="text-align:right;'+(b?"font-weight:700;":"")+(col?"color:"+col+";":"")+'">'+v+"</td>";};
  var sg=function(v){return(v>0?"+":"")+conFmt(v);};
  // Same grouping as the screen: common, vs budget (blue), vs drawings (salmon), RTS real + EOS.
  var bs=conRtsBasis(c),shB=bs!=="dwg",shD=bs!=="budget";
  var tdc=function(bg,v,b,col){return'<td style="text-align:right;background:'+bg+';'+(b?"font-weight:700;":"")+(col?"color:"+col+";":"")+'">'+v+"</td>";};
  var body=rows.map(function(r,i){
    // zebra rows: one tone darker every other line, in each block, to read a line across
    var ev=i%2===1,cN=ev?"#f3f1ec":"#fff";
    var tB=function(v,b,col){return tdc(ev?"#dae6f7":"#ecf2fc",v,b,col);},tD=function(v,b,col){return tdc(ev?"#f8dccf":"#fdeee7",v,b,col);};
    var td=function(v,b,col){return tdc(cN,v,b,col);};
    var h=r.hasPct,vd=r.varDwg!==null;
    return"<tr><td style=\"background:"+cN+"\"><b>"+E(r.wbs.code)+"</b> "+E(r.wbs.name)+"</td>"+td(h?r.pct.toFixed(0)+"%":"—")+td(conFmt(r.real))
      +(shB?tB(conFmt(r.theo))+tB(h?conFmt(r.earned):"—")+tB(h?sg(r.variance):"—",true,h?conLossCol(r.variance):null)+tB(h?conPct(r.varPct):"")+tB(h?conFmt(r.rtsTheoB):"—")+tB(r.eacVar!==null?sg(r.eacVar):"—",true,conLossCol(r.eacVar)):"")
      +(shD?tD(r.hasDwg?conFmt(r.dwg):"—")+tD(h&&r.hasDwg?conFmt(r.earnedDwg):"—")+tD(vd?sg(r.varDwg):"—",true,vd?conLossCol(r.varDwg):null)+tD(vd?conPct(r.varDwgPct):"")+tD(h?conFmt(r.rtsTheoD):"—")+tD(r.eacVarDwg!==null?sg(r.eacVarDwg):"—",true,conLossCol(r.eacVarDwg)):"")
      +td(r.rtsMissing?"not typed":r.adjusted?conFmt(r.rtsReal):"—")+td(conFmt(r.eac),true)+'<td style="background:'+cN+';font-size:9px;white-space:pre-wrap;max-width:200px">'+E((conCutoffLine(c,r.wbs.id)||{}).note||"")+"</td></tr>";
  }).join("");
  var thB=function(x){return'<th style="background:#d6e3f6">'+x+"</th>";},thD=function(x){return'<th style="background:#f9d6c8">'+x+"</th>";};
  var head="<tr><th colspan=\"3\"></th>"+(shB?'<th colspan="6" style="background:#d6e3f6">Analysis vs budget</th>':"")+(shD?'<th colspan="6" style="background:#f9d6c8">Analysis vs drawings</th>':"")+'<th colspan="2">Remain &amp; forecast</th><th></th></tr>'
    +"<tr><th>WBS</th><th>Progress</th><th>Poured</th>"+(shB?["Budget","Earned","vs budget","%","RTS theo.","EOS − budget"].map(thB).join(""):"")+(shD?["Drawings","Drawings × %","vs drawings","%","RTS theo.","EOS − drawings"].map(thD).join(""):"")+"<th>RTS real</th><th>EOS</th><th>Explanation</th></tr>";
  var html="<h1>Concrete — cut-off cost control</h1><div class=\"sub\">Riviera Tower · cut-off "+E(fmtDate(c.date))+(c.label?" ("+E(c.label)+")":"")+" · "+E(label)+(c.closed?" · closed":" · open (provisional)")+"</div>"
    +(gp&&gp.groups.length?"<h2>Progress per group ("+CON_UNIT+") — progress of the WBS applied to the total budget and drawings</h2><table><tr><th>Group</th><th>Measured qty</th><th>Progress</th><th>Budget</th><th>Budget unlocked</th><th>Poured</th><th>vs budget</th><th>Drawings</th><th>vs drawings</th><th>RTS</th><th>EOS</th></tr>"
      +gp.groups.concat(gp.groups.length>1?[gp.total]:[]).map(function(g){var tot_=g.key==="total";
        return"<tr"+(tot_?" style=\"font-weight:700\"":"")+"><td><b>"+E(g.label)+"</b>"+(tot_?"":"<div style=\"font-size:9px;color:#888\">"+E(g.names.join(", "))+"</div>")+"</td>"
          +td(tot_?"":g.basis?conFmt(g.basisQty)+" ("+g.basis+")":"—")+td(g.pct===null?"—":(g.pct*100).toFixed(1)+"%"+(!tot_&&g.nNoPct?" · "+g.nNoPct+" at 0%":""))+td(conFmt(g.budget)+(g.budMan?" *":""))
          +td(g.budgetEarned===null?"—":conFmt(g.budgetEarned))+td(conFmt(g.poured))+td(g.variance===null?"—":sg(g.variance)+(g.varPct===null?"":" ("+conPct(g.varPct)+")"),true,g.variance===null?null:conLossCol(g.variance))
          +td(g.dwg>CON_EPS?conFmt(g.dwg)+(g.dwgMan?" *":""):"—")+td(g.varDwg===null||g.varDwg===undefined?"—":sg(g.varDwg),true,g.varDwg===null||g.varDwg===undefined?null:conLossCol(g.varDwg))+td(g.rts===null?"—":conFmt(g.rts))+td(g.eac===null?"—":conFmt(g.eac)+" ("+sg(g.eacVar)+")",false,g.eac===null?null:conLossCol(g.eacVar))+"</tr>";}).join("")
      +"</table><div style=\"font-size:10px;color:#8b8578\">Lean concrete apart from the other concretes. Progress = Σ (quantity × progress % of each WBS) ÷ Σ quantities — quantity = drawings, or budget when a WBS has no drawings; WBS without a % at 0%. Applied to the group's total budget and drawings (* = project total typed by hand).</div>":"")
    +"<h2>Summary ("+CON_UNIT+") — WBS with a progress % ("+tot.nPct+" of "+tot.n+")</h2><table><tr><th>Budget</th><th>Earned</th><th>Poured</th><th>Loss (+) / gain (−) vs budget</th><th>RTS theo.</th><th>RTS real</th><th>EOS</th><th>EOS − budget</th></tr><tr>"
    +td(conFmt(tot.theo))+td(conFmt(tot.earned))+td(conFmt(tot.real))+td(sg(tot.variance)+" ("+conPct(tot.varPct)+")",true,conLossCol(tot.variance))+td(conFmt(tot.rtsTheo))+td(conFmt(tot.rtsReal))+td(conFmt(tot.eac))+td(sg(tot.eacVar)+" ("+conPct(tot.eacPct)+")",true,conLossCol(tot.eacVar))+"</tr>"
    +(prevTot?"<tr><td colspan=\"8\" style=\"font-size:11px;color:#555\">Since "+E(fmtDate(prev.date))+": earned +"+conFmt(tot.earned-prevTot.earned)+", poured (all WBS) +"+conFmt(tot.realAll-prevTot.realAll)+"</td></tr>":"")+"</table>"
    +(tot.nDwg?"<h2>Against the drawings ("+CON_UNIT+") — WBS with a progress % and drawings quantities ("+tot.nDwg+")</h2><table><tr><th>Budget</th><th>Drawings</th><th>Drawings − budget</th><th>Drawings × %</th><th>Poured</th><th>Loss (+) / gain (−) vs drawings</th><th>EOS</th><th>EOS − drawings</th></tr><tr>"
      +td(conFmt(tot.theoDwg))+td(conFmt(tot.dwg))+td(sg(tot.dwg-tot.theoDwg),false,conLossCol(tot.dwg-tot.theoDwg))+td(conFmt(tot.earnedDwg))+td(conFmt(tot.realDwg))+td(sg(tot.varDwg)+" ("+conPct(tot.varDwgPct)+")",true,conLossCol(tot.varDwg))+td(conFmt(tot.eacDwg))+td(sg(tot.eacVarDwg)+" ("+conPct(tot.eacDwgPct)+")",true,conLossCol(tot.eacVarDwg))+"</tr></table>":"")
    +(tot.nNoPct?"<div style=\"font-size:11px;color:#b45309\">"+tot.nNoPct+" WBS without progress % ("+conFmt(tot.theoNoPct)+" budget, "+conFmt(tot.realNoPct)+" poured) are not measured.</div>":"")
    +"<h2>Per WBS</h2><table style=\"border-collapse:collapse\" class=\"con-grid\"><thead>"+head+"</thead><tbody>"+body+"</tbody></table><style>.con-grid th,.con-grid td{border:1px solid #c9c2b2}.con-grid thead{display:table-header-group}</style>"
    +(c.note?"<h2>Note</h2><div>"+E(c.note)+"</div>":"")
    +"<div style=\"font-size:10px;color:#8b8578\">Progress % typed by hand only. Earned = budget × progress %. Poured = pours up to the cut-off date. Loss (+) / gain (−) vs budget = poured − earned; vs drawings = poured − drawings quantities × progress % (WBS with drawings quantities only). RTS theo. on the "+(conRtsBasis(c)==="dwg"?"drawings (drawings − drawings × progress %; budget − earned without drawings)":"budget (budget − earned)")+"; RTS real typed by hand. EOS = poured + RTS real (only the WBS whose RTS real is typed). EOS = poured + RTS real.</div>";
  openReport("CONCRETE CUT-OFF - "+c.date,html);
}
function conCutoffXlsx(c,types,wbs,pours,gp){
  if(!window.XLSX||!window.XLSX.utils||!window.XLSX.writeFile){safeAlert("The Excel library is not loaded.");return;}
  var st=conSortTypes(types),allIds=types.map(function(t){return t.id;});
  var r2=function(v){return Math.round(v*100)/100;};
  var rows=conCutoffRows(c,wbs,pours,allIds);
  var h=function(r,v){return r.hasPct?r2(v):"";};
  var n2=function(v){return v===null||v===undefined?"":r2(v);};
  var sum=rows.map(function(r){return{"Code":r.wbs.code,"Description":r.wbs.name,"Zone":r.wbs.zone,"Budget":r2(r.theo),"Drawings":r.hasDwg?r2(r.dwg):"","Drawings − budget":r.hasDwg?r2(r.dwg-r.theo):"","Progress %":r.hasPct?r.pct:"","Earned":h(r,r.earned),"Poured":r2(r.real),
    "Loss(+)/gain(-) vs budget":h(r,r.variance),"% vs budget":r.varPct===null?"":r2(r.varPct),"Drawings × %":r.varDwg!==null?r2(r.earnedDwg):"","Loss(+)/gain(-) vs drawings":n2(r.varDwg),"% vs drawings":n2(r.varDwgPct),
    "RTS theo. (budget)":h(r,r.rtsTheoB),"RTS theo. (drawings)":h(r,r.rtsTheoD),"RTS real":r.adjusted?r2(r.rtsReal):"","EOS":r2(r.eac),"EOS − budget":r2(r.eacVar),"EOS − drawings":n2(r.eacVarDwg),"Explanation":(conCutoffLine(c,r.wbs.id)||{}).note||"","Budget comment":r.wbs.theoNote||""};});
  var det=[];
  rows.forEach(function(r){st.forEach(function(t){var b=r.byType[t.id];if(!b||(b.theo<=CON_EPS&&b.real<=CON_EPS&&b.dwg<=CON_EPS))return;
    det.push({"Code":r.wbs.code,"Type":t.name,"Budget":r2(b.theo),"Drawings":b.dwg>CON_EPS?r2(b.dwg):"","Progress %":r.hasPct?r.pct:"","Earned":h(r,b.earned),"Poured":r2(b.real),"Loss(+)/gain(-) vs budget":h(r,b.real-b.earned),"Loss(+)/gain(-) vs drawings":r.hasPct&&b.dwg>CON_EPS?r2(b.real-b.earnedDwg):"","RTS theo. (budget)":h(r,b.rtsTheoB),"RTS theo. (drawings)":h(r,b.rtsTheoD),"RTS real":b.adjusted?r2(b.rtsReal):"","EOS":r2(b.real+(b.rtsReal||0)),"EOS − budget":r2(b.real+(b.rtsReal||0)-b.theo)});});});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(sum),"Per WBS");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(det),"Per WBS and type");
  if(gp&&gp.groups.length){var n2=function(v){return v===null||v===undefined?"":r2(v);};
    window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(gp.groups.concat(gp.groups.length>1?[gp.total]:[]).map(function(g){return{"Group":g.label,"Types":(g.names||[]).join(", "),"Measured on":g.basis||"","Measured qty":n2(g.basisQty),"Done":n2(g.basisEarned),"Progress %":g.pct===null?"":r2(g.pct*100),"Items at 0%":g.nNoPct||"","Budget":r2(g.budget),"Budget typed by hand":g.budMan?"Y":"","Budget unlocked":n2(g.budgetEarned),"Poured":r2(g.poured),"Loss(+)/gain(-) vs budget":n2(g.variance),"% vs budget":n2(g.varPct),"Drawings":r2(g.dwg),"Loss(+)/gain(-) vs drawings":n2(g.varDwg),"RTS":n2(g.rts),"EOS":n2(g.eac),"EOS − budget":n2(g.eacVar)};})),"Per group");}
  window.XLSX.writeFile(wb,"Concrete cut-off "+c.date+".xlsx");
}
// A split moves a WBS's quantities to new lines. In CLOSED cut-offs the new lines keep the % that
// was typed for the WBS they come from, so a closed situation does not move. Open cut-offs are
// left alone: the % of the new lines is typed by hand there.
// In every cut-off where the parent had a progress % or an RTS real: each new line takes the
// parent's %, and the RTS real typed on the parent is shared, type by type, between the parent
// (what it keeps) and the new lines in proportion to their budget of that type — so the EOS
// and the earned volume of the cut-off do not move. wbsAfter: the WBS list after the split.
function conSplitCutoffs(cutoffs,parentId,childIds,parentGone,wbsAfter){
  var byId={};(wbsAfter||[]).forEach(function(w){byId[w.id]=w;});
  return(cutoffs||[]).map(function(c){
    var pl=conCutoffLine(c,parentId);
    if(!pl||!(_invHas(pl.pct)||pl.rts))return c;
    var holders=(parentGone?[]:[parentId]).concat(childIds);
    var rtsOf={};holders.forEach(function(id){rtsOf[id]={};});
    Object.keys(pl.rts||{}).forEach(function(t){
      if(!_invHas(pl.rts[t]))return;
      var tot=_invNum(pl.rts[t]),w=holders.map(function(id){return _invNum(((byId[id]||{}).theo||{})[t]);});
      var sw=w.reduce(function(a,b){return a+b;},0);
      if(sw<=CON_EPS){w=holders.map(function(_,i){return i===0?1:0;});sw=1;}
      var acc=0;
      holders.forEach(function(id,i){var v=i===holders.length-1?Math.round((tot-acc)*1000)/1000:Math.round(tot*w[i]/sw*1000)/1000;acc+=v;rtsOf[id][t]=v;});
    });
    var lines=(c.lines||[]).filter(function(l){return l.id!==parentId&&childIds.indexOf(l.id)<0;});
    holders.forEach(function(id){
      var base=id===parentId?Object.assign({},pl):{id:id};
      if(id!==parentId&&_invHas(pl.pct))base.pct=pl.pct;
      if(pl.rts)base.rts=Object.keys(rtsOf[id]).length?rtsOf[id]:undefined;
      lines.push(base);
    });
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
        {a.missing?<span style={{color:"#b3302a"}}>(activity deleted from the schedule)</span>
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
// SUPERSTRUCTURE of "RT - Superstructure Concrete FOLLOW UP"), keeps ONLY the rows whose Zone is
// EXTERNAL (TOWER, PODIUM, DWALL are never imported), and books them as pours.
// The workbook's "Description" is not our WBS: every description is matched by hand to an
// existing WBS, or to a new WBS created on the spot (several descriptions may share one new WBS
// by giving it the same name), or skipped. The matches are remembered on this browser.
// Concrete types and suppliers are matched by name; an unknown type can be created.
// The workbook's Theo Qty is NEVER read: the theoretical m³ are typed in the app only.
// A delivery note already imported (supplier + note + date) is never booked twice; a note n° on several rows is counted row by row.
var CON_IMP_ZONE="EXTERNAL";      // the only zone of the workbook imported here
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
  const [group,setGroup]=useState(true);
  const [choice,setChoice]=useState({});       // desc key → {to:"wbs id"|"new"|"skip", name, code}
  const [tChoice,setTChoice]=useState({});     // type key → type id | "new" | "skip"
  const [q,setQ]=useState("");
  const [onlyOpen,setOnlyOpen]=useState(false);
  const [force,setForce]=useState({});          // delivery notes already imported, to book again anyway
  const [show,setShow]=useState("");            // which diagnostic list is unfolded

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
            sheets[n]=function(){var rows=window.XLSX.utils.sheet_to_json(sh,{header:1,defval:"",raw:true,range:rg});rows.r0=rg.s.r;return rows;};
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
    return {hi:hi,head:head,col:col,body:rows.slice(hi+1),r0:(rows.r0||0)+hi+2};   // r0 = Excel row number of body[0]
  })();
  // Zone column: the one headed "Zone" (column B in the workbook)
  var filterCol=parsed&&!parsed.error?parsed.head.findIndex(function(h){return /^zone$/i.test(h);}):-1;
  var fVal=CON_IMP_ZONE;
  if(parsed&&!parsed.error&&filterCol<0)parsed={error:"No “Zone” column in this sheet: the import keeps only the rows whose Zone is "+CON_IMP_ZONE+"."};
  // the rows kept, read into {desc, date, note, supplier, type, qty, theo}
  var items=[],issues={noQty:0,dateFixed:0,noDate:0},left={noZone:[],noQty:[],noDate:[]};
  if(parsed&&!parsed.error){
    var c=parsed.col,lastDate="";
    parsed.body.forEach(function(r,ri){
      var rowNo=parsed.r0+ri;
      var zone=String(r[filterCol]).trim().toUpperCase();
      var qty=c.qty>=0?conParseNum(r[c.qty]):0;
      var dsc=String(r[c.desc]||"").trim();
      // a row with a quantity and no zone at all: probably a new line whose Zone was forgotten
      if(!zone){if(qty>0)left.noZone.push({row:rowNo,desc:dsc,qty:qty});return;}
      if(zone!==fVal)return;
      if(!(qty>0)){if(dsc){issues.noQty++;left.noQty.push({row:rowNo,desc:dsc,qty:String(r[c.qty]||"")});}return;}
      var d=c.date>=0?conImpDate(r[c.date]):"";
      var mo=c.month>=0?Number(r[c.month]):0,yr=c.year>=0?Number(r[c.year]):0;
      if(!d||d<"2000-01-01"){
        // a typo in the date: the previous row's date when it is in the same month, else the 1st of the month
        if(mo&&yr){var pre=yr+"-"+(mo<10?"0":"")+mo;d=lastDate&&lastDate.slice(0,7)===pre?lastDate:pre+"-01";issues.dateFixed++;}
        else{issues.noDate++;left.noDate.push({row:rowNo,desc:dsc,qty:qty});return;}
      }
      lastDate=d;
      items.push({row:rowNo,desc:dsc||"(no description)",date:d,note:c.note>=0?String(r[c.note]||"").trim():"",
        supplier:c.supplier>=0?String(r[c.supplier]||"").trim():"",type:c.type>=0?String(r[c.type]||"").trim():"",qty:qty,
        level:c.level>=0?String(r[c.level]||"").trim():""});
    });
  }
  // delivery notes already booked
  // Counted per row: a note n° that appears on 2 rows and was booked once leaves its 2nd row new.
  var done={};pours.forEach(function(p){(p.importNotes||[]).forEach(function(k){done[k]=(done[k]||0)+1;});});
  function noteKey(it){return it.note?conImpKey(it.supplier)+"|"+it.note+"|"+it.date:"";}
  var seen={},isDone={};
  items.forEach(function(it){var k=noteKey(it);if(!k)return;seen[k]=(seen[k]||0)+1;if(seen[k]<=(done[k]||0))isDone[it.row]=1;});
  var fresh=items.filter(function(it){return !isDone[it.row]||force[it.row];});
  var alreadyList=items.filter(function(it){return isDone[it.row];});
  var already=alreadyList.length-alreadyList.filter(function(it){return force[it.row];}).length;
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
    <button className="btn btn-pri" disabled={!fresh.length} onClick={apply} title={fresh.length?"":"Nothing new in this file — see the lists above for the rows left out and why"}>Import {fresh.length?conFmt(keptQty)+" "+CON_UNIT:""}</button>
  </React.Fragment>;
  return <InvModal title="⬆ Import pours from the follow-up workbook" width={980} onClose={onClose} footer={footer}>
    <div style={{fontSize:12,color:"#6f6b62",marginBottom:8}}>One row per delivery note (Description · Supplier · Date · N° delivery note · Type of concrete · Real Qty). Only the rows whose <b>Zone is {CON_IMP_ZONE}</b> are imported. Match each <b>Description</b> of the workbook to one of your WBS — or create the WBS here.</div>
    <input type="file" accept=".xlsx,.xlsm,.xls" onChange={onFile}/>
    {busy&&<div style={{fontSize:12.5,color:"#0f5299",marginTop:6}}>⏳ {busy}</div>}
    {err&&<div style={{fontSize:12.5,color:"#b3302a",marginTop:6}}>{err}</div>}
    {book&&<div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",background:"#faf9f6",border:"1px solid #ece9e1",borderRadius:8,padding:"8px 12px",margin:"10px 0",fontSize:12.5}}>
      <span>Sheet <select value={sheet} onChange={function(e){setSheet(e.target.value);setChoice({});setTChoice({});}} style={inp}>{book.names.map(function(n){return <option key={n} value={n}>{n}</option>;})}</select></span>
      {parsed&&!parsed.error&&<span title="Only the external works are imported; TOWER, PODIUM and DWALL rows are left out">Rows kept: <b>{String.fromCharCode(65+filterCol)} · Zone = {CON_IMP_ZONE}</b> only</span>}
      <label style={{display:"flex",alignItems:"center",gap:4,margin:0,textTransform:"none",letterSpacing:"normal",fontSize:12.5,fontFamily:"inherit"}} title="One pour per day and WBS, each type × supplier a line; the delivery notes are kept in the reference. Unticked: one pour per delivery note (much heavier).">
        <input type="checkbox" checked={group} onChange={function(e){setGroup(e.target.checked);}}/>one pour per day × WBS</label>
    </div>}
    {parsed&&parsed.error&&<div style={{fontSize:12.5,color:"#b3302a"}}>{parsed.error}</div>}
    {parsed&&!parsed.error&&<div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12.5,marginBottom:8}}>
        <span><b>{items.length}</b> delivery notes · <b>{conFmt(items.reduce(function(s,it){return s+it.qty;},0))} {CON_UNIT}</b></span>
        {items.length>0&&<span>{fmtDate(items.reduce(function(m,it){return it.date<m?it.date:m;},"9999"))} → {fmtDate(items.reduce(function(m,it){return it.date>m?it.date:m;},""))}</span>}
        {issues.noQty>0&&<span style={{color:"#b35c00"}}>{issues.noQty} row(s) without quantity</span>}
        {issues.dateFixed>0&&<span style={{color:"#b35c00"}} title="Date missing or before 2000: taken from the Month / Year columns">{issues.dateFixed} date(s) taken from Month/Year</span>}
        {issues.noDate>0&&<span style={{color:"#b3302a"}}>{issues.noDate} row(s) without date (skipped)</span>}
      </div>
      {(function(){
        // What is new, what is left out and why — each list unfolds with the Excel row numbers.
        function list(key,title,col,rows,render){
          if(!rows.length)return null;
          var open=show===key;
          return <div style={{marginBottom:6}}>
            <button type="button" onClick={function(){setShow(open?"":key);}} style={{background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",fontSize:12.5,color:col,fontWeight:600}}>
              {open?"▾":"▸"} {title}</button>
            {open&&<div style={{maxHeight:220,overflowY:"auto",border:"1px solid #ece9e1",borderRadius:6,marginTop:4}}><table className="tbl" style={{fontSize:11.5,margin:0}}><tbody>
              {rows.slice(0,300).map(render)}</tbody></table></div>}
          </div>;
        }
        var newQty=fresh.reduce(function(s,it){return s+it.qty;},0);
        return <div style={{background:fresh.length?"#f3fbf4":"#faf3e0",border:"1px solid "+(fresh.length?"#cfe3d5":"#f0e2b8"),borderRadius:8,padding:"8px 12px",marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6,color:fresh.length?"#1e6b3a":"#8a6a1e"}}>
            {fresh.length?fresh.length+" delivery note"+(fresh.length>1?"s":"")+" to import · "+conFmt(newQty)+" "+CON_UNIT
              :"Nothing new to import"+(items.length?": every "+CON_IMP_ZONE+" delivery note of this file is already in the app.":".")}</div>
          {list("new","See the new rows ("+fresh.length+")","#1e6b3a",fresh,function(it,i){return <tr key={"n"+i}><td>row {it.row}</td><td>{fmtDate(it.date)}</td><td>{it.desc}</td><td>{it.supplier} {it.note}</td><td style={{textAlign:"right"}}>{conFmt(it.qty)}</td></tr>;})}
          {list("done",alreadyList.length+" already imported — tick one to import it again","#6f6b62",alreadyList,function(it,i){
            return <tr key={"d"+i}><td><input type="checkbox" checked={!!force[it.row]} onChange={function(e){var v=e.target.checked;setForce(function(o){var n=Object.assign({},o);if(v)n[it.row]=true;else delete n[it.row];return n;});}}/></td>
              <td>row {it.row}</td><td>{fmtDate(it.date)}</td><td>{it.desc}</td><td>{it.supplier} {it.note}</td><td style={{textAlign:"right"}}>{conFmt(it.qty)}</td></tr>;})}
          {list("zone",left.noZone.length+" row(s) with a quantity but an empty Zone (column B) — not imported: write "+CON_IMP_ZONE+" in column B","#b3302a",left.noZone,function(it,i){return <tr key={"z"+i}><td>row {it.row}</td><td>{it.desc||"(no description)"}</td><td style={{textAlign:"right"}}>{conFmt(it.qty)}</td></tr>;})}
          {list("qty",left.noQty.length+" "+CON_IMP_ZONE+" row(s) without a Real Qty — not imported","#b35c00",left.noQty,function(it,i){return <tr key={"q"+i}><td>row {it.row}</td><td>{it.desc}</td><td>{it.qty||"(empty)"}</td></tr>;})}
          {list("date",left.noDate.length+" row(s) without a readable date — not imported","#b3302a",left.noDate,function(it,i){return <tr key={"t"+i}><td>row {it.row}</td><td>{it.desc}</td><td style={{textAlign:"right"}}>{conFmt(it.qty)}</td></tr>;})}
          {!fresh.length&&<div style={{fontSize:11.5,color:"#6f6b62",marginTop:4}}>A row is “already imported” when the same supplier, delivery note n° and date were imported before, as many times as that note appears in the file (a copied row keeps them: change the n° or tick it above). Formulas in Real Qty need the file saved by Excel so their value is stored.</div>}
        </div>;
      })()}
      {tKeys.length>0&&<div style={{marginBottom:10}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>Concrete types</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{tKeys.map(function(k){var v=tCho(k);
          return <span key={k} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,background:v==="new"?"#e6f2e9":"#fff",border:"1px solid #e8e6df",borderRadius:6,padding:"3px 6px"}}>
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
