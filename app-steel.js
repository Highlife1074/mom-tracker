// ===========================================================================
// app-steel.js — Steel (rebar + welded mesh) follow-up.
//
//   Delivered  = Σ delivery dockets dated on or before the financial point
//   Stock      = site stock counted at that financial point
//   Consumed   = Delivered − Stock
//   Theoretical= Σ (progress % of each steel WBS line × its theoretical kg)
//   Variance   = Consumed − Theoretical
//
// Loaded after app-reports.js and BEFORE app-mount.js. Same shared scope as the
// other parts: uuid, today, fmtDate, newTask, addWorkingDays come from app-core.js.
// Everything is stored in kg and shown in tonnes.
// ===========================================================================

var STEEL_DIAMETERS=["8","10","12","14","16","18","20","22","25","28","32"];
var STEEL_MESH="Mesh";
var STEEL_UNSPLIT="Not split";
var STEEL_WARN_PCT=5;      // |variance| above this % of the theoretical deserves a look
var STEEL_CERT_DAYS=14;    // a docket still without a mill certificate after this many days is flagged

function newSteelDocket(o){return Object.assign({id:uuid(),no:"",date:today(),supplier:"",bbs:"",zone:"",totalKg:0,lines:[],heat:"",cert:"",testResult:"",link:"",note:"",createdAt:new Date().toISOString(),createdBy:window._currentUser?window._currentUser.name:""},o||{});}
function newSteelLine(o){return Object.assign({id:uuid(),mesh:false,dia:"12",ref:"",sheets:0,kgPerSheet:0,kg:0},o||{});}
function newSteelWbs(o){return Object.assign({id:uuid(),code:"",description:"",zone:"",level:"",mesh:false,theoKg:0,bySplit:false,split:{}},o||{});}
function newSteelPeriod(o){return Object.assign({id:uuid(),date:today(),label:"",stockKg:0,stockBySplit:false,stockSplit:{},progress:{},status:"draft",note:"",enteredBy:window._currentUser?window._currentUser.name:"",validatedBy:"",validatedAt:"",frozen:null},o||{});}

// ---------------------------------------------------------------- calculations
function _stNum(v){var n=Number(v);return isFinite(n)?n:0;}
function _stSum(obj){return Object.keys(obj||{}).reduce(function(s,k){return s+_stNum(obj[k]);},0);}
function steelCatOrder(c){
  if(c===STEEL_MESH)return 900;
  if(c===STEEL_UNSPLIT)return 999;
  var i=STEEL_DIAMETERS.indexOf(String(c).replace("Ø",""));
  return i<0?800:i;
}
function steelCats(){return STEEL_DIAMETERS.map(function(d){return"Ø"+d;}).concat([STEEL_MESH]);}
// A mesh line is normally entered as sheets × kg per sheet; a direct kg value is accepted too.
function steelLineKg(l){
  if(l.mesh&&_stNum(l.sheets)>0&&_stNum(l.kgPerSheet)>0)return _stNum(l.sheets)*_stNum(l.kgPerSheet);
  return _stNum(l.kg);
}
function steelLineCat(l){return l.mesh?STEEL_MESH:"Ø"+l.dia;}
// With lines, the docket total IS the sum of its lines. Without, the typed total counts as "not split".
function steelDocketKg(d){
  var ls=d.lines||[];
  return ls.length?ls.reduce(function(s,l){return s+steelLineKg(l);},0):_stNum(d.totalKg);
}
function steelDocketByCat(d){
  var ls=d.lines||[],out={};
  if(!ls.length){if(_stNum(d.totalKg))out[STEEL_UNSPLIT]=_stNum(d.totalKg);return out;}
  ls.forEach(function(l){var c=steelLineCat(l);out[c]=(out[c]||0)+steelLineKg(l);});
  return out;
}
function steelWbsKg(w){return(!w.mesh&&w.bySplit)?_stSum(w.split):_stNum(w.theoKg);}
function steelWbsByCat(w){
  var out={};
  if(w.mesh){if(_stNum(w.theoKg))out[STEEL_MESH]=_stNum(w.theoKg);return out;}
  if(w.bySplit){Object.keys(w.split||{}).forEach(function(c){if(_stNum(w.split[c]))out[c]=_stNum(w.split[c]);});return out;}
  if(_stNum(w.theoKg))out[STEEL_UNSPLIT]=_stNum(w.theoKg);
  return out;
}
function steelPeriodStock(p){return p.stockBySplit?_stSum(p.stockSplit):_stNum(p.stockKg);}
function steelPct(p,wbsId){return Math.max(0,Math.min(100,_stNum((p.progress||{})[wbsId])));}

// The four totals at the date of a financial point, plus the breakdown by diameter.
// A per-diameter figure is only given when the data behind it is split; otherwise null,
// with the reason in `why`, so the screen never shows a number that means nothing.
function steelFigures(p,dockets,wbs){
  var date=p.date||"";
  var delivered=0,delCat={},nDockets=0;
  (dockets||[]).forEach(function(d){
    if(!d.date||d.date>date)return;
    nDockets++;
    var by=steelDocketByCat(d);
    Object.keys(by).forEach(function(c){delCat[c]=(delCat[c]||0)+by[c];delivered+=by[c];});
  });
  var stock=steelPeriodStock(p);
  var stockCat=p.stockBySplit?Object.assign({},p.stockSplit||{}):null;
  var theo=0,theoCat={};
  (wbs||[]).forEach(function(w){
    var f=steelPct(p,w.id)/100;
    if(!f)return;
    var by=steelWbsByCat(w);
    Object.keys(by).forEach(function(c){var v=by[c]*f;theoCat[c]=(theoCat[c]||0)+v;theo+=v;});
  });
  var consumed=delivered-stock;
  var variance=consumed-theo;
  var delSplit=!delCat[STEEL_UNSPLIT],theoSplit=!theoCat[STEEL_UNSPLIT];
  var keys={};
  [delCat,theoCat,stockCat||{}].forEach(function(o){Object.keys(o).forEach(function(k){if(k!==STEEL_UNSPLIT&&_stNum(o[k]))keys[k]=true;});});
  var rows=Object.keys(keys).sort(function(a,b){return steelCatOrder(a)-steelCatOrder(b);}).map(function(c){
    var dl=delCat[c]||0,st=stockCat?_stNum(stockCat[c]):null,th=theoCat[c]||0;
    var cons=(delSplit&&stockCat)?dl-st:null;
    var vr=(cons!==null&&theoSplit)?cons-th:null;
    return{cat:c,delivered:dl,stock:st,consumed:cons,theo:th,variance:vr,variancePct:(vr!==null&&th>0)?vr/th*100:null};
  });
  var why=[];
  if(!delSplit)why.push(steelFmtT(delCat[STEEL_UNSPLIT])+" t delivered on dockets without a diameter breakdown");
  if(!stockCat)why.push("site stock counted as a total only");
  if(!theoSplit)why.push(steelFmtT(theoCat[STEEL_UNSPLIT])+" t of theoretical on WBS lines without a diameter breakdown");
  return{
    date:date,nDockets:nDockets,delivered:delivered,stock:stock,consumed:consumed,theo:theo,
    variance:variance,variancePct:theo>0?variance/theo*100:null,
    rows:rows,delUnsplit:delCat[STEEL_UNSPLIT]||0,theoUnsplit:theoCat[STEEL_UNSPLIT]||0,
    splitComplete:why.length===0,why:why
  };
}
function steelPrevPeriod(p,periods){
  var best=null;
  (periods||[]).forEach(function(q){
    if(q.id===p.id||!q.date||q.date>=p.date)return;
    if(!best||q.date>best.date)best=q;
  });
  return best;
}
// Dockets typed in after a point was validated, but dated on or before it: they change
// that point's delivered figure. Shown, never silently absorbed.
function steelLateDockets(p,dockets){
  if(p.status!=="validated"||!p.validatedAt)return[];
  return(dockets||[]).filter(function(d){return d.date&&d.date<=p.date&&(d.createdAt||"")>p.validatedAt;});
}
function steelCertMissing(d){
  if(d.cert)return false;
  var due=typeof parseISODate==="function"?parseISODate(d.date):new Date(d.date);
  if(isNaN(due.getTime()))return false;
  due.setDate(due.getDate()+STEEL_CERT_DAYS);
  return toISO(due)<today();
}
function steelFmtT(kg){
  var t=_stNum(kg)/1000;
  return t.toLocaleString("en-GB",{minimumFractionDigits:1,maximumFractionDigits:1});
}
function steelFmtPct(v){return v===null||v===undefined?"—":(v>0?"+":"")+v.toFixed(1)+"%";}
function steelVarColour(pct){
  if(pct===null||pct===undefined)return"#888";
  if(pct<0)return"#c62828";                         // consumed below theoretical: progress overstated, docket missing or stock miscounted
  if(pct>STEEL_WARN_PCT)return"#ef6c00";
  return"#2e7d32";
}

