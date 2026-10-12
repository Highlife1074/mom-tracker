// ===========================================================================
// app-inventory.js — Inventory of critical items (and, later, of every item).
//
// Four registers, one catalogue:
//   Items        the catalogue: code, name, unit, category, critical flag, minimum stock
//   POs          purchase orders: number, supplier, quantity ordered per item
//   Dockets      deliveries: quantity received per item, linked to a PO when there is one
//   Issues       what leaves the store, and WHERE it went (zone + location + use);
//                a "return to store" slip brings material back
//   Counts       the stock counted on site, once a month
//
// Same balance as the steel, per item, between two consecutive counts:
//   opening count + delivered − closing count = REAL consumption
//   real consumption − recorded issues        = not traced (losses, issues never written down)
// Monthly average = Σ real consumption ÷ months covered by the counts.
// Before the first count the stock is taken as zero (every delivery is in the register),
// unless a count is marked "opening stock": the balance then starts from it.
//
// Loaded after app-steel.js and BEFORE app-mount.js. Same shared scope as the other parts:
// uuid, today, toISO, parseISODate, fmtDate, newTask, addWorkingDays, isAppAdmin, esc and
// openReport come from app-core.js / app-reports.js.
// ===========================================================================

var INV_VERSION="2026-10-12-a";
var INV_UNITS=["pcs","m","m²","m³","kg","t","l","bag","roll","box","set","sheet","pallet"];
var INV_DAYS_PER_MONTH=30.4375;
var INV_UNTRACED_WARN_PCT=10;   // untraced above this % of the real consumption deserves a look
console.log("Inventory module",INV_VERSION);

function newInvItem(o){return Object.assign({id:uuid(),code:"",name:"",unit:"pcs",category:"",critical:true,minStock:0,note:"",archived:false},o||{});}
function newInvLine(o){return Object.assign({id:uuid(),itemId:"",qty:0},o||{});}
function _invStamp(){return{createdAt:new Date().toISOString(),createdBy:window._currentUser?window._currentUser.name:""};}
function newInvPo(o){return Object.assign({id:uuid(),no:"",date:today(),supplier:"",lines:[],link:"",note:"",closed:false},_invStamp(),o||{});}
function newInvDocket(o){return Object.assign({id:uuid(),no:"",date:today(),supplier:"",poId:"",lines:[],link:"",note:""},_invStamp(),o||{});}
// kind: "issue" (leaves the store) | "return" (comes back to the store)
function newInvIssue(o){return Object.assign({id:uuid(),ref:"",date:today(),kind:"issue",zone:"",location:"",use:"",issuedTo:"",lines:[],note:""},_invStamp(),o||{});}
// qty: {itemId: counted quantity}. An item left blank was not counted at this date.
function newInvCount(o){return Object.assign({id:uuid(),date:today(),label:"",opening:false,qty:{},note:""},_invStamp(),{enteredBy:window._currentUser?window._currentUser.name:""},o||{});}

// ---------------------------------------------------------------- calculations
function _invNum(v){var n=Number(v);return isFinite(n)?n:0;}
function _invHas(v){return v!==undefined&&v!==null&&v!==""&&isFinite(Number(v));}
function invFmt(v,dec){
  if(v===null||v===undefined||!isFinite(v))return"—";
  var d=dec===undefined?2:dec;
  return Number(v).toLocaleString("en-GB",{minimumFractionDigits:0,maximumFractionDigits:d});
}
function invDays(a,b){
  var da=parseISODate(a),db=parseISODate(b);
  if(!da||!db||isNaN(da.getTime())||isNaN(db.getTime()))return 0;
  return Math.round((db-da)/86400000);
}
function invItemLabel(it){return it?(it.code?it.code+" — ":"")+it.name:"(deleted item)";}
function invSortItems(items){
  return items.slice().sort(function(a,b){
    if(!!a.critical!==!!b.critical)return a.critical?-1:1;
    return((a.category||"")+"|"+(a.code||a.name)).localeCompare((b.category||"")+"|"+(b.code||b.name));
  });
}
// Where an issue went, as one label: "Zone A · L3 – Apt 302".
function invWhere(s){return[s.zone,s.location].filter(Boolean).join(" · ")||"(not stated)";}
function invSign(s){return s.kind==="return"?-1:1;}

// Every movement, indexed by item, so the per-item figures do not rescan every register.
function invIndex(pos,dockets,issues){
  var ix={};
  function at(id){if(!ix[id])ix[id]={po:[],del:[],out:[]};return ix[id];}
  (pos||[]).forEach(function(p){(p.lines||[]).forEach(function(l){if(l.itemId)at(l.itemId).po.push({date:p.date,qty:_invNum(l.qty),doc:p});});});
  (dockets||[]).forEach(function(d){(d.lines||[]).forEach(function(l){if(l.itemId)at(l.itemId).del.push({date:d.date,qty:_invNum(l.qty),doc:d});});});
  (issues||[]).forEach(function(s){(s.lines||[]).forEach(function(l){if(l.itemId)at(l.itemId).out.push({date:s.date,qty:_invNum(l.qty)*invSign(s),doc:s});});});
  return ix;
}
function _invSumBetween(list,from,to){
  // (from, to]  — from "" means since the beginning
  return list.reduce(function(s,m){return(m.date&&(!from||m.date>from)&&m.date<=to)?s+m.qty:s;},0);
}

// All the figures for one item, today. Periods run from one count of the item to the next.
function invItemFigures(item,ix,counts){
  var m=ix[item.id]||{po:[],del:[],out:[]};
  var end=today();
  var cs=(counts||[]).filter(function(c){return c.date&&c.qty&&_invHas(c.qty[item.id]);})
    .slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;});
  // The balance starts at the last count marked "opening stock", or from zero.
  var startIdx=-1;
  cs.forEach(function(c,i){if(c.opening)startIdx=i;});
  // Nothing delivered up to the first count: that count can only be the stock already there.
  if(startIdx<0&&cs.length&&!m.del.some(function(x){return x.date&&x.date<=cs[0].date;}))startIdx=0;
  var start=startIdx>=0?{date:cs[startIdx].date,q:_invNum(cs[startIdx].qty[item.id]),count:cs[startIdx]}:{date:"",q:0,count:null};
  var later=cs.slice(startIdx+1);
  var firstMove=null;
  m.del.concat(m.out).forEach(function(x){if(x.date&&(!start.date||x.date>start.date)&&(!firstMove||x.date<firstMove))firstMove=x.date;});

  var periods=[],prev=start;
  later.forEach(function(c){
    var q=_invNum(c.qty[item.id]);
    var del=_invSumBetween(m.del,prev.date,c.date);
    var iss=_invSumBetween(m.out,prev.date,c.date);
    var from=prev.date||firstMove||c.date;
    var days=Math.max(0,invDays(from,c.date));
    var consumed=prev.q+del-q;
    periods.push({from:prev.date,fromEff:from,to:c.date,count:c,opening:prev.q,delivered:del,issued:iss,closing:q,
      consumed:consumed,untraced:consumed-iss,book:prev.q+del-iss,days:days,
      perMonth:days>0?consumed/days*INV_DAYS_PER_MONTH:null});
    prev={date:c.date,q:q,count:c};
  });
  var consumed=periods.reduce(function(s,p){return s+p.consumed;},0);
  var issuedCounted=periods.reduce(function(s,p){return s+p.issued;},0);
  var days=periods.reduce(function(s,p){return s+p.days;},0);
  var avg=days>0?consumed/days*INV_DAYS_PER_MONTH:null;
  var last=periods.length?periods[periods.length-1]:null;
  // Book stock today: last count (or opening) + what came in since − what went out since.
  var delSince=_invSumBetween(m.del,prev.date,end);
  var issSince=_invSumBetween(m.out,prev.date,end);
  var book=prev.q+delSince-issSince;
  var ordered=m.po.reduce(function(s,x){return s+x.qty;},0);
  var deliveredAll=m.del.reduce(function(s,x){return s+(x.date<=end?x.qty:0);},0);
  var issuedAll=m.out.reduce(function(s,x){return s+(x.date<=end?x.qty:0);},0);
  // Still to come: per PO, what was ordered and not received yet. A closed PO owes nothing.
  var perPo={};
  m.po.forEach(function(x){if(!perPo[x.doc.id])perPo[x.doc.id]={po:x.doc,o:0,r:0};perPo[x.doc.id].o+=x.qty;});
  m.del.forEach(function(x){if(x.doc.poId&&perPo[x.doc.poId])perPo[x.doc.poId].r+=x.qty;});
  var outstanding=Object.keys(perPo).reduce(function(s,k){var e=perPo[k];return s+(e.po.closed?0:Math.max(0,e.o-e.r));},0);
  return{
    item:item,start:start,periods:periods,lastCount:periods.length?last.count:start.count,lastCountQty:prev.q,lastCountDate:prev.date,
    consumed:consumed,issuedCounted:issuedCounted,untraced:consumed-issuedCounted,
    untracedPct:consumed>0?(consumed-issuedCounted)/consumed*100:null,
    days:days,avg:avg,lastPerMonth:last?last.perMonth:null,
    book:book,delSince:delSince,issSince:issSince,
    cover:avg&&avg>0?book/avg:null,
    low:_invNum(item.minStock)>0&&book<_invNum(item.minStock),
    ordered:ordered,deliveredAll:deliveredAll,issuedAll:issuedAll,
    outstanding:outstanding
  };
}

// What each PO line has received: dockets that name the PO, per item.
function invPoStatus(po,dockets){
  var rec={};
  (dockets||[]).forEach(function(d){
    if(d.poId!==po.id)return;
    (d.lines||[]).forEach(function(l){if(l.itemId)rec[l.itemId]=(rec[l.itemId]||0)+_invNum(l.qty);});
  });
  var ordered={};
  (po.lines||[]).forEach(function(l){if(l.itemId)ordered[l.itemId]=(ordered[l.itemId]||0)+_invNum(l.qty);});
  var lines=Object.keys(ordered).map(function(id){return{itemId:id,ordered:ordered[id],received:rec[id]||0,remaining:ordered[id]-(rec[id]||0)};});
  Object.keys(rec).forEach(function(id){if(!(id in ordered))lines.push({itemId:id,ordered:0,received:rec[id],remaining:-rec[id]});});
  var totO=lines.reduce(function(s,l){return s+l.ordered;},0);
  var totR=lines.reduce(function(s,l){return s+Math.min(l.received,l.ordered);},0);
  var over=lines.some(function(l){return l.remaining<0;});
  var state=po.closed?"closed":totR<=0?"open":lines.every(function(l){return l.remaining<=0;})?"delivered":"partial";
  return{lines:lines,pct:totO>0?totR/totO*100:0,over:over,state:state};
}
var INV_PO_STATES={open:{label:"open",bg:"#e8f0fe",fg:"#1a73e8"},partial:{label:"partly delivered",bg:"#fff8e1",fg:"#f57f17"},
  delivered:{label:"delivered",bg:"#e8f5e9",fg:"#2e7d32"},closed:{label:"closed",bg:"#eceae3",fg:"#555"}};