// pt-docket/1 — what Claude returns when asked to read a delivery docket (PDF or photo).
// {format:"pt-docket/1", no, date:"YYYY-MM-DD", supplier, bbs, zone, heat, cert, totalKg,
//  lines:[{dia:"12", kg:1520} | {mesh:true, ref:"T131", sheets:20, kgPerSheet:37.4, kg:748}]}
// One object or an array of them.
function steelParseImport(text,existing){
  var raw;try{raw=JSON.parse(text);}catch(e){return{error:"Not valid JSON: "+e.message};}
  var list=Array.isArray(raw)?raw:[raw];
  var known={};(existing||[]).forEach(function(d){if(d.no)known[(d.supplier||"")+"|"+d.no]=true;});
  var ok=[],skipped=[];
  list.forEach(function(o,i){
    if(!o||typeof o!=="object"){skipped.push("item "+(i+1)+": not an object");return;}
    if(o.format&&o.format!=="pt-docket/1"){skipped.push("item "+(i+1)+": format "+o.format);return;}
    if(!o.date||!/^\d{4}-\d{2}-\d{2}$/.test(o.date)){skipped.push("item "+(i+1)+": missing or invalid date");return;}
    var k=(o.supplier||"")+"|"+(o.no||"");
    if(o.no&&known[k]){skipped.push("docket "+o.no+": already in the register");return;}
    known[k]=true;
    var lines=(o.lines||[]).map(function(l){
      return newSteelLine({mesh:!!l.mesh,dia:l.dia!==undefined&&l.dia!==null?String(l.dia).replace(/[^0-9]/g,""):"12",ref:l.ref||"",sheets:_stNum(l.sheets),kgPerSheet:_stNum(l.kgPerSheet),kg:_stNum(l.kg)});
    });
    ok.push(newSteelDocket({no:String(o.no||""),date:o.date,supplier:o.supplier||"",bbs:o.bbs||"",zone:o.zone||"",heat:o.heat||"",cert:o.cert||"",totalKg:_stNum(o.totalKg),lines:lines,note:o.note||""}));
  });
  return{dockets:ok,skipped:skipped};
}
// Excel copies the number as displayed, so the separators depend on the PC's locale:
// 12,500 / 12.500 / 12 500 / 12.500,5 / 12,500.5 / 3200,5 must all come out right.
function _stParseNum(v){
  var s=String(v===undefined||v===null?"":v).replace(/[\s\u00a0\u202f]/g,"").replace(/kg$/i,"");
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))s=s.replace(/,/g,"");
  else if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s))s=s.replace(/\./g,"").replace(",",".");
  else s=s.replace(",",".");
  return _stNum(s);
}
// WBS pasted from Excel: code · description · zone · level · theoretical kg · mesh (Y/N)
function steelParseWbsPaste(text){
  var out=[];
  (text||"").split(/\r?\n/).forEach(function(line){
    if(!line.trim())return;
    var c=line.split("\t");
    var kg=_stParseNum(c[4]);
    if(!c[0]&&!c[1])return;
    if(!kg&&/kg|theor/i.test(line))return;      // header row
    out.push(newSteelWbs({code:(c[0]||"").trim(),description:(c[1]||"").trim(),zone:(c[2]||"").trim(),level:(c[3]||"").trim(),theoKg:kg,mesh:/^(y|yes|o|oui|1|x|mesh)$/i.test((c[5]||"").trim())}));
  });
  return out;
}

// ---------------------------------------------------------------- shared bits
function _stCan(){return !window._ppReadOnly;}
function SteelBig({label,kg,colour,sub}){
  return <div style={{flex:"1 1 130px",background:"#fff",border:"1.5px solid #e8e6df",borderRadius:10,padding:"10px 14px"}}>
    <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
    <div style={{fontSize:22,fontWeight:800,color:colour||"#14171c",fontVariantNumeric:"tabular-nums"}}>{kg===null?"—":steelFmtT(kg)}<span style={{fontSize:12,fontWeight:600,color:"#888"}}> t</span></div>
    {sub&&<div style={{fontSize:11,color:"#888"}}>{sub}</div>}
  </div>;
}
function SteelKgInput({value,onChange,disabled,width}){
  return <input type="number" step="1" min="0" value={value===0||value?value:""} disabled={disabled}
    onChange={function(e){onChange(e.target.value===""?0:Number(e.target.value));}}
    style={{width:width||90,textAlign:"right",fontVariantNumeric:"tabular-nums"}}/>;
}
// One input per diameter + mesh. Used for the WBS split and for the stock count.
function SteelSplitInputs({split,onChange,disabled}){
  return <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
    {steelCats().map(function(c){
      return <label key={c} style={{display:"flex",flexDirection:"column",fontSize:10,fontWeight:700,color:"#888",gap:2}}>
        {c}
        <SteelKgInput width={70} disabled={disabled} value={(split||{})[c]||0} onChange={function(v){var s=Object.assign({},split||{});if(v)s[c]=v;else delete s[c];onChange(s);}}/>
      </label>;
    })}
  </div>;
}

// ---------------------------------------------------------------- main view
function SteelView({dockets,saveDockets,wbs,saveWbs,periods,savePeriods,zones,tasks,saveTasks,canEdit,isAdmin,currentUser}){
  const [tab,setTab]=useState((periods||[]).length?"analysis":"dockets");
  dockets=dockets||[];wbs=wbs||[];periods=periods||[];
  var edit=canEdit&&_stCan();
  var sortedPeriods=periods.slice().sort(function(a,b){return a.date<b.date?1:-1;});
  var latest=sortedPeriods[0]||null;
  var nCert=dockets.filter(steelCertMissing).length;

  function raiseAction(text,note){
    var t=newTask({text:text,note:note||"",tags:["Warning"],owner:currentUser||"",due:addWorkingDays(today(),5)||""});
    saveTasks([t].concat(tasks||[]));
    return t.id;
  }

  var TABS=[["analysis","📊 Analysis"],["points","🗓 Financial points"],["dockets","🚚 Dockets"+(nCert?" ("+nCert+" ⚠)":"")],["wbs","🧱 WBS"]];
  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">🔩 Steel</div>
        <div className="page-sub">Delivered − site stock = consumed, against the theoretical earned on the steel WBS. Rebar and welded mesh, in tonnes.</div>
      </div>
      {!edit&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Steel editor”"}</span>}
    </div>
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
    </div>
    {tab==="analysis"&&<SteelAnalysis periods={sortedPeriods} dockets={dockets} wbs={wbs} edit={edit} savePeriods={savePeriods} allPeriods={periods} raiseAction={raiseAction} onGoPoints={function(){setTab("points");}}/>}
    {tab==="points"&&<SteelPoints periods={sortedPeriods} allPeriods={periods} savePeriods={savePeriods} dockets={dockets} wbs={wbs} edit={edit} isAdmin={isAdmin}/>}
    {tab==="dockets"&&<SteelDockets dockets={dockets} saveDockets={saveDockets} zones={zones} edit={edit} periods={periods} raiseAction={raiseAction}/>}
    {tab==="wbs"&&<SteelWbs wbs={wbs} saveWbs={saveWbs} zones={zones} edit={edit} latest={latest}/>}
  </div>;
}

// ---------------------------------------------------------------- analysis
function SteelAnalysis({periods,dockets,wbs,edit,savePeriods,allPeriods,raiseAction,onGoPoints}){
  const [pid,setPid]=useState(periods[0]?periods[0].id:"");
  const [byDia,setByDia]=useState(false);
  if(!periods.length)return <div className="empty"><div className="empty-ico">🗓</div><div className="empty-txt">No financial point yet.</div>
    <div style={{marginTop:12}}><button className="btn btn-pri" onClick={onGoPoints}>Go to Financial points</button></div></div>;
  var p=periods.find(function(q){return q.id===pid;})||periods[0];
  var f=steelFigures(p,dockets,wbs);
  var late=steelLateDockets(p,dockets);
  var frozenDrift=p.frozen&&Math.abs(p.frozen.delivered-f.delivered)>0.5;
  var col=steelVarColour(f.variancePct);
  var flagged=f.variancePct!==null&&(f.variancePct<0||f.variancePct>STEEL_WARN_PCT);

  function raise(){
    var id=raiseAction("Steel variance "+steelFmtPct(f.variancePct)+" at financial point "+fmtDate(p.date)+" — investigate",
      "Delivered "+steelFmtT(f.delivered)+" t, stock "+steelFmtT(f.stock)+" t, consumed "+steelFmtT(f.consumed)+" t, theoretical "+steelFmtT(f.theo)+" t.");
    savePeriods(allPeriods.map(function(q){return q.id===p.id?Object.assign({},q,{actionRef:id}):q;}));
  }

  var hist=periods.slice().reverse().map(function(q){return{p:q,f:steelFigures(q,dockets,wbs)};});
  return <div>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
      <select value={p.id} onChange={function(e){setPid(e.target.value);}} style={{minWidth:220}}>
        {periods.map(function(q){return <option key={q.id} value={q.id}>{fmtDate(q.date)}{q.label?" · "+q.label:""}{q.status==="validated"?" ✓":" (draft)"}</option>;})}
      </select>
      <span className="pill" style={{background:p.status==="validated"?"#e8f5e9":"#fff8e1",color:p.status==="validated"?"#2e7d32":"#f57f17"}}>{p.status==="validated"?"✓ validated by "+(p.validatedBy||"").split(",")[0]:"draft"}</span>
      <label style={{display:"flex",gap:5,alignItems:"center",fontSize:12,fontWeight:600,cursor:"pointer"}}>
        <input type="checkbox" checked={byDia} onChange={function(){setByDia(!byDia);}}/> By diameter
      </label>
      <div style={{flex:1}}/>
      <button className="btn btn-sm" onClick={function(){steelOpenReport(p,f,hist);}}>🖨 Report</button>
      {edit&&flagged&&!p.actionRef&&<button className="btn btn-sm" onClick={raise}>⚑ Raise action</button>}
      {p.actionRef&&<span className="pill" style={{background:"#fff3e0",color:"#ef6c00"}}>⚑ action raised</span>}
    </div>

    {late.length>0&&<div className="card" style={{borderColor:"#ffb74d",background:"#fff8e1",fontSize:12}}>
      ⚠ {late.length} docket{late.length>1?"s":""} ({steelFmtT(late.reduce(function(s,d){return s+steelDocketKg(d);},0))} t) entered <b>after</b> this point was validated but dated on or before {fmtDate(p.date)}: {late.map(function(d){return d.no||"(no number)";}).join(", ")}.
    </div>}
    {frozenDrift&&<div className="card" style={{borderColor:"#ffb74d",background:"#fff8e1",fontSize:12}}>
      ⚠ At validation, delivered was {steelFmtT(p.frozen.delivered)} t. With the register as it stands today it is {steelFmtT(f.delivered)} t. The figures below are today's.
    </div>}

    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
      <SteelBig label="Delivered" kg={f.delivered} sub={f.nDockets+" docket"+(f.nDockets===1?"":"s")+" to "+fmtDate(p.date)}/>
      <SteelBig label="Site stock" kg={f.stock} sub="counted"/>
      <SteelBig label="Consumed" kg={f.consumed} sub="delivered − stock" colour={f.consumed<0?"#c62828":null}/>
      <SteelBig label="Theoretical" kg={f.theo} sub="progress × WBS"/>
      <SteelBig label="Variance" kg={f.variance} colour={col} sub={steelFmtPct(f.variancePct)+" of theoretical"}/>
    </div>
    {f.consumed<0&&<div className="card" style={{borderColor:"#ef9a9a",background:"#fff5f5",fontSize:12}}>Stock above delivered: a docket is missing from the register, or the stock count is wrong.</div>}
    {flagged&&f.variancePct<0&&<div style={{fontSize:12,color:"#c62828",marginBottom:10}}>Consumed is <b>below</b> theoretical: progress overstated, a docket missing, or stock overcounted.</div>}
    {flagged&&f.variancePct>STEEL_WARN_PCT&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:10}}>Waste above {STEEL_WARN_PCT}%: off-cuts, losses, or progress under-declared.</div>}

    {byDia&&<div style={{marginBottom:16}}>
      {!f.splitComplete&&<div style={{fontSize:12,color:"#888",marginBottom:6}}>Per-diameter consumption and variance need every figure split. Missing: {f.why.join("; ")}.</div>}
      <table className="tbl">
        <thead><tr><th>Category</th><th style={{textAlign:"right"}}>Delivered t</th><th style={{textAlign:"right"}}>Stock t</th><th style={{textAlign:"right"}}>Consumed t</th><th style={{textAlign:"right"}}>Theoretical t</th><th style={{textAlign:"right"}}>Variance</th></tr></thead>
        <tbody>
          {f.rows.map(function(r){
            return <tr key={r.cat}>
              <td><b>{r.cat}</b></td>
              <td style={{textAlign:"right"}}>{steelFmtT(r.delivered)}</td>
              <td style={{textAlign:"right"}}>{r.stock===null?"—":steelFmtT(r.stock)}</td>
              <td style={{textAlign:"right"}}>{r.consumed===null?"—":steelFmtT(r.consumed)}</td>
              <td style={{textAlign:"right"}}>{steelFmtT(r.theo)}</td>
              <td style={{textAlign:"right",fontWeight:700,color:steelVarColour(r.variancePct)}}>{r.variance===null?"—":steelFmtT(r.variance)+" t · "+steelFmtPct(r.variancePct)}</td>
            </tr>;
          })}
          {(f.delUnsplit>0||f.theoUnsplit>0)&&<tr><td style={{color:"#888"}}>{STEEL_UNSPLIT}</td><td style={{textAlign:"right",color:"#888"}}>{steelFmtT(f.delUnsplit)}</td><td/><td/><td style={{textAlign:"right",color:"#888"}}>{steelFmtT(f.theoUnsplit)}</td><td/></tr>}
        </tbody>
      </table>
    </div>}

    {hist.length>1&&<SteelChart hist={hist}/>}
    <table className="tbl">
      <thead><tr><th>Point</th><th>Status</th><th style={{textAlign:"right"}}>Delivered</th><th style={{textAlign:"right"}}>Stock</th><th style={{textAlign:"right"}}>Consumed</th><th style={{textAlign:"right"}}>Theoretical</th><th style={{textAlign:"right"}}>Variance</th></tr></thead>
      <tbody>{hist.slice().reverse().map(function(h){
        return <tr key={h.p.id} onClick={function(){setPid(h.p.id);}} style={{cursor:"pointer",background:h.p.id===p.id?"#faf6ea":undefined}}>
          <td><b>{fmtDate(h.p.date)}</b>{h.p.label?" · "+h.p.label:""}</td>
          <td>{h.p.status==="validated"?"✓":"draft"}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(h.f.delivered)}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(h.f.stock)}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(h.f.consumed)}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(h.f.theo)}</td>
          <td style={{textAlign:"right",fontWeight:700,color:steelVarColour(h.f.variancePct)}}>{steelFmtT(h.f.variance)} t · {steelFmtPct(h.f.variancePct)}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