// Issued quantity per item and per place, between two dates (inclusive). Returns are netted.
function invWhereUsed(issues,from,to,groupBy){
  var out={},places={};
  (issues||[]).forEach(function(s){
    if(!s.date||(from&&s.date<from)||(to&&s.date>to))return;
    var place=groupBy==="location"?invWhere(s):groupBy==="use"?(s.use||"(not stated)"):(s.zone||"(no zone)");
    places[place]=true;
    (s.lines||[]).forEach(function(l){
      if(!l.itemId)return;
      if(!out[l.itemId])out[l.itemId]={};
      out[l.itemId][place]=(out[l.itemId][place]||0)+_invNum(l.qty)*invSign(s);
    });
  });
  return{byItem:out,places:Object.keys(places).sort()};
}
function invMonthKey(d){return String(d||"").slice(0,7);}
function invFmtMonth(k){
  var p=String(k).split("-");if(p.length<2)return k;
  return["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(p[1])-1]+" "+p[0].slice(2);
}

// Items pasted from Excel: code · name · unit · category · min stock · critical (Y/N)
function invParseItemsPaste(text,existing){
  var known={};(existing||[]).forEach(function(it){known[(it.code||it.name).trim().toUpperCase()]=true;});
  var out=[],skipped=[];
  (text||"").split(/\r?\n/).forEach(function(line,i){
    if(!line.trim())return;
    var c=line.split("\t").map(function(x){return(x||"").trim();});
    if(!c[0]&&!c[1])return;
    if(i===0&&/^(code|ref|item)/i.test(c[0])&&/name|desc/i.test(c[1]||""))return;   // header row
    var k=(c[0]||c[1]).toUpperCase();
    if(known[k]){skipped.push(c[0]||c[1]);return;}
    known[k]=true;
    out.push(newInvItem({code:c[0],name:c[1]||c[0],unit:c[2]||"pcs",category:c[3]||"",minStock:typeof _stParseNum==="function"?_stParseNum(c[4]):_invNum(c[4]),
      critical:c[5]?/^(y|yes|o|oui|1|x|critical)$/i.test(c[5]):true}));
  });
  return{items:out,skipped:skipped};
}

// ---------------------------------------------------------------- shared bits
function InvBig({label,value,unit,colour,sub}){
  return <div style={{flex:"1 1 130px",background:"#fff",border:"1.5px solid #e8e6df",borderRadius:10,padding:"10px 14px"}}>
    <div style={{fontSize:10,fontWeight:700,color:"#888",textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
    <div style={{fontSize:22,fontWeight:800,color:colour||"#14171c",fontVariantNumeric:"tabular-nums"}}>{value===null||value===undefined?"—":invFmt(value,1)}{unit&&<span style={{fontSize:12,fontWeight:600,color:"#888"}}> {unit}</span>}</div>
    {sub&&<div style={{fontSize:11,color:"#888"}}>{sub}</div>}
  </div>;
}
function InvQtyInput({value,onChange,disabled,width,placeholder}){
  return <input type="number" step="any" value={_invHas(value)?value:""} disabled={disabled} placeholder={placeholder}
    onChange={function(e){onChange(e.target.value===""?"":Number(e.target.value));}}
    style={{width:width||90,textAlign:"right",fontVariantNumeric:"tabular-nums"}}/>;
}
function InvItemSelect({items,value,onChange,disabled}){
  var list=invSortItems((items||[]).filter(function(it){return !it.archived||it.id===value;}));
  return <select disabled={disabled} value={value||""} onChange={function(e){onChange(e.target.value);}} style={{flex:"1 1 220px",minWidth:180}}>
    <option value="">— item —</option>
    {list.map(function(it){return <option key={it.id} value={it.id}>{invItemLabel(it)}{it.critical?" ★":""}</option>;})}
  </select>;
}
// Item lines of a PO, docket or issue slip.
function InvLinesEditor({lines,items,onChange,ro,hint}){
  var byId={};(items||[]).forEach(function(it){byId[it.id]=it;});
  function setLine(id,patch){onChange(lines.map(function(l){return l.id===id?Object.assign({},l,patch):l;}));}
  var dup={};lines.forEach(function(l){if(l.itemId)dup[l.itemId]=(dup[l.itemId]||0)+1;});
  return <div>
    <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",margin:"6px 0"}}>Items</div>
    {lines.map(function(l){
      var it=byId[l.itemId];
      return <div key={l.id} style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap",padding:"6px 8px",background:"#fafafa",borderRadius:8}}>
        <InvItemSelect items={items} value={l.itemId} disabled={ro} onChange={function(v){setLine(l.id,{itemId:v});}}/>
        <InvQtyInput disabled={ro} value={l.qty} onChange={function(v){setLine(l.id,{qty:v});}}/>
        <span style={{fontSize:12,minWidth:34}}>{it?it.unit:""}</span>
        {hint&&<span style={{fontSize:11,color:"#888"}}>{hint(l)}</span>}
        {dup[l.itemId]>1&&<span style={{fontSize:11,color:"#ef6c00"}}>listed twice</span>}
        {!ro&&<button className="btn btn-sm" style={{marginLeft:"auto"}} onClick={function(){onChange(lines.filter(function(x){return x.id!==l.id;}));}}>×</button>}
      </div>;
    })}
    {!ro&&<button className="btn btn-sm" onClick={function(){onChange(lines.concat([newInvLine()]));}}>+ Line</button>}
  </div>;
}
function invLinesValid(lines){
  return(lines||[]).length>0&&lines.every(function(l){return l.itemId&&_invNum(l.qty)>0;});
}
function invCleanLines(lines){return(lines||[]).map(function(l){return{id:l.id,itemId:l.itemId,qty:_invNum(l.qty)};});}
function InvLinkField({value,onChange,ro}){
  var bad=value&&!/^https:\/\//.test(value);
  return <div className="fg"><label>Scan / document (SharePoint link)</label><input type="text" disabled={ro} value={value||""} placeholder="https://…" onChange={function(e){onChange(e.target.value.trim());}}/>
    {bad&&<span style={{fontSize:11,color:"#c62828"}}>The link must start with https://</span>}</div>;
}
function invLinkBad(v){return !!v&&!/^https:\/\//.test(v);}
function invCanDelete(){return !!window._ppMayDelete||isAppAdmin(window._currentUser&&window._currentUser.name);}
// Generic list upsert / delete for the four registers.
function _invUpsert(list,save,doc){
  var exists=list.some(function(x){return x.id===doc.id;});
  save(exists?list.map(function(x){return x.id===doc.id?doc:x;}):[doc].concat(list));
}
function _invRemove(list,save,doc,what){
  if(!confirm("Delete "+what+"? There is no undo."))return false;
  save(list.filter(function(x){return x.id!==doc.id;}));
  return true;
}
function InvModal({title,width,onClose,footer,children}){
  return <div className="overlay"><div className="modal" style={{maxWidth:width||720}}>
    <div className="modal-hdr"><div className="modal-title">{title}</div>
      <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#bbb"}}>×</button></div>
    <div className="modal-body">{children}</div>
    <div className="modal-footer">{footer}</div>
  </div></div>;
}

// ---------------------------------------------------------------- main view
function InventoryView({items,saveItems,pos,savePos,dockets,saveDockets,issues,saveIssues,counts,saveCounts,zones,contractors,tasks,saveTasks,canEdit,currentUser}){
  items=items||[];pos=pos||[];dockets=dockets||[];issues=issues||[];counts=counts||[];
  const [tab,setTab]=useState(items.length?"overview":"items");
  const [itemId,setItemId]=useState(null);
  var edit=canEdit&&!window._ppReadOnly;
  var ix=invIndex(pos,dockets,issues);
  var figs={};items.forEach(function(it){figs[it.id]=invItemFigures(it,ix,counts);});
  var nLow=items.filter(function(it){return !it.archived&&figs[it.id].low;}).length;
  var openItem=itemId?items.find(function(it){return it.id===itemId;}):null;

  function raiseAction(text,note){
    var t=newTask({text:text,note:note||"",tags:["Warning"],owner:currentUser||"",due:addWorkingDays(today(),5)||""});
    saveTasks([t].concat(tasks||[]));
    return t.id;
  }
  var common={items:items,pos:pos,dockets:dockets,issues:issues,counts:counts,figs:figs,ix:ix,edit:edit,onOpenItem:setItemId};
  var TABS=[["overview","📊 Overview"+(nLow?" ("+nLow+" low)":"")],["where","📍 Where used"],["pos","🧾 Purchase orders"],["dockets","🚚 Dockets"],["issues","📤 Issues"],["counts","🗓 Stock counts"],["items","📦 Items"]];
  return <div>
    <div className="page-hdr">
      <div>
        <div className="page-title">🗃️ Inventory</div>
        <div className="page-sub">Ordered → delivered → issued, and counted once a month. Opening count + delivered − closing count = real consumption, against what was issued and where.</div>
      </div>
      {!edit&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>👁 read only{canEdit?"":" — ask the admin for “Inventory editor”"}</span>}
    </div>
    <div className="filter-bar">
      {TABS.map(function(t){return <button key={t[0]} className={"fchip"+(tab===t[0]?" on":"")} onClick={function(){setTab(t[0]);}}>{t[1]}</button>;})}
    </div>
    {tab==="overview"&&<InvOverview {...common} onGoItems={function(){setTab("items");}}/>}
    {tab==="where"&&<InvWhereUsed {...common} zones={zones}/>}
    {tab==="pos"&&<InvPos {...common} savePos={savePos}/>}
    {tab==="dockets"&&<InvDockets {...common} saveDockets={saveDockets}/>}
    {tab==="issues"&&<InvIssues {...common} saveIssues={saveIssues} zones={zones} contractors={contractors}/>}
    {tab==="counts"&&<InvCounts {...common} saveCounts={saveCounts}/>}
    {tab==="items"&&<InvItems {...common} saveItems={saveItems}/>}
    {openItem&&<InvItemDetail item={openItem} f={figs[openItem.id]} ix={ix} issues={issues} pos={pos} edit={edit} raiseAction={raiseAction}
      saveItems={saveItems} items={items} onClose={function(){setItemId(null);}}/>}
  </div>;
}

// ---------------------------------------------------------------- overview
function InvOverview({items,counts,figs,onOpenItem,onGoItems,issues}){
  const [q,setQ]=useState("");
  const [crit,setCrit]=useState(false);
  const [cat,setCat]=useState("");
  const [lowOnly,setLowOnly]=useState(false);
  if(!items.length)return <div className="empty"><div className="empty-ico">📦</div><div className="empty-txt">No item in the catalogue yet.</div>
    <div style={{marginTop:12}}><button className="btn btn-pri" onClick={onGoItems}>Go to Items</button></div></div>;
  var cats=[...new Set(items.map(function(it){return it.category;}).filter(Boolean))].sort();
  var ql=q.trim().toLowerCase();
  var list=invSortItems(items.filter(function(it){
    if(it.archived)return false;
    if(crit&&!it.critical)return false;
    if(cat&&it.category!==cat)return false;
    if(lowOnly&&!figs[it.id].low)return false;
    return !ql||[it.code,it.name,it.category].join(" ").toLowerCase().indexOf(ql)>=0;
  }));
  var lastCount=null;counts.forEach(function(c){if(!lastCount||c.date>lastCount.date)lastCount=c;});
  var R={textAlign:"right"};
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search code, name, category…" value={q} onChange={function(e){setQ(e.target.value);}} style={{minWidth:220}}/>
      <button className={"fchip"+(crit?" on":"")} onClick={function(){setCrit(!crit);}}>★ Critical only</button>
      <button className={"fchip"+(lowOnly?" on":"")} onClick={function(){setLowOnly(!lowOnly);}}>⚠ Below minimum</button>
      {cats.length>0&&<select value={cat} onChange={function(e){setCat(e.target.value);}}><option value="">All categories</option>{cats.map(function(c){return <option key={c}>{c}</option>;})}</select>}
      <span style={{fontSize:12,color:"#888"}}>{list.length} item{list.length===1?"":"s"} · last count {lastCount?fmtDate(lastCount.date):"none yet"}</span>
      <div style={{flex:1}}/>
      <button className="btn btn-sm" onClick={function(){invExportXlsx(list,figs,issues);}}>⤓ Excel</button>
      <button className="btn btn-sm" onClick={function(){invOpenReport(list,figs,issues);}}>🖨 Report</button>
    </div>
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Item</th><th>Unit</th><th style={R}>Ordered</th><th style={R}>Delivered</th><th style={R} title="Ordered on a PO and not delivered yet">Still on PO</th><th style={R}>Issued</th>
        <th style={R}>Last count</th><th style={R} title="Last count + delivered since − issued since">Book stock</th><th style={R} title="Real consumption, from the counts">Consumed</th>
        <th style={R} title="Real consumption − recorded issues">Not traced</th><th style={R}>Avg / month</th><th style={R}>Cover</th></tr></thead>
      <tbody>{list.map(function(it){
        var f=figs[it.id];
        var utCol=f.untracedPct!==null&&Math.abs(f.untracedPct)>INV_UNTRACED_WARN_PCT?(f.untracedPct<0?"#c62828":"#ef6c00"):undefined;
        return <tr key={it.id} onClick={function(){onOpenItem(it.id);}} style={{cursor:"pointer"}}>
          <td>{it.critical&&<span title="Critical item" style={{color:"var(--gold-ink)"}}>★ </span>}<b>{it.code}</b> {it.name}{it.category&&<div style={{fontSize:10,color:"#888"}}>{it.category}</div>}</td>
          <td>{it.unit}</td>
          <td style={R}>{invFmt(f.ordered)}</td>
          <td style={R}>{invFmt(f.deliveredAll)}</td>
          <td style={R}>{f.outstanding?invFmt(f.outstanding):"—"}</td>
          <td style={R}>{invFmt(f.issuedAll)}</td>
          <td style={R}>{f.lastCountDate?<span>{invFmt(f.lastCountQty)}<div style={{fontSize:10,color:"#888"}}>{fmtDate(f.lastCountDate)}</div></span>:"—"}</td>
          <td style={Object.assign({fontWeight:700,color:f.book<0?"#c62828":f.low?"#ef6c00":undefined},R)}>{invFmt(f.book)}{f.low&&<div style={{fontSize:10}}>⚠ min {invFmt(it.minStock)}</div>}</td>
          <td style={R}>{f.periods.length?invFmt(f.consumed):"—"}</td>
          <td style={Object.assign({color:utCol,fontWeight:utCol?700:undefined},R)}>{f.periods.length?invFmt(f.untraced)+(f.untracedPct!==null?" · "+f.untracedPct.toFixed(0)+"%":""):"—"}</td>
          <td style={Object.assign({fontWeight:700},R)}>{f.avg===null?"—":invFmt(f.avg,1)}</td>
          <td style={R}>{f.cover===null?"—":invFmt(f.cover,1)+" mo"}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div style={{fontSize:11,color:"#888",marginTop:8}}>Consumed, not traced and the monthly average need at least one stock count after the start of the register. Click an item for its month-by-month history and where it was used.</div>
  </div>;
}

// ---------------------------------------------------------------- item detail
function InvItemDetail({item,f,ix,issues,pos,edit,raiseAction,saveItems,items,onClose}){
  const [groupBy,setGroupBy]=useState("zone");
  var u=item.unit;
  var m=ix[item.id]||{po:[],del:[],out:[]};
  // Where it went, all time, and month by month.
  var places={},months={},placeNames={};
  m.out.forEach(function(x){
    var s=x.doc,p=groupBy==="location"?invWhere(s):groupBy==="use"?(s.use||"(not stated)"):(s.zone||"(no zone)");
    var mk=invMonthKey(x.date);
    places[p]=(places[p]||0)+x.qty;placeNames[p]=true;
    if(!months[mk])months[mk]={};
    months[mk][p]=(months[mk][p]||0)+x.qty;
  });
  var placeList=Object.keys(placeNames).sort(function(a,b){return places[b]-places[a];});
  var totIssued=placeList.reduce(function(s,p){return s+places[p];},0);
  var monthList=Object.keys(months).sort().reverse();
  var poList=(pos||[]).filter(function(p){return(p.lines||[]).some(function(l){return l.itemId===item.id;});});
  var flagged=f.untracedPct!==null&&Math.abs(f.untracedPct)>INV_UNTRACED_WARN_PCT;
  var R={textAlign:"right"};
  function raise(){
    var id=raiseAction("Inventory: "+invItemLabel(item)+" — "+(f.low?"stock below minimum":"consumption not traced "+f.untracedPct.toFixed(0)+"%")+" — investigate",
      "Book stock "+invFmt(f.book)+" "+u+", minimum "+invFmt(item.minStock)+" "+u+". Real consumption "+invFmt(f.consumed)+" "+u+", issued "+invFmt(f.issuedCounted)+" "+u+", not traced "+invFmt(f.untraced)+" "+u+". Average "+invFmt(f.avg,1)+" "+u+"/month. Still on PO "+invFmt(f.outstanding)+" "+u+".");
    saveItems(items.map(function(it){return it.id===item.id?Object.assign({},it,{actionRef:id}):it;}));
  }
  return <InvModal title={"📦 "+invItemLabel(item)} width={980} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:10,fontSize:12,color:"#555"}}>
      {item.critical&&<span className="pill" style={{background:"var(--gold-soft)",color:"var(--gold-ink)"}}>★ critical</span>}
      {item.category&&<span className="pill" style={{background:"#eceae3",color:"#555"}}>{item.category}</span>}
      <span>unit: <b>{u}</b></span>{_invNum(item.minStock)>0&&<span>· minimum stock <b>{invFmt(item.minStock)}</b></span>}
      <div style={{flex:1}}/>
      {edit&&(f.low||flagged)&&!item.actionRef&&<button className="btn btn-sm" onClick={raise}>⚑ Raise action</button>}
      {item.actionRef&&<span className="pill" style={{background:"#fff3e0",color:"#ef6c00"}}>⚑ action raised</span>}
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
      <InvBig label="Ordered" value={f.ordered} unit={u} sub={f.outstanding?invFmt(f.outstanding)+" still on PO":"nothing outstanding"}/>
      <InvBig label="Delivered" value={f.deliveredAll} unit={u} sub={m.del.length+" docket line"+(m.del.length===1?"":"s")}/>
      <InvBig label="Book stock" value={f.book} unit={u} colour={f.book<0?"#c62828":f.low?"#ef6c00":null} sub={f.lastCountDate?"count "+fmtDate(f.lastCountDate)+" + in − out":"delivered − issued"}/>
      <InvBig label="Real consumption" value={f.periods.length?f.consumed:null} unit={u} sub={f.periods.length?"over "+invFmt(f.days/INV_DAYS_PER_MONTH,1)+" months":"needs a stock count"}/>
      <InvBig label="Average / month" value={f.avg} unit={u} sub={f.cover!==null?"stock covers "+invFmt(f.cover,1)+" months":f.lastPerMonth!==null?"last period "+invFmt(f.lastPerMonth,1):null}/>
      <InvBig label="Not traced" value={f.periods.length?f.untraced:null} unit={u} colour={flagged?(f.untraced<0?"#c62828":"#ef6c00"):null} sub={f.untracedPct!==null?f.untracedPct.toFixed(0)+"% of consumption":"consumed − issued"}/>
    </div>
    {f.untraced<0&&flagged&&<div style={{fontSize:12,color:"#c62828",marginBottom:10}}>More issued than consumed: an issue slip entered twice, a delivery docket missing, or the stock was over-counted.</div>}
    {f.untraced>0&&flagged&&<div style={{fontSize:12,color:"#ef6c00",marginBottom:10}}>Material is leaving without an issue slip: losses, theft, or exits never written down.</div>}

    <div className="card-title" style={{fontSize:15}}>Month by month <span style={{fontSize:12,fontWeight:400,color:"#888"}}>— between two stock counts</span></div>
    {!f.periods.length?<div style={{fontSize:12,color:"#888",marginBottom:12}}>No stock count of this item yet{f.start.count?" after the opening stock of "+fmtDate(f.start.date):""}.</div>:<>
      <InvChart periods={f.periods} unit={u}/>
      <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>Period</th><th style={R}>Opening</th><th style={R}>+ Delivered</th><th style={R}>− Closing count</th><th style={R}>= Consumed</th><th style={R}>Issued</th><th style={R}>Not traced</th><th style={R}>Per month</th></tr></thead>
        <tbody>{f.periods.slice().reverse().map(function(p){
          return <tr key={p.count.id}>
            <td>{p.from?fmtDate(p.from):"start"} → <b>{fmtDate(p.to)}</b> <span style={{fontSize:10,color:"#888"}}>{p.days} d</span></td>
            <td style={R}>{invFmt(p.opening)}</td><td style={R}>{invFmt(p.delivered)}</td><td style={R}>{invFmt(p.closing)}</td>
            <td style={Object.assign({fontWeight:700,color:p.consumed<0?"#c62828":undefined},R)}>{invFmt(p.consumed)}</td>
            <td style={R}>{invFmt(p.issued)}</td>
            <td style={Object.assign({color:p.untraced<0?"#c62828":p.untraced>0?"#ef6c00":undefined},R)}>{invFmt(p.untraced)}</td>
            <td style={R}>{p.perMonth===null?"—":invFmt(p.perMonth,1)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {f.periods.some(function(p){return p.consumed<0;})&&<div style={{fontSize:12,color:"#c62828",marginBottom:10}}>A negative consumption means the count is higher than what can be there: a delivery docket is missing, or the count is wrong.</div>}
    </>}

    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <div className="card-title" style={{fontSize:15}}>Where it was used</div>
      <div style={{flex:1}}/>
      {[["zone","By zone"],["location","By location"],["use","By use"]].map(function(g){return <button key={g[0]} className={"fchip"+(groupBy===g[0]?" on":"")} onClick={function(){setGroupBy(g[0]);}}>{g[1]}</button>;})}
    </div>
    {!placeList.length?<div style={{fontSize:12,color:"#888",marginBottom:12}}>No issue recorded for this item.</div>:<>
      <div style={{marginBottom:10}}>{placeList.map(function(p){
        var pct=totIssued>0?places[p]/totIssued*100:0;
        return <div key={p} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,marginBottom:3}}>
          <span style={{width:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p}>{p}</span>
          <div style={{flex:1,background:"#f2f0eb",borderRadius:4,height:12}}><div style={{width:Math.max(0,Math.min(100,pct))+"%",background:"var(--gold)",height:12,borderRadius:4}}/></div>
          <span style={{width:150,textAlign:"right",fontVariantNumeric:"tabular-nums"}}><b>{invFmt(places[p])}</b> {u} · {pct.toFixed(0)}%</span>
        </div>;
      })}
      {f.periods.length>0&&f.untraced>0&&<div style={{fontSize:11,color:"#888"}}>+ {invFmt(f.untraced)} {u} consumed without an issue slip (not traced).</div>}</div>
      <div style={{overflowX:"auto",marginBottom:14}}><table className="tbl">
        <thead><tr><th>Month</th>{placeList.map(function(p){return <th key={p} style={R}>{p}</th>;})}<th style={R}>Total</th></tr></thead>
        <tbody>{monthList.map(function(mk){
          var row=months[mk],tot=placeList.reduce(function(s,p){return s+(row[p]||0);},0);
          return <tr key={mk}><td><b>{invFmtMonth(mk)}</b></td>{placeList.map(function(p){return <td key={p} style={R}>{row[p]?invFmt(row[p]):""}</td>;})}<td style={Object.assign({fontWeight:700},R)}>{invFmt(tot)}</td></tr>;
        })}</tbody>
      </table></div>
    </>}

    {poList.length>0&&<>
      <div className="card-title" style={{fontSize:15}}>Purchase orders</div>
      <table className="tbl"><thead><tr><th>PO</th><th>Date</th><th>Supplier</th><th style={R}>Ordered</th><th style={R}>Received</th><th style={R}>Remaining</th></tr></thead>
        <tbody>{poList.map(function(p){
          var st=invPoStatus(p,m.del.map(function(x){return x.doc;}).filter(function(d,i,a){return a.indexOf(d)===i;}));
          var l=st.lines.find(function(x){return x.itemId===item.id;})||{ordered:0,received:0,remaining:0};
          return <tr key={p.id}><td><b>{p.no||"—"}</b>{p.closed&&<span className="pill" style={{marginLeft:6,background:"#eceae3",color:"#555"}}>closed</span>}</td><td>{fmtDate(p.date)}</td><td>{p.supplier}</td>
            <td style={R}>{invFmt(l.ordered)}</td><td style={R}>{invFmt(l.received)}</td><td style={Object.assign({fontWeight:700,color:l.remaining<0?"#c62828":undefined},R)}>{invFmt(l.remaining)}</td></tr>;
        })}</tbody></table>
    </>}
  </InvModal>;
}

// Consumption per month and issued per month, one bar pair per counted period. Plain SVG.
function InvChart({periods,unit}){
  var W=720,H=180,L=44,R=10,T=12,B=26;
  var vals=periods.map(function(p){return p.days>0?{c:p.consumed/p.days*INV_DAYS_PER_MONTH,i:p.issued/p.days*INV_DAYS_PER_MONTH}:{c:0,i:0};});
  var max=Math.max.apply(null,vals.map(function(v){return Math.max(v.c,v.i);}).concat([1]));
  var slot=(W-L-R)/periods.length,bw=Math.min(28,slot/3);
  var y=function(v){return T+(H-T-B)*(1-Math.max(0,v)/max);};
  return <div className="card" style={{overflowX:"auto"}}>
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",minWidth:480,height:"auto"}}>
      {[0,.5,1].map(function(g){return <g key={g}><line x1={L} x2={W-R} y1={y(max*g)} y2={y(max*g)} stroke="#eee"/><text x={L-6} y={y(max*g)+3} fontSize="9" textAnchor="end" fill="#888">{invFmt(max*g,0)}</text></g>;})}
      {periods.map(function(p,i){
        var cx=L+slot*i+slot/2;
        return <g key={p.count.id}>
          <rect x={cx-bw-1} y={y(vals[i].c)} width={bw} height={H-B-y(vals[i].c)} fill="#14171c"><title>{"Consumed "+invFmt(vals[i].c,1)+" "+unit+"/month"}</title></rect>
          <rect x={cx+1} y={y(vals[i].i)} width={bw} height={H-B-y(vals[i].i)} fill="#c9a84c"><title>{"Issued "+invFmt(vals[i].i,1)+" "+unit+"/month"}</title></rect>
          <text x={cx} y={H-8} fontSize="9" textAnchor="middle" fill="#888">{fmtDate(p.to)}</text>
        </g>;
      })}
    </svg>
    <div style={{display:"flex",gap:14,fontSize:11,color:"#555"}}>
      <span><span style={{display:"inline-block",width:10,height:10,background:"#14171c",verticalAlign:"middle",marginRight:4}}/>Consumed ({unit}/month)</span>
      <span><span style={{display:"inline-block",width:10,height:10,background:"#c9a84c",verticalAlign:"middle",marginRight:4}}/>Issued ({unit}/month)</span>
    </div>
  </div>;
}

// ---------------------------------------------------------------- where used
function InvWhereUsed({items,issues,figs,onOpenItem}){
  var t=today();
  const [from,setFrom]=useState(t.slice(0,8)+"01");
  const [to,setTo]=useState(t);
  const [groupBy,setGroupBy]=useState("zone");
  const [crit,setCrit]=useState(false);
  var w=invWhereUsed(issues,from,to,groupBy);
  var list=invSortItems(items.filter(function(it){return w.byItem[it.id]&&(!crit||it.critical);}));
  var R={textAlign:"right"};
  function preset(months){
    var d=parseISODate(t);d.setDate(1);d.setMonth(d.getMonth()-months);
    setFrom(toISO(d));
    if(months===1){var e=parseISODate(t);e.setDate(0);setTo(toISO(e));}else setTo(t);
  }
  return <div>
    <div className="filter-bar">
      <label style={{fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:"normal",fontFamily:"inherit",color:"var(--ink)",display:"flex",gap:5,alignItems:"center",margin:0}}>From <input type="date" value={from} onChange={function(e){setFrom(e.target.value);}}/></label>
      <label style={{fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:"normal",fontFamily:"inherit",color:"var(--ink)",display:"flex",gap:5,alignItems:"center",margin:0}}>to <input type="date" value={to} onChange={function(e){setTo(e.target.value);}}/></label>
      <button className="btn btn-sm" onClick={function(){setFrom(t.slice(0,8)+"01");setTo(t);}}>This month</button>
      <button className="btn btn-sm" onClick={function(){preset(1);}}>Last month</button>
      <button className="btn btn-sm" onClick={function(){setFrom("");setTo(t);}}>All</button>
      <div style={{flex:1}}/>
      {[["zone","By zone"],["location","By location"],["use","By use"]].map(function(g){return <button key={g[0]} className={"fchip"+(groupBy===g[0]?" on":"")} onClick={function(){setGroupBy(g[0]);}}>{g[1]}</button>;})}
      <button className={"fchip"+(crit?" on":"")} onClick={function(){setCrit(!crit);}}>★ Critical only</button>
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">📍</div><div className="empty-txt">No issue recorded in this period.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Item</th><th>Unit</th>{w.places.map(function(p){return <th key={p} style={R}>{p}</th>;})}<th style={R}>Total issued</th></tr></thead>
      <tbody>{list.map(function(it){
        var row=w.byItem[it.id],tot=w.places.reduce(function(s,p){return s+(row[p]||0);},0);
        return <tr key={it.id} onClick={function(){onOpenItem(it.id);}} style={{cursor:"pointer"}}>
          <td>{it.critical&&<span style={{color:"var(--gold-ink)"}}>★ </span>}<b>{it.code}</b> {it.name}</td><td>{it.unit}</td>
          {w.places.map(function(p){return <td key={p} style={R}>{row[p]?invFmt(row[p]):""}</td>;})}
          <td style={Object.assign({fontWeight:700},R)}>{invFmt(tot)}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    <div style={{fontSize:11,color:"#888",marginTop:8}}>From the issue slips (returns to store deducted). Material consumed without a slip only shows in the stock counts, as “not traced”.</div>
  </div>;
}

// ---------------------------------------------------------------- purchase orders
function InvPos({items,pos,savePos,dockets,edit}){
  const [q,setQ]=useState("");
  const [editing,setEditing]=useState(null);
  const [stateF,setStateF]=useState("");
  var byId={};items.forEach(function(it){byId[it.id]=it;});
  var ql=q.trim().toLowerCase();
  var list=pos.map(function(p){return{p:p,st:invPoStatus(p,dockets)};}).filter(function(x){
    if(stateF&&x.st.state!==stateF)return false;
    if(!ql)return true;
    return[x.p.no,x.p.supplier,x.p.note].concat((x.p.lines||[]).map(function(l){return invItemLabel(byId[l.itemId]);})).join(" ").toLowerCase().indexOf(ql)>=0;
  }).sort(function(a,b){return a.p.date<b.p.date?1:a.p.date>b.p.date?-1:0;});
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search PO, supplier, item…" value={q} onChange={function(e){setQ(e.target.value);}} style={{minWidth:220}}/>
      <button className={"fchip"+(stateF===""?" on":"")} onClick={function(){setStateF("");}}>All</button>
      {Object.keys(INV_PO_STATES).map(function(k){return <button key={k} className={"fchip"+(stateF===k?" on":"")} onClick={function(){setStateF(stateF===k?"":k);}}>{INV_PO_STATES[k].label}</button>;})}
      <span style={{fontSize:12,color:"#888"}}>{list.length} PO{list.length===1?"":"s"}</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-pri btn-sm" disabled={!items.length} onClick={function(){setEditing(newInvPo({lines:[newInvLine()]}));}}>+ New PO</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🧾</div><div className="empty-txt">No purchase order{q||stateF?" matches":" yet"}.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>PO no.</th><th>Date</th><th>Supplier</th><th>Items ordered</th><th>Delivered</th><th>Status</th><th/></tr></thead>
      <tbody>{list.map(function(x){
        var p=x.p,st=x.st,S=INV_PO_STATES[st.state];
        return <tr key={p.id} onClick={function(){setEditing(p);}} style={{cursor:"pointer"}}>
          <td><b>{p.no||"—"}</b></td><td>{fmtDate(p.date)}</td><td>{p.supplier}</td>
          <td style={{fontSize:11}}>{st.lines.map(function(l){var it=byId[l.itemId];return <div key={l.itemId}>{invItemLabel(it)}: <b>{invFmt(l.received)}</b> / {invFmt(l.ordered)} {it?it.unit:""}{l.remaining<0&&<span style={{color:"#c62828"}}> (over-delivered)</span>}</div>;})}</td>
          <td style={{minWidth:90}}><div style={{background:"#f2f0eb",borderRadius:4,height:8}}><div style={{width:Math.min(100,st.pct)+"%",background:"#2e7d32",height:8,borderRadius:4}}/></div><span style={{fontSize:10,color:"#888"}}>{st.pct.toFixed(0)}%</span></td>
          <td><span className="pill" style={{background:S.bg,color:S.fg}}>{S.label}</span></td>
          <td onClick={function(e){e.stopPropagation();}}>{p.link&&/^https:\/\//.test(p.link)&&<a href={p.link} target="_blank" rel="noopener noreferrer" title="Open the PO">📄</a>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    {editing&&<InvPoEditor po={editing} items={items} dockets={dockets} pos={pos} edit={edit}
      onSave={function(d){_invUpsert(pos,savePos,d);setEditing(null);}}
      onDelete={pos.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){
        var used=dockets.filter(function(k){return k.poId===d.id;}).length;
        if(used&&!confirm(used+" docket"+(used>1?"s":"")+" refer to this PO. They stay, without a PO. Continue?"))return;
        if(_invRemove(pos,savePos,d,"PO "+(d.no||"")))setEditing(null);
      }:null}
      onClose={function(){setEditing(null);}}/>}
  </div>;
}
function InvPoEditor({po,items,dockets,pos,edit,onSave,onDelete,onClose}){
  const [d,setD]=useState(po);
  function set(patch){setD(Object.assign({},d,patch));}
  var ro=!edit;
  var st=invPoStatus(d,dockets);
  var byItem={};st.lines.forEach(function(l){byItem[l.itemId]=l;});
  var dupNo=d.no&&pos.some(function(p){return p.id!==d.id&&String(p.no).trim().toUpperCase()===String(d.no).trim().toUpperCase();});
  var suppliers=[...new Set(pos.map(function(p){return p.supplier;}).filter(Boolean))].sort();
  return <InvModal title="🧾 Purchase order" onClose={onClose} footer={<>
      {onDelete&&<button className="btn btn-danger" onClick={function(){onDelete(d);}} style={{marginRight:"auto"}}>🗑 Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!d.no.trim()||!d.date||!invLinesValid(d.lines)||invLinkBad(d.link)} onClick={function(){onSave(Object.assign({},d,{no:d.no.trim(),lines:invCleanLines(d.lines)}));}}>✓ Save</button>}
    </>}>
    <div className="frow">
      <div className="fg"><label>PO number</label><input type="text" disabled={ro} value={d.no} onChange={function(e){set({no:e.target.value});}} autoFocus/>
        {dupNo&&<span style={{fontSize:11,color:"#ef6c00"}}>Another PO already has this number.</span>}</div>
      <div className="fg"><label>Date</label><input type="date" disabled={ro} value={d.date} onChange={function(e){set({date:e.target.value});}}/></div>
      <div className="fg"><label>Supplier</label><input type="text" list="inv-suppliers" disabled={ro} value={d.supplier} onChange={function(e){set({supplier:e.target.value});}}/>
        <datalist id="inv-suppliers">{suppliers.map(function(s){return <option key={s} value={s}/>;})}</datalist></div>
    </div>
    <InvLinesEditor lines={d.lines||[]} items={items} ro={ro} onChange={function(ls){set({lines:ls});}}
      hint={function(l){var s=byItem[l.itemId];return s&&s.received?"received "+invFmt(s.received):"";}}/>
    <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:"normal",fontFamily:"inherit",color:"var(--ink)",margin:"12px 0"}}>
      <input type="checkbox" disabled={ro} checked={!!d.closed} onChange={function(){set({closed:!d.closed});}}/>
      Closed <span style={{fontWeight:400,color:"#888"}}>— nothing more will be delivered on it (the balance no longer counts as outstanding)</span>
    </label>
    <InvLinkField value={d.link} ro={ro} onChange={function(v){set({link:v});}}/>
    <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note} onChange={function(e){set({note:e.target.value});}}/></div>
  </InvModal>;
}

// ---------------------------------------------------------------- dockets
function InvDockets({items,pos,dockets,saveDockets,edit}){
  const [q,setQ]=useState("");
  const [editing,setEditing]=useState(null);
  var byId={};items.forEach(function(it){byId[it.id]=it;});
  var poById={};pos.forEach(function(p){poById[p.id]=p;});
  var ql=q.trim().toLowerCase();
  var list=dockets.filter(function(d){
    if(!ql)return true;
    var po=poById[d.poId];
    return[d.no,d.supplier,po?po.no:"",d.note].concat((d.lines||[]).map(function(l){return invItemLabel(byId[l.itemId]);})).join(" ").toLowerCase().indexOf(ql)>=0;
  }).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search docket, supplier, PO, item…" value={q} onChange={function(e){setQ(e.target.value);}} style={{minWidth:240}}/>
      <span style={{fontSize:12,color:"#888"}}>{list.length} docket{list.length===1?"":"s"}</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-pri btn-sm" disabled={!items.length} onClick={function(){setEditing(newInvDocket({lines:[newInvLine()]}));}}>+ New docket</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">🚚</div><div className="empty-txt">No docket{q?" matches":" yet"}.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Date</th><th>Docket</th><th>Supplier</th><th>PO</th><th>Items delivered</th><th/></tr></thead>
      <tbody>{list.map(function(d){
        var po=poById[d.poId];
        return <tr key={d.id} onClick={function(){setEditing(d);}} style={{cursor:"pointer"}}>
          <td>{fmtDate(d.date)}</td><td><b>{d.no||"—"}</b></td><td>{d.supplier}</td>
          <td>{po?po.no:d.poId?<span style={{color:"#c62828"}}>deleted PO</span>:<span style={{color:"#888"}}>no PO</span>}</td>
          <td style={{fontSize:11}}>{(d.lines||[]).map(function(l){var it=byId[l.itemId];return <div key={l.id}>{invItemLabel(it)}: <b>{invFmt(l.qty)}</b> {it?it.unit:""}</div>;})}</td>
          <td onClick={function(e){e.stopPropagation();}}>{d.link&&/^https:\/\//.test(d.link)&&<a href={d.link} target="_blank" rel="noopener noreferrer" title="Open the scan">📄</a>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    {editing&&<InvDocketEditor docket={editing} items={items} pos={pos} dockets={dockets} edit={edit}
      onSave={function(d){_invUpsert(dockets,saveDockets,d);setEditing(null);}}
      onDelete={dockets.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){if(_invRemove(dockets,saveDockets,d,"docket "+(d.no||"")))setEditing(null);}:null}
      onClose={function(){setEditing(null);}}/>}
  </div>;
}
function InvDocketEditor({docket,items,pos,dockets,edit,onSave,onDelete,onClose}){
  const [d,setD]=useState(docket);
  function set(patch){setD(Object.assign({},d,patch));}
  var ro=!edit;
  var po=pos.find(function(p){return p.id===d.poId;})||null;
  // Remaining on the PO, without counting this docket's own previous version.
  var others=dockets.filter(function(k){return k.id!==d.id;});
  var st=po?invPoStatus(po,others):null;
  var rem={};if(st)st.lines.forEach(function(l){rem[l.itemId]=l.remaining;});
  var openPos=pos.filter(function(p){return !p.closed||p.id===d.poId;}).sort(function(a,b){return a.date<b.date?1:-1;});
  var dupNo=d.no&&dockets.some(function(k){return k.id!==d.id&&String(k.no).trim().toUpperCase()===String(d.no).trim().toUpperCase()&&(k.supplier||"").trim().toUpperCase()===(d.supplier||"").trim().toUpperCase();});
  function pickPo(id){
    var p=pos.find(function(x){return x.id===id;});
    var patch={poId:id};
    if(p&&!d.supplier)patch.supplier=p.supplier;
    set(patch);
  }
  function fillRemaining(){
    var ls=st.lines.filter(function(l){return l.remaining>0;}).map(function(l){return newInvLine({itemId:l.itemId,qty:l.remaining});});
    set({lines:ls,supplier:d.supplier||po.supplier});
  }
  return <InvModal title="🚚 Delivery docket" onClose={onClose} footer={<>
      {onDelete&&<button className="btn btn-danger" onClick={function(){onDelete(d);}} style={{marginRight:"auto"}}>🗑 Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!d.date||!invLinesValid(d.lines)||invLinkBad(d.link)} onClick={function(){onSave(Object.assign({},d,{no:(d.no||"").trim(),lines:invCleanLines(d.lines)}));}}>✓ Save</button>}
    </>}>
    <div className="frow">
      <div className="fg"><label>Docket no.</label><input type="text" disabled={ro} value={d.no} onChange={function(e){set({no:e.target.value});}} autoFocus/>
        {dupNo&&<span style={{fontSize:11,color:"#ef6c00"}}>This supplier already has a docket with this number.</span>}</div>
      <div className="fg"><label>Delivery date</label><input type="date" disabled={ro} value={d.date} onChange={function(e){set({date:e.target.value});}}/></div>
      <div className="fg"><label>Supplier</label><input type="text" disabled={ro} value={d.supplier} onChange={function(e){set({supplier:e.target.value});}}/></div>
    </div>
    <div style={{background:"#f7f5ef",borderRadius:8,padding:"10px 12px",marginBottom:12}}>
      <div className="fg" style={{marginBottom:po?8:0}}><label>Purchase order</label>
        <select disabled={ro} value={d.poId||""} onChange={function(e){pickPo(e.target.value);}}>
          <option value="">— no PO —</option>
          {openPos.map(function(p){return <option key={p.id} value={p.id}>{p.no} · {p.supplier} · {fmtDate(p.date)}</option>;})}
        </select></div>
      {po&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12}}>
        <span>Still to deliver on {po.no}: {st.lines.filter(function(l){return l.remaining>0;}).map(function(l){var it=items.find(function(x){return x.id===l.itemId;});return invItemLabel(it)+" "+invFmt(l.remaining)+(it?" "+it.unit:"");}).join(" · ")||"nothing"}</span>
        {!ro&&st.lines.some(function(l){return l.remaining>0;})&&<button className="btn btn-sm" onClick={fillRemaining}>Fill with the remaining quantities</button>}
      </div>}
    </div>
    <InvLinesEditor lines={d.lines||[]} items={items} ro={ro} onChange={function(ls){set({lines:ls});}}
      hint={function(l){
        if(!po||!l.itemId)return"";
        if(!(l.itemId in rem))return"not on this PO";
        var after=rem[l.itemId]-_invNum(l.qty);
        return after<0?"⚠ "+invFmt(-after)+" over the PO":"PO balance after: "+invFmt(after);
      }}/>
    <div style={{marginTop:12}}><InvLinkField value={d.link} ro={ro} onChange={function(v){set({link:v});}}/></div>
    <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note} onChange={function(e){set({note:e.target.value});}}/></div>
  </InvModal>;
}

// ---------------------------------------------------------------- issues
function InvIssues({items,issues,saveIssues,figs,zones,contractors,edit}){
  const [q,setQ]=useState("");
  const [zoneF,setZoneF]=useState("");
  const [editing,setEditing]=useState(null);
  var byId={};items.forEach(function(it){byId[it.id]=it;});
  var ql=q.trim().toLowerCase();
  var usedZones=[...new Set(issues.map(function(s){return s.zone;}).filter(Boolean))].sort();
  var list=issues.filter(function(s){
    if(zoneF&&s.zone!==zoneF)return false;
    if(!ql)return true;
    return[s.ref,s.zone,s.location,s.use,s.issuedTo,s.note].concat((s.lines||[]).map(function(l){return invItemLabel(byId[l.itemId]);})).join(" ").toLowerCase().indexOf(ql)>=0;
  }).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:(a.createdAt||"")<(b.createdAt||"")?1:-1;});
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search slip, location, use, issued to, item…" value={q} onChange={function(e){setQ(e.target.value);}} style={{minWidth:260}}/>
      {usedZones.length>0&&<select value={zoneF} onChange={function(e){setZoneF(e.target.value);}}><option value="">All zones</option>{usedZones.map(function(z){return <option key={z}>{z}</option>;})}</select>}
      <span style={{fontSize:12,color:"#888"}}>{list.length} slip{list.length===1?"":"s"}</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" disabled={!items.length} onClick={function(){setEditing(newInvIssue({kind:"return",lines:[newInvLine()]}));}}>↩ Return to store</button>}
      {edit&&<button className="btn btn-pri btn-sm" disabled={!items.length} onClick={function(){setEditing(newInvIssue({lines:[newInvLine()]}));}}>+ New issue</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">📤</div><div className="empty-txt">No issue{q||zoneF?" matches":" recorded yet"}.</div></div>:
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Date</th><th>Slip</th><th>Zone</th><th>Location</th><th>Use</th><th>Issued to</th><th>Items</th></tr></thead>
      <tbody>{list.map(function(s){
        var ret=s.kind==="return";
        return <tr key={s.id} onClick={function(){setEditing(s);}} style={{cursor:"pointer",background:ret?"#f3f8f3":undefined}}>
          <td>{fmtDate(s.date)}</td>
          <td><b>{s.ref||"—"}</b>{ret&&<span className="pill" style={{marginLeft:6,background:"#e8f5e9",color:"#2e7d32"}}>↩ return</span>}</td>
          <td>{s.zone}</td><td>{s.location}</td><td style={{fontSize:11}}>{s.use}</td><td style={{fontSize:11}}>{s.issuedTo}</td>
          <td style={{fontSize:11}}>{(s.lines||[]).map(function(l){var it=byId[l.itemId];return <div key={l.id}>{invItemLabel(it)}: <b>{ret?"+":"−"}{invFmt(l.qty)}</b> {it?it.unit:""}</div>;})}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    {editing&&<InvIssueEditor issue={editing} items={items} issues={issues} figs={figs} zones={zones} contractors={contractors} edit={edit}
      onSave={function(d){_invUpsert(issues,saveIssues,d);setEditing(null);}}
      onSaveNext={function(d){_invUpsert(issues,saveIssues,d);setEditing(newInvIssue({kind:d.kind,date:d.date,zone:d.zone,issuedTo:d.issuedTo,lines:[newInvLine()]}));}}
      onDelete={issues.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){if(_invRemove(issues,saveIssues,d,"this slip"))setEditing(null);}:null}
      onClose={function(){setEditing(null);}}/>}
  </div>;
}
function InvIssueEditor({issue,items,issues,figs,zones,contractors,edit,onSave,onSaveNext,onDelete,onClose}){
  const [d,setD]=useState(issue);
  function set(patch){setD(Object.assign({},d,patch));}
  var ro=!edit;
  var ret=d.kind==="return";
  var isNew=!issues.some(function(x){return x.id===d.id;});
  var locations=[...new Set(issues.filter(function(s){return !d.zone||s.zone===d.zone;}).map(function(s){return s.location;}).filter(Boolean))].sort();
  var uses=[...new Set(issues.map(function(s){return s.use;}).filter(Boolean))].sort();
  var takers=[...new Set(issues.map(function(s){return s.issuedTo;}).concat((contractors||[]).map(function(c){return c.name;})).filter(Boolean))].sort();
  var valid=d.date&&invLinesValid(d.lines)&&(ret||d.zone||d.location.trim());
  function clean(){return Object.assign({},d,{ref:(d.ref||"").trim(),location:(d.location||"").trim(),use:(d.use||"").trim(),issuedTo:(d.issuedTo||"").trim(),lines:invCleanLines(d.lines)});}
  return <InvModal title={ret?"↩ Return to store":"📤 Issue from store"} onClose={onClose} footer={<>
      {onDelete&&<button className="btn btn-danger" onClick={function(){onDelete(d);}} style={{marginRight:"auto"}}>🗑 Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&isNew&&<button className="btn" disabled={!valid} onClick={function(){onSaveNext(clean());}} title="Save, and start another slip with the same date, zone and receiver">✓ Save &amp; next</button>}
      {!ro&&<button className="btn btn-pri" disabled={!valid} onClick={function(){onSave(clean());}}>✓ Save</button>}
    </>}>
    <div className="frow">
      <div className="fg"><label>Slip no.</label><input type="text" disabled={ro} value={d.ref} placeholder="optional" onChange={function(e){set({ref:e.target.value});}}/></div>
      <div className="fg"><label>Date</label><input type="date" disabled={ro} value={d.date} onChange={function(e){set({date:e.target.value});}}/></div>
      <div className="fg"><label>Type</label><select disabled={ro} value={d.kind} onChange={function(e){set({kind:e.target.value});}}>
        <option value="issue">Issue — leaves the store</option><option value="return">Return — comes back to the store</option></select></div>
    </div>
    <div style={{background:"#f7f5ef",borderRadius:8,padding:"10px 12px",marginBottom:12}}>
      <div style={{fontSize:11,fontWeight:700,color:"#888",textTransform:"uppercase",marginBottom:6}}>{ret?"Coming back from":"Where it is used"}</div>
      <div className="frow">
        <div className="fg"><label>Zone</label><select disabled={ro} value={d.zone} onChange={function(e){set({zone:e.target.value});}}><option value="">—</option>{(zones||[]).map(function(z){return <option key={z}>{z}</option>;})}</select></div>
        <div className="fg"><label>Location (level, room, element)</label><input type="text" list="inv-locations" disabled={ro} value={d.location} placeholder="e.g. L12 – Apt 1203" onChange={function(e){set({location:e.target.value});}}/>
          <datalist id="inv-locations">{locations.map(function(s){return <option key={s} value={s}/>;})}</datalist></div>
      </div>
      <div className="frow">
        <div className="fg" style={{marginBottom:0}}><label>Use / activity</label><input type="text" list="inv-uses" disabled={ro} value={d.use} placeholder="e.g. waterproofing, slab pour" onChange={function(e){set({use:e.target.value});}}/>
          <datalist id="inv-uses">{uses.map(function(s){return <option key={s} value={s}/>;})}</datalist></div>
        <div className="fg" style={{marginBottom:0}}><label>{ret?"Returned by":"Issued to"}</label><input type="text" list="inv-takers" disabled={ro} value={d.issuedTo} placeholder="subcontractor or person" onChange={function(e){set({issuedTo:e.target.value});}}/>
          <datalist id="inv-takers">{takers.map(function(s){return <option key={s} value={s}/>;})}</datalist></div>
      </div>
      {!ret&&!d.zone&&!d.location.trim()&&<div style={{fontSize:11,color:"#c62828",marginTop:6}}>Say where the material goes: zone or location.</div>}
    </div>
    <InvLinesEditor lines={d.lines||[]} items={items} ro={ro} onChange={function(ls){set({lines:ls});}}
      hint={function(l){
        var f=figs[l.itemId];if(!f)return"";
        var own=0;
        if(!isNew){var old=issues.find(function(x){return x.id===d.id;});(old.lines||[]).forEach(function(o){if(o.itemId===l.itemId)own+=_invNum(o.qty)*invSign(old);});}
        var stock=f.book+own;
        if(ret)return"book stock "+invFmt(stock);
        var after=stock-_invNum(l.qty);
        return after<0?"⚠ book stock only "+invFmt(stock):"book stock after: "+invFmt(after);
      }}/>
    <div className="fg" style={{marginTop:12}}><label>Note</label><textarea rows={2} disabled={ro} value={d.note} onChange={function(e){set({note:e.target.value});}}/></div>
  </InvModal>;
}

// ---------------------------------------------------------------- stock counts
function InvCounts({items,counts,saveCounts,ix,edit}){
  const [openId,setOpenId]=useState(null);
  const [draft,setDraft]=useState(null);
  var sorted=counts.slice().sort(function(a,b){return a.date<b.date?1:-1;});
  var open=draft||counts.find(function(c){return c.id===openId;})||null;
  if(open)return <InvCountEditor key={open.id} count={open} isNew={!!draft} items={items} counts={counts} saveCounts={saveCounts} ix={ix} edit={edit}
    onClose={function(){setOpenId(null);setDraft(null);}}/>;
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10,flexWrap:"wrap"}}>
      <div style={{fontSize:12,color:"#888"}}>Count the stock once a month, at month end. Each count closes a period: opening + delivered − count = real consumption.</div>
      {edit&&<button className="btn btn-pri btn-sm" disabled={!items.length} onClick={function(){setDraft(newInvCount());}}>+ New stock count</button>}
    </div>
    {!sorted.length?<div className="empty"><div className="empty-ico">🗓</div><div className="empty-txt">No stock count yet.</div></div>:
    <table className="tbl"><thead><tr><th>Date</th><th>Label</th><th>Type</th><th style={{textAlign:"right"}}>Items counted</th><th>Entered by</th></tr></thead>
      <tbody>{sorted.map(function(c){
        var n=Object.keys(c.qty||{}).filter(function(k){return _invHas(c.qty[k]);}).length;
        return <tr key={c.id} onClick={function(){setOpenId(c.id);}} style={{cursor:"pointer"}}>
          <td><b>{fmtDate(c.date)}</b></td><td>{c.label}</td>
          <td>{c.opening?<span className="pill" style={{background:"#e8f0fe",color:"#1a73e8"}}>opening stock</span>:<span className="pill" style={{background:"#eceae3",color:"#555"}}>monthly count</span>}</td>
          <td style={{textAlign:"right"}}>{n} / {items.filter(function(it){return !it.archived;}).length}</td>
          <td>{(c.enteredBy||"").split(",")[0]}</td>
        </tr>;
      })}</tbody></table>}
  </div>;
}
// Works on a local copy: nothing is written until Save, so typing forty quantities does not
// produce forty writes, and Cancel really cancels.
function InvCountEditor({count,isNew,items,counts,saveCounts,ix,edit,onClose}){
  const [d,setD]=useState(count);
  const [dirty,setDirty]=useState(!!isNew);
  const [crit,setCrit]=useState(false);
  var ro=!edit;
  function set(patch){setD(Object.assign({},d,patch));setDirty(true);}
  function setQty(id,v){var q=Object.assign({},d.qty||{});if(v===""||v===null)delete q[id];else q[id]=v;set({qty:q});}
  var sameDate=counts.some(function(c){return c.id!==d.id&&c.date===d.date;});
  var shown=invSortItems(items.filter(function(it){return(!it.archived||_invHas((d.qty||{})[it.id]))&&(!crit||it.critical);}));
  function save(){
    var next=Object.assign({},d,{label:(d.label||"").trim()});
    _invUpsert(counts,saveCounts,next);
    setDirty(false);onClose();
  }
  function remove(){
    if(!confirm("Delete the stock count of "+fmtDate(d.date)+"? There is no undo."))return;
    saveCounts(counts.filter(function(c){return c.id!==d.id;}));onClose();
  }
  function close(){if(dirty&&!ro&&!confirm("Leave without saving?"))return;onClose();}
  var R={textAlign:"right"};
  return <div>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
      <button className="btn btn-sm" onClick={close}>← Counts</button>
      <div className="card-title" style={{margin:0}}>Stock count</div>
      <div style={{flex:1}}/>
      {!ro&&!isNew&&invCanDelete()&&<button className="btn btn-danger btn-sm" onClick={remove}>🗑 Delete</button>}
      {!ro&&<button className="btn btn-pri btn-sm" disabled={!d.date||!dirty} onClick={save}>✓ Save</button>}
    </div>
    <div className="frow">
      <div className="fg"><label>Count date</label><input type="date" disabled={ro} value={d.date} onChange={function(e){set({date:e.target.value});}}/>
        {sameDate&&<span style={{fontSize:11,color:"#ef6c00"}}>Another count has the same date.</span>}</div>
      <div className="fg"><label>Label</label><input type="text" disabled={ro} value={d.label} placeholder="e.g. October 2026" onChange={function(e){set({label:e.target.value});}}/></div>
      <div className="fg"><label>Counted by</label><input type="text" disabled={ro} value={d.enteredBy||""} onChange={function(e){set({enteredBy:e.target.value});}}/></div>
    </div>
    <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:"normal",fontFamily:"inherit",color:"var(--ink)",marginBottom:12}}>
      <input type="checkbox" disabled={ro} checked={!!d.opening} onChange={function(){set({opening:!d.opening});}}/>
      Opening stock <span style={{fontWeight:400,color:"#888"}}>— the register starts here for the items counted: earlier deliveries and issues are ignored. Leave unticked for a normal monthly count.</span>
    </label>
    <div className="filter-bar">
      <button className={"fchip"+(crit?" on":"")} onClick={function(){setCrit(!crit);}}>★ Critical only</button>
      {!ro&&<button className="btn btn-sm" onClick={function(){
        var q=Object.assign({},d.qty||{});
        shown.forEach(function(it){if(!_invHas(q[it.id]))q[it.id]=Math.max(0,Math.round(invBookAt(it,ix,d.date,counts,d.id)*100)/100);});
        set({qty:q});
      }} title="Puts the book stock in every empty line, so only the differences need typing">Pre-fill empty lines with the book stock</button>}
      <span style={{fontSize:12,color:"#888"}}>Leave a line empty when the item was not counted.</span>
    </div>
    <div style={{overflowX:"auto"}}><table className="tbl">
      <thead><tr><th>Item</th><th>Unit</th><th style={R} title="Previous count + delivered − issued, up to this date">Book stock</th><th style={R}>Counted</th><th style={R}>Difference</th></tr></thead>
      <tbody>{shown.map(function(it){
        var book=invBookAt(it,ix,d.date,counts,d.id);
        var v=(d.qty||{})[it.id],has=_invHas(v),diff=has?_invNum(v)-book:null;
        return <tr key={it.id}>
          <td>{it.critical&&<span style={{color:"var(--gold-ink)"}}>★ </span>}<b>{it.code}</b> {it.name}</td><td>{it.unit}</td>
          <td style={Object.assign({color:"#888"},R)}>{invFmt(book)}</td>
          <td style={R}><InvQtyInput disabled={ro} value={v} onChange={function(x){setQty(it.id,x);}}/></td>
          <td style={Object.assign({fontWeight:700,color:diff===null||Math.abs(diff)<1e-9?"#888":diff<0?"#ef6c00":"#c62828"},R)}>{diff===null?"":(diff>0?"+":"")+invFmt(diff)}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <div style={{fontSize:11,color:"#888",marginTop:8}}>Difference below zero: material left without an issue slip (not traced). Above zero: a delivery missing from the register, or an issue slip entered twice.</div>
    <div className="fg" style={{marginTop:12}}><label>Note</label><textarea rows={2} disabled={ro} value={d.note} onChange={function(e){set({note:e.target.value});}}/></div>
  </div>;
}
// Book stock of an item at a date, from the counts before that date (excluding one count).
function invBookAt(item,ix,date,counts,excludeId){
  var others=(counts||[]).filter(function(c){return c.id!==excludeId&&c.date&&c.date<date;});
  var g=invItemFigures(item,ix,others);
  var m=ix[item.id]||{del:[],out:[]};
  return g.lastCountQty+_invSumBetween(m.del,g.lastCountDate,date)-_invSumBetween(m.out,g.lastCountDate,date);
}

// ---------------------------------------------------------------- items
function InvItems({items,saveItems,figs,edit,onOpenItem}){
  const [q,setQ]=useState("");
  const [editing,setEditing]=useState(null);
  const [paste,setPaste]=useState(false);
  const [showArch,setShowArch]=useState(false);
  var ql=q.trim().toLowerCase();
  var list=invSortItems(items.filter(function(it){
    if(it.archived&&!showArch)return false;
    return !ql||[it.code,it.name,it.category].join(" ").toLowerCase().indexOf(ql)>=0;
  }));
  var cats=[...new Set(items.map(function(it){return it.category;}).filter(Boolean))].sort();
  return <div>
    <div className="filter-bar">
      <input type="text" placeholder="Search code, name, category…" value={q} onChange={function(e){setQ(e.target.value);}} style={{minWidth:220}}/>
      <button className={"fchip"+(showArch?" on":"")} onClick={function(){setShowArch(!showArch);}}>Show archived</button>
      <span style={{fontSize:12,color:"#888"}}>{list.length} item{list.length===1?"":"s"} · {items.filter(function(it){return it.critical&&!it.archived;}).length} critical</span>
      <div style={{flex:1}}/>
      {edit&&<button className="btn btn-sm" onClick={function(){setPaste(true);}}>⤓ Paste from Excel</button>}
      {edit&&<button className="btn btn-pri btn-sm" onClick={function(){setEditing(newInvItem());}}>+ New item</button>}
    </div>
    {!list.length?<div className="empty"><div className="empty-ico">📦</div><div className="empty-txt">{q?"No item matches.":"Start with the critical items: code, name, unit. Everything else refers to them."}</div></div>:
    <table className="tbl"><thead><tr><th>Code</th><th>Name</th><th>Unit</th><th>Category</th><th>Critical</th><th style={{textAlign:"right"}}>Min. stock</th><th style={{textAlign:"right"}}>Book stock</th><th/></tr></thead>
      <tbody>{list.map(function(it){
        return <tr key={it.id} onClick={function(){setEditing(it);}} style={{cursor:"pointer",opacity:it.archived?.5:1}}>
          <td><b>{it.code}</b></td><td>{it.name}{it.archived&&<span className="pill" style={{marginLeft:6,background:"#eceae3",color:"#555"}}>archived</span>}</td><td>{it.unit}</td><td>{it.category}</td>
          <td>{it.critical?<span style={{color:"var(--gold-ink)"}}>★</span>:""}</td>
          <td style={{textAlign:"right"}}>{_invNum(it.minStock)?invFmt(it.minStock):""}</td>
          <td style={{textAlign:"right",fontWeight:700,color:figs[it.id].low?"#ef6c00":undefined}}>{invFmt(figs[it.id].book)}</td>
          <td onClick={function(e){e.stopPropagation();}}><button className="btn btn-sm" onClick={function(){onOpenItem(it.id);}}>📊</button></td>
        </tr>;
      })}</tbody></table>}
    {editing&&<InvItemEditor item={editing} items={items} cats={cats} edit={edit}
      onSave={function(d){_invUpsert(items,saveItems,d);setEditing(null);}}
      onDelete={items.some(function(x){return x.id===editing.id;})&&edit&&invCanDelete()?function(d){
        var f=figs[d.id];
        if(f&&(f.ordered||f.deliveredAll||f.issuedAll||f.lastCountDate)){safeAlert("This item is used in POs, dockets, issues or counts. Archive it instead: its history stays, and it leaves the lists.");return;}
        if(_invRemove(items,saveItems,d,invItemLabel(d)))setEditing(null);
      }:null}
      onClose={function(){setEditing(null);}}/>}
    {paste&&<InvPasteModal items={items} onImport={function(news){saveItems(items.concat(news));setPaste(false);}} onClose={function(){setPaste(false);}}/>}
  </div>;
}
function InvItemEditor({item,items,cats,edit,onSave,onDelete,onClose}){
  const [d,setD]=useState(item);
  function set(patch){setD(Object.assign({},d,patch));}
  var ro=!edit;
  var dup=d.code.trim()&&items.some(function(it){return it.id!==d.id&&(it.code||"").trim().toUpperCase()===d.code.trim().toUpperCase();});
  return <InvModal title="📦 Item" width={620} onClose={onClose} footer={<>
      {onDelete&&<button className="btn btn-danger" onClick={function(){onDelete(d);}} style={{marginRight:"auto"}}>🗑 Delete</button>}
      <button className="btn" onClick={onClose}>{ro?"Close":"Cancel"}</button>
      {!ro&&<button className="btn btn-pri" disabled={!d.name.trim()||!d.unit||dup} onClick={function(){onSave(Object.assign({},d,{code:d.code.trim(),name:d.name.trim(),category:(d.category||"").trim(),minStock:_invNum(d.minStock)}));}}>✓ Save</button>}
    </>}>
    <div className="frow">
      <div className="fg" style={{flex:"0 0 140px"}}><label>Code</label><input type="text" disabled={ro} value={d.code} onChange={function(e){set({code:e.target.value});}} autoFocus/>
        {dup&&<span style={{fontSize:11,color:"#c62828"}}>Code already used.</span>}</div>
      <div className="fg"><label>Name</label><input type="text" disabled={ro} value={d.name} onChange={function(e){set({name:e.target.value});}}/></div>
    </div>
    <div className="frow">
      <div className="fg"><label>Unit</label><input type="text" list="inv-units" disabled={ro} value={d.unit} onChange={function(e){set({unit:e.target.value});}}/>
        <datalist id="inv-units">{INV_UNITS.map(function(x){return <option key={x} value={x}/>;})}</datalist></div>
      <div className="fg"><label>Category</label><input type="text" list="inv-cats" disabled={ro} value={d.category} placeholder="e.g. Waterproofing" onChange={function(e){set({category:e.target.value});}}/>
        <datalist id="inv-cats">{cats.map(function(x){return <option key={x} value={x}/>;})}</datalist></div>
      <div className="fg"><label>Minimum stock</label><InvQtyInput disabled={ro} width={"100%"} value={d.minStock||""} onChange={function(v){set({minStock:v});}}/></div>
    </div>
    <div style={{display:"flex",gap:18,marginBottom:12}}>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:"normal",fontFamily:"inherit",color:"var(--ink)"}}><input type="checkbox" disabled={ro} checked={!!d.critical} onChange={function(){set({critical:!d.critical});}}/> ★ Critical item</label>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,fontWeight:600,textTransform:"none",letterSpacing:"normal",fontFamily:"inherit",color:"var(--ink)"}}><input type="checkbox" disabled={ro} checked={!!d.archived} onChange={function(){set({archived:!d.archived});}}/> Archived <span style={{fontWeight:400,color:"#888"}}>— no longer tracked, history kept</span></label>
    </div>
    <div className="fg"><label>Note</label><textarea rows={2} disabled={ro} value={d.note} onChange={function(e){set({note:e.target.value});}}/></div>
  </InvModal>;
}
function InvPasteModal({items,onImport,onClose}){
  const [text,setText]=useState("");
  var res=text.trim()?invParseItemsPaste(text,items):{items:[],skipped:[]};
  return <InvModal title="⤓ Paste items from Excel" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-pri" disabled={!res.items.length} onClick={function(){onImport(res.items);}}>Add {res.items.length} item{res.items.length===1?"":"s"}</button>
    </>}>
    <div style={{fontSize:12,color:"#555",marginBottom:8}}>Copy the columns from Excel, in this order: <b>code · name · unit · category · minimum stock · critical (Y/N)</b>. Only code and name are required. Critical is Y when left empty.</div>
    <textarea rows={10} value={text} onChange={function(e){setText(e.target.value);}} style={{width:"100%",fontFamily:"var(--font-mono)",fontSize:12}} placeholder={"WP-01\tBituminous membrane 4 mm\troll\tWaterproofing\t20\tY"}/>
    {res.items.length>0&&<div style={{fontSize:12,marginTop:8}}>{res.items.length} new item{res.items.length===1?"":"s"}: {res.items.slice(0,8).map(function(it){return invItemLabel(it)+" ("+it.unit+")";}).join(", ")}{res.items.length>8?"…":""}</div>}
    {res.skipped.length>0&&<div style={{fontSize:12,color:"#ef6c00",marginTop:4}}>Already in the catalogue, skipped: {res.skipped.join(", ")}</div>}
  </InvModal>;
}

// ---------------------------------------------------------------- report & export
function invOpenReport(list,figs,issues){
  var E=esc;
  var t=today();
  var monthStart=t.slice(0,8)+"01";
  var w=invWhereUsed(issues,"",t,"zone");
  var td=function(v,b){return'<td style="text-align:right;'+(b?"font-weight:700;":"")+'">'+v+"</td>";};
  var rows=list.map(function(it){
    var f=figs[it.id];
    return"<tr><td>"+(it.critical?"★ ":"")+"<b>"+E(it.code)+"</b> "+E(it.name)+"</td><td>"+E(it.unit)+"</td>"+td(invFmt(f.ordered))+td(invFmt(f.deliveredAll))+td(f.outstanding?invFmt(f.outstanding):"—")+td(invFmt(f.issuedAll))
      +td(f.lastCountDate?invFmt(f.lastCountQty)+" <small>"+E(fmtDate(f.lastCountDate))+"</small>":"—")+td(invFmt(f.book)+(f.low?" ⚠":""),true)
      +td(f.periods.length?invFmt(f.consumed):"—")+td(f.periods.length?invFmt(f.untraced):"—")+td(f.avg===null?"—":invFmt(f.avg,1),true)+td(f.cover===null?"—":invFmt(f.cover,1)+" mo")+"</tr>";
  }).join("");
  var whereRows=list.filter(function(it){return w.byItem[it.id];}).map(function(it){
    var row=w.byItem[it.id];
    return"<tr><td>"+E(invItemLabel(it))+" ("+E(it.unit)+")</td><td>"+Object.keys(row).sort(function(a,b){return row[b]-row[a];}).map(function(p){return E(p)+": <b>"+invFmt(row[p])+"</b>";}).join(" · ")+"</td></tr>";
  }).join("");
  var html="<h1>Inventory — critical items</h1><div class=\"sub\">Riviera Tower · situation at "+E(fmtDate(t))+"</div>"
    +"<h2>Balance per item</h2><table><tr><th>Item</th><th>Unit</th><th>Ordered</th><th>Delivered</th><th>Still on PO</th><th>Issued</th><th>Last count</th><th>Book stock</th><th>Consumed</th><th>Not traced</th><th>Avg / month</th><th>Cover</th></tr>"+rows+"</table>"
    +"<div style=\"font-size:10px;color:#8b8578\">Consumed = opening + delivered − counted stock, between stock counts. Not traced = consumed − recorded issues. ⚠ = below minimum stock.</div>"
    +(whereRows?"<h2>Where used — all time, by zone</h2><table><tr><th>Item</th><th>Issued per zone</th></tr>"+whereRows+"</table>":"");
  openReport("INVENTORY - "+t,html);
}
function invExportXlsx(list,figs,issues){
  if(!window.XLSX||!window.XLSX.utils||!window.XLSX.writeFile){safeAlert("The Excel library is not loaded.");return;}
  var byId={};list.forEach(function(it){byId[it.id]=it;});
  var bal=list.map(function(it){
    var f=figs[it.id];
    return{"Code":it.code,"Item":it.name,"Unit":it.unit,"Category":it.category,"Critical":it.critical?"Y":"","Ordered":f.ordered,"Delivered":f.deliveredAll,"Still on PO":f.outstanding,
      "Issued":f.issuedAll,"Last count date":f.lastCountDate||"","Last count":f.lastCountDate?f.lastCountQty:"","Book stock":f.book,"Min stock":_invNum(it.minStock)||"",
      "Consumed (counts)":f.periods.length?f.consumed:"","Not traced":f.periods.length?f.untraced:"","Avg / month":f.avg===null?"":Math.round(f.avg*100)/100,"Cover (months)":f.cover===null?"":Math.round(f.cover*10)/10};
  });
  var mv=[];
  (issues||[]).forEach(function(s){(s.lines||[]).forEach(function(l){
    var it=byId[l.itemId];if(!it)return;
    mv.push({"Date":s.date,"Slip":s.ref,"Type":s.kind==="return"?"return":"issue","Code":it.code,"Item":it.name,"Unit":it.unit,"Qty":_invNum(l.qty)*invSign(s),"Zone":s.zone,"Location":s.location,"Use":s.use,"Issued to":s.issuedTo});
  });});
  mv.sort(function(a,b){return a.Date<b.Date?-1:1;});
  var wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(bal),"Balance");
  window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(mv),"Issues");
  window.XLSX.writeFile(wb,"Inventory "+today()+".xlsx");
}