// Cumulative delivered / consumed / theoretical across the financial points. Plain SVG.
function SteelChart({hist}){
  var W=720,H=200,L=44,R=10,T=12,B=26;
  var max=Math.max.apply(null,hist.map(function(h){return Math.max(h.f.delivered,h.f.consumed,h.f.theo);}).concat([1]));
  var x=function(i){return L+(hist.length===1?0:i*(W-L-R)/(hist.length-1));};
  var y=function(v){return T+(H-T-B)*(1-v/max);};
  var line=function(key){return hist.map(function(h,i){return x(i)+","+y(Math.max(0,h.f[key]));}).join(" ");};
  var S=[["delivered","#1a73e8","Delivered"],["consumed","#14171c","Consumed"],["theo","#c9a84c","Theoretical"]];
  return <div className="card" style={{overflowX:"auto"}}>
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",minWidth:480,height:"auto"}}>
      {[0,.5,1].map(function(g){return <g key={g}><line x1={L} x2={W-R} y1={y(max*g)} y2={y(max*g)} stroke="#eee"/><text x={L-6} y={y(max*g)+3} fontSize="9" textAnchor="end" fill="#888">{steelFmtT(max*g)}</text></g>;})}
      {S.map(function(s){return <polyline key={s[0]} points={line(s[0])} fill="none" stroke={s[1]} strokeWidth="2" strokeDasharray={s[0]==="theo"?"5 3":undefined}/>;})}
      {hist.map(function(h,i){return <text key={h.p.id} x={x(i)} y={H-8} fontSize="9" textAnchor="middle" fill="#888">{fmtDate(h.p.date)}</text>;})}
    </svg>
    <div style={{display:"flex",gap:14,fontSize:11,color:"#555"}}>{S.map(function(s){return <span key={s[0]}><span style={{display:"inline-block",width:14,height:3,background:s[1],verticalAlign:"middle",marginRight:4}}/>{s[2]} (t)</span>;})}</div>
  </div>;
}

// ---------------------------------------------------------------- financial points
function SteelPoints({periods,allPeriods,savePeriods,dockets,wbs,edit,isAdmin}){
  const [openId,setOpenId]=useState(null);
  var open=allPeriods.find(function(q){return q.id===openId;})||null;
  function create(){
    var prev=periods[0];
    var p=newSteelPeriod({progress:prev?Object.assign({},prev.progress||{}):{},stockBySplit:prev?!!prev.stockBySplit:false});
    savePeriods(allPeriods.concat([p]));
    setOpenId(p.id);
  }
  if(open)return <SteelPointEditor key={open.id} period={open} allPeriods={allPeriods} savePeriods={savePeriods} dockets={dockets} wbs={wbs} edit={edit} isAdmin={isAdmin} onClose={function(){setOpenId(null);}}/>;
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div style={{fontSize:12,color:"#888"}}>A financial point holds the site stock count and the progress of every steel WBS line, at the date you choose.</div>
      {edit&&<button className="btn btn-pri btn-sm" onClick={create} disabled={!wbs.length} title={wbs.length?"":"Create the steel WBS lines first"}>+ New financial point</button>}
    </div>
    {!periods.length?<div className="empty"><div className="empty-ico">🗓</div><div className="empty-txt">{wbs.length?"No financial point yet.":"Start with the 🧱 WBS tab: progress is entered against its lines."}</div></div>:
    <table className="tbl"><thead><tr><th>Date</th><th>Label</th><th>Status</th><th style={{textAlign:"right"}}>Delivered</th><th style={{textAlign:"right"}}>Stock</th><th style={{textAlign:"right"}}>Variance</th><th>Entered by</th></tr></thead>
      <tbody>{periods.map(function(p){
        var f=steelFigures(p,dockets,wbs);
        return <tr key={p.id} onClick={function(){setOpenId(p.id);}} style={{cursor:"pointer"}}>
          <td><b>{fmtDate(p.date)}</b></td><td>{p.label}</td>
          <td>{p.status==="validated"?<span className="pill" style={{background:"#e8f5e9",color:"#2e7d32"}}>✓ validated</span>:<span className="pill" style={{background:"#fff8e1",color:"#f57f17"}}>draft</span>}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(f.delivered)} t</td>
          <td style={{textAlign:"right"}}>{steelFmtT(f.stock)} t</td>
          <td style={{textAlign:"right",fontWeight:700,color:steelVarColour(f.variancePct)}}>{steelFmtPct(f.variancePct)}</td>
          <td>{(p.enteredBy||"").split(",")[0]}</td>
        </tr>;
      })}</tbody></table>}
  </div>;
}

// Works on a local copy: nothing is written until Save, so typing forty percentages does
// not produce forty writes, and Cancel really cancels.
function SteelPointEditor({period,allPeriods,savePeriods,dockets,wbs,edit,isAdmin,onClose}){
  const [d,setD]=useState(period);
  const [dirty,setDirty]=useState(false);
  const [zoneF,setZoneF]=useState("");
  var locked=d.status==="validated";
  var canType=edit&&!locked;
  function set(patch){setD(Object.assign({},d,patch));setDirty(true);}
  function setPct(id,v){var pr=Object.assign({},d.progress||{});if(v===""||v===null)delete pr[id];else pr[id]=Math.max(0,Math.min(100,Number(v)));set({progress:pr});}
  var f=steelFigures(d,dockets,wbs);
  var prev=steelPrevPeriod(d,allPeriods);
  var lastValidated=null;
  allPeriods.forEach(function(q){if(q.id!==d.id&&q.status==="validated"&&(!lastValidated||q.date>lastValidated.date))lastValidated=q;});
  var beforeValidated=lastValidated&&d.date<=lastValidated.date&&!locked;
  var sameDate=allPeriods.some(function(q){return q.id!==d.id&&q.date===d.date;});
  var drops=wbs.filter(function(w){return prev&&steelPct(d,w.id)<steelPct(prev,w.id);});
  var zonesInWbs=[...new Set(wbs.map(function(w){return w.zone;}).filter(Boolean))].sort();
  var shown=wbs.filter(function(w){return !zoneF||w.zone===zoneF;});

  function persist(patch){
    var next=Object.assign({},d,patch||{});
    savePeriods(allPeriods.map(function(q){return q.id===next.id?next:q;}));
    setD(next);setDirty(false);
  }
  function validate(){
    if(!confirm("Validate the financial point of "+fmtDate(d.date)+"?\nIt is then locked; only the admin can reopen it."))return;
    persist({status:"validated",validatedBy:window._currentUser?window._currentUser.name:"",validatedAt:new Date().toISOString(),
      frozen:{delivered:f.delivered,stock:f.stock,consumed:f.consumed,theo:f.theo}});
  }
  function reopen(){if(confirm("Reopen this financial point? It goes back to draft."))persist({status:"draft",validatedBy:"",validatedAt:"",frozen:null});}
  function remove(){
    if(!confirm("Delete the financial point of "+fmtDate(d.date)+"? There is no undo."))return;
    savePeriods(allPeriods.filter(function(q){return q.id!==d.id;}));onClose();
  }
  function close(){if(dirty&&!confirm("Leave without saving?"))return;onClose();}

  return <div>
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
      <button className="btn btn-sm" onClick={close}>← Back</button>
      <div className="card-title" style={{margin:0}}>Financial point</div>
      <div style={{flex:1}}/>
      {canType&&<button className="btn btn-pri btn-sm" disabled={!dirty} onClick={function(){persist();}}>💾 Save</button>}
      {isAdmin&&!locked&&<button className="btn btn-gold btn-sm" disabled={dirty} title={dirty?"Save first":""} onClick={validate}>✓ Validate</button>}
      {isAdmin&&locked&&<button className="btn btn-sm" onClick={reopen}>Reopen</button>}
      {(isAdmin||(edit&&!locked&&window._ppMayDelete))&&<button className="btn btn-danger btn-sm" onClick={remove}>🗑</button>}
    </div>

    <div className="card">
      <div className="frow">
        <div className="fg"><label>Date of the point</label>
          <input type="date" value={d.date} disabled={!canType} onChange={function(e){if(e.target.value)set({date:e.target.value});}}/></div>
        <div className="fg"><label>Label</label>
          <input type="text" value={d.label||""} disabled={!canType} placeholder="e.g. Valuation 07" onChange={function(e){set({label:e.target.value});}}/></div>
      </div>
      <div style={{fontSize:13}}>Delivered up to {fmtDate(d.date)}: <b>{steelFmtT(f.delivered)} t</b> from {f.nDockets} docket{f.nDockets===1?"":"s"} <span style={{color:"#888"}}>— recalculated from the register as you change the date</span></div>
      {beforeValidated&&<div style={{fontSize:12,color:"#ef6c00",marginTop:6}}>⚠ This date is on or before the last validated point ({fmtDate(lastValidated.date)}).</div>}
      {sameDate&&<div style={{fontSize:12,color:"#ef6c00",marginTop:6}}>⚠ Another financial point already has this date.</div>}
    </div>

    <div className="card">
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8,flexWrap:"wrap"}}>
        <div className="card-title" style={{margin:0,fontSize:15}}>Site stock</div>
        <label style={{display:"flex",gap:5,alignItems:"center",fontSize:12,fontWeight:600}}>
          <input type="checkbox" disabled={!canType} checked={!!d.stockBySplit} onChange={function(){set({stockBySplit:!d.stockBySplit});}}/> Counted by diameter
        </label>
      </div>
      {d.stockBySplit
        ?<div><SteelSplitInputs split={d.stockSplit} disabled={!canType} onChange={function(s){set({stockSplit:s});}}/>
          <div style={{fontSize:12,marginTop:6}}>Total: <b>{steelFmtT(steelPeriodStock(d))} t</b></div></div>
        :<div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}><SteelKgInput width={120} disabled={!canType} value={d.stockKg} onChange={function(v){set({stockKg:v});}}/> kg <span style={{color:"#888"}}>= {steelFmtT(d.stockKg)} t</span></div>}
    </div>

    <div className="card">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
        <div className="card-title" style={{margin:0,fontSize:15}}>Progress per WBS line</div>
        <span style={{fontSize:12,color:"#888"}}>{prev?"previous point: "+fmtDate(prev.date):"first point"}</span>
        <div style={{flex:1}}/>
        {zonesInWbs.length>1&&<select value={zoneF} onChange={function(e){setZoneF(e.target.value);}}><option value="">All zones</option>{zonesInWbs.map(function(z){return <option key={z}>{z}</option>;})}</select>}
      </div>
      {drops.length>0&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:6}}>⚠ {drops.length} line{drops.length>1?"s":""} below the previous point: {drops.map(function(w){return w.code||w.description;}).join(", ")}.</div>}
      <div style={{overflowX:"auto"}}><table className="tbl">
        <thead><tr><th>Code</th><th>Description</th><th>Zone</th><th style={{textAlign:"right"}}>Theoretical t</th><th style={{textAlign:"right"}}>Previous</th><th style={{textAlign:"right"}}>Progress %</th><th style={{textAlign:"right"}}>Earned t</th></tr></thead>
        <tbody>{shown.map(function(w){
          var pc=steelPct(d,w.id),pv=prev?steelPct(prev,w.id):0,has=(d.progress||{})[w.id]!==undefined;
          return <tr key={w.id}>
            <td><b>{w.code}</b></td>
            <td>{w.description}{w.mesh&&<span className="pill" style={{marginLeft:6,background:"#eceae3",color:"#555"}}>mesh</span>}</td>
            <td>{w.zone}{w.level?" · "+w.level:""}</td>
            <td style={{textAlign:"right"}}>{steelFmtT(steelWbsKg(w))}</td>
            <td style={{textAlign:"right",color:"#888"}}>{prev?pv+"%":"—"}</td>
            <td style={{textAlign:"right"}}><input type="number" min="0" max="100" step="1" disabled={!canType} value={has?pc:""} placeholder="0"
              onChange={function(e){setPct(w.id,e.target.value);}}
              style={{width:70,textAlign:"right",borderColor:prev&&pc<pv?"#ef6c00":undefined}}/></td>
            <td style={{textAlign:"right"}}>{steelFmtT(steelWbsKg(w)*pc/100)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <div style={{fontSize:13,marginTop:8}}>Theoretical consumed at this point: <b>{steelFmtT(f.theo)} t</b> · Variance <b style={{color:steelVarColour(f.variancePct)}}>{steelFmtT(f.variance)} t ({steelFmtPct(f.variancePct)})</b></div>
    </div>
    <div className="fg"><label>Note</label><textarea rows={2} value={d.note||""} disabled={!canType} onChange={function(e){set({note:e.target.value});}}/></div>
  </div>;
}

// ---------------------------------------------------------------- dockets
function SteelDockets({dockets,saveDockets,zones,edit,periods,raiseAction}){
  const [q,setQ]=useState("");
  const [editing,setEditing]=useState(null);
  const [importOpen,setImportOpen]=useState(false);
  const [onlyIssues,setOnlyIssues]=useState(false);
  var validatedAt={};
  periods.forEach(function(p){if(p.status==="validated")validatedAt[p.id]=p;});
  function afterValidation(d){
    return Object.keys(validatedAt).some(function(k){var p=validatedAt[k];return d.date<=p.date&&(d.createdAt||"")>p.validatedAt;});
  }
  var ql=q.trim().toLowerCase();
  var list=dockets.filter(function(d){
    if(onlyIssues&&!steelCertMissing(d)&&d.testResult!=="fail")return false;
    if(!ql)return true;
    return[d.no,d.supplier,d.bbs,d.zone,d.heat,d.cert].join(" ").toLowerCase().indexOf(ql)>=0;
  }).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  var total=list.reduce(function(s,d){return s+steelDocketKg(d);},0);

  function upsert(doc){
    var exists=dockets.some(function(x){return x.id===doc.id;});
    saveDockets(exists?dockets.map(function(x){return x.id===doc.id?doc:x;}):[doc].concat(dockets));
    setEditing(null);
  }
  function remove(doc){
    if(!confirm("Delete docket "+(doc.no||"")+"? There is no undo."))return;
    saveDockets(dockets.filter(function(x){return x.id!==doc.id;}));setEditing(null);
  }
  function raiseCert(doc){
    var id=raiseAction("Mill certificate missing for steel docket "+(doc.no||"")+" ("+(doc.supplier||"")+", "+fmtDate(doc.date)+")","Heat/cast: "+(doc.heat||"—"));
    saveDockets(dockets.map(function(x){return x.id===doc.id?Object.assign({},x,{actionRef:id}):x;}));
  }

  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search number, supplier, BBS, heat…" value={q} onChange={function(e){setQ(e.target.value);}} style={{minWidth:240}}/>
      <button className={"fchip"+(onlyIssues?" on":"")} onClick={function(){setOnlyIssues(!onlyIssues);}}>⚠ Certificate or test issue</button>
      <span style={{fontSize:12,color:"#888"}}>{list.length} docket{list.length===1?"":"s"} · {steelFmtT(total)} t</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={function(){setImportOpen(true);}}>⤓ Import pt-docket/1</button>}
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newSteelDocket({lines:[newSteelLine()]}));}}>+ New docket</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🚚</div><div className="empty-txt">No docket{q||onlyIssues?" matches":" yet"}.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Date</th><th>Docket</th><th>Supplier</th><th>BBS</th><th>Zone</th><th style={{textAlign:"right"}}>Total t</th><th>Breakdown</th><th>Cert. 3.1</th><th>Test</th><th/></tr></thead>
      <tbody>{list.map(function(d){
        var by=steelDocketByCat(d),missing=steelCertMissing(d);
        return <tr key={d.id} onClick={function(){setEditing(d);}} style={{cursor:"pointer"}}>
          <td>{fmtDate(d.date)}</td>
          <td><b>{d.no||"—"}</b>{afterValidation(d)&&<span className="pill" title="Entered after a financial point covering this date was validated" style={{marginLeft:6,background:"#fff3e0",color:"#ef6c00"}}>late entry</span>}</td>
          <td>{d.supplier}</td><td>{d.bbs}</td><td>{d.zone}</td>
          <td style={{textAlign:"right",fontWeight:700}}>{steelFmtT(steelDocketKg(d))}</td>
          <td style={{fontSize:11,color:"#555"}}>{Object.keys(by).sort(function(a,b){return steelCatOrder(a)-steelCatOrder(b);}).map(function(c){return c+" "+steelFmtT(by[c]);}).join(" · ")}</td>
          <td>{d.cert?<span style={{color:"#2e7d32"}}>✓ {d.cert}</span>:missing?<span style={{color:"#ef6c00",fontWeight:700}}>⚠ missing</span>:<span style={{color:"#888"}}>pending</span>}</td>
          <td>{d.testResult==="pass"?<span style={{color:"#2e7d32"}}>✓ pass</span>:d.testResult==="fail"?<span style={{color:"#c62828",fontWeight:700}}>✗ fail</span>:d.testResult==="sampled"?"sampled":"—"}</td>
          <td onClick={function(e){e.stopPropagation();}}>
            {d.link&&/^https:\/\//.test(d.link)&&<a href={d.link} target="_blank" rel="noopener noreferrer" title="Open the scan">📄</a>}
            {edit&&missing&&!d.actionRef&&<button className="btn btn-sm" style={{marginLeft:4}} onClick={function(){raiseCert(d);}}>⚑</button>}
          </td>
        </tr>;
      })}</tbody>
    </table></div>}
    {editing&&<SteelDocketEditor docket={editing} zones={zones} edit={edit} onSave={upsert} onDelete={dockets.some(function(x){return x.id===editing.id;})&&edit&&(window._ppMayDelete||isAppAdmin(window._currentUser&&window._currentUser.name))?remove:null} onClose={function(){setEditing(null);}}/>}
    {importOpen&&<SteelImportModal dockets={dockets} onImport={function(news){saveDockets(news.concat(dockets));setImportOpen(false);}} onClose={function(){setImportOpen(false);}}/>}
  </div>;
}

function SteelDocketEditor({docket,zones,edit,onSave,onDelete,onClose}){
  const [d,setD]=useState(docket);
  function set(patch){setD(Object.assign({},d,patch));}
  function setLine(id,patch){set({lines:(d.lines||[]).map(function(l){return l.id===id?Object.assign({},l,patch):l;})});}
  var lines=d.lines||[];
  var ro=!edit;
  var badLink=d.link&&!/^https:\/\//.test(d.link);
  return <div className="overlay"><div className="modal" style={{maxWidth:720}}>
    <div className="modal-hdr"><div className="modal-title">🚚 Steel docket</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div className="frow">
        <div className="fg"><label>Docket no.</label><input type="text" disabled={ro} value={d.no} onChange={function(e){set({no:e.target.value});}} autoFocus/></div>
        <div className="fg"><label>Delivery date</label><input type="date" disabled={ro} value={d.date} onChange={function(e){set({date:e.target.value});}}/></div>
        <div className="fg"><label>Supplier</label><input type="text" disabled={ro} value={d.supplier} onChange={function(e){set({supplier:e.target.value});}}/></div>
      </div>
      <div className="frow">
        <div className="fg"><label>BBS ref.</label><input type="text" disabled={ro} value={d.bbs} onChange={function(e){set({bbs:e.target.value});}}/></div>
        <div className="fg"><label>Zone</label><select disabled={ro} value={d.zone} onChange={function(e){set({zone:e.target.value});}}><option value="">—</option>{(zones||[]).map(function(z){return <option key={z}>{z}</option>;})}</select></div>
        <div className="fg"><label>Heat / cast no.</label><input type="text" disabled={ro} value={d.heat} onChange={function(e){set({heat:e.target.value});}}/></div>
      </div>

      <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"6px 0"}}>Content</div>
      {lines.map(function(l){
        return <div key={l.id} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap",padding:"6px 8px",background:l.mesh?"#f7f5ef":"#fafafa",borderRadius:8}}>
          <label style={{display:"flex",gap:4,alignItems:"center",fontSize:12,fontWeight:600,minWidth:118}}>
            <input type="checkbox" disabled={ro} checked={!!l.mesh} onChange={function(){setLine(l.id,{mesh:!l.mesh});}}/> Welded mesh
          </label>
          {l.mesh
            ?<>
              <input type="text" disabled={ro} value={l.ref} placeholder="Ref. (e.g. T131)" onChange={function(e){setLine(l.id,{ref:e.target.value});}} style={{width:110}}/>
              <SteelKgInput disabled={ro} width={70} value={l.sheets} onChange={function(v){setLine(l.id,{sheets:v});}}/><span style={{fontSize:11}}>sheets ×</span>
              <input type="number" step="0.01" disabled={ro} value={l.kgPerSheet||""} onChange={function(e){setLine(l.id,{kgPerSheet:Number(e.target.value)||0});}} style={{width:70,textAlign:"right"}}/><span style={{fontSize:11}}>kg/sheet</span>
              {!(l.sheets>0&&l.kgPerSheet>0)&&<><span style={{fontSize:11,color:"#888"}}>or</span><SteelKgInput disabled={ro} value={l.kg} onChange={function(v){setLine(l.id,{kg:v});}}/><span style={{fontSize:11}}>kg</span></>}
            </>
            :<>
              <span style={{fontSize:12}}>Ø</span>
              <select disabled={ro} value={l.dia} onChange={function(e){setLine(l.id,{dia:e.target.value});}}>{STEEL_DIAMETERS.map(function(x){return <option key={x}>{x}</option>;})}</select>
              <SteelKgInput disabled={ro} value={l.kg} onChange={function(v){setLine(l.id,{kg:v});}}/><span style={{fontSize:11}}>kg</span>
            </>}
          <span style={{marginLeft:"auto",fontSize:12,fontWeight:700}}>{steelFmtT(steelLineKg(l))} t</span>
          {!ro&&<button className="btn btn-sm" onClick={function(){set({lines:lines.filter(function(x){return x.id!==l.id;})});}}>×</button>}
        </div>;
      })}
      {!ro&&<button className="btn btn-sm" onClick={function(){set({lines:lines.concat([newSteelLine()])});}}>+ Line</button>}
      {!lines.length&&<div className="fg" style={{marginTop:8}}><label>Total without breakdown (kg)</label>
        <SteelKgInput disabled={ro} width={140} value={d.totalKg} onChange={function(v){set({totalKg:v});}}/>
        <span style={{fontSize:11,color:"#888"}}>Counts in every total, but not in the per-diameter analysis.</span></div>}
      <div style={{fontSize:14,fontWeight:800,margin:"10px 0"}}>Docket total: {steelFmtT(steelDocketKg(d))} t</div>

      <div className="frow">
        <div className="fg"><label>Mill certificate 3.1 ref.</label><input type="text" disabled={ro} value={d.cert} placeholder="empty = not received" onChange={function(e){set({cert:e.target.value});}}/></div>
        <div className="fg"><label>Lab test</label><select disabled={ro} value={d.testResult||""} onChange={function(e){set({testResult:e.target.value});}}>
          <option value="">not sampled</option><option value="sampled">sampled, result pending</option><option value="pass">pass</option><option value="fail">fail</option></select></div>
      </div>
      <div className="fg"><label>Scan (SharePoint link)</label><input type="text" disabled={ro} value={d.link} placeholder="https://…" onChange={function(e){set({link:e.target.value.trim()});}}/>
        {badLink&&<span style={{fontSize:11,color:"#c62828"}}>The link must start with https://</span>}</div>
      <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note} onChange={function(e){set({note:e.target.value});}}/></div>
    </div>
    <div className="modal-footer">
      {onDelete&&<button className="btn btn-danger" onClick={function(){onDelete(d);}} style={{marginRight:"auto"}}>🗑 Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!d.date||badLink||steelDocketKg(d)<=0} onClick={function(){onSave(d);}}>✓ Save</button>}
    </div>
  </div></div>;
}

function SteelImportModal({dockets,onImport,onClose}){
  const [text,setText]=useState("");
  var res=text.trim()?steelParseImport(text,dockets):null;
  return <div className="overlay"><div className="modal" style={{maxWidth:640}}>
    <div className="modal-hdr"><div className="modal-title">⤓ Import dockets (pt-docket/1)</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div style={{fontSize:12,color:"#555",marginBottom:8}}>Paste the JSON produced from the docket PDF or photo. One docket or an array. A docket already in the register (same supplier and number) is skipped.</div>
      <textarea rows={10} value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",fontFamily:"monospace",fontSize:11}} placeholder='{"format":"pt-docket/1","no":"…","date":"2026-10-05","supplier":"…","lines":[{"dia":"12","kg":1520}]}'/>
      {res&&res.error&&<div style={{color:"#c62828",fontSize:12}}>{res.error}</div>}
      {res&&!res.error&&<div style={{fontSize:12,marginTop:6}}>
        <b>{res.dockets.length}</b> docket{res.dockets.length===1?"":"s"} ready · {steelFmtT(res.dockets.reduce(function(s,d){return s+steelDocketKg(d);},0))} t
        {res.skipped.length>0&&<div style={{color:"#ef6c00",marginTop:4}}>Skipped: {res.skipped.join("; ")}</div>}
      </div>}
    </div>
    <div className="modal-footer">
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!res||!!res.error||!res.dockets.length} onClick={function(){onImport(res.dockets);}}>Import</button>
    </div>
  </div></div>;
}

// ---------------------------------------------------------------- WBS
function SteelWbs({wbs,saveWbs,zones,edit,latest}){
  const [editing,setEditing]=useState(null);
  const [paste,setPaste]=useState(null);
  var total=wbs.reduce(function(s,w){return s+steelWbsKg(w);},0);
  var earned=latest?wbs.reduce(function(s,w){return s+steelWbsKg(w)*steelPct(latest,w.id)/100;},0):0;
  function upsert(w){
    var exists=wbs.some(function(x){return x.id===w.id;});
    saveWbs(exists?wbs.map(function(x){return x.id===w.id?w:x;}):wbs.concat([w]));
    setEditing(null);
  }
  function remove(w){
    if(!confirm("Delete WBS line "+(w.code||w.description)+"? Its progress disappears from every financial point."))return;
    saveWbs(wbs.filter(function(x){return x.id!==w.id;}));setEditing(null);
  }
  var parsed=paste!==null&&paste.trim()?steelParseWbsPaste(paste):[];
  return <div>
    <div className="filter-bar">
      <span style={{fontSize:12,color:"#555"}}>{wbs.length} line{wbs.length===1?"":"s"} · theoretical <b>{steelFmtT(total)} t</b>{latest?" · earned at "+fmtDate(latest.date)+": "+steelFmtT(earned)+" t":""}</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={function(){setPaste("");}}>📋 Paste from Excel</button>}
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newSteelWbs());}}>+ WBS line</button>}
    </div>
    {!wbs.length?<div className="empty"><div className="empty-ico">🧱</div><div className="empty-txt">No steel WBS line yet. Paste them from the BOQ or the BBS summary.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Code</th><th>Description</th><th>Zone</th><th>Level</th><th>Type</th><th style={{textAlign:"right"}}>Theoretical t</th><th style={{textAlign:"right"}}>Progress</th><th style={{textAlign:"right"}}>Earned t</th></tr></thead>
      <tbody>{wbs.map(function(w){
        var pc=latest?steelPct(latest,w.id):0;
        return <tr key={w.id} onClick={function(){setEditing(w);}} style={{cursor:"pointer"}}>
          <td><b>{w.code}</b></td><td>{w.description}</td><td>{w.zone}</td><td>{w.level}</td>
          <td>{w.mesh?"Welded mesh":w.bySplit?"Rebar · by Ø":"Rebar"}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(steelWbsKg(w))}</td>
          <td style={{textAlign:"right"}}>{latest?pc+"%":"—"}</td>
          <td style={{textAlign:"right"}}>{steelFmtT(steelWbsKg(w)*pc/100)}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    {editing&&<SteelWbsEditor line={editing} zones={zones} edit={edit} onSave={upsert} onDelete={wbs.some(function(x){return x.id===editing.id;})&&edit?remove:null} onClose={function(){setEditing(null);}}/>}
    {paste!==null&&<div className="overlay"><div className="modal" style={{maxWidth:640}}>
      <div className="modal-hdr"><div className="modal-title">📋 Paste WBS lines from Excel</div>
        <button onClick={function(){setPaste(null);}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
      <div className="modal-body">
        <div style={{fontSize:12,color:"#555",marginBottom:8}}>Copy six columns from Excel, in this order: <b>code · description · zone · level · theoretical kg · mesh (Y/N)</b>. A header row is ignored. Lines are added after the existing ones.</div>
        <textarea rows={10} value={paste} onChange={function(e){setPaste(e.target.value);}} style={{width:"100%",fontFamily:"monospace",fontSize:11}}/>
        {parsed.length>0&&<div style={{fontSize:12,marginTop:6}}><b>{parsed.length}</b> line{parsed.length===1?"":"s"} · {steelFmtT(parsed.reduce(function(s,w){return s+steelWbsKg(w);},0))} t{parsed.some(function(w){return w.mesh;})?" · "+parsed.filter(function(w){return w.mesh;}).length+" mesh":""}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={function(){setPaste(null);}}>Cancel</button>
        <button className="btn btn-pri" disabled={!parsed.length} onClick={function(){saveWbs(wbs.concat(parsed));setPaste(null);}}>Add {parsed.length||""} line{parsed.length===1?"":"s"}</button>
      </div>
    </div></div>}
  </div>;
}

function SteelWbsEditor({line,zones,edit,onSave,onDelete,onClose}){
  const [w,setW]=useState(line);
  function set(p){setW(Object.assign({},w,p));}
  var ro=!edit;
  return <div className="overlay"><div className="modal" style={{maxWidth:640}}>
    <div className="modal-hdr"><div className="modal-title">🧱 Steel WBS line</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">
      <div className="frow">
        <div className="fg"><label>Code</label><input type="text" disabled={ro} value={w.code} onChange={function(e){set({code:e.target.value});}} autoFocus/></div>
        <div className="fg" style={{flex:2}}><label>Description</label><input type="text" disabled={ro} value={w.description} onChange={function(e){set({description:e.target.value});}}/></div>
      </div>
      <div className="frow">
        <div className="fg"><label>Zone</label><select disabled={ro} value={w.zone} onChange={function(e){set({zone:e.target.value});}}><option value="">—</option>{(zones||[]).map(function(z){return <option key={z}>{z}</option>;})}{w.zone&&(zones||[]).indexOf(w.zone)<0&&<option>{w.zone}</option>}</select></div>
        <div className="fg"><label>Level</label><input type="text" disabled={ro} value={w.level} onChange={function(e){set({level:e.target.value});}}/></div>
      </div>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,fontWeight:600,marginBottom:10}}>
        <input type="checkbox" disabled={ro} checked={!!w.mesh} onChange={function(){set({mesh:!w.mesh});}}/> Welded mesh line
      </label>
      {!w.mesh&&<label style={{display:"flex",gap:6,alignItems:"center",fontSize:13,fontWeight:600,marginBottom:10}}>
        <input type="checkbox" disabled={ro} checked={!!w.bySplit} onChange={function(){set({bySplit:!w.bySplit});}}/> Theoretical split by diameter
      </label>}
      {!w.mesh&&w.bySplit
        ?<div><SteelSplitInputs split={w.split} disabled={ro} onChange={function(s){set({split:s});}}/>
          <div style={{fontSize:12,marginTop:6}}>Theoretical total: <b>{steelFmtT(steelWbsKg(w))} t</b> (sum of the diameters)</div></div>
        :<div className="fg"><label>Theoretical quantity (kg)</label><SteelKgInput disabled={ro} width={140} value={w.theoKg} onChange={function(v){set({theoKg:v});}}/>
          <span style={{fontSize:11,color:"#888"}}>= {steelFmtT(w.theoKg)} t</span></div>}
    </div>
    <div className="modal-footer">
      {onDelete&&<button className="btn btn-danger" onClick={function(){onDelete(w);}} style={{marginRight:"auto"}}>🗑 Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!(w.code||w.description)||steelWbsKg(w)<=0} onClick={function(){onSave(w);}}>✓ Save</button>}
    </div>
  </div></div>;
}

// ---------------------------------------------------------------- report
function steelOpenReport(p,f,hist){
  var E=typeof esc==="function"?esc:function(s){return String(s===undefined||s===null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};
  var td=function(v,b){return'<td style="text-align:right;'+(b?"font-weight:700;":"")+'">'+v+"</td>";};
  var rows=f.rows.map(function(r){
    return"<tr><td>"+E(r.cat)+"</td>"+td(steelFmtT(r.delivered))+td(r.stock===null?"—":steelFmtT(r.stock))+td(r.consumed===null?"—":steelFmtT(r.consumed))+td(steelFmtT(r.theo))+td(r.variance===null?"—":steelFmtT(r.variance)+" · "+steelFmtPct(r.variancePct),true)+"</tr>";
  }).join("");
  var histRows=hist.map(function(h){
    return"<tr><td>"+E(fmtDate(h.p.date))+(h.p.label?" · "+E(h.p.label):"")+"</td><td>"+(h.p.status==="validated"?"validated":"draft")+"</td>"+td(steelFmtT(h.f.delivered))+td(steelFmtT(h.f.stock))+td(steelFmtT(h.f.consumed))+td(steelFmtT(h.f.theo))+td(steelFmtT(h.f.variance)+" · "+steelFmtPct(h.f.variancePct),true)+"</tr>";
  }).join("");
  var html='<style>body{font-family:"IBM Plex Sans",Arial,sans-serif;font-size:12px;color:#14171c;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d5ca;padding:5px 8px}th{background:#f2f0eb;text-align:left;font-size:10px;text-transform:uppercase}.k{display:inline-block;border:1.5px solid #14171c;padding:8px 12px;margin:0 8px 8px 0;min-width:110px}.k b{display:block;font-size:18px}</style>'
    +"<h1>Steel — financial point "+E(fmtDate(p.date))+(p.label?" · "+E(p.label):"")+"</h1>"
    +"<div>Status: "+(p.status==="validated"?"validated by "+E(p.validatedBy):"draft")+" · entered by "+E(p.enteredBy||"")+"</div><br/>"
    +[["Delivered",f.delivered],["Site stock",f.stock],["Consumed",f.consumed],["Theoretical",f.theo],["Variance",f.variance]].map(function(k){return'<span class="k">'+k[0]+"<b>"+steelFmtT(k[1])+" t</b></span>";}).join("")
    +"<div>Variance: <b>"+steelFmtPct(f.variancePct)+"</b> of theoretical · "+f.nDockets+" dockets up to this date</div>"
    +(f.rows.length?"<h2>By diameter</h2>"+(f.splitComplete?"":"<div>Incomplete split: "+E(f.why.join("; "))+".</div>")
      +"<table><tr><th>Category</th><th>Delivered t</th><th>Stock t</th><th>Consumed t</th><th>Theoretical t</th><th>Variance</th></tr>"+rows+"</table>":"")
    +"<h2>History</h2><table><tr><th>Point</th><th>Status</th><th>Delivered t</th><th>Stock t</th><th>Consumed t</th><th>Theoretical t</th><th>Variance</th></tr>"+histRows+"</table>"
    +(p.note?"<h2>Note</h2><div>"+E(p.note)+"</div>":"");
  var title="STEEL - "+(p.date||"")+(p.label?" - "+p.label:"");
  if(typeof openReport==="function")openReport(title,html);
  else{var w=window.open("","_blank");if(w){w.document.write("<title>"+E(title)+"</title>"+html);w.document.close();}}
}
